// Pool de conexões com o PostgreSQL. Toda consulta da API usa parâmetros ($1, $2...).
import pg from 'pg';

export type Banco = Pick<pg.Pool, 'query' | 'connect' | 'end'>;

export function criarPool(databaseUrl: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  // Sem este ouvinte, um erro numa conexão ociosa (ex.: banco reiniciado) derruba o processo.
  pool.on('error', (erro) => {
    console.error('[db] erro em conexão ociosa:', erro.message);
  });
  return pool;
}

export async function bancoDisponivel(banco: Pick<Banco, 'query'>): Promise<boolean> {
  try {
    await banco.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
