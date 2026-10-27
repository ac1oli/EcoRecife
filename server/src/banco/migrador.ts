// Executor das migrações e dos seeds de database/. Reaproveita os mesmos arquivos SQL
// usados por database/instalar.sql (nada é duplicado) e a tabela schema_migrations,
// em que cada migração registra a própria versão dentro da sua transação.
//
// Garantias:
// - valida todos os arquivos ANTES de conectar (nome, BEGIN/COMMIT únicos, autorregistro,
//   ausência de comandos do psql), para não começar algo que não vai terminar;
// - nunca apaga nem recria nada: só executa migrações ainda não registradas;
// - recusa banco com objetos mas sem schema_migrations (estado desconhecido);
// - recusa versões registradas que não existem no repositório e migrações fora de ordem;
// - cada migração roda na transação do próprio arquivo: se falhar, faz ROLLBACK e para,
//   mantendo as anteriores aplicadas;
// - trava consultiva (advisory lock) impede duas execuções simultâneas.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';

export const PASTA_DATABASE = path.resolve(import.meta.dirname, '../../../database');
export const PASTA_MIGRACOES = path.join(PASTA_DATABASE, 'migrations');
export const PASTA_SEEDS = path.join(PASTA_DATABASE, 'seeds');

// Chave arbitrária e fixa da trava consultiva do EcoRecife.
const CHAVE_TRAVA = 4_242_026;

const PADRAO_NOME = /^(\d{3})_[a-z0-9_]+\.sql$/;

export type ArquivoSql = { versao: string; arquivo: string; sql: string };

export type ResultadoMigracao = {
  jaAplicadas: string[];
  pendentes: string[];
  aplicadasAgora: string[];
};

type Pool = Pick<pg.Pool, 'connect'>;
type Cliente = Pick<pg.PoolClient, 'query'>;

export class ErroMigracao extends Error {}

function contar(sql: string, padrao: RegExp): number {
  return sql.match(padrao)?.length ?? 0;
}

export function validarArquivo(arquivo: ArquivoSql, exigirAutorregistro: boolean): void {
  const { arquivo: nome, sql, versao } = arquivo;
  if (/^\s*\\/m.test(sql)) {
    throw new ErroMigracao(`${nome}: contém comando do psql (linha iniciada por "\\"); use só SQL puro`);
  }
  if (contar(sql, /^\s*BEGIN\s*;\s*$/gim) !== 1 || contar(sql, /^\s*COMMIT\s*;\s*$/gim) !== 1) {
    throw new ErroMigracao(`${nome}: deve ter exatamente uma linha "BEGIN;" e uma linha "COMMIT;"`);
  }
  const semComentarios = sql.replace(/--.*$/gm, '').trim();
  if (!/^BEGIN\s*;/i.test(semComentarios) || !/COMMIT\s*;$/i.test(semComentarios)) {
    throw new ErroMigracao(`${nome}: deve começar com "BEGIN;" e terminar com "COMMIT;"`);
  }
  if (exigirAutorregistro) {
    const registro = new RegExp(
      `INSERT\\s+INTO\\s+schema_migrations\\s*\\(\\s*versao\\s*\\)\\s*VALUES\\s*\\(\\s*'${versao}'\\s*\\)`,
      'i',
    );
    if (!registro.test(sql)) {
      throw new ErroMigracao(
        `${nome}: falta "INSERT INTO schema_migrations (versao) VALUES ('${versao}');" antes do COMMIT`,
      );
    }
  }
}

export async function lerArquivos(pasta: string, exigirAutorregistro: boolean): Promise<ArquivoSql[]> {
  const nomes = (await readdir(pasta)).filter((nome) => nome.toLowerCase().endsWith('.sql')).sort();
  const prefixos = new Set<string>();
  const arquivos: ArquivoSql[] = [];
  for (const nome of nomes) {
    const prefixo = PADRAO_NOME.exec(nome)?.[1];
    if (!prefixo) {
      throw new ErroMigracao(`${nome}: nome fora do padrão NNN_descricao.sql (minúsculas, números e "_")`);
    }
    if (prefixos.has(prefixo)) throw new ErroMigracao(`Número ${prefixo} repetido em ${pasta}`);
    prefixos.add(prefixo);
    const arquivo = { versao: nome.slice(0, -4), arquivo: nome, sql: await readFile(path.join(pasta, nome), 'utf8') };
    validarArquivo(arquivo, exigirAutorregistro);
    arquivos.push(arquivo);
  }
  return arquivos;
}

async function comTrava<T>(pool: Pool, tarefa: (cliente: Cliente) => Promise<T>): Promise<T> {
  const cliente = await pool.connect();
  try {
    const { rows } = await cliente.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [CHAVE_TRAVA]);
    if (!rows[0]?.ok) {
      throw new ErroMigracao('Outra execução de migração/seed está em andamento neste banco. Tente de novo depois.');
    }
    try {
      return await tarefa(cliente);
    } finally {
      await cliente.query('SELECT pg_advisory_unlock($1)', [CHAVE_TRAVA]).catch(() => {});
    }
  } finally {
    cliente.release();
  }
}

// Executa um arquivo inteiro (com o BEGIN/COMMIT dele). Em caso de erro, desfaz a transação.
async function executarArquivo(cliente: Cliente, arquivo: ArquivoSql, tipo: string): Promise<void> {
  try {
    await cliente.query(arquivo.sql);
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => {});
    const motivo = erro instanceof Error ? erro.message : String(erro);
    throw new ErroMigracao(`Falha ${tipo} ${arquivo.arquivo}: ${motivo}. Nada deste arquivo foi gravado.`, {
      cause: erro,
    });
  }
}

