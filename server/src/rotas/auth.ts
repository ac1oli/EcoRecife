// /api/auth: login, usuário logado e logout da gestão.
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { lerCookie, nomeCookie, opcoesCookie } from '../auth/cookies.js';
import { exigirSessao } from '../auth/middlewares.js';
import { criarSessao, encerrarSessao, removerSessoesExpiradas, type Perfil } from '../auth/sessoes.js';
import type { Config } from '../config.js';
import type { Banco } from '../db.js';
import { ErroHttp } from '../erros.js';
import { LIMITE_FALHAS, limitarFalhas } from '../limite.js';
import { CUSTO_BCRYPT } from '../usuarios/administrador.js';

// Tentativas de login malsucedidas por IP numa janela de 15 minutos. Logins certos não contam.
export const LIMITE_LOGIN = LIMITE_FALHAS;

const MENSAGEM_LOGIN_RECUSADO = 'E-mail ou senha inválidos';

const esquemaLogin = z.object({
  email: z.string().trim().toLowerCase().min(1).max(254),
  senha: z.string().min(1).max(200),
});

// Hash de uma senha aleatória, usado quando o e-mail não existe: o bcrypt roda do mesmo
// jeito e o tempo de resposta não revela quais e-mails estão cadastrados.
let hashFicticio: Promise<string> | undefined;
function obterHashFicticio(): Promise<string> {
  hashFicticio ??= bcrypt.hash(randomBytes(16).toString('hex'), CUSTO_BCRYPT);
  return hashFicticio;
}

type UsuarioLogin = { id: string; nome: string; email: string; perfil: Perfil; ativo: boolean; senha_hash: string };

export function rotasAuth(banco: Pick<Banco, 'query'>, config: Pick<Config, 'ambiente' | 'sessaoHoras'>): Router {
  const rotas = Router();
  const cookie = nomeCookie(config.ambiente);
  const opcoes = opcoesCookie(config.ambiente);

  // Contagem em memória, por instância da API: zera quando a API reinicia.
  const limitarLogin = limitarFalhas('Muitas tentativas de login. Tente novamente em alguns minutos.');

  rotas.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  rotas.post('/login', limitarLogin, async (req, res) => {
    const dados = esquemaLogin.safeParse(req.body);
    if (!dados.success) throw new ErroHttp(400, 'Informe e-mail e senha');
    const { email, senha } = dados.data;

    const { rows } = await banco.query<UsuarioLogin>(
      `SELECT id::text AS id, nome, email, perfil, ativo, senha_hash FROM usuarios WHERE lower(email) = $1`,
      [email],
    );
    const usuario = rows[0];
    const senhaConfere = await bcrypt.compare(senha, usuario?.senha_hash ?? (await obterHashFicticio()));
    // Mesma resposta para e-mail inexistente, senha errada e usuário inativo.
    if (!usuario || !senhaConfere || !usuario.ativo) throw new ErroHttp(401, MENSAGEM_LOGIN_RECUSADO);

    // Um login sempre gera sessão nova; a anterior deste navegador (se houver) deixa de valer.
    await encerrarSessao(banco, lerCookie(req.get('cookie'), cookie));
    await removerSessoesExpiradas(banco);
    const sessao = await criarSessao(banco, usuario.id, config.sessaoHoras);
    await banco.query('UPDATE usuarios SET ultimo_login_em = now() WHERE id = $1', [usuario.id]);

    res.cookie(cookie, sessao.token, { ...opcoes, maxAge: config.sessaoHoras * 60 * 60 * 1000 });
    res.json({
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil },
      expiraEm: sessao.expiraEm,
    });
  });

  rotas.get('/eu', exigirSessao(banco, config.ambiente), (_req, res) => {
    res.json({ usuario: res.locals.usuario });
  });

  // Idempotente: sem sessão válida, só limpa o cookie.
  rotas.post('/logout', async (req, res) => {
    await encerrarSessao(banco, lerCookie(req.get('cookie'), cookie));
    res.clearCookie(cookie, opcoes);
    res.status(204).end();
  });

  return rotas;
}
