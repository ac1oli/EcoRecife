// Testes do guia de reciclagem com um banco falso (sem PostgreSQL): validações,
// campos públicos, SQL parametrizado, proteção das rotas do admin e transações.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { criarApp } from '../src/app.js';
import { criarArmazenamentoDisco } from '../src/ocorrencias/fotos.js';
import { gerarToken, hashToken } from '../src/auth/sessoes.js';
import {
  esquemaEdicaoPonto,
  esquemaFiltros,
  esquemaNovoPonto,
  esquemaProximos,
  lerIdPonto,
} from '../src/pontos/pontos.js';

const ORIGEM = 'http://localhost:5173';

type Usuario = { id: string; nome: string; email: string; perfil: string };
type Resposta = (params: unknown[]) => { rows: unknown[]; rowCount?: number };

// Banco falso guiado por regras [padrão do SQL, resposta]. Sessões por token.
function criarBancoFalso() {
  const sessoes = new Map<string, Usuario>();
  const regras: [RegExp, Resposta | (() => never)][] = [];
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
    quando(padrao: RegExp, resposta: Resposta | (() => never)) {
      regras.unshift([padrao, resposta]);
    },
    sessao(usuario: Usuario) {
      const token = gerarToken();
      sessoes.set(hashToken(token).toString('hex'), usuario);
      return `eco_sessao=${token}`;
    },
    consultasDeNegocio: () => executados.filter((e) => !e.sql.startsWith('UPDATE sessoes s')),
    comandos: () => executados.map((e) => e.sql).filter((s) => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(s)),
  };
}

const ADMIN: Usuario = { id: '1', nome: 'Admin', email: 'admin@teste.example', perfil: 'admin' };
const GESTORA: Usuario = { id: '2', nome: 'Gestora', email: 'gestora@teste.example', perfil: 'gestor' };

const LINHA = {
  id: 7,
  tipo: 'ecoponto',
  nome: 'EcoPonto Teste',
  bairro: 'Torre',
  endereco: null,
  latitude: -8.0479,
  longitude: -34.9104,
  horario_funcionamento: '8h às 17h',
  situacao: 'Aberto para descarte',
  telefone: null,
  email: null,
  site: null,
  demonstrativo: true,
  fonte: null,
  verificado_em: null,
  materiais: [{ slug: 'reciclaveis', nome: 'Recicláveis secos' }],
  ativo: true,
  criado_em: new Date('2026-10-28T12:00:00.000Z'),
  atualizado_em: new Date('2026-10-28T12:00:00.000Z'),
};

const NOVO = {
  tipo: 'pev',
  nome: 'PEV Teste',
  bairro: 'Torre',
  latitude: -8.05,
  longitude: -34.9,
  materiais: ['reciclaveis', 'eletronicos'],
};

let banco: ReturnType<typeof criarBancoFalso>;
beforeEach(() => {
  banco = criarBancoFalso();
});

const app = () => criarApp({ origensCors: [ORIGEM], ambiente: 'test', sessaoHoras: 8, fotos: criarArmazenamentoDisco('nao-usada') }, banco as never);

// Respostas padrão de um ponto existente (id 7) e das tabelas de apoio.
function comPonto(atual: { demonstrativo: boolean; fonte: string | null } = { demonstrativo: true, fonte: null }) {
  banco.quando(/FROM pontos_descarte p JOIN bairros b ON b\.id = p\.bairro_id WHERE p\.id = \$1/, (p) => ({
    rows: p[0] === 7 ? [LINHA] : [],
  }));
  banco.quando(/^SELECT id FROM bairros WHERE lower\(nome\)/, (p) => ({
    rows: String(p[0]).toLowerCase() === 'torre' ? [{ id: 14 }] : [],
  }));
  banco.quando(/^SELECT id, slug FROM materiais/, (p) => ({
    rows: (p[0] as string[])
      .filter((s) => ['reciclaveis', 'eletronicos'].includes(s))
      .map((slug) => ({ id: slug === 'reciclaveis' ? 1 : 2, slug })),
  }));
  banco.quando(/^INSERT INTO pontos_descarte/, () => ({ rows: [{ id: 7 }] }));
  banco.quando(/^SELECT demonstrativo, fonte FROM pontos_descarte WHERE id = \$1 FOR UPDATE/, (p) => ({
    rows: p[0] === 7 ? [atual] : [],
  }));
  banco.quando(/^UPDATE pontos_descarte SET/, (p) => ({ rows: [], rowCount: p[0] === 7 ? 1 : 0 }));
  banco.quando(/^DELETE FROM ponto_materiais/, () => ({ rows: [] }));
  banco.quando(/^INSERT INTO ponto_materiais/, () => ({ rows: [] }));
}

