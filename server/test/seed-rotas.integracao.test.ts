// db:seed-rotas com um PostgreSQL de verdade, sempre em bancos temporários (veja test/apoio).
// Só roda se TEST_DATABASE_URL estiver definida. Cada cenário usa um banco próprio.
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar, PASTA_SEEDS, semear, semearRotas } from '../src/banco/migrador.js';
import { criarBancoTemporario, URL_ADMIN } from './apoio/banco-temporario.js';
import { lerSeedRotas } from './apoio/seed-rotas.js';

type Banco = Awaited<ReturnType<typeof criarBancoTemporario>>;

describe.skipIf(!URL_ADMIN)('integração: db:seed-rotas', { timeout: 60_000 }, () => {
  const bancos: Banco[] = [];
  let pastaSo001: string; // simula um banco instalado antes do seed 002 existir
  let esperado: Awaited<ReturnType<typeof lerSeedRotas>>;
  let totalPontos: number;

  beforeAll(async () => {
    pastaSo001 = await mkdtemp(path.join(tmpdir(), 'eco-seed-001-'));
    await copyFile(path.join(PASTA_SEEDS, '001_dados_demonstrativos.sql'), path.join(pastaSo001, '001_dados_demonstrativos.sql'));
    esperado = await lerSeedRotas();
    totalPontos = [...esperado.pontos.values()].reduce((soma, lista) => soma + lista.length, 0);
  });
  afterAll(async () => {
    for (const banco of bancos) await banco.apagar();
    await rm(pastaSo001, { recursive: true, force: true });
  });

  // Banco "já instalado": migrações + seed 001, sem rotas.
  async function bancoInstalado(): Promise<Banco> {
    const banco = await criarBancoTemporario();
    bancos.push(banco);
    await migrar(banco.pool);
    await semear(banco.pool, { pastaSeeds: pastaSo001 });
    return banco;
  }
  const valor = async (banco: Banco, sql: string, params: unknown[] = []) =>
    Object.values((await banco.pool.query(sql, params)).rows[0] ?? {})[0];
  const fotografia = async (banco: Banco) =>
    (
      await banco.pool.query(
        `SELECT r.id, r.nome, r.veiculo_id, r.ativa, r.demonstrativo, rp.ordem, rp.latitude::text, rp.longitude::text
           FROM rotas r LEFT JOIN rota_pontos rp ON rp.rota_id = r.id ORDER BY r.id, rp.ordem`,
      )
    ).rows;

  describe('banco instalado com o seed 001', () => {
    let banco: Banco;
    beforeAll(async () => {
      banco = await bancoInstalado();
    });

    it('carga inicial: 7 rotas ativas e demonstrativas, uma por veículo ativo', async () => {
      expect(await valor(banco, 'SELECT count(*)::int FROM rotas')).toBe(0);
      expect(await semearRotas(banco.pool)).toEqual({ situacao: 'carregadas', rotas: 7, pontos: totalPontos });
      const { rows } = await banco.pool.query(
        `SELECT v.codigo, r.nome, r.ativa, r.demonstrativo
           FROM veiculos v JOIN rotas r ON r.veiculo_id = v.id WHERE v.ativo ORDER BY v.codigo`,
      );
      expect(rows).toEqual(
        [...esperado.rotas].sort().map(([codigo, nome]) => ({ codigo, nome, ativa: true, demonstrativo: true })),
      );
      expect(await valor(banco, 'SELECT count(*)::int FROM veiculos WHERE ativo')).toBe(7);
      expect(await valor(banco, 'SELECT count(*)::int FROM rotas WHERE NOT demonstrativo')).toBe(0);
    });

    it('pontos: mesma quantidade, ordem 1..n sem lacunas e coordenadas iguais às do arquivo', async () => {
      const { rows } = await banco.pool.query(
        `SELECT v.codigo, count(*)::int AS n, min(rp.ordem) AS menor, max(rp.ordem) AS maior,
                json_agg(json_build_array(rp.latitude::text, rp.longitude::text) ORDER BY rp.ordem) AS coordenadas
           FROM rota_pontos rp JOIN rotas r ON r.id = rp.rota_id JOIN veiculos v ON v.id = r.veiculo_id
          GROUP BY v.codigo ORDER BY v.codigo`,
      );
      expect(rows).toHaveLength(7);
      for (const linha of rows) {
        const lista = esperado.pontos.get(linha.codigo)!;
        expect(linha.n).toBe(lista.length);
        expect([linha.menor, linha.maior]).toEqual([1, lista.length]);
        // numeric(9,6) completa com zeros; compara pelo valor.
        expect(linha.coordenadas.map(([a, o]: string[]) => [Number(a), Number(o)])).toEqual(
          lista.map((p) => [p.latitude, p.longitude]),
        );
      }
      expect(await valor(banco, 'SELECT count(*)::int FROM rota_pontos')).toBe(totalPontos);
    });

    it('a segunda execução não duplica nem altera nada', async () => {
      const antes = await fotografia(banco);
      expect(await semearRotas(banco.pool)).toEqual({ situacao: 'ja_carregadas', rotas: 7, pontos: totalPontos });
      expect(await fotografia(banco)).toEqual(antes);
    });

    it('rota demonstrativa alterada depois da carga: interrompe sem mexer em nada', async () => {
      await banco.pool.query(
        `UPDATE rota_pontos SET latitude = latitude + 0.0001
          WHERE ordem = 2 AND rota_id = (SELECT id FROM rotas WHERE nome LIKE 'Rota demonstrativa #08%')`,
      );
      const antes = await fotografia(banco);
      await expect(semearRotas(banco.pool)).rejects.toThrow(/Rotas demonstrativas alteradas desde a carga: Rota demonstrativa #08/);
      expect(await fotografia(banco)).toEqual(antes);
    });

    it('carga parcial (uma rota removida): interrompe sem recriar', async () => {
      await banco.pool.query(`DELETE FROM rotas WHERE nome LIKE 'Rota demonstrativa #08%'`);
      const antes = await fotografia(banco);
      await expect(semearRotas(banco.pool)).rejects.toThrow(/Carga parcial: 6 de 7 rotas demonstrativas/);
      expect(await fotografia(banco)).toEqual(antes);
    });
  });

  it('falha no meio da carga: rollback completo, e a carga funciona depois de corrigida', async () => {
    const banco = await bancoInstalado();
    // Falha forçada só neste banco temporário: o 500º ponto não entra.
    await banco.pool.query(`
      CREATE FUNCTION teste_falhar_ponto() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF (SELECT count(*) FROM rota_pontos) >= 499 THEN RAISE EXCEPTION 'falha forçada pelo teste'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER teste_falhar_ponto BEFORE INSERT ON rota_pontos FOR EACH ROW EXECUTE FUNCTION teste_falhar_ponto();`);
    await expect(semearRotas(banco.pool)).rejects.toThrow(/falha forçada pelo teste.*Nada deste arquivo foi gravado/);
    expect(await valor(banco, 'SELECT count(*)::int FROM rotas')).toBe(0);
    expect(await valor(banco, 'SELECT count(*)::int FROM rota_pontos')).toBe(0);
    // A trava foi liberada e a conexão continua utilizável.
    await banco.pool.query('DROP TRIGGER teste_falhar_ponto ON rota_pontos; DROP FUNCTION teste_falhar_ponto();');
    expect((await semearRotas(banco.pool)).situacao).toBe('carregadas');
  });

  it('veículo que já tem rota própria: interrompe e preserva a rota existente', async () => {
    const banco = await bancoInstalado();
    await banco.pool.query(
      `INSERT INTO rotas (nome, veiculo_id, demonstrativo) SELECT 'Roteiro da equipe', id, false FROM veiculos WHERE codigo = '#04'`,
    );
    const antes = await fotografia(banco);
    await expect(semearRotas(banco.pool)).rejects.toThrow(/Veículos que já têm rota cadastrada: #04 \(Roteiro da equipe\)/);
    expect(await fotografia(banco)).toEqual(antes);
  });

  it('rota sem relação com os 7 veículos: é mantida e a carga segue', async () => {
    const banco = await bancoInstalado();
    await banco.pool.query(`INSERT INTO rotas (nome, demonstrativo) VALUES ('Rota avulsa', false)`);
    await banco.pool.query(
      `INSERT INTO rota_pontos (rota_id, ordem, latitude, longitude)
       SELECT id, n, -8.05, -34.9 + n * 0.001 FROM rotas, generate_series(1, 2) n WHERE nome = 'Rota avulsa'`,
    );
    expect((await semearRotas(banco.pool)).situacao).toBe('carregadas');
    expect(await valor(banco, `SELECT count(*)::int FROM rota_pontos rp JOIN rotas r ON r.id = rp.rota_id WHERE r.nome = 'Rota avulsa'`)).toBe(2);
    expect(await valor(banco, 'SELECT count(*)::int FROM rotas')).toBe(8);
  });

  it('veículos ausentes (sem o seed 001) ou inativos: interrompe sem gravar', async () => {
    const vazio = await criarBancoTemporario();
    bancos.push(vazio);
    await migrar(vazio.pool);
    await expect(semearRotas(vazio.pool)).rejects.toThrow(/Veículos ausentes ou inativos: #04, #06, #08, #11, #13, #15, #17/);

    const banco = await bancoInstalado();
    await banco.pool.query(`UPDATE veiculos SET ativo = false WHERE codigo = '#11'`);
    await expect(semearRotas(banco.pool)).rejects.toThrow(/Veículos ausentes ou inativos: #11\./);
    expect(await valor(banco, 'SELECT count(*)::int FROM rotas')).toBe(0);
  });

  it('banco sem migrações: recusa antes de executar o seed', async () => {
    const banco = await criarBancoTemporario();
    bancos.push(banco);
    await expect(semearRotas(banco.pool)).rejects.toThrow(/migrações pendentes.*pnpm db:migrar/);
    expect(await valor(banco, "SELECT to_regclass('public.rotas') IS NULL")).toBe(true);
  });

  it('banco novo pelo db:seed recebe as mesmas rotas, e o db:seed-rotas reconhece a carga', async () => {
    const novo = await criarBancoTemporario();
    bancos.push(novo);
    await migrar(novo.pool);
    expect(await semear(novo.pool)).toEqual(['001_dados_demonstrativos', '002_rotas_demonstrativas']);
    expect(await valor(novo, 'SELECT count(*)::int FROM rota_pontos')).toBe(totalPontos);
    expect(await semearRotas(novo.pool)).toEqual({ situacao: 'ja_carregadas', rotas: 7, pontos: totalPontos });
    // As demais seeds seguem iguais (regressão do seed 001).
    expect(await valor(novo, 'SELECT count(*)::int FROM veiculos')).toBe(7);
    expect(await valor(novo, 'SELECT count(*)::int FROM pontos_descarte')).toBe(10);
    expect(await valor(novo, 'SELECT count(*)::int FROM ocorrencias')).toBe(8);
  });
});
