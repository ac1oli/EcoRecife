// Configuração da API lida das variáveis de ambiente e validada com zod.
// Nenhum valor sensível tem padrão no código: sem DATABASE_URL a API não sobe.
import { z } from 'zod';

const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORTA: z.coerce.number().int().min(1).max(65535).default(3333),
  DATABASE_URL: z
    .string({ error: 'DATABASE_URL é obrigatória (veja server/.env.example)' })
    .trim()
    .regex(/^postgres(ql)?:\/\/.+/, 'DATABASE_URL deve começar com postgres:// ou postgresql://'),
  CORS_ORIGENS: z
    .string()
    .default('http://localhost:5173')
    .transform((valor) => valor.split(',').map((origem) => origem.trim()).filter(Boolean))
    .pipe(
      z
        .array(z.url({ protocol: /^https?$/, error: 'Cada origem de CORS_ORIGENS deve ser uma URL http(s)' }))
        .min(1, 'Informe ao menos uma origem em CORS_ORIGENS'),
    ),
});

export type Config = {
  ambiente: 'development' | 'test' | 'production';
  porta: number;
  databaseUrl: string;
  origensCors: string[];
};

export class ErroConfiguracao extends Error {}

export function carregarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const resultado = esquema.safeParse(env);
  if (!resultado.success) {
    const problemas = resultado.error.issues.map((issue) => `- ${issue.path.join('.')}: ${issue.message}`);
    throw new ErroConfiguracao(`Configuração inválida:\n${problemas.join('\n')}`);
  }
  const dados = resultado.data;
  return {
    ambiente: dados.NODE_ENV,
    porta: dados.PORTA,
    databaseUrl: dados.DATABASE_URL,
    // Origem sem barra final, como o navegador envia no cabeçalho Origin.
    origensCors: dados.CORS_ORIGENS.map((origem) => origem.replace(/\/+$/, '')),
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
