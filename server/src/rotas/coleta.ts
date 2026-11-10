// /api/veiculos e /api/rotas: leitura pública (sem sessão) dos veículos e rotas ativos,
// todos demonstrativos. Não há cadastro pela API nem filtros (nenhum documento define).
import { Router } from 'express';
import type { Banco } from '../db.js';
import { listarRotas, listarVeiculos } from '../coleta/coleta.js';

export function rotasVeiculos(banco: Pick<Banco, 'query'>): Router {
  const rotas = Router();
  rotas.get('/', async (_req, res) => {
    res.json(await listarVeiculos(banco));
  });
  return rotas;
}

export function rotasDeColeta(banco: Pick<Banco, 'query'>): Router {
  const rotas = Router();
  rotas.get('/', async (_req, res) => {
    res.json(await listarRotas(banco));
  });
  return rotas;
}