async function versoesRegistradas(cliente: Cliente): Promise<Set<string> | null> {
  const { rows } = await cliente.query<{ existe: boolean }>(
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS existe",
  );
  if (!rows[0]?.existe) return null;
  const registradas = await cliente.query<{ versao: string }>('SELECT versao FROM schema_migrations');
  return new Set(registradas.rows.map((linha) => linha.versao));
}

async function esquemaPublicoVazio(cliente: Cliente): Promise<boolean> {
  const { rows } = await cliente.query<{ total: number }>(`
    SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public')
         + (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE n.nspname = 'public' AND t.typtype = 'e')
         + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public')
         AS total`);
  return Number(rows[0]?.total ?? 0) === 0;
}

// Compara o banco com os arquivos e devolve o que falta, recusando estados inconsistentes.
async function planejar(cliente: Cliente, migracoes: ArquivoSql[]) {
  // Os arquivos SQL têm acentos e símbolos UTF-8. No Windows, o banco criado sem
  // "-E UTF8 -T template0" costuma vir em WIN1252 e falharia no meio da instalação.
  const { rows: codificacao } = await cliente.query<{ server_encoding: string }>('SHOW server_encoding');
  if (codificacao[0]?.server_encoding !== 'UTF8') {
    throw new ErroMigracao(
      `O banco usa a codificação ${codificacao[0]?.server_encoding}, mas o EcoRecife exige UTF8. ` +
        'Recrie-o com: createdb -U postgres -E UTF8 -T template0 ecorecife',
    );
  }
  const registradas = await versoesRegistradas(cliente);
  if (registradas === null && !(await esquemaPublicoVazio(cliente))) {
    throw new ErroMigracao(
      'O banco já tem tabelas/tipos/funções, mas não tem schema_migrations. ' +
        'Por segurança nada foi alterado: use um banco vazio (veja docs/03-banco-de-dados.md, seção 4).',
    );
  }
  const jaAplicadas = [...(registradas ?? [])].sort();
  const conhecidas = new Set(migracoes.map((m) => m.versao));
  const desconhecidas = jaAplicadas.filter((versao) => !conhecidas.has(versao));
  if (desconhecidas.length > 0) {
    throw new ErroMigracao(
      `O banco tem migrações que não existem nesta cópia do projeto: ${desconhecidas.join(', ')}. ` +
        'Atualize o repositório antes de continuar.',
    );
  }
  const pendentes = migracoes.filter((m) => !registradas?.has(m.versao));
  const ultima = jaAplicadas.at(-1);
  const foraDeOrdem = ultima ? pendentes.filter((m) => m.versao < ultima) : [];
  if (foraDeOrdem.length > 0) {
    throw new ErroMigracao(
      `Migrações pendentes anteriores à última aplicada (${ultima}): ${foraDeOrdem.map((m) => m.versao).join(', ')}. ` +
        'Crie uma migração nova com número maior em vez de inserir no meio.',
    );
  }
  return { jaAplicadas, pendentes };
}

export async function migrar(
  pool: Pool,
  opcoes: { pasta?: string; apenasVerificar?: boolean; log?: (mensagem: string) => void } = {},
): Promise<ResultadoMigracao> {
  const { pasta = PASTA_MIGRACOES, apenasVerificar = false, log = () => {} } = opcoes;
  const migracoes = await lerArquivos(pasta, true);
  return comTrava(pool, async (cliente) => {
    const { jaAplicadas, pendentes } = await planejar(cliente, migracoes);
    const aplicadasAgora: string[] = [];
    if (!apenasVerificar) {
      for (const migracao of pendentes) {
        log(`aplicando ${migracao.arquivo}...`);
        await executarArquivo(cliente, migracao, 'na migração');
        const registro = await cliente.query('SELECT 1 FROM schema_migrations WHERE versao = $1', [migracao.versao]);
        if (registro.rowCount === 0) {
          throw new ErroMigracao(`${migracao.arquivo} foi executada, mas não se registrou em schema_migrations.`);
        }
        aplicadasAgora.push(migracao.versao);
      }
    }
    return { jaAplicadas, pendentes: pendentes.map((m) => m.versao), aplicadasAgora };
  });
}

// Carrega os dados demonstrativos. Só roda com todas as migrações aplicadas e com o
// banco ainda sem dados (tabela bairros vazia), para nunca duplicar nem misturar registros.
export async function semear(
  pool: Pool,
  opcoes: { pastaMigracoes?: string; pastaSeeds?: string; log?: (mensagem: string) => void } = {},
): Promise<string[]> {
  const { pastaMigracoes = PASTA_MIGRACOES, pastaSeeds = PASTA_SEEDS, log = () => {} } = opcoes;
  const migracoes = await lerArquivos(pastaMigracoes, true);
  const seeds = await lerArquivos(pastaSeeds, false);
  return comTrava(pool, async (cliente) => {
    const { pendentes } = await planejar(cliente, migracoes);
    if (pendentes.length > 0) {
      throw new ErroMigracao(`Há migrações pendentes (${pendentes.map((m) => m.versao).join(', ')}). Rode pnpm db:migrar antes.`);
    }
    const { rows } = await cliente.query<{ tem: boolean }>('SELECT EXISTS (SELECT 1 FROM bairros) AS tem');
    if (rows[0]?.tem) {
      throw new ErroMigracao('O banco já tem dados (tabela bairros não está vazia). Os seeds não foram aplicados.');
    }
    for (const seed of seeds) {
      log(`aplicando ${seed.arquivo}...`);
      await executarArquivo(cliente, seed, 'no seed');
    }
    return seeds.map((s) => s.versao);
  });
}
