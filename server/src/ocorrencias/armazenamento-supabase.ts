// Fotos das ocorrências no Supabase Storage, num bucket PRIVADO. Só a API acessa, com a
// secret key (que fica no .env do servidor e nunca sai em log, erro ou resposta). O navegador
// nunca fala com o Storage: a foto passa pela rota protegida /api/ocorrencias/:id/fotos/:fotoId.
// Usa a API REST do Storage com o fetch nativo do Node (sem dependência nova).
import type { ConfigStorage } from '../config.js';
import { chaveValida, novaChave, MAX_BYTES_FOTO, TIPOS_FOTO, type Armazenamento } from './fotos.js';

const TEMPO_LIMITE_MS = 15_000;

export class ErroStorage extends Error {}

type Fetch = typeof fetch;

export function criarClienteStorage(config: ConfigStorage, fetchImpl: Fetch = fetch) {
  const base = `${config.supabaseUrl}/storage/v1`;
  // Os mesmos cabeçalhos que o cliente oficial envia com uma secret key.
  const cabecalhos = { apikey: config.chaveSecreta, Authorization: `Bearer ${config.chaveSecreta}` };

  async function chamar(metodo: string, caminho: string, corpo?: { json?: unknown; bytes?: Buffer; tipo?: string }) {
    const headers: Record<string, string> = { ...cabecalhos };
    let body: RequestInit['body'];
    if (corpo?.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(corpo.json);
    } else if (corpo?.bytes) {
      headers['Content-Type'] = corpo.tipo ?? 'application/octet-stream';
      headers['x-upsert'] = 'false'; // nunca sobrescreve um arquivo existente
      headers['Cache-Control'] = 'no-store';
      body = new Uint8Array(corpo.bytes);
    }
    try {
      return await fetchImpl(`${base}${caminho}`, { method: metodo, headers, body, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
    } catch (erro) {
      // Mensagem sem URL completa nem cabeçalhos: nada de chave em log.
      throw new ErroStorage(`Supabase Storage indisponível (${metodo} ${caminho.split('/')[1]}): ${(erro as Error).name}`);
    }
  }

  // O Storage responde "não encontrado" como 404 ou como 400 com statusCode "404" no corpo.
  async function naoEncontrado(resposta: Response): Promise<boolean> {
    if (resposta.status === 404) return true;
    if (resposta.status !== 400) return false;
    const corpo = (await resposta.clone().json().catch(() => null)) as { statusCode?: string } | null;
    return corpo?.statusCode === '404';
  }

  async function erro(resposta: Response, acao: string): Promise<ErroStorage> {
    const corpo = (await resposta.json().catch(() => null)) as { error?: string; message?: string } | null;
    return new ErroStorage(`Supabase Storage recusou ${acao}: HTTP ${resposta.status} ${corpo?.error ?? ''} ${corpo?.message ?? ''}`.trim());
  }

  const objeto = (chave: string) => `/${encodeURIComponent(config.bucketFotos)}/${chave.split('/').map(encodeURIComponent).join('/')}`;

  return {
    async enviar(chave: string, conteudo: Buffer, tipo: string) {
      const r = await chamar('POST', `/object${objeto(chave)}`, { bytes: conteudo, tipo });
      if (!r.ok) throw await erro(r, 'o envio da foto');
    },
    async baixar(chave: string): Promise<Buffer | null> {
      const r = await chamar('GET', `/object/authenticated${objeto(chave)}`);
      if (await naoEncontrado(r)) return null;
      if (!r.ok) throw await erro(r, 'a leitura da foto');
      return Buffer.from(await r.arrayBuffer());
    },
    async remover(chave: string) {
      const r = await chamar('DELETE', `/object${objeto(chave)}`);
      if (!r.ok && !(await naoEncontrado(r))) throw await erro(r, 'a remoção da foto');
    },
    async lerBucket(): Promise<BucketStorage | null> {
      const r = await chamar('GET', `/bucket/${encodeURIComponent(config.bucketFotos)}`);
      if (await naoEncontrado(r)) return null;
      if (!r.ok) throw await erro(r, 'a leitura do bucket');
      return (await r.json()) as BucketStorage;
    },
    async criarOuAjustarBucket(existe: boolean) {
      const definicao = { public: false, file_size_limit: MAX_BYTES_FOTO, allowed_mime_types: [...TIPOS_FOTO] };
      const r = existe
        ? await chamar('PUT', `/bucket/${encodeURIComponent(config.bucketFotos)}`, { json: definicao })
        : await chamar('POST', '/bucket', { json: { id: config.bucketFotos, name: config.bucketFotos, ...definicao } });
      if (!r.ok) throw await erro(r, existe ? 'o ajuste do bucket' : 'a criação do bucket');
    },
    async listar(prefixo: string, limite = 1000): Promise<{ name: string; metadata?: { size?: number } | null }[]> {
      const r = await chamar('POST', `/object/list/${encodeURIComponent(config.bucketFotos)}`, {
        json: { prefix: prefixo, limit: limite, offset: 0, sortBy: { column: 'name', order: 'asc' } },
      });
      if (!r.ok) throw await erro(r, 'a listagem do bucket');
      return (await r.json()) as { name: string; metadata?: { size?: number } | null }[];
    },
  };
}

export type BucketStorage = {
  id: string;
  public: boolean;
  file_size_limit: number | null;
  allowed_mime_types: string[] | null;
};

// Confere se o bucket está como o EcoRecife exige: privado, 5 MB, jpeg/png/webp.
export function problemasDoBucket(bucket: BucketStorage | null): string[] {
  if (!bucket) return ['o bucket não existe (rode: pnpm storage:preparar)'];
  const problemas: string[] = [];
  if (bucket.public) problemas.push('o bucket está PÚBLICO');
  if (bucket.file_size_limit !== MAX_BYTES_FOTO) problemas.push(`limite de tamanho ${bucket.file_size_limit ?? 'nenhum'} (esperado ${MAX_BYTES_FOTO})`);
  const tipos = [...(bucket.allowed_mime_types ?? [])].sort().join(',');
  if (tipos !== [...TIPOS_FOTO].sort().join(',')) problemas.push(`tipos permitidos "${tipos || 'todos'}" (esperado ${TIPOS_FOTO.join(', ')})`);
  return problemas;
}

export function criarArmazenamentoSupabase(config: ConfigStorage, fetchImpl: Fetch = fetch): Armazenamento {
  const cliente = criarClienteStorage(config, fetchImpl);
  const conferir = (chave: string) => {
    if (!chaveValida(chave)) throw new ErroStorage('Chave de foto fora do padrão');
  };
  return {
    descricao: `Supabase Storage (projeto ${config.projeto}, bucket privado ${config.bucketFotos})`,
    novaChave,
    chaveValida,
    async gravar(chave, conteudo, tipo) {
      conferir(chave);
      await cliente.enviar(chave, conteudo, tipo);
    },
    async ler(chave) {
      conferir(chave);
      return cliente.baixar(chave);
    },
    async apagar(chave) {
      try {
        conferir(chave);
        await cliente.remover(chave);
      } catch (erro) {
        console.error(`[fotos] não foi possível apagar ${chave}:`, (erro as Error).message);
      }
    },
  };
}
