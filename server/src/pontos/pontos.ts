// Guia de reciclagem: pontos de descarte (EcoPontos, PEVs e cooperativas).
// Tabelas pontos_descarte, materiais e ponto_materiais (migração 002); distância pela
// função distancia_km (Haversine, migração 001), como em consultas_teste.sql 2 a 4.
import { z } from 'zod';
import { emTransacao, type Banco } from '../db.js';
import { ErroHttp } from '../erros.js';

export const TIPOS_PONTO = ['ecoponto', 'pev', 'cooperativa'] as const;
export const LIMITE_PROXIMOS_PADRAO = 3;
export const LIMITE_PROXIMOS_MAXIMO = 10;
const MAX_MATERIAIS = 20;

// ---------------------------------------------------------------------------
// Entradas (id da URL, filtros e corpos)
// ---------------------------------------------------------------------------

// pontos_descarte.id é integer: fora do intervalo vira 404 sem chegar ao banco.
export function lerIdPonto(valor: unknown): number {
  const texto = String(valor ?? '');
  const id = Number(texto);
  if (!/^[1-9][0-9]{0,9}$/.test(texto) || id > 2_147_483_647) throw new ErroHttp(404, 'Ponto não encontrado');
  return id;
}

const vazioComoAusente = (valor: unknown) => (typeof valor === 'string' && valor.trim() === '' ? undefined : valor);
const slugMaterial = z.string('Material inválido').regex(/^[a-z0-9_]{1,40}$/, 'Material inválido');

const filtrosBase = {
  tipo: z.preprocess(vazioComoAusente, z.enum(TIPOS_PONTO, 'Tipo inválido (ecoponto, pev ou cooperativa)').optional()),
  material: z.preprocess(vazioComoAusente, slugMaterial.optional()),
};

export const esquemaFiltros = z.object(filtrosBase);
export type Filtros = z.infer<typeof esquemaFiltros>;

// Listagem do admin: inclui os inativos, com filtro opcional pela situação.
export const esquemaFiltrosGestao = z.object({
  ...filtrosBase,
  ativo: z.preprocess(
    vazioComoAusente,
    z.enum(['true', 'false'], 'O filtro ativo deve ser true ou false').transform((v) => v === 'true').optional(),
  ),
});
export type FiltrosGestao = z.infer<typeof esquemaFiltrosGestao>;

// Coordenada obrigatória da query string. Ausente ou vazia: "Informe lat e lng".
const coordenada = (rotulo: string, limite: number) =>
  z.preprocess(
    (valor) => (typeof valor === 'string' ? (valor.trim() === '' ? undefined : Number(valor)) : valor),
    z
      .number({ error: (problema) => (problema.input === undefined ? 'Informe lat e lng' : `${rotulo} inválida`) })
      .min(-limite, `${rotulo} inválida`)
      .max(limite, `${rotulo} inválida`),
  );

export const esquemaProximos = z.object({
  ...filtrosBase,
  lat: coordenada('Latitude', 90),
  lng: coordenada('Longitude', 180),
  limite: z.preprocess(
    vazioComoAusente,
    z.coerce
      .number('Limite inválido')
      .int('Limite inválido')
      .min(1, `O limite deve ser de 1 a ${LIMITE_PROXIMOS_MAXIMO}`)
      .max(LIMITE_PROXIMOS_MAXIMO, `O limite deve ser de 1 a ${LIMITE_PROXIMOS_MAXIMO}`)
      .default(LIMITE_PROXIMOS_PADRAO),
  ),
});
export type FiltrosProximos = z.infer<typeof esquemaProximos>;

// Texto obrigatório com os limites dos varchar da tabela.
const textoObrigatorio = (maximo: number, faltando: string, rotulo: string) =>
  z
    .string({ error: faltando })
    .trim()
    .min(1, faltando)
    .max(maximo, `${rotulo} pode ter no máximo ${maximo} caracteres`);

