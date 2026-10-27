import bcrypt from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';
import { criarAdministrador, ErroDadosAdmin, esquemaEmail, validarSenha } from '../src/usuarios/administrador.js';

describe('validarSenha', () => {
  it('aceita uma frase longa', () => {
    expect(validarSenha('frase longa de teste 2026', 'ana@exemplo.org')).toBeNull();
  });

  it.each([
    ['curta', 'Curta123!'],
    ['acima de 72 bytes', 'á'.repeat(37)],
    ['espaço nas pontas', ' frase longa de teste '],
    ['repetitiva', 'aaaaaaaaaaaaaaab'],
    ['contém o e-mail', 'ana.souza-2026-segura'],
  ])('recusa senha %s', (_caso, senha) => {
    expect(validarSenha(senha, 'ana.souza@exemplo.org')).not.toBeNull();
  });
});

describe('esquemaEmail', () => {
  it('normaliza para minúsculas e sem espaços', () => {
    expect(esquemaEmail.parse('  Ana@Exemplo.ORG ')).toBe('ana@exemplo.org');
  });
  it('recusa e-mail inválido', () => {
    expect(esquemaEmail.safeParse('ana@').success).toBe(false);
  });
});

describe('criarAdministrador', () => {
  it('grava só o hash bcrypt, com perfil admin e consulta parametrizada', async () => {
    const banco = { query: vi.fn().mockResolvedValue({ rows: [{ id: '1', email: 'ana@exemplo.org' }] }) };
    const senha = 'frase longa de teste 2026';
    await criarAdministrador(banco as never, { nome: ' Ana ', email: 'Ana@Exemplo.org', senha }, 4);

    const [sql, parametros] = banco.query.mock.calls[0]!;
    expect(sql).toContain("VALUES ($1, $2, $3, 'admin')");
    expect(parametros[0]).toBe('Ana');
    expect(parametros[1]).toBe('ana@exemplo.org');
    expect(parametros[2]).not.toBe(senha);
    expect(await bcrypt.compare(senha, parametros[2])).toBe(true);
    expect(sql).not.toContain(senha);
  });

  it('traduz e-mail duplicado (23505) em erro legível', async () => {
    const banco = { query: vi.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' })) };
    await expect(
      criarAdministrador(banco as never, { nome: 'Ana', email: 'ana@exemplo.org', senha: 'frase longa de teste 2026' }, 4),
    ).rejects.toThrow(ErroDadosAdmin);
  });

  it('não toca no banco se a senha for fraca', async () => {
    const banco = { query: vi.fn() };
    await expect(
      criarAdministrador(banco as never, { nome: 'Ana', email: 'ana@exemplo.org', senha: 'curta' }, 4),
    ).rejects.toThrow(ErroDadosAdmin);
    expect(banco.query).not.toHaveBeenCalled();
  });
});
