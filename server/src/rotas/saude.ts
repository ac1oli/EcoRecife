// GET /api/saude: indica se a API está no ar e se consegue consultar o banco.
import { Router } from 'express';
import { bancoDisponivel, type Banco } from '../db.js';

export function rotasSaude(banco: Pick<Banco, 'query'>): Router {
  const rotas = Router();
  rotas.get('/', async (_req, res) => {
    const conectado = await bancoDisponivel(banco);
    res.status(conectado ? 200 : 503).json({
      status: conectado ? 'ok' : 'erro',
      banco: conectado ? 'conectado' : 'indisponivel',
      horario: new Date().toISOString(),
    });
  });
  return rotas;
}
