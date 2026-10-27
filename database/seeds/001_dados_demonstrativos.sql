-- =============================================================================
-- EcoRecife · Seed 001 · Dados iniciais de DEMONSTRAÇÃO
--
-- Origem: arrays fixos do protótipo exportado do Figma (web/src/App.tsx:
-- mapLocations, neighborhoodCoords, ecoPointsList, initialOccurrences).
-- NENHUM registro abaixo é oficial: nomes, coordenadas, horários e materiais de
-- ecopontos/cooperativas não foram verificados junto à Prefeitura ou à Emlurb.
-- Todos são gravados com demonstrativo = true e fonte = NULL.
-- Telefones, e-mails e endereços dos pontos ficam NULL porque o protótipo não os
-- tinha e não serão inventados.
-- Não cria usuários nem senhas (ver docs/03-banco-de-dados.md).
-- =============================================================================
BEGIN;

-- Bairros: coordenadas aproximadas usadas pelo protótipo na busca do mapa.
-- "Centro" do protótipo foi unificado em "Santo Antônio" (mesma coordenada).
INSERT INTO bairros (nome, latitude, longitude) VALUES
  ('Afogados',      -8.0710, -34.9080),
  ('Arruda',        -8.0268, -34.8882),
  ('Boa Viagem',    -8.1250, -34.9010),
  ('Casa Amarela',  -8.0260, -34.9180),
  ('Cohab',         -8.1279, -34.9491),
  ('Cordeiro',      -8.0474, -34.9287),
  ('Dois Unidos',   -8.0018, -34.9108),
  ('Encruzilhada',  -8.0368, -34.8918),
  ('Ibura',         -8.1188, -34.9425),
  ('Imbiribeira',   -8.1111, -34.9103),
  ('Pina',          -8.0880, -34.8850),
  ('Santo Amaro',   -8.0380, -34.8720),
  ('Santo Antônio', -8.0520, -34.8820),
  ('Torre',         -8.0479, -34.9104),
  ('Várzea',        -8.0506, -34.9588),
  ('Vasco da Gama', -8.0118, -34.9174);

-- Categorias do formulário de Zeladoria (valores do <select> do protótipo).
INSERT INTO categorias_ocorrencia (slug, nome) VALUES
  ('descarte', 'Descarte irregular'),
  ('lixeira',  'Lixeira danificada'),
  ('entulho',  'Acúmulo de entulho');

-- Materiais: filtros do protótipo + categorias citadas na AV1.
INSERT INTO materiais (slug, nome) VALUES
  ('reciclaveis',     'Recicláveis secos'),
  ('eletronicos',     'Eletroeletrônicos'),
  ('oleo_vegetal',    'Óleo vegetal'),
  ('entulho',         'Entulho de pequenas obras'),
  ('volumosos',       'Volumosos e móveis'),
  ('pilhas_baterias', 'Pilhas e baterias');

-- Pontos de descarte (demonstrativos).
INSERT INTO pontos_descarte (tipo, nome, bairro_id, latitude, longitude, horario_funcionamento, situacao)
SELECT p.tipo::tipo_ponto_descarte, p.nome, b.id, p.lat, p.lng, p.horario, p.situacao
FROM (VALUES
  ('ecoponto',    'EcoPonto Pina',                     'Pina',          -8.0880, -34.8850, 'Seg–Sáb · 8h às 17h', 'Aberto para descarte'),
  ('ecoponto',    'EcoPonto Centro / Santo Antônio',   'Santo Antônio', -8.0520, -34.8820, 'Seg–Sáb · 8h às 18h', 'Aberto para descarte'),
  ('ecoponto',    'EcoPonto Arruda',                   'Arruda',        -8.0268, -34.8882, '8h às 17h',           'Aberto para descarte'),
  ('ecoponto',    'EcoPonto Cohab',                    'Cohab',         -8.1279, -34.9491, '8h às 16h',           'Capacidade moderada'),
  ('ecoponto',    'EcoPonto Torre',                    'Torre',         -8.0479, -34.9104, '7h às 17h',           'Aberto para descarte'),
  ('ecoponto',    'EcoPonto Casa Amarela',             'Casa Amarela',  -8.0208, -34.9251, 'Seg–Sáb · 8h às 17h', 'Aberto para descarte'),
  ('cooperativa', 'Cooperativa Novo Ciclo',            'Afogados',      -8.0710, -34.9080, 'Seg–Sex · 8h às 16h', 'Recebendo doações'),
  ('cooperativa', 'Cooperativa Recicla Recife',        'Santo Amaro',   -8.0380, -34.8720, 'Seg–Sáb · 7h às 17h', 'Triagem em andamento'),
  ('cooperativa', 'Cooperativa Esperança Verde',       'Dois Unidos',   -8.0018, -34.9108, '8h às 17h',           'Recebendo recicláveis'),
  ('cooperativa', 'Cooperativa Renascer',              'Imbiribeira',   -8.1111, -34.9103, '7h às 16h',           'Triagem em andamento')
) AS p (tipo, nome, bairro, lat, lng, horario, situacao)
JOIN bairros b ON b.nome = p.bairro;

