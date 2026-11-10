// Configuração da API lida das variáveis de ambiente e validada com zod.
// Nenhum valor sensível tem padrão no código: sem DATABASE_URL a API não sobe.
// O banco oficial é o PostgreSQL do Supabase (pooler de sessão, TLS verificado com a CA
// do Supabase). Bancos locais são usados só pelos testes automatizados, fora daqui.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { INTERVALO_MAXIMO_MS, INTERVALO_MINIMO_MS, INTERVALO_PADRAO_MS } from './coleta/simulador.js';

// Pasta server/: base dos caminhos relativos do .env (independe de onde o comando roda).
const PASTA_SERVER = path.resolve(import.meta.dirname, '..');

// Parâmetros de TLS na URL substituiriam a configuração de TLS do pool (o pg dá prioridade
// à URL); a verificação do certificado é configurada só pelo DATABASE_SSL_CA.
const PARAMETROS_TLS = ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslpassword', 'uselibpqcompat'];
const REF_PROJETO = /^[a-z0-9]{20}$/;

const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORTA: z.coerce.number().int().min(1).max(65535).default(3333),
  DATABASE_URL: z
    .string({ error: 'DATABASE_URL é obrigatória (veja server/.env.example)' })
    .trim()
    .regex(/^postgres(ql)?:\/\/.+/, 'DATABASE_URL deve começar com postgres:// ou postgresql://'),
  // Certificado da CA do Supabase (Database Settings → SSL), relativo à pasta server/.
  DATABASE_SSL_CA: z.string().trim().min(1).default('certs/prod-ca-2021.crt'),
  CORS_ORIGENS: z
    .string()
    .default('http://localhost:5173')
    .transform((valor) => valor.split(',').map((origem) => origem.trim()).filter(Boolean))
    .pipe(
      z
        .array(z.url({ protocol: /^https?$/, error: 'Cada origem de CORS_ORIGENS deve ser uma URL http(s)' }))
        .min(1, 'Informe ao menos uma origem em CORS_ORIGENS'),
    ),
  // Duração fixa da sessão de login (sem renovação automática): de 1 hora a 7 dias.
  SESSAO_HORAS: z.coerce.number().int().min(1).max(168).default(8),
  // Simulação da coleta (D11): ligada por padrão; "false" desliga o Socket.IO inteiro.
  SIMULACAO_ATIVA: z
    .enum(['true', 'false'], 'SIMULACAO_ATIVA deve ser true ou false')
    .default('true')
    .transform((valor) => valor === 'true'),
  // Intervalo entre as posições transmitidas (D7: 3 s), a mesma faixa aceita pelo simulador.
  SIMULACAO_INTERVALO_MS: z.coerce
    .number()
    .int()
    .min(INTERVALO_MINIMO_MS)
    .max(INTERVALO_MAXIMO_MS)
    .default(INTERVALO_PADRAO_MS),
});

export type Config = {
  ambiente: 'development' | 'test' | 'production';
  porta: number;
  databaseUrl: string; // sem parâmetros de TLS
  bancoCertificadoCa: string; // PEM da CA do Supabase
  projetoSupabase: string; // ref do projeto (identifica o ambiente nos logs, sem segredo)
  origensCors: string[];
  sessaoHoras: number;
  simulacaoAtiva: boolean;
  simulacaoIntervaloMs: number;
};

export class ErroConfiguracao extends Error {}

function falhar(problemas: string[]): never {
  throw new ErroConfiguracao(`Configuração inválida:\n${problemas.map((p) => `- ${p}`).join('\n')}`);
}

// Aceita só o PostgreSQL do Supabase: pooler de sessão (aws-0-<região>.pooler.supabase.com,
// usuário postgres.<ref>) ou conexão direta (db.<ref>.supabase.co). O pooler de transação
// (porta 6543) não serve: o migrador usa trava consultiva de sessão.
export function analisarUrlSupabase(valor: string): { url: string; projeto: string } {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    falhar(['DATABASE_URL: não é uma URL válida']);
  }
  const host = url.hostname.toLowerCase();
  const porta = url.port || '5432';
  const usuario = decodeURIComponent(url.username);
  let projeto: string | undefined;
  if (host.endsWith('.pooler.supabase.com')) {
    projeto = usuario.startsWith('postgres.') ? usuario.slice('postgres.'.length) : undefined;
    if (!projeto) falhar(['DATABASE_URL: no pooler do Supabase o usuário é postgres.<id do projeto>']);
  } else {
    projeto = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(host)?.[1];
  }
  if (!projeto) {
    falhar([
      'DATABASE_URL: o banco oficial do EcoRecife é o Supabase. Use a connection string do "Session pooler" ' +
        '(painel do Supabase → Connect). Bancos locais ficam só para os testes (docs/06-api.md, seção 5)',
    ]);
  }
  if (!REF_PROJETO.test(projeto)) falhar(['DATABASE_URL: id do projeto Supabase fora do formato esperado']);
  if (porta === '6543') {
    falhar(['DATABASE_URL: a porta 6543 é o "Transaction pooler"; use o "Session pooler" (porta 5432)']);
  }
  if (porta !== '5432') falhar([`DATABASE_URL: porta ${porta} inesperada para o Supabase (use 5432)`]);
  if (!url.password) falhar(['DATABASE_URL: falta a senha do banco (Database Settings → Database password)']);
  for (const parametro of PARAMETROS_TLS) url.searchParams.delete(parametro);
  return { url: url.toString(), projeto };
}

