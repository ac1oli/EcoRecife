// Montagem do Express. Recebe a configuração e o banco por parâmetro, o que permite
// testar a aplicação com um banco falso, sem abrir porta nem conexão real.
import { existsSync } from 'node:fs';
import path from 'node:path';
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
  config: Pick<Config, 'origensCors' | 'ambiente' | 'sessaoHoras'> &
    Partial<Pick<Config, 'proxiesConfiaveis' | 'pastaFront'>> & { fotos: Armazenamento },
  banco: Pick<Banco, 'query' | 'connect'>,
) {
  const app = express();
  // Atrás do proxy da hospedagem: req.ip passa a ser o IP real (limite de tentativas).
  if (config.proxiesConfiaveis) app.set('trust proxy', config.proxiesConfiaveis);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // O mapa do site carrega as imagens do OpenStreetMap; as fotos locais do
          // protótipo usam URLs blob:. O resto segue o padrão do helmet ('self').
          'img-src': ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.de'],
        },
      },
    }),
  );
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
  // Coleta: leitura pública dos dados demonstrativos (a simulação usa o Socket.IO).
  app.use('/api/veiculos', rotasVeiculos(banco));
  app.use('/api/rotas', rotasDeColeta(banco));

  // O site (build do front) no mesmo endereço da API. Os arquivos de assets/ têm o hash no
  // nome e podem ficar em cache; o index.html é sempre revalidado.
  if (config.pastaFront && existsSync(path.join(config.pastaFront, 'index.html'))) {
    app.use(
      express.static(config.pastaFront, {
        index: 'index.html',
        setHeaders: (res, arquivo) => {
          const emAssets = arquivo.includes(`${path.sep}assets${path.sep}`);
          res.setHeader('Cache-Control', emAssets ? 'public, max-age=31536000, immutable' : 'no-cache');
        },
      }),
    );
  }

  app.use(rotaNaoEncontrada);
  app.use(tratarErros);
  return app;
}
