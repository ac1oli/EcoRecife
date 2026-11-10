// Montagem do Express. Recebe a configuração e o banco por parâmetro, o que permite
// testar a aplicação com um banco falso, sem abrir porta nem conexão real.
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import type { Config } from './config.js';
import type { Banco } from './db.js';
import type { Armazenamento } from './ocorrencias/fotos.js';
import { rotaNaoEncontrada, tratarErros } from './erros.js';
import { verificarOrigem } from './origem.js';
import { rotasAuth } from './rotas/auth.js';
import { rotasDeColeta, rotasVeiculos } from './rotas/coleta.js';
import { rotasGestaoOcorrencias } from './rotas/gestao-ocorrencias.js';
import { rotasOcorrencias } from './rotas/ocorrencias.js';
import { rotasPontos } from './rotas/pontos.js';
import { rotasSaude } from './rotas/saude.js';

export function criarApp(
  config: Pick<Config, 'origensCors' | 'ambiente' | 'sessaoHoras'> & { fotos: Armazenamento },
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
  // Primeiro as rotas públicas (registro e protocolo); o que não casar com elas segue
  // para as da gestão, todas protegidas por sessão e perfil.
  app.use('/api/ocorrencias', rotasOcorrencias(banco, config.fotos));
  app.use('/api/ocorrencias', rotasGestaoOcorrencias(banco, config, config.fotos));
  app.use('/api/pontos', rotasPontos(banco, config));
  // Coleta: leitura pública dos dados demonstrativos (a simulação vem na próxima etapa).
  app.use('/api/veiculos', rotasVeiculos(banco));
  app.use('/api/rotas', rotasDeColeta(banco));

  app.use(rotaNaoEncontrada);
  app.use(tratarErros);
  return app;
}
