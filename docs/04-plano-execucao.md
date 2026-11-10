# 04 · Plano de execução da AV2

Cronograma oficial do edital nº 02/2026.2. Legenda: ✅ feito · ⏳ pendente · 👤 depende da equipe.

## Checkpoint 1: 30/10/2026 (repositório, modelagem lógica, DDL inicial)

| Entregável | Situação |
|---|---|
| Front exportado do Figma funcionando fora dele (`web/`) | ✅ build, typecheck e teste no navegador (desktop e celular) |
| Diagnóstico técnico (`docs/01`) | ✅ |
| Modelagem lógica + diagrama ER + regras (`docs/02`) | ✅ |
| DDL em migrações versionadas (`database/migrations/001–003`) | ✅ testado em PostgreSQL 16.15 |
| Seeds demonstrativos (`database/seeds/001`) | ✅ |
| Consultas de teste + verificação de restrições (`database/queries/`) | ✅ 24/24 casos OK |
| Guia de instalação do banco (Windows nativo) e do front (`docs/03`, `docs/05`) | ✅ (o passo a passo para Windows ainda não foi executado numa máquina Windows: 👤 a equipe deve validar) |
| Todos os 5 integrantes adicionados ao repositório GitHub | 👤 Settings → Collaborators (só o dono do repositório pode fazer) |
| Branch revisado e integrado à `main` | 👤 após a revisão da equipe |

## Checkpoint 2: 13/11/2026 (endpoints principais + conexão com o banco)

Estrutura: `server/` (Node 22 + TypeScript + Express). Guia: [06-api.md](06-api.md). ✅ = concluído.

| Tarefa | Detalhe | Pronto quando |
|---|---|---|
| ✅ Base da API (parte 1) | `config` (variáveis de ambiente validadas), `db` (pool `pg`), tratamento de erros, `helmet`, CORS restrito | `GET /api/saude` responde e consulta o banco |
| ✅ Executor de migrações (parte 1) | Script Node que aplica `database/migrations` ainda não registradas em `schema_migrations` | Banco novo criado só pelo script |
| ✅ Autenticação (parte 2) | `POST /api/auth/login` (bcrypt), sessão em cookie `httpOnly` (tabela `sessoes`, migração 004), limite de tentativas, `GET /api/auth/eu`, logout, `exigirSessao`/`exigirPerfil`, verificação de `Origin` contra CSRF | Rotas protegidas retornam 401/403 corretamente (testado com banco falso e com PostgreSQL 16.15) |
| ✅ Primeiro administrador | Comando `pnpm criar-admin` que pede e-mail e senha no terminal (nada fica no código) | Login funciona com o usuário criado (testado com a mesma função de gravação do comando; a digitação interativa ainda depende da equipe 👤) |
| ✅ Ocorrências (público, parte 3) | `POST /api/ocorrencias` (multipart, até 3 fotos validadas pelo conteúdo, gravadas fora do banco em transação sem órfãos), `GET /api/ocorrencias/protocolo/:protocolo` (só campos públicos, com limite de tentativas) | Protocolo retornado e consultável (testado com banco falso e com PostgreSQL) |
| ✅ Ocorrências (gestão, parte 4) | Listagem paginada com filtros, detalhe, `PATCH` de status/prioridade com transições validadas e histórico, conclusão, reabertura, fotos protegidas | Testes de permissão passando (cada rota: 401 sem sessão e 403 com perfil fora da lista; testado com banco falso e com PostgreSQL) |
| ✅ Guia de reciclagem (parte 5) | `GET /api/pontos` (filtros por tipo e material), `GET /api/pontos/proximos?lat&lng&limite=3`, CRUD para admin (o `DELETE` desativa) | Resultados iguais aos de `consultas_teste.sql` (consultas 2 a 4 conferidas no PostgreSQL; rotas do admin com 401/403 testadas) |
| ✅ Coleta, etapa B: leitura | `GET /api/veiculos`, `GET /api/rotas` públicos, só ativos, com `demonstrativo` | Respostas iguais aos seeds 001 e 002 (testado com banco falso e com PostgreSQL) |
| ✅ Coleta, etapa C: motor da simulação | Funções puras percorrendo os pontos de `GET /api/rotas` (a cada 3 s, suavizada, recomeçando no fim, posições só em memória) | Testado com relógio falso e sobre as 7 rotas do seed 002, sem saltos nem valores inválidos |
| ✅ Coleta, etapa D: transmissão | Socket.IO (`coleta:posicoes`) emitindo as posições do motor, só leitura, origem conferida, `SIMULACAO_ATIVA` e `SIMULACAO_INTERVALO_MS` | Posições emitidas a cada 3 s (testado com clientes reais e relógio falso) |
| ✅ Seeds de rotas (coleta, etapa A) | Trajetos coerentes sobre ruas reais (gerados uma vez com o OSRM sobre o OpenStreetMap e versionados no seed 002), marcados como demonstrativos; `pnpm db:seed-rotas` para bancos já instalados | Rota visível e coerente no mapa (dados conferidos por testes; a conferência visual fica com a equipe 👤) |
| Testes e documentação | vitest + supertest com um banco de teste; `docs/06-api.md` | `pnpm test` verde |
| ✅ Migração para o Supabase (10/11/2026) | Banco oficial no Supabase (Session pooler, TLS verificado), migração 005 de segurança (RLS, sem privilégios para a Data API), fotos no Supabase Storage (bucket privado), `db:verificar`, `db:backup`/`db:restaurar`, testes num PostgreSQL descartável (`embedded-postgres`) | Dados idênticos ao banco local (contagens, ids, sequências e MD5 por tabela), Data API com 401 nas 14 tabelas, 467 testes e 42 verificações ponta a ponta contra o Supabase |

