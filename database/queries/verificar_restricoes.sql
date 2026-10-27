-- =============================================================================
-- EcoRecife · Verificação automática das restrições do banco
-- Cada caso tenta gravar um dado inválido e falha o script se o banco aceitar.
-- Tudo roda em uma transação desfeita no final (ROLLBACK): nada é gravado.
-- Uso: psql -U postgres -d ecorecife -f queries/verificar_restricoes.sql
-- Resultado esperado: "OK" para cada caso e a mensagem final de sucesso.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE resultado_testes (caso text, resultado text) ON COMMIT DROP;

-- Executa um comando que DEVE falhar com o código SQLSTATE informado.
CREATE PROCEDURE pg_temp.deve_falhar(caso text, comando text, codigo_esperado text)
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE comando;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = codigo_esperado THEN
      INSERT INTO resultado_testes VALUES (caso, 'OK');
      RETURN;
    END IF;
    RAISE EXCEPTION 'FALHOU: % (erro inesperado % - %)', caso, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'FALHOU: % (o banco aceitou um dado inválido)', caso;
END;
$$;

-- Ocorrência válida usada como base para os casos de fotos.
INSERT INTO ocorrencias (categoria_id, bairro_id, endereco, descricao)
SELECT c.id, b.id, 'Rua de Teste, 1', 'Ocorrência criada pelo teste de restrições'
FROM categorias_ocorrencia c, bairros b
WHERE c.slug = 'descarte' AND b.nome = 'Pina';

-- 23514 = check_violation · 23505 = unique_violation · 23503 = foreign_key_violation
-- 22P02 = invalid_text_representation (valor fora do enum)
CALL pg_temp.deve_falhar('protocolo fora do formato',
  $q$UPDATE ocorrencias SET protocolo = 'ECO-2026-1234' WHERE endereco = 'Rua de Teste, 1'$q$, '23514');
CALL pg_temp.deve_falhar('protocolo duplicado',
  $q$UPDATE ocorrencias SET protocolo = 'ECO-2026-DEMA-2BVW' WHERE endereco = 'Rua de Teste, 1'$q$, '23505');
CALL pg_temp.deve_falhar('status inexistente (ex.: improcedente)',
  $q$UPDATE ocorrencias SET status = 'improcedente' WHERE endereco = 'Rua de Teste, 1'$q$, '22P02');
CALL pg_temp.deve_falhar('concluída sem data de conclusão',
  $q$UPDATE ocorrencias SET status = 'concluida' WHERE endereco = 'Rua de Teste, 1'$q$, '23514');
CALL pg_temp.deve_falhar('data de conclusão em ocorrência ativa',
  $q$UPDATE ocorrencias SET concluido_em = now() WHERE endereco = 'Rua de Teste, 1'$q$, '23514');
CALL pg_temp.deve_falhar('latitude sem longitude',
  $q$UPDATE ocorrencias SET latitude = -8.05, origem_localizacao = 'gps' WHERE endereco = 'Rua de Teste, 1'$q$, '23514');
CALL pg_temp.deve_falhar('coordenada sem origem',
  $q$UPDATE ocorrencias SET latitude = -8.05, longitude = -34.9 WHERE endereco = 'Rua de Teste, 1'$q$, '23514');
CALL pg_temp.deve_falhar('latitude fora do intervalo',
  $q$UPDATE ocorrencias SET latitude = -91, longitude = -34.9, origem_localizacao = 'manual' WHERE endereco = 'Rua de Teste, 1'$q$, '23514');
CALL pg_temp.deve_falhar('descrição vazia',
  $q$UPDATE ocorrencias SET descricao = '   ' WHERE endereco = 'Rua de Teste, 1'$q$, '23514');
CALL pg_temp.deve_falhar('bairro inexistente',
  $q$UPDATE ocorrencias SET bairro_id = 999999 WHERE endereco = 'Rua de Teste, 1'$q$, '23503');

-- Fotos: três são aceitas; a quarta e os arquivos inválidos são recusados.
INSERT INTO ocorrencia_fotos (ocorrencia_id, ordem, chave_armazenamento, tipo_mime, tamanho_bytes)
SELECT o.id, n, 'teste/foto-' || n || '.jpg', 'image/jpeg', 1000
FROM ocorrencias o, generate_series(1, 3) AS n
WHERE o.endereco = 'Rua de Teste, 1';
INSERT INTO resultado_testes VALUES ('três fotos aceitas', 'OK');

