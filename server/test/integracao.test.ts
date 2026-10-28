// Testes com um PostgreSQL de verdade. Só rodam se TEST_DATABASE_URL estiver definida
// (ambiente ou server/.env). Cada cenário cria um banco temporário e o apaga no final;
// as travas contra bancos que não são de teste ficam em test/apoio/banco-temporario.ts.
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import { migrar, PASTA_MIGRACOES, semear } from '../src/banco/migrador.js';
import { criarAdministrador, ErroDadosAdmin } from '../src/usuarios/administrador.js';
import { criarBancoTemporario, URL_ADMIN } from './apoio/banco-temporario.js';

// Estes testes não enviam fotos; a pasta existe só para completar a configuração.
const SEM_UPLOAD = path.join(tmpdir(), 'ecorecife-testes-sem-upload');

const MIGRACOES = ['001_tipos_e_funcoes', '002_tabelas', '003_indices_e_gatilhos', '004_sessoes'];

describe.skipIf(!URL_ADMIN)('integração com PostgreSQL', { timeout: 60_000 }, () => {
  describe('banco novo: migrações, seed, saúde e administrador', () => {
    let banco: Awaited<ReturnType<typeof criarBancoTemporario>>;
    beforeAll(async () => {
      banco = await criarBancoTemporario();
    });
    afterAll(() => banco?.apagar());

    it('status em banco vazio lista as 4 migrações como pendentes e não altera nada', async () => {
      const r = await migrar(banco.pool, { apenasVerificar: true });
      expect(r).toEqual({
        jaAplicadas: [],
        pendentes: MIGRACOES,
        aplicadasAgora: [],
      });
      const { rows } = await banco.pool.query("SELECT to_regclass('schema_migrations') AS t");
      expect(rows[0].t).toBeNull();
    });

    it('aplica as 4 migrações e a segunda execução não faz nada', async () => {
      const primeira = await migrar(banco.pool);
      expect(primeira.aplicadasAgora).toEqual(MIGRACOES);
      const segunda = await migrar(banco.pool);
      expect(segunda.aplicadasAgora).toEqual([]);
      expect(segunda.jaAplicadas).toEqual(MIGRACOES);
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
      const app = criarApp({ origensCors: [], ambiente: 'test', sessaoHoras: 8, pastaUploads: SEM_UPLOAD }, banco.pool);
      const resposta = await request(app).get('/api/saude');
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
        path.join(pasta, '005_quebrada.sql'),
        "BEGIN;\nCREATE TABLE parcial (id int);\nSELECT coluna_inexistente FROM parcial;\n" +
          "INSERT INTO schema_migrations (versao) VALUES ('005_quebrada');\nCOMMIT;\n",
      );
      await expect(migrar(banco.pool, { pasta })).rejects.toThrow(/005_quebrada.*Nada deste arquivo foi gravado/);
      const { rows } = await banco.pool.query(
        "SELECT to_regclass('parcial') AS parcial, array_agg(versao ORDER BY versao) AS versoes FROM schema_migrations",
      );
      expect(rows[0].parcial).toBeNull();
      expect(rows[0].versoes).toEqual(MIGRACOES);
      // A conexão devolvida ao pool continua utilizável depois do ROLLBACK.
      expect((await banco.pool.query('SELECT 1 AS ok')).rows[0].ok).toBe(1);
      await rm(path.join(pasta, '005_quebrada.sql'));
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
