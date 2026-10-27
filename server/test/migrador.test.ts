// Validação dos arquivos de migração (sem banco). Inclui os arquivos reais de database/.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ErroMigracao, lerArquivos, PASTA_MIGRACOES, PASTA_SEEDS, validarArquivo } from '../src/banco/migrador.js';

const valida = (versao: string) =>
  `-- comentário\nBEGIN;\nCREATE TABLE t (id int);\nINSERT INTO schema_migrations (versao) VALUES ('${versao}');\nCOMMIT;\n`;

describe('arquivos reais do projeto', () => {
  it('as migrações 001–003 passam na validação, em ordem', async () => {
    const migracoes = await lerArquivos(PASTA_MIGRACOES, true);
    expect(migracoes.map((m) => m.versao)).toEqual([
      '001_tipos_e_funcoes',
      '002_tabelas',
      '003_indices_e_gatilhos',
    ]);
  });

  it('o seed 001 passa na validação', async () => {
    const seeds = await lerArquivos(PASTA_SEEDS, false);
    expect(seeds.map((s) => s.versao)).toEqual(['001_dados_demonstrativos']);
  });
});

describe('validarArquivo', () => {
  const arquivo = (sql: string, versao = '004_teste') => ({ versao, arquivo: `${versao}.sql`, sql });

  it('aceita uma migração bem formada', () => {
    expect(() => validarArquivo(arquivo(valida('004_teste')), true)).not.toThrow();
  });

  it.each([
    ['comando do psql', `\\set ON_ERROR_STOP on\n${valida('004_teste')}`],
    ['sem BEGIN', valida('004_teste').replace('BEGIN;', '')],
    ['sem COMMIT', valida('004_teste').replace('COMMIT;', '')],
    ['dois COMMIT', `${valida('004_teste')}BEGIN;\nSELECT 1;\nCOMMIT;\n`],
    ['comando depois do COMMIT', `${valida('004_teste')}DROP TABLE t;\n`],
    ['sem autorregistro', valida('004_teste').replace(/INSERT.*\n/, '')],
    ['autorregistro com outra versão', valida('005_outra')],
  ])('recusa %s', (_caso, sql) => {
    expect(() => validarArquivo(arquivo(sql), true)).toThrow(ErroMigracao);
  });

  it('não exige autorregistro nos seeds', () => {
    expect(() => validarArquivo(arquivo('BEGIN;\nINSERT INTO t VALUES (1);\nCOMMIT;'), false)).not.toThrow();
  });
});

describe('lerArquivos', () => {
  let pasta: string;
  afterEach(() => rm(pasta, { recursive: true, force: true }));

  async function criarPasta(arquivos: Record<string, string>) {
    pasta = await mkdtemp(path.join(tmpdir(), 'eco-mig-'));
    for (const [nome, sql] of Object.entries(arquivos)) await writeFile(path.join(pasta, nome), sql);
  }

  it('ordena pelo número e ignora arquivos que não são .sql', async () => {
    await criarPasta({ '002_b.sql': valida('002_b'), '001_a.sql': valida('001_a'), 'LEIA.md': '# x' });
    expect((await lerArquivos(pasta, true)).map((m) => m.versao)).toEqual(['001_a', '002_b']);
  });

  it('recusa nome fora do padrão', async () => {
    await criarPasta({ '1_a.sql': valida('1_a') });
    await expect(lerArquivos(pasta, true)).rejects.toThrow(/padrão/);
  });

  it('recusa número repetido', async () => {
    await criarPasta({ '001_a.sql': valida('001_a'), '001_b.sql': valida('001_b') });
    await expect(lerArquivos(pasta, true)).rejects.toThrow(/repetido/);
  });
});
