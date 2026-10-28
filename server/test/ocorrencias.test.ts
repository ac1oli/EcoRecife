// Testes das rotas públicas de ocorrências com um banco falso (sem PostgreSQL).
// As fotos são gravadas numa pasta temporária, apagada depois de cada teste.
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarApp } from '../src/app.js';
import { LIMITE_FALHAS } from '../src/limite.js';
import { GIF, JPEG, PNG, pngComTamanho, TEXTO, WEBP } from './apoio/imagens.js';

const ORIGEM = 'http://localhost:5173';
const PROTOCOLO = 'ECO-2026-DEMA-9JTU';
const CRIADO_EM = new Date('2026-10-27T12:00:00.000Z');

type Opcoes = { falharEm?: RegExp; conflitosDeProtocolo?: number; semConexao?: boolean };

// Imita só as consultas de src/ocorrencias. A consulta pública devolve colunas a mais
// (descrição, endereço, coordenadas...) para provar que a API não as repassa.
function criarBancoFalso(opcoes: Opcoes = {}) {
  const comandos: string[] = [];
  const ocorrencias: unknown[][] = [];
  const historico: unknown[][] = [];
  const fotos: unknown[][] = [];
  let conflitos = opcoes.conflitosDeProtocolo ?? 0;

  const cliente = {
    release: vi.fn(),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const texto = sql.replace(/\s+/g, ' ').trim();
      comandos.push(texto.split(' ').slice(0, 3).join(' '));
      if (opcoes.falharEm?.test(texto)) throw new Error('falha simulada no banco (detalhe interno)');
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(texto)) return { rows: [] };
      if (texto.startsWith('SELECT (SELECT id FROM categorias_ocorrencia')) {
        const categoria = params[0] === 'descarte' ? 1 : null;
        const bairro = String(params[1]).toLowerCase() === 'boa viagem' ? 7 : null;
        return { rows: [{ categoria_id: categoria, bairro_id: bairro }] };
      }
      if (texto.startsWith('INSERT INTO ocorrencias ')) {
        if (conflitos-- > 0) {
          throw Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'ocorrencias_protocolo_key' });
        }
        ocorrencias.push(params);
        return { rows: [{ id: '42', protocolo: 'ECO-2026-ABCD-EFGH', status: 'recebida', criado_em: CRIADO_EM }] };
      }
      if (texto.startsWith('INSERT INTO ocorrencia_historico')) {
        historico.push(params);
        return { rows: [] };
      }
      if (texto.startsWith('INSERT INTO ocorrencia_fotos')) {
        fotos.push(params);
        return { rows: [] };
      }
      throw new Error(`SQL inesperado no banco falso: ${texto}`);
    }),
  };

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const texto = sql.replace(/\s+/g, ' ').trim();
    if (opcoes.falharEm?.test(texto)) throw new Error('falha simulada no banco (detalhe interno)');
    if (texto.includes('FROM ocorrencias o')) {
      if (params[0] !== PROTOCOLO) return { rows: [] };
      return {
        rows: [
          {
            id: '9',
            protocolo: PROTOCOLO,
            categoria: 'Descarte irregular',
            bairro: 'Boa Viagem',
            status: 'concluida',
            criado_em: CRIADO_EM,
            concluido_em: new Date('2026-10-27T14:00:00.000Z'),
            descricao: 'DESCRICAO-SIGILOSA',
            endereco: 'ENDERECO-SIGILOSO',
            latitude: -8.1,
            prioridade: 'urgente',
            nota_conclusao: 'NOTA-INTERNA',
          },
        ],
      };
    }
    if (texto.includes('FROM ocorrencia_historico')) {
      return {
        rows: [
          { status_anterior: null, status_novo: 'recebida', criado_em: CRIADO_EM, observacao: 'OBS-INTERNA', usuario_id: '3' },
          {
            status_anterior: 'recebida',
            status_novo: 'concluida',
            criado_em: new Date('2026-10-27T14:00:00.000Z'),
            observacao: 'OBS-INTERNA',
            usuario_id: '3',
          },
        ],
      };
    }
    throw new Error(`SQL inesperado no banco falso: ${texto}`);
  });

  const connect = vi.fn(async () => {
    if (opcoes.semConexao) throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
    return cliente;
  });
  return { query, connect, cliente, comandos, ocorrencias, historico, fotos };
}

