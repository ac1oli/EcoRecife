// Autenticação com um PostgreSQL de verdade, num banco temporário (veja test/apoio).
// Só roda se TEST_DATABASE_URL estiver definida.
import { tmpdir } from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import { exigirPerfil, exigirSessao } from '../src/auth/middlewares.js';
import { hashToken } from '../src/auth/sessoes.js';
import { migrar } from '../src/banco/migrador.js';
import { tratarErros } from '../src/erros.js';
import { criarAdministrador } from '../src/usuarios/administrador.js';
import { criarBancoTemporario, URL_ADMIN } from './apoio/banco-temporario.js';

// Estes testes não enviam fotos; a pasta existe só para completar a configuração.
const SEM_UPLOAD = path.join(tmpdir(), 'ecorecife-testes-sem-upload');

const SENHA = 'frase longa de teste 2026';
const config = { origensCors: ['http://localhost:5173'], ambiente: 'test' as const, sessaoHoras: 8, pastaUploads: SEM_UPLOAD };

function cookieDe(resposta: request.Response): string {
  const cabecalho = ([] as string[]).concat(resposta.headers['set-cookie'] ?? [])[0];
  if (!cabecalho) throw new Error('resposta sem Set-Cookie');
  return cabecalho.split(';')[0]!;
}

describe.skipIf(!URL_ADMIN)('integração: autenticação e sessões', { timeout: 60_000 }, () => {
  let banco: Awaited<ReturnType<typeof criarBancoTemporario>>;
  let app: express.Express;
  let protegido: express.Express;

  async function logar(email: string) {
    const resposta = await request(app).post('/api/auth/login').send({ email, senha: SENHA });
    expect(resposta.status).toBe(200);
    return cookieDe(resposta);
  }

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    await migrar(banco.pool);
    await criarAdministrador(banco.pool, { nome: 'Admin Teste', email: 'admin@teste.example', senha: SENHA }, 4);
    await banco.pool.query(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES ('Gestora Teste', 'gestora@teste.example', $1, 'gestor')`,
      [bcrypt.hashSync(SENHA, 4)],
    );
    app = criarApp(config, banco.pool);
    protegido = express();
    protegido.get('/so-admin', exigirSessao(banco.pool, 'test'), exigirPerfil('admin'), (_req, res) => {
      res.json({ ok: true });
    });
    protegido.use(tratarErros);
  });
  afterAll(() => banco?.apagar());

  it('login cria a sessão com o hash do token, prazo de 8 h e atualiza ultimo_login_em', async () => {
    const cookie = await logar('ADMIN@teste.example');
    const token = cookie.split('=')[1]!;
    const { rows } = await banco.pool.query(
      `SELECT s.token_hash, extract(epoch FROM s.expira_em - s.criado_em)::int AS segundos, u.ultimo_login_em
         FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE u.email = 'admin@teste.example'`,
    );
    expect(rows).toHaveLength(1);
    expect(Buffer.compare(rows[0].token_hash, hashToken(token))).toBe(0);
    expect(rows[0].segundos).toBe(8 * 3600);
    expect(rows[0].ultimo_login_em).not.toBeNull();
    const vazamento = await banco.pool.query("SELECT 1 FROM sessoes WHERE encode(token_hash, 'escape') LIKE $1", [
      `%${token}%`,
    ]);
    expect(vazamento.rowCount).toBe(0);
  });

  it('/eu devolve o usuário e a rota de admin libera admin e barra gestor (403)', async () => {
    const admin = await logar('admin@teste.example');
    const gestora = await logar('gestora@teste.example');
    const eu = await request(app).get('/api/auth/eu').set('Cookie', gestora);
    expect(eu.status).toBe(200);
    expect(eu.body.usuario).toMatchObject({ email: 'gestora@teste.example', perfil: 'gestor' });
    expect((await request(protegido).get('/so-admin').set('Cookie', admin)).status).toBe(200);
    expect((await request(protegido).get('/so-admin').set('Cookie', gestora)).status).toBe(403);
    expect((await request(protegido).get('/so-admin')).status).toBe(401);
  });

  it('sessão expirada responde 401 e é removida no próximo login', async () => {
    const cookie = await logar('gestora@teste.example');
    const hash = hashToken(cookie.split('=')[1]!);
    await banco.pool.query(
      `UPDATE sessoes SET criado_em = now() - interval '9 hours', expira_em = now() - interval '1 hour'
        WHERE token_hash = $1`,
      [hash],
    );
    expect((await request(app).get('/api/auth/eu').set('Cookie', cookie)).status).toBe(401);
    await logar('admin@teste.example');
    const { rowCount } = await banco.pool.query('SELECT 1 FROM sessoes WHERE token_hash = $1', [hash]);
    expect(rowCount).toBe(0);
  });

  it('usuário desativado perde a sessão e não consegue logar', async () => {
    const cookie = await logar('gestora@teste.example');
    await banco.pool.query("UPDATE usuarios SET ativo = false WHERE email = 'gestora@teste.example'");
    try {
      expect((await request(app).get('/api/auth/eu').set('Cookie', cookie)).status).toBe(401);
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: 'gestora@teste.example', senha: SENHA });
      expect(login.status).toBe(401);
    } finally {
      await banco.pool.query("UPDATE usuarios SET ativo = true WHERE email = 'gestora@teste.example'");
    }
  });

  it('logout apaga a sessão no banco e o cookie antigo deixa de valer', async () => {
    const cookie = await logar('admin@teste.example');
    const hash = hashToken(cookie.split('=')[1]!);
    expect((await request(app).post('/api/auth/logout').set('Cookie', cookie)).status).toBe(204);
    expect((await banco.pool.query('SELECT 1 FROM sessoes WHERE token_hash = $1', [hash])).rowCount).toBe(0);
    expect((await request(app).get('/api/auth/eu').set('Cookie', cookie)).status).toBe(401);
  });

  it('as restrições da tabela recusam hash de tamanho errado e prazo inválido', async () => {
    const { rows } = await banco.pool.query("SELECT id FROM usuarios WHERE email = 'admin@teste.example'");
    const id = rows[0].id;
    await expect(
      banco.pool.query("INSERT INTO sessoes (usuario_id, token_hash, expira_em) VALUES ($1, 'curto', now() + interval '1 hour')", [id]),
    ).rejects.toThrow(/check/i);
    await expect(
      banco.pool.query('INSERT INTO sessoes (usuario_id, token_hash, expira_em) VALUES ($1, $2, now())', [
        id,
        hashToken('x'),
      ]),
    ).rejects.toThrow(/sessoes_expiracao_valida/);
  });

  it('apagar o usuário apaga as sessões dele (ON DELETE CASCADE)', async () => {
    await banco.pool.query(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES ('Temporário', 'temp@teste.example', $1, 'gestor')`,
      [bcrypt.hashSync(SENHA, 4)],
    );
    await logar('temp@teste.example');
    await banco.pool.query("DELETE FROM usuarios WHERE email = 'temp@teste.example'");
    const { rowCount } = await banco.pool.query(
      'SELECT 1 FROM sessoes s LEFT JOIN usuarios u ON u.id = s.usuario_id WHERE u.id IS NULL',
    );
    expect(rowCount).toBe(0);
  });
});
