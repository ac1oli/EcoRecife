// pnpm db:verificar               → confere o banco (só leituras; veja src/banco/verificacao.ts)
// pnpm db:verificar --restricoes  → também roda os 24 casos de restrição (transação desfeita)
// pnpm db:verificar --data-api    → também testa a Data API do Supabase de fora, como um
//   visitante com a publishable key: nenhuma tabela pode responder com dados. A chave é lida
//   da variável SUPABASE_PUBLISHABLE_KEY só nesse momento (ela não precisa ficar no .env).
import { carregarConfigStorage } from '../config.js';
import { TABELAS, verificarBanco } from '../banco/verificacao.js';
import { executarComando, ErroComando } from './comum.js';

const comRestricoes = process.argv.includes('--restricoes');
const comDataApi = process.argv.includes('--data-api');

await executarComando(async (pool) => {
  const relatorio = await verificarBanco(pool, { exigirTls: true, restricoes: comRestricoes });
  for (const { nome, ok, detalhe } of relatorio.itens) console.log(`${ok ? 'OK  ' : 'FALHA'} ${nome}: ${detalhe}`);
  console.log(`\nRegistros: ${Object.entries(relatorio.contagens).map(([t, n]) => `${t}=${n}`).join(' ')}`);

  let dataApiOk = true;
  if (comDataApi) {
    const chave = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
    if (!chave?.startsWith('sb_publishable_')) throw new ErroComando('--data-api exige SUPABASE_PUBLISHABLE_KEY (sb_publishable_...)');
    const { supabaseUrl } = carregarConfigStorage({ ...process.env, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY ?? 'sb_secret_nao_usada_aqui' });
    const expostas: string[] = [];
    const respostas: string[] = [];
    for (const tabela of TABELAS) {
      const r = await fetch(`${supabaseUrl}/rest/v1/${tabela}?select=*&limit=1`, {
        headers: { apikey: chave, Authorization: `Bearer ${chave}` },
        signal: AbortSignal.timeout(15_000),
      });
      respostas.push(`${tabela}=${r.status}`);
      if (r.ok) expostas.push(tabela);
    }
    dataApiOk = expostas.length === 0;
    console.log(`${dataApiOk ? 'OK  ' : 'FALHA'} Data API com a publishable key: ${dataApiOk ? 'nenhuma tabela acessível' : `ACESSÍVEIS: ${expostas.join(', ')}`} (${respostas.join(' ')})`);
  }

  if (!relatorio.ok || !dataApiOk) throw new ErroComando('O banco não passou em todas as verificações (veja as linhas FALHA).');
  console.log('\nTodas as verificações passaram.');
});
