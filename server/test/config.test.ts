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
