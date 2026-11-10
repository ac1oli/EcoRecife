// pnpm storage:preparar   → cria (ou ajusta) o bucket PRIVADO das fotos: 5 MB, jpeg/png/webp.
// pnpm storage:verificar  → confere o bucket, faz um envio e uma leitura de teste (apagados no
//   fim), confirma que a URL pública NÃO entrega o arquivo e compara as fotos do banco com o
//   bucket (nenhuma foto do banco pode faltar no Storage).
import { randomUUID } from 'node:crypto';
import { carregarConfigStorage } from '../config.js';
import { criarClienteStorage, problemasDoBucket } from '../ocorrencias/armazenamento-supabase.js';
import { executarComando, ErroComando } from './comum.js';

// PNG 1×1 válido, usado só no teste de ida e volta.
const PNG_TESTE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const preparar = process.argv.includes('--preparar');

await executarComando(async (pool) => {
  const config = carregarConfigStorage();
  const storage = criarClienteStorage(config);
  console.log(`[storage] projeto ${config.projeto}, bucket ${config.bucketFotos}`);

  if (preparar) {
    const atual = await storage.lerBucket();
    await storage.criarOuAjustarBucket(atual !== null);
    console.log(atual ? 'Bucket ajustado.' : 'Bucket criado.');
  }

  const problemas = problemasDoBucket(await storage.lerBucket());
  if (problemas.length) throw new ErroComando(`Bucket fora do padrão: ${problemas.join('; ')}`);
  console.log('OK   bucket privado, limite de 5 MB, só jpeg/png/webp');
  if (preparar) return;

  // Ida e volta com um arquivo de teste (chave no formato real, apagada logo depois).
  const chave = `ocorrencias/${randomUUID()}.png`;
  await storage.enviar(chave, PNG_TESTE, 'image/png');
  try {
    const lido = await storage.baixar(chave);
    if (!lido?.equals(PNG_TESTE)) throw new ErroComando('O arquivo lido do Storage é diferente do enviado');
    console.log('OK   envio e leitura pela API (com a secret key)');
    const publico = await fetch(`${config.supabaseUrl}/storage/v1/object/public/${config.bucketFotos}/${chave}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (publico.ok) throw new ErroComando('A URL pública entregou o arquivo: o bucket NÃO está privado');
    console.log(`OK   URL pública sem acesso (HTTP ${publico.status})`);
    const recusado = await storage.enviar(`ocorrencias/${randomUUID()}.png`, Buffer.alloc(16), 'text/plain').then(
      () => false,
      () => true,
    );
    if (!recusado) throw new ErroComando('O bucket aceitou um arquivo text/plain');
    console.log('OK   tipo não permitido recusado pelo bucket');
  } finally {
    await storage.remover(chave);
  }

  const { rows } = await pool.query<{ chave_armazenamento: string; tamanho_bytes: number }>(
    'SELECT chave_armazenamento, tamanho_bytes FROM ocorrencia_fotos ORDER BY chave_armazenamento',
  );
  const objetos = new Map(
    (await storage.listar('ocorrencias')).map((o) => [`ocorrencias/${o.name}`, o.metadata?.size ?? null]),
  );
  const faltando = rows.filter((f) => !objetos.has(f.chave_armazenamento));
  const tamanhoErrado = rows.filter((f) => objetos.has(f.chave_armazenamento) && objetos.get(f.chave_armazenamento) !== f.tamanho_bytes);
  const semRegistro = [...objetos.keys()].filter((k) => !rows.some((f) => f.chave_armazenamento === k));
  console.log(
    `${faltando.length || tamanhoErrado.length ? 'FALHA' : 'OK  '} fotos: ${rows.length} no banco, ${objetos.size} no bucket` +
      (faltando.length ? ` · faltando no bucket: ${faltando.length}` : '') +
      (tamanhoErrado.length ? ` · tamanho diferente: ${tamanhoErrado.length}` : '') +
      (semRegistro.length ? ` · sem registro no banco (órfãs): ${semRegistro.length}` : ''),
  );
  if (faltando.length || tamanhoErrado.length) throw new ErroComando('Há fotos do banco ausentes ou diferentes no Storage');
  console.log('\nStorage verificado.');
});
