// Coleta em tempo real (D6): transmite por Socket.IO, para todos os clientes conectados,
// as posições DEMONSTRATIVAS do simulador (src/coleta/simulador.ts). Não há integração com
// a frota. Leitura pública e só do servidor para o cliente: nenhuma mensagem do cliente é
// tratada, então ninguém altera a simulação. Posições só na memória (D8).
import type { Server as ServidorHttp } from 'node:http';
import { Server } from 'socket.io';
import type { Config } from '../config.js';
import type { Banco } from '../db.js';
import { listarRotas } from './coleta.js';
import { criarSimulador, type Posicao } from './simulador.js';

export const EVENTO_POSICOES = 'coleta:posicoes';
// As mensagens do cliente são ignoradas; acima de 1 kB, a conexão é encerrada.
const TAMANHO_MAXIMO_MENSAGEM = 1024;

export type MensagemPosicoes = { demonstrativo: true; intervaloMs: number; posicoes: Posicao[] };

export type TempoReal = Awaited<ReturnType<typeof iniciarTempoReal>>;

// Lê as rotas ativas uma vez (uma rota nova só entra ao reiniciar a API), liga o Socket.IO
// ao servidor HTTP e começa a simulação. Devolve null se a simulação estiver desligada.
export async function iniciarTempoReal(
  servidorHttp: ServidorHttp,
  banco: Pick<Banco, 'query'>,
  config: Pick<Config, 'origensCors' | 'simulacaoAtiva' | 'simulacaoIntervaloMs'>,
) {
  if (!config.simulacaoAtiva) return null;

  const { itens } = await listarRotas(banco);
  const mensagem = (posicoes: Posicao[]): MensagemPosicoes => ({
    demonstrativo: true,
    intervaloMs: config.simulacaoIntervaloMs,
    posicoes,
  });

  const io = new Server(servidorHttp, {
    serveClient: false, // o front usa o socket.io-client do próprio build
    maxHttpBufferSize: TAMANHO_MAXIMO_MENSAGEM,
    cors: { origin: config.origensCors, methods: ['GET', 'POST'], credentials: false },
    // O CORS não vale para WebSocket: a origem é conferida no handshake. Sem Origin
    // (cliente fora do navegador, ou polling do próprio site) segue, como na API HTTP.
    allowRequest: (req, callback) => {
      const origem = req.headers.origin;
      callback(null, origem === undefined || config.origensCors.includes(origem));
    },
  });

  const simulador = criarSimulador(itens, {
    intervaloMs: config.simulacaoIntervaloMs,
    aoAvancar: (posicoes) => io.emit(EVENTO_POSICOES, mensagem(posicoes)),
  });
  // Quem conecta recebe na hora o retrato atual, sem esperar o próximo passo.
  io.on('connection', (socket) => {
    socket.emit(EVENTO_POSICOES, mensagem(simulador.posicoes()));
  });
  simulador.iniciar();

  return {
    io,
    simulador,
    // Para a simulação, desconecta todos os clientes e fecha o servidor HTTP junto.
    encerrar: () =>
      new Promise<void>((resolve) => {
        simulador.parar();
        void io.close(() => resolve());
      }),
  };
}