let pasta: string;
let banco: ReturnType<typeof criarBancoFalso>;

beforeEach(async () => {
  pasta = await mkdtemp(path.join(tmpdir(), 'eco-fotos-'));
  banco = criarBancoFalso();
});
afterEach(async () => {
  await rm(pasta, { recursive: true, force: true });
});

const app = (b = banco, pastaUploads = pasta) =>
  criarApp({ origensCors: [ORIGEM], ambiente: 'test', sessaoHoras: 8, pastaUploads }, b as never);

async function arquivosGravados(): Promise<string[]> {
  try {
    return await readdir(path.join(pasta, 'ocorrencias'));
  } catch {
    return [];
  }
}

const CAMPOS = { categoria: 'descarte', bairro: 'Boa Viagem', endereco: 'Rua da Aurora, 100', descricao: 'Sofá na calçada' };

function formulario(alvo = app(), campos: Record<string, string> = CAMPOS) {
  const req = request(alvo).post('/api/ocorrencias');
  for (const [nome, valor] of Object.entries(campos)) req.field(nome, valor);
  return req;
}

describe('POST /api/ocorrencias: sucesso', () => {
  it('registra sem fotos e devolve só protocolo, status e data (201)', async () => {
    const resposta = await formulario();
    expect(resposta.status).toBe(201);
    expect(resposta.body).toEqual({
      protocolo: 'ECO-2026-ABCD-EFGH',
      status: 'recebida',
      criadoEm: CRIADO_EM.toISOString(),
    });
    expect(resposta.headers.location).toBe('/api/ocorrencias/protocolo/ECO-2026-ABCD-EFGH');
    expect(banco.ocorrencias).toEqual([[1, 7, 'Rua da Aurora, 100', 'Sofá na calçada', null, null, null, null]]);
    expect(banco.historico).toEqual([['42', 'recebida']]);
    expect(banco.comandos.at(0)).toBe('BEGIN');
    expect(banco.comandos.at(-1)).toBe('COMMIT');
    expect(banco.cliente.release).toHaveBeenCalledOnce();
    expect(await arquivosGravados()).toEqual([]);
  });

  it('grava 3 fotos com nome UUID e extensão do conteúdo, ignorando nome e MIME enviados', async () => {
    const resposta = await formulario()
      .attach('fotos', PNG, { filename: '../../malicioso.exe', contentType: 'application/octet-stream' })
      .attach('fotos', JPEG, { filename: 'foto.png', contentType: 'image/png' })
      .attach('fotos', WEBP, { filename: 'foto', contentType: 'text/plain' });
    expect(resposta.status).toBe(201);

    expect(banco.fotos.map(([id, ordem, , tipo, tamanho]) => [id, ordem, tipo, tamanho])).toEqual([
      ['42', 1, 'image/png', PNG.length],
      ['42', 2, 'image/jpeg', JPEG.length],
      ['42', 3, 'image/webp', WEBP.length],
    ]);
    const chaves = banco.fotos.map((linha) => linha[2] as string);
    const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
    expect(chaves[0]).toMatch(new RegExp(`^ocorrencias/${uuid}\\.png$`));
    expect(chaves[1]).toMatch(new RegExp(`^ocorrencias/${uuid}\\.jpg$`));
    expect(chaves[2]).toMatch(new RegExp(`^ocorrencias/${uuid}\\.webp$`));

    expect((await arquivosGravados()).sort()).toEqual(chaves.map((c) => c.split('/')[1]).sort());
    expect(await readFile(path.join(pasta, ...chaves[0]!.split('/')))).toEqual(PNG);
  });

  it('aceita uma foto de exatamente 5 MB', async () => {
    const resposta = await formulario().attach('fotos', pngComTamanho(5 * 1024 * 1024), 'grande.png');
    expect(resposta.status).toBe(201);
    expect(banco.fotos[0]![4]).toBe(5 * 1024 * 1024);
  });

  it('aceita coordenadas com origem e precisão, e bairro sem diferenciar maiúsculas', async () => {
    const resposta = await formulario(app(), {
      ...CAMPOS,
      bairro: '  BOA VIAGEM ',
      latitude: '-8.1196',
      longitude: '-34.9011',
      origemLocalizacao: 'gps',
      precisaoMetros: '12.5',
    });
    expect(resposta.status).toBe(201);
    expect(banco.ocorrencias[0]!.slice(4)).toEqual([-8.1196, -34.9011, 'gps', 12.5]);
  });

  it('ignora campos que o cidadão não pode definir (status, prioridade, demonstrativo...)', async () => {
    const resposta = await formulario(app(), {
      ...CAMPOS,
      status: 'concluida',
      prioridade: 'urgente',
      demonstrativo: 'true',
      protocolo: 'ECO-2026-AAAA-AAAA',
    });
    expect(resposta.status).toBe(201);
    expect(banco.ocorrencias[0]).toHaveLength(8);
    expect(banco.ocorrencias[0]).not.toContain('concluida');
    expect(banco.ocorrencias[0]).not.toContain('ECO-2026-AAAA-AAAA');
  });

  it('refaz a transação com outro protocolo se o gerado já existir', async () => {
    banco = criarBancoFalso({ conflitosDeProtocolo: 1 });
    const resposta = await formulario(app()).attach('fotos', PNG, 'a.png');
    expect(resposta.status).toBe(201);
    expect(banco.connect).toHaveBeenCalledTimes(2);
    expect(banco.comandos.filter((c) => c === 'ROLLBACK')).toHaveLength(1);
    expect(await arquivosGravados()).toHaveLength(1);
  });
});

