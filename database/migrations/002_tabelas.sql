-- =============================================================================
-- EcoRecife · Migração 002 · Tabelas, chaves e restrições
-- Coordenadas em graus decimais (WGS 84 / EPSG:4326), numeric(9,6) ≈ 0,1 m.
-- A coluna "demonstrativo" separa dados simulados de dados com fonte verificável:
-- registros não demonstrativos de bairros e pontos de descarte exigem "fonte".
-- =============================================================================
BEGIN;

-- -----------------------------------------------------------------------------
-- Usuários da gestão (servidores). Cidadãos não têm conta: registram ocorrências
-- de forma anônima e acompanham pelo protocolo.
-- Nenhum usuário é criado pelos scripts: o primeiro administrador será criado por
-- um comando da API (CP2) com senha informada no momento, nunca versionada.
-- -----------------------------------------------------------------------------
CREATE TABLE usuarios (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome            varchar(120)   NOT NULL CHECK (btrim(nome) <> ''),
  email           varchar(254)   NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  senha_hash      text           NOT NULL CHECK (length(senha_hash) >= 50),
  perfil          perfil_usuario NOT NULL DEFAULT 'gestor',
  ativo           boolean        NOT NULL DEFAULT true,
  ultimo_login_em timestamptz,
  criado_em       timestamptz    NOT NULL DEFAULT now(),
  atualizado_em   timestamptz    NOT NULL DEFAULT now()
);
-- E-mail único sem diferenciar maiúsculas/minúsculas.
CREATE UNIQUE INDEX usuarios_email_unico ON usuarios (lower(email));

-- -----------------------------------------------------------------------------
-- Bairros (usados no formulário, nos filtros e na busca do mapa)
-- -----------------------------------------------------------------------------
CREATE TABLE bairros (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome          varchar(80)  NOT NULL UNIQUE CHECK (btrim(nome) <> ''),
  latitude      numeric(9,6) NOT NULL CHECK (latitude  BETWEEN -90  AND 90),
  longitude     numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  demonstrativo boolean      NOT NULL DEFAULT true,
  fonte         text,
  CONSTRAINT bairros_fonte_obrigatoria CHECK (demonstrativo OR fonte IS NOT NULL)
);

-- -----------------------------------------------------------------------------
-- Categorias de ocorrência (descarte irregular, lixeira danificada, entulho)
-- -----------------------------------------------------------------------------
CREATE TABLE categorias_ocorrencia (
  id    smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug  varchar(40) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9_]+$'),
  nome  varchar(80) NOT NULL UNIQUE,
  ativo boolean     NOT NULL DEFAULT true
);

-- -----------------------------------------------------------------------------
-- Ocorrências da Zeladoria Cidadã (anônimas; nenhuma coluna de dado pessoal)
-- -----------------------------------------------------------------------------
CREATE TABLE ocorrencias (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  protocolo          varchar(20)  NOT NULL UNIQUE DEFAULT gerar_protocolo()
                       CHECK (protocolo ~ '^ECO-[0-9]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$'),
  categoria_id       smallint     NOT NULL REFERENCES categorias_ocorrencia (id),
  bairro_id          integer      NOT NULL REFERENCES bairros (id),
  endereco           varchar(200) NOT NULL CHECK (btrim(endereco) <> ''),
  descricao          varchar(1000) NOT NULL CHECK (btrim(descricao) <> ''),
  latitude           numeric(9,6) CHECK (latitude  BETWEEN -90  AND 90),
  longitude          numeric(9,6) CHECK (longitude BETWEEN -180 AND 180),
  origem_localizacao origem_localizacao,
  precisao_m         numeric(8,1) CHECK (precisao_m >= 0),
  status             status_ocorrencia     NOT NULL DEFAULT 'recebida',
  prioridade         prioridade_ocorrencia NOT NULL DEFAULT 'media',
  concluido_em       timestamptz,
  nota_conclusao     varchar(500),
  demonstrativo      boolean      NOT NULL DEFAULT false,
  criado_em          timestamptz  NOT NULL DEFAULT now(),
  atualizado_em      timestamptz  NOT NULL DEFAULT now(),
  -- Latitude e longitude andam juntas, e a origem só existe se houver coordenada.
  CONSTRAINT ocorrencias_coordenada_completa
    CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CONSTRAINT ocorrencias_origem_coerente
    CHECK ((latitude IS NULL) = (origem_localizacao IS NULL)),
  CONSTRAINT ocorrencias_precisao_requer_coordenada
    CHECK (precisao_m IS NULL OR latitude IS NOT NULL),
  -- Data de conclusão existe se, e somente se, o status for "concluida".
  CONSTRAINT ocorrencias_conclusao_coerente
    CHECK ((status = 'concluida') = (concluido_em IS NOT NULL)),
  CONSTRAINT ocorrencias_nota_somente_concluida
    CHECK (nota_conclusao IS NULL OR status = 'concluida')
);

