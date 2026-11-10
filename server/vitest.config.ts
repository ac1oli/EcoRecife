// Os testes de integração rodam num PostgreSQL descartável (test/apoio/postgres-de-teste.ts),
// nunca no Supabase oficial.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['test/apoio/postgres-de-teste.ts'],
    // Folga para a primeira execução, quando o PostgreSQL de teste ainda está "frio".
    hookTimeout: 30_000,
  },
});
