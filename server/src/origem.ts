// Proteção contra CSRF nas requisições que alteram dados (POST, PUT, PATCH, DELETE).
// O cookie SameSite=Lax já não acompanha esses pedidos vindos de outro site; esta
// verificação é a segunda barreira e vale também para rotas sem login:
// - com cabeçalho Origin (todo navegador atual envia nesses métodos), ele precisa
//   estar em CORS_ORIGENS; "null" (iframe isolado, arquivo local) é recusado;
// - sem Origin, recusa se o navegador declarar Sec-Fetch-Site: cross-site.
// Clientes fora do navegador (curl, testes) não enviam nenhum dos dois e passam:
// eles não carregam o cookie de ninguém, que é o que o CSRF explora.
import type { RequestHandler } from 'express';
import { ErroHttp } from './erros.js';

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function verificarOrigem(origensPermitidas: string[]): RequestHandler {
  return (req, _res, next) => {
    if (METODOS_SEGUROS.has(req.method)) return next();
    const origem = req.get('origin');
    const permitida = origem ? origensPermitidas.includes(origem) : req.get('sec-fetch-site') !== 'cross-site';
    next(permitida ? undefined : new ErroHttp(403, 'Origem da requisição não permitida'));
  };
}
