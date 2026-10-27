// Testes com um PostgreSQL de verdade. Só rodam se TEST_DATABASE_URL estiver definida
// (ambiente ou server/.env). Cada cenário cria um banco temporário e o apaga no final;
// o banco de DATABASE_URL nunca é usado aqui.
import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import { migrar, PASTA_MIGRACOES, semear } from '../src/banco/migrador.js';
import { carregarArquivoEnv } from '../src/config.js';
import { criarPool } from '../src/db.js';
import { criarAdministrador, ErroDadosAdmin } from '../src/usuarios/administrador.js';

carregarArquivoEnv();
const URL_ADMIN = process.env.TEST_DATABASE_URL;

// Mesmo comando do guia (createdb -E UTF8 -T template0); o nome é gerado aqui, só [a-z0-9_].
async function criarBancoTemporario(codificacao = 'UTF8') {
  const nome = `ecorecife_teste_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: URL_ADMIN });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${nome} ENCODING '${codificacao}' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
  await admin.end();
  const url = new URL(URL_ADMIN!);
  url.pathname = `/${nome}`;
  const pool = criarPool(url.toString());
  return {
    pool,
    async apagar() {
      await pool.end();
      const cliente = new pg.Client({ connectionString: URL_ADMIN });
      await cliente.connect();
      await cliente.query(`DROP DATABASE IF EXISTS ${nome} WITH (FORCE)`);
      await cliente.end();
    },
  };
}

describe.skipIf(!URL_ADMIN)('integração com PostgreSQL', { timeout: 60_000 }, () => {
  describe('banco novo: migrações, seed, saúde e administrador', () => {
    let banco: Awaited<ReturnType<typeof criarBancoTemporario>>;
    beforeAll(async () => {
      banco = await criarBancoTemporario();
    });
    afterAll(() => banco?.apagar());

    it('status em banco vazio lista as 3 migrações como pendentes e não altera nada', async () => {
      const r = await migrar(banco.pool, { apenasVerificar: true });
      expect(r).toEqual({
        jaAplicadas: [],
        pendentes: ['001_tipos_e_funcoes', '002_tabelas', '003_indices_e_gatilhos'],
        aplicadasAgora: [],
      });
      const { rows } = await banco.pool.query("SELECT to_regclass('schema_migrations') AS t");
      expect(rows[0].t).toBeNull();
    });

    it('aplica as 3 migrações e a segunda execução não faz nada', async () => {
      const primeira = await migrar(banco.pool);
      expect(primeira.aplicadasAgora).toEqual(['001_tipos_e_funcoes', '002_tabelas', '003_indices_e_gatilhos']);
      const segunda = await migrar(banco.pool);
      expect(segunda.aplicadasAgora).toEqual([]);
      expect(segunda.jaAplicadas).toHaveLength(3);
    });

    it('o seed carrega os dados demonstrativos e recusa uma segunda carga', async () => {
      expect(await semear(banco.pool)).toEqual(['001_dados_demonstrativos']);
      const { rows } = await banco.pool.query(
        'SELECT count(*)::int AS total, bool_and(demonstrativo) AS todos FROM pontos_descarte',
      );
      expect(rows[0].total).toBeGreaterThan(0);
      expect(rows[0].todos).toBe(true);
      const antes = (await banco.pool.query('SELECT count(*)::int AS n FROM bairros')).rows[0].n;
      await expect(semear(banco.pool)).rejects.toThrow(/já tem dados/);
      expect((await banco.pool.query('SELECT count(*)::int AS n FROM bairros')).rows[0].n).toBe(antes);
    });

    it('/api/saude responde 200 com o banco real', async () => {
      const resposta = await request(criarApp({ origensCors: [] }, banco.pool)).get('/api/saude');
      expect(resposta.status).toBe(200);
      expect(resposta.body.banco).toBe('conectado');
    });

    it('cria administrador com hash bcrypt e recusa e-mail repetido com outra caixa', async () => {
      const senha = 'frase longa de teste 2026';
      await criarAdministrador(banco.pool, { nome: 'Admin Teste', email: 'admin@teste.example', senha }, 4);
      const { rows } = await banco.pool.query("SELECT perfil, senha_hash FROM usuarios WHERE email = 'admin@teste.example'");
      expect(rows[0].perfil).toBe('admin');
      expect(rows[0].senha_hash).toMatch(/^\$2[aby]\$04\$/);
      await expect(
        criarAdministrador(banco.pool, { nome: 'Outro', email: 'ADMIN@teste.example', senha }, 4),
      ).rejects.toThrow(ErroDadosAdmin);
    });
  });

  it('recusa banco que não é UTF8 antes de alterar qualquer coisa', async () => {
    const latin = await criarBancoTemporario('LATIN1');
    try {
      await expect(migrar(latin.pool)).rejects.toThrow(/exige UTF8/);
      const { rows } = await latin.pool.query("SELECT to_regclass('schema_migrations') AS t");
      expect(rows[0].t).toBeNull();
    } finally {
      await latin.apagar();
    }
  });

  describe('falhas e estados inseguros', () => {
    let banco: Awaited<ReturnType<typeof criarBancoTemporario>>;
    let pasta: string;
    beforeAll(async () => {
      banco = await criarBancoTemporario();
      pasta = await mkdtemp(path.join(tmpdir(), 'eco-mig-'));
      await cp(PASTA_MIGRACOES, pasta, { recursive: true });
    });
    afterAll(async () => {
      await banco?.apagar();
      await rm(pasta, { recursive: true, force: true });
    });

    it('recusa banco com objetos mas sem schema_migrations, sem alterar nada', async () => {
      await banco.pool.query('CREATE TABLE tabela_existente (id int)');
      await expect(migrar(banco.pool)).rejects.toThrow(/não tem schema_migrations/);
      await banco.pool.query('DROP TABLE tabela_existente');
    });

    it('migração com erro é desfeita por inteiro e as anteriores continuam aplicadas', async () => {
      await writeFile(
        path.join(pasta, '004_quebrada.sql'),
        "BEGIN;\nCREATE TABLE parcial (id int);\nSELECT coluna_inexistente FROM parcial;\n" +
          "INSERT INTO schema_migrations (versao) VALUES ('004_quebrada');\nCOMMIT;\n",
      );
      await expect(migrar(banco.pool, { pasta })).rejects.toThrow(/004_quebrada.*Nada deste arquivo foi gravado/);
      const { rows } = await banco.pool.query(
        "SELECT to_regclass('parcial') AS parcial, array_agg(versao ORDER BY versao) AS versoes FROM schema_migrations",
      );
      expect(rows[0].parcial).toBeNull();
      expect(rows[0].versoes).toEqual(['001_tipos_e_funcoes', '002_tabelas', '003_indices_e_gatilhos']);
      // A conexão devolvida ao pool continua utilizável depois do ROLLBACK.
      expect((await banco.pool.query('SELECT 1 AS ok')).rows[0].ok).toBe(1);
      await rm(path.join(pasta, '004_quebrada.sql'));
    });

    it('recusa versão registrada no banco que não existe nos arquivos', async () => {
      await banco.pool.query("INSERT INTO schema_migrations (versao) VALUES ('999_futura')");
      await expect(migrar(banco.pool, { pasta })).rejects.toThrow(/999_futura/);
      await banco.pool.query("DELETE FROM schema_migrations WHERE versao = '999_futura'");
    });

    it('recusa execução simultânea (trava consultiva)', async () => {
      const outro = await banco.pool.connect();
      try {
        await outro.query('SELECT pg_advisory_lock(4242026)');
        await expect(migrar(banco.pool, { pasta })).rejects.toThrow(/em andamento/);
      } finally {
        await outro.query('SELECT pg_advisory_unlock(4242026)');
        outro.release();
      }
    });
  });
});