CALL pg_temp.deve_falhar('quarta foto na mesma ocorrência',
  $q$INSERT INTO ocorrencia_fotos (ocorrencia_id, ordem, chave_armazenamento, tipo_mime, tamanho_bytes)
     SELECT id, 4, 'teste/foto-4.jpg', 'image/jpeg', 1000 FROM ocorrencias WHERE endereco = 'Rua de Teste, 1'$q$, '23514');
CALL pg_temp.deve_falhar('foto com ordem repetida',
  $q$INSERT INTO ocorrencia_fotos (ocorrencia_id, ordem, chave_armazenamento, tipo_mime, tamanho_bytes)
     SELECT id, 1, 'teste/foto-x.jpg', 'image/jpeg', 1000 FROM ocorrencias WHERE endereco = 'Rua de Teste, 1'$q$, '23505');
CALL pg_temp.deve_falhar('foto acima de 5 MB',
  $q$UPDATE ocorrencia_fotos SET tamanho_bytes = 5242881 WHERE chave_armazenamento = 'teste/foto-1.jpg'$q$, '23514');
CALL pg_temp.deve_falhar('arquivo que não é imagem permitida',
  $q$UPDATE ocorrencia_fotos SET tipo_mime = 'application/pdf' WHERE chave_armazenamento = 'teste/foto-1.jpg'$q$, '23514');

-- Histórico e dados de referência.
CALL pg_temp.deve_falhar('histórico sem mudança de status',
  $q$INSERT INTO ocorrencia_historico (ocorrencia_id, status_anterior, status_novo)
     SELECT id, 'recebida', 'recebida' FROM ocorrencias WHERE endereco = 'Rua de Teste, 1'$q$, '23514');
CALL pg_temp.deve_falhar('ponto "oficial" sem fonte',
  $q$UPDATE pontos_descarte SET demonstrativo = false WHERE nome = 'EcoPonto Pina'$q$, '23514');
CALL pg_temp.deve_falhar('bairro "oficial" sem fonte',
  $q$UPDATE bairros SET demonstrativo = false WHERE nome = 'Pina'$q$, '23514');

-- Usuários: e-mail único sem diferenciar maiúsculas e perfil restrito.
INSERT INTO usuarios (nome, email, senha_hash)
VALUES ('Teste', 'teste@ecorecife.local', repeat('x', 60));
CALL pg_temp.deve_falhar('e-mail repetido com outra caixa',
  $q$INSERT INTO usuarios (nome, email, senha_hash) VALUES ('Outro', 'TESTE@ecorecife.local', repeat('x', 60))$q$, '23505');
CALL pg_temp.deve_falhar('perfil inexistente',
  $q$INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES ('Outro', 'o@ecorecife.local', repeat('x', 60), 'cidadao')$q$, '22P02');
CALL pg_temp.deve_falhar('senha em texto puro (curta demais para um hash)',
  $q$INSERT INTO usuarios (nome, email, senha_hash) VALUES ('Outro', 'o@ecorecife.local', '123456')$q$, '23514');

-- Gatilho de atualizado_em e geração de protocolo.
DO $$
DECLARE depois timestamptz; p text;
BEGIN
  -- Mesmo pedindo uma data no passado, o gatilho deve gravar now().
  UPDATE ocorrencias SET atualizado_em = now() - interval '1 day' WHERE endereco = 'Rua de Teste, 1';
  SELECT atualizado_em INTO depois FROM ocorrencias WHERE endereco = 'Rua de Teste, 1';
  IF depois <> now() THEN RAISE EXCEPTION 'FALHOU: gatilho atualizado_em'; END IF;
  INSERT INTO resultado_testes VALUES ('gatilho atualizado_em', 'OK');

  SELECT protocolo INTO p FROM ocorrencias WHERE endereco = 'Rua de Teste, 1';
  IF p !~ '^ECO-[0-9]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$' THEN
    RAISE EXCEPTION 'FALHOU: protocolo gerado fora do formato: %', p;
  END IF;
  INSERT INTO resultado_testes VALUES ('protocolo gerado automaticamente (' || p || ')', 'OK');

  -- 10 mil protocolos gerados sem repetição.
  IF (SELECT count(DISTINCT gerar_protocolo()) FROM generate_series(1, 10000)) <> 10000 THEN
    RAISE EXCEPTION 'FALHOU: protocolos repetidos em 10 mil gerações';
  END IF;
  INSERT INTO resultado_testes VALUES ('10 mil protocolos distintos', 'OK');
END $$;

SELECT caso, resultado FROM resultado_testes;
\echo '>> Todas as restrições verificadas com sucesso. Desfazendo alterações (ROLLBACK).'
ROLLBACK;
