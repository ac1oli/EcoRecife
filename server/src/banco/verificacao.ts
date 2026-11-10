// Verificação do banco (pnpm db:verificar): confere, só com leituras, se o banco está como o
// EcoRecife exige. Serve para o Supabase oficial e para os bancos de teste.
// - conexão (versão, TLS) e migrações aplicadas;
// - as 14 tabelas, todas com RLS e sem nenhuma policy;
// - nenhum privilégio para os papéis da Data API do Supabase (anon, authenticated, service_role);
// - funções com search_path fixo e sem EXECUTE para PUBLIC;
// - nenhum registro órfão e sequências à frente do maior id;
// - opcional: os 24 casos de database/queries/verificar_restricoes.sql (transação desfeita).
import { readFile } from 'node:fs/promises';
import { TLSSocket } from 'node:tls';
import path from 'node:path';
import type pg from 'pg';
import { lerArquivos, PASTA_DATABASE, PASTA_MIGRACOES } from './migrador.js';

export const TABELAS = [
  'bairros',
  'categorias_ocorrencia',
  'materiais',
  'ocorrencia_fotos',
  'ocorrencia_historico',
  'ocorrencias',
  'ponto_materiais',
  'pontos_descarte',
  'rota_pontos',
  'rotas',
  'schema_migrations',
  'sessoes',
  'usuarios',
  'veiculos',
] as const;
export const PAPEIS_DATA_API = ['anon', 'authenticated', 'service_role'] as const;

export type Item = { nome: string; ok: boolean; detalhe: string };
export type Relatorio = { itens: Item[]; ok: boolean; contagens: Record<string, number> };

type Pool = Pick<pg.Pool, 'connect'>;

