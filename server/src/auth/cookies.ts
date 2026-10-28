// Cookie de sessão: httpOnly (o JavaScript da página não lê), SameSite=Lax e Path=/.
// Em produção, Secure e prefixo __Host- (o navegador só aceita via HTTPS, sem Domain).
// Em desenvolvimento a API roda em http://localhost, onde um cookie Secure não seria gravado.
import type { CookieOptions } from 'express';
import type { Config } from '../config.js';

type Ambiente = Config['ambiente'];

export function nomeCookie(ambiente: Ambiente): string {
  return ambiente === 'production' ? '__Host-eco_sessao' : 'eco_sessao';
}

export function opcoesCookie(ambiente: Ambiente): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure: ambiente === 'production', path: '/' };
}

// Lê um cookie do cabeçalho Cookie sem dependência extra. Nome repetido: vale o primeiro.
export function lerCookie(cabecalho: string | undefined, nome: string): string | undefined {
  if (!cabecalho) return undefined;
  for (const parte of cabecalho.split(';')) {
    const igual = parte.indexOf('=');
    if (igual === -1 || parte.slice(0, igual).trim() !== nome) continue;
    try {
      return decodeURIComponent(parte.slice(igual + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}
