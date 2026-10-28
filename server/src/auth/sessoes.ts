// Sessões de login guardadas no banco (tabela sessoes, migração 004).
// O navegador recebe um token aleatório; o banco guarda só o SHA-256 dele.
import { createHash, randomBytes } from 'node:crypto';
import type { Banco } from '../db.js';

export type Perfil = 'admin' | 'gestor';

export type UsuarioSessao = {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
};

// 32 bytes em base64url sem preenchimento = 43 caracteres.
const PADRAO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function gerarToken(): string {
  return randomBytes(32).toString('base64url');
}

export function tokenValido(token: string | undefined): token is string {
  return token !== undefined && PADRAO_TOKEN.test(token);
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

// Cria a sessão e devolve o token, que só existe aqui e no cookie.
export async function criarSessao(
  banco: Pick<Banco, 'query'>,
  usuarioId: string,
  horas: number,
): Promise<{ token: string; expiraEm: Date }> {
  const token = gerarToken();
  const { rows } = await banco.query<{ expira_em: Date }>(
    `INSERT INTO sessoes (usuario_id, token_hash, expira_em)
     VALUES ($1, $2, now() + make_interval(hours => $3))
     RETURNING expira_em`,
    [usuarioId, hashToken(token), horas],
  );
  return { token, expiraEm: rows[0]!.expira_em };
}

// Devolve o usuário da sessão, se ela existir, não tiver expirado e o usuário estiver ativo.
// Formato inválido nem chega ao banco.
export async function buscarSessao(
  banco: Pick<Banco, 'query'>,
  token: string | undefined,
): Promise<UsuarioSessao | null> {
  if (!tokenValido(token)) return null;
  const { rows } = await banco.query<UsuarioSessao>(
    `UPDATE sessoes s SET ultimo_uso_em = now()
       FROM usuarios u
      WHERE s.token_hash = $1 AND s.expira_em > now() AND u.id = s.usuario_id AND u.ativo
     RETURNING u.id::text AS id, u.nome, u.email, u.perfil`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

export async function encerrarSessao(banco: Pick<Banco, 'query'>, token: string | undefined): Promise<void> {
  if (!tokenValido(token)) return;
  await banco.query('DELETE FROM sessoes WHERE token_hash = $1', [hashToken(token)]);
}

export async function removerSessoesExpiradas(banco: Pick<Banco, 'query'>): Promise<void> {
  await banco.query('DELETE FROM sessoes WHERE expira_em <= now()');
}
