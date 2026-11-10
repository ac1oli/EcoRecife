// Gestão de ocorrências (servidores logados): listagem, detalhe, status, prioridade e fotos.
// Transições conforme docs/02, seção 3; cada troca de status gera uma linha no histórico,
// na mesma transação, com o usuário da sessão como responsável.
import { z } from 'zod';
import { emTransacao, type Banco } from '../db.js';
import { ErroHttp } from '../erros.js';

export const STATUS_ATIVOS = ['recebida', 'em_analise', 'equipe_designada'] as const;
export const PRIORIDADES = ['urgente', 'alta', 'media', 'baixa'] as const;
const STATUS = [...STATUS_ATIVOS, 'concluida'] as const;

type Status = (typeof STATUS)[number];
type StatusAtivo = (typeof STATUS_ATIVOS)[number];

// ---------------------------------------------------------------------------
// Entradas (ids da URL, filtros e corpos)
// ---------------------------------------------------------------------------

// Id da URL: inteiro positivo dentro do bigint. Qualquer outra coisa vira 404,
// sem chegar ao banco (não revela se o formato ou o registro é que não existe).
export function lerIdOcorrencia(valor: unknown): string {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]{0,17}$/.test(texto)) throw new ErroHttp(404, 'Ocorrência não encontrada');
  return texto;
}

export function lerIdFoto(valor: unknown): string {
  const texto = String(valor ?? '').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(texto)) {
    throw new ErroHttp(404, 'Foto não encontrada');
  }
  return texto;
}

const vazioComoAusente = (valor: unknown) => (typeof valor === 'string' && valor.trim() === '' ? undefined : valor);

export const esquemaFiltros = z.object({
  fila: z.preprocess(vazioComoAusente, z.enum(['ativas', 'concluidas'], 'Fila inválida (ativas ou concluidas)').optional()),
  status: z.preprocess(vazioComoAusente, z.enum(STATUS, 'Status inválido').optional()),
  prioridade: z.preprocess(vazioComoAusente, z.enum(PRIORIDADES, 'Prioridade inválida').optional()),
  categoria: z.preprocess(
    vazioComoAusente,
    z.string('Categoria inválida').regex(/^[a-z0-9_]{1,40}$/, 'Categoria inválida').optional(),
  ),
  bairro: z.preprocess(vazioComoAusente, z.string('Bairro inválido').trim().max(80, 'Bairro inválido').optional()),
  busca: z.preprocess(vazioComoAusente, z.string('Busca inválida').trim().max(100, 'Busca com no máximo 100 caracteres').optional()),
  pagina: z.preprocess(vazioComoAusente, z.coerce.number('Página inválida').int('Página inválida').min(1, 'Página inválida').max(100_000, 'Página inválida').default(1)),
  porPagina: z.preprocess(
    vazioComoAusente,
    z.coerce.number('porPagina inválido').int('porPagina inválido').min(1, 'porPagina deve ser de 1 a 50').max(50, 'porPagina deve ser de 1 a 50').default(20),
  ),
});
export type Filtros = z.infer<typeof esquemaFiltros>;

const observacao = z
  .string('Observação inválida')
  .trim()
  .max(500, 'Observação com no máximo 500 caracteres')
  .optional()
  .transform((valor) => valor || undefined);

export const esquemaStatus = z.object({
  status: z.enum(STATUS_ATIVOS, 'Status inválido: use recebida, em_analise ou equipe_designada (para concluir, use /concluir)'),
  observacao,
});
export const esquemaConcluir = z.object({
  nota: z
    .string('Nota inválida')
    .trim()
    .max(500, 'Nota com no máximo 500 caracteres')
    .optional()
    .transform((valor) => valor || undefined),
});
export const esquemaReabrir = z.object({ observacao });
export const esquemaPrioridade = z.object({ prioridade: z.enum(PRIORIDADES, 'Prioridade inválida') });

// ---------------------------------------------------------------------------
// Regras de transição (docs/02, seção 3)
// ---------------------------------------------------------------------------

export type Acao = { tipo: 'status'; status: StatusAtivo } | { tipo: 'concluir' } | { tipo: 'reabrir' };

const ehAtivo = (status: Status): status is StatusAtivo => (STATUS_ATIVOS as readonly string[]).includes(status);

