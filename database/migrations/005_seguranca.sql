-- =============================================================================
-- EcoRecife · Migração 005 · Segurança do banco no Supabase
-- O Supabase publica o schema "public" pela Data API (PostgREST) para os papéis anon e
-- authenticated (quem tem a publishable key) e service_role (secret key). O EcoRecife não
-- usa a Data API: só a API Express acessa o banco, conectada como dona das tabelas.
-- Por isso:
--   1. RLS ligada em todas as tabelas, SEM nenhuma policy: só a dona (a API) lê e grava;
--   2. nenhum privilégio para anon, authenticated e service_role nas tabelas, sequências e
--      funções do public, nem nas que forem criadas depois (privilégios padrão);
--   3. funções com search_path fixo e sem EXECUTE para PUBLIC.
-- Num PostgreSQL comum (testes) esses papéis não existem e o passo 2 não faz nada.
-- =============================================================================
BEGIN;

ALTER TABLE schema_migrations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios              ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessoes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE bairros               ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorias_ocorrencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocorrencias           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocorrencia_fotos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocorrencia_historico  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pontos_descarte       ENABLE ROW LEVEL SECURITY;
ALTER TABLE materiais             ENABLE ROW LEVEL SECURITY;
ALTER TABLE ponto_materiais       ENABLE ROW LEVEL SECURITY;
ALTER TABLE veiculos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE rotas                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE rota_pontos           ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  papel text;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', papel);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', papel);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', papel);
      -- Objetos criados depois por este mesmo papel (as próximas migrações).
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', papel);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', papel);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', papel);
    END IF;
  END LOOP;
END
$$;

-- As funções usam só o que está em pg_catalog (gen_random_uuid é nativa desde o PG 13).
ALTER FUNCTION distancia_km(double precision, double precision, double precision, double precision)
  SET search_path = pg_catalog;
ALTER FUNCTION gerar_protocolo() SET search_path = pg_catalog;
ALTER FUNCTION definir_atualizado_em() SET search_path = pg_catalog;

REVOKE EXECUTE ON FUNCTION distancia_km(double precision, double precision, double precision, double precision) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION gerar_protocolo() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION definir_atualizado_em() FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

INSERT INTO schema_migrations (versao) VALUES ('005_seguranca');

COMMIT;