describe('POST /api/ocorrencias: validação dos campos', () => {
  it.each([
    ['sem categoria', { ...CAMPOS, categoria: '' }, 'Categoria inválida'],
    ['categoria com caracteres inválidos', { ...CAMPOS, categoria: "descarte' OR 1=1" }, 'Categoria inválida'],
    ['sem bairro', { ...CAMPOS, bairro: '   ' }, 'Informe o bairro'],
    ['endereço só com espaços', { ...CAMPOS, endereco: '   ' }, 'Informe o endereço ou um ponto de referência'],
    ['descrição longa demais', { ...CAMPOS, descricao: 'x'.repeat(1001) }, 'Descrição pode ter no máximo 1000 caracteres'],
    ['endereço longo demais', { ...CAMPOS, endereco: 'x'.repeat(201) }, 'Endereço pode ter no máximo 200 caracteres'],
    ['latitude sem longitude', { ...CAMPOS, latitude: '-8.1', origemLocalizacao: 'gps' }, 'Informe latitude e longitude juntas'],
    ['coordenadas sem origem', { ...CAMPOS, latitude: '-8.1', longitude: '-34.9' }, 'Informe a origem da localização (gps ou manual)'],
    ['origem sem coordenadas', { ...CAMPOS, origemLocalizacao: 'manual' }, 'Origem da localização sem coordenadas'],
    ['precisão sem coordenadas', { ...CAMPOS, precisaoMetros: '10' }, 'Precisão informada sem coordenadas'],
    ['latitude não numérica', { ...CAMPOS, latitude: 'abc', longitude: '-34.9', origemLocalizacao: 'gps' }, 'Latitude inválida'],
    ['latitude fora do intervalo', { ...CAMPOS, latitude: '91', longitude: '-34.9', origemLocalizacao: 'gps' }, 'Latitude inválida'],
    ['origem desconhecida', { ...CAMPOS, latitude: '-8.1', longitude: '-34.9', origemLocalizacao: 'satelite' }, 'A origem da localização deve ser "gps" ou "manual"'],
  ])('recusa %s com 400, sem abrir transação', async (_caso, campos, mensagem) => {
    const resposta = await formulario(app(), campos as Record<string, string>).attach('fotos', PNG, 'a.png');
    expect(resposta.status).toBe(400);
    expect(resposta.body).toEqual({ erro: mensagem });
    expect(banco.connect).not.toHaveBeenCalled();
    expect(await arquivosGravados()).toEqual([]);
  });

  it('recusa campo repetido', async () => {
    const resposta = await formulario().field('categoria', 'lixeira');
    expect(resposta.status).toBe(400);
    expect(banco.connect).not.toHaveBeenCalled();
  });

  it.each([
    ['categoria inexistente', { ...CAMPOS, categoria: 'inexistente' }, 'Categoria inválida'],
    ['bairro fora da lista', { ...CAMPOS, bairro: 'Atlântida' }, 'Bairro não encontrado. Escolha um bairro da lista.'],
  ])('recusa %s com 400, desfaz a transação e não grava fotos', async (_caso, campos, mensagem) => {
    const resposta = await formulario(app(), campos).attach('fotos', PNG, 'a.png');
    expect(resposta.status).toBe(400);
    expect(resposta.body).toEqual({ erro: mensagem });
    expect(banco.comandos).toContain('ROLLBACK');
    expect(banco.comandos).not.toContain('COMMIT');
    expect(banco.ocorrencias).toEqual([]);
    expect(banco.cliente.release).toHaveBeenCalledOnce();
    expect(await arquivosGravados()).toEqual([]);
  });
});

