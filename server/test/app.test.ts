// Testes da aplicação Express com um banco falso (sem PostgreSQL).
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { criarApp } from '../src/app.js';
import { criarArmazenamentoDisco } from '../src/ocorrencias/fotos.js';

// Estes testes não enviam fotos; a pasta existe só para completar a configuração.
const SEM_UPLOAD = path.join(tmpdir(), 'ecorecife-testes-sem-upload');

const config = { origensCors: ['http://localhost:5173'], ambiente: 'test' as const, sessaoHoras: 8, fotos: criarArmazenamentoDisco(SEM_UPLOAD) };
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

describe('hospedagem: site servido pela API, proxy e CSP', () => {
  const pastaSite = mkdtempSync(path.join(tmpdir(), 'ecorecife-site-'));
  mkdirSync(path.join(pastaSite, 'assets'));
  writeFileSync(path.join(pastaSite, 'index.html'), '<!doctype html><title>EcoRecife</title>');
  writeFileSync(path.join(pastaSite, 'assets', 'index-abc123.js'), 'console.log(1)');
  const comSite = criarApp({ ...config, pastaFront: pastaSite, proxiesConfiaveis: 1 }, bancoOk as never);

  it('entrega o index.html na raiz, sempre revalidado', async () => {
    const r = await request(comSite).get('/');
    expect(r.status).toBe(200);
    expect(r.text).toContain('<title>EcoRecife</title>');
    expect(r.headers['cache-control']).toBe('no-cache');
  });

  it('assets com hash no nome ficam em cache longo', async () => {
    const r = await request(comSite).get('/assets/index-abc123.js');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('a API continua respondendo e o 404 da API segue em JSON', async () => {
    expect((await request(comSite).get('/api/saude')).status).toBe(200);
    const r = await request(comSite).get('/api/nao-existe');
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ erro: 'Recurso não encontrado' });
  });

  it('não expõe arquivos fora da pasta do site', async () => {
    expect((await request(comSite).get('/../package.json')).status).toBe(404);
    expect((await request(comSite).get('/%2e%2e/package.json')).status).toBe(404);
  });

  it('sem o build (ou com SERVIR_FRONT=false) só a API responde', async () => {
    const semSite = criarApp({ ...config, pastaFront: path.join(pastaSite, 'nao-existe') }, bancoOk as never);
    expect((await request(semSite).get('/')).status).toBe(404);
    expect((await request(criarApp({ ...config, pastaFront: null }, bancoOk as never)).get('/')).status).toBe(404);
  });

  it('CSP libera só as imagens do mapa (OpenStreetMap) além do próprio site', async () => {
    const csp = (await request(comSite).get('/')).headers['content-security-policy'];
    expect(csp).toContain("img-src 'self' data: blob: https://tile.openstreetmap.de");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
  });

  it('trust proxy só quando configurado', () => {
    expect(comSite.get('trust proxy')).toBe(1);
    expect(criarApp(config, bancoOk as never).get('trust proxy')).toBe(false);
  });
});
