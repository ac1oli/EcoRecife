// Backup e restauração dos DADOS em SQL puro, sem pg_dump nem psql (o plano Free do
// Supabase não oferece backups para baixar). O schema vem das migrações; o arquivo traz:
// - as versões de schema_migrations (a restauração exige as mesmas no banco de destino);
// - os dados de cada tabela, na ordem das chaves estrangeiras, como JSON lido por
//   jsonb_populate_recordset (tipos, datas com fuso e ids preservados);
// - o valor de cada sequência (setval), para os próximos ids não colidirem.
// Sessões de login não entram: depois de restaurar, cada um entra de novo.
// A restauração só roda num banco com as tabelas VAZIAS: nunca apaga nem sobrescreve nada.
import type pg from 'pg';
import { ErroMigracao } from './migrador.js';

// Ordem de carga: tabelas mães antes das filhas.
export const TABELAS_BACKUP = [
  'bairros',
  'categorias_ocorrencia',
  'materiais',
  'usuarios',
  'ocorrencias',
  'ocorrencia_fotos',
  'ocorrencia_historico',
  'pontos_descarte',
  'ponto_materiais',
  'veiculos',
  'rotas',
  'rota_pontos',
] as const;

const CABECALHO = '-- EcoRecife · backup de dados';
const PADRAO_MIGRACOES = /^-- migracoes: (.*)$/m;

type Pool = Pick<pg.Pool, 'connect'>;

export async function gerarBackup(pool: Pool, origem: string): Promise<{ sql: string; contagens: Record<string, number> }> {
  const cliente = await pool.connect();
  try {
    // Uma fotografia consistente do banco inteiro.
    await cliente.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const migracoes = (await cliente.query<{ versao: string }>('SELECT versao FROM schema_migrations ORDER BY versao')).rows.map((r) => r.versao);
    const partes: string[] = [
      CABECALHO,
      `-- origem: ${origem}`,
      `-- gerado em: ${new Date().toISOString()}`,
      `-- migracoes: ${migracoes.join(',')}`,
      '-- Restaurar: pnpm db:restaurar <este arquivo> (banco com as mesmas migrações e as tabelas vazias).',
      'BEGIN;',
    ];
    const contagens: Record<string, number> = {};
    for (const tabela of TABELAS_BACKUP) {
      const { rows } = await cliente.query<{ n: number; dados: unknown }>(
        `SELECT count(*)::int AS n, coalesce(jsonb_agg(to_jsonb(t) ORDER BY t), '[]'::jsonb) AS dados FROM public.${tabela} t`,
      );
      contagens[tabela] = rows[0]!.n;
      if (rows[0]!.n === 0) continue;
      const json = JSON.stringify(rows[0]!.dados);
      let marca = '$backup$';
      for (let i = 0; json.includes(marca); i++) marca = `$backup${i}$`;
      partes.push(
        `INSERT INTO public.${tabela} OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_recordset(NULL::public.${tabela}, ${marca}${json}${marca});`,
      );
    }
    const sequencias = await cliente.query<{ sequencia: string; valor: string | null }>(
      `SELECT format('%I.%I', schemaname, sequencename) AS sequencia, last_value::text AS valor
         FROM pg_sequences WHERE schemaname = 'public' AND sequencename <> 'sessoes_id_seq' ORDER BY 1`,
    );
    for (const { sequencia, valor } of sequencias.rows) {
      partes.push(`SELECT setval('${sequencia}', ${valor ?? 1}, ${valor !== null});`);
    }
    partes.push('COMMIT;', '');
    await cliente.query('ROLLBACK');
    return { sql: partes.join('\n'), contagens };
  } finally {
    await cliente.query('ROLLBACK').catch(() => {});
    cliente.release();
  }
}

export async function restaurarBackup(pool: Pool, sql: string): Promise<Record<string, number>> {
  if (!sql.startsWith(CABECALHO)) throw new ErroMigracao('O arquivo não é um backup do EcoRecife (pnpm db:backup).');
  const migracoesArquivo = PADRAO_MIGRACOES.exec(sql)?.[1]?.split(',') ?? [];
  const cliente = await pool.connect();
  try {
    const migracoes = (await cliente.query<{ versao: string }>('SELECT versao FROM schema_migrations ORDER BY versao')).rows.map((r) => r.versao);
    if (migracoes.join(',') !== migracoesArquivo.join(',')) {
      throw new ErroMigracao(
        `As migrações do banco (${migracoes.join(', ') || 'nenhuma'}) não são as do backup (${migracoesArquivo.join(', ')}). ` +
          'Rode pnpm db:migrar até a mesma versão antes de restaurar.',
      );
    }
    const ocupadas: string[] = [];
    for (const tabela of [...TABELAS_BACKUP, 'sessoes']) {
      const { rows } = await cliente.query<{ tem: boolean }>(`SELECT EXISTS (SELECT 1 FROM public.${tabela}) AS tem`);
      if (rows[0]!.tem) ocupadas.push(tabela);
    }
    if (ocupadas.length) {
      throw new ErroMigracao(`A restauração exige tabelas vazias; já têm dados: ${ocupadas.join(', ')}. Nada foi alterado.`);
    }
    try {
      await cliente.query(sql); // o próprio arquivo abre e fecha a transação
    } catch (erro) {
      await cliente.query('ROLLBACK').catch(() => {});
      throw new ErroMigracao(`A restauração falhou e foi desfeita (nada foi gravado): ${(erro as Error).message}`);
    }
    const contagens: Record<string, number> = {};
    for (const tabela of TABELAS_BACKUP) {
      contagens[tabela] = (await cliente.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.${tabela}`)).rows[0]!.n;
    }
    return contagens;
  } finally {
    cliente.release();
  }
}
