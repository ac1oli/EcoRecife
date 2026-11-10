// Testes da gestão de ocorrências com um banco falso (sem PostgreSQL): regras de
// transição, proteção de cada rota, validações, rollback e envio de fotos.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarApp } from '../src/app.js';
import { criarArmazenamentoDisco } from '../src/ocorrencias/fotos.js';
import { gerarToken, hashToken } from '../src/auth/sessoes.js';
import { esquemaFiltros, lerIdFoto, lerIdOcorrencia, proximoStatus, type Acao } from '../src/ocorrencias/gestao.js';
import { PNG } from './apoio/imagens.js';

const ORIGEM = 'http://localhost:5173';
const FOTO_ID = '0b9c2a4e-1f3d-4c5b-8a7e-6d5c4b3a2f10';
const CHAVE = 'ocorrencias/3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b.png';

type Usuario = { id: string; nome: string; email: string; perfil: string };
type Resposta = (params: unknown[]) => { rows: unknown[]; rowCount?: number };

// Banco falso guiado por regras [padrão do SQL, resposta]. Sessões por token.
function criarBancoFalso() {
  const sessoes = new Map<string, Usuario>();
  const regras: [RegExp, Resposta][] = [];
  const executados: { sql: string; params: unknown[] }[] = [];

  async function responder(sql: string, params: unknown[] = []) {
    const texto = sql.replace(/\s+/g, ' ').trim();
    executados.push({ sql: texto, params });
    if (texto.startsWith('UPDATE sessoes s')) {
      const usuario = sessoes.get((params[0] as Buffer).toString('hex'));
      return { rows: usuario ? [usuario] : [], rowCount: usuario ? 1 : 0 };
    }
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(texto)) return { rows: [] };
    const regra = regras.find(([padrao]) => padrao.test(texto));
    if (!regra) throw new Error(`SQL inesperado no banco falso: ${texto}`);
    const resultado = regra[1](params);
    return { rowCount: resultado.rows.length, ...resultado };
  }

  const cliente = { query: vi.fn(responder), release: vi.fn() };
  return {
    query: vi.fn(responder),
    connect: vi.fn(async () => cliente),
    cliente,
    executados,
    quando(padrao: RegExp, resposta: Resposta) {
      regras.unshift([padrao, resposta]);
    },
    // Cria uma sessão e devolve o cabeçalho Cookie correspondente.
    sessao(usuario: Usuario) {
      const token = gerarToken();
      sessoes.set(hashToken(token).toString('hex'), usuario);
      return `eco_sessao=${token}`;
    },
    // Consultas que não são de sessão (para provar que a rota parou antes delas).
    consultasDeNegocio: () => executados.filter((e) => !e.sql.startsWith('UPDATE sessoes s')),
  };
}

const GESTORA: Usuario = { id: '2', nome: 'Gestora', email: 'gestora@teste.example', perfil: 'gestor' };
const ADMIN: Usuario = { id: '1', nome: 'Admin', email: 'admin@teste.example', perfil: 'admin' };

const LINHA = {
  id: '42',
  protocolo: 'ECO-2026-ABCD-EFGH',
  categoria_slug: 'descarte',
  categoria: 'Descarte irregular',
  bairro: 'Boa Viagem',
  endereco: 'Rua da Aurora, 100',
  descricao: 'Sofá na calçada',
  status: 'recebida',
  prioridade: 'media',
  criado_em: new Date('2026-10-27T12:00:00.000Z'),
  atualizado_em: new Date('2026-10-27T12:00:00.000Z'),
  concluido_em: null,
  demonstrativo: false,
  quantidade_fotos: 1,
  latitude: null,
  longitude: null,
  origem_localizacao: null,
  precisao_m: null,
  nota_conclusao: null,
};