## Checkpoint 3: 27/11/2026 (MVP integrado)

| Tarefa | Pronto quando |
|---|---|
| `web/src/services/api.ts`; trocar `localStorage`/IndexedDB por chamadas à API | Ocorrências e fotos persistem entre navegadores e dispositivos |
| Login real e proteção de `#gestao` (redireciona sem sessão) | Acesso direto a `#gestao` sem login bloqueado (hoje: aberto) |
| Tela de consulta por protocolo para o cidadão | Mostra status e linha do tempo |
| GPS com alternativa manual (bairro/endereço ou ponto no mapa) | Funciona com permissão negada |
| Mapa em tempo real (Socket.IO), rótulo "simulação" e alerta de proximidade | Caminhões se movem sem recarregar a página |
| 3 pontos mais próximos com distância real e link "como chegar" | Distâncias calculadas, não fixas |
| Separar as páginas de `App.tsx` em componentes | Sem mudança visual |
| Os 10 testes da seção 7 do documento de requisitos | Evidências registradas |

## Apresentação: 01 a 08/12/2026

Implantação na nuvem (somente com autorização: serviços e custos serão apresentados antes), testes ponta a ponta em celular, atualização do template de documentação (arquitetura), roteiro do pitch e ensaio da demonstração com um plano B local.

## Riscos

| Risco | Mitigação |
|---|---|
| Servidor de tiles bloquear o mapa na demonstração | Avaliar provedor no CP3 e testar no dia; manter crédito ao OSM |
| Hospedagem gratuita "dormir" ou apagar arquivos | Armazenamento de objetos para fotos; aquecer o serviço antes do pitch; demonstração local como plano B |
| GPS exige HTTPS no celular | Testar com HTTPS (implantação ou túnel) antes da apresentação |
| Domínio técnico desigual na equipe | Código modular, documentação didática, cada integrante explica um módulo |

## Pendências e dúvidas registradas

- **Rotas dos caminhões:** 7 rotas demonstrativas no seed 002 (OpenStreetMap via OSRM, `docs/03`, seção 5.1). Não são os roteiros da Emlurb; se a equipe obtiver roteiros oficiais, eles exigem `fonte`.
- **Dados oficiais de ecopontos:** se a equipe obtiver uma fonte da Prefeitura/Emlurb, cadastrar com `demonstrativo = false` e `fonte`.
- **Indicadores da página inicial** (18/24/12/94%): no CP3, trocar por contagens da API ou manter rotulados como demonstrativos.
- **Bairros:** o seed tem 16 dos 94 bairros oficiais (os do protótipo). Ampliar exige uma fonte de coordenadas.