-- Materiais aceitos: conforme a descrição do protótipo (ecoPointsList). Os pontos
-- que não tinham descrição recebem "recicláveis secos" (suposição demonstrativa).
INSERT INTO ponto_materiais (ponto_id, material_id)
SELECT pd.id, m.id
FROM (VALUES
  ('EcoPonto Pina',                   'reciclaveis'),
  ('EcoPonto Pina',                   'eletronicos'),
  ('EcoPonto Pina',                   'oleo_vegetal'),
  ('EcoPonto Centro / Santo Antônio', 'entulho'),
  ('EcoPonto Centro / Santo Antônio', 'volumosos'),
  ('EcoPonto Centro / Santo Antônio', 'reciclaveis'),
  ('EcoPonto Arruda',                 'reciclaveis'),
  ('EcoPonto Cohab',                  'reciclaveis'),
  ('EcoPonto Torre',                  'reciclaveis'),
  ('EcoPonto Casa Amarela',           'eletronicos'),
  ('EcoPonto Casa Amarela',           'pilhas_baterias'),
  ('EcoPonto Casa Amarela',           'volumosos'),
  ('Cooperativa Novo Ciclo',          'reciclaveis'),
  ('Cooperativa Recicla Recife',      'reciclaveis'),
  ('Cooperativa Esperança Verde',     'reciclaveis'),
  ('Cooperativa Renascer',            'reciclaveis')
) AS pm (ponto, material)
JOIN pontos_descarte pd ON pd.nome = pm.ponto
JOIN materiais m ON m.slug = pm.material;

-- Veículos simulados (códigos do protótipo). Rotas: ver pendência em docs/04-plano-execucao.md.
INSERT INTO veiculos (codigo, descricao, tipo_coleta, bairro_id)
SELECT v.codigo, v.descricao, v.tipo::tipo_coleta, b.id
FROM (VALUES
  ('#04', 'Caminhão #04 - Boa Viagem',    'domiciliar', 'Boa Viagem'),
  ('#06', 'Caminhão #06 - Encruzilhada',  'domiciliar', 'Encruzilhada'),
  ('#08', 'Caminhão #08 - Casa Amarela',  'domiciliar', 'Casa Amarela'),
  ('#11', 'Caminhão #11 - Várzea',        'seletiva',   'Várzea'),
  ('#13', 'Caminhão #13 - Cordeiro',      'domiciliar', 'Cordeiro'),
  ('#15', 'Caminhão #15 - Ibura',         'domiciliar', 'Ibura'),
  ('#17', 'Caminhão #17 - Vasco da Gama', 'domiciliar', 'Vasco da Gama')
) AS v (codigo, descricao, tipo, bairro)
JOIN bairros b ON b.nome = v.bairro;

-- Ocorrências de exemplo (as 8 do protótipo). Protocolos fixos com "DEMA" para
-- facilitar testes de consulta; as datas são relativas ao momento da carga.
INSERT INTO ocorrencias (protocolo, categoria_id, bairro_id, endereco, descricao,
                         status, prioridade, criado_em, concluido_em, nota_conclusao, demonstrativo)
