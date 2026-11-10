// db:backup e db:restaurar num PostgreSQL descartável: o backup de um banco com dados é
// restaurado em outro banco vazio, e o conteúdo (ids, datas, sequências) sai idêntico.
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gerarBackup, restaurarBackup, TABELAS_BACKUP } from '../src/banco/backup.js';
import { migrar, semear } from '../src/banco/migrador.js';
import { criarBancoTemporario, URL_ADMIN } from './apoio/banco-temporario.js';

type Banco = Awaited<ReturnType<typeof criarBancoTemporario>>;

async function assinatura(banco: Banco) {
  const r: Record<string, string> = {};
  for (const tabela of [...TABELAS_BACKUP]) {
    const { rows } = await banco.pool.query<{ md5: string }>(
      `SELECT md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY to_jsonb(t)::text COLLATE "C"), '')) AS md5 FROM public.${tabela} t`,
    );
    r[tabela] = rows[0]!.md5;
  }
  const { rows } = await banco.pool.query<{ s: string; v: string | null }>(
    `SELECT sequencename AS s, last_value::text AS v FROM pg_sequences WHERE schemaname = 'public' AND sequencename <> 'sessoes_id_seq' ORDER BY 1`,
  );
  r.sequencias = JSON.stringify(rows);
  return r;
}

describe.skipIf(!URL_ADMIN)('integração: backup e restauração em SQL puro', { timeout: 60_000 }, () => {
  let origem: Banco;
  let destino: Banco;

  beforeAll(async () => {
    origem = await criarBancoTemporario();
    destino = await criarBancoTemporario();
    await migrar(origem.pool);
    await semear(origem.pool);
    // Dados com aspas, $, acentos e um usuário com hash bcrypt, além de uma lacuna de sequência.
    await origem.pool.query(`INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES ($1, 'a@teste.example', $2, 'admin')`, [
      `Ana "D'Ávila" $backup$ $$`,
      bcrypt.hashSync('frase longa de teste 2026', 4),
    ]);
    await origem.pool.query(`SELECT nextval(pg_get_serial_sequence('ocorrencias', 'id'))`);
  });
  afterAll(async () => {
    await origem?.apagar();
    await destino?.apagar();
  });

  it('o backup restaurado num banco vazio é idêntico ao original (ids, datas e sequências)', async () => {
    const { sql, contagens } = await gerarBackup(origem.pool, 'teste');
    expect(contagens).toMatchObject({ veiculos: 7, rotas: 7, rota_pontos: 1178, usuarios: 1, ocorrencias: 8 });
    expect(sql).not.toContain('INSERT INTO public.sessoes');
    await migrar(destino.pool);
    const restaurado = await restaurarBackup(destino.pool, sql);
    expect(restaurado).toEqual(contagens);
    expect(await assinatura(destino)).toEqual(await assinatura(origem));
  });

  it('recusa restaurar sobre dados existentes, sem alterar nada', async () => {
    const { sql } = await gerarBackup(origem.pool, 'teste');
    const antes = await assinatura(destino);
    await expect(restaurarBackup(destino.pool, sql)).rejects.toThrow(/tabelas vazias/);
    expect(await assinatura(destino)).toEqual(antes);
  });

  it('recusa backup de outra versão das migrações e arquivo que não é backup', async () => {
    const { sql } = await gerarBackup(origem.pool, 'teste');
    const outro = await criarBancoTemporario();
    try {
      await migrar(outro.pool);
      await expect(restaurarBackup(outro.pool, sql.replace(/-- migracoes: .*/, '-- migracoes: 001_tipos_e_funcoes'))).rejects.toThrow(/migrações/);
      await expect(restaurarBackup(outro.pool, 'DROP TABLE usuarios;')).rejects.toThrow(/não é um backup/);
      const { rows } = await outro.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM usuarios');
      expect(rows[0]!.n).toBe(0);
    } finally {
      await outro.apagar();
    }
  });
});
