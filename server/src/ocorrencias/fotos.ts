// Fotos das ocorrências: recebimento (multer), validação pelo conteúdo (file-type) e
// gravação fora do banco. O banco guarda só a chave e os metadados (tabela ocorrencia_fotos).
// Na API, os arquivos ficam no Supabase Storage (bucket privado, ./armazenamento-supabase.ts);
// o armazenamento em disco abaixo é usado pelos testes automatizados.
//
// - O multer guarda o upload em memória: nada vai ao disco antes de tudo ser validado.
// - O tipo vem dos bytes do arquivo; o nome, a extensão e o MIME enviados são ignorados.
// - O nome gravado é um UUID com a extensão do tipo detectado: o usuário não escolhe caminho.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler } from 'express';
import { fileTypeFromBuffer } from 'file-type';
import multer from 'multer';
import { ErroHttp } from '../erros.js';

export const CAMPO_FOTOS = 'fotos';
export const MAX_FOTOS = 3;
export const MAX_BYTES_FOTO = 5 * 1024 * 1024; // mesmo limite do CHECK de ocorrencia_fotos

const EXTENSOES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
export type TipoFoto = keyof typeof EXTENSOES;
export const TIPOS_FOTO = Object.keys(EXTENSOES) as TipoFoto[];

export type FotoValidada = { conteudo: Buffer; tipoMime: TipoFoto; tamanhoBytes: number };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_BYTES_FOTO,
    files: MAX_FOTOS,
    fields: 12, // o formulário tem 8 campos de texto
    fieldSize: 8 * 1024, // a descrição (1000 caracteres) cabe com folga mesmo em UTF-8
    parts: 15,
  },
}).array(CAMPO_FOTOS, MAX_FOTOS);

function traduzirErroUpload(erro: unknown): ErroHttp {
  if (erro instanceof multer.MulterError) {
    if (erro.code === 'LIMIT_FILE_SIZE') return new ErroHttp(413, 'Cada foto pode ter no máximo 5 MB');
    if (erro.code === 'LIMIT_FILE_COUNT' || (erro.code === 'LIMIT_UNEXPECTED_FILE' && erro.field === CAMPO_FOTOS)) {
      return new ErroHttp(400, `Envie no máximo ${MAX_FOTOS} fotos`);
    }
    if (erro.code === 'LIMIT_UNEXPECTED_FILE') return new ErroHttp(400, `Envie as fotos no campo "${CAMPO_FOTOS}"`);
  }
  // Demais limites do multer e multipart malformado (erros do busboy).
  return new ErroHttp(400, 'Formulário inválido');
}

// Lê o multipart/form-data: campos de texto em req.body e fotos em req.files (em memória).
export const receberFormulario: RequestHandler = (req, res, next) => {
  if (!req.is('multipart/form-data')) {
    next(new ErroHttp(415, 'Envie o formulário como multipart/form-data'));
    return;
  }
  upload(req, res, (erro?: unknown) => next(erro ? traduzirErroUpload(erro) : undefined));
};

export async function validarFotos(arquivos: Express.Multer.File[]): Promise<FotoValidada[]> {
  const fotos: FotoValidada[] = [];
  for (const [indice, arquivo] of arquivos.entries()) {
    if (arquivo.size === 0) throw new ErroHttp(400, `A foto ${indice + 1} está vazia`);
    const tipo = await fileTypeFromBuffer(arquivo.buffer);
    if (!tipo || !(tipo.mime in EXTENSOES)) {
      throw new ErroHttp(400, `A foto ${indice + 1} não é uma imagem JPEG, PNG ou WebP válida`);
    }
    fotos.push({ conteudo: arquivo.buffer, tipoMime: tipo.mime as TipoFoto, tamanhoBytes: arquivo.size });
  }
  return fotos;
}

// Formato exato das chaves geradas por novaChave. Uma chave fora dele nunca vira caminho.
const PADRAO_CHAVE = /^ocorrencias\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export const novaChave = (tipo: TipoFoto) => `ocorrencias/${randomUUID()}.${EXTENSOES[tipo]}`;
export const chaveValida = (chave: string) => PADRAO_CHAVE.test(chave);

export type Armazenamento = {
  descricao: string; // para os logs, sem segredo
  novaChave(tipo: TipoFoto): string;
  chaveValida(chave: string): boolean;
  gravar(chave: string, conteudo: Buffer, tipo: TipoFoto): Promise<void>; // nunca sobrescreve
  ler(chave: string): Promise<Buffer | null>; // null: o arquivo não existe
  apagar(chave: string): Promise<void>; // não falha se o arquivo já não existe
};

// Arquivos em <pasta>/ocorrencias/<uuid>.<ext>, usado pelos testes. A chave usa "/" em
// qualquer sistema e só vira caminho depois de conferida com chaveValida.
export function criarArmazenamentoDisco(pasta: string): Armazenamento {
  const caminho = (chave: string) => {
    if (!chaveValida(chave)) throw new Error('Chave de foto fora do padrão');
    return path.join(pasta, ...chave.split('/'));
  };
  return {
    descricao: `disco (${pasta})`,
    novaChave,
    chaveValida,
    async gravar(chave, conteudo) {
      await mkdir(path.dirname(caminho(chave)), { recursive: true });
      await writeFile(caminho(chave), conteudo, { flag: 'wx' }); // nunca sobrescreve
    },
    async ler(chave) {
      try {
        return await readFile(caminho(chave));
      } catch (erro) {
        if ((erro as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw erro;
      }
    },
    async apagar(chave) {
      try {
        await unlink(caminho(chave));
      } catch (erro) {
        if ((erro as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error(`[fotos] não foi possível apagar ${chave}:`, (erro as Error).message);
        }
      }
    },
  };
}
