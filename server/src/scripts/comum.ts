// Estrutura comum dos comandos de terminal: carrega .env, valida a configuração,
// abre o pool, executa a tarefa e fecha tudo, com mensagens de erro legíveis.
import type pg from 'pg';
import { carregarArquivoEnv, carregarConfig, ErroConfiguracao } from '../config.js';
import { criarPool } from '../db.js';
import { ErroMigracao } from '../banco/migrador.js';
import { ErroDadosAdmin } from '../usuarios/administrador.js';

export class ErroComando extends Error {}

export async function executarComando(tarefa: (pool: pg.Pool) => Promise<void>): Promise<void> {
  let pool: pg.Pool | undefined;
  try {
    carregarArquivoEnv();
    pool = criarPool(carregarConfig().databaseUrl);
    await tarefa(pool);
  } catch (erro) {
    if (
      erro instanceof ErroConfiguracao ||
      erro instanceof ErroMigracao ||
      erro instanceof ErroDadosAdmin ||
      erro instanceof ErroComando
    ) {
      console.error(`\nErro: ${erro.message}`);
    } else if ((erro as { code?: string }).code === 'ECONNREFUSED') {
      console.error('\nErro: não foi possível conectar ao PostgreSQL. Ele está rodando? Confira DATABASE_URL no .env.');
    } else if ((erro as { code?: string }).code === '28P01') {
      console.error('\nErro: usuário ou senha do banco recusados. Confira DATABASE_URL no .env.');
    } else if ((erro as { code?: string }).code === '3D000') {
      console.error('\nErro: o banco informado em DATABASE_URL não existe. Crie-o antes (veja docs/03-banco-de-dados.md).');
    } else {
      console.error('\nErro inesperado:', erro);
    }
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}
