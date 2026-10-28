// Registro de ocorrências pelo cidadão (anônimo) e consulta pública por protocolo.
// Campos e regras seguem a tabela ocorrencias (migração 002) e o docs/02, seção 4.
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { Banco } from '../db.js';
import { ErroHttp } from '../erros.js';
import type { Armazenamento, FotoValidada } from './fotos.js';

// Mesmo formato do CHECK de ocorrencias.protocolo.
export const PADRAO_PROTOCOLO = /^ECO-[0-9]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/;

// Campos de formulário vazios ("" ou só espaços) contam como não informados.
const opcional = <T extends z.ZodType>(esquema: T) =>
  z.preprocess((valor) => (typeof valor === 'string' && valor.trim() === '' ? undefined : valor), esquema.optional());

// Mesmos limites dos varchar da tabela ocorrencias (e de bairros.nome).
const texto = (maximo: number, faltando: string, rotulo: string) =>
  z
    .string({ error: faltando })
    .trim()
    .min(1, faltando)
    .max(maximo, `${rotulo} pode ter no máximo ${maximo} caracteres`);

// Status, prioridade, conclusão e "demonstrativo" não são aceitos do cidadão:
// campos fora desta lista são descartados e o banco aplica os padrões.
export const esquemaOcorrencia = z
  .object({
    categoria: z.string({ error: 'Informe a categoria' }).trim().regex(/^[a-z0-9_]{1,40}$/, 'Categoria inválida'),
    bairro: texto(80, 'Informe o bairro', 'Bairro'),
    endereco: texto(200, 'Informe o endereço ou um ponto de referência', 'Endereço'),
    descricao: texto(1000, 'Informe a descrição', 'Descrição'),
    latitude: opcional(z.coerce.number('Latitude inválida').min(-90, 'Latitude inválida').max(90, 'Latitude inválida')),
    longitude: opcional(
      z.coerce.number('Longitude inválida').min(-180, 'Longitude inválida').max(180, 'Longitude inválida'),
    ),
    origemLocalizacao: opcional(z.enum(['gps', 'manual'], 'A origem da localização deve ser "gps" ou "manual"')),
    precisaoMetros: opcional(
      z.coerce.number('Precisão inválida').min(0, 'Precisão inválida').max(9_999_999.9, 'Precisão inválida'),
    ),
  })
  // As mesmas regras dos CHECKs de coordenada da tabela ocorrencias.
  .superRefine((dados, contexto) => {
    const temLatitude = dados.latitude !== undefined;
    if (temLatitude !== (dados.longitude !== undefined)) {
      contexto.addIssue({ code: 'custom', message: 'Informe latitude e longitude juntas' });
    } else if (temLatitude !== (dados.origemLocalizacao !== undefined)) {
      contexto.addIssue({
        code: 'custom',
        message: temLatitude ? 'Informe a origem da localização (gps ou manual)' : 'Origem da localização sem coordenadas',
      });
    } else if (dados.precisaoMetros !== undefined && !temLatitude) {
      contexto.addIssue({ code: 'custom', message: 'Precisão informada sem coordenadas' });
    }
  });

export type DadosOcorrencia = z.infer<typeof esquemaOcorrencia>;

export type OcorrenciaCriada = { protocolo: string; status: string; criadoEm: Date };

type Cliente = Pick<PoolClient, 'query' | 'release'>;