// Respostas padrão de uma ocorrência existente (id 42) com uma foto.
function comOcorrencia(banco: ReturnType<typeof criarBancoFalso>, status = 'recebida') {
  banco.quando(/WHERE o\.id = \$1/, () => ({ rows: [{ ...LINHA, status }] }));
  banco.quando(/FROM ocorrencia_fotos WHERE ocorrencia_id = \$1/, () => ({
    rows: [{ id: FOTO_ID, ordem: 1, tipo_mime: 'image/png', tamanho_bytes: PNG.length }],
  }));
  banco.quando(/FROM ocorrencia_historico h LEFT JOIN usuarios/, () => ({
    rows: [{ status_anterior: null, status_novo: 'recebida', observacao: null, criado_em: LINHA.criado_em, responsavel: null }],
  }));
  banco.quando(/SELECT status FROM ocorrencias WHERE id = \$1 FOR UPDATE/, (p) => ({ rows: p[0] === '42' ? [{ status }] : [] }));
  banco.quando(/^UPDATE ocorrencias SET status/, () => ({ rows: [] }));
  banco.quando(/^INSERT INTO ocorrencia_historico/, () => ({ rows: [] }));
  banco.quando(/^UPDATE ocorrencias SET prioridade/, (p) => ({ rows: [], rowCount: p[0] === '42' ? 1 : 0 }));
}

let pasta: string;
let banco: ReturnType<typeof criarBancoFalso>;
beforeEach(async () => {
  pasta = await mkdtemp(path.join(tmpdir(), 'eco-gestao-'));
  banco = criarBancoFalso();
});
afterEach(async () => {
  await rm(pasta, { recursive: true, force: true });
});

const app = () =>
  criarApp({ origensCors: [ORIGEM], ambiente: 'test', sessaoHoras: 8, fotos: criarArmazenamentoDisco(pasta) }, banco as never);

// Todas as rotas da gestão, com um corpo válido para cada uma.
const ROTAS: [string, string, object?][] = [
  ['get', '/api/ocorrencias'],
  ['get', '/api/ocorrencias/42'],
  ['patch', '/api/ocorrencias/42/status', { status: 'em_analise' }],
  ['post', '/api/ocorrencias/42/concluir', {}],
  ['post', '/api/ocorrencias/42/reabrir', {}],
  ['patch', '/api/ocorrencias/42/prioridade', { prioridade: 'alta' }],
  ['get', `/api/ocorrencias/42/fotos/${FOTO_ID}`],
];

function chamar(metodo: string, rota: string, corpo?: object) {
  const req = (request(app()) as unknown as Record<string, (r: string) => request.Test>)[metodo]!(rota);
  return corpo ? req.send(corpo) : req;
}

describe('proximoStatus (docs/02, seção 3)', () => {
  const casos: [string, Acao, string | number][] = [
    ['recebida', { tipo: 'status', status: 'em_analise' }, 'em_analise'],
    ['recebida', { tipo: 'status', status: 'equipe_designada' }, 'equipe_designada'],
    ['em_analise', { tipo: 'status', status: 'recebida' }, 'recebida'],
    ['em_analise', { tipo: 'status', status: 'equipe_designada' }, 'equipe_designada'],
    ['equipe_designada', { tipo: 'status', status: 'em_analise' }, 'em_analise'],
    ['equipe_designada', { tipo: 'status', status: 'recebida' }, 'recebida'],
    ['recebida', { tipo: 'concluir' }, 'concluida'],
    ['em_analise', { tipo: 'concluir' }, 'concluida'],
    ['equipe_designada', { tipo: 'concluir' }, 'concluida'],
    ['concluida', { tipo: 'reabrir' }, 'em_analise'],
    ['recebida', { tipo: 'status', status: 'recebida' }, 409],
    ['em_analise', { tipo: 'status', status: 'em_analise' }, 409],
    ['concluida', { tipo: 'status', status: 'em_analise' }, 409],
    ['concluida', { tipo: 'status', status: 'recebida' }, 409],
    ['concluida', { tipo: 'concluir' }, 409],
    ['recebida', { tipo: 'reabrir' }, 409],
    ['em_analise', { tipo: 'reabrir' }, 409],
    ['equipe_designada', { tipo: 'reabrir' }, 409],
  ];
  it.each(casos)('%s + %j → %s', (atual, acao, esperado) => {
    if (typeof esperado === 'number') {
      expect(() => proximoStatus(atual as never, acao)).toThrow(expect.objectContaining({ status: 409 }));
    } else {
      expect(proximoStatus(atual as never, acao)).toBe(esperado);
    }
  });
});

