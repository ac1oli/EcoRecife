// Pool de conexões com o PostgreSQL. Toda consulta da API usa parâmetros ($1, $2...).
// Com o Supabase, a conexão usa TLS com o certificado verificado pela CA do Supabase
// (nunca rejectUnauthorized: false). Conexões que caem são refeitas pelo pool na próxima
// consulta, então uma falha passageira não exige reiniciar a API.
import pg from 'pg';

export type Banco = Pick<pg.Pool, 'query' | 'connect' | 'end'>;

export type OpcoesPool = {
  certificadoCa?: string; // PEM; sem ele, conexão sem TLS (só os bancos locais dos testes)
};

export function criarPool(databaseUrl: string, opcoes: OpcoesPool = {}): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ...(opcoes.certificadoCa ? { ssl: { ca: opcoes.certificadoCa, rejectUnauthorized: true } } : {}),
    // Supabase Free: o pooler de sessão tem poucas conexões; 5 bastam para a API.
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
    application_name: 'ecorecife-api',
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

// Executa a tarefa numa transação: COMMIT se der certo, ROLLBACK se falhar.
// Uma conexão que falha até no ROLLBACK é descartada em vez de voltar ao pool.
export async function emTransacao<T>(
  banco: Pick<Banco, 'connect'>,
  tarefa: (cliente: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const cliente = await banco.connect();
  let conexaoQuebrada: Error | undefined;
  try {
    await cliente.query('BEGIN');
    const resultado = await tarefa(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (erro) {
    try {
      await cliente.query('ROLLBACK');
    } catch (erroRollback) {
      conexaoQuebrada = erroRollback as Error;
    }
    throw erro;
  } finally {
    cliente.release(conexaoQuebrada);
  }
}
