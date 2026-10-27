-- =============================================================================
-- EcoRecife · Migração 001 · Controle de versões, tipos enumerados e funções
-- Requisitos: PostgreSQL 14+ (usa gen_random_uuid(), nativo desde a versão 13).
-- Nenhuma extensão é necessária (decisão registrada em docs/02-modelagem-banco.md).
-- =============================================================================
BEGIN;

-- Registro das migrações aplicadas. Cada arquivo insere a própria versão;
-- reaplicar um arquivo falha na chave primária, o que evita execução duplicada.
CREATE TABLE schema_migrations (
  versao      text        PRIMARY KEY,
  aplicada_em timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Tipos enumerados (valores ASCII estáveis; os rótulos em português ficam na API/front)
-- -----------------------------------------------------------------------------
CREATE TYPE perfil_usuario AS ENUM ('admin', 'gestor');

-- Estados do protótipo: Recebida → Em análise → Equipe designada → Concluída.
-- Não existe estado "Improcedente" (não confirmado no protótipo).
CREATE TYPE status_ocorrencia AS ENUM ('recebida', 'em_analise', 'equipe_designada', 'concluida');

CREATE TYPE prioridade_ocorrencia AS ENUM ('urgente', 'alta', 'media', 'baixa');

-- Como a coordenada da ocorrência foi obtida.
CREATE TYPE origem_localizacao AS ENUM ('gps', 'manual');

CREATE TYPE tipo_ponto_descarte AS ENUM ('ecoponto', 'pev', 'cooperativa');

CREATE TYPE tipo_coleta AS ENUM ('domiciliar', 'seletiva');

-- -----------------------------------------------------------------------------
-- Funções
-- -----------------------------------------------------------------------------

-- Distância em quilômetros entre duas coordenadas (fórmula de Haversine).
-- Suficiente para a escala do projeto (dezenas/centenas de pontos).
CREATE FUNCTION distancia_km(lat1 double precision, lng1 double precision,
                             lat2 double precision, lng2 double precision)
RETURNS double precision
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT 2 * 6371.0088 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- Protocolo público e não sequencial, no formato ECO-AAAA-XXXX-XXXX.
-- Os 8 caracteres vêm de bytes aleatórios de gen_random_uuid() (gerador seguro do
-- PostgreSQL), em um alfabeto de 32 símbolos sem caracteres ambíguos (0/O, 1/I).
-- 32^8 ≈ 1,1 trilhão de combinações: inviável adivinhar o protocolo de terceiros.
-- Colisões são barradas pela restrição UNIQUE; a API deve repetir a inserção.
CREATE FUNCTION gerar_protocolo()
RETURNS text
LANGUAGE plpgsql VOLATILE
AS $$
DECLARE
  alfabeto   constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  -- Bytes 6 e 8 de um UUID v4 têm bits fixos (versão/variante) e não são usados.
  posicoes   constant int[] := ARRAY[0, 1, 2, 3, 4, 5, 9, 10];
  bytes      bytea := uuid_send(gen_random_uuid());
  sufixo     text  := '';
  posicao    int;
BEGIN
  FOREACH posicao IN ARRAY posicoes LOOP
    sufixo := sufixo || substr(alfabeto, (get_byte(bytes, posicao) % 32) + 1, 1);
  END LOOP;
  RETURN 'ECO-' || to_char(now() AT TIME ZONE 'America/Recife', 'YYYY')
         || '-' || substr(sufixo, 1, 4) || '-' || substr(sufixo, 5, 4);
END;
$$;

-- Mantém a coluna atualizado_em coerente em qualquer UPDATE.
CREATE FUNCTION definir_atualizado_em()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;

INSERT INTO schema_migrations (versao) VALUES ('001_tipos_e_funcoes');

COMMIT;