export async function verificarBanco(
  pool: Pool,
  opcoes: { exigirTls?: boolean; restricoes?: boolean; pastaMigracoes?: string } = {},
): Promise<Relatorio> {
  const itens: Item[] = [];
  const item = (nome: string, ok: boolean, detalhe: string) => itens.push({ nome, ok, detalhe });
  const cliente = await pool.connect();
  const contagens: Record<string, number> = {};
  try {
    const q = async <T extends pg.QueryResultRow>(sql: string, params?: unknown[]) => (await cliente.query<T>(sql, params)).rows;
    await cliente.query('BEGIN TRANSACTION READ ONLY');

    const [servidor] = await q<{ versao: string; banco: string }>(
      `SELECT current_setting('server_version') AS versao, current_database() AS banco`,
    );
    // O TLS é conferido no socket desta conexão (até o pooler do Supabase): o pg_stat_ssl
    // do servidor só enxerga o trecho interno pooler → Postgres.
    const socket = (cliente as unknown as { connection?: { stream?: unknown } }).connection?.stream;
    const tls = socket instanceof TLSSocket && socket.authorized;
    item('conexão', !opcoes.exigirTls || tls,
      `PostgreSQL ${servidor?.versao}, banco ${servidor?.banco}, ` +
        (tls ? `TLS ${socket.getProtocol()} com certificado verificado` : 'sem TLS'));

    const arquivos = (await lerArquivos(opcoes.pastaMigracoes ?? PASTA_MIGRACOES, true)).map((a) => a.versao);
    const temControle = (await q<{ t: string | null }>(`SELECT to_regclass('public.schema_migrations')::text AS t`))[0]?.t;
    const aplicadas = temControle ? (await q<{ versao: string }>('SELECT versao FROM schema_migrations ORDER BY versao')).map((r) => r.versao) : [];
    const pendentes = arquivos.filter((v) => !aplicadas.includes(v));
    const desconhecidas = aplicadas.filter((v) => !arquivos.includes(v));
    item('migrações', pendentes.length === 0 && desconhecidas.length === 0,
      `aplicadas: ${aplicadas.join(', ') || 'nenhuma'}` +
        (pendentes.length ? ` · pendentes: ${pendentes.join(', ')}` : '') +
        (desconhecidas.length ? ` · fora do repositório: ${desconhecidas.join(', ')}` : ''));

    const tabelas = await q<{ tabela: string; rls: boolean }>(
      `SELECT c.relname AS tabela, c.relrowsecurity AS rls FROM pg_class c
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' ORDER BY 1`,
    );
    const nomes = tabelas.map((t) => t.tabela);
    const faltando = TABELAS.filter((t) => !nomes.includes(t));
    const extras = nomes.filter((t) => !(TABELAS as readonly string[]).includes(t));
    item('tabelas', faltando.length === 0 && extras.length === 0,
      `${nomes.length} no schema public` + (faltando.length ? ` · faltando: ${faltando.join(', ')}` : '') +
        (extras.length ? ` · não previstas: ${extras.join(', ')}` : ''));
    const semRls = tabelas.filter((t) => !t.rls).map((t) => t.tabela);
    item('RLS', semRls.length === 0, semRls.length ? `sem RLS: ${semRls.join(', ')}` : `ligada nas ${tabelas.length} tabelas`);
    const policies = await q<{ n: number }>(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public'`);
    item('policies', policies[0]?.n === 0, `${policies[0]?.n} policy(s) no schema public (esperado: nenhuma)`);

    const papeis = (await q<{ rolname: string }>(`SELECT rolname FROM pg_roles WHERE rolname = ANY($1)`, [PAPEIS_DATA_API])).map((r) => r.rolname);
    if (papeis.length === 0) {
      item('privilégios da Data API', true, 'papéis anon/authenticated/service_role não existem (PostgreSQL comum)');
    } else {
      const acessos = await q<{ papel: string; objeto: string }>(
        `SELECT p.papel, c.relname || ' (' || pr.privilegio || ')' AS objeto
           FROM unnest($1::text[]) AS p(papel)
           CROSS JOIN pg_class c
           CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS pr(privilegio)
          WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','v','m','p')
            AND has_table_privilege(p.papel, c.oid, pr.privilegio)
         UNION ALL
         SELECT p.papel, c.relname || ' (USAGE)' FROM unnest($1::text[]) AS p(papel)
           CROSS JOIN pg_class c
          WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S' AND has_sequence_privilege(p.papel, c.oid, 'USAGE')
         UNION ALL
         SELECT p.papel, f.proname || '() (EXECUTE)' FROM unnest($1::text[]) AS p(papel)
           CROSS JOIN pg_proc f
          WHERE f.pronamespace = 'public'::regnamespace AND has_function_privilege(p.papel, f.oid, 'EXECUTE')`,
        [papeis],
      );
      item('privilégios da Data API', acessos.length === 0,
        acessos.length ? `acessos indevidos: ${acessos.slice(0, 10).map((a) => `${a.papel} → ${a.objeto}`).join('; ')}`
          : `nenhum acesso para ${papeis.join(', ')} em tabelas, sequências e funções`);
    }

    const funcoes = await q<{ funcao: string; caminho: boolean; publico: boolean }>(
      `SELECT p.proname AS funcao,
              coalesce(array_to_string(p.proconfig, ',') LIKE '%search_path=%', false) AS caminho,
              has_function_privilege('public', p.oid, 'EXECUTE') AS publico
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace ORDER BY 1`,
    );
    const ruins = funcoes.filter((f) => !f.caminho || f.publico);
    item('funções', ruins.length === 0,
      ruins.length ? `ajustar: ${ruins.map((f) => `${f.funcao}${f.caminho ? '' : ' (sem search_path)'}${f.publico ? ' (EXECUTE para PUBLIC)' : ''}`).join(', ')}`
        : `${funcoes.map((f) => f.funcao).join(', ')} com search_path fixo e sem EXECUTE para PUBLIC`);

    const fks = await q<{ nome: string; filha: string; mae: string; cols: string[]; colsmae: string[] }>(
      `SELECT conname AS nome, conrelid::regclass::text AS filha, confrelid::regclass::text AS mae,
              (SELECT array_agg(attname::text ORDER BY o) FROM unnest(conkey) WITH ORDINALITY k(n, o)
                 JOIN pg_attribute a ON a.attrelid = conrelid AND a.attnum = k.n) AS cols,
              (SELECT array_agg(attname::text ORDER BY o) FROM unnest(confkey) WITH ORDINALITY k(n, o)
                 JOIN pg_attribute a ON a.attrelid = confrelid AND a.attnum = k.n) AS colsmae
         FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace ORDER BY 1`,
    );
    const orfaos: string[] = [];
    for (const fk of fks) {
      const igual = fk.cols.map((c, i) => `m.${quote(fk.colsmae[i]!)} = f.${quote(c)}`).join(' AND ');
      const naoNulo = fk.cols.map((c) => `f.${quote(c)} IS NOT NULL`).join(' AND ');
      const [r] = await q<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${fk.filha} f WHERE ${naoNulo} AND NOT EXISTS (SELECT 1 FROM ${fk.mae} m WHERE ${igual})`,
      );
      if (r!.n > 0) orfaos.push(`${fk.nome}: ${r!.n}`);
    }
    item('órfãos', orfaos.length === 0, orfaos.length ? orfaos.join(', ') : `nenhum nas ${fks.length} chaves estrangeiras`);

    const sequencias = await q<{ tabela: string; ultimo: string | null; chamado: boolean; maximo: string | null }>(
      `SELECT c.relname AS tabela, s.last_value::text AS ultimo, s.last_value IS NOT NULL AS chamado,
              (xpath('/row/m/text()', query_to_xml(format('SELECT max(%I) AS m FROM public.%I', a.attname, c.relname), false, true, '')))[1]::text AS maximo
         FROM pg_class c
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attidentity <> ''
         JOIN pg_sequences s ON s.schemaname = 'public'
              AND s.sequencename = split_part(pg_get_serial_sequence(format('public.%I', c.relname), a.attname), '.', 2)
        WHERE c.relnamespace = 'public'::regnamespace ORDER BY 1`,
    );
    const atrasadas = sequencias.filter((s) => s.maximo !== null && (s.ultimo === null || BigInt(s.ultimo) < BigInt(s.maximo)));
    item('sequências', atrasadas.length === 0,
      atrasadas.length ? `atrás do maior id: ${atrasadas.map((s) => `${s.tabela} (seq ${s.ultimo ?? 'nova'} < max ${s.maximo})`).join(', ')}`
        : `${sequencias.length} identidades à frente do maior id`);

    for (const tabela of TABELAS) {
      if (!nomes.includes(tabela)) continue;
      contagens[tabela] = (await q<{ n: number }>(`SELECT count(*)::int AS n FROM public.${quote(tabela)}`))[0]!.n;
    }
    await cliente.query('ROLLBACK');

    if (opcoes.restricoes) {
      item('restrições (24 casos)', ...(await verificarRestricoes(cliente)));
    }
  } finally {
    await cliente.query('ROLLBACK').catch(() => {});
    cliente.release();
  }
  return { itens, ok: itens.every((i) => i.ok), contagens };
}

function quote(identificador: string): string {
  return `"${identificador.replace(/"/g, '""')}"`;
}

// Roda database/queries/verificar_restricoes.sql sem o psql: o arquivo tenta gravar dados
// inválidos e desfaz tudo no fim (ROLLBACK). Só um id de ocorrência é consumido da sequência.
async function verificarRestricoes(cliente: Pick<pg.PoolClient, 'query'>): Promise<[boolean, string]> {
  const sql = (await readFile(path.join(PASTA_DATABASE, 'queries', 'verificar_restricoes.sql'), 'utf8'))
    .split(/\r?\n/)
    .filter((linha) => !/^\s*\\/.test(linha))
    .join('\n');
  try {
    const resultados = (await cliente.query(sql)) as unknown as pg.QueryResult[] | pg.QueryResult;
    const lista = Array.isArray(resultados) ? resultados : [resultados];
    const linhas = lista.flatMap((r) => (r.fields?.some((f) => f.name === 'resultado') ? (r.rows as { resultado: string }[]) : []));
    const ok = linhas.length > 0 && linhas.every((l) => l.resultado === 'OK');
    return [ok, `${linhas.filter((l) => l.resultado === 'OK').length}/${linhas.length} OK`];
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => {});
    return [false, (erro as Error).message];
  }
}
