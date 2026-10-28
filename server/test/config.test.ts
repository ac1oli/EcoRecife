import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { carregarConfig, ErroConfiguracao } from '../src/config.js';

const URL_OK = 'postgres://usuario:senha@localhost:5432/ecorecife';

describe('carregarConfig', () => {
  it('aplica os padrões quando só DATABASE_URL é informada', () => {
    expect(carregarConfig({ DATABASE_URL: URL_OK })).toEqual({
      ambiente: 'development',
      porta: 3333,
      databaseUrl: URL_OK,
      origensCors: ['http://localhost:5173'],
      sessaoHoras: 8,
      pastaUploads: path.resolve(import.meta.dirname, '../uploads'),
    });
  });

  it('lê porta, ambiente e várias origens de CORS (sem barra final)', () => {
    const config = carregarConfig({
      DATABASE_URL: URL_OK,
      NODE_ENV: 'production',
      PORTA: '8080',
      CORS_ORIGENS: 'https://eco.exemplo.org/, http://localhost:5173',
    });
    expect(config.porta).toBe(8080);
    expect(config.ambiente).toBe('production');
    expect(config.origensCors).toEqual(['https://eco.exemplo.org', 'http://localhost:5173']);
  });

  it('resolve UPLOADS_DIR relativo à pasta server/ ou absoluto', () => {
    const absoluto = path.resolve('/tmp/eco-fotos');
    expect(carregarConfig({ DATABASE_URL: URL_OK, UPLOADS_DIR: 'dados/fotos' }).pastaUploads).toBe(
      path.resolve(import.meta.dirname, '../dados/fotos'),
    );
    expect(carregarConfig({ DATABASE_URL: URL_OK, UPLOADS_DIR: absoluto }).pastaUploads).toBe(absoluto);
  });

  it('lê SESSAO_HORAS', () => {
    expect(carregarConfig({ DATABASE_URL: URL_OK, SESSAO_HORAS: '24' }).sessaoHoras).toBe(24);
  });

  it('recusa a ausência de DATABASE_URL', () => {
    expect(() => carregarConfig({})).toThrow(ErroConfiguracao);
    expect(() => carregarConfig({})).toThrow(/DATABASE_URL/);
  });

  it.each([
    ['DATABASE_URL não postgres', { DATABASE_URL: 'mysql://x@localhost/db' }],
    ['porta não numérica', { DATABASE_URL: URL_OK, PORTA: 'abc' }],
    ['porta fora do intervalo', { DATABASE_URL: URL_OK, PORTA: '70000' }],
    ['ambiente desconhecido', { DATABASE_URL: URL_OK, NODE_ENV: 'staging' }],
    ['origem CORS inválida', { DATABASE_URL: URL_OK, CORS_ORIGENS: 'localhost:5173' }],
    ['origem CORS curinga', { DATABASE_URL: URL_OK, CORS_ORIGENS: '*' }],
    ['CORS vazio', { DATABASE_URL: URL_OK, CORS_ORIGENS: ' , ' }],
    ['sessão de 0 horas', { DATABASE_URL: URL_OK, SESSAO_HORAS: '0' }],
    ['sessão maior que 7 dias', { DATABASE_URL: URL_OK, SESSAO_HORAS: '169' }],
    ['sessão fracionária', { DATABASE_URL: URL_OK, SESSAO_HORAS: '1.5' }],
  ])('recusa %s', (_caso, env) => {
    expect(() => carregarConfig(env)).toThrow(ErroConfiguracao);
  });

  it('não expõe a senha do banco na mensagem de erro', () => {
    try {
      carregarConfig({ DATABASE_URL: URL_OK, PORTA: 'abc' });
    } catch (erro) {
      expect((erro as Error).message).not.toContain('senha');
    }
  });
});
