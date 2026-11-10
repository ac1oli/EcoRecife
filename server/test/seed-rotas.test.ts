// Seed 002 (rotas demonstrativas) sem PostgreSQL: conteúdo do arquivo, coerência com o
// seed 001 (veículos e bairros), créditos da fonte e recusas do comando db:seed-rotas.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ARQUIVO_SEED_ROTAS,
  ErroMigracao,
  PASTA_SEEDS,
  lerArquivos,
  semearRotas,
} from '../src/banco/migrador.js';
import { lerSeedRotas } from './apoio/seed-rotas.js';

const SEED_001 = path.join(PASTA_SEEDS, '001_dados_demonstrativos.sql');

// Veículos ativos e bairros do seed 001.
async function lerSeed001() {
  const sql = await readFile(SEED_001, 'utf8');
  const bairros = new Map<string, [number, number]>();
  for (const [, nome, lat, lng] of sql.matchAll(/^ {2}\('([^']+)',\s+(-\d+\.\d+), (-\d+\.\d+)\)[,;]$/gm)) {
    bairros.set(nome!, [Number(lat), Number(lng)]);
  }
  const veiculos = new Map<string, string>();
  for (const [, codigo, bairro] of sql.matchAll(/^ {2}\('(#\d{2})', '[^']+',\s+'(?:domiciliar|seletiva)',\s+'([^']+)'\)[,;]?$/gm)) {
    veiculos.set(codigo!, bairro!);
  }
  return { bairros, veiculos };
}

const distanciaKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const r = (x: number) => (x * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(a));
};

describe('arquivo do seed 002', () => {
  it('passa na validação do migrador e vem depois do 001', async () => {
    const seeds = await lerArquivos(PASTA_SEEDS, false);
    expect(seeds.map((s) => s.arquivo)).toEqual(['001_dados_demonstrativos.sql', path.basename(ARQUIVO_SEED_ROTAS)]);
  });

  it('tem uma rota para cada um dos 7 veículos do seed 001, com o bairro no nome', async () => {
    const { rotas } = await lerSeedRotas();
    const { veiculos } = await lerSeed001();
    expect(veiculos.size).toBe(7);
    expect([...rotas.keys()].sort()).toEqual([...veiculos.keys()].sort());
    for (const [codigo, bairro] of veiculos) {
      expect(rotas.get(codigo)).toBe(`Rota demonstrativa ${codigo} - ${bairro}`);
    }
    expect(new Set(rotas.values()).size).toBe(7);
    expect([...rotas.values()].every((nome) => nome.length <= 120)).toBe(true);
  });

  it('cada rota tem 2 ou mais pontos, com ordem 1, 2, 3... sem lacunas', async () => {
    const { rotas, pontos } = await lerSeedRotas();
    for (const codigo of rotas.keys()) {
      const lista = pontos.get(codigo) ?? [];
      expect(lista.length, codigo).toBeGreaterThanOrEqual(2);
      expect(lista.map((p) => p.ordem)).toEqual(lista.map((_, i) => i + 1));
    }
    expect([...pontos.keys()].every((codigo) => rotas.has(codigo))).toBe(true);
  });

  it('as coordenadas cabem no numeric(9,6), ficam no Recife e perto do bairro do veículo', async () => {
    const { pontos } = await lerSeedRotas();
    const { bairros, veiculos } = await lerSeed001();
    for (const [codigo, lista] of pontos) {
      const [latBairro, lngBairro] = bairros.get(veiculos.get(codigo)!)!;
      for (const p of lista) {
        expect(p.texto.every((t) => /^-\d{1,2}\.\d{1,6}$/.test(t)), `${codigo} ${p.ordem}`).toBe(true);
        // Caixa que contém o município do Recife.
        expect(p.latitude).toBeGreaterThan(-8.16);
        expect(p.latitude).toBeLessThan(-7.92);
        expect(p.longitude).toBeGreaterThan(-35.02);
        expect(p.longitude).toBeLessThan(-34.85);
        expect(distanciaKm(latBairro, lngBairro, p.latitude, p.longitude), `${codigo} ${p.ordem}`).toBeLessThan(1.5);
      }
    }
  });

  it('os trajetos seguem a malha: trechos curtos, sem pontos repetidos e circuito fechado', async () => {
    const { pontos } = await lerSeedRotas();
    for (const [codigo, lista] of pontos) {
      let total = 0;
      for (let i = 1; i < lista.length; i++) {
        const a = lista[i - 1]!;
        const b = lista[i]!;
        const trecho = distanciaKm(a.latitude, a.longitude, b.latitude, b.longitude);
        expect(trecho, `${codigo} ${b.ordem}`).toBeGreaterThan(0);
        expect(trecho, `${codigo} ${b.ordem}`).toBeLessThan(0.5); // nada de "linha reta" longa
        total += trecho;
      }
      expect(lista[0]!.texto).toEqual(lista.at(-1)!.texto); // reinício sem salto
      expect(total, codigo).toBeGreaterThan(2);
      expect(total, codigo).toBeLessThan(10);
    }
  });

  it('registra a fonte, os créditos e a natureza demonstrativa', async () => {
    const { sql } = await lerSeedRotas();
    expect(sql).toContain('© colaboradores do OpenStreetMap');
    expect(sql).toContain('ODbL');
    expect(sql).toContain('router.project-osrm.org');
    expect(sql).toMatch(/NENHUMA rota abaixo é oficial/);
    expect(sql).toMatch(/INSERT INTO rotas \(nome, veiculo_id, ativa, demonstrativo\)\s+SELECT c\.nome, v\.id, true, true/);
    // Só grava: nada de DELETE, UPDATE, DROP ou TRUNCATE em tabelas do projeto
    // (as tabelas temporárias da carga somem sozinhas com ON COMMIT DROP).
    const comandos = sql.replace(/--.*$/gm, '').replace(/ON COMMIT DROP/g, '');
    expect(comandos).not.toMatch(/\b(DELETE|UPDATE|DROP|TRUNCATE|ALTER)\b/i);
  });

});

describe('semearRotas (sem banco)', () => {
  let pasta: string | undefined;
  afterEach(async () => {
    if (pasta) await rm(pasta, { recursive: true, force: true });
    pasta = undefined;
  });

  it('recusa um arquivo inválido antes de conectar', async () => {
    pasta = await mkdtemp(path.join(tmpdir(), 'eco-seed-rotas-'));
    const arquivo = path.join(pasta, '002_rotas_demonstrativas.sql');
    await writeFile(arquivo, 'BEGIN;\nINSERT INTO rotas (nome) VALUES (1);\n');
    const pool = { connect: vi.fn() };
    await expect(semearRotas(pool as never, { arquivo })).rejects.toThrow(ErroMigracao);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('recusa quando outra migração ou seed está em andamento (trava ocupada)', async () => {
    const consultas: string[] = [];
    const cliente = {
      query: vi.fn(async (sql: string) => {
        consultas.push(sql);
        return { rows: [{ ok: false }], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    await expect(semearRotas({ connect: async () => cliente } as never)).rejects.toThrow(/em andamento/);
    expect(consultas.some((sql) => sql.includes('INSERT INTO rotas'))).toBe(false);
    expect(cliente.release).toHaveBeenCalled();
  });
});
