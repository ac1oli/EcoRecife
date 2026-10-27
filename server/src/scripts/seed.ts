// pnpm db:seed → carrega os dados DEMONSTRATIVOS de database/seeds (só em banco sem dados).
import { semear } from '../banco/migrador.js';
import { executarComando } from './comum.js';

await executarComando(async (pool) => {
  const aplicados = await semear(pool, { log: (mensagem) => console.log(`>> ${mensagem}`) });
  console.log(`Seeds aplicados: ${aplicados.join(', ') || 'nenhum'}`);
});