describe('ids da URL e filtros', () => {
  it.each(['0', '-1', 'abc', '1.5', '1e3', '9'.repeat(19), "1 OR 1=1", ''])('id de ocorrência inválido (%s) vira 404', (id) => {
    expect(() => lerIdOcorrencia(id)).toThrow(expect.objectContaining({ status: 404 }));
  });
  it('aceita id inteiro positivo', () => {
    expect(lerIdOcorrencia('42')).toBe('42');
  });
  it('id de foto precisa ser UUID', () => {
    expect(lerIdFoto(FOTO_ID.toUpperCase())).toBe(FOTO_ID);
    expect(() => lerIdFoto('../../.env')).toThrow(expect.objectContaining({ status: 404 }));
  });
  it('filtros têm padrões e limites', () => {
    expect(esquemaFiltros.parse({})).toEqual({ pagina: 1, porPagina: 20 });
    expect(esquemaFiltros.parse({ fila: '', status: '', pagina: '2', porPagina: '50' })).toEqual({ pagina: 2, porPagina: 50 });
    for (const invalido of [{ porPagina: '51' }, { pagina: '0' }, { status: 'improcedente' }, { fila: 'todas' }, { busca: 'x'.repeat(101) }]) {
      expect(esquemaFiltros.safeParse(invalido).success).toBe(false);
    }
  });
});

describe('proteção de cada rota da gestão', () => {
  it.each(ROTAS)('%s %s sem sessão: 401, sem consultar ocorrências', async (metodo, rota, corpo) => {
    const resposta = await chamar(metodo, rota, corpo);
    expect(resposta.status).toBe(401);
    expect(banco.consultasDeNegocio()).toEqual([]);
  });

  it.each(ROTAS)('%s %s com perfil fora da lista: 403, sem consultar ocorrências', async (metodo, rota, corpo) => {
    // Perfil inexistente no banco: prova que cada rota passa por exigirPerfil.
    const cookie = banco.sessao({ ...GESTORA, perfil: 'visitante' });
    const resposta = await chamar(metodo, rota, corpo).set('Cookie', cookie);
    expect(resposta.status).toBe(403);
    expect(banco.consultasDeNegocio()).toEqual([]);
  });

  it.each(ROTAS)('%s %s com gestor: chega à regra de negócio', async (metodo, rota, corpo) => {
    comOcorrencia(banco);
    banco.quando(/^SELECT count\(\*\)::int AS total/, () => ({ rows: [{ total: 0 }] }));
    banco.quando(/ORDER BY o\.criado_em DESC/, () => ({ rows: [] }));
    banco.quando(/FROM ocorrencia_fotos WHERE id = \$1 AND ocorrencia_id = \$2/, () => ({ rows: [] }));
    const resposta = await chamar(metodo, rota, corpo).set('Cookie', banco.sessao(GESTORA));
    expect([401, 403]).not.toContain(resposta.status);
    expect(banco.consultasDeNegocio().length).toBeGreaterThan(0);
  });

  it('PATCH de outra origem: 403 antes de qualquer consulta, até a de sessão', async () => {
    const resposta = await request(app())
      .patch('/api/ocorrencias/42/status')
      .set('Origin', 'https://site-malicioso.example')
      .set('Cookie', banco.sessao(GESTORA))
      .send({ status: 'em_analise' });
    expect(resposta.status).toBe(403);
    expect(banco.executados).toEqual([]);
  });
});

