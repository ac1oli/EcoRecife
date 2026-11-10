// Lê os dados do seed 002 (rotas demonstrativas) direto do arquivo SQL, para os testes
// compararem o banco com o arquivo sem depender de uma cópia dos dados.
import { readFile } from 'node:fs/promises';
import { ARQUIVO_SEED_ROTAS } from '../../src/banco/migrador.js';

type Ponto = { ordem: number; latitude: number; longitude: number; texto: [string, string] };

export async function lerSeedRotas() {
  const sql = await readFile(ARQUIVO_SEED_ROTAS, 'utf8');
  const rotas = new Map<string, string>();
  for (const [, codigo, nome] of sql.matchAll(/^ {2}\('(#\d{2})', '([^']+)'\)[,;]$/gm)) rotas.set(codigo!, nome!);
  const pontos = new Map<string, Ponto[]>();
  for (const [, codigo, ordem, lat, lng] of sql.matchAll(/^ {2}\('(#\d{2})', (\d+), (-?\d+\.\d+), (-?\d+\.\d+)\)[,;]$/gm)) {
    const lista = pontos.get(codigo!) ?? [];
    lista.push({ ordem: Number(ordem), latitude: Number(lat), longitude: Number(lng), texto: [lat!, lng!] });
    pontos.set(codigo!, lista);
  }
  return { sql, rotas, pontos };
}