// Texto opcional: "" ou null limpam o campo (gravado como NULL).
const textoOpcional = <T extends z.ZodType<string | null>>(esquema: T) =>
  z.preprocess((valor) => (typeof valor === 'string' && valor.trim() === '' ? null : valor), esquema.nullable().optional());

const limitado = (maximo: number, rotulo: string) =>
  z.string(`${rotulo} inválido`).trim().max(maximo, `${rotulo} pode ter no máximo ${maximo} caracteres`);

// O front exibe o site como link: só http(s), nunca javascript: ou data:.
const site = limitado(300, 'Site').refine((valor) => {
  try {
    const url = new URL(valor);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}, 'Site inválido: use um endereço http:// ou https://');

const camposPonto = {
  tipo: z.enum(TIPOS_PONTO, 'Tipo inválido (ecoponto, pev ou cooperativa)'),
  nome: textoObrigatorio(120, 'Informe o nome', 'Nome'),
  bairro: textoObrigatorio(80, 'Informe o bairro', 'Bairro'),
  endereco: textoOpcional(limitado(200, 'Endereço')),
  latitude: z.number('Latitude inválida').min(-90, 'Latitude inválida').max(90, 'Latitude inválida'),
  longitude: z.number('Longitude inválida').min(-180, 'Longitude inválida').max(180, 'Longitude inválida'),
  horarioFuncionamento: textoOpcional(limitado(120, 'Horário')),
  situacao: textoOpcional(limitado(80, 'Situação')),
  telefone: textoOpcional(limitado(20, 'Telefone').regex(/^[0-9+() -]{8,20}$/, 'Telefone inválido')),
  email: textoOpcional(z.email('E-mail inválido').max(254, 'E-mail inválido')),
  site: textoOpcional(site),
  demonstrativo: z.boolean('demonstrativo deve ser true ou false'),
  fonte: textoOpcional(limitado(500, 'Fonte')),
  verificadoEm: textoOpcional(z.iso.date('verificadoEm deve ser uma data AAAA-MM-DD')),
  materiais: z
    .array(slugMaterial, 'materiais deve ser uma lista de slugs')
    .max(MAX_MATERIAIS, `Informe no máximo ${MAX_MATERIAIS} materiais`)
    .transform((lista) => [...new Set(lista)]),
};

// Mesma regra do CHECK pontos_fonte_obrigatoria: dado não demonstrativo exige fonte.
const MENSAGEM_FONTE = 'Ponto não demonstrativo exige a fonte do dado';

export const esquemaNovoPonto = z
  .object({
    ...camposPonto,
    demonstrativo: camposPonto.demonstrativo.default(true),
    materiais: camposPonto.materiais.default([]),
  })
  .refine((dados) => dados.demonstrativo || !!dados.fonte, { message: MENSAGEM_FONTE });
export type NovoPonto = z.infer<typeof esquemaNovoPonto>;

// Edição parcial: só os campos enviados mudam. "ativo" reativa um ponto desativado.
export const esquemaEdicaoPonto = z
  .object({
    tipo: camposPonto.tipo.optional(),
    nome: camposPonto.nome.optional(),
    bairro: camposPonto.bairro.optional(),
    endereco: camposPonto.endereco,
    latitude: camposPonto.latitude.optional(),
    longitude: camposPonto.longitude.optional(),
    horarioFuncionamento: camposPonto.horarioFuncionamento,
    situacao: camposPonto.situacao,
    telefone: camposPonto.telefone,
    email: camposPonto.email,
    site: camposPonto.site,
    demonstrativo: camposPonto.demonstrativo.optional(),
    fonte: camposPonto.fonte,
    verificadoEm: camposPonto.verificadoEm,
    materiais: camposPonto.materiais.optional(),
    ativo: z.boolean('ativo deve ser true ou false').optional(),
  })
  .refine((dados) => Object.values(dados).some((valor) => valor !== undefined), {
    message: 'Informe ao menos um campo para alterar',
  });
export type EdicaoPonto = z.infer<typeof esquemaEdicaoPonto>;

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

type LinhaPonto = {
  id: number;
  tipo: string;
  nome: string;
  bairro: string;
  endereco: string | null;
  latitude: number;
  longitude: number;
  horario_funcionamento: string | null;
  situacao: string | null;
  telefone: string | null;
  email: string | null;
  site: string | null;
  demonstrativo: boolean;
  fonte: string | null;
  verificado_em: string | null;
  materiais: { slug: string; nome: string }[];
  ativo: boolean;
  criado_em: Date;
  atualizado_em: Date;
};

const COLUNAS = `
  p.id, p.tipo, p.nome, b.nome AS bairro, p.endereco,
  p.latitude::float8 AS latitude, p.longitude::float8 AS longitude,
  p.horario_funcionamento, p.situacao, p.telefone, p.email, p.site,
  p.demonstrativo, p.fonte, to_char(p.verificado_em, 'YYYY-MM-DD') AS verificado_em,
  p.ativo, p.criado_em, p.atualizado_em,
  COALESCE((SELECT json_agg(json_build_object('slug', m.slug, 'nome', m.nome) ORDER BY m.nome)
              FROM ponto_materiais pm JOIN materiais m ON m.id = pm.material_id
             WHERE pm.ponto_id = p.id), '[]'::json) AS materiais`;

const JUNCOES = `FROM pontos_descarte p JOIN bairros b ON b.id = p.bairro_id`;

// Campos públicos: tudo o que o guia mostra. "ativo" e as datas internas ficam de fora.
function publico(linha: LinhaPonto) {
  return {
    id: linha.id,
    tipo: linha.tipo,
    nome: linha.nome,
    bairro: linha.bairro,
    endereco: linha.endereco,
    latitude: linha.latitude,
    longitude: linha.longitude,
    horarioFuncionamento: linha.horario_funcionamento,
    situacao: linha.situacao,
    telefone: linha.telefone,
    email: linha.email,
    site: linha.site,
    materiais: linha.materiais,
    demonstrativo: linha.demonstrativo,
    fonte: linha.fonte,
    verificadoEm: linha.verificado_em,
  };
}

function gestao(linha: LinhaPonto) {
  return { ...publico(linha), ativo: linha.ativo, criadoEm: linha.criado_em, atualizadoEm: linha.atualizado_em };
}

// Monta as condições com parâmetros numerados ($1, $2...), sem concatenar valores.
function condicoes(filtros: Filtros & { ativo?: boolean }, valores: unknown[]) {
  const parametro = (valor: unknown) => {
    valores.push(valor);
    return `$${valores.length}`;
  };
  const lista: string[] = [];
  if (filtros.ativo !== undefined) lista.push(`p.ativo = ${parametro(filtros.ativo)}`);
  if (filtros.tipo) lista.push(`p.tipo = ${parametro(filtros.tipo)}`);
  if (filtros.material) {
    lista.push(`EXISTS (SELECT 1 FROM ponto_materiais pm JOIN materiais m ON m.id = pm.material_id
                         WHERE pm.ponto_id = p.id AND m.slug = ${parametro(filtros.material)})`);
  }
  return lista.length ? `WHERE ${lista.join(' AND ')}` : '';
}

// Guia público: só pontos ativos, na ordem da consulta 4 (tipo e nome).
export async function listarPontos(banco: Pick<Banco, 'query'>, filtros: Filtros) {
  const valores: unknown[] = [];
  const onde = condicoes({ ...filtros, ativo: true }, valores);
  const { rows } = await banco.query<LinhaPonto>(`SELECT ${COLUNAS} ${JUNCOES} ${onde} ORDER BY p.tipo, p.nome, p.id`, valores);
  return { itens: rows.map(publico) };
}

export async function listarPontosGestao(banco: Pick<Banco, 'query'>, filtros: FiltrosGestao) {
  const valores: unknown[] = [];
  const onde = condicoes(filtros, valores);
  const { rows } = await banco.query<LinhaPonto>(`SELECT ${COLUNAS} ${JUNCOES} ${onde} ORDER BY p.tipo, p.nome, p.id`, valores);
  return { itens: rows.map(gestao) };
}

// Pontos ativos mais próximos (consultas 2 e 3). A distância é a de distancia_km,
// arredondada a 2 casas como na consulta 2; a ordem usa o valor sem arredondar.
export async function pontosProximos(banco: Pick<Banco, 'query'>, filtros: FiltrosProximos) {
  const valores: unknown[] = [filtros.lat, filtros.lng];
  const distancia = 'distancia_km($1::float8, $2::float8, p.latitude::float8, p.longitude::float8)';
  const onde = condicoes({ tipo: filtros.tipo, material: filtros.material, ativo: true }, valores);
  valores.push(filtros.limite);
  const { rows } = await banco.query<LinhaPonto & { distancia_km: number }>(
    `SELECT ${COLUNAS}, ${distancia} AS distancia_km ${JUNCOES} ${onde}
      ORDER BY ${distancia}, p.id
      LIMIT $${valores.length}`,
    valores,
  );
  return {
    itens: rows.map((linha) => ({ ...publico(linha), distanciaKm: Math.round(linha.distancia_km * 100) / 100 })),
  };
}

export async function detalharPonto(banco: Pick<Banco, 'query'>, id: number) {
  const { rows } = await banco.query<LinhaPonto>(`SELECT ${COLUNAS} ${JUNCOES} WHERE p.id = $1`, [id]);
  const linha = rows[0];
  if (!linha) throw new ErroHttp(404, 'Ponto não encontrado');
  return gestao(linha);
}

// ---------------------------------------------------------------------------
// Alterações (somente admin)
// ---------------------------------------------------------------------------

type Cliente = Pick<Banco, 'query'>;

async function idBairro(cliente: Cliente, nome: string): Promise<number> {
  const { rows } = await cliente.query<{ id: number }>(
    'SELECT id FROM bairros WHERE lower(nome) = lower($1) ORDER BY id LIMIT 1',
    [nome],
  );
  if (!rows[0]) throw new ErroHttp(400, 'Bairro não encontrado. Escolha um bairro da lista.');
  return rows[0].id;
}

// Troca a lista de materiais do ponto. Slug desconhecido: 400 (nada é gravado).
async function gravarMateriais(cliente: Cliente, pontoId: number, slugs: string[]) {
  const { rows } = await cliente.query<{ id: number; slug: string }>(
    'SELECT id, slug FROM materiais WHERE slug = ANY($1::text[])',
    [slugs],
  );
  const desconhecidos = slugs.filter((slug) => !rows.some((m) => m.slug === slug));
  if (desconhecidos.length) throw new ErroHttp(400, `Material inválido: ${desconhecidos.join(', ')}`);
  await cliente.query('DELETE FROM ponto_materiais WHERE ponto_id = $1', [pontoId]);
  if (rows.length) {
    await cliente.query(
      'INSERT INTO ponto_materiais (ponto_id, material_id) SELECT $1, unnest($2::smallint[])',
      [pontoId, rows.map((m) => m.id)],
    );
  }
}

// Nome repetido no mesmo tipo (UNIQUE pontos_nome_unico) vira 409.
function traduzirConflito(erro: unknown): never {
  const { code, constraint } = (erro ?? {}) as { code?: string; constraint?: string };
  if (code === '23505' && constraint === 'pontos_nome_unico') {
    throw new ErroHttp(409, 'Já existe um ponto desse tipo com esse nome');
  }
  throw erro;
}

// Coluna de cada campo editável. Só nomes desta lista entram no SQL.
const COLUNAS_EDITAVEIS = {
  tipo: 'tipo',
  nome: 'nome',
  endereco: 'endereco',
  latitude: 'latitude',
  longitude: 'longitude',
  horarioFuncionamento: 'horario_funcionamento',
  situacao: 'situacao',
  telefone: 'telefone',
  email: 'email',
  site: 'site',
  demonstrativo: 'demonstrativo',
  fonte: 'fonte',
  verificadoEm: 'verificado_em',
  ativo: 'ativo',
} as const;

export async function criarPonto(banco: Pick<Banco, 'connect'>, dados: NovoPonto): Promise<number> {
  try {
    return await emTransacao(banco, async (cliente) => {
      const bairroId = await idBairro(cliente, dados.bairro);
      const { rows } = await cliente.query<{ id: number }>(
        `INSERT INTO pontos_descarte
           (tipo, nome, bairro_id, endereco, latitude, longitude, horario_funcionamento, situacao,
            telefone, email, site, demonstrativo, fonte, verificado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id`,
        [
          dados.tipo,
          dados.nome,
          bairroId,
          dados.endereco ?? null,
          dados.latitude,
          dados.longitude,
          dados.horarioFuncionamento ?? null,
          dados.situacao ?? null,
          dados.telefone ?? null,
          dados.email ?? null,
          dados.site ?? null,
          dados.demonstrativo,
          dados.fonte ?? null,
          dados.verificadoEm ?? null,
        ],
      );
      const id = rows[0]!.id;
      if (dados.materiais.length) await gravarMateriais(cliente, id, dados.materiais);
      return id;
    });
  } catch (erro) {
    traduzirConflito(erro);
  }
}

// Edição parcial numa transação: a linha fica travada enquanto a regra da fonte é
// conferida contra o estado final (o que veio no corpo + o que já estava gravado).
export async function editarPonto(banco: Pick<Banco, 'connect'>, id: number, dados: EdicaoPonto): Promise<void> {
  try {
    await emTransacao(banco, async (cliente) => {
      const { rows } = await cliente.query<{ demonstrativo: boolean; fonte: string | null }>(
        'SELECT demonstrativo, fonte FROM pontos_descarte WHERE id = $1 FOR UPDATE',
        [id],
      );
      const atual = rows[0];
      if (!atual) throw new ErroHttp(404, 'Ponto não encontrado');
      const demonstrativo = dados.demonstrativo ?? atual.demonstrativo;
      const fonte = dados.fonte !== undefined ? dados.fonte : atual.fonte;
      if (!demonstrativo && !fonte) throw new ErroHttp(400, MENSAGEM_FONTE);

      const valores: unknown[] = [id];
      const atribuicoes: string[] = [];
      for (const [campo, coluna] of Object.entries(COLUNAS_EDITAVEIS)) {
        const valor = dados[campo as keyof typeof COLUNAS_EDITAVEIS];
        if (valor === undefined) continue;
        valores.push(valor);
        atribuicoes.push(`${coluna} = $${valores.length}`);
      }
      if (dados.bairro !== undefined) {
        valores.push(await idBairro(cliente, dados.bairro));
        atribuicoes.push(`bairro_id = $${valores.length}`);
      }
      // Mesmo quando só os materiais mudam, o UPDATE roda para o gatilho renovar atualizado_em.
      if (!atribuicoes.length) atribuicoes.push('atualizado_em = now()');
      await cliente.query(`UPDATE pontos_descarte SET ${atribuicoes.join(', ')} WHERE id = $1`, valores);
      if (dados.materiais !== undefined) await gravarMateriais(cliente, id, dados.materiais);
    });
  } catch (erro) {
    traduzirConflito(erro);
  }
}

// "Excluir" desativa: o ponto some do guia público, mas continua no banco e pode
// ser reativado pelo PATCH (ativo: true). Repetir a operação não muda nada.
export async function desativarPonto(banco: Pick<Banco, 'query'>, id: number): Promise<void> {
  const { rowCount } = await banco.query('UPDATE pontos_descarte SET ativo = false WHERE id = $1', [id]);
  if (!rowCount) throw new ErroHttp(404, 'Ponto não encontrado');
}
