-- =============================================================================
-- EcoRecife · Migração 003 · Índices e gatilhos
-- Chaves primárias e UNIQUE já criam índices; aqui ficam os índices das consultas
-- previstas (fila da gestão, filtros, histórico, guia de reciclagem).
-- =============================================================================
BEGIN;

-- Fila da gestão: filtro por status, ordenada da mais recente para a mais antiga.
CREATE INDEX ocorrencias_status_criado_em ON ocorrencias (status, criado_em DESC);
-- Filtros por bairro e categoria (também atendem às chaves estrangeiras).
CREATE INDEX ocorrencias_bairro ON ocorrencias (bairro_id);
CREATE INDEX ocorrencias_categoria ON ocorrencias (categoria_id);

-- Linha do tempo de uma ocorrência.
CREATE INDEX historico_ocorrencia_criado_em ON ocorrencia_historico (ocorrencia_id, criado_em);
CREATE INDEX historico_usuario ON ocorrencia_historico (usuario_id) WHERE usuario_id IS NOT NULL;

-- Guia de reciclagem: pontos ativos por tipo e filtro por material.
CREATE INDEX pontos_tipo_ativos ON pontos_descarte (tipo) WHERE ativo;
CREATE INDEX pontos_bairro ON pontos_descarte (bairro_id);
CREATE INDEX ponto_materiais_material ON ponto_materiais (material_id);

CREATE INDEX veiculos_bairro ON veiculos (bairro_id);
CREATE INDEX rotas_veiculo ON rotas (veiculo_id);

-- atualizado_em automático
CREATE TRIGGER usuarios_atualizado_em BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION definir_atualizado_em();
CREATE TRIGGER ocorrencias_atualizado_em BEFORE UPDATE ON ocorrencias
  FOR EACH ROW EXECUTE FUNCTION definir_atualizado_em();
CREATE TRIGGER pontos_descarte_atualizado_em BEFORE UPDATE ON pontos_descarte
  FOR EACH ROW EXECUTE FUNCTION definir_atualizado_em();

INSERT INTO schema_migrations (versao) VALUES ('003_indices_e_gatilhos');

COMMIT;
