// /api/veiculos e /api/rotas com um PostgreSQL de verdade, num banco temporário (veja
// test/apoio). Só roda se TEST_DATABASE_URL estiver definida. Confere com os seeds 001 e 002.
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import { criarArmazenamentoDisco } from '../src/ocorrencias/fotos.js';
import { migrar, semear } from '../src/banco/migrador.js';
import { criarBancoTemporario, URL_ADMIN } from './apoio/banco-temporario.js';
import { lerSeedRotas } from './apoio/seed-rotas.js';

type Veiculo = { codigo: string; descricao: string | null; tipoColeta: string; bairro: string | null; demonstrativo: boolean };
type Rota = {
  id: number;
  nome: string;
  demonstrativo: boolean;
  veiculo: Veiculo | null;
  pontos: { ordem: number; latitude: number; longitude: number }[];
};

describe.skipIf(!URL_ADMIN)('integração: veículos e rotas', { timeout: 60_000 }, () => {
  let banco: Awaited<ReturnType<typeof criarBancoTemporario>>;
  let app: ReturnType<typeof criarApp>;
  let seed: Awaited<ReturnType<typeof lerSeedRotas>>;

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    await migrar(banco.pool);
    await semear(banco.pool);
    app = criarApp({ origensCors: ['http://localhost:5173'], ambiente: 'test', sessaoHoras: 8, fotos: criarArmazenamentoDisco('nao-usada') }, banco.pool);
    seed = await lerSeedRotas();
  });
  afterAll(async () => {
    await banco?.apagar();
  });

  describe('com os seeds', () => {
    it('GET /api/veiculos: os 7 veículos ativos do seed 001, sem sessão', async () => {
      const r = await request(app).get('/api/veiculos');
      expect(r.status).toBe(200);
      const { rows } = await banco.pool.query(
        `SELECT v.codigo, v.descricao, v.tipo_coleta::text AS "tipoColeta", b.nome AS bairro, v.demonstrativo
           FROM veiculos v LEFT JOIN bairros b ON b.id = v.bairro_id WHERE v.ativo ORDER BY v.codigo`,
      );
      expect(rows).toHaveLength(7);
      expect(r.body.itens).toEqual(rows);
      expect(r.body.itens[0]).toEqual({
        codigo: '#04',
        descricao: 'Caminhão #04 - Boa Viagem',
        tipoColeta: 'domiciliar',
        bairro: 'Boa Viagem',
        demonstrativo: true,
      });
      expect(r.body.itens.find((v: Veiculo) => v.codigo === '#11').tipoColeta).toBe('seletiva');
    });

    it('GET /api/rotas: as 7 rotas do seed 002, cada uma com o seu veículo e os pontos do arquivo, em ordem', async () => {
      const r = await request(app).get('/api/rotas');
      expect(r.status).toBe(200);
      const itens: Rota[] = r.body.itens;
      expect(itens.map((i) => i.nome)).toEqual([...seed.rotas.values()].sort());
      for (const rota of itens) {
        expect(Object.keys(rota).sort()).toEqual(['demonstrativo', 'id', 'nome', 'pontos', 'veiculo']);
        expect(rota.demonstrativo).toBe(true);
        expect(rota.veiculo?.demonstrativo).toBe(true);
        const codigo = rota.veiculo!.codigo;
        expect(seed.rotas.get(codigo)).toBe(rota.nome);
        expect(rota.pontos.map((p) => p.ordem)).toEqual(rota.pontos.map((_, i) => i + 1));
        expect(rota.pontos.map((p) => [p.latitude, p.longitude])).toEqual(
          seed.pontos.get(codigo)!.map((p) => [p.latitude, p.longitude]),
        );
        expect(Object.keys(rota.pontos[0]!).sort()).toEqual(['latitude', 'longitude', 'ordem']);
      }
      expect(itens.reduce((soma, i) => soma + i.pontos.length, 0)).toBe(1178);
    });

    it('não expõe campos internos nem mudanças de cabeçalho de sessão', async () => {
      for (const rota of ['/api/veiculos', '/api/rotas']) {
        const r = await request(app).get(rota);
        const texto = JSON.stringify(r.body);
        expect(texto).not.toMatch(/"ativ[oa]"|veiculo_id|bairro_id|rota_id|"id":\s*\d+,"codigo"/);
        expect(r.headers['set-cookie']).toBeUndefined();
      }
    });
  });

  describe('somente registros ativos', () => {
    beforeAll(async () => {
      // Só neste banco temporário: um veículo inativo (com rota ativa), uma rota inativa
      // e uma rota ativa sem veículo nem pontos.
      await banco.pool.query(`UPDATE veiculos SET ativo = false WHERE codigo = '#11'`);
      await banco.pool.query(`UPDATE rotas SET ativa = false WHERE nome LIKE 'Rota demonstrativa #13%'`);
      await banco.pool.query(`INSERT INTO rotas (nome, ativa, demonstrativo) VALUES ('Rota de teste sem veículo', true, true)`);
    });

    it('veículo inativo some da lista de veículos', async () => {
      const r = await request(app).get('/api/veiculos');
      expect(r.body.itens.map((v: Veiculo) => v.codigo)).toEqual(['#04', '#06', '#08', '#13', '#15', '#17']);
    });

    it('rota inativa some; rota de veículo inativo e rota sem veículo saem com veiculo null', async () => {
      const r = await request(app).get('/api/rotas');
      const itens: Rota[] = r.body.itens;
      expect(itens.map((i) => i.nome)).not.toContain('Rota demonstrativa #13 - Cordeiro');
      expect(itens).toHaveLength(7);
      expect(itens.find((i) => i.nome.startsWith('Rota demonstrativa #11'))?.veiculo).toBeNull();
      expect(itens.find((i) => i.nome === 'Rota de teste sem veículo')).toMatchObject({ veiculo: null, pontos: [] });
      // O veículo inativo não aparece em nenhuma rota (o nome da rota é dado da própria rota).
      expect(itens.some((i) => i.veiculo?.codigo === '#11')).toBe(false);
    });
  });

  describe('regressão', () => {
    it('autenticação, ocorrências, pontos e saúde seguem iguais', async () => {
      await banco.pool.query(`INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES ('Gestora', 'g@teste.example', $1, 'gestor')`, [
        bcrypt.hashSync('frase longa de teste 2026', 4),
      ]);
      const login = await request(app).post('/api/auth/login').send({ email: 'g@teste.example', senha: 'frase longa de teste 2026' });
      expect(login.status).toBe(200);
      const cookie = String(([] as string[]).concat(login.headers['set-cookie'] ?? [])[0]).split(';')[0]!;
      expect((await request(app).get('/api/ocorrencias').set('Cookie', cookie)).status).toBe(200);
      expect((await request(app).get('/api/ocorrencias')).status).toBe(401);
      expect((await request(app).get('/api/ocorrencias/protocolo/ECO-2026-DEMA-9JTU')).status).toBe(200);
      expect((await request(app).get('/api/pontos')).body.itens).toHaveLength(10);
      expect((await request(app).post('/api/pontos').set('Cookie', cookie).send({})).status).toBe(403);
      expect((await request(app).get('/api/saude')).status).toBe(200);
    });
  });
});
