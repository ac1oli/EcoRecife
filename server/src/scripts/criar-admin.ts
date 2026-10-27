// pnpm criar-admin → cria um administrador pedindo nome, e-mail e senha no terminal.
// Não aceita argumentos nem variáveis de ambiente com a senha: nada fica no histórico
// do terminal, no código ou no repositório.
import type { z } from 'zod';
import {
  contarAdministradores,
  criarAdministrador,
  emailCadastrado,
  esquemaEmail,
  esquemaNome,
  SENHA_MIN,
  validarSenha,
} from '../usuarios/administrador.js';
import { ErroComando, executarComando } from './comum.js';
import { exigirTerminalInterativo, perguntar, perguntarOculto } from './terminal.js';

const TENTATIVAS = 3;

async function perguntarValido(pergunta: string, esquema: z.ZodType<string, string>): Promise<string> {
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    const resultado = esquema.safeParse(await perguntar(pergunta));
    if (resultado.success) return resultado.data;
    console.log(`  ${resultado.error.issues[0]?.message}`);
  }
  throw new ErroComando('Muitas tentativas inválidas. Nada foi gravado.');
}

await executarComando(async (pool) => {
  exigirTerminalInterativo();
  console.log('EcoRecife · criar administrador');
  console.log('Os dados são gravados no banco configurado em DATABASE_URL. A senha não aparece na tela.\n');

  const existentes = await contarAdministradores(pool);
  if (existentes > 0) {
    const resposta = await perguntar(`Já existe(m) ${existentes} administrador(es) ativo(s). Criar outro? (s/N) `);
    if (resposta.trim().toLowerCase() !== 's') throw new ErroComando('Cancelado. Nada foi gravado.');
  }

  const nome = await perguntarValido('Nome: ', esquemaNome);
  const email = await perguntarValido('E-mail: ', esquemaEmail);
  if (await emailCadastrado(pool, email)) throw new ErroComando('Já existe um usuário com esse e-mail.');

  console.log(`\nA senha precisa ter pelo menos ${SENHA_MIN} caracteres. Prefira uma frase longa.`);
  let senha: string | undefined;
  for (let tentativa = 1; tentativa <= TENTATIVAS && !senha; tentativa++) {
    const digitada = await perguntarOculto('Senha: ');
    const problema = validarSenha(digitada, email);
    if (problema) {
      console.log(`  ${problema}`);
      continue;
    }
    if ((await perguntarOculto('Confirme a senha: ')) !== digitada) {
      console.log('  As senhas não conferem.');
      continue;
    }
    senha = digitada;
  }
  if (!senha) throw new ErroComando('Muitas tentativas inválidas. Nada foi gravado.');

  const criado = await criarAdministrador(pool, { nome, email, senha });
  console.log(`\nAdministrador criado: ${criado.email} (id ${criado.id}).`);
});
