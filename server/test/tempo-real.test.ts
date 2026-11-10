// Coleta em tempo real (src/coleta/tempo-real.ts): Socket.IO de verdade, num servidor HTTP
// local (127.0.0.1, porta livre), com banco falso. O passo da simulação é controlado com
// timers falsos só para setInterval/clearInterval; os clientes conectam direto por
// WebSocket, sem o upgrade do polling (o único ponto do engine.io que usa setInterval).
import { createServer, type Server as ServidorHttp } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as cliente, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { criarApp } from '../src/app.js';
import { criarArmazenamentoDisco } from '../src/ocorrencias/fotos.js';
import { migrar, semear } from '../src/banco/migrador.js';
import { distanciaKm, type Posicao } from '../src/coleta/simulador.js';
import { EVENTO_POSICOES, iniciarTempoReal, type MensagemPosicoes, type TempoReal } from '../src/coleta/tempo-real.js';
import { criarBancoTemporario, URL_ADMIN } from './apoio/banco-temporario.js';

const ORIGEM = 'http://localhost:5173';
const CONFIG_APP = { origensCors: [ORIGEM], ambiente: 'test' as const, sessaoHoras: 8, fotos: criarArmazenamentoDisco('nao-usada') };
const CONFIG = { origensCors: [ORIGEM], simulacaoAtiva: true, simulacaoIntervaloMs: 3000 };

const linha = (veiculo: string | null, id: number, latitudes: number[]) => ({
  id,
  nome: `Rota ${id}`,
  demonstrativo: true,
  veiculo_codigo: veiculo,
  veiculo_descricao: veiculo && `Caminhão ${veiculo}`,
  veiculo_tipo_coleta: veiculo && 'domiciliar',
  veiculo_bairro: null,
  veiculo_demonstrativo: veiculo && true,
  pontos: latitudes.map((latitude, i) => ({ ordem: i + 1, latitude, longitude: -34.9 })),
});
const ROTAS = [linha('#04', 1, [-8.0, -8.001, -8.002, -8.0]), linha('#06', 2, [-8.1, -8.101, -8.1]), linha(null, 3, [-8.2, -8.201])];

let consultas: string[];
const bancoFalso = (falhar = false) => ({
  query: vi.fn(async (sql: string) => {
    consultas.push(sql);
    if (falhar) throw new Error('banco fora');
    return { rows: sql.includes('FROM rotas') ? ROTAS : [], rowCount: 0 };
  }),
  connect: vi.fn(),
});

// Fila das mensagens recebidas por um cliente: nenhuma se perde entre um await e outro.
function fila(socket: Socket) {
  const recebidas: MensagemPosicoes[] = [];
  const esperando: ((m: MensagemPosicoes) => void)[] = [];
  socket.on(EVENTO_POSICOES, (m: MensagemPosicoes) => {
    const resolver = esperando.shift();
    if (resolver) resolver(m);
    else recebidas.push(m);
  });
  return {
    proxima: () =>
      new Promise<MensagemPosicoes>((resolve) => {
        const pronta = recebidas.shift();
        if (pronta) resolve(pronta);
        else esperando.push(resolve);
      }),
    pendentes: () => recebidas.length,
  };
}

// Timers do próprio app (limites de tentativas do express-rate-limit), que existem antes
// do Socket.IO: os testes contam só o que o tempo real acrescenta.
type Montagem = { http: ServidorHttp; url: string; tempoReal: TempoReal; timersDoApp: number };
let montagem: Montagem | undefined;
const clientes: Socket[] = [];

async function montar(config = CONFIG, banco = bancoFalso()): Promise<Montagem> {
  const http = createServer(criarApp(CONFIG_APP, banco as never));
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  montagem = { http, url, tempoReal: null, timersDoApp: vi.getTimerCount() };
  montagem.tempoReal = await iniciarTempoReal(http, banco as never, config);
  return montagem;
}

function abrir(url: string, origem: string | null = ORIGEM) {
  const socket = cliente(url, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    extraHeaders: origem === null ? {} : { Origin: origem },
  });
  clientes.push(socket);
  return { socket, mensagens: fila(socket) };
}

