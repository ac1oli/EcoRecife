// Montagem do Express. Recebe a configuração e o banco por parâmetro, o que permite
// testar a aplicação com um banco falso, sem abrir porta nem conexão real.
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import type { Config } from './config.js';
import type { Banco } from './db.js';
import { rotaNaoEncontrada, tratarErros } from './erros.js';
import { rotasSaude } from './rotas/saude.js';

export function criarApp(config: Pick<Config, 'origensCors'>, banco: Pick<Banco, 'query'>) {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      // Só as origens configuradas recebem os cabeçalhos CORS. Requisições sem Origin
      // (curl, o próprio servidor) não passam por CORS e seguem normalmente.
      origin: (origem, callback) => callback(null, !origem || config.origensCors.includes(origem)),
      credentials: true, // o cookie de sessão (parte 2) exige credenciais
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/saude', rotasSaude(banco));
  // Próximas partes do CP2: /api/auth, /api/ocorrencias, /api/pontos, /api/veiculos, /api/rotas.

  app.use(rotaNaoEncontrada);
  app.use(tratarErros);
  return app;
}
