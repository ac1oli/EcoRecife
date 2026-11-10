// globalSetup do Vitest: um PostgreSQL DESCARTÁVEL para os testes de integração.
//
// Sem TEST_DATABASE_URL, sobe um PostgreSQL 17 do pacote embedded-postgres (binários dentro
// de node_modules, sem serviço nem instalação no sistema): dados numa pasta temporária,
// escutando só em 127.0.0.1 numa porta livre, com senha aleatória. No fim, o servidor é
// parado e a pasta apagada. Com TEST_DATABASE_URL (ex.: um contêiner de CI), usa essa URL.
// Os testes nunca usam DATABASE_URL (o Supabase oficial); veja ./banco-temporario.ts.
import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { carregarArquivoEnv } from '../../src/config.js';

function portaLivre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const servidor = createServer();
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', () => {
      const { port } = servidor.address() as { port: number };
      servidor.close(() => resolve(port));
    });
  });
}

export default async function () {
  carregarArquivoEnv();
  if (process.env.TEST_DATABASE_URL) return undefined;

  const pasta = await mkdtemp(path.join(tmpdir(), 'ecorecife-pg-teste-'));
  const porta = await portaLivre();
  const senha = randomBytes(18).toString('hex');
  const servidor = new EmbeddedPostgres({
    databaseDir: path.join(pasta, 'dados'),
    port: porta,
    user: 'postgres',
    password: senha,
    authMethod: 'scram-sha-256',
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
    // PG_TESTE_LOG=<arquivo> grava o log do servidor de teste (diagnóstico).
    onLog: (mensagem) => {
      if (process.env.PG_TESTE_LOG) appendFileSync(process.env.PG_TESTE_LOG, `${String(mensagem)}
`);
    },
    onError: (erro) => console.error('[postgres de teste]', erro),
  });
  await servidor.initialise();
  await servidor.start();
  // Os processos dos testes herdam esta variável (são criados depois do globalSetup).
  process.env.TEST_DATABASE_URL = `postgres://postgres:${senha}@127.0.0.1:${porta}/postgres`;

  return async () => {
    await servidor.stop();
    await rm(pasta, { recursive: true, force: true });
  };
}
