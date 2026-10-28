// Travas dos testes de integração (sem PostgreSQL): nenhuma conexão é aberta aqui.
import { describe, expect, it } from 'vitest';
import { verificarAmbienteDeTeste } from './apoio/banco-temporario.js';

const URL_TESTE = 'postgres://usuario:senha@localhost:5432/postgres';

describe('verificarAmbienteDeTeste', () => {
  it('aceita TEST_DATABASE_URL apontando para outro banco', () => {
    const env = { TEST_DATABASE_URL: URL_TESTE, DATABASE_URL: 'postgres://usuario:senha@localhost:5432/ecorecife' };
    expect(verificarAmbienteDeTeste(env)).toBe(URL_TESTE);
  });

  it('recusa quando TEST_DATABASE_URL é o mesmo banco de DATABASE_URL', () => {
    const env = { TEST_DATABASE_URL: URL_TESTE, DATABASE_URL: 'postgresql://outro:x@LOCALHOST/postgres' };
    expect(() => verificarAmbienteDeTeste(env)).toThrow(/mesmo banco/);
  });

  it('recusa NODE_ENV=production', () => {
    expect(() => verificarAmbienteDeTeste({ TEST_DATABASE_URL: URL_TESTE, NODE_ENV: 'production' })).toThrow(
      /production/,
    );
  });

  it('recusa a ausência de TEST_DATABASE_URL', () => {
    expect(() => verificarAmbienteDeTeste({})).toThrow(/TEST_DATABASE_URL/);
  });
});
