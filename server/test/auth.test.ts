// Testes de autenticação, autorização e CSRF com um banco falso (sem PostgreSQL).
// O banco falso imita só as consultas usadas por src/auth e src/rotas/auth.ts.
import { tmpdir } from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { criarApp } from '../src/app.js';
import { lerCookie } from '../src/auth/cookies.js';
import { exigirPerfil, exigirSessao } from '../src/auth/middlewares.js';
import { hashToken } from '../src/auth/sessoes.js';
import { tratarErros } from '../src/erros.js';
import { LIMITE_LOGIN } from '../src/rotas/auth.js';

// Estes testes não enviam fotos; a pasta existe só para completar a configuração.
const SEM_UPLOAD = path.join(tmpdir(), 'ecorecife-testes-sem-upload');

const ORIGEM = 'http://localhost:5173';
const SENHA = 'frase longa de teste 2026';
const HASH = bcrypt.hashSync(SENHA, 4);

type UsuarioFalso = { id: string; nome: string; email: string; perfil: 'admin' | 'gestor'; ativo: boolean };

function criarBancoFalso() {
  const usuarios: UsuarioFalso[] = [
    { id: '1', nome: 'Admin', email: 'admin@teste.example', perfil: 'admin', ativo: true },
    { id: '2', nome: 'Gestora', email: 'gestora@teste.example', perfil: 'gestor', ativo: true },
  ];
  const sessoes = new Map<string, { usuarioId: string; expiraEm: Date }>();
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const texto = sql.replace(/\s+/g, ' ').trim();
    if (texto.includes('FROM usuarios WHERE lower(email) = $1')) {
      const rows = usuarios.filter((u) => u.email === params[0]).map((u) => ({ ...u, senha_hash: HASH }));
      return { rows, rowCount: rows.length };
    }
    if (texto.startsWith('INSERT INTO sessoes')) {
      const expiraEm = new Date(Date.now() + (params[2] as number) * 3_600_000);
      sessoes.set((params[1] as Buffer).toString('hex'), { usuarioId: params[0] as string, expiraEm });
      return { rows: [{ expira_em: expiraEm }], rowCount: 1 };
    }
    if (texto.startsWith('UPDATE sessoes')) {
      const sessao = sessoes.get((params[0] as Buffer).toString('hex'));
      const usuario = usuarios.find((u) => u.id === sessao?.usuarioId);
      const valida = sessao && sessao.expiraEm > new Date() && usuario?.ativo;
      const rows = valida ? [{ id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil }] : [];
      return { rows, rowCount: rows.length };
    }
    if (texto.startsWith('DELETE FROM sessoes WHERE token_hash')) {
      return { rows: [], rowCount: Number(sessoes.delete((params[0] as Buffer).toString('hex'))) };
    }
    if (texto.startsWith('DELETE FROM sessoes WHERE expira_em')) {
      for (const [chave, sessao] of sessoes) if (sessao.expiraEm <= new Date()) sessoes.delete(chave);
      return { rows: [], rowCount: 0 };
    }
    if (texto.startsWith('UPDATE usuarios SET ultimo_login_em')) return { rows: [], rowCount: 1 };
    throw new Error(`SQL inesperado no banco falso: ${texto}`);
  });
  return { query, usuarios, sessoes };
}

let banco: ReturnType<typeof criarBancoFalso>;
const config = { origensCors: [ORIGEM], ambiente: 'test' as const, sessaoHoras: 8, pastaUploads: SEM_UPLOAD };
const app = () => criarApp(config, banco as never);

beforeEach(() => {
  banco = criarBancoFalso();
});

// Devolve "nome=valor" do Set-Cookie da resposta, pronto para o cabeçalho Cookie.
function cookieDe(resposta: request.Response): string {
  const cabecalho = ([] as string[]).concat(resposta.headers['set-cookie'] ?? [])[0];
  if (!cabecalho) throw new Error('resposta sem Set-Cookie');
  return cabecalho.split(';')[0]!;
}

async function logar(alvo: express.Express, email = 'admin@teste.example') {
  const resposta = await request(alvo).post('/api/auth/login').send({ email, senha: SENHA });
  expect(resposta.status).toBe(200);
  return cookieDe(resposta);
}

