// Montagem do Express. Recebe a configuração e o banco por parâmetro, o que permite
// testar a aplicação com um banco falso, sem abrir porta nem conexão real.
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import type { Config } from './config.js';
import type { Banco } from './db.js';
import { rotaNaoEncontrada, tratarErros } from './erros.js';
import { verificarOrigem } from './origem.js';
import { rotasAuth } from './rotas/auth.js';
import { rotasOcorrencias } from './rotas/ocorrencias.js';
import { rotasSaude } from './rotas/saude.js';

export function criarApp(
  config: Pick<Config, 'origensCors' | 'ambiente' | 'sessaoHoras' | 'pastaUploads'>,
  banco: Pick<Banco, 'query' | 'connect'>,
) {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      // Só as origens configuradas recebem os cabeçalhos CORS. Requisições sem Origin
      // (curl, o próprio servidor) não passam por CORS e seguem normalmente.
      origin: (origem, callback) => callback(null, !origem || config.origensCors.includes(origem)),
      credentials: true, // o cookie de sessão exige credenciais
    }),
  );
  app.use(verificarOrigem(config.origensCors));
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/saude', rotasSaude(banco));
  app.use('/api/auth', rotasAuth(banco, config));
  app.use('/api/ocorrencias', rotasOcorrencias(banco, config));
  // Próximas partes do CP2: gestão de ocorrências, /api/pontos, /api/veiculos, /api/rotas.

  app.use(rotaNaoEncontrada);
  app.use(tratarErros);
  return app;
}