describe('listagem', () => {
  it('monta o filtro só com parâmetros e escapa os curingas da busca', async () => {
    banco.quando(/^SELECT count\(\*\)::int AS total/, () => ({ rows: [{ total: 1 }] }));
    banco.quando(/ORDER BY o\.criado_em DESC/, () => ({ rows: [LINHA] }));
    const busca = "50%_x' OR '1'='1";
    const resposta = await request(app())
      .get('/api/ocorrencias')
      .query({ fila: 'ativas', status: 'recebida', bairro: 'boa viagem', categoria: 'descarte', prioridade: 'media', busca, pagina: 2, porPagina: 5 })
      .set('Cookie', banco.sessao(ADMIN));
    expect(resposta.status).toBe(200);
    expect(resposta.headers['cache-control']).toBe('private, no-store');
    const [contagem, pagina] = banco.consultasDeNegocio();
    for (const consulta of [contagem!, pagina!]) {
      expect(consulta.sql).not.toContain('OR \'1\'=\'1');
      expect(consulta.sql).not.toContain('boa viagem');
    }
    expect(contagem!.params).toEqual(['recebida', 'media', 'descarte', 'boa viagem', "%50\\%\\_x' OR '1'='1%"]);
    expect(pagina!.params.slice(-2)).toEqual([5, 5]);
    expect(resposta.body).toMatchObject({ pagina: 2, porPagina: 5, total: 1, totalPaginas: 1 });
    expect(resposta.body.itens[0]).toMatchObject({ id: '42', categoria: { slug: 'descarte', nome: 'Descarte irregular' } });
  });

  it.each([
    [{ porPagina: '100' }, 'porPagina deve ser de 1 a 50'],
    [{ status: 'improcedente' }, 'Status inválido'],
    [{ status: ['recebida', 'concluida'] }, 'Status inválido'],
  ])('filtro inválido %j: 400 sem consultar', async (query, mensagem) => {
    const resposta = await request(app()).get('/api/ocorrencias').query(query).set('Cookie', banco.sessao(GESTORA));
    expect(resposta.status).toBe(400);
    expect(resposta.body).toEqual({ erro: mensagem });
    expect(banco.consultasDeNegocio()).toEqual([]);
  });
});

describe('detalhe', () => {
  it('não expõe a chave de armazenamento e aponta a foto para a rota protegida', async () => {
    comOcorrencia(banco);
    const resposta = await request(app()).get('/api/ocorrencias/42').set('Cookie', banco.sessao(GESTORA));
    expect(resposta.status).toBe(200);
    expect(resposta.body.fotos).toEqual([
      { id: FOTO_ID, ordem: 1, tipoMime: 'image/png', tamanhoBytes: PNG.length, url: `/api/ocorrencias/42/fotos/${FOTO_ID}` },
    ]);
    expect(JSON.stringify(resposta.body)).not.toMatch(/chave|ocorrencias\/[0-9a-f]{8}-|senha|email/);
  });

  it('ocorrência inexistente: 404', async () => {
    banco.quando(/WHERE o\.id = \$1/, () => ({ rows: [] }));
    const resposta = await request(app()).get('/api/ocorrencias/999').set('Cookie', banco.sessao(GESTORA));
    expect(resposta.status).toBe(404);
    expect(resposta.body).toEqual({ erro: 'Ocorrência não encontrada' });
  });
});

