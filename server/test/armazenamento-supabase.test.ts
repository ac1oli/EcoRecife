// Armazenamento das fotos no Supabase Storage, com um fetch falso (nenhuma chamada de rede).
import { describe, expect, it, vi } from 'vitest';
import type { ConfigStorage } from '../src/config.js';
import {
  criarArmazenamentoSupabase,
  criarClienteStorage,
  ErroStorage,
  problemasDoBucket,
} from '../src/ocorrencias/armazenamento-supabase.js';

const CONFIG: ConfigStorage = {
  supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
  chaveSecreta: 'sb_secret_ficticia_0123456789',
  bucketFotos: 'ocorrencias-fotos',
  projeto: 'abcdefghijklmnopqrst',
};
const CHAVE = 'ocorrencias/3f2b8c1e-1d2c-4a5b-9c8d-7e6f5a4b3c2d.png';
const BASE = 'https://abcdefghijklmnopqrst.supabase.co/storage/v1';

type Chamada = { url: string; metodo: string; headers: Record<string, string>; corpo: unknown };

function fetchFalso(responder: (c: Chamada) => Response | Promise<Response>) {
  const chamadas: Chamada[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const c: Chamada = {
      url: String(url),
      metodo: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      corpo: init?.body,
    };
    chamadas.push(c);
    return responder(c);
  });
  return { impl: impl as unknown as typeof fetch, chamadas };
}
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

describe('armazenamento no Supabase Storage', () => {
  it('envia a foto com a secret key, sem sobrescrever, para o caminho da chave', async () => {
    const f = fetchFalso(() => json({ Key: `ocorrencias-fotos/${CHAVE}` }));
    const fotos = criarArmazenamentoSupabase(CONFIG, f.impl);
    await fotos.gravar(CHAVE, Buffer.from('conteudo'), 'image/png');
    expect(f.chamadas).toHaveLength(1);
    const [c] = f.chamadas;
    expect(c!.metodo).toBe('POST');
    expect(c!.url).toBe(`${BASE}/object/ocorrencias-fotos/${CHAVE}`);
    expect(c!.headers).toMatchObject({
      apikey: CONFIG.chaveSecreta,
      Authorization: `Bearer ${CONFIG.chaveSecreta}`,
      'Content-Type': 'image/png',
      'x-upsert': 'false',
    });
    expect(Buffer.from(c!.corpo as Uint8Array).toString()).toBe('conteudo');
  });

  it('lê a foto pelo endpoint autenticado e devolve null se ela não existe', async () => {
    let resposta: Response = new Response(Buffer.from('bytes'), { status: 200 });
    const f = fetchFalso(() => resposta);
    const fotos = criarArmazenamentoSupabase(CONFIG, f.impl);
    expect((await fotos.ler(CHAVE))?.toString()).toBe('bytes');
    expect(f.chamadas[0]!.url).toBe(`${BASE}/object/authenticated/ocorrencias-fotos/${CHAVE}`);
    resposta = json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, 400);
    expect(await fotos.ler(CHAVE)).toBeNull();
    resposta = json({ error: 'not_found' }, 404);
    expect(await fotos.ler(CHAVE)).toBeNull();
  });

  it('erro do Storage vira ErroStorage sem a chave secreta na mensagem', async () => {
    const f = fetchFalso(() => json({ statusCode: '403', error: 'Unauthorized', message: 'invalid signature' }, 403));
    const fotos = criarArmazenamentoSupabase(CONFIG, f.impl);
    const erro = await fotos.gravar(CHAVE, Buffer.from('x'), 'image/png').catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroStorage);
    expect((erro as Error).message).toMatch(/HTTP 403/);
    expect((erro as Error).message).not.toContain('sb_secret');
    await expect(fotos.ler(CHAVE)).rejects.toThrow(ErroStorage);
  });

  it('falha de rede vira ErroStorage sem URL completa nem chave', async () => {
    const f = fetchFalso(() => {
      throw new TypeError('fetch failed');
    });
    const erro = await criarArmazenamentoSupabase(CONFIG, f.impl).ler(CHAVE).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroStorage);
    expect((erro as Error).message).not.toMatch(/sb_secret|supabase\.co/);
  });

  it('chave fora do padrão é recusada antes de qualquer chamada', async () => {
    const f = fetchFalso(() => json({}));
    const fotos = criarArmazenamentoSupabase(CONFIG, f.impl);
    for (const chave of ['../segredo.png', 'ocorrencias/../../x.png', 'outra/3f2b8c1e-1d2c-4a5b-9c8d-7e6f5a4b3c2d.png']) {
      await expect(fotos.gravar(chave, Buffer.from('x'), 'image/png')).rejects.toThrow(/fora do padrão/);
      await expect(fotos.ler(chave)).rejects.toThrow(/fora do padrão/);
    }
    expect(f.chamadas).toHaveLength(0);
  });

  it('apagar não lança erro (só registra) e trata "não encontrado" como já apagado', async () => {
    const erroConsole = vi.spyOn(console, 'error').mockImplementation(() => {});
    let resposta = json({ statusCode: '404', error: 'not_found' }, 400);
    const f = fetchFalso(() => resposta);
    const fotos = criarArmazenamentoSupabase(CONFIG, f.impl);
    await fotos.apagar(CHAVE);
    expect(f.chamadas[0]).toMatchObject({ metodo: 'DELETE', url: `${BASE}/object/ocorrencias-fotos/${CHAVE}` });
    expect(erroConsole).not.toHaveBeenCalled();
    resposta = json({ error: 'erro' }, 500);
    await fotos.apagar(CHAVE);
    expect(erroConsole).toHaveBeenCalledTimes(1);
    expect(String(erroConsole.mock.calls[0])).not.toContain('sb_secret');
    erroConsole.mockRestore();
  });

  it('descrição para os logs não traz a chave', () => {
    const fotos = criarArmazenamentoSupabase(CONFIG, fetchFalso(() => json({})).impl);
    expect(fotos.descricao).toContain('bucket privado ocorrencias-fotos');
    expect(fotos.descricao).not.toContain('sb_secret');
  });
});