const conectado = (socket: Socket) =>
  new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
const recusado = (socket: Socket) =>
  new Promise<Error>((resolve, reject) => {
    socket.once('connect', () => reject(new Error('conectou, mas deveria ser recusado')));
    socket.once('connect_error', resolve);
  });

beforeAll(() => {
  consultas = [];
});

afterEach(async () => {
  for (const socket of clientes.splice(0)) socket.disconnect();
  if (montagem?.tempoReal) await montagem.tempoReal.encerrar();
  else if (montagem?.http.listening) await new Promise((resolve) => montagem!.http.close(resolve));
  montagem = undefined;
  consultas = [];
  vi.useRealTimers();
});

const relogioFalso = () => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

describe('conexão e posições atuais', () => {
  it('cliente da origem permitida conecta e recebe na hora o retrato atual, demonstrativo', async () => {
    relogioFalso();
    const { url } = await montar();
    const { socket, mensagens } = abrir(url);
    await conectado(socket);
    const primeira = await mensagens.proxima();
    expect(primeira).toEqual({
      demonstrativo: true,
      intervaloMs: 3000,
      posicoes: [
        { codigo: '#04', rotaId: 1, latitude: -8.0, longitude: -34.9, volta: 0, demonstrativo: true },
        { codigo: '#06', rotaId: 2, latitude: -8.1, longitude: -34.9, volta: 0, demonstrativo: true },
      ],
    });
    // Só os campos da posição: nada de ids internos, trajetos completos ou dados do banco.
    expect(JSON.stringify(primeira)).not.toMatch(/veiculo_|trajeto|acumulado|"ativ[oa]"/);
  });

  it('rotas lidas uma vez, pela mesma consulta de GET /api/rotas; rota sem veículo fica de fora', async () => {
    relogioFalso();
    const { tempoReal } = await montar();
    expect(consultas).toHaveLength(1);
    expect(consultas[0]).toContain('WHERE r.ativa');
    expect(tempoReal!.simulador.ignoradas).toEqual([{ rotaId: 3, motivo: 'sem_veiculo' }]);
    expect(tempoReal!.simulador.ativo).toBe(true);
  });

  it('sem cabeçalho Origin (cliente fora do navegador ou polling do próprio site) também conecta', async () => {
    relogioFalso();
    const { url } = await montar();
    const { socket, mensagens } = abrir(url, null);
    await conectado(socket);
    expect((await mensagens.proxima()).posicoes).toHaveLength(2);
  });
});

describe('atualizações no intervalo configurado', () => {
  it('nada antes de 3 s; a cada 3 s, uma mensagem com as posições do passo, para todos os clientes', async () => {
    relogioFalso();
    const { url, tempoReal } = await montar();
    const a = abrir(url);
    const b = abrir(url);
    await Promise.all([conectado(a.socket), conectado(b.socket)]);
    const inicio = await a.mensagens.proxima();
    await b.mensagens.proxima();

    vi.advanceTimersByTime(2999);
    vi.advanceTimersByTime(1);
    // A próxima mensagem é a do 1º passo: nenhuma saiu antes dos 3 s.
    const passo1 = await a.mensagens.proxima();
    expect(distanciaKm(inicio.posicoes[0]!, passo1.posicoes[0]!)).toBeCloseTo(tempoReal!.simulador.passoKm, 6);
    expect(await b.mensagens.proxima()).toEqual(passo1);

    vi.advanceTimersByTime(3000 * 3);
    const recebidas = [await a.mensagens.proxima(), await a.mensagens.proxima(), await a.mensagens.proxima()];
    expect(recebidas.at(-1)!.posicoes).toEqual(tempoReal!.simulador.posicoes());
    for (const m of recebidas) expect(m.posicoes.every((p: Posicao) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))).toBe(true);
    expect(a.mensagens.pendentes()).toBe(0);
  });

  it('respeita SIMULACAO_INTERVALO_MS', async () => {
    relogioFalso();
    const { url } = await montar({ ...CONFIG, simulacaoIntervaloMs: 1000 });
    const { socket, mensagens } = abrir(url);
    await conectado(socket);
    expect((await mensagens.proxima()).intervaloMs).toBe(1000);
    vi.advanceTimersByTime(999);
    vi.advanceTimersByTime(1);
    const passo1 = await mensagens.proxima();
    expect(passo1.posicoes[0]!.latitude).toBeLessThan(-8.0);
  });
});