describe('mudança de status', () => {
  it('usa o usuário da sessão no histórico, ignorando ids enviados no corpo', async () => {
    comOcorrencia(banco);
    const resposta = await request(app())
      .patch('/api/ocorrencias/42/status')
      .set('Cookie', banco.sessao(GESTORA))
      .send({ status: 'em_analise', observacao: '  Equipe avisada  ', usuarioId: '1', usuario_id: '1' });
    expect(resposta.status).toBe(200);
    const historico = banco.cliente.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO ocorrencia_historico'));
    expect(historico![1]).toEqual(['42', 'recebida', 'em_analise', '2', 'Equipe avisada']);
    const comandos = banco.cliente.query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0]);
    expect(comandos).toEqual(['BEGIN', 'SELECT', 'UPDATE', 'INSERT', 'COMMIT']);
    expect(banco.cliente.release).toHaveBeenCalledOnce();
  });

  it('concluir grava a nota no UPDATE e no histórico', async () => {
    comOcorrencia(banco, 'equipe_designada');
    const resposta = await request(app())
      .post('/api/ocorrencias/42/concluir')
      .set('Cookie', banco.sessao(ADMIN))
      .send({ nota: 'Recolhido' });
    expect(resposta.status).toBe(200);
    const chamadas = banco.cliente.query.mock.calls;
    expect(chamadas.find(([sql]) => String(sql).includes('UPDATE ocorrencias'))![1]).toEqual(['42', 'concluida', true, 'Recolhido']);
    expect(chamadas.find(([sql]) => String(sql).includes('INSERT INTO ocorrencia_historico'))![1]).toEqual([
      '42',
      'equipe_designada',
      'concluida',
      '1',
      'Recolhido',
    ]);
  });

  it('transição inválida: 409, ROLLBACK e nada alterado', async () => {
    comOcorrencia(banco, 'concluida');
    const resposta = await request(app())
      .patch('/api/ocorrencias/42/status')
      .set('Cookie', banco.sessao(GESTORA))
      .send({ status: 'em_analise' });
    expect(resposta.status).toBe(409);
    expect(resposta.body).toEqual({ erro: 'A ocorrência está concluída. Reabra-a antes de mudar o status.' });
    const comandos = banco.cliente.query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0]);
    expect(comandos).toEqual(['BEGIN', 'SELECT', 'ROLLBACK']);
  });

  it('falha ao gravar o histórico: ROLLBACK, 500 genérico e conexão devolvida', async () => {
    comOcorrencia(banco);
    banco.quando(/^INSERT INTO ocorrencia_historico/, () => {
      throw new Error('falha simulada (detalhe interno)');
    });
    const espiarErro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const resposta = await request(app())
      .patch('/api/ocorrencias/42/status')
      .set('Cookie', banco.sessao(GESTORA))
      .send({ status: 'em_analise' });
    espiarErro.mockRestore();
    expect(resposta.status).toBe(500);
    expect(resposta.body).toEqual({ erro: 'Erro interno do servidor' });
    const comandos = banco.cliente.query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0]);
    expect(comandos).toEqual(['BEGIN', 'SELECT', 'UPDATE', 'INSERT', 'ROLLBACK']);
    expect(banco.cliente.release).toHaveBeenCalledWith(undefined);
  });

  it.each([
    ['/status', { status: 'concluida' }, 'Status inválido: use recebida, em_analise ou equipe_designada (para concluir, use /concluir)'],
    ['/status', { status: 'improcedente' }, 'Status inválido: use recebida, em_analise ou equipe_designada (para concluir, use /concluir)'],
    ['/status', { status: 'em_analise', observacao: 'x'.repeat(501) }, 'Observação com no máximo 500 caracteres'],
    ['/concluir', { nota: 'x'.repeat(501) }, 'Nota com no máximo 500 caracteres'],
    ['/prioridade', { prioridade: 'altissima' }, 'Prioridade inválida'],
  ])('corpo inválido em %s: 400 sem abrir transação', async (sufixo, corpo, mensagem) => {
    const metodo = sufixo === '/concluir' ? 'post' : 'patch';
    const resposta = await chamar(metodo, `/api/ocorrencias/42${sufixo}`, corpo).set('Cookie', banco.sessao(GESTORA));
    expect(resposta.status).toBe(400);
    expect(resposta.body).toEqual({ erro: mensagem });
    expect(banco.connect).not.toHaveBeenCalled();
  });

  it('prioridade de ocorrência inexistente: 404', async () => {
    comOcorrencia(banco);
    const resposta = await request(app())
      .patch('/api/ocorrencias/7/prioridade')
      .set('Cookie', banco.sessao(GESTORA))
      .send({ prioridade: 'alta' });
    expect(resposta.status).toBe(404);
  });
});