describe('POST /api/ocorrencias: arquivos', () => {
  it.each([
    ['texto com nome e MIME de JPEG', TEXTO, { filename: 'foto.jpg', contentType: 'image/jpeg' }, 1],
    ['GIF (formato não aceito)', GIF, { filename: 'foto.png', contentType: 'image/png' }, 1],
    ['arquivo vazio', Buffer.alloc(0), { filename: 'vazio.png', contentType: 'image/png' }, 1],
  ])('recusa %s com 400', async (_caso, conteudo, info, numero) => {
    const resposta = await formulario().attach('fotos', conteudo, info);
    expect(resposta.status).toBe(400);
    expect(resposta.body.erro).toMatch(new RegExp(`^A foto ${numero} `));
    expect(banco.connect).not.toHaveBeenCalled();
    expect(await arquivosGravados()).toEqual([]);
  });

  it('recusa o pedido inteiro se só a segunda foto for inválida, sem gravar a primeira', async () => {
    const resposta = await formulario().attach('fotos', PNG, 'a.png').attach('fotos', TEXTO, 'b.jpg');
    expect(resposta.status).toBe(400);
    expect(resposta.body).toEqual({ erro: 'A foto 2 não é uma imagem JPEG, PNG ou WebP válida' });
    expect(await arquivosGravados()).toEqual([]);
  });

  it('recusa foto com mais de 5 MB (413)', async () => {
    const resposta = await formulario().attach('fotos', pngComTamanho(5 * 1024 * 1024 + 1), 'grande.png');
    expect(resposta.status).toBe(413);
    expect(resposta.body).toEqual({ erro: 'Cada foto pode ter no máximo 5 MB' });
    expect(banco.connect).not.toHaveBeenCalled();
  });

  it('recusa mais de 3 fotos', async () => {
    const req = formulario();
    for (let i = 0; i < 4; i++) req.attach('fotos', PNG, `f${i}.png`);
    const resposta = await req;
    expect(resposta.status).toBe(400);
    expect(resposta.body).toEqual({ erro: 'Envie no máximo 3 fotos' });
    expect(banco.connect).not.toHaveBeenCalled();
  });

  it('recusa arquivo em outro campo', async () => {
    const resposta = await formulario().attach('documento', PNG, 'a.png');
    expect(resposta.status).toBe(400);
    expect(resposta.body).toEqual({ erro: 'Envie as fotos no campo "fotos"' });
  });

  it('recusa JSON e pedido sem corpo com 415', async () => {
    const json = await request(app()).post('/api/ocorrencias').send(CAMPOS);
    expect(json.status).toBe(415);
    expect(json.body).toEqual({ erro: 'Envie o formulário como multipart/form-data' });
    expect((await request(app()).post('/api/ocorrencias')).status).toBe(415);
    expect(banco.connect).not.toHaveBeenCalled();
  });

  it('recusa multipart malformado com 400', async () => {
    const resposta = await request(app())
      .post('/api/ocorrencias')
      .set('Content-Type', 'multipart/form-data; boundary=limite')
      .send('--limite\r\nContent-Disposition: form-data; name="categoria"\r\n\r\ndescarte');
    expect(resposta.status).toBe(400);
    expect(resposta.body).toEqual({ erro: 'Formulário inválido' });
  });
});