describe('bucket', () => {
  it('cria o bucket privado com 5 MB e só jpeg/png/webp; ajusta um existente', async () => {
    const f = fetchFalso(() => json({ name: 'ocorrencias-fotos' }));
    const cliente = criarClienteStorage(CONFIG, f.impl);
    await cliente.criarOuAjustarBucket(false);
    await cliente.criarOuAjustarBucket(true);
    expect(f.chamadas.map((c) => `${c.metodo} ${c.url}`)).toEqual([`POST ${BASE}/bucket`, `PUT ${BASE}/bucket/ocorrencias-fotos`]);
    expect(JSON.parse(f.chamadas[0]!.corpo as string)).toEqual({
      id: 'ocorrencias-fotos',
      name: 'ocorrencias-fotos',
      public: false,
      file_size_limit: 5242880,
      allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'],
    });
    expect(JSON.parse(f.chamadas[1]!.corpo as string)).toMatchObject({ public: false, file_size_limit: 5242880 });
  });

  it('problemasDoBucket aponta bucket ausente, público, sem limite ou com outros tipos', () => {
    const certo = { id: 'b', public: false, file_size_limit: 5242880, allowed_mime_types: ['image/png', 'image/webp', 'image/jpeg'] };
    expect(problemasDoBucket(certo)).toEqual([]);
    expect(problemasDoBucket(null)[0]).toMatch(/não existe/);
    expect(problemasDoBucket({ ...certo, public: true })).toEqual(['o bucket está PÚBLICO']);
    expect(problemasDoBucket({ ...certo, file_size_limit: null })[0]).toMatch(/limite/);
    expect(problemasDoBucket({ ...certo, allowed_mime_types: null })[0]).toMatch(/tipos/);
    expect(problemasDoBucket({ ...certo, allowed_mime_types: ['image/png', 'image/gif'] })[0]).toMatch(/tipos/);
  });
});
