// Ocorrências com um PostgreSQL de verdade, num banco temporário (veja test/apoio).
// Só roda se TEST_DATABASE_URL estiver definida. As fotos vão para uma pasta temporária.
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { criarApp } from '../src/app.js';
import { migrar, semear } from '../src/banco/migrador.js';
import { criarBancoTemporario, URL_ADMIN } from './apoio/banco-temporario.js';
import { JPEG, PNG } from './apoio/imagens.js';

const CAMPOS = { categoria: 'entulho', bairro: 'boa viagem', endereco: 'Av. Boa Viagem, 500', descricao: 'Entulho na calçada' };
const CHAVES_PUBLICAS = ['bairro', 'categoria', 'concluidoEm', 'criadoEm', 'linhaDoTempo', 'protocolo', 'status'];

describe.skipIf(!URL_ADMIN)('integração: ocorrências públicas', { timeout: 60_000 }, () => {
  let banco: Awaited<ReturnType<typeof criarBancoTemporario>>;
  let pasta: string;
  let app: ReturnType<typeof criarApp>;

  const contar = async (tabela: string) =>
    (await banco.pool.query(`SELECT count(*)::int AS n FROM ${tabela}`)).rows[0].n as number;
  const arquivos = async () => readdir(path.join(pasta, 'ocorrencias')).catch(() => [] as string[]);

  function formulario(campos: Record<string, string> = CAMPOS) {
    const req = request(app).post('/api/ocorrencias');
    for (const [nome, valor] of Object.entries(campos)) req.field(nome, valor);
    return req;
  }

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    await migrar(banco.pool);
    await semear(banco.pool);
    pasta = await mkdtemp(path.join(tmpdir(), 'eco-fotos-int-'));
    app = criarApp(
      { origensCors: ['http://localhost:5173'], ambiente: 'test', sessaoHoras: 8, pastaUploads: pasta },
      banco.pool,
    );
  });
  afterAll(async () => {
    await banco?.apagar();
    await rm(pasta, { recursive: true, force: true });
  });

  it('registra ocorrência com 2 fotos: linha, histórico, fotos e arquivos coerentes', async () => {
    const resposta = await formulario({
      ...CAMPOS,
      latitude: '-8.119612',
      longitude: '-34.901104',
      origemLocalizacao: 'gps',
      precisaoMetros: '15',
      status: 'concluida',
    })
      .attach('fotos', PNG, 'a.png')
      .attach('fotos', JPEG, 'b.jpg');
    expect(resposta.status).toBe(201);
    expect(resposta.body.protocolo).toMatch(/^ECO-\d{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);

    const { rows } = await banco.pool.query(
      `SELECT o.id, o.status, o.prioridade, o.demonstrativo, o.endereco, o.latitude::float8 AS latitude,
              o.origem_localizacao, o.precisao_m::float8 AS precisao, b.nome AS bairro, c.slug AS categoria
         FROM ocorrencias o JOIN bairros b ON b.id = o.bairro_id JOIN categorias_ocorrencia c ON c.id = o.categoria_id
        WHERE o.protocolo = $1`,
      [resposta.body.protocolo],
    );
    expect(rows[0]).toMatchObject({
      status: 'recebida',
      prioridade: 'media',
      demonstrativo: false,
      endereco: 'Av. Boa Viagem, 500',
      latitude: -8.119612,
      origem_localizacao: 'gps',
      precisao: 15,
      bairro: 'Boa Viagem',
      categoria: 'entulho',
    });
    const id = rows[0].id;

    const historico = await banco.pool.query(
      'SELECT status_anterior, status_novo, usuario_id FROM ocorrencia_historico WHERE ocorrencia_id = $1',
      [id],
    );
    expect(historico.rows).toEqual([{ status_anterior: null, status_novo: 'recebida', usuario_id: null }]);

    const fotos = await banco.pool.query(
      'SELECT ordem, chave_armazenamento, tipo_mime, tamanho_bytes FROM ocorrencia_fotos WHERE ocorrencia_id = $1 ORDER BY ordem',
      [id],
    );
    expect(fotos.rows.map((f) => [f.ordem, f.tipo_mime, f.tamanho_bytes])).toEqual([
      [1, 'image/png', PNG.length],
      [2, 'image/jpeg', JPEG.length],
    ]);
    const primeira = fotos.rows[0].chave_armazenamento as string;
    expect(await readFile(path.join(pasta, ...primeira.split('/')))).toEqual(PNG);
    expect((await arquivos()).sort()).toEqual(fotos.rows.map((f) => f.chave_armazenamento.split('/')[1]).sort());
  });

  it('a consulta pública do protocolo criado mostra só os campos permitidos', async () => {
    const criada = await formulario();
    const resposta = await request(app).get(`/api/ocorrencias/protocolo/${criada.body.protocolo}`);
    expect(resposta.status).toBe(200);
    expect(Object.keys(resposta.body).sort()).toEqual(CHAVES_PUBLICAS);
    expect(resposta.body).toMatchObject({
      categoria: 'Acúmulo de entulho',
      bairro: 'Boa Viagem',
      status: 'recebida',
      concluidoEm: null,
    });
    expect(resposta.body.linhaDoTempo).toEqual([
      { statusAnterior: null, status: 'recebida', em: resposta.body.criadoEm },
    ]);
    expect(JSON.stringify(resposta.body)).not.toMatch(/Entulho na calçada|Av\. Boa Viagem|prioridade|media/);
  });

  it('protocolo demonstrativo do seed: concluída com 4 etapas, como em consultas_teste.sql', async () => {
    const resposta = await request(app).get('/api/ocorrencias/protocolo/ECO-2026-DEMA-9JTU');
    expect(resposta.status).toBe(200);
    expect(Object.keys(resposta.body).sort()).toEqual(CHAVES_PUBLICAS);
    expect(resposta.body.status).toBe('concluida');
    expect(resposta.body.concluidoEm).not.toBeNull();
    expect(resposta.body.linhaDoTempo.map((e: { status: string }) => e.status)).toEqual([
      'recebida',
      'em_analise',
      'equipe_designada',
      'concluida',
    ]);
    for (const etapa of resposta.body.linhaDoTempo) expect(Object.keys(etapa).sort()).toEqual(['em', 'status', 'statusAnterior']);
  });

  it('protocolo inexistente responde 404', async () => {
    expect((await request(app).get('/api/ocorrencias/protocolo/ECO-2026-ZZZZ-ZZZZ')).status).toBe(404);
  });

  it('bairro fora da lista: 400 e nada gravado', async () => {
    const antes = await contar('ocorrencias');
    const resposta = await formulario({ ...CAMPOS, bairro: 'Bairro Inexistente' }).attach('fotos', PNG, 'a.png');
    expect(resposta.status).toBe(400);
    expect(await contar('ocorrencias')).toBe(antes);
  });

  it('falha real do banco na segunda foto: tudo desfeito e nenhum arquivo órfão', async () => {
    // Gatilho só neste banco temporário: recusa a foto de ordem 2.
    await banco.pool.query(`
      CREATE FUNCTION falhar_foto() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.ordem = 2 THEN RAISE EXCEPTION 'falha simulada no teste'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER falhar_foto BEFORE INSERT ON ocorrencia_fotos FOR EACH ROW EXECUTE FUNCTION falhar_foto();`);
    const antes = {
      ocorrencias: await contar('ocorrencias'),
      historico: await contar('ocorrencia_historico'),
      fotos: await contar('ocorrencia_fotos'),
      arquivos: (await arquivos()).length,
    };
    const espiarErro = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const resposta = await formulario().attach('fotos', PNG, 'a.png').attach('fotos', JPEG, 'b.jpg');
      expect(resposta.status).toBe(500);
      expect(resposta.body).toEqual({ erro: 'Erro interno do servidor' });
    } finally {
      espiarErro.mockRestore();
      await banco.pool.query('DROP TRIGGER falhar_foto ON ocorrencia_fotos; DROP FUNCTION falhar_foto();');
    }
    expect({
      ocorrencias: await contar('ocorrencias'),
      historico: await contar('ocorrencia_historico'),
      fotos: await contar('ocorrencia_fotos'),
      arquivos: (await arquivos()).length,
    }).toEqual(antes);
    // A conexão devolvida ao pool continua utilizável.
    expect((await formulario()).status).toBe(201);
  });
});