describe('POST /api/ocorrencias: falhas sem deixar arquivos órfãos', () => {
  it.each([
    ['no registro da segunda foto', (sql: string, fotos: number) => sql.startsWith('INSERT INTO ocorrencia_fotos') && fotos === 2],
    ['no histórico', (sql: string) => sql.startsWith('INSERT INTO ocorrencia_historico')],
    ['no COMMIT', (sql: string) => sql === 'COMMIT'],
  ])('falha %s: 500 genérico, ROLLBACK e nenhum arquivo restante', async (_caso, deveFalhar) => {
    const original = banco.cliente.query.getMockImplementation()!;
    let fotosInseridas = 0;
    banco.cliente.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      const texto = sql.replace(/\s+/g, ' ').trim();
      if (texto.startsWith('INSERT INTO ocorrencia_fotos')) fotosInseridas++;
      if (deveFalhar(texto, fotosInseridas)) throw new Error('falha simulada no banco (detalhe interno)');
      return original(sql, params);
    });
    const espiarErro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const resposta = await formulario(app()).attach('fotos', PNG, 'a.png').attach('fotos', JPEG, 'b.jpg');
    espiarErro.mockRestore();

    expect(resposta.status).toBe(500);
    expect(resposta.body).toEqual({ erro: 'Erro interno do servidor' });
    expect(banco.cliente.query).toHaveBeenCalledWith('ROLLBACK');
    expect(banco.cliente.release).toHaveBeenCalledOnce();
    expect(await arquivosGravados()).toEqual([]);
  });

  it('banco fora do ar: 500 sem detalhes e nada gravado', async () => {
    banco = criarBancoFalso({ semConexao: true });
    const espiarErro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const resposta = await formulario(app()).attach('fotos', PNG, 'a.png');
    espiarErro.mockRestore();
    expect(resposta.status).toBe(500);
    expect(JSON.stringify(resposta.body)).not.toMatch(/ECONNREFUSED|5432/);
    expect(await arquivosGravados()).toEqual([]);
  });

  it('falha ao gravar no disco: ROLLBACK e 500', async () => {
    const arquivoNoLugarDaPasta = path.join(pasta, 'nao-e-pasta');
    await writeFile(arquivoNoLugarDaPasta, 'x');
    const espiarErro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const resposta = await formulario(app(banco, arquivoNoLugarDaPasta)).attach('fotos', PNG, 'a.png');
    espiarErro.mockRestore();
    expect(resposta.status).toBe(500);
    expect(banco.comandos).toContain('ROLLBACK');
    expect(banco.comandos).not.toContain('COMMIT');
  });

  it('desiste depois de 3 colisões de protocolo seguidas', async () => {
    banco = criarBancoFalso({ conflitosDeProtocolo: 3 });
    const espiarErro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const resposta = await formulario(app());
    espiarErro.mockRestore();
    expect(resposta.status).toBe(500);
    expect(banco.connect).toHaveBeenCalledTimes(3);
  });
});

describe('POST /api/ocorrencias: origem (CSRF)', () => {
  it('recusa formulário enviado por outro site, antes de ler o upload', async () => {
    const resposta = await formulario().set('Origin', 'https://site-malicioso.example').attach('fotos', PNG, 'a.png');
    expect(resposta.status).toBe(403);
    expect(resposta.body).toEqual({ erro: 'Origem da requisição não permitida' });
    expect(banco.connect).not.toHaveBeenCalled();
    expect(await arquivosGravados()).toEqual([]);
  });

  it('aceita o formulário do front configurado', async () => {
    expect((await formulario().set('Origin', ORIGEM)).status).toBe(201);
  });
});

