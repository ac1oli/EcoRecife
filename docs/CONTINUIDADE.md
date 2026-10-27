# Resumo técnico de continuidade

_Atualizado em 27/10/2026, ao fim do CP2 · parte 1 (base da API, migrações, criar-admin)._

**Repositório:** `ac1oli/EcoRecife` · branch de trabalho `claude/confident-pasteur-h9zmd3` (base `main`).

**Estrutura:**
- `web/`: front React 19 + TS + Vite 8 + Tailwind 4 + Leaflet, sem dependências do Figma;
- `server/`: API Node 22 + TS + Express 5 + `pg` + `zod`, com o próprio `pnpm-lock.yaml` (sem workspace);
- `database/`: migrações SQL 001–003, seed 001, `queries/`, `instalar.sql`;
- `docs/`: 01 diagnóstico · 02 modelagem · 03 banco · 04 plano · 05 execução local · 06 API · `historico-prototipo/`.

**Decisões (CP1):**
- PostgreSQL 14+ sem extensões (sem PostGIS: Haversine em `distancia_km`), sem Docker obrigatório;
- enums ASCII; protocolo `ECO-AAAA-XXXX-XXXX` gerado por `gerar_protocolo()`;
- cidadão anônimo; a consulta pública expõe só protocolo, categoria, bairro, status, datas e linha do tempo;
- fotos fora do banco (máx. 3, 5 MB, jpeg/png/webp);
- `demonstrativo` + `fonte` obrigatória para dado oficial; sem usuários e senhas nos scripts;
- sem status "Improcedente"; sem importar o `localStorage` antigo.

**Decisões (CP2 · parte 1):**
- `server/` separado, não é workspace pnpm (como o `web/`). Comandos rodam o TS com `tsx`, e `pnpm build` só confere a compilação;
- `.env` carregado com `process.loadEnvFile` (nativo do Node 22, sem `dotenv`) e validado com zod. Sem `DATABASE_URL` a API não sobe; CORS sem curinga;
- `criarApp(config, banco)` recebe as dependências por parâmetro, o que permite testar com banco falso;
- o executor de migrações reaproveita os arquivos de `database/` e a `schema_migrations` (sem duplicar SQL):
  - valida os arquivos antes de conectar;
  - exige banco UTF8;
  - recusa estados desconhecidos;
  - cada arquivo é uma transação;
  - usa trava consultiva;
  - detalhes em `docs/06` §3;
- `db:seed` só roda em banco migrado e sem dados;
- `criar-admin`:
  - exige terminal interativo e senha oculta de pelo menos 12 caracteres e até 72 bytes;
  - grava bcrypt custo 12;
  - não aceita senha por argumento nem por env;
- TypeScript fixado em ^5.9, como no `web/`, em vez do 7.x que o pnpm sugeriu.

**Dependências novas (`server/`):**
- produção: `express`, `pg`, `zod`, `helmet`, `cors`, `bcryptjs`;
- desenvolvimento: `typescript`, `tsx`, `vitest`, `supertest`, `@types/{express,pg,cors,supertest,node}`.

Todas estavam previstas no `docs/04`. `multer`, `file-type`, `socket.io` e `express-rate-limit` ficam para as partes 2–4.

**Comandos (pasta `server/`):** `pnpm install --frozen-lockfile` · `pnpm dev` · `pnpm typecheck` · `pnpm build` · `pnpm test` · `pnpm db:status` · `pnpm db:migrar` · `pnpm db:seed` · `pnpm criar-admin`.

**Testes executados (27/10, Windows 11, Node 24.18):**
- `pnpm typecheck` e `pnpm build` sem erros;
- `pnpm test` sem banco: 42 testes aprovados e 9 de integração pulados;
- `pnpm test` com PostgreSQL 16.14 temporário (pacote `embedded-postgres` instalado só no scratchpad, fora do projeto):
  - resultado: **52/52 aprovados**;
  - cobertura: migrações em banco novo, reexecução sem efeito, seed e recusa de segunda carga, `/api/saude` real, administrador com bcrypt e e-mail duplicado;
  - recusas: banco não UTF8, banco sem `schema_migrations`, versão desconhecida, migração quebrada (rollback total) e execução simultânea;
- manual nesse mesmo banco:
  - `db:status`, `db:migrar` (duas vezes) e `db:seed` (duas vezes) se comportaram como esperado;
  - `criar-admin` sem terminal foi recusado;
  - erros legíveis para `DATABASE_URL` ausente e para banco inacessível;
  - `pnpm start`: `GET /api/saude` respondeu 200, com CORS só para `localhost:5173`, helmet ativo e 404 em JSON.
- Problema achado e corrigido: um banco Windows criado sem `-E UTF8` vem em WIN1252, e a migração 001 falhava. A falha foi desfeita por inteiro, e o executor agora recusa esse banco antes de começar.

**Não verificado:**
- `criar-admin` interativo, com digitação real da senha oculta: o ambiente não tem terminal interativo, mas a lógica de validação e gravação está testada;
- Node 22, pois a máquina tem o 24, e PostgreSQL 14, pois os testes usaram o 16.14;
- `consultas_teste.sql`/`verificar_restricoes.sql` sobre um banco criado pelo `db:migrar`: não há `psql` nesta máquina. Os arquivos SQL são os mesmos validados no CP1;
- tiles do mapa e o passo a passo no Windows real (pendências do CP1).

**Problemas conhecidos (front, a corrigir no CP3):** `#gestao` abre sem login; os dados ainda ficam em `localStorage`/IndexedDB; distâncias e posições são fixas.

**Pendências:**
- equipe: adicionar integrantes ao GitHub; validar os guias `docs/03`, `docs/05` e `docs/06` no Windows, incluindo `pnpm criar-admin`;
- CP2: seeds de rotas.

**Próxima tarefa (CP2 · parte 2, aguarda aprovação):** autenticação e autorização.
- Proposta registrada: sessão própria no banco, numa migração `004_sessoes`, com token aleatório guardado só como hash, enviado em cookie `httpOnly` + `SameSite=Lax` (`Secure` em produção).
- Endpoints: `POST /api/auth/login` com bcrypt e `express-rate-limit`, `GET /api/auth/eu` e `POST /api/auth/logout`.
- Middlewares `exigirSessao` e `exigirPerfil('admin' | 'gestor')`, com testes de 401/403.
