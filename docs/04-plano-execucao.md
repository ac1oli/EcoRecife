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

Estrutura proposta: `server/` (Node 22 + TypeScript + Express).

| Tarefa | Detalhe | Pronto quando |
|---|---|---|
| Base da API | `config` (variáveis de ambiente validadas), `db` (pool `pg`), tratamento de erros, `helmet`, CORS restrito | `GET /api/saude` responde e consulta o banco |
| Executor de migrações | Script Node que aplica `database/migrations` ainda não registradas em `schema_migrations` | Banco novo criado só pelo script |
| Autenticação | `POST /api/auth/login` (bcrypt), sessão em cookie `httpOnly`, limite de tentativas, `GET /api/auth/eu`, logout | Rotas protegidas retornam 401/403 corretamente |
| Primeiro administrador | Comando `pnpm criar-admin` que pede e-mail e senha no terminal (nada fica no código) | Login funciona com o usuário criado |
| Ocorrências (público) | `POST /api/ocorrencias` (multipart, até 3 fotos validadas pelo conteúdo), `GET /api/ocorrencias/protocolo/:protocolo` (só campos públicos, com limite de tentativas) | Protocolo retornado e consultável |
| Ocorrências (gestão) | Listagem paginada com filtros, detalhe, `PATCH` de status/prioridade com transições validadas e histórico, conclusão, reabertura, fotos protegidas | Testes de permissão passando |
| Guia de reciclagem | `GET /api/pontos` (filtros por tipo e material), `GET /api/pontos/proximos?lat&lng&limite=3`, CRUD para admin | Resultados iguais aos de `consultas_teste.sql` |
| Coleta | `GET /api/veiculos`, `GET /api/rotas`; simulação Socket.IO percorrendo `rota_pontos` | Posições emitidas a cada poucos segundos |
| Seeds de rotas | Trajetos coerentes sobre ruas reais (desenhados manualmente ou gerados uma vez e versionados), marcados como demonstrativos | Rota visível e coerente no mapa |
| Testes e documentação | vitest + supertest com um banco de teste; `docs/06-api.md` | `pnpm test` verde |

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

- **Rotas dos caminhões:** a tabela existe, mas os trajetos ainda não foram cadastrados (CP2).
- **Dados oficiais de ecopontos:** se a equipe obtiver uma fonte da Prefeitura/Emlurb, cadastrar com `demonstrativo = false` e `fonte`.
- **Indicadores da página inicial** (18/24/12/94%): no CP3, trocar por contagens da API ou manter rotulados como demonstrativos.
- **Bairros:** o seed tem 16 dos 94 bairros oficiais (os do protótipo). Ampliar exige uma fonte de coordenadas.
