// Perguntas no terminal. A senha é lida em modo "raw", sem eco na tela.
import { createInterface } from 'node:readline/promises';
import { ErroComando } from './comum.js';

export function exigirTerminalInterativo(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new ErroComando(
      'Este comando precisa de um terminal interativo (PowerShell, Prompt de Comando ou Windows Terminal). ' +
        'Não redirecione a entrada nem use o terminal integrado do Git Bash.',
    );
  }
}

export async function perguntar(pergunta: string): Promise<string> {
  const leitor = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await leitor.question(pergunta);
  } finally {
    leitor.close();
  }
}

export function perguntarOculto(pergunta: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const entrada = process.stdin;
    let valor = '';
    const encerrar = () => {
      entrada.off('data', aoDigitar);
      entrada.setRawMode(false);
      entrada.pause();
      process.stdout.write('\n');
    };
    const aoDigitar = (dados: string) => {
      for (const caractere of dados) {
        if (caractere === '\r' || caractere === '\n') {
          encerrar();
          resolve(valor);
          return;
        }
        if (caractere === '\u0003' || caractere === '\u0004') {
          // Ctrl+C / Ctrl+D
          encerrar();
          reject(new ErroComando('Cancelado pelo usuário.'));
          return;
        }
        if (caractere === '\u007f' || caractere === '\b') {
          valor = [...valor].slice(0, -1).join('');
        } else if (caractere >= ' ') {
          valor += caractere;
        }
      }
    };
    process.stdout.write(pergunta);
    entrada.setEncoding('utf8');
    entrada.setRawMode(true);
    entrada.resume();
    entrada.on('data', aoDigitar);
  });
}