SELECT o.protocolo, c.id, b.id, o.endereco, o.descricao,
       o.status::status_ocorrencia, o.prioridade::prioridade_ocorrencia,
       now() - o.idade,
       CASE WHEN o.status = 'concluida' THEN now() - o.idade + o.duracao END,
       o.nota, true
FROM (VALUES
  ('ECO-2026-DEMA-2BVW', 'descarte', 'Boa Viagem',    'Rua dos Navegantes, 840',        'Sacos de resíduos e móveis ocupando parte da calçada.',     'recebida',         'urgente', interval '2 hours',            NULL::interval,          NULL),
  ('ECO-2026-DEMA-3CXY', 'entulho',  'Casa Amarela',  'Estrada do Arraial, 2180',       'Entulho de obra acumulado próximo ao ponto de ônibus.',     'em_analise',       'alta',    interval '3 hours 30 minutes', NULL,                    NULL),
  ('ECO-2026-DEMA-4DKZ', 'lixeira',  'Pina',          'Rua Capitão Rebelinho, 455',     'Contentor sem tampa e com resíduos espalhados na via.',     'equipe_designada', 'alta',    interval '1 day 2 hours',      NULL,                    NULL),
  ('ECO-2026-DEMA-5EHM', 'descarte', 'Santo Amaro',   'Av. Norte Miguel Arraes, 1040',  'Ponto recorrente de descarte ao lado do canal.',            'recebida',         'media',   interval '1 day 5 hours',      NULL,                    NULL),
  ('ECO-2026-DEMA-6FJN', 'entulho',  'Afogados',      'Rua Imperial, 1875',             'Restos de construção bloqueando a passagem de pedestres.', 'em_analise',       'media',   interval '1 day 9 hours',      NULL,                    NULL),
  ('ECO-2026-DEMA-7GPQ', 'lixeira',  'Santo Antônio', 'Rua do Imperador Pedro II, 290', 'Lixeira pública danificada em área de grande circulação.', 'concluida',        'baixa',   interval '3 days 4 hours',     interval '1 hour 45 minutes', NULL),
  ('ECO-2026-DEMA-8HRS', 'descarte', 'Boa Viagem',    'Av. Conselheiro Aguiar, 3120',   'Resíduos volumosos deixados no canteiro central.',          'equipe_designada', 'alta',    interval '3 days 11 hours',    NULL,                    NULL),
  ('ECO-2026-DEMA-9JTU', 'entulho',  'Casa Amarela',  'Rua Padre Lemos, 610',           'Materiais de obra descartados junto à drenagem.',           'concluida',        'media',   interval '4 days 6 hours',     interval '2 hours 34 minutes', 'Entulho recolhido e drenagem desobstruída.')
) AS o (protocolo, categoria, bairro, endereco, descricao, status, prioridade, idade, duracao, nota)
JOIN categorias_ocorrencia c ON c.slug = o.categoria
JOIN bairros b ON b.nome = o.bairro;

-- Histórico coerente: uma linha por etapa percorrida até o status atual.
-- Etapas intermediárias ficam a cada 30 minutos; a conclusão usa concluido_em.
INSERT INTO ocorrencia_historico (ocorrencia_id, status_anterior, status_novo, observacao, criado_em)
SELECT oc.id,
       etapas.anterior,
       etapas.status,
       CASE WHEN etapas.status = 'concluida' THEN oc.nota_conclusao END,
       CASE WHEN etapas.status = 'concluida' THEN oc.concluido_em
            ELSE oc.criado_em + (etapas.posicao - 1) * interval '30 minutes' END
FROM ocorrencias oc
CROSS JOIN LATERAL (
  SELECT s.status, s.posicao, lag(s.status) OVER (ORDER BY s.posicao) AS anterior
  FROM unnest(enum_range(NULL::status_ocorrencia)) WITH ORDINALITY AS s (status, posicao)
) AS etapas
WHERE oc.demonstrativo
  AND etapas.status <= oc.status;

COMMIT;
