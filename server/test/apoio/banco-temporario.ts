// Bancos temporários para os testes de integração. TEST_DATABASE_URL é usada só para
// CREATE DATABASE e DROP DATABASE de bancos criados aqui; os testes rodam dentro deles.
//
// Travas contra mexer em banco que não é de teste:
// - recusa NODE_ENV=production;
// - recusa TEST_DATABASE_URL apontando para o mesmo banco de DATABASE_URL;
// - só cria e só apaga nomes no formato ecorecife_teste_<8 hex>, gerados aqui;
// - antes de devolver o pool, confere que current_database() é o banco temporário.
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { carregarArquivoEnv } from '../../src/config.js';
import { criarPool } from '../../src/db.js';

carregarArquivoEnv();
export const URL_ADMIN = process.env.TEST_DATABASE_URL;

const PADRAO_BANCO_TESTE = /^ecorecife_teste_[0-9a-f]{8}$/;

function exigirNomeDeTeste(nome: string): void {
  if (!PADRAO_BANCO_TESTE.test(nome)) {
    throw new Error(`Recusado: "${nome}" não é um banco temporário de teste (ecorecife_teste_<8 hex>)`);
  }
}

function destino(url: string): string {
  const { hostname, port, pathname } = new URL(url);
  return `${hostname.toLowerCase()}:${port || '5432'}${decodeURIComponent(pathname)}`;
}

export function verificarAmbienteDeTeste(env: NodeJS.ProcessEnv = process.env): string {
  const urlAdmin = env.TEST_DATABASE_URL;
  if (!urlAdmin) throw new Error('TEST_DATABASE_URL não definida');
  if (env.NODE_ENV === 'production') throw new Error('Recusado: testes de integração com NODE_ENV=production');
  if (env.DATABASE_URL && destino(env.DATABASE_URL) === destino(urlAdmin)) {
    throw new Error('Recusado: TEST_DATABASE_URL aponta para o mesmo banco de DATABASE_URL');
  }
  return urlAdmin;
}

async function comConexaoAdmin(urlAdmin: string, tarefa: (cliente: pg.Client) => Promise<unknown>) {
  const cliente = new pg.Client({ connectionString: urlAdmin });
  await cliente.connect();
  try {
    await tarefa(cliente);
  } finally {
    await cliente.end();
  }
}

// Mesmo comando do guia (createdb -E UTF8 -T template0); o nome é gerado aqui, só [a-z0-9_].
export async function criarBancoTemporario(codificacao: 'UTF8' | 'LATIN1' = 'UTF8') {
  const urlAdmin = verificarAmbienteDeTeste();
  const nome = `ecorecife_teste_${randomBytes(4).toString('hex')}`;
  exigirNomeDeTeste(nome);
  await comConexaoAdmin(urlAdmin, (admin) =>
    admin.query(`CREATE DATABASE ${nome} ENCODING '${codificacao}' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`),
  );

  const apagar = async () => {
    exigirNomeDeTeste(nome);
    await comConexaoAdmin(urlAdmin, (admin) => admin.query(`DROP DATABASE IF EXISTS ${nome} WITH (FORCE)`));
  };

  const url = new URL(urlAdmin);
  url.pathname = `/${nome}`;
  const pool = criarPool(url.toString());
  try {
    const { rows } = await pool.query<{ banco: string }>('SELECT current_database() AS banco');
    if (rows[0]?.banco !== nome) throw new Error(`Recusado: conectado a "${rows[0]?.banco}", esperado "${nome}"`);
  } catch (erro) {
    await pool.end();
    await apagar();
    throw erro;
  }

  return {
    nome,
    pool,
    async apagar() {
      await pool.end();
      await apagar();
    },
  };
}
