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
    const config = carregarConfig();
    console.log(`[db] Supabase · projeto ${config.projetoSupabase} (${config.ambiente})`);
    pool = criarPool(config.databaseUrl, { certificadoCa: config.bancoCertificadoCa });
    await tarefa(pool);
  } catch (erro) {
    if (
      erro instanceof ErroConfiguracao ||
      erro instanceof ErroMigracao ||
      erro instanceof ErroDadosAdmin ||
      erro instanceof ErroComando
    ) {
      console.error(`\nErro: ${erro.message}`);
    } else if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN'].includes((erro as { code?: string }).code ?? '')) {
      console.error(
        '\nErro: não foi possível conectar ao Supabase. Confira DATABASE_URL (Session pooler) e a internet. ' +
          'No plano Free, um projeto pausado precisa ser reativado no painel.',
      );
    } else if ((erro as { code?: string }).code === '28P01') {
      console.error('\nErro: usuário ou senha do banco recusados. Confira DATABASE_URL no .env.');
    } else if (/certificate/i.test((erro as Error).message ?? '')) {
      console.error('\nErro: o certificado TLS do Supabase não foi validado. Confira o arquivo de DATABASE_SSL_CA.');
    } else {
      console.error('\nErro inesperado:', erro);
    }
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}