-- -----------------------------------------------------------------------------
-- Fotografias: os arquivos ficam no armazenamento de arquivos/objetos;
-- o banco guarda apenas a referência e os metadados validados.
-- No máximo 3 fotos por ocorrência (ordem 1..3 + UNIQUE), até 5 MB cada.
-- -----------------------------------------------------------------------------
CREATE TABLE ocorrencia_fotos (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ocorrencia_id       bigint      NOT NULL REFERENCES ocorrencias (id) ON DELETE CASCADE,
  ordem               smallint    NOT NULL CHECK (ordem BETWEEN 1 AND 3),
  chave_armazenamento text        NOT NULL UNIQUE,
  tipo_mime           varchar(20) NOT NULL CHECK (tipo_mime IN ('image/jpeg', 'image/png', 'image/webp')),
  tamanho_bytes       integer     NOT NULL CHECK (tamanho_bytes BETWEEN 1 AND 5242880),
  criado_em           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ocorrencia_fotos_ordem_unica UNIQUE (ocorrencia_id, ordem)
);

-- -----------------------------------------------------------------------------
-- Histórico de status (somente inserção). usuario_id nulo = registro do cidadão.
-- -----------------------------------------------------------------------------
CREATE TABLE ocorrencia_historico (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ocorrencia_id   bigint            NOT NULL REFERENCES ocorrencias (id) ON DELETE CASCADE,
  status_anterior status_ocorrencia,
  status_novo     status_ocorrencia NOT NULL,
  usuario_id      bigint            REFERENCES usuarios (id) ON DELETE SET NULL,
  observacao      varchar(500),
  criado_em       timestamptz       NOT NULL DEFAULT now(),
  CONSTRAINT historico_muda_status CHECK (status_anterior IS DISTINCT FROM status_novo)
);

-- -----------------------------------------------------------------------------
-- Guia de reciclagem: EcoPontos, PEVs e cooperativas
-- -----------------------------------------------------------------------------
CREATE TABLE pontos_descarte (
  id                     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo                   tipo_ponto_descarte NOT NULL,
  nome                   varchar(120) NOT NULL CHECK (btrim(nome) <> ''),
  bairro_id              integer      NOT NULL REFERENCES bairros (id),
  endereco               varchar(200),
  latitude               numeric(9,6) NOT NULL CHECK (latitude  BETWEEN -90  AND 90),
  longitude              numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  horario_funcionamento  varchar(120),
  situacao               varchar(80),
  telefone               varchar(20),
  email                  varchar(254),
  site                   varchar(300),
  demonstrativo          boolean      NOT NULL DEFAULT true,
  fonte                  text,
  verificado_em          date,
  ativo                  boolean      NOT NULL DEFAULT true,
  criado_em              timestamptz  NOT NULL DEFAULT now(),
  atualizado_em          timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT pontos_fonte_obrigatoria CHECK (demonstrativo OR fonte IS NOT NULL),
  CONSTRAINT pontos_nome_unico UNIQUE (tipo, nome)
);

CREATE TABLE materiais (
  id   smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug varchar(40) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9_]+$'),
  nome varchar(80) NOT NULL UNIQUE
);

CREATE TABLE ponto_materiais (
  ponto_id    integer  NOT NULL REFERENCES pontos_descarte (id) ON DELETE CASCADE,
  material_id smallint NOT NULL REFERENCES materiais (id) ON DELETE RESTRICT,
  PRIMARY KEY (ponto_id, material_id)
);

-- -----------------------------------------------------------------------------
-- Coleta: veículos e rotas. A posição em tempo real será simulada pela API
-- (Socket.IO) percorrendo os pontos da rota; não há integração com a frota real.
-- -----------------------------------------------------------------------------
CREATE TABLE veiculos (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo        varchar(10)  NOT NULL UNIQUE,
  descricao     varchar(120),
  tipo_coleta   tipo_coleta  NOT NULL DEFAULT 'domiciliar',
  bairro_id     integer      REFERENCES bairros (id),
  ativo         boolean      NOT NULL DEFAULT true,
  demonstrativo boolean      NOT NULL DEFAULT true
);

CREATE TABLE rotas (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome          varchar(120) NOT NULL UNIQUE,
  veiculo_id    integer      REFERENCES veiculos (id) ON DELETE SET NULL,
  ativa         boolean      NOT NULL DEFAULT true,
  demonstrativo boolean      NOT NULL DEFAULT true
);

-- Trajeto da rota como sequência ordenada de coordenadas.
CREATE TABLE rota_pontos (
  rota_id   integer      NOT NULL REFERENCES rotas (id) ON DELETE CASCADE,
  ordem     integer      NOT NULL CHECK (ordem >= 1),
  latitude  numeric(9,6) NOT NULL CHECK (latitude  BETWEEN -90  AND 90),
  longitude numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  PRIMARY KEY (rota_id, ordem)
);

INSERT INTO schema_migrations (versao) VALUES ('002_tabelas');

COMMIT;
