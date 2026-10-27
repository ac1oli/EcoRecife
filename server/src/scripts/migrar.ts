// pnpm db:migrar  → aplica as migrações pendentes de database/migrations
// pnpm db:status  → só mostra o que já foi aplicado e o que está pendente
import { migrar } from '../banco/migrador.js';
import { executarComando } from './comum.js';

const apenasVerificar = process.argv.includes('--status');

await executarComando(async (pool) => {
  const resultado = await migrar(pool, { apenasVerificar, log: (mensagem) => console.log(`>> ${mensagem}`) });
  console.log(`Já aplicadas: ${resultado.jaAplicadas.join(', ') || 'nenhuma'}`);
  if (apenasVerificar) {
    console.log(`Pendentes:    ${resultado.pendentes.join(', ') || 'nenhuma'}`);
  } else {
    console.log(`Aplicadas agora: ${resultado.aplicadasAgora.join(', ') || 'nenhuma (o banco já estava atualizado)'}`);
  }
});
