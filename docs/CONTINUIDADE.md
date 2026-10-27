# Resumo técnico de continuidade

_Atualizado em 27/10/2026, ao fim da Etapa 0 + CP1._

**Repositório:** `ac1oli/EcoRecife` · branch de trabalho `claude/confident-pasteur-h9zmd3` (base `main`).

**Estrutura:**
- `web/`: front React 19 + TS + Vite 8 + Tailwind 4 + Leaflet, sem dependências do Figma;
- `database/`: migrações SQL 001–003, seed 001, `queries/`, `instalar.sql`;
- `docs/`: 01 diagnóstico · 02 modelagem · 03 banco · 04 plano · 05 execução local · `historico-prototipo/`.

**Decisões:**
- PostgreSQL 14+ sem extensões (sem PostGIS: Haversine em `distancia_km`), sem Docker obrigatório;
- enums ASCII; protocolo `ECO-AAAA-XXXX-XXXX` gerado por `gerar_protocolo()`;
- cidadão anônimo; a consulta pública expõe só protocolo, categoria, bairro, status, datas e linha do tempo;
- fotos fora do banco (máx. 3, 5 MB, jpeg/png/webp);
- `demonstrativo` + `fonte` obrigatória para dado oficial; sem usuários e senhas nos scripts;
- sem status "Improcedente"; sem importar o `localStorage` antigo.

**Testes executados:**
- front: `pnpm install --frozen-lockfile`, `pnpm typecheck` e `pnpm build` OK; Playwright desktop e celular: 6 telas sem erro de JS, 17 marcadores, protocolo gerado;
- banco: `instalar.sql` em PG 16.15 OK; `verificar_restricoes.sql` 24/24 OK; `consultas_teste.sql` conforme `docs/03`; segunda instalação recusada.

**Não verificado:**
- tiles do mapa (rede do ambiente bloqueia `tile.openstreetmap.de`);
- passo a passo no Windows real.

**Problemas conhecidos (front, a corrigir no CP3):**
- `#gestao` abre sem login;
- os dados ainda ficam em `localStorage`/IndexedDB;
- distâncias e posições são fixas.

**Pendências:**
- equipe: adicionar integrantes ao GitHub; validar o guia no Windows;
- CP2: seeds de rotas.

**Próxima tarefa (CP2):** criar `server/` (Express + TS + `pg` + `zod` + `bcryptjs` + cookie de sessão + `multer` + `socket.io`), com executor de migrações, comando `criar-admin`, endpoints do `docs/04` e testes vitest + supertest.