describe('fotos', () => {
  async function gravarFoto(conteudo = PNG) {
    await mkdir(path.join(pasta, 'ocorrencias'), { recursive: true });
    await writeFile(path.join(pasta, ...CHAVE.split('/')), conteudo);
  }

  it('envia a foto com tipo, sem cache e com CORP same-site', async () => {
    await gravarFoto();
    banco.quando(/FROM ocorrencia_fotos WHERE id = \$1 AND ocorrencia_id = \$2/, (p) => ({
      rows: p[0] === FOTO_ID && p[1] === '42' ? [{ chave_armazenamento: CHAVE, tipo_mime: 'image/png' }] : [],
    }));
    const resposta = await request(app()).get(`/api/ocorrencias/42/fotos/${FOTO_ID}`).set('Cookie', banco.sessao(GESTORA));
    expect(resposta.status).toBe(200);
    expect(resposta.headers['content-type']).toBe('image/png');
    expect(resposta.headers['cache-control']).toBe('private, no-store');
    expect(resposta.headers['cross-origin-resource-policy']).toBe('same-site');
    expect(resposta.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(resposta.body)).toEqual(PNG);
  });

  it('foto de outra ocorrência: 404 (a consulta exige a ocorrência da URL)', async () => {
    await gravarFoto();
    banco.quando(/FROM ocorrencia_fotos WHERE id = \$1 AND ocorrencia_id = \$2/, (p) => ({
      rows: p[1] === '42' ? [{ chave_armazenamento: CHAVE, tipo_mime: 'image/png' }] : [],
    }));
    const resposta = await request(app()).get(`/api/ocorrencias/43/fotos/${FOTO_ID}`).set('Cookie', banco.sessao(GESTORA));
    expect(resposta.status).toBe(404);
    expect(resposta.body).toEqual({ erro: 'Foto não encontrada' });
  });

  it.each(['../../.env', 'ocorrencias/../../.env', '/etc/passwd', 'ocorrencias/foto.png'])(
    'chave fora do padrão no banco (%s): 404 sem ler o disco',
    async (chave) => {
      banco.quando(/FROM ocorrencia_fotos WHERE id = \$1/, () => ({ rows: [{ chave_armazenamento: chave, tipo_mime: 'image/png' }] }));
      const espiarErro = vi.spyOn(console, 'error').mockImplementation(() => {});
      const resposta = await request(app()).get(`/api/ocorrencias/42/fotos/${FOTO_ID}`).set('Cookie', banco.sessao(GESTORA));
      espiarErro.mockRestore();
      expect(resposta.status).toBe(404);
      expect(resposta.body).toEqual({ erro: 'Foto não encontrada' });
    },
  );

  it('arquivo ausente no disco: 404 sem revelar o caminho', async () => {
    banco.quando(/FROM ocorrencia_fotos WHERE id = \$1/, () => ({ rows: [{ chave_armazenamento: CHAVE, tipo_mime: 'image/png' }] }));
    const espiarErro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const resposta = await request(app()).get(`/api/ocorrencias/42/fotos/${FOTO_ID}`).set('Cookie', banco.sessao(GESTORA));
    espiarErro.mockRestore();
    expect(resposta.status).toBe(404);
    expect(JSON.stringify(resposta.body)).not.toMatch(/ocorrencias\/|eco-gestao/);
  });

  it('id de foto inválido: 404 sem consultar', async () => {
    const resposta = await request(app()).get('/api/ocorrencias/42/fotos/..%2F..%2F.env').set('Cookie', banco.sessao(GESTORA));
    expect(resposta.status).toBe(404);
    expect(banco.consultasDeNegocio()).toEqual([]);
  });

  it('a pasta de uploads não é servida como estática, nem com sessão', async () => {
    await gravarFoto();
    const cookie = banco.sessao(GESTORA);
    for (const rota of [`/${CHAVE}`, `/uploads/${CHAVE}`, `/api/${CHAVE}`, `/api/uploads/${CHAVE}`]) {
      const resposta = await request(app()).get(rota).set('Cookie', cookie);
      expect(resposta.status).toBe(404);
      expect(resposta.headers['content-type']).not.toMatch(/^image\//);
    }
  });
});