describe('segurança', () => {
  it.each(['https://outro.example', 'null', 'http://localhost:5174'])('origem %s é recusada no handshake', async (origem) => {
    relogioFalso();
    const { url, tempoReal } = await montar();
    const { socket } = abrir(url, origem);
    await recusado(socket);
    expect(tempoReal!.io.engine.clientsCount).toBe(0);
  });

  it('polling: origem estranha recebe 403 e nenhum cabeçalho CORS; a permitida, 200 com CORS', async () => {
    relogioFalso();
    const { http } = await montar();
    const ruim = await request(http).get('/socket.io/?EIO=4&transport=polling').set('Origin', 'https://outro.example');
    expect(ruim.status).toBe(403);
    expect(ruim.headers['access-control-allow-origin']).toBeUndefined();
    const boa = await request(http).get('/socket.io/?EIO=4&transport=polling').set('Origin', ORIGEM);
    expect(boa.status).toBe(200);
    expect(boa.headers['access-control-allow-origin']).toBe(ORIGEM);
    expect(boa.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('não serve o arquivo do cliente socket.io', async () => {
    relogioFalso();
    const { http } = await montar();
    expect((await request(http).get('/socket.io/socket.io.js')).status).not.toBe(200);
  });

  it('mensagens do cliente não alteram a simulação nem chegam aos outros clientes', async () => {
    relogioFalso();
    const { url, tempoReal } = await montar();
    const atacante = abrir(url);
    const vitima = abrir(url);
    await Promise.all([conectado(atacante.socket), conectado(vitima.socket)]);
    await atacante.mensagens.proxima();
    await vitima.mensagens.proxima();

    // Ouvinte só do teste no socket do servidor, para saber quando a última mensagem chegou
    // (as mensagens de um cliente chegam em ordem), sem esperar tempo de rede arbitrário.
    const noServidor = tempoReal!.io.sockets.sockets.get(atacante.socket.id!)!;
    const chegou = new Promise<void>((resolve) => noServidor.onAny((evento) => evento === 'fim' && resolve()));

    const falsa = { demonstrativo: true, intervaloMs: 1, posicoes: [{ codigo: '#04', latitude: 0, longitude: 0 }] };
    atacante.socket.emit(EVENTO_POSICOES, falsa);
    for (const evento of ['parar', 'iniciar', 'avancar', 'configurar', 'disconnect_all']) atacante.socket.emit(evento, { intervaloMs: 1 });
    atacante.socket.emit('fim');
    await chegou;

    expect(tempoReal!.simulador.ativo).toBe(true);
    vi.advanceTimersByTime(3000);
    const real = await vitima.mensagens.proxima();
    expect(real.intervaloMs).toBe(3000);
    expect(real.posicoes).toEqual(tempoReal!.simulador.posicoes());
    expect(real.posicoes[0]!.latitude).not.toBe(0);
    expect(vitima.mensagens.pendentes()).toBe(0);
  });

  it('mensagem do cliente acima de 1 kB derruba só aquela conexão', async () => {
    relogioFalso();
    const { url, tempoReal } = await montar();
    const grande = abrir(url);
    const outro = abrir(url);
    await Promise.all([conectado(grande.socket), conectado(outro.socket)]);
    const caiu = new Promise((resolve) => grande.socket.once('disconnect', resolve));
    grande.socket.emit('qualquer', 'x'.repeat(2048));
    await caiu;
    vi.advanceTimersByTime(3000);
    await outro.mensagens.proxima(); // retrato inicial
    expect((await outro.mensagens.proxima()).posicoes).toEqual(tempoReal!.simulador.posicoes());
  });
});

describe('simulação desligada e falhas', () => {
  it('SIMULACAO_ATIVA=false: sem Socket.IO, sem consulta e sem relógio', async () => {
    relogioFalso();
    const { http, url, tempoReal, timersDoApp } = await montar({ ...CONFIG, simulacaoAtiva: false });
    expect(tempoReal).toBeNull();
    expect(consultas).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(timersDoApp);
    expect((await request(http).get('/socket.io/?EIO=4&transport=polling').set('Origin', ORIGEM)).status).toBe(404);
    const { socket } = abrir(url);
    await recusado(socket);
    expect((await request(http).get('/api/saude')).status).not.toBe(404);
  });

  it('banco fora ao ligar: a promessa falha, sem relógio nem Socket.IO pendurados', async () => {
    relogioFalso();
    const http = createServer(criarApp(CONFIG_APP, bancoFalso(true) as never));
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    montagem = { http, url: '', tempoReal: null, timersDoApp: vi.getTimerCount() };
    await expect(iniciarTempoReal(http, bancoFalso(true) as never, CONFIG)).rejects.toThrow('banco fora');
    expect(vi.getTimerCount()).toBe(montagem.timersDoApp);
    expect((await request(http).get('/socket.io/?EIO=4&transport=polling')).status).toBe(404);
  });
});

describe('encerramento', () => {
  it('para o relógio, desconecta os clientes e fecha o servidor HTTP', async () => {
    relogioFalso();
    const { http, url, tempoReal, timersDoApp } = await montar();
    const { socket } = abrir(url);
    await conectado(socket);
    expect(vi.getTimerCount()).toBe(timersDoApp + 1); // só o relógio da simulação
    const desconectou = new Promise<string>((resolve) => socket.once('disconnect', resolve));

    await tempoReal!.encerrar();

    // Queda de transporte (não "io server disconnect"): assim o cliente do navegador volta
    // a conectar sozinho quando a API sobe de novo.
    expect(await desconectou).toBe('transport close');
    expect(tempoReal!.simulador.ativo).toBe(false);
    expect(vi.getTimerCount()).toBe(timersDoApp);
    expect(tempoReal!.io.engine.clientsCount).toBe(0);
    expect(http.listening).toBe(false);
    montagem = undefined;
  });
});

describe.skipIf(!URL_ADMIN)('integração: com as rotas do seed 002 num PostgreSQL temporário', { timeout: 60_000 }, () => {
  let banco: Awaited<ReturnType<typeof criarBancoTemporario>>;
  beforeAll(async () => {
    banco = await criarBancoTemporario();
    await migrar(banco.pool);
    await semear(banco.pool);
  });
  afterAll(async () => {
    await banco?.apagar();
  });

  it('transmite os 7 veículos ativos, cada um no início da sua rota', async () => {
    relogioFalso();
    const { url } = await montar(CONFIG, banco.pool as never);
    const { socket, mensagens } = abrir(url);
    await conectado(socket);
    const primeira = await mensagens.proxima();
    expect(primeira.posicoes.map((p) => p.codigo).sort()).toEqual(['#04', '#06', '#08', '#11', '#13', '#15', '#17']);
    const { rows } = await banco.pool.query<{ codigo: string; latitude: number; longitude: number }>(
      `SELECT v.codigo, rp.latitude::float8 AS latitude, rp.longitude::float8 AS longitude
         FROM rotas r JOIN veiculos v ON v.id = r.veiculo_id JOIN rota_pontos rp ON rp.rota_id = r.id AND rp.ordem = 1`,
    );
    for (const p of primeira.posicoes) {
      expect(rows.find((r) => r.codigo === p.codigo)).toMatchObject({ latitude: p.latitude, longitude: p.longitude });
    }
    vi.advanceTimersByTime(3000);
    expect((await mensagens.proxima()).posicoes.every((p) => p.volta === 0)).toBe(true);
  });
});
