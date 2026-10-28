// /api/ocorrencias: rotas públicas da Zeladoria Cidadã (cidadão anônimo, sem login).
// As rotas da gestão (listagem, status, fotos) virão na parte 4, com exigirSessao/exigirPerfil.
import { Router } from 'express';
import type { Config } from '../config.js';
import type { Banco } from '../db.js';
import { ErroHttp } from '../erros.js';
import { limitarFalhas } from '../limite.js';
import { criarArmazenamento, receberFormulario, validarFotos } from '../ocorrencias/fotos.js';
import {
  consultarProtocolo,
  esquemaOcorrencia,
  PADRAO_PROTOCOLO,
  registrarOcorrencia,
} from '../ocorrencias/ocorrencias.js';

export function rotasOcorrencias(banco: Pick<Banco, 'query' | 'connect'>, config: Pick<Config, 'pastaUploads'>): Router {
  const rotas = Router();
  const armazenamento = criarArmazenamento(config.pastaUploads);
  // Contra varredura de protocolos: mesmo limite do login (falhas por IP, em memória).
  const limitarConsulta = limitarFalhas('Muitas consultas de protocolo sem sucesso. Tente novamente em alguns minutos.');

  rotas.post('/', receberFormulario, async (req, res) => {
    const dados = esquemaOcorrencia.safeParse({ ...req.body });
    if (!dados.success) throw new ErroHttp(400, dados.error.issues[0]?.message ?? 'Dados inválidos');
    const fotos = await validarFotos((req.files as Express.Multer.File[] | undefined) ?? []);
    const criada = await registrarOcorrencia(banco, armazenamento, dados.data, fotos);
    res.status(201).location(`/api/ocorrencias/protocolo/${criada.protocolo}`).json(criada);
  });

  rotas.get('/protocolo/:protocolo', limitarConsulta, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const protocolo = String(req.params.protocolo ?? '').trim().toUpperCase();
    if (!PADRAO_PROTOCOLO.test(protocolo)) {
      throw new ErroHttp(400, 'Protocolo inválido. Use o formato ECO-AAAA-XXXX-XXXX.');
    }
    const consulta = await consultarProtocolo(banco, protocolo);
    if (!consulta) throw new ErroHttp(404, 'Protocolo não encontrado');
    res.json(consulta);
  });

  return rotas;
}
