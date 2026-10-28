// Limite de tentativas malsucedidas por IP (login e consulta de protocolo).
// Só as respostas de erro (status >= 400) contam; os acertos não consomem o limite.
// A contagem fica em memória, por instância da API: zera quando a API reinicia.
import { rateLimit } from 'express-rate-limit';

export const LIMITE_FALHAS = 10;
export const JANELA_FALHAS_MS = 15 * 60 * 1000;

export function limitarFalhas(mensagem: string) {
  return rateLimit({
    windowMs: JANELA_FALHAS_MS,
    limit: LIMITE_FALHAS,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { erro: mensagem },
  });
}
