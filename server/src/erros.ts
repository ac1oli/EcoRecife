// Tratamento central de erros: respostas em JSON, sem expor detalhes internos ao cliente.
import type { ErrorRequestHandler, RequestHandler } from 'express';

export class ErroHttp extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const rotaNaoEncontrada: RequestHandler = (_req, res) => {
  res.status(404).json({ erro: 'Recurso não encontrado' });
};

export const tratarErros: ErrorRequestHandler = (erro, _req, res, _next) => {
  if (erro instanceof ErroHttp) {
    res.status(erro.status).json({ erro: erro.message });
    return;
  }
  // Erros do body-parser (JSON malformado, corpo grande demais) já trazem o status HTTP.
  const status = typeof erro?.status === 'number' && erro.status >= 400 && erro.status < 500 ? erro.status : 500;
  if (status === 500) console.error('[api] erro não tratado:', erro);
  res.status(status).json({ erro: status === 500 ? 'Erro interno do servidor' : 'Requisição inválida' });
};
