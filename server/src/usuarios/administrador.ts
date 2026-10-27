// Validação e gravação de um administrador. Usado pelo comando pnpm criar-admin.
// A senha só existe em memória: o banco recebe apenas o hash bcrypt.
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Banco } from '../db.js';

export const CUSTO_BCRYPT = 12;
export const SENHA_MIN = 12;
const SENHA_MAX_BYTES = 72; // o bcrypt ignora o que passar de 72 bytes

export class ErroDadosAdmin extends Error {}

export const esquemaNome = z.string().trim().min(1, 'Informe o nome').max(120, 'Nome com no máximo 120 caracteres');
export const esquemaEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'E-mail com no máximo 254 caracteres')
  .pipe(z.email('E-mail inválido'));

export function validarSenha(senha: string, email: string): string | null {
  if ([...senha].length < SENHA_MIN) return `A senha precisa ter pelo menos ${SENHA_MIN} caracteres`;
  if (Buffer.byteLength(senha, 'utf8') > SENHA_MAX_BYTES) return `A senha pode ter no máximo ${SENHA_MAX_BYTES} bytes`;
  if (senha.trim() !== senha) return 'A senha não pode começar nem terminar com espaço';
  if (new Set(senha).size < 4) return 'A senha é repetitiva demais';
  if (senha.toLowerCase().includes(email.split('@')[0]!.toLowerCase())) return 'A senha não pode conter o e-mail';
  return null;
}

export async function emailCadastrado(banco: Pick<Banco, 'query'>, email: string): Promise<boolean> {
  const { rowCount } = await banco.query('SELECT 1 FROM usuarios WHERE lower(email) = lower($1)', [email]);
  return (rowCount ?? 0) > 0;
}

export async function contarAdministradores(banco: Pick<Banco, 'query'>): Promise<number> {
  const { rows } = await banco.query<{ total: number }>(
    "SELECT count(*)::int AS total FROM usuarios WHERE perfil = 'admin' AND ativo",
  );
  return rows[0]?.total ?? 0;
}

export async function criarAdministrador(
  banco: Pick<Banco, 'query'>,
  dados: { nome: string; email: string; senha: string },
  custo = CUSTO_BCRYPT,
): Promise<{ id: string; email: string }> {
  const nome = esquemaNome.parse(dados.nome);
  const email = esquemaEmail.parse(dados.email);
  const problemaSenha = validarSenha(dados.senha, email);
  if (problemaSenha) throw new ErroDadosAdmin(problemaSenha);

  const senhaHash = await bcrypt.hash(dados.senha, custo);
  try {
    const { rows } = await banco.query<{ id: string; email: string }>(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES ($1, $2, $3, 'admin') RETURNING id, email`,
      [nome, email, senhaHash],
    );
    return rows[0]!;
  } catch (erro) {
    if ((erro as { code?: string }).code === '23505') throw new ErroDadosAdmin('Já existe um usuário com esse e-mail');
    throw erro;
  }
}