describe('lerCookie', () => {
  it('lê o cookie pedido entre vários, sem espaços', () => {
    expect(lerCookie('a=1; eco_sessao=abc ;b=2', 'eco_sessao')).toBe('abc');
  });
  it('vale o primeiro quando o nome se repete', () => {
    expect(lerCookie('eco_sessao=primeiro; eco_sessao=segundo', 'eco_sessao')).toBe('primeiro');
  });
  it('não confunde nomes parecidos e ignora ausência ou codificação inválida', () => {
    expect(lerCookie('xeco_sessao=1', 'eco_sessao')).toBeUndefined();
    expect(lerCookie(undefined, 'eco_sessao')).toBeUndefined();
    expect(lerCookie('eco_sessao=%E0%A4%A', 'eco_sessao')).toBeUndefined();
  });
});

describe('POST /api/auth/login', () => {
  it('cria a sessão, devolve o usuário sem o hash e grava cookie httpOnly/Lax', async () => {
    const resposta = await request(app()).post('/api/auth/login').send({ email: ' ADMIN@teste.example ', senha: SENHA });
    expect(resposta.status).toBe(200);
    expect(resposta.body.usuario).toEqual({ id: '1', nome: 'Admin', email: 'admin@teste.example', perfil: 'admin' });
    expect(JSON.stringify(resposta.body)).not.toMatch(/senha|hash/);
    expect(resposta.headers['cache-control']).toBe('no-store');

    const setCookie = String(resposta.headers['set-cookie']);
    expect(setCookie).toMatch(/^eco_sessao=[A-Za-z0-9_-]{43};/);
    expect(setCookie).toMatch(/; HttpOnly/);
    expect(setCookie).toMatch(/; SameSite=Lax/);
    expect(setCookie).toMatch(/; Path=\//);
    expect(setCookie).toMatch(/; Max-Age=28800/);
    expect(setCookie).not.toMatch(/Secure/);

    expect(banco.query).toHaveBeenCalledWith(expect.stringContaining('ultimo_login_em'), ['1']);
  });

  it('guarda no banco só o SHA-256 do token, nunca o token', async () => {
    const token = cookieDe(await request(app()).post('/api/auth/login').send({ email: 'admin@teste.example', senha: SENHA })).split('=')[1]!;
    expect([...banco.sessoes.keys()]).toEqual([hashToken(token).toString('hex')]);
    const parametros = banco.query.mock.calls.flatMap(([, params]) => params ?? []);
    expect(parametros).not.toContain(token);
  });

  it('em produção usa Secure e o prefixo __Host-', async () => {
    const producao = criarApp({ ...config, ambiente: 'production' }, banco as never);
    const resposta = await request(producao).post('/api/auth/login').send({ email: 'admin@teste.example', senha: SENHA });
    const setCookie = String(resposta.headers['set-cookie']);
    expect(setCookie).toMatch(/^__Host-eco_sessao=/);
    expect(setCookie).toMatch(/; Secure/);
    expect(setCookie).not.toMatch(/Domain=/);
  });

  it.each([
    ['e-mail inexistente', { email: 'ninguem@teste.example', senha: SENHA }],
    ['senha errada', { email: 'admin@teste.example', senha: 'outra senha qualquer' }],
  ])('recusa %s com 401 e mensagem genérica, sem cookie', async (_caso, corpo) => {
    const resposta = await request(app()).post('/api/auth/login').send(corpo);
    expect(resposta.status).toBe(401);
    expect(resposta.body).toEqual({ erro: 'E-mail ou senha inválidos' });
    expect(resposta.headers['set-cookie']).toBeUndefined();
    expect(banco.sessoes.size).toBe(0);
  });

  it('recusa usuário inativo mesmo com a senha certa, com a mesma mensagem', async () => {
    banco.usuarios[0]!.ativo = false;
    const resposta = await request(app()).post('/api/auth/login').send({ email: 'admin@teste.example', senha: SENHA });
    expect(resposta.status).toBe(401);
    expect(resposta.body).toEqual({ erro: 'E-mail ou senha inválidos' });
    expect(banco.sessoes.size).toBe(0);
  });

  it.each([
    ['corpo vazio', {}],
    ['e-mail não textual', { email: 123, senha: SENHA }],
    ['senha vazia', { email: 'admin@teste.example', senha: '' }],
    ['senha longa demais', { email: 'admin@teste.example', senha: 'x'.repeat(201) }],
  ])('responde 400 para %s sem consultar o banco', async (_caso, corpo) => {
    const resposta = await request(app()).post('/api/auth/login').send(corpo);
    expect(resposta.status).toBe(400);
    expect(resposta.body).toEqual({ erro: 'Informe e-mail e senha' });
    expect(banco.query).not.toHaveBeenCalled();
  });

  it('um novo login no mesmo navegador invalida a sessão anterior', async () => {
    const alvo = app();
    const antigo = await logar(alvo);
    const resposta = await request(alvo)
      .post('/api/auth/login')
      .set('Cookie', antigo)
      .send({ email: 'admin@teste.example', senha: SENHA });
    const novo = cookieDe(resposta);
    expect(novo).not.toBe(antigo);
    expect((await request(alvo).get('/api/auth/eu').set('Cookie', antigo)).status).toBe(401);
    expect((await request(alvo).get('/api/auth/eu').set('Cookie', novo)).status).toBe(200);
    expect(banco.sessoes.size).toBe(1);
  });
});

describe('limite de tentativas de login', () => {
  it(`bloqueia com 429 depois de ${LIMITE_LOGIN} falhas, inclusive a senha certa`, async () => {
    const alvo = app();
    for (let i = 0; i < LIMITE_LOGIN; i++) {
      const falha = await request(alvo).post('/api/auth/login').send({ email: 'admin@teste.example', senha: 'senha errada aqui' });
      expect(falha.status).toBe(401);
    }
    const bloqueada = await request(alvo).post('/api/auth/login').send({ email: 'admin@teste.example', senha: SENHA });
    expect(bloqueada.status).toBe(429);
    expect(bloqueada.body).toEqual({ erro: 'Muitas tentativas de login. Tente novamente em alguns minutos.' });
    expect(bloqueada.headers['ratelimit-policy']).toBeDefined();
    expect(bloqueada.headers['set-cookie']).toBeUndefined();
  });

  it('logins certos não consomem o limite', async () => {
    const alvo = app();
    for (let i = 0; i < LIMITE_LOGIN + 2; i++) await logar(alvo);
    const falha = await request(alvo).post('/api/auth/login').send({ email: 'admin@teste.example', senha: 'senha errada aqui' });
    expect(falha.status).toBe(401);
  });

  it('cada instância da API tem o próprio contador (memória)', async () => {
    const primeira = app();
    for (let i = 0; i < LIMITE_LOGIN; i++) {
      await request(primeira).post('/api/auth/login').send({ email: 'admin@teste.example', senha: 'senha errada aqui' });
    }
    expect((await request(primeira).post('/api/auth/login').send({ email: 'admin@teste.example', senha: 'y' })).status).toBe(429);
    expect((await request(app()).post('/api/auth/login').send({ email: 'admin@teste.example', senha: 'y' })).status).toBe(401);
  });
});

describe('GET /api/auth/eu', () => {
  it('devolve o usuário da sessão', async () => {
    const alvo = app();
    const resposta = await request(alvo).get('/api/auth/eu').set('Cookie', await logar(alvo, 'gestora@teste.example'));
    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      usuario: { id: '2', nome: 'Gestora', email: 'gestora@teste.example', perfil: 'gestor' },
    });
    expect(resposta.headers['cache-control']).toBe('no-store');
  });

  it('responde 401 sem cookie, sem consultar o banco e sem mexer em cookies', async () => {
    const resposta = await request(app()).get('/api/auth/eu');
    expect(resposta.status).toBe(401);
    expect(resposta.body.erro).toMatch(/Sessão inválida/);
    expect(resposta.headers['set-cookie']).toBeUndefined();
    expect(banco.query).not.toHaveBeenCalled();
  });

  it('responde 401 para token adulterado sem consultar o banco e limpa o cookie', async () => {
    const resposta = await request(app()).get('/api/auth/eu').set('Cookie', "eco_sessao=' OR 1=1 --");
    expect(resposta.status).toBe(401);
    expect(banco.query).not.toHaveBeenCalled();
    expect(String(resposta.headers['set-cookie'])).toMatch(/^eco_sessao=; .*Expires=Thu, 01 Jan 1970/);
  });

  it('responde 401 para token bem formado mas desconhecido', async () => {
    const resposta = await request(app()).get('/api/auth/eu').set('Cookie', `eco_sessao=${'A'.repeat(43)}`);
    expect(resposta.status).toBe(401);
  });

  it('responde 401 quando a sessão expira', async () => {
    const alvo = app();
    const cookie = await logar(alvo);
    for (const sessao of banco.sessoes.values()) sessao.expiraEm = new Date(Date.now() - 1000);
    const resposta = await request(alvo).get('/api/auth/eu').set('Cookie', cookie);
    expect(resposta.status).toBe(401);
    expect(String(resposta.headers['set-cookie'])).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('responde 401 quando o usuário é desativado depois do login', async () => {
    const alvo = app();
    const cookie = await logar(alvo);
    banco.usuarios[0]!.ativo = false;
    expect((await request(alvo).get('/api/auth/eu').set('Cookie', cookie)).status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('apaga a sessão no servidor e limpa o cookie; o token antigo deixa de valer', async () => {
    const alvo = app();
    const cookie = await logar(alvo);
    const resposta = await request(alvo).post('/api/auth/logout').set('Cookie', cookie);
    expect(resposta.status).toBe(204);
    expect(String(resposta.headers['set-cookie'])).toMatch(/^eco_sessao=; .*Expires=Thu, 01 Jan 1970.*HttpOnly/);
    expect(banco.sessoes.size).toBe(0);
    expect((await request(alvo).get('/api/auth/eu').set('Cookie', cookie)).status).toBe(401);
  });

  it('sem sessão responde 204 e só limpa o cookie', async () => {
    const resposta = await request(app()).post('/api/auth/logout');
    expect(resposta.status).toBe(204);
    expect(banco.query).not.toHaveBeenCalled();
  });
});

describe('verificação de origem (CSRF)', () => {
  it('recusa login vindo de outra origem com 403, antes de consultar o banco', async () => {
    const resposta = await request(app())
      .post('/api/auth/login')
      .set('Origin', 'https://site-malicioso.example')
      .send({ email: 'admin@teste.example', senha: SENHA });
    expect(resposta.status).toBe(403);
    expect(resposta.body).toEqual({ erro: 'Origem da requisição não permitida' });
    expect(banco.query).not.toHaveBeenCalled();
  });

  it('aceita a origem configurada', async () => {
    const resposta = await request(app())
      .post('/api/auth/login')
      .set('Origin', ORIGEM)
      .send({ email: 'admin@teste.example', senha: SENHA });
    expect(resposta.status).toBe(200);
    expect(resposta.headers['access-control-allow-origin']).toBe(ORIGEM);
  });

  it('recusa logout de outra origem e a sessão continua válida', async () => {
    const alvo = app();
    const cookie = await logar(alvo);
    const resposta = await request(alvo).post('/api/auth/logout').set('Cookie', cookie).set('Origin', 'https://outro.example');
    expect(resposta.status).toBe(403);
    expect((await request(alvo).get('/api/auth/eu').set('Cookie', cookie)).status).toBe(200);
  });

  it.each([
    ['Origin "null"', { Origin: 'null' }],
    ['origem com porta diferente', { Origin: 'http://localhost:5174' }],
    ['sem Origin e Sec-Fetch-Site cross-site', { 'Sec-Fetch-Site': 'cross-site' }],
  ])('recusa %s', async (_caso, cabecalhos) => {
    const resposta = await request(app()).post('/api/auth/logout').set(cabecalhos);
    expect(resposta.status).toBe(403);
  });

  it('não bloqueia métodos de leitura (GET) vindos de outra origem', async () => {
    const resposta = await request(app()).get('/api/saude').set('Origin', 'https://outro.example');
    expect(resposta.status).not.toBe(403);
  });
});

describe('exigirPerfil', () => {
  // Rota de teste protegida só para admin, montada como as rotas da gestão serão.
  function appProtegido() {
    const alvo = criarApp(config, banco as never);
    const protegido = express();
    protegido.get('/admin', exigirSessao(banco as never, 'test'), exigirPerfil('admin'), (_req, res) => {
      res.json({ ok: true });
    });
    protegido.get('/sem-sessao', exigirPerfil('admin', 'gestor'), (_req, res) => {
      res.json({ ok: true });
    });
    protegido.use(tratarErros);
    return { alvo, protegido };
  }

  it('libera o perfil permitido', async () => {
    const { alvo, protegido } = appProtegido();
    const resposta = await request(protegido).get('/admin').set('Cookie', await logar(alvo));
    expect(resposta.status).toBe(200);
  });

  it('responde 403 para perfil sem permissão', async () => {
    const { alvo, protegido } = appProtegido();
    const resposta = await request(protegido).get('/admin').set('Cookie', await logar(alvo, 'gestora@teste.example'));
    expect(resposta.status).toBe(403);
    expect(resposta.body).toEqual({ erro: 'Seu perfil não tem acesso a este recurso' });
  });

  it('responde 401 sem sessão', async () => {
    const { protegido } = appProtegido();
    expect((await request(protegido).get('/admin')).status).toBe(401);
  });

  it('responde 401 se for usado sem exigirSessao antes', async () => {
    const { protegido } = appProtegido();
    expect((await request(protegido).get('/sem-sessao')).status).toBe(401);
  });
});
