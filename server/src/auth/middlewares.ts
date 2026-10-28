// Proteção dos endpoints da gestão. Uso: router.get('/x', exigirSessao(...), exigirPerfil('admin'), handler).
// Esconder uma tela no front não basta: cada endpoint protegido precisa destes middlewares.
import type { RequestHandler } from 'express';
import type { Config } from '../config.js';
import type { Banco } from '../db.js';
import { ErroHttp } from '../erros.js';
import { lerCookie, nomeCookie, opcoesCookie } from './cookies.js';
import { buscarSessao, type Perfil, type UsuarioSessao } from './sessoes.js';

// Usuário da sessão disponível em res.locals.usuario depois de exigirSessao.
declare global {
  namespace Express {
    interface Locals {
      usuario?: UsuarioSessao;
    }
  }
}

// 401 sem sessão válida (ausente, adulterada, expirada, encerrada ou de usuário inativo).
export function exigirSessao(banco: Pick<Banco, 'query'>, ambiente: Config['ambiente']): RequestHandler {
  const nome = nomeCookie(ambiente);
  return async (req, res, next) => {
    const token = lerCookie(req.get('cookie'), nome);
    const usuario = await buscarSessao(banco, token);
    if (!usuario) {
      // Remove do navegador um cookie que não vale mais.
      if (token !== undefined) res.clearCookie(nome, opcoesCookie(ambiente));
      throw new ErroHttp(401, 'Sessão inválida ou expirada. Faça login novamente.');
    }
    res.locals.usuario = usuario;
    next();
  };
}

// 403 quando o perfil do usuário logado não está entre os permitidos.
export function exigirPerfil(...perfis: Perfil[]): RequestHandler {
  return (_req, res, next) => {
    const usuario = res.locals.usuario;
    if (!usuario) return next(new ErroHttp(401, 'Sessão inválida ou expirada. Faça login novamente.'));
    next(perfis.includes(usuario.perfil) ? undefined : new ErroHttp(403, 'Seu perfil não tem acesso a este recurso'));
  };
}
