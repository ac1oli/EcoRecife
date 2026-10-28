// Testes da aplicação Express com um banco falso (sem PostgreSQL).
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { criarApp } from '../src/app.js';

// Estes testes não enviam fotos; a pasta existe só para completar a configuração.
const SEM_UPLOAD = path.join(tmpdir(), 'ecorecife-testes-sem-upload');

const config = { origensCors: ['http://localhost:5173'], ambiente: 'test' as const, sessaoHoras: 8, pastaUploads: SEM_UPLOAD };
const bancoOk = { query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) };
const bancoFora = { query: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5432')) };

describe('GET /api/saude', () => {
  it('responde 200 quando o banco responde', async () => {
    const resposta = await request(criarApp(config, bancoOk as never)).get('/api/saude');
    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({ status: 'ok', banco: 'conectado' });
    expect(bancoOk.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('responde 503 sem detalhes internos quando o banco está fora', async () => {
    const resposta = await request(criarApp(config, bancoFora as never)).get('/api/saude');
    expect(resposta.status).toBe(503);
    expect(resposta.body).toMatchObject({ status: 'erro', banco: 'indisponivel' });
    expect(JSON.stringify(resposta.body)).not.toMatch(/ECONNREFUSED|5432/);
  });
});

describe('segurança básica', () => {
  const app = criarApp(config, bancoOk as never);

  it('envia cabeçalhos do helmet e esconde o X-Powered-By', async () => {
    const resposta = await request(app).get('/api/saude');
    expect(resposta.headers['x-content-type-options']).toBe('nosniff');
    expect(resposta.headers['x-powered-by']).toBeUndefined();
  });

  it('libera CORS só para a origem configurada', async () => {
    const permitida = await request(app).get('/api/saude').set('Origin', 'http://localhost:5173');
    expect(permitida.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(permitida.headers['access-control-allow-credentials']).toBe('true');

    const outra = await request(app).get('/api/saude').set('Origin', 'https://site-qualquer.example');
    expect(outra.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('responde 404 em JSON para rota inexistente', async () => {
    const resposta = await request(app).get('/api/nao-existe');
    expect(resposta.status).toBe(404);
    expect(resposta.body).toEqual({ erro: 'Recurso não encontrado' });
  });

  it('responde 400 para JSON malformado, sem stack trace', async () => {
    const resposta = await request(app)
      .post('/api/saude')
      .set('Content-Type', 'application/json')
      .send('{"quebrado":');
    expect(resposta.status).toBe(400);
    expect(resposta.body).toEqual({ erro: 'Requisição inválida' });
  });
});
