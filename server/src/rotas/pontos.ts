// /api/pontos: guia de reciclagem. A listagem e os mais próximos são públicos (só
// pontos ativos); cadastro, edição, desativação e a visão com inativos são só do admin
// (docs/04: "CRUD para admin"), com exigirSessao + exigirPerfil('admin') em cada rota.
import { Router, type Response } from 'express';
import type { z } from 'zod';
import { exigirPerfil, exigirSessao } from '../auth/middlewares.js';
import type { Config } from '../config.js';
import type { Banco } from '../db.js';
import { ErroHttp } from '../erros.js';
import {
  criarPonto,
  desativarPonto,
  detalharPonto,
  editarPonto,
  esquemaEdicaoPonto,
  esquemaFiltros,
  esquemaFiltrosGestao,
  esquemaNovoPonto,
  esquemaProximos,
  lerIdPonto,
  listarPontos,
  listarPontosGestao,
  pontosProximos,
} from '../pontos/pontos.js';

function validar<T extends z.ZodType>(esquema: T, dados: unknown): z.infer<T> {
  const resultado = esquema.safeParse(dados ?? {});
  if (!resultado.success) throw new ErroHttp(400, resultado.error.issues[0]?.message ?? 'Dados inválidos');
  return resultado.data;
}

export function rotasPontos(banco: Pick<Banco, 'query' | 'connect'>, config: Pick<Config, 'ambiente'>): Router {
  const rotas = Router();
  const somenteAdmin = [exigirSessao(banco, config.ambiente), exigirPerfil('admin')];
  const semCache = (res: Response) => res.set('Cache-Control', 'private, no-store');

  // Públicas. As rotas fixas vêm antes de /:id.
  rotas.get('/', async (req, res) => {
    res.json(await listarPontos(banco, validar(esquemaFiltros, req.query)));
  });

  rotas.get('/proximos', async (req, res) => {
    // A posição do cidadão não deve ficar em cache de proxies.
    semCache(res);
    res.json(await pontosProximos(banco, validar(esquemaProximos, req.query)));
  });

  // Admin.
  rotas.get('/gestao', ...somenteAdmin, async (req, res) => {
    semCache(res);
    res.json(await listarPontosGestao(banco, validar(esquemaFiltrosGestao, req.query)));
  });

  rotas.get('/:id', ...somenteAdmin, async (req, res) => {
    semCache(res);
    res.json(await detalharPonto(banco, lerIdPonto(req.params.id)));
  });

  rotas.post('/', ...somenteAdmin, async (req, res) => {
    const id = await criarPonto(banco, validar(esquemaNovoPonto, req.body));
    semCache(res);
    res.status(201).location(`/api/pontos/${id}`).json(await detalharPonto(banco, id));
  });

  rotas.patch('/:id', ...somenteAdmin, async (req, res) => {
    const id = lerIdPonto(req.params.id);
    await editarPonto(banco, id, validar(esquemaEdicaoPonto, req.body));
    semCache(res);
    res.json(await detalharPonto(banco, id));
  });

  rotas.delete('/:id', ...somenteAdmin, async (req, res) => {
    await desativarPonto(banco, lerIdPonto(req.params.id));
    res.status(204).end();
  });

  return rotas;
}
