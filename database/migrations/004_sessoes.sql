-- =============================================================================
-- EcoRecife · Migração 004 · Sessões de login da gestão
-- A API entrega ao navegador um token aleatório (32 bytes) num cookie httpOnly e
-- guarda aqui só o SHA-256 dele: quem ler o banco não consegue usar as sessões.
-- A sessão vale até expira_em (prazo fixo, sem renovação automática). Logout,
-- usuário inativo ou usuário apagado invalidam a sessão.
-- =============================================================================
BEGIN;

CREATE TABLE sessoes (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id    bigint      NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  token_hash    bytea       NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  expira_em     timestamptz NOT NULL,
  ultimo_uso_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessoes_expiracao_valida CHECK (expira_em > criado_em)
);

-- Logout de todas as sessões de um usuário e limpeza das expiradas.
CREATE INDEX sessoes_usuario_idx ON sessoes (usuario_id);
CREATE INDEX sessoes_expira_em_idx ON sessoes (expira_em);

INSERT INTO schema_migrations (versao) VALUES ('004_sessoes');

COMMIT;
