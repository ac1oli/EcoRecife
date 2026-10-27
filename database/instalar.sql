-- =============================================================================
-- EcoRecife · Instalação completa do banco (migrações + dados demonstrativos)
-- Uso (na pasta database/, com o banco "ecorecife" já criado e vazio):
--   psql -U postgres -d ecorecife -f instalar.sql
-- Para recriar do zero, veja docs/03-banco-de-dados.md.
-- =============================================================================
\set ON_ERROR_STOP on
\encoding UTF8
SET client_min_messages = warning;

\echo '>> Migração 001: tipos e funções'
\ir migrations/001_tipos_e_funcoes.sql
\echo '>> Migração 002: tabelas'
\ir migrations/002_tabelas.sql
\echo '>> Migração 003: índices e gatilhos'
\ir migrations/003_indices_e_gatilhos.sql
\echo '>> Seed 001: dados demonstrativos'
\ir seeds/001_dados_demonstrativos.sql

\echo '>> Concluído. Migrações aplicadas:'
SELECT versao, aplicada_em FROM schema_migrations ORDER BY versao;
