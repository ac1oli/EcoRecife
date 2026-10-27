// Ponto de entrada da API: carrega a configuração, abre o pool e escuta a porta.
import { criarApp } from './app.js';
import { carregarArquivoEnv, carregarConfig, ErroConfiguracao } from './config.js';
import { bancoDisponivel, criarPool } from './db.js';

carregarArquivoEnv();

let config;
try {
  config = carregarConfig();
} catch (erro) {
  if (erro instanceof ErroConfiguracao) {
    console.error(erro.message);
    process.exit(1);
  }
  throw erro;
}

const pool = criarPool(config.databaseUrl);
const app = criarApp(config, pool);

const servidor = app.listen(config.porta, async () => {
  console.log(`[api] EcoRecife ouvindo em http://localhost:${config.porta} (${config.ambiente})`);
  if (!(await bancoDisponivel(pool))) {
    console.warn('[api] aviso: o banco não respondeu. Confira DATABASE_URL e se o PostgreSQL está rodando.');
  }
});

servidor.on('error', (erro: NodeJS.ErrnoException) => {
  console.error(
    erro.code === 'EADDRINUSE' ? `[api] a porta ${config.porta} já está em uso (mude PORTA no .env)` : erro,
  );
  process.exit(1);
});

// Encerramento limpo (Ctrl+C): para de aceitar conexões e fecha o pool.
function encerrar() {
  console.log('[api] encerrando...');
  servidor.close(() => {
    pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
