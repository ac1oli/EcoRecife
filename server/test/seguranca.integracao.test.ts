// Segurança do banco (migração 005 + pnpm db:verificar) num PostgreSQL descartável que imita
// o Supabase: os papéis anon, authenticated e service_role existem e recebem, como no
// Supabase, privilégios padrão em tudo o que for criado no schema public. Depois das
// migrações, nenhum deles pode ler ou gravar nada.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar, semear } from '../src/banco/migrador.js';
import { PAPEIS_DATA_API, verificarBanco } from '../src/banco/verificacao.js';
import { criarBancoTemporario, URL_ADMIN } from './apoio/banco-temporario.js';

describe.skipIf(!URL_ADMIN)('integração: segurança do banco (Data API do Supabase)', { timeout: 60_000 }, () => {
  let banco: Awaited<ReturnType<typeof criarBancoTemporario>>;
  const papeisCriados: string[] = [];

  const comAdmin = async (sql: string) => {
    const c = new pg.Client({ connectionString: URL_ADMIN });
    await c.connect();
    try {
      return await c.query(sql);
    } finally {
      await c.end();
    }
  };

  beforeAll(async () => {
    // Papéis globais do cluster de teste: criados só se não existirem e removidos no fim.
    for (const papel of PAPEIS_DATA_API) {
      const { rowCount } = await comAdmin(`SELECT 1 FROM pg_roles WHERE rolname = '${papel}'`);
      if (!rowCount) {
        await comAdmin(`CREATE ROLE ${papel} NOLOGIN`);
        papeisCriados.push(papel);
      }
    }
    banco = await criarBancoTemporario();
    // Como o Supabase faz: acesso ao schema e privilégios padrão em tudo o que for criado.
    await banco.pool.query(`GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role`);
    for (const tipo of ['TABLES', 'SEQUENCES', 'FUNCTIONS']) {
      await banco.pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ${tipo} TO anon, authenticated, service_role`);
    }
    await migrar(banco.pool);
    await semear(banco.pool);
  });

  afterAll(async () => {
    await banco?.apagar();
    for (const papel of papeisCriados) await comAdmin(`DROP ROLE IF EXISTS ${papel}`);
  });

  it('db:verificar passa: RLS sem policies, nenhum privilégio da Data API, funções seguras, sem órfãos', async () => {
    const relatorio = await verificarBanco(banco.pool, { restricoes: true });
    const falhas = relatorio.itens.filter((i) => !i.ok);
    expect(falhas).toEqual([]);
    expect(relatorio.itens.map((i) => i.nome)).toEqual([
      'conexão',
      'migrações',
      'tabelas',
      'RLS',
      'policies',
      'privilégios da Data API',
      'funções',
      'órfãos',
      'sequências',
      'restrições (24 casos)',
    ]);
    expect(relatorio.itens.at(-1)!.detalhe).toBe('24/24 OK');
    expect(relatorio.contagens).toMatchObject({ veiculos: 7, rotas: 7, rota_pontos: 1178, usuarios: 0, sessoes: 0 });
  });

  it.each(PAPEIS_DATA_API)('o papel %s não lê nem grava nada (usuários, sessões, ocorrências)', async (papel) => {
    const c = await banco.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SET LOCAL ROLE ${papel}`);
      for (const sql of [
        'SELECT senha_hash FROM usuarios',
        'SELECT token_hash FROM sessoes',
        'SELECT * FROM ocorrencias',
        `INSERT INTO bairros (nome, latitude, longitude) VALUES ('X', 0, 0)`,
        'SELECT gerar_protocolo()',
      ]) {
        await c.query('SAVEPOINT s');
        await expect(c.query(sql)).rejects.toMatchObject({ code: '42501' }); // permission denied
        await c.query('ROLLBACK TO SAVEPOINT s');
      }
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });

  it('uma tabela criada depois (próxima migração) também nasce sem privilégios para a Data API', async () => {
    await banco.pool.query('CREATE TABLE tabela_futura (id int)');
    try {
      const { rows } = await banco.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM unnest(ARRAY['anon','authenticated','service_role']) p
          WHERE has_table_privilege(p, 'tabela_futura', 'SELECT')`,
      );
      expect(rows[0]!.n).toBe(0);
    } finally {
      await banco.pool.query('DROP TABLE tabela_futura');
    }
  });

  it.each([
    ['privilégio concedido a anon', 'GRANT SELECT ON usuarios TO anon', 'REVOKE SELECT ON usuarios FROM anon', 'privilégios da Data API'],
    ['RLS desligada', 'ALTER TABLE sessoes DISABLE ROW LEVEL SECURITY', 'ALTER TABLE sessoes ENABLE ROW LEVEL SECURITY', 'RLS'],
    ['policy permissiva', 'CREATE POLICY todos ON pontos_descarte FOR SELECT USING (true)', 'DROP POLICY todos ON pontos_descarte', 'policies'],
    ['função executável por PUBLIC', 'GRANT EXECUTE ON FUNCTION gerar_protocolo() TO PUBLIC', 'REVOKE EXECUTE ON FUNCTION gerar_protocolo() FROM PUBLIC', 'privilégios da Data API,funções'],
    ['sequência atrás do maior id', `SELECT setval(pg_get_serial_sequence('bairros', 'id'), 1)`, `SELECT setval(pg_get_serial_sequence('bairros', 'id'), (SELECT max(id) FROM bairros))`, 'sequências'],
  ])('db:verificar acusa %s', async (_caso, estragar, consertar, itemEsperado) => {
    await banco.pool.query(estragar);
    try {
      const relatorio = await verificarBanco(banco.pool);
      expect(relatorio.ok).toBe(false);
      // PUBLIC inclui os papéis da Data API: a função liberada aparece nos dois itens.
      expect(relatorio.itens.filter((i) => !i.ok).map((i) => i.nome)).toEqual(itemEsperado.split(','));
    } finally {
      await banco.pool.query(consertar);
    }
    expect((await verificarBanco(banco.pool)).ok).toBe(true);
  });

  it('exigirTls acusa conexão sem TLS (o banco de teste é local)', async () => {
    const relatorio = await verificarBanco(banco.pool, { exigirTls: true });
    expect(relatorio.itens.find((i) => i.nome === 'conexão')).toMatchObject({ ok: false });
  });
});
