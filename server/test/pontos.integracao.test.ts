// Guia de reciclagem com um PostgreSQL de verdade, num banco temporário (veja test/apoio).
// Só roda se TEST_DATABASE_URL estiver definida. Confere os resultados contra as
// consultas 2 a 4 de database/queries/consultas_teste.sql.
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { criarApp } from '../src/app.js';
import { criarArmazenamentoDisco } from '../src/ocorrencias/fotos.js';
import { migrar, semear } from '../src/banco/migrador.js';
import { criarBancoTemporario, URL_ADMIN } from './apoio/banco-temporario.js';

const SENHA = 'frase longa de teste 2026';
const DERBY = { lat: -8.057, lng: -34.899 }; // mesma posição das consultas 2 e 3

function cookieDe(resposta: request.Response): string {
  const cabecalho = ([] as string[]).concat(resposta.headers['set-cookie'] ?? [])[0];
  if (!cabecalho) throw new Error('resposta sem Set-Cookie');
  return cabecalho.split(';')[0]!;
}

type Item = { id: number; nome: string; tipo: string; bairro: string; distanciaKm?: number; materiais: { slug: string }[] };

describe.skipIf(!URL_ADMIN)('integração: guia de reciclagem', { timeout: 60_000 }, () => {
  let banco: Awaited<ReturnType<typeof criarBancoTemporario>>;
  let app: ReturnType<typeof criarApp>;
  let admin: string; // cookie
  let gestora: string; // cookie

  const nomes = (itens: Item[]) => itens.map((i) => i.nome);
  const contar = async (sql: string, params: unknown[] = []) =>
    (await banco.pool.query(`SELECT count(*)::int AS n FROM ${sql}`, params)).rows[0].n as number;
  const comAdmin = (req: request.Test) => req.set('Cookie', admin);

  async function criarUsuario(nome: string, email: string, perfil: 'admin' | 'gestor') {
    await banco.pool.query(`INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES ($1, $2, $3, $4)`, [
      nome,
      email,
      bcrypt.hashSync(SENHA, 4),
      perfil,
    ]);
    const resposta = await request(app).post('/api/auth/login').send({ email, senha: SENHA });
    expect(resposta.status).toBe(200);
    return cookieDe(resposta);
  }

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    await migrar(banco.pool);
    await semear(banco.pool);
    app = criarApp(
      { origensCors: ['http://localhost:5173'], ambiente: 'test', sessaoHoras: 8, fotos: criarArmazenamentoDisco('nao-usada') },
      banco.pool,
    );
    admin = await criarUsuario('Admin Teste', 'admin@teste.example', 'admin');
    gestora = await criarUsuario('Gestora Teste', 'gestora@teste.example', 'gestor');
  });
  afterAll(async () => {
    await banco?.apagar();
  });

  describe('listagem pública', () => {
    it('lista os pontos ativos na ordem da consulta 4, com materiais', async () => {
      const resposta = await request(app).get('/api/pontos');
      expect(resposta.status).toBe(200);
      const { rows } = await banco.pool.query(
        `SELECT p.nome, string_agg(m.slug, ',' ORDER BY m.nome) AS materiais
           FROM pontos_descarte p
           LEFT JOIN ponto_materiais pm ON pm.ponto_id = p.id
           LEFT JOIN materiais m ON m.id = pm.material_id
          WHERE p.ativo GROUP BY p.id ORDER BY p.tipo, p.nome`,
      );
      expect(rows).toHaveLength(10);
      expect(nomes(resposta.body.itens)).toEqual(rows.map((r) => r.nome));
      expect(resposta.body.itens.map((i: Item) => i.materiais.map((m) => m.slug).join(','))).toEqual(
        rows.map((r) => r.materiais ?? ''),
      );
      const pina = resposta.body.itens.find((i: Item) => i.nome === 'EcoPonto Pina');
      expect(pina).toMatchObject({ tipo: 'ecoponto', bairro: 'Pina', latitude: -8.088, longitude: -34.885, demonstrativo: true, fonte: null });
      expect(pina).not.toHaveProperty('ativo');
    });

    it('filtra por tipo, por material e pelos dois, conferindo com o banco', async () => {
      const cooperativas = await request(app).get('/api/pontos?tipo=cooperativa');
      expect(cooperativas.body.itens).toHaveLength(await contar(`pontos_descarte WHERE ativo AND tipo = 'cooperativa'`));
      expect(cooperativas.body.itens.every((i: Item) => i.tipo === 'cooperativa')).toBe(true);

      const eletronicos = await request(app).get('/api/pontos?material=eletronicos');
      expect(nomes(eletronicos.body.itens)).toEqual(['EcoPonto Casa Amarela', 'EcoPonto Pina']);

      const ambos = await request(app).get('/api/pontos?tipo=cooperativa&material=eletronicos');
      expect(ambos.body.itens).toEqual([]);
      expect((await request(app).get('/api/pontos?tipo=pev')).body.itens).toEqual([]);
      expect((await request(app).get('/api/pontos?material=inexistente')).body.itens).toEqual([]);
      expect((await request(app).get('/api/pontos?tipo=aterro')).status).toBe(400);
    });
  });

  describe('mais próximos (distancia_km)', () => {
    it('do Derby: os mesmos 3 da consulta 2, com as distâncias do docs/03', async () => {
      const resposta = await request(app).get(`/api/pontos/proximos?lat=${DERBY.lat}&lng=${DERBY.lng}`);
      expect(resposta.status).toBe(200);
      expect(resposta.body.itens.map((i: Item) => [i.nome, i.distanciaKm])).toEqual([
        ['EcoPonto Torre', 1.61],
        ['Cooperativa Novo Ciclo', 1.85],
        ['EcoPonto Centro / Santo Antônio', 1.95],
      ]);
      const { rows } = await banco.pool.query(
        `SELECT p.nome, round(distancia_km($1, $2, p.latitude, p.longitude)::numeric, 2)::float8 AS d
           FROM pontos_descarte p WHERE p.ativo
          ORDER BY distancia_km($1, $2, p.latitude, p.longitude) LIMIT 3`,
        [DERBY.lat, DERBY.lng],
      );
      expect(resposta.body.itens.map((i: Item) => [i.nome, i.distanciaKm])).toEqual(rows.map((r) => [r.nome, r.d]));
    });

    it('com eletroeletrônicos: os mesmos da consulta 3', async () => {
      const resposta = await request(app).get(`/api/pontos/proximos?lat=${DERBY.lat}&lng=${DERBY.lng}&material=eletronicos`);
      expect(resposta.body.itens.map((i: Item) => [i.nome, i.distanciaKm])).toEqual([
        ['EcoPonto Pina', 3.78],
        ['EcoPonto Casa Amarela', 4.95],
      ]);
    });

    it('limite: até 10, em ordem crescente de distância; fora do intervalo, 400', async () => {
      const resposta = await request(app).get(`/api/pontos/proximos?lat=${DERBY.lat}&lng=${DERBY.lng}&limite=10`);
      const distancias = resposta.body.itens.map((i: Item) => i.distanciaKm);
      expect(distancias).toHaveLength(10);
      expect([...distancias].sort((a, b) => a - b)).toEqual(distancias);
      expect((await request(app).get(`/api/pontos/proximos?lat=0&lng=0&limite=11`)).status).toBe(400);
      const semPosicao = await request(app).get('/api/pontos/proximos');
      expect(semPosicao.status).toBe(400);
      expect(semPosicao.body.erro).toBe('Informe lat e lng');
    });

    it('um ponto exatamente na posição informada tem distância 0', async () => {
      const resposta = await request(app).get('/api/pontos/proximos?lat=-8.0479&lng=-34.9104&limite=1');
      expect(resposta.body.itens.map((i: Item) => [i.nome, i.distanciaKm])).toEqual([['EcoPonto Torre', 0]]);
    });
  });

  describe('cadastro e gestão (somente admin)', () => {
    const NOVO = {
      tipo: 'pev',
      nome: 'PEV Integração',
      bairro: 'boa viagem', // o nome do bairro não diferencia maiúsculas
      endereco: 'Av. Teste, 100',
      latitude: -8.125,
      longitude: -34.901,
      horarioFuncionamento: '24h',
      materiais: ['reciclaveis', 'pilhas_baterias', 'reciclaveis'],
    };
    let id: number;

    it('sem sessão: 401; gestora: 403; nada é gravado', async () => {
      const antes = await contar('pontos_descarte');
      expect((await request(app).post('/api/pontos').send(NOVO)).status).toBe(401);
      expect((await request(app).post('/api/pontos').set('Cookie', gestora).send(NOVO)).status).toBe(403);
      expect((await request(app).get('/api/pontos/gestao').set('Cookie', gestora)).status).toBe(403);
      expect((await request(app).delete('/api/pontos/1').set('Cookie', gestora)).status).toBe(403);
      expect(await contar('pontos_descarte')).toBe(antes);
      expect(await contar('pontos_descarte WHERE id = 1 AND ativo')).toBe(1);
    });

    it('admin cria o ponto, que aparece no guia público', async () => {
      const resposta = await comAdmin(request(app).post('/api/pontos').send(NOVO));
      expect(resposta.status).toBe(201);
      id = resposta.body.id;
      expect(resposta.headers.location).toBe(`/api/pontos/${id}`);
      expect(resposta.body).toMatchObject({
        tipo: 'pev',
        nome: 'PEV Integração',
        bairro: 'Boa Viagem',
        ativo: true,
        demonstrativo: true,
        fonte: null,
        verificadoEm: null,
      });
      expect(resposta.body.materiais.map((m: { slug: string }) => m.slug)).toEqual(['pilhas_baterias', 'reciclaveis']);
      expect(await contar('ponto_materiais WHERE ponto_id = $1', [id])).toBe(2);
      const publico = await request(app).get('/api/pontos?tipo=pev');
      expect(nomes(publico.body.itens)).toEqual(['PEV Integração']);
    });

    it('nome repetido no mesmo tipo: 409; dado oficial sem fonte: 400', async () => {
      expect((await comAdmin(request(app).post('/api/pontos').send(NOVO))).status).toBe(409);
      const semFonte = await comAdmin(request(app).post('/api/pontos').send({ ...NOVO, nome: 'PEV Oficial', demonstrativo: false }));
      expect(semFonte.status).toBe(400);
      const comFonte = await comAdmin(
        request(app)
          .post('/api/pontos')
          .send({ ...NOVO, nome: 'PEV Oficial', demonstrativo: false, fonte: 'https://exemplo.gov.br/pevs', verificadoEm: '2026-10-01' }),
      );
      expect(comFonte.status).toBe(201);
      expect(comFonte.body).toMatchObject({ demonstrativo: false, fonte: 'https://exemplo.gov.br/pevs', verificadoEm: '2026-10-01' });
    });

    it('material ou bairro desconhecido: 400 e nada fica gravado (rollback real)', async () => {
      const antes = await contar('pontos_descarte');
      const materiais = await contar('ponto_materiais');
      const material = await comAdmin(request(app).post('/api/pontos').send({ ...NOVO, nome: 'PEV X', materiais: ['reciclaveis', 'plutonio'] }));
      expect(material.status).toBe(400);
      expect(material.body.erro).toBe('Material inválido: plutonio');
      expect((await comAdmin(request(app).post('/api/pontos').send({ ...NOVO, nome: 'PEV Y', bairro: 'Atlântida' }))).status).toBe(400);
      expect(await contar('pontos_descarte')).toBe(antes);
      expect(await contar('ponto_materiais')).toBe(materiais);
    });

    it('PATCH muda só os campos enviados e troca os materiais', async () => {
      const antes = (await banco.pool.query('SELECT atualizado_em FROM pontos_descarte WHERE id = $1', [id])).rows[0];
      const resposta = await comAdmin(
        request(app).patch(`/api/pontos/${id}`).send({ bairro: 'Pina', endereco: '', materiais: ['oleo_vegetal'], site: 'https://exemplo.org' }),
      );
      expect(resposta.status).toBe(200);
      expect(resposta.body).toMatchObject({ nome: 'PEV Integração', bairro: 'Pina', endereco: null, site: 'https://exemplo.org', horarioFuncionamento: '24h' });
      expect(resposta.body.materiais).toEqual([{ slug: 'oleo_vegetal', nome: 'Óleo vegetal' }]);
      expect(Date.parse(resposta.body.atualizadoEm)).toBeGreaterThan(antes.atualizado_em.getTime());
      expect((await comAdmin(request(app).patch(`/api/pontos/${id}`).send({ site: 'javascript:alert(1)' }))).status).toBe(400);
    });

    it('PATCH que deixaria um dado oficial sem fonte: 400 e nada muda', async () => {
      const resposta = await comAdmin(request(app).patch(`/api/pontos/${id}`).send({ demonstrativo: false, situacao: 'Mudou' }));
      expect(resposta.status).toBe(400);
      expect(await contar(`pontos_descarte WHERE id = $1 AND demonstrativo AND situacao IS NULL`, [id])).toBe(1);
    });

    it('PATCH com falha no meio (gatilho no banco temporário): rollback do nome', async () => {
      await banco.pool.query(`
        CREATE FUNCTION teste_falhar_materiais() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'falha forçada pelo teste'; END $$;
        CREATE TRIGGER teste_falhar_materiais BEFORE INSERT ON ponto_materiais
          FOR EACH ROW EXECUTE FUNCTION teste_falhar_materiais();`);
      const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const resposta = await comAdmin(request(app).patch(`/api/pontos/${id}`).send({ nome: 'Nome que não fica', materiais: ['reciclaveis'] }));
        expect(resposta.status).toBe(500);
        expect(resposta.body).toEqual({ erro: 'Erro interno do servidor' });
      } finally {
        erro.mockRestore();
        await banco.pool.query('DROP TRIGGER teste_falhar_materiais ON ponto_materiais; DROP FUNCTION teste_falhar_materiais();');
      }
      const { rows } = await banco.pool.query(
        `SELECT p.nome, array_agg(m.slug) AS materiais FROM pontos_descarte p
           JOIN ponto_materiais pm ON pm.ponto_id = p.id JOIN materiais m ON m.id = pm.material_id
          WHERE p.id = $1 GROUP BY p.nome`,
        [id],
      );
      expect(rows).toEqual([{ nome: 'PEV Integração', materiais: ['oleo_vegetal'] }]);
    });

    it('DELETE desativa: some do guia e dos próximos, segue no banco e volta pelo PATCH', async () => {
      expect((await comAdmin(request(app).delete(`/api/pontos/${id}`))).status).toBe(204);
      expect(await contar('pontos_descarte WHERE id = $1 AND NOT ativo', [id])).toBe(1);
      expect(nomes((await request(app).get('/api/pontos')).body.itens)).not.toContain('PEV Integração');
      const perto = await request(app).get('/api/pontos/proximos?lat=-8.088&lng=-34.885&limite=10');
      expect(nomes(perto.body.itens)).not.toContain('PEV Integração');

      const inativos = await comAdmin(request(app).get('/api/pontos/gestao?ativo=false'));
      expect(inativos.body.itens.map((i: Item & { ativo: boolean }) => [i.nome, i.ativo])).toEqual([['PEV Integração', false]]);
      expect((await comAdmin(request(app).get(`/api/pontos/${id}`))).body.ativo).toBe(false);

      expect((await comAdmin(request(app).delete(`/api/pontos/${id}`))).status).toBe(204); // idempotente
      expect((await comAdmin(request(app).delete('/api/pontos/999999'))).status).toBe(404);

      const reativado = await comAdmin(request(app).patch(`/api/pontos/${id}`).send({ ativo: true }));
      expect(reativado.body.ativo).toBe(true);
      expect(nomes((await request(app).get('/api/pontos?tipo=pev')).body.itens)).toContain('PEV Integração');
    });

    it('escrita vinda de outro site: 403', async () => {
      const resposta = await comAdmin(request(app).patch(`/api/pontos/${id}`).set('Origin', 'https://outro.example').send({ situacao: 'x' }));
      expect(resposta.status).toBe(403);
    });
  });

  describe('regressão', () => {
    it('as rotas de ocorrências seguem iguais com /api/pontos montado', async () => {
      expect((await request(app).get('/api/ocorrencias').set('Cookie', gestora)).status).toBe(200);
      expect((await request(app).get('/api/ocorrencias')).status).toBe(401);
      expect((await request(app).get('/api/ocorrencias/protocolo/ECO-2026-DEMA-9JTU')).status).toBe(200);
      expect((await request(app).get('/api/saude')).status).toBe(200);
    });
  });
});