function lerCertificado(caminho: string): string {
  const arquivo = path.resolve(PASTA_SERVER, caminho);
  let conteudo: string;
  try {
    conteudo = readFileSync(arquivo, 'utf8');
  } catch {
    falhar([
      `DATABASE_SSL_CA: certificado não encontrado em ${arquivo}. Baixe-o no painel do Supabase ` +
        '(Database Settings → SSL Configuration → Download certificate)',
    ]);
  }
  if (!conteudo.includes('-----BEGIN CERTIFICATE-----')) {
    falhar([`DATABASE_SSL_CA: ${arquivo} não é um certificado PEM`]);
  }
  return conteudo;
}

export function carregarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const resultado = esquema.safeParse(env);
  if (!resultado.success) {
    falhar(resultado.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
  }
  const dados = resultado.data;
  const banco = analisarUrlSupabase(dados.DATABASE_URL);
  return {
    ambiente: dados.NODE_ENV,
    porta: dados.PORTA,
    databaseUrl: banco.url,
    bancoCertificadoCa: lerCertificado(dados.DATABASE_SSL_CA),
    projetoSupabase: banco.projeto,
    // Origem sem barra final, como o navegador envia no cabeçalho Origin.
    origensCors: dados.CORS_ORIGENS.map((origem) => origem.replace(/\/+$/, '')),
    sessaoHoras: dados.SESSAO_HORAS,
    simulacaoAtiva: dados.SIMULACAO_ATIVA,
    simulacaoIntervaloMs: dados.SIMULACAO_INTERVALO_MS,
  };
}

// Supabase Storage (fotos das ocorrências): só a API e os comandos de Storage precisam.
// A chave secreta fica só no .env do servidor; a publishable key não é usada.
const esquemaStorage = z.object({
  SUPABASE_URL: z
    .string({ error: 'SUPABASE_URL é obrigatória (veja server/.env.example)' })
    .trim()
    .regex(/^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/, 'SUPABASE_URL deve ser https://<id do projeto>.supabase.co'),
  SUPABASE_SECRET_KEY: z
    .string({ error: 'SUPABASE_SECRET_KEY é obrigatória (painel do Supabase → Settings → API Keys → Secret keys)' })
    .trim()
    .refine((chave) => !chave.startsWith('sb_publishable_'), 'SUPABASE_SECRET_KEY: a publishable key não serve aqui')
    .refine((chave) => !/TROQUE/i.test(chave), 'SUPABASE_SECRET_KEY ainda é o valor de exemplo do .env.example')
    .refine((chave) => /^sb_secret_[A-Za-z0-9_-]{10,}$/.test(chave), 'SUPABASE_SECRET_KEY deve ser uma secret key (sb_secret_...)'),
  SUPABASE_BUCKET_FOTOS: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, 'SUPABASE_BUCKET_FOTOS: só letras minúsculas, números e hífen')
    .default('ocorrencias-fotos'),
});

export type ConfigStorage = { supabaseUrl: string; chaveSecreta: string; bucketFotos: string; projeto: string };

export function carregarConfigStorage(env: NodeJS.ProcessEnv = process.env, projetoDoBanco?: string): ConfigStorage {
  const resultado = esquemaStorage.safeParse(env);
  if (!resultado.success) {
    falhar(resultado.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
  }
  const supabaseUrl = resultado.data.SUPABASE_URL.replace(/\/+$/, '');
  const projeto = new URL(supabaseUrl).hostname.split('.')[0]!;
  if (projetoDoBanco && projeto !== projetoDoBanco) {
    falhar([`SUPABASE_URL (projeto ${projeto}) e DATABASE_URL (projeto ${projetoDoBanco}) são de projetos diferentes`]);
  }
  return {
    supabaseUrl,
    chaveSecreta: resultado.data.SUPABASE_SECRET_KEY,
    bucketFotos: resultado.data.SUPABASE_BUCKET_FOTOS,
    projeto,
  };
}

// Carrega server/.env, se existir (recurso nativo do Node 22, sem dependência extra).
// Variáveis já definidas no ambiente têm prioridade sobre o arquivo.
export function carregarArquivoEnv(caminho = '.env'): void {
  try {
    process.loadEnvFile(caminho);
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code !== 'ENOENT') throw erro;
  }
}