// Devolve o novo status ou recusa com 409 (o pedido é válido, mas não no estado atual).
export function proximoStatus(atual: Status, acao: Acao): Status {
  if (acao.tipo === 'reabrir') {
    if (atual !== 'concluida') throw new ErroHttp(409, 'Só ocorrências concluídas podem ser reabertas');
    return 'em_analise';
  }
  if (!ehAtivo(atual)) {
    throw new ErroHttp(409, 'A ocorrência está concluída. Reabra-a antes de mudar o status.');
  }
  if (acao.tipo === 'concluir') return 'concluida';
  if (acao.status === atual) throw new ErroHttp(409, `A ocorrência já está com o status ${atual}`);
  return acao.status;
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

type LinhaOcorrencia = {
  id: string;
  protocolo: string;
  categoria_slug: string;
  categoria: string;
  bairro: string;
  endereco: string;
  descricao: string;
  status: Status;
  prioridade: string;
  criado_em: Date;
  atualizado_em: Date;
  concluido_em: Date | null;
  demonstrativo: boolean;
  quantidade_fotos: number;
};

const COLUNAS_RESUMO = `
  o.id::text AS id, o.protocolo, c.slug AS categoria_slug, c.nome AS categoria, b.nome AS bairro,
  o.endereco, o.descricao, o.status, o.prioridade, o.criado_em, o.atualizado_em, o.concluido_em,
  o.demonstrativo, (SELECT count(*)::int FROM ocorrencia_fotos f WHERE f.ocorrencia_id = o.id) AS quantidade_fotos`;

const JUNCOES = `
  FROM ocorrencias o
  JOIN categorias_ocorrencia c ON c.id = o.categoria_id
  JOIN bairros b ON b.id = o.bairro_id`;

function resumo(linha: LinhaOcorrencia) {
  return {
    id: linha.id,
    protocolo: linha.protocolo,
    categoria: { slug: linha.categoria_slug, nome: linha.categoria },
    bairro: linha.bairro,
    endereco: linha.endereco,
    descricao: linha.descricao,
    status: linha.status,
    prioridade: linha.prioridade,
    criadoEm: linha.criado_em,
    atualizadoEm: linha.atualizado_em,
    concluidoEm: linha.concluido_em,
    demonstrativo: linha.demonstrativo,
    quantidadeFotos: linha.quantidade_fotos,
  };
}

// Escapa os curingas do LIKE para que a busca seja literal.
const literalLike = (texto: string) => texto.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listarOcorrencias(banco: Pick<Banco, 'query'>, filtros: Filtros) {
  const condicoes: string[] = [];
  const valores: unknown[] = [];
  const parametro = (valor: unknown) => {
    valores.push(valor);
    return `$${valores.length}`;
  };
  if (filtros.fila === 'ativas') condicoes.push(`o.status <> 'concluida'`);
  if (filtros.fila === 'concluidas') condicoes.push(`o.status = 'concluida'`);
  if (filtros.status) condicoes.push(`o.status = ${parametro(filtros.status)}`);
  if (filtros.prioridade) condicoes.push(`o.prioridade = ${parametro(filtros.prioridade)}`);
  if (filtros.categoria) condicoes.push(`c.slug = ${parametro(filtros.categoria)}`);
  if (filtros.bairro) condicoes.push(`lower(b.nome) = lower(${parametro(filtros.bairro)})`);
  if (filtros.busca) {
    // Mesmos campos da busca do protótipo: protocolo, tipo, bairro e endereço.
    const p = parametro(`%${literalLike(filtros.busca)}%`);
    condicoes.push(`(o.protocolo ILIKE ${p} OR c.nome ILIKE ${p} OR b.nome ILIKE ${p} OR o.endereco ILIKE ${p})`);
  }
  const onde = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

  const { rows: contagem } = await banco.query<{ total: number }>(
    `SELECT count(*)::int AS total ${JUNCOES} ${onde}`,
    [...valores], // cópia: limite e deslocamento entram depois, só na consulta da página
  );
  const total = contagem[0]?.total ?? 0;
  const limite = parametro(filtros.porPagina);
  const deslocamento = parametro((filtros.pagina - 1) * filtros.porPagina);
  const { rows } = await banco.query<LinhaOcorrencia>(
    `SELECT ${COLUNAS_RESUMO} ${JUNCOES} ${onde}
      ORDER BY o.criado_em DESC, o.id DESC
      LIMIT ${limite} OFFSET ${deslocamento}`,
    valores,
  );
  return {
    itens: rows.map(resumo),
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
    total,
    totalPaginas: Math.ceil(total / filtros.porPagina),
  };
}

export async function detalharOcorrencia(banco: Pick<Banco, 'query'>, id: string) {
  const { rows } = await banco.query<
    LinhaOcorrencia & {
      latitude: number | null;
      longitude: number | null;
      origem_localizacao: string | null;
      precisao_m: number | null;
      nota_conclusao: string | null;
    }
  >(
    `SELECT ${COLUNAS_RESUMO}, o.latitude::float8 AS latitude, o.longitude::float8 AS longitude,
            o.origem_localizacao, o.precisao_m::float8 AS precisao_m, o.nota_conclusao
       ${JUNCOES}
      WHERE o.id = $1`,
    [id],
  );
  const linha = rows[0];
  if (!linha) throw new ErroHttp(404, 'Ocorrência não encontrada');

  // A chave de armazenamento não sai da API: a foto é acessada pela rota protegida.
  const { rows: fotos } = await banco.query<{ id: string; ordem: number; tipo_mime: string; tamanho_bytes: number }>(
    `SELECT id, ordem, tipo_mime, tamanho_bytes FROM ocorrencia_fotos WHERE ocorrencia_id = $1 ORDER BY ordem`,
    [id],
  );
  // Do responsável, só o nome (sem e-mail nem perfil). Nulo = registro do cidadão
  // ou usuário que foi excluído depois (ON DELETE SET NULL).
  const { rows: historico } = await banco.query<{
    status_anterior: Status | null;
    status_novo: Status;
    observacao: string | null;
    criado_em: Date;
    responsavel: string | null;
  }>(
    `SELECT h.status_anterior, h.status_novo, h.observacao, h.criado_em, u.nome AS responsavel
       FROM ocorrencia_historico h LEFT JOIN usuarios u ON u.id = h.usuario_id
      WHERE h.ocorrencia_id = $1
      ORDER BY h.criado_em, h.id`,
    [id],
  );
  return {
    ...resumo(linha),
    latitude: linha.latitude,
    longitude: linha.longitude,
    origemLocalizacao: linha.origem_localizacao,
    precisaoMetros: linha.precisao_m,
    notaConclusao: linha.nota_conclusao,
    fotos: fotos.map((foto) => ({
      id: foto.id,
      ordem: foto.ordem,
      tipoMime: foto.tipo_mime,
      tamanhoBytes: foto.tamanho_bytes,
      url: `/api/ocorrencias/${id}/fotos/${foto.id}`,
    })),
    historico: historico.map((h) => ({
      statusAnterior: h.status_anterior,
      status: h.status_novo,
      observacao: h.observacao,
      responsavel: h.responsavel,
      em: h.criado_em,
    })),
  };
}

// ---------------------------------------------------------------------------
// Alterações
// ---------------------------------------------------------------------------

// Troca o status e grava o histórico numa só transação. A linha fica travada
// (FOR UPDATE) entre a leitura do status atual e a gravação, então duas mudanças
// simultâneas não validam contra um estado desatualizado.
export async function mudarStatus(
  banco: Pick<Banco, 'connect'>,
  id: string,
  usuarioId: string,
  acao: Acao,
  texto?: string,
): Promise<void> {
  await emTransacao(banco, async (cliente) => {
    const { rows } = await cliente.query<{ status: Status }>(
      'SELECT status FROM ocorrencias WHERE id = $1 FOR UPDATE',
      [id],
    );
    const atual = rows[0]?.status;
    if (!atual) throw new ErroHttp(404, 'Ocorrência não encontrada');
    const novo = proximoStatus(atual, acao);
    // Concluir grava data e nota; qualquer outro destino é ativo e limpa a conclusão.
    // ($3 é um booleano à parte: reusar $2 em comparação de texto daria tipos conflitantes.)
    const concluindo = novo === 'concluida';
    await cliente.query(
      `UPDATE ocorrencias
          SET status = $2,
              concluido_em = CASE WHEN $3 THEN now() END,
              nota_conclusao = CASE WHEN $3 THEN $4 END
        WHERE id = $1`,
      [id, novo, concluindo, concluindo ? (texto ?? null) : null],
    );
    await cliente.query(
      `INSERT INTO ocorrencia_historico (ocorrencia_id, status_anterior, status_novo, usuario_id, observacao)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, atual, novo, usuarioId, texto ?? null],
    );
  });
}

// A prioridade não gera histórico: o histórico registra só trocas de status
// (CHECK historico_muda_status).
export async function mudarPrioridade(banco: Pick<Banco, 'query'>, id: string, prioridade: string): Promise<void> {
  const { rowCount } = await banco.query('UPDATE ocorrencias SET prioridade = $2 WHERE id = $1', [id, prioridade]);
  if (!rowCount) throw new ErroHttp(404, 'Ocorrência não encontrada');
}

// Só encontra a foto se ela pertencer à ocorrência da URL.
export async function buscarFoto(banco: Pick<Banco, 'query'>, ocorrenciaId: string, fotoId: string) {
  const { rows } = await banco.query<{ chave_armazenamento: string; tipo_mime: string }>(
    `SELECT chave_armazenamento, tipo_mime FROM ocorrencia_fotos WHERE id = $1 AND ocorrencia_id = $2`,
    [fotoId, ocorrenciaId],
  );
  return rows[0] ?? null;
}