describe('GET /api/ocorrencias/protocolo/:protocolo', () => {
  it('devolve só os campos públicos e a linha do tempo', async () => {
    const resposta = await request(app()).get(`/api/ocorrencias/protocolo/${PROTOCOLO}`);
    expect(resposta.status).toBe(200);
    expect(resposta.headers['cache-control']).toBe('no-store');
    expect(resposta.body).toEqual({
      protocolo: PROTOCOLO,
      categoria: 'Descarte irregular',
      bairro: 'Boa Viagem',
      status: 'concluida',
      criadoEm: '2026-10-27T12:00:00.000Z',
      concluidoEm: '2026-10-27T14:00:00.000Z',
      linhaDoTempo: [
        { statusAnterior: null, status: 'recebida', em: '2026-10-27T12:00:00.000Z' },
        { statusAnterior: 'recebida', status: 'concluida', em: '2026-10-27T14:00:00.000Z' },
      ],
    });
    expect(JSON.stringify(resposta.body)).not.toMatch(/SIGILOS|INTERNA|urgente|-8\.1|"id"|usuario/);
  });

  it('aceita o protocolo em minúsculas', async () => {
    const resposta = await request(app()).get(`/api/ocorrencias/protocolo/${PROTOCOLO.toLowerCase()}`);
    expect(resposta.status).toBe(200);
    expect(banco.query).toHaveBeenCalledWith(expect.any(String), [PROTOCOLO]);
  });

  it('responde 404 para protocolo inexistente', async () => {
    const resposta = await request(app()).get('/api/ocorrencias/protocolo/ECO-2026-ZZZZ-ZZZZ');
    expect(resposta.status).toBe(404);
    expect(resposta.body).toEqual({ erro: 'Protocolo não encontrado' });
  });

  it.each(['ECO-2026-0000-0000', 'ECO-26-ABCD-EFGH', "ECO-2026-ABCD-EFGH' OR '1'='1", 'qualquer-coisa'])(
    'responde 400 para formato inválido (%s) sem consultar o banco',
    async (protocolo) => {
      const resposta = await request(app()).get(`/api/ocorrencias/protocolo/${encodeURIComponent(protocolo)}`);
      expect(resposta.status).toBe(400);
      expect(resposta.body).toEqual({ erro: 'Protocolo inválido. Use o formato ECO-AAAA-XXXX-XXXX.' });
      expect(banco.query).not.toHaveBeenCalled();
    },
  );

  it('banco fora do ar: 500 sem detalhes', async () => {
    banco = criarBancoFalso({ falharEm: /FROM ocorrencias o/ });
    const espiarErro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const resposta = await request(app()).get(`/api/ocorrencias/protocolo/${PROTOCOLO}`);
    espiarErro.mockRestore();
    expect(resposta.status).toBe(500);
    expect(resposta.body).toEqual({ erro: 'Erro interno do servidor' });
  });

  it(`bloqueia com 429 depois de ${LIMITE_FALHAS} consultas sem sucesso, inclusive um protocolo válido`, async () => {
    const alvo = app();
    for (let i = 0; i < LIMITE_FALHAS; i++) {
      expect((await request(alvo).get('/api/ocorrencias/protocolo/ECO-2026-ZZZZ-ZZZZ')).status).toBe(404);
    }
    const bloqueada = await request(alvo).get(`/api/ocorrencias/protocolo/${PROTOCOLO}`);
    expect(bloqueada.status).toBe(429);
    expect(bloqueada.body).toEqual({ erro: 'Muitas consultas de protocolo sem sucesso. Tente novamente em alguns minutos.' });
    expect(bloqueada.headers['ratelimit-policy']).toBeDefined();
  });

  it('consultas bem-sucedidas não consomem o limite, e o limite do login é separado', async () => {
    const alvo = app();
    for (let i = 0; i < LIMITE_FALHAS + 2; i++) {
      expect((await request(alvo).get(`/api/ocorrencias/protocolo/${PROTOCOLO}`)).status).toBe(200);
    }
    for (let i = 0; i < LIMITE_FALHAS; i++) await request(alvo).get('/api/ocorrencias/protocolo/ECO-2026-ZZZZ-ZZZZ');
    // O contador do login é outro: as falhas de protocolo não o bloqueiam (400 = validação, não 429).
    const login = await request(alvo).post('/api/auth/login').send({});
    expect(login.status).toBe(400);
  });
});
