// Ponto de entrada da API: carrega a configuração, abre o pool com o Supabase, escuta a
// porta e liga a simulação da coleta em tempo real (Socket.IO).
import { criarApp } from './app.js';
import { iniciarTempoReal, type TempoReal } from './coleta/tempo-real.js';
import {
  carregarArquivoEnv,
  carregarConfig,
  carregarConfigStorage,
  ErroConfiguracao,
  type Config,
  type ConfigStorage,
} from './config.js';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { bancoDisponivel, criarPool } from './db.js';
import { criarArmazenamentoSupabase, criarClienteStorage, problemasDoBucket } from './ocorrencias/armazenamento-supabase.js';

carregarArquivoEnv();

let config: Config;
let configStorage: ConfigStorage;
try {
  config = carregarConfig();
  configStorage = carregarConfigStorage(process.env, config.projetoSupabase);
} catch (erro) {
  if (erro instanceof ErroConfiguracao) {
    console.error(erro.message);
    process.exit(1);
  }
  throw erro;
}

const pool = criarPool(config.databaseUrl, { certificadoCa: config.bancoCertificadoCa });
const fotos = criarArmazenamentoSupabase(configStorage);
const app = criarApp({ ...config, fotos }, pool);
let tempoReal: TempoReal = null;
let novaTentativa: NodeJS.Timeout | undefined;
let encerrando = false;

const servidor = app.listen(config.porta, async () => {
  console.log(`[api] EcoRecife ouvindo em http://localhost:${config.porta} (${config.ambiente})`);
  console.log(`[db] banco oficial: Supabase · projeto ${config.projetoSupabase} (TLS verificado)`);
  console.log(`[fotos] ${fotos.descricao}`);
  if (!config.pastaFront) console.log('[site] não servido pela API (SERVIR_FRONT=false)');
  else if (existsSync(path.join(config.pastaFront, 'index.html'))) console.log(`[site] servido pela API a partir de ${config.pastaFront}`);
  else console.warn(`[site] aviso: build do front não encontrado em ${config.pastaFront} (rode o build do web/); só a API responde`);
  if (config.proxiesConfiaveis) console.log(`[api] atrás de ${config.proxiesConfiaveis} proxy(s) confiável(is) (TRUST_PROXY)`);
  if (!(await bancoDisponivel(pool))) {
    console.warn(
      '[api] aviso: o Supabase não respondeu. Confira DATABASE_URL, o certificado e a internet ' +
        '(no plano Free, um projeto pausado precisa ser reativado no painel).',
    );
  }
  await conferirBucket();
  await ligarSimulacao();
});

// Só avisa: a API sobe mesmo assim, e o envio de fotos falha até o bucket ser corrigido.
async function conferirBucket() {
  try {
    const problemas = problemasDoBucket(await criarClienteStorage(configStorage).lerBucket());
    for (const problema of problemas) console.warn(`[fotos] aviso: ${problema}`);
  } catch (erro) {
    console.warn('[fotos] aviso: não foi possível conferir o bucket:', (erro as Error).message);
  }
}

// Sem as rotas (banco fora ou projeto pausado), a API segue no ar e tenta ligar a simulação
// de novo sozinha: 10 s, 20 s, 40 s... até 2 min entre as tentativas.
async function ligarSimulacao(tentativa = 1) {
  if (!config.simulacaoAtiva) {
    console.log('[coleta] simulação desligada (SIMULACAO_ATIVA=false)');
    return;
  }
  try {
    tempoReal = await iniciarTempoReal(servidor, pool, config);
  } catch (erro) {
    if (encerrando) return;
    const espera = Math.min(10_000 * 2 ** (tentativa - 1), 120_000);
    console.error(
      `[coleta] simulação não iniciada (tentativa ${tentativa}): não foi possível ler as rotas.`,
      (erro as Error).message,
      `Nova tentativa em ${espera / 1000} s.`,
    );
    novaTentativa = setTimeout(() => void ligarSimulacao(tentativa + 1), espera);
    novaTentativa.unref();
    return;
  }
  const { simulador } = tempoReal!;
  console.log(
    `[coleta] simulação DEMONSTRATIVA ativa: ${simulador.posicoes().length} veículo(s), a cada ${simulador.intervaloMs} ms`,
  );
  for (const { rotaId, motivo } of simulador.ignoradas) console.warn(`[coleta] rota ${rotaId} ignorada: ${motivo}`);
}

servidor.on('error', (erro: NodeJS.ErrnoException) => {
  console.error(
    erro.code === 'EADDRINUSE' ? `[api] a porta ${config.porta} já está em uso (mude PORTA no .env)` : erro,
  );
  process.exit(1);
});

// Encerramento limpo (Ctrl+C): para a simulação, desconecta os sockets, para de aceitar
// conexões e fecha o pool.
function encerrar(codigo = 0) {
  if (encerrando) return;
  encerrando = true;
  clearTimeout(novaTentativa);
  console.log('[api] encerrando...');
  const fecharPool = () => {
    pool.end().finally(() => process.exit(codigo));
  };
  if (tempoReal) void tempoReal.encerrar().then(fecharPool); // também fecha o servidor HTTP
  else servidor.close(fecharPool);
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => encerrar());
process.on('SIGTERM', () => encerrar()); // a hospedagem envia SIGTERM ao reiniciar ou atualizar

// Uma promessa rejeitada sem tratamento é registrada, e a API continua. Uma exceção não
// tratada deixa o processo num estado incerto: registra, encerra de forma limpa e a
// hospedagem reinicia o serviço.
process.on('unhandledRejection', (motivo) => {
  console.error('[api] promessa rejeitada sem tratamento:', motivo instanceof Error ? motivo.message : motivo);
});
process.on('uncaughtException', (erro) => {
  console.error('[api] erro inesperado; encerrando para reiniciar:', erro);
  encerrar(1);
});