// Rotas do admin, com um corpo válido para cada uma.
const ROTAS_ADMIN: [string, string, object?][] = [
  ['get', '/api/pontos/gestao'],
  ['get', '/api/pontos/7'],
  ['post', '/api/pontos', NOVO],
  ['patch', '/api/pontos/7', { situacao: 'Fechado' }],
  ['delete', '/api/pontos/7'],
];

function chamar(metodo: string, rota: string, corpo?: object) {
  const req = (request(app()) as unknown as Record<string, (r: string) => request.Test>)[metodo]!(rota);
  return corpo ? req.send(corpo) : req;
}

describe('validações', () => {
  it('lerIdPonto aceita só inteiros positivos dentro do integer', () => {
    expect(lerIdPonto('7')).toBe(7);
    expect(lerIdPonto('2147483647')).toBe(2_147_483_647);
    for (const invalido of ['0', '-1', '07', '1.5', 'abc', '2147483648', '99999999999', '', '7;DROP']) {
      expect(() => lerIdPonto(invalido), invalido).toThrow('Ponto não encontrado');
    }
  });

  it('filtros: tipo do enum e material em formato de slug', () => {
    expect(esquemaFiltros.parse({})).toEqual({});
    expect(esquemaFiltros.parse({ tipo: 'pev', material: 'oleo_vegetal' })).toEqual({ tipo: 'pev', material: 'oleo_vegetal' });
    expect(esquemaFiltros.parse({ tipo: '', material: ' ' })).toEqual({});
    expect(esquemaFiltros.safeParse({ tipo: 'aterro' }).success).toBe(false);
    expect(esquemaFiltros.safeParse({ material: "x' OR 1=1--" }).success).toBe(false);
    expect(esquemaFiltros.safeParse({ tipo: ['pev', 'ecoponto'] }).success).toBe(false);
  });

  it('próximos: lat e lng obrigatórias e no intervalo; limite de 1 a 10, padrão 3', () => {
    expect(esquemaProximos.parse({ lat: '-8.057', lng: '-34.899' })).toEqual({ lat: -8.057, lng: -34.899, limite: 3 });
    expect(esquemaProximos.parse({ lat: '0', lng: '0', limite: '10' }).limite).toBe(10);
    for (const invalido of [
      {},
      { lat: '-8' },
      { lng: '-34' },
      { lat: '', lng: '' },
      { lat: '91', lng: '0' },
      { lat: '0', lng: '-181' },
      { lat: 'abc', lng: '0' },
      { lat: 'Infinity', lng: '0' },
      { lat: '0', lng: '0', limite: '0' },
      { lat: '0', lng: '0', limite: '11' },
      { lat: '0', lng: '0', limite: '2.5' },
    ]) {
      expect(esquemaProximos.safeParse(invalido).success, JSON.stringify(invalido)).toBe(false);
    }
  });

  it('novo ponto: padrões, materiais sem repetição e textos vazios como nulos', () => {
    const dados = esquemaNovoPonto.parse({ ...NOVO, materiais: ['reciclaveis', 'reciclaveis'], endereco: '  ' });
    expect(dados.demonstrativo).toBe(true);
    expect(dados.materiais).toEqual(['reciclaveis']);
    expect(dados.endereco).toBeNull();
    expect(esquemaNovoPonto.parse({ ...NOVO, materiais: undefined }).materiais).toEqual([]);
  });

  it('novo ponto não demonstrativo exige fonte (CHECK pontos_fonte_obrigatoria)', () => {
    const semFonte = esquemaNovoPonto.safeParse({ ...NOVO, demonstrativo: false });
    expect(semFonte.success).toBe(false);
    expect(semFonte.error?.issues[0]?.message).toBe('Ponto não demonstrativo exige a fonte do dado');
    expect(esquemaNovoPonto.safeParse({ ...NOVO, demonstrativo: false, fonte: '' }).success).toBe(false);
    expect(esquemaNovoPonto.safeParse({ ...NOVO, demonstrativo: false, fonte: 'https://exemplo.gov.br/ecopontos' }).success).toBe(true);
  });

  it('novo ponto: recusa campos inválidos', () => {
    const casos: object[] = [
      { tipo: 'aterro' },
      { nome: '' },
      { nome: 'x'.repeat(121) },
      { bairro: '' },
      { latitude: '-8' }, // JSON: coordenadas são números
      { latitude: -91 },
      { longitude: 181 },
      { site: 'javascript:alert(1)' },
      { site: 'data:text/html,oi' },
      { site: 'não é url' },
      { email: 'sem-arroba' },
      { telefone: '<script>' },
      { verificadoEm: '28/10/2026' },
      { verificadoEm: '2026-02-30' },
      { demonstrativo: 'false' },
      { materiais: 'reciclaveis' },
      { materiais: ['Recicláveis'] },
      { materiais: Array.from({ length: 21 }, (_, i) => `m${i}`) },
      { fonte: 'x'.repeat(501) },
    ];
    for (const caso of casos) {
      expect(esquemaNovoPonto.safeParse({ ...NOVO, ...caso }).success, JSON.stringify(caso)).toBe(false);
    }
    expect(esquemaNovoPonto.safeParse({ ...NOVO, site: 'https://exemplo.org/ponto', email: 'a@b.org', telefone: '(81) 3355-0000', verificadoEm: '2026-10-01' }).success).toBe(true);
  });

  it('edição: exige ao menos um campo; null limpa opcionais, mas não obrigatórios', () => {
    expect(esquemaEdicaoPonto.safeParse({}).success).toBe(false);
    expect(esquemaEdicaoPonto.safeParse({ campoDesconhecido: 1 }).success).toBe(false);
    expect(esquemaEdicaoPonto.parse({ telefone: null })).toEqual({ telefone: null });
    expect(esquemaEdicaoPonto.parse({ site: '' })).toEqual({ site: null });
    expect(esquemaEdicaoPonto.safeParse({ nome: null }).success).toBe(false);
    expect(esquemaEdicaoPonto.safeParse({ latitude: null }).success).toBe(false);
    expect(esquemaEdicaoPonto.parse({ ativo: true })).toEqual({ ativo: true });
  });
});

