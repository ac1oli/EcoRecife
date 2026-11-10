// /api/ocorrencias (gestão): rotas só para servidores logados. Cada rota declara
// exigirSessao + exigirPerfil; o usuário responsável vem sempre da sessão, nunca do corpo.
// As rotas públicas (registro e consulta por protocolo) estão em ./ocorrencias.ts.
import { Router, type Response } from 'express';
import type { z } from 'zod';
import { exigirPerfil, exigirSessao } from '../auth/middlewares.js';
import type { Config } from '../config.js';
import type { Banco } from '../db.js';
import { ErroHttp } from '../erros.js';
import type { Armazenamento } from '../ocorrencias/fotos.js';
import {
  buscarFoto,
  detalharOcorrencia,
  esquemaConcluir,
  esquemaFiltros,
  esquemaPrioridade,
  esquemaReabrir,
  esquemaStatus,
  lerIdFoto,
  lerIdOcorrencia,
  listarOcorrencias,
  mudarPrioridade,
  mudarStatus,
} from '../ocorrencias/gestao.js';

// Nenhum documento do projeto restringe a gestão de ocorrências a um só perfil.
export const PERFIS_GESTAO = ['admin', 'gestor'] as const;

function validar<T extends z.ZodType>(esquema: T, dados: unknown): z.infer<T> {
  const resultado = esquema.safeParse(dados ?? {});
  if (!resultado.success) throw new ErroHttp(400, resultado.error.issues[0]?.message ?? 'Dados inválidos');
  return resultado.data;
}

function usuarioDaSessao(res: Response): string {
  const usuario = res.locals.usuario;
  if (!usuario) throw new ErroHttp(401, 'Sessão inválida ou expirada. Faça login novamente.');
  return usuario.id;
}

export function rotasGestaoOcorrencias(
  banco: Pick<Banco, 'query' | 'connect'>,
  config: Pick<Config, 'ambiente'>,
  armazenamento: Armazenamento,
): Router {
  const rotas = Router();
  const protegida = [exigirSessao(banco, config.ambiente), exigirPerfil(...PERFIS_GESTAO)];

  // Dados internos da gestão: nada de cache no navegador nem em proxies.
  const semCache = (res: Response) => res.set('Cache-Control', 'private, no-store');

  rotas.get('/', ...protegida, async (req, res) => {
    semCache(res);
    res.json(await listarOcorrencias(banco, validar(esquemaFiltros, req.query)));
  });

  rotas.get('/:id', ...protegida, async (req, res) => {
    semCache(res);
    res.json(await detalharOcorrencia(banco, lerIdOcorrencia(req.params.id)));
  });

  rotas.patch('/:id/status', ...protegida, async (req, res) => {
    const id = lerIdOcorrencia(req.params.id);
    const { status, observacao } = validar(esquemaStatus, req.body);
    await mudarStatus(banco, id, usuarioDaSessao(res), { tipo: 'status', status }, observacao);
    semCache(res);
    res.json(await detalharOcorrencia(banco, id));
  });

  rotas.post('/:id/concluir', ...protegida, async (req, res) => {
    const id = lerIdOcorrencia(req.params.id);
    const { nota } = validar(esquemaConcluir, req.body);
    await mudarStatus(banco, id, usuarioDaSessao(res), { tipo: 'concluir' }, nota);
    semCache(res);
    res.json(await detalharOcorrencia(banco, id));
  });

  rotas.post('/:id/reabrir', ...protegida, async (req, res) => {
    const id = lerIdOcorrencia(req.params.id);
    const { observacao } = validar(esquemaReabrir, req.body);
    await mudarStatus(banco, id, usuarioDaSessao(res), { tipo: 'reabrir' }, observacao);
    semCache(res);
    res.json(await detalharOcorrencia(banco, id));
  });

  rotas.patch('/:id/prioridade', ...protegida, async (req, res) => {
    const id = lerIdOcorrencia(req.params.id);
    const { prioridade } = validar(esquemaPrioridade, req.body);
    await mudarPrioridade(banco, id, prioridade);
    semCache(res);
    res.json(await detalharOcorrencia(banco, id));
  });

  // Fotos: só com sessão e só se a foto pertencer à ocorrência da URL. O bucket do
  // Storage é privado: a foto só chega ao navegador por esta rota.
  rotas.get('/:id/fotos/:fotoId', ...protegida, async (req, res) => {
    const id = lerIdOcorrencia(req.params.id);
    const foto = await buscarFoto(banco, id, lerIdFoto(req.params.fotoId));
    if (!foto) throw new ErroHttp(404, 'Foto não encontrada');
    if (!armazenamento.chaveValida(foto.chave_armazenamento)) {
      console.error(`[fotos] chave fora do padrão no banco (foto da ocorrência ${id}); envio recusado`);
      throw new ErroHttp(404, 'Foto não encontrada');
    }
    const conteudo = await armazenamento.ler(foto.chave_armazenamento);
    if (!conteudo) {
      console.error(`[fotos] arquivo ausente no armazenamento (foto da ocorrência ${id})`);
      throw new ErroHttp(404, 'Foto não encontrada');
    }
    res.set({
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'inline',
      'Content-Type': foto.tipo_mime,
      // O front (outra porta, mesmo site) precisa exibir a imagem num <img>.
      'Cross-Origin-Resource-Policy': 'same-site',
    });
    res.send(conteudo);
  });

  return rotas;
}