// Grava ocorrência, primeira linha do histórico e fotos numa única transação.
// Se qualquer passo falhar: ROLLBACK e apagamento dos arquivos já gravados (sem órfãos).
async function registrar(
  banco: Pick<Banco, 'connect'>,
  armazenamento: Armazenamento,
  dados: DadosOcorrencia,
  fotos: FotoValidada[],
): Promise<OcorrenciaCriada> {
  const cliente: Cliente = await banco.connect();
  const chavesGravadas: string[] = [];
  let conexaoQuebrada: Error | undefined;
  try {
    await cliente.query('BEGIN');
    const { rows: referencias } = await cliente.query<{ categoria_id: number | null; bairro_id: number | null }>(
      `SELECT (SELECT id FROM categorias_ocorrencia WHERE slug = $1 AND ativo) AS categoria_id,
              (SELECT id FROM bairros WHERE lower(nome) = lower($2) ORDER BY id LIMIT 1) AS bairro_id`,
      [dados.categoria, dados.bairro],
    );
    const { categoria_id: categoriaId, bairro_id: bairroId } = referencias[0] ?? {};
    if (!categoriaId) throw new ErroHttp(400, 'Categoria inválida');
    if (!bairroId) throw new ErroHttp(400, 'Bairro não encontrado. Escolha um bairro da lista.');

    const { rows } = await cliente.query<{ id: string; protocolo: string; status: string; criado_em: Date }>(
      `INSERT INTO ocorrencias
         (categoria_id, bairro_id, endereco, descricao, latitude, longitude, origem_localizacao, precisao_m)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, protocolo, status, criado_em`,
      [
        categoriaId,
        bairroId,
        dados.endereco,
        dados.descricao,
        dados.latitude ?? null,
        dados.longitude ?? null,
        dados.origemLocalizacao ?? null,
        dados.precisaoMetros ?? null,
      ],
    );
    const ocorrencia = rows[0]!;
    // Registro do cidadão: sem status anterior e sem usuário.
    await cliente.query(
      `INSERT INTO ocorrencia_historico (ocorrencia_id, status_anterior, status_novo) VALUES ($1, NULL, $2)`,
      [ocorrencia.id, ocorrencia.status],
    );
    for (const [indice, foto] of fotos.entries()) {
      const chave = armazenamento.novaChave(foto.tipoMime);
      chavesGravadas.push(chave); // antes de gravar: um arquivo parcial também é apagado
      await armazenamento.gravar(chave, foto.conteudo);
      await cliente.query(
        `INSERT INTO ocorrencia_fotos (ocorrencia_id, ordem, chave_armazenamento, tipo_mime, tamanho_bytes)
         VALUES ($1, $2, $3, $4, $5)`,
        [ocorrencia.id, indice + 1, chave, foto.tipoMime, foto.tamanhoBytes],
      );
    }
    await cliente.query('COMMIT');
    return { protocolo: ocorrencia.protocolo, status: ocorrencia.status, criadoEm: ocorrencia.criado_em };
  } catch (erro) {
    try {
      await cliente.query('ROLLBACK');
    } catch (erroRollback) {
      conexaoQuebrada = erroRollback as Error; // conexão inutilizável: descartar em vez de devolver ao pool
    }
    await Promise.all(chavesGravadas.map((chave) => armazenamento.apagar(chave)));
    throw erro;
  } finally {
    cliente.release(conexaoQuebrada);
  }
}

function conflitoDeProtocolo(erro: unknown): boolean {
  const { code, constraint } = (erro ?? {}) as { code?: string; constraint?: string };
  return code === '23505' && constraint === 'ocorrencias_protocolo_key';
}

// O protocolo é aleatório (gerar_protocolo, 32^8 combinações por ano). Se repetir,
// a transação inteira é desfeita e refeita com um protocolo novo.
export async function registrarOcorrencia(
  banco: Pick<Banco, 'connect'>,
  armazenamento: Armazenamento,
  dados: DadosOcorrencia,
  fotos: FotoValidada[],
  tentativas = 3,
): Promise<OcorrenciaCriada> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await registrar(banco, armazenamento, dados, fotos);
    } catch (erro) {
      if (!conflitoDeProtocolo(erro) || tentativa >= tentativas) throw erro;
    }
  }
}

export type ConsultaPublica = {
  protocolo: string;
  categoria: string;
  bairro: string;
  status: string;
  criadoEm: Date;
  concluidoEm: Date | null;
  linhaDoTempo: { statusAnterior: string | null; status: string; em: Date }[];
};

// Só os campos públicos (docs/02, seção 4). Ficam de fora: descrição, endereço,
// coordenadas, fotos, prioridade, observações, usuários e ids internos.
export async function consultarProtocolo(
  banco: Pick<Banco, 'query'>,
  protocolo: string,
): Promise<ConsultaPublica | null> {
  const { rows } = await banco.query<{
    id: string;
    protocolo: string;
    categoria: string;
    bairro: string;
    status: string;
    criado_em: Date;
    concluido_em: Date | null;
  }>(
    `SELECT o.id, o.protocolo, c.nome AS categoria, b.nome AS bairro, o.status, o.criado_em, o.concluido_em
       FROM ocorrencias o
       JOIN categorias_ocorrencia c ON c.id = o.categoria_id
       JOIN bairros b ON b.id = o.bairro_id
      WHERE o.protocolo = $1`,
    [protocolo],
  );
  const ocorrencia = rows[0];
  if (!ocorrencia) return null;
  const { rows: historico } = await banco.query<{ status_anterior: string | null; status_novo: string; criado_em: Date }>(
    `SELECT status_anterior, status_novo, criado_em FROM ocorrencia_historico
      WHERE ocorrencia_id = $1 ORDER BY criado_em, id`,
    [ocorrencia.id],
  );
  return {
    protocolo: ocorrencia.protocolo,
    categoria: ocorrencia.categoria,
    bairro: ocorrencia.bairro,
    status: ocorrencia.status,
    criadoEm: ocorrencia.criado_em,
    concluidoEm: ocorrencia.concluido_em,
    linhaDoTempo: historico.map((linha) => ({
      statusAnterior: linha.status_anterior,
      status: linha.status_novo,
      em: linha.criado_em,
    })),
  };
}
