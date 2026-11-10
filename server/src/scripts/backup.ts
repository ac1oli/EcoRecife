// pnpm db:backup [--pasta <pasta>]     → salva os dados do Supabase num arquivo SQL (fora do
//   repositório: por padrão em <pasta do usuário>/EcoRecife-backups/) e mostra o SHA-256.
// pnpm db:restaurar <arquivo.sql>      → carrega um backup num banco com as mesmas migrações
//   e as tabelas vazias (nunca sobrescreve nada). Veja src/banco/backup.ts.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { gerarBackup, restaurarBackup } from '../banco/backup.js';
import { carregarConfig } from '../config.js';
import { executarComando, ErroComando } from './comum.js';

const argumentos = process.argv.slice(2);
const restaurar = argumentos[0] === '--restaurar';

await executarComando(async (pool) => {
  if (restaurar) {
    const arquivo = argumentos[1];
    if (!arquivo) throw new ErroComando('Informe o arquivo: pnpm db:restaurar <arquivo.sql>');
    const contagens = await restaurarBackup(pool, await readFile(arquivo, 'utf8'));
    console.log(`Backup restaurado: ${Object.entries(contagens).map(([t, n]) => `${t}=${n}`).join(' ')}`);
    console.log('Confira com: pnpm db:verificar');
    return;
  }
  const indice = argumentos.indexOf('--pasta');
  const pasta = indice >= 0 ? path.resolve(argumentos[indice + 1] ?? '') : path.join(homedir(), 'EcoRecife-backups');
  const projeto = carregarConfig().projetoSupabase;
  const { sql, contagens } = await gerarBackup(pool, `Supabase · projeto ${projeto}`);
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  await mkdir(pasta, { recursive: true });
  const arquivo = path.join(pasta, `ecorecife_supabase_${carimbo}.sql`);
  await writeFile(arquivo, sql, { flag: 'wx' });
  const hash = createHash('sha256').update(sql).digest('hex');
  await writeFile(`${arquivo}.sha256`, `${hash}  ${path.basename(arquivo)}\n`, { flag: 'wx' });
  console.log(`Backup salvo em ${arquivo}`);
  console.log(`SHA-256: ${hash}`);
  console.log(`Registros: ${Object.entries(contagens).map(([t, n]) => `${t}=${n}`).join(' ')}`);
  console.log('Guarde o arquivo fora do repositório: ele contém os hashes de senha dos usuários.');
});
