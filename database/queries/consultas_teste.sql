-- =============================================================================
-- EcoRecife · Consultas de teste (somente leitura)
-- Uso: psql -U postgres -d ecorecife -f queries/consultas_teste.sql
-- Os resultados esperados com os dados demonstrativos estão em docs/03-banco-de-dados.md.
-- Parâmetros como :'protocolo' e :lat/:lng mostram como a API passará valores
-- (consultas parametrizadas; nunca concatenar texto do usuário em SQL).
-- =============================================================================
\set ON_ERROR_STOP on
\pset null '—'

\echo '== 1. Contagem de registros por tabela'
SELECT 'bairros' AS tabela, count(*) FROM bairros
UNION ALL SELECT 'categorias_ocorrencia', count(*) FROM categorias_ocorrencia
UNION ALL SELECT 'materiais', count(*) FROM materiais
UNION ALL SELECT 'pontos_descarte', count(*) FROM pontos_descarte
UNION ALL SELECT 'ponto_materiais', count(*) FROM ponto_materiais
UNION ALL SELECT 'veiculos', count(*) FROM veiculos
UNION ALL SELECT 'ocorrencias', count(*) FROM ocorrencias
UNION ALL SELECT 'ocorrencia_historico', count(*) FROM ocorrencia_historico
UNION ALL SELECT 'usuarios', count(*) FROM usuarios;

\echo '== 2. Três pontos de descarte mais próximos (usuário na Praça do Derby, aprox.)'
\set lat -8.0570
\set lng -34.8990
SELECT p.nome, p.tipo, b.nome AS bairro,
       round(distancia_km(:lat, :lng, p.latitude, p.longitude)::numeric, 2) AS distancia_km,
       p.demonstrativo
FROM pontos_descarte p
JOIN bairros b ON b.id = p.bairro_id
WHERE p.ativo
ORDER BY distancia_km(:lat, :lng, p.latitude, p.longitude)
LIMIT 3;

\echo '== 3. Três mais próximos que aceitam eletroeletrônicos'
SELECT p.nome, round(distancia_km(:lat, :lng, p.latitude, p.longitude)::numeric, 2) AS distancia_km
FROM pontos_descarte p
JOIN ponto_materiais pm ON pm.ponto_id = p.id
JOIN materiais m ON m.id = pm.material_id
WHERE p.ativo AND m.slug = 'eletronicos'
ORDER BY distancia_km(:lat, :lng, p.latitude, p.longitude)
LIMIT 3;

\echo '== 4. Guia de reciclagem: pontos com materiais aceitos'
SELECT p.tipo, p.nome, b.nome AS bairro, p.horario_funcionamento,
       string_agg(m.nome, ', ' ORDER BY m.nome) AS materiais
FROM pontos_descarte p
JOIN bairros b ON b.id = p.bairro_id
LEFT JOIN ponto_materiais pm ON pm.ponto_id = p.id
LEFT JOIN materiais m ON m.id = pm.material_id
WHERE p.ativo
GROUP BY p.id, b.nome
ORDER BY p.tipo, p.nome;

\echo '== 5. Consulta pública por protocolo (somente campos não sensíveis)'
\set protocolo 'ECO-2026-DEMA-9JTU'
SELECT o.protocolo, c.nome AS categoria, b.nome AS bairro, o.status,
       o.criado_em, o.concluido_em
FROM ocorrencias o
JOIN categorias_ocorrencia c ON c.id = o.categoria_id
JOIN bairros b ON b.id = o.bairro_id
WHERE o.protocolo = :'protocolo';

\echo '== 6. Linha do tempo pública do protocolo'
SELECT h.status_anterior, h.status_novo, h.criado_em
FROM ocorrencia_historico h
JOIN ocorrencias o ON o.id = h.ocorrencia_id
WHERE o.protocolo = :'protocolo'
ORDER BY h.criado_em;

\echo '== 7. Protocolo inexistente retorna zero linhas'
SELECT count(*) AS encontrados FROM ocorrencias WHERE protocolo = 'ECO-2026-XXXX-XXXX';

\echo '== 8. Fila ativa da gestão (paginada: 5 por página, página 1)'
SELECT o.protocolo, c.nome AS categoria, b.nome AS bairro, o.status, o.prioridade, o.criado_em
FROM ocorrencias o
JOIN categorias_ocorrencia c ON c.id = o.categoria_id
JOIN bairros b ON b.id = o.bairro_id
WHERE o.status <> 'concluida'
ORDER BY o.criado_em DESC
LIMIT 5 OFFSET 0;

\echo '== 9. Visão geral por bairro (total e pendentes)'
SELECT b.nome AS bairro,
       count(*) AS total,
       count(*) FILTER (WHERE o.status <> 'concluida') AS pendentes
FROM ocorrencias o
JOIN bairros b ON b.id = o.bairro_id
GROUP BY b.nome
ORDER BY pendentes DESC, total DESC, b.nome;

\echo '== 10. Ocorrências por status'
SELECT status, count(*) FROM ocorrencias GROUP BY status ORDER BY status;

\echo '== 11. Busca de bairro sem diferenciar maiúsculas (acentos: normalizados no front/API)'
SELECT nome, latitude, longitude FROM bairros WHERE nome ILIKE '%' || 'VÁRZEA' || '%';

\echo '== 12. Formato do protocolo gerado pelo banco (não grava nada)'
SELECT gerar_protocolo() AS exemplo_1, gerar_protocolo() AS exemplo_2;
