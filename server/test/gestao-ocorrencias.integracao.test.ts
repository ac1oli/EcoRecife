// Gestão de ocorrências com um PostgreSQL de verdade, num banco temporário (veja test/apoio).
// Só roda se TEST_DATABASE_URL estiver definida. As fotos vão para uma pasta temporária.
import bcrypt from 'bcryptjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { criarApp } from '../src/app.js';
import { criarArmazenamentoDisco } from '../src/ocorrencias/fotos.js';
import { migrar, semear } from '../src/banco/migrador.js';
import { criarBancoTemporario, URL_ADMIN } from './apoio/banco-temporario.js';
import { JPEG, PNG } from './apoio/imagens.js';

const SENHA = 'frase longa de teste 2026';

function cookieDe(resposta: request.Response): string {
  const cabecalho = ([] as string[]).concat(resposta.headers['set-cookie'] ?? [])[0];
  if (!cabecalho) throw new Error('resposta sem Set-Cookie');
  return cabecalho.split(';')[0]!;
}

describe.skipIf(!URL_ADMIN)('integração: gestão de ocorrências', { timeout: 60_000 }, () => {
  let banco: Awaited<ReturnType<typeof criarBancoTemporario>>;
  let pasta: string;
  let app: ReturnType<typeof criarApp>;
  let gestora: string; // cookie
  let admin: string; // cookie
  let idGestora: string;
  let criada: { id: string; protocolo: string; fotos: { id: string; url: string }[] };

  const contar = async (sql: string, params: unknown[] = []) =>
    (await banco.pool.query(`SELECT count(*)::int AS n FROM ${sql}`, params)).rows[0].n as number;
  const get = (rota: string, cookie = gestora) => request(app).get(rota).set('Cookie', cookie);

  async function criarUsuario(nome: string, email: string, perfil: 'admin' | 'gestor') {
    const { rows } = await banco.pool.query(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES ($1, $2, $3, $4) RETURNING id::text AS id`,
      [nome, email, bcrypt.hashSync(SENHA, 4), perfil],
    );
    return rows[0].id as string;
  }
  async function logar(email: string) {
    const resposta = await request(app).post('/api/auth/login').send({ email, senha: SENHA });
    expect(resposta.status).toBe(200);
    return cookieDe(resposta);
  }

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    await migrar(banco.pool);
    await semear(banco.pool);
    pasta = await mkdtemp(path.join(tmpdir(), 'eco-gestao-int-'));
    app = criarApp(
      { origensCors: ['http://localhost:5173'], ambiente: 'test', sessaoHoras: 8, fotos: criarArmazenamentoDisco(pasta) },
      banco.pool,
    );
    idGestora = await criarUsuario('Gestora Teste', 'gestora@teste.example', 'gestor');
    await criarUsuario('Admin Teste', 'admin@teste.example', 'admin');
    gestora = await logar('gestora@teste.example');
    admin = await logar('admin@teste.example');

    // Ocorrência registrada pela rota pública (parte 3), com 2 fotos.
    const registro = await request(app)
      .post('/api/ocorrencias')
      .field('categoria', 'lixeira')
      .field('bairro', 'Torre')
      .field('endereco', 'Rua Teste, 1')
      .field('descricao', 'Lixeira quebrada, telefone do vizinho 99999-0000')
      .attach('fotos', PNG, 'a.png')
      .attach('fotos', JPEG, 'b.jpg');
    expect(registro.status).toBe(201);
    const { rows } = await banco.pool.query('SELECT id::text AS id FROM ocorrencias WHERE protocolo = $1', [
      registro.body.protocolo,
    ]);
    const detalhe = await get(`/api/ocorrencias/${rows[0].id}`);
    criada = { id: rows[0].id, protocolo: registro.body.protocolo, fotos: detalhe.body.fotos };
  });
  afterAll(async () => {
    await banco?.apagar();
    await rm(pasta, { recursive: true, force: true });
  });

  describe('listagem, filtros e paginação', () => {
    it('lista tudo, da mais recente para a mais antiga, com o total do banco', async () => {
      const resposta = await get('/api/ocorrencias?porPagina=50');
      expect(resposta.status).toBe(200);
      expect(resposta.body.total).toBe(await contar('ocorrencias'));
      expect(resposta.body.itens[0].protocolo).toBe(criada.protocolo);
      const datas = resposta.body.itens.map((i: { criadoEm: string }) => Date.parse(i.criadoEm));
      expect([...datas].sort((a, b) => b - a)).toEqual(datas);
    });

    it.each([
      ['fila=ativas', "ocorrencias WHERE status <> 'concluida'"],
      ['fila=concluidas', "ocorrencias WHERE status = 'concluida'"],
      ['status=em_analise', "ocorrencias WHERE status = 'em_analise'"],
      ['prioridade=urgente', "ocorrencias WHERE prioridade = 'urgente'"],
      ['categoria=lixeira', "ocorrencias o JOIN categorias_ocorrencia c ON c.id = o.categoria_id WHERE c.slug = 'lixeira'"],
      ['bairro=BOA%20VIAGEM', "ocorrencias o JOIN bairros b ON b.id = o.bairro_id WHERE b.nome = 'Boa Viagem'"],
      ['busca=DEMA', "ocorrencias WHERE protocolo LIKE '%DEMA%'"],
      ['busca=rua%20teste', "ocorrencias WHERE endereco ILIKE '%rua teste%'"],
      ['fila=ativas&categoria=descarte', "ocorrencias o JOIN categorias_ocorrencia c ON c.id = o.categoria_id WHERE c.slug = 'descarte' AND o.status <> 'concluida'"],
    ])('filtro %s confere com o banco', async (query, sql) => {
      const resposta = await get(`/api/ocorrencias?${query}&porPagina=50`);
      expect(resposta.status).toBe(200);
      const esperado = await contar(sql);
      expect(esperado).toBeGreaterThan(0);
      expect(resposta.body.total).toBe(esperado);
      expect(resposta.body.itens).toHaveLength(esperado);
    });

    it('busca com curinga é literal (% não casa com tudo)', async () => {
      const resposta = await get('/api/ocorrencias?busca=%25');
      expect(resposta.status).toBe(200);
      expect(resposta.body.total).toBe(0);
    });

    it('pagina sem repetir nem pular itens', async () => {
      const total = await contar('ocorrencias');
      const vistos: string[] = [];
      for (let pagina = 1; pagina <= Math.ceil(total / 3); pagina++) {
        const resposta = await get(`/api/ocorrencias?porPagina=3&pagina=${pagina}`);
        expect(resposta.body).toMatchObject({ pagina, porPagina: 3, total, totalPaginas: Math.ceil(total / 3) });
        vistos.push(...resposta.body.itens.map((i: { id: string }) => i.id));
      }
      expect(new Set(vistos).size).toBe(total);
      const alem = await get(`/api/ocorrencias?porPagina=3&pagina=${Math.ceil(total / 3) + 1}`);
      expect(alem.body).toMatchObject({ itens: [], total });
    });

    it('filtro inválido: 400', async () => {
      expect((await get('/api/ocorrencias?status=improcedente')).status).toBe(400);
    });
  });

  describe('detalhe', () => {
    it('traz dados internos para a gestão, mas nunca chave de arquivo, e-mail ou hash', async () => {
      const resposta = await get(`/api/ocorrencias/${criada.id}`);
      expect(resposta.status).toBe(200);
      expect(resposta.body).toMatchObject({
        id: criada.id,
        protocolo: criada.protocolo,
        categoria: { slug: 'lixeira', nome: 'Lixeira danificada' },
        bairro: 'Torre',
        status: 'recebida',
        prioridade: 'media',
        quantidadeFotos: 2,
        notaConclusao: null,
      });
      expect(resposta.body.fotos.map((f: { ordem: number; tipoMime: string }) => [f.ordem, f.tipoMime])).toEqual([
        [1, 'image/png'],
        [2, 'image/jpeg'],
      ]);
      expect(resposta.body.historico).toEqual([
        { statusAnterior: null, status: 'recebida', observacao: null, responsavel: null, em: expect.any(String) },
      ]);
      const texto = JSON.stringify(resposta.body);
      expect(texto).not.toMatch(/chave|ocorrencias\/[0-9a-f]{8}-|senha|\$2[aby]\$|@teste\.example|usuario_?id/i);
    });

    it('protocolo do seed concluído: 4 etapas no histórico', async () => {
      const { rows } = await banco.pool.query("SELECT id::text AS id FROM ocorrencias WHERE protocolo = 'ECO-2026-DEMA-9JTU'");
      const resposta = await get(`/api/ocorrencias/${rows[0].id}`);
      expect(resposta.body.status).toBe('concluida');
      expect(resposta.body.historico.map((h: { status: string }) => h.status)).toEqual([
        'recebida',
        'em_analise',
        'equipe_designada',
        'concluida',
      ]);
    });

    it('id inexistente ou inválido: 404', async () => {
      expect((await get('/api/ocorrencias/999999')).status).toBe(404);
      expect((await get('/api/ocorrencias/abc')).status).toBe(404);
    });
  });

  describe('transições de status e histórico', () => {
    const historico = (id: string) =>
      banco.pool
        .query(
          'SELECT status_anterior, status_novo, usuario_id::text AS usuario_id, observacao FROM ocorrencia_historico WHERE ocorrencia_id = $1 ORDER BY criado_em, id',
          [id],
        )
        .then((r) => r.rows);

    it('percorre o ciclo completo e registra cada troca com o responsável da sessão', async () => {
      const id = criada.id;
      const passo = (metodo: 'patch' | 'post', sufixo: string, corpo: object, cookie = gestora) =>
        request(app)[metodo](`/api/ocorrencias/${id}${sufixo}`).set('Cookie', cookie).send(corpo);

      let resposta = await passo('patch', '/status', { status: 'em_analise', observacao: 'Triagem', usuarioId: '999' });
      expect(resposta.status).toBe(200);
      expect(resposta.body.status).toBe('em_analise');
      expect(resposta.body.historico.at(-1)).toMatchObject({ status: 'em_analise', responsavel: 'Gestora Teste', observacao: 'Triagem' });

      expect((await passo('patch', '/status', { status: 'equipe_designada' })).status).toBe(200);
      // Correção entre estados ativos (como no protótipo).
      expect((await passo('patch', '/status', { status: 'recebida' })).status).toBe(200);
      // Mesmo status: 409 e nada gravado.
      expect((await passo('patch', '/status', { status: 'recebida' })).status).toBe(409);

      resposta = await passo('post', '/concluir', { nota: 'Lixeira substituída' }, admin);
      expect(resposta.status).toBe(200);
      expect(resposta.body).toMatchObject({ status: 'concluida', notaConclusao: 'Lixeira substituída' });
      expect(resposta.body.concluidoEm).not.toBeNull();

      // Concluída: não muda status nem conclui de novo; só reabre.
      expect((await passo('patch', '/status', { status: 'em_analise' })).status).toBe(409);
      expect((await passo('post', '/concluir', {})).status).toBe(409);

      resposta = await passo('post', '/reabrir', { observacao: 'Cidadão informou que voltou a quebrar' });
      expect(resposta.status).toBe(200);
      expect(resposta.body).toMatchObject({ status: 'em_analise', concluidoEm: null, notaConclusao: null });
      expect((await passo('post', '/reabrir', {})).status).toBe(409);

      const { rows: admins } = await banco.pool.query("SELECT id::text AS id FROM usuarios WHERE email = 'admin@teste.example'");
      expect(await historico(id)).toEqual([
        { status_anterior: null, status_novo: 'recebida', usuario_id: null, observacao: null },
        { status_anterior: 'recebida', status_novo: 'em_analise', usuario_id: idGestora, observacao: 'Triagem' },
        { status_anterior: 'em_analise', status_novo: 'equipe_designada', usuario_id: idGestora, observacao: null },
        { status_anterior: 'equipe_designada', status_novo: 'recebida', usuario_id: idGestora, observacao: null },
        { status_anterior: 'recebida', status_novo: 'concluida', usuario_id: admins[0].id, observacao: 'Lixeira substituída' },
        { status_anterior: 'concluida', status_novo: 'em_analise', usuario_id: idGestora, observacao: 'Cidadão informou que voltou a quebrar' },
      ]);
    });

    it('prioridade muda sem gerar histórico', async () => {
      const antes = await contar('ocorrencia_historico WHERE ocorrencia_id = $1', [criada.id]);
      const resposta = await request(app)
        .patch(`/api/ocorrencias/${criada.id}/prioridade`)
        .set('Cookie', gestora)
        .send({ prioridade: 'urgente' });
      expect(resposta.status).toBe(200);
      expect(resposta.body.prioridade).toBe('urgente');
      expect(await contar('ocorrencia_historico WHERE ocorrencia_id = $1', [criada.id])).toBe(antes);
    });

    it('falha real ao gravar o histórico: o status não muda (rollback)', async () => {
      await banco.pool.query(`
        CREATE FUNCTION falhar_historico() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'falha simulada no teste'; END $$;
        CREATE TRIGGER falhar_historico BEFORE INSERT ON ocorrencia_historico
          FOR EACH ROW EXECUTE FUNCTION falhar_historico();`);
      const antes = (await banco.pool.query('SELECT status, atualizado_em FROM ocorrencias WHERE id = $1', [criada.id])).rows[0];
      const espiarErro = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const resposta = await request(app)
          .patch(`/api/ocorrencias/${criada.id}/status`)
          .set('Cookie', gestora)
          .send({ status: 'equipe_designada' });
        expect(resposta.status).toBe(500);
        expect(resposta.body).toEqual({ erro: 'Erro interno do servidor' });
      } finally {
        espiarErro.mockRestore();
        await banco.pool.query('DROP TRIGGER falhar_historico ON ocorrencia_historico; DROP FUNCTION falhar_historico();');
      }
      const depois = (await banco.pool.query('SELECT status, atualizado_em FROM ocorrencias WHERE id = $1', [criada.id])).rows[0];
      expect(depois).toEqual(antes);
    });

    it('PATCH vindo de outro site: 403 e nada muda', async () => {
      const antes = await contar('ocorrencia_historico');
      const resposta = await request(app)
        .patch(`/api/ocorrencias/${criada.id}/status`)
        .set('Origin', 'https://site-malicioso.example')
        .set('Cookie', gestora)
        .send({ status: 'equipe_designada' });
      expect(resposta.status).toBe(403);
      expect(await contar('ocorrencia_historico')).toBe(antes);
    });
  });

  describe('fotos protegidas', () => {
    it('gestora logada recebe os bytes gravados', async () => {
      const resposta = await get(criada.fotos[0]!.url);
      expect(resposta.status).toBe(200);
      expect(resposta.headers['content-type']).toBe('image/png');
      expect(resposta.headers['cache-control']).toBe('private, no-store');
      expect(Buffer.from(resposta.body)).toEqual(PNG);
    });

    it('sem sessão: 401; foto de outra ocorrência ou inexistente: 404', async () => {
      expect((await request(app).get(criada.fotos[0]!.url)).status).toBe(401);
      const { rows } = await banco.pool.query("SELECT id::text AS id FROM ocorrencias WHERE protocolo = 'ECO-2026-DEMA-9JTU'");
      expect((await get(`/api/ocorrencias/${rows[0].id}/fotos/${criada.fotos[0]!.id}`)).status).toBe(404);
      expect((await get(`/api/ocorrencias/${criada.id}/fotos/00000000-0000-4000-8000-000000000000`)).status).toBe(404);
    });

    it('arquivo apagado do disco: 404', async () => {
      const { rows } = await banco.pool.query('SELECT chave_armazenamento FROM ocorrencia_fotos WHERE id = $1', [
        criada.fotos[1]!.id,
      ]);
      await rm(path.join(pasta, ...rows[0].chave_armazenamento.split('/')));
      const espiarErro = vi.spyOn(console, 'error').mockImplementation(() => {});
      const resposta = await get(criada.fotos[1]!.url);
      espiarErro.mockRestore();
      expect(resposta.status).toBe(404);
    });
  });

  describe('sessão e regressão', () => {
    it('todas as rotas recusam sem sessão, com usuário desativado e depois do logout', async () => {
      const rotas = [`/api/ocorrencias`, `/api/ocorrencias/${criada.id}`, criada.fotos[0]!.url];
      for (const rota of rotas) expect((await request(app).get(rota)).status).toBe(401);

      await criarUsuario('Temporário', 'temp@teste.example', 'gestor');
      const temp = await logar('temp@teste.example');
      expect((await get(rotas[0]!, temp)).status).toBe(200);
      await banco.pool.query("UPDATE usuarios SET ativo = false WHERE email = 'temp@teste.example'");
      for (const rota of rotas) expect((await get(rota, temp)).status).toBe(401);

      const outra = await logar('gestora@teste.example');
      expect((await request(app).post('/api/auth/logout').set('Cookie', outra)).status).toBe(204);
      for (const rota of rotas) expect((await get(rota, outra)).status).toBe(401);
    });

    it('a consulta pública continua mostrando só os campos públicos depois das ações da gestão', async () => {
      const resposta = await request(app).get(`/api/ocorrencias/protocolo/${criada.protocolo}`);
      expect(resposta.status).toBe(200);
      expect(Object.keys(resposta.body).sort()).toEqual([
        'bairro',
        'categoria',
        'concluidoEm',
        'criadoEm',
        'linhaDoTempo',
        'protocolo',
        'status',
      ]);
      expect(resposta.body.linhaDoTempo.length).toBeGreaterThan(1);
      for (const etapa of resposta.body.linhaDoTempo) expect(Object.keys(etapa).sort()).toEqual(['em', 'status', 'statusAnterior']);
      expect(JSON.stringify(resposta.body)).not.toMatch(/Triagem|Gestora|Lixeira substituída|urgente|99999/);
    });
  });
});