describe('rotas públicas', () => {
  it('GET /api/pontos lista só ativos, com campos públicos e SQL parametrizado', async () => {
    banco.quando(/^SELECT .* FROM pontos_descarte p/, () => ({ rows: [LINHA] }));
    const resposta = await request(app()).get('/api/pontos?tipo=ecoponto&material=reciclaveis');
    expect(resposta.status).toBe(200);
    expect(resposta.body.itens).toHaveLength(1);
    const item = resposta.body.itens[0];
    expect(Object.keys(item).sort()).toEqual(
      [
        'id', 'tipo', 'nome', 'bairro', 'endereco', 'latitude', 'longitude', 'horarioFuncionamento', 'situacao',
        'telefone', 'email', 'site', 'materiais', 'demonstrativo', 'fonte', 'verificadoEm',
      ].sort(),
    );
    expect(item).not.toHaveProperty('ativo');
    const [consulta] = banco.consultasDeNegocio();
    expect(consulta!.params).toEqual([true, 'ecoponto', 'reciclaveis']);
    expect(consulta!.sql).toContain('p.ativo = $1');
    expect(consulta!.sql).not.toContain('reciclaveis');
  });

  it('GET /api/pontos com filtro inválido responde 400 sem consultar o banco', async () => {
    for (const rota of ['/api/pontos?tipo=aterro', "/api/pontos?material=a'b", '/api/pontos?tipo=pev&tipo=ecoponto']) {
      const resposta = await request(app()).get(rota);
      expect(resposta.status, rota).toBe(400);
      expect(resposta.body.erro).toBeTruthy();
    }
    expect(banco.consultasDeNegocio()).toHaveLength(0);
  });

  it('GET /api/pontos/proximos usa distancia_km com parâmetros e arredonda a 2 casas', async () => {
    banco.quando(/distancia_km\(\$1::float8, \$2::float8/, () => ({ rows: [{ ...LINHA, distancia_km: 1.6149 }] }));
    const resposta = await request(app()).get('/api/pontos/proximos?lat=-8.057&lng=-34.899&material=eletronicos');
    expect(resposta.status).toBe(200);
    expect(resposta.headers['cache-control']).toBe('private, no-store');
    expect(resposta.body.itens[0].distanciaKm).toBe(1.61);
    expect(resposta.body.itens[0]).not.toHaveProperty('ativo');
    const [consulta] = banco.consultasDeNegocio();
    expect(consulta!.params).toEqual([-8.057, -34.899, true, 'eletronicos', 3]);
    expect(consulta!.sql).toMatch(/ORDER BY distancia_km\(.*\), p\.id LIMIT \$5$/);
  });

  it('GET /api/pontos/proximos sem coordenadas ou com limite fora do intervalo responde 400', async () => {
    for (const rota of ['/api/pontos/proximos', '/api/pontos/proximos?lat=-8', '/api/pontos/proximos?lat=0&lng=0&limite=50']) {
      expect((await request(app()).get(rota)).status, rota).toBe(400);
    }
    expect(banco.consultasDeNegocio()).toHaveLength(0);
  });

  it('as rotas públicas não exigem sessão nem aceitam escrita sem login', async () => {
    banco.quando(/^SELECT .* FROM pontos_descarte p/, () => ({ rows: [] }));
    expect((await request(app()).get('/api/pontos')).status).toBe(200);
    expect((await request(app()).post('/api/pontos').send(NOVO)).status).toBe(401);
  });
});

describe('rotas do admin: autorização', () => {
  it.each(ROTAS_ADMIN)('%s %s sem sessão: 401, sem consultar pontos', async (metodo, rota, corpo) => {
    const resposta = await chamar(metodo, rota, corpo);
    expect(resposta.status).toBe(401);
    expect(banco.consultasDeNegocio()).toHaveLength(0);
  });

  it.each(ROTAS_ADMIN)('%s %s com perfil gestor: 403, sem consultar pontos', async (metodo, rota, corpo) => {
    const cookie = banco.sessao(GESTORA);
    const req = (request(app()) as unknown as Record<string, (r: string) => request.Test>)[metodo]!(rota).set('Cookie', cookie);
    const resposta = await (corpo ? req.send(corpo) : req);
    expect(resposta.status).toBe(403);
    expect(banco.consultasDeNegocio()).toHaveLength(0);
  });

  it.each(ROTAS_ADMIN)('%s %s com perfil admin: autorizado', async (metodo, rota, corpo) => {
    comPonto();
    banco.quando(/^SELECT .* FROM pontos_descarte p JOIN bairros b ON b\.id = p\.bairro_id ORDER BY/, () => ({ rows: [LINHA] }));
    const cookie = banco.sessao(ADMIN);
    const req = (request(app()) as unknown as Record<string, (r: string) => request.Test>)[metodo]!(rota).set('Cookie', cookie);
    const resposta = await (corpo ? req.send(corpo) : req);
    expect([200, 201, 204]).toContain(resposta.status);
  });

  it('escrita com Origin de outro site: 403 antes até da sessão', async () => {
    const cookie = banco.sessao(ADMIN);
    const resposta = await request(app()).post('/api/pontos').set('Origin', 'https://outro.example').set('Cookie', cookie).send(NOVO);
    expect(resposta.status).toBe(403);
    expect(banco.executados).toHaveLength(0);
  });
});

describe('rotas do admin: dados e transações', () => {
  const comAdmin = (req: request.Test) => req.set('Cookie', banco.sessao(ADMIN));

  it('GET /gestao inclui ativo e datas, e filtra pela situação', async () => {
    banco.quando(/^SELECT .* FROM pontos_descarte p/, () => ({ rows: [{ ...LINHA, ativo: false }] }));
    const resposta = await comAdmin(request(app()).get('/api/pontos/gestao?ativo=false'));
    expect(resposta.status).toBe(200);
    expect(resposta.headers['cache-control']).toBe('private, no-store');
    expect(resposta.body.itens[0]).toMatchObject({ ativo: false, criadoEm: LINHA.criado_em.toISOString() });
    expect(banco.consultasDeNegocio()[0]!.params).toEqual([false]);
    expect((await comAdmin(request(app()).get('/api/pontos/gestao?ativo=talvez'))).status).toBe(400);
  });

  it('GET /:id de ponto inexistente ou id inválido: 404', async () => {
    comPonto();
    expect((await comAdmin(request(app()).get('/api/pontos/8'))).status).toBe(404);
    expect((await comAdmin(request(app()).get('/api/pontos/abc'))).status).toBe(404);
  });

  it('POST cria numa transação, grava materiais e responde 201 com Location', async () => {
    comPonto();
    const resposta = await comAdmin(request(app()).post('/api/pontos').send({ ...NOVO, ativo: false, id: 99 }));
    expect(resposta.status).toBe(201);
    expect(resposta.headers.location).toBe('/api/pontos/7');
    expect(resposta.body.id).toBe(7);
    expect(banco.comandos()).toEqual(['BEGIN', 'COMMIT']);
    const insercao = banco.executados.find((e) => e.sql.startsWith('INSERT INTO pontos_descarte'))!;
    expect(insercao.sql).not.toMatch(/[(,] ?ativo\b/); // "ativo" e "id" do corpo são ignorados
    expect(insercao.params).toEqual(['pev', 'PEV Teste', 14, null, -8.05, -34.9, null, null, null, null, null, true, null, null]);
    const materiais = banco.executados.find((e) => e.sql.startsWith('INSERT INTO ponto_materiais'))!;
    expect(materiais.params).toEqual([7, [1, 2]]);
  });

  it('POST com bairro desconhecido: 400 e ROLLBACK', async () => {
    comPonto();
    const resposta = await comAdmin(request(app()).post('/api/pontos').send({ ...NOVO, bairro: 'Atlântida' }));
    expect(resposta.status).toBe(400);
    expect(resposta.body.erro).toMatch(/Bairro não encontrado/);
    expect(banco.comandos()).toEqual(['BEGIN', 'ROLLBACK']);
    expect(banco.cliente.release).toHaveBeenCalled();
  });

  it('POST com material desconhecido: 400 e ROLLBACK, depois do INSERT do ponto', async () => {
    comPonto();
    const resposta = await comAdmin(request(app()).post('/api/pontos').send({ ...NOVO, materiais: ['reciclaveis', 'plutonio'] }));
    expect(resposta.status).toBe(400);
    expect(resposta.body.erro).toBe('Material inválido: plutonio');
    expect(banco.comandos()).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('POST com nome repetido no mesmo tipo: 409', async () => {
    comPonto();
    banco.quando(/^INSERT INTO pontos_descarte/, () => {
      throw Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'pontos_nome_unico' });
    });
    const resposta = await comAdmin(request(app()).post('/api/pontos').send(NOVO));
    expect(resposta.status).toBe(409);
    expect(resposta.body.erro).toBe('Já existe um ponto desse tipo com esse nome');
    expect(banco.comandos()).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('POST: erro inesperado do banco vira 500 genérico', async () => {
    comPonto();
    banco.quando(/^INSERT INTO pontos_descarte/, () => {
      throw Object.assign(new Error('detalhe interno'), { code: '23503' });
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const resposta = await comAdmin(request(app()).post('/api/pontos').send(NOVO));
    expect(resposta.status).toBe(500);
    expect(JSON.stringify(resposta.body)).not.toContain('detalhe interno');
  });

  it('PATCH atualiza só os campos enviados, com colunas da lista fixa', async () => {
    comPonto();
    const resposta = await comAdmin(
      request(app()).patch('/api/pontos/7').send({ situacao: 'Fechado', telefone: null, bairro: 'torre', bairro_id: 1 }),
    );
    expect(resposta.status).toBe(200);
    const atualizacao = banco.executados.find((e) => e.sql.startsWith('UPDATE pontos_descarte SET'))!;
    expect(atualizacao.sql).toBe('UPDATE pontos_descarte SET situacao = $2, telefone = $3, bairro_id = $4 WHERE id = $1');
    expect(atualizacao.params).toEqual([7, 'Fechado', null, 14]);
    expect(banco.comandos()).toEqual(['BEGIN', 'COMMIT']);
  });

  it('PATCH só de materiais troca a lista e renova atualizado_em', async () => {
    comPonto();
    const resposta = await comAdmin(request(app()).patch('/api/pontos/7').send({ materiais: [] }));
    expect(resposta.status).toBe(200);
    const sqls = banco.executados.map((e) => e.sql);
    expect(sqls).toContain('UPDATE pontos_descarte SET atualizado_em = now() WHERE id = $1');
    expect(sqls).toContain('DELETE FROM ponto_materiais WHERE ponto_id = $1');
    expect(sqls.some((s) => s.startsWith('INSERT INTO ponto_materiais'))).toBe(false);
  });

  it('PATCH confere a regra da fonte contra o estado final', async () => {
    comPonto({ demonstrativo: true, fonte: null });
    let resposta = await comAdmin(request(app()).patch('/api/pontos/7').send({ demonstrativo: false }));
    expect(resposta.status).toBe(400);
    expect(resposta.body.erro).toBe('Ponto não demonstrativo exige a fonte do dado');
    expect(banco.comandos()).toEqual(['BEGIN', 'ROLLBACK']);

    banco = criarBancoFalso();
    comPonto({ demonstrativo: false, fonte: 'https://exemplo.gov.br' });
    resposta = await comAdmin(request(app()).patch('/api/pontos/7').send({ fonte: null }));
    expect(resposta.status).toBe(400);

    banco = criarBancoFalso();
    comPonto({ demonstrativo: true, fonte: 'https://exemplo.gov.br' });
    resposta = await comAdmin(request(app()).patch('/api/pontos/7').send({ demonstrativo: false }));
    expect(resposta.status).toBe(200);
  });

  it('PATCH de ponto inexistente: 404 e ROLLBACK; corpo vazio: 400 sem transação', async () => {
    comPonto();
    expect((await comAdmin(request(app()).patch('/api/pontos/8').send({ situacao: 'x' }))).status).toBe(404);
    expect(banco.comandos()).toEqual(['BEGIN', 'ROLLBACK']);
    expect((await comAdmin(request(app()).patch('/api/pontos/7').send({}))).status).toBe(400);
    expect(banco.comandos()).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('DELETE desativa (não apaga): 204; inexistente: 404', async () => {
    comPonto();
    expect((await comAdmin(request(app()).delete('/api/pontos/7'))).status).toBe(204);
    const sqls = banco.consultasDeNegocio().map((e) => e.sql);
    expect(sqls).toEqual(['UPDATE pontos_descarte SET ativo = false WHERE id = $1']);
    expect(sqls.some((s) => s.startsWith('DELETE'))).toBe(false);
    expect((await comAdmin(request(app()).delete('/api/pontos/8'))).status).toBe(404);
  });
});
