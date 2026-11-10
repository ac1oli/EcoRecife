// pnpm db:seed-rotas → carrega as rotas DEMONSTRATIVAS (seed 002) num banco já instalado.
// Pode ser repetido: se as rotas já estiverem carregadas, não faz nada.
import { semearRotas } from '../banco/migrador.js';
import { executarComando } from './comum.js';

await executarComando(async (pool) => {
  const resultado = await semearRotas(pool, { log: (mensagem) => console.log(`>> ${mensagem}`) });
  console.log(
    resultado.situacao === 'carregadas'
      ? `Rotas demonstrativas carregadas: ${resultado.rotas} rotas, ${resultado.pontos} pontos.`
      : `As rotas demonstrativas já estavam carregadas (${resultado.rotas} rotas, ${resultado.pontos} pontos). Nada foi alterado.`,
  );
});
