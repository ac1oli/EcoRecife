# Resumo técnico de continuidade

_Atualizado em 10/11/2026, ao fim da migração definitiva para o Supabase._

**Repositório:** `ac1oli/EcoRecife` · branch de trabalho `claude/confident-pasteur-h9zmd3` (base `main`).

**Estrutura:**
- `web/`: front React 19 + TS + Vite 8 + Tailwind 4 + Leaflet, sem dependências do Figma;
- `server/`: API Node 22 + TS + Express 5 + `pg` + `zod` + `socket.io`, com o próprio `pnpm-lock.yaml` (sem workspace);
- **banco oficial: Supabase** (PostgreSQL 17, plano Free, projeto `ywsdluoitgwbbavbryju`, região us-west-2), via Session pooler com TLS verificado; fotos no Supabase Storage (bucket privado `ocorrencias-fotos`). Não há mais PostgreSQL local;
- `database/`: migrações SQL 001–005, seeds 001 (dados demonstrativos) e 002 (rotas demonstrativas), `queries/` (o `instalar.sql` foi removido: a instalação é só pelos comandos `db:*`);
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

**Decisões (CP2 · parte 2):**
- **Sessão no banco:** tabela `sessoes`, na migração `004_sessoes`.
  - O token é aleatório (32 bytes) e vai só no cookie. O banco guarda o SHA-256 dele.
  - O prazo é fixo (`SESSAO_HORAS`, padrão 8, de 1 a 168), sem renovação a cada uso.
  - A sessão é conferida no banco a cada requisição. Logout, expiração, usuário inativo ou excluído e um novo login no mesmo navegador a invalidam.
- **Cookie:**
  - `HttpOnly`, `SameSite=Lax` e `Path=/`;
  - em `production`, também `Secure`, com o prefixo `__Host-`;
  - em desenvolvimento, o nome é `eco_sessao`;
  - a leitura usa um parser próprio, sem `cookie-parser`.
- **Login:**
  - a mensagem é genérica para e-mail inexistente, senha errada e usuário inativo;
  - quando o e-mail não existe, o bcrypt roda contra um hash fictício, para não revelar e-mails pelo tempo de resposta;
  - as sessões expiradas são limpas a cada login.
- **CSRF:** `src/origem.ts` recusa com 403 os `POST`/`PUT`/`PATCH`/`DELETE` cujo `Origin` não está em `CORS_ORIGENS` (`null` incluído), e também os que vêm sem `Origin` mas com `Sec-Fetch-Site: cross-site`. Vale para todas as rotas, inclusive as futuras rotas públicas.
- **Limite de login:** `express-rate-limit`, 10 falhas por IP a cada 15 minutos, sem contar os logins certos. **A contagem fica na memória e zera quando a API reinicia.**
- **Autorização:** `exigirSessao` (401) e `exigirPerfil(...)` (403), em `src/auth/middlewares.ts`. Ainda não há endpoint de negócio protegido; os próximos devem usar os dois.
- **Testes de integração:** passaram a usar `test/apoio/banco-temporario.ts`, com travas que recusam:
  - `NODE_ENV=production`;
  - `TEST_DATABASE_URL` igual ao banco de `DATABASE_URL`;
  - nomes fora de `ecorecife_teste_<8 hex>`;
  - seguir adiante se `current_database()` não for o banco temporário.
- **Lockfile:** a política do pnpm 12 recusou entradas com menos de 24 h. Com autorização, o lockfile foi recriado (`qs` 6.16.1, `magic-string` 1.4.4).

**Decisões (CP2 · parte 3):**
- **`POST /api/ocorrencias` (multipart, anônimo):**
  - campos `categoria` (slug), `bairro` (nome, sem diferenciar maiúsculas), `endereco`, `descricao`, `latitude`/`longitude`/`origemLocalizacao`/`precisaoMetros` (opcionais, com as regras dos CHECKs) e `fotos`;
  - a categoria vai pelo slug e o bairro pelo nome porque é o que o formulário do front já envia (`<select>` com slugs e `<datalist>` com nomes). Campos que o cidadão não pode definir (status, prioridade, demonstrativo) são descartados.
- **Fotos:**
  - o `multer` guarda o upload em memória, então nada vai ao disco antes da validação;
  - o `file-type` detecta o tipo pelo conteúdo e ignora o nome, a extensão e o MIME enviados;
  - limites: 3 fotos, 5 MB cada (413 acima disso), jpeg/png/webp; 415 sem multipart;
  - os arquivos ficam em `<UPLOADS_DIR>/ocorrencias/<uuid>.<ext>`, com escrita `wx`. `UPLOADS_DIR` tem padrão `uploads`, relativo a `server/`, já ignorado pelo Git.
- **Transação única:** ocorrência, histórico inicial (`NULL → recebida`, `usuario_id` nulo) e fotos.
  - Qualquer falha (banco, disco ou `COMMIT`) gera `ROLLBACK` e apaga os arquivos já gravados.
  - Uma conexão que falha no `ROLLBACK` é descartada do pool.
  - Se o protocolo colidir (`ocorrencias_protocolo_key`), a transação é refeita até 3 vezes.
- **`GET /api/ocorrencias/protocolo/:protocolo`:**
  - devolve só os campos permitidos (`docs/02` §4, consultas 5–6): protocolo, categoria, bairro, status, `criadoEm`, `concluidoEm` e `linhaDoTempo` (`statusAnterior`, `status`, `em`, sem a observação);
  - o formato é validado antes do banco (400), o protocolo inexistente dá 404 e a resposta leva `no-store`.
- **Limite de consulta:** a regra é comum com o login (`src/limite.ts`): 10 falhas por IP a cada 15 minutos, contando só as respostas de erro, em memória (zera quando a API reinicia). O contador é separado do login.
- **Erros:** seguem o padrão `{"erro": "..."}`. Na validação, a resposta traz a primeira mensagem do zod; o 500 é genérico.
- **Assinatura:** o `criarApp` agora recebe o banco com `connect`, para a transação. O `server.ts` já passa o pool.

**Decisões (CP2 · parte 4):**
- **Permissão:** todas as rotas de gestão usam `exigirSessao` + `exigirPerfil('admin', 'gestor')`, porque nenhum documento restringe as ações de ocorrência a um perfil só (o "CRUD para admin" do `docs/04` é dos pontos). O 403 por rota é testado com um perfil fora da lista no banco falso, já que os dois perfis reais têm acesso.
- **Rotas:** `GET /api/ocorrencias`, `GET /:id`, `PATCH /:id/status`, `POST /:id/concluir`, `POST /:id/reabrir`, `PATCH /:id/prioridade` e `GET /:id/fotos/:fotoId`, em `src/rotas/gestao-ocorrencias.ts`, montadas depois das rotas públicas no mesmo prefixo.
- **Transições** (`docs/02` §3 + `<select>` do protótipo):
  - de um estado ativo para outro, em qualquer direção;
  - de ativo para `concluida`, com nota opcional;
  - de `concluida` para `em_analise`, limpando a conclusão;
  - as demais respondem 409. `concluida` não entra pelo `PATCH /status`, que responde 400 e remete para `/concluir`. A regra fica numa função pura, `proximoStatus`.
- **Consistência:** `emTransacao` (novo, em `db.ts`) faz `SELECT ... FOR UPDATE`, UPDATE e INSERT no histórico com o `usuario_id` da sessão. Qualquer falha gera `ROLLBACK`. O registro da parte 3 foi refatorado para usar o mesmo helper.
- **Prioridade:** muda sem gerar histórico (CHECK `historico_muda_status`).
- **Listagem:**
  - filtros `fila`, `status`, `prioridade`, `categoria` (slug), `bairro` (nome) e `busca` (literal, nos campos do protótipo);
  - paginação com `pagina` e `porPagina` (1–50), em ordem `criado_em DESC, id DESC`;
  - todos os valores vão como parâmetros.
- **Detalhe:**
  - coordenadas, nota, fotos (com `url` da rota protegida, sem a chave de armazenamento) e histórico com `responsavel` (só o nome do usuário);
  - ids da URL inválidos respondem 404 sem consultar o banco.
- **Fotos:**
  - só existem pela rota protegida, e a foto precisa pertencer à ocorrência da URL;
  - a chave do banco é conferida contra o padrão exato antes do `sendFile` com `root`;
  - cabeçalhos `private, no-store`, `nosniff` e `Cross-Origin-Resource-Policy: same-site` (para o `<img>` do front na porta 5173).
- **EXIF:** os arquivos são mantidos como enviados. Remover o EXIF exigiria recodificar a imagem com uma dependência nova (como o `sharp`), o que amplia o escopo. A proteção é de acesso, e a decisão final fica para a equipe antes da implantação (`docs/06` §6.7).
- **Sem migração nova:** as tabelas e os índices da 002/003 bastam.

**Decisões (CP2 · parte 5, guia de reciclagem):**
- **Nome:** o pedido chamou esta etapa de "CP3", mas ela é a linha "Guia de reciclagem" do CP2 no `docs/04`. O front não foi alterado; consumir a API continua sendo o CP3.
- **Rotas públicas** (só pontos ativos): `GET /api/pontos?tipo&material` (ordem da consulta 4) e `GET /api/pontos/proximos?lat&lng&limite&tipo&material` (`distancia_km`, consultas 2 e 3; `limite` de 1 a 10, padrão 3; `distanciaKm` com 2 casas; `no-store`, porque a URL tem a posição).
- **Rotas do admin** (`exigirSessao` + `exigirPerfil('admin')`, como o "CRUD para admin" do `docs/04`): `GET /gestao` (com inativos), `GET /:id`, `POST /`, `PATCH /:id` e `DELETE /:id`.
- **Excluir = desativar** (`ativo = false`, reversível pelo `PATCH`). É uma dúvida registrada: nenhum documento pede exclusão física, e desativar não perde dados.
- **Regras:** `fonte` obrigatória para dado não demonstrativo (zod no `POST`; no `PATCH`, conferida contra o estado final com `FOR UPDATE`); `site` só `http(s)`, porque o front vai exibir como link; nome repetido no mesmo tipo dá 409; bairro pelo nome, como nas ocorrências; material desconhecido dá 400 no cadastro e lista vazia no filtro.
- **Transação:** ponto, bairro e materiais numa só `emTransacao`; as colunas do `UPDATE` vêm de uma lista fixa.
- **Campos públicos:** os do guia (inclui `demonstrativo`, `fonte` e `verificadoEm`). `ativo` e as datas internas só saem para o admin.
- **Sem migração e sem dependência nova.**

**Migração para o Supabase (10/11/2026, autorizada pelo usuário):**
- **Arquitetura:**
  - o front continua falando só com a API;
  - a API, com autenticação própria (bcrypt + sessão em cookie, sem Supabase Auth), conecta ao Supabase pelo `pg`;
  - Socket.IO sem mudança;
  - a publishable key não é usada por nenhuma parte.
- **Conexão:**
  - Session pooler `aws-0-us-west-2.pooler.supabase.com:5432`, usuário `postgres.<id>`, descoberto sem senha por uma sonda que fecha antes da autenticação. A conexão direta só tem IPv6, e esta máquina não tem rota IPv6;
  - o Transaction pooler (6543) é recusado pela config, porque o migrador usa trava consultiva de sessão;
  - TLS com a CA oficial (`server/certs/prod-ca-2021.crt`, `Supabase Root 2021 CA`, até 2031; arquivo público, pode ir para o Git) e `rejectUnauthorized: true`;
  - parâmetros `ssl*` da URL são retirados, porque o `pg` daria prioridade a eles;
  - pool com no máximo 5 conexões.
- **Config (`src/config.ts`):**
  - `DATABASE_URL` só aceita o Supabase (pooler `postgres.<id>` ou `db.<id>.supabase.co`, porta 5432, com senha);
  - `DATABASE_SSL_CA`, padrão `certs/prod-ca-2021.crt`;
  - `carregarConfigStorage` (só a API e os comandos de Storage) exige `SUPABASE_URL` do mesmo projeto e `SUPABASE_SECRET_KEY` (`sb_secret_...`; recusa a publishable key e o valor de exemplo), com `SUPABASE_BUCKET_FOTOS` de padrão `ocorrencias-fotos`;
  - `UPLOADS_DIR` saiu;
  - os logs mostram o projeto e o ambiente, sem segredos.
- **Segurança (migração `005_seguranca`):**
  - RLS em todas as 14 tabelas, sem nenhuma policy;
  - `REVOKE ALL` de `anon`, `authenticated` e `service_role` em tabelas, sequências e funções, inclusive nos privilégios padrão;
  - funções com `search_path = pg_catalog` e sem `EXECUTE` para `PUBLIC`;
  - é portátil: num PostgreSQL comum os papéis não existem e o bloco não faz nada.
  - Conferido de fora: a Data API devolve 401 nas 14 tabelas. A Data API continua **ligada** no painel: desligá-la é recomendado, mas exige login no painel.
- **Storage:**
  - `src/ocorrencias/armazenamento-supabase.ts` usa a API REST com `fetch`, sem dependência nova;
  - bucket privado com 5 MB e só jpeg/png/webp, criado por `pnpm storage:preparar`;
  - a interface `Armazenamento` (`gravar`/`ler`/`apagar`) tem duas implementações: Supabase na API e disco nos testes. `criarApp` recebe `fotos` no lugar de `pastaUploads`;
  - a rota da foto lê do Storage e repassa, sem mudar o contrato;
  - a publishable key não lista, não lê, não envia e não cria bucket (403 de RLS).
- **Dados:**
  - inventário somente leitura do banco local: só dados do seed 001 (16 bairros, 3 categorias, 6 materiais, 10 pontos, 16 ponto_materiais, 7 veículos, 8 ocorrências, 20 históricos), 0 usuários, 0 sessões, 0 fotos, 0 rotas, 0 órfãos, migrações 001–004;
  - **a criação limpa por seed NÃO preserva ids**: o `INSERT … SELECT` do seed 001 atribuiu ids diferentes no PostgreSQL 17 (ex.: id 2 = #06 em vez de #08). Por isso, os dados vieram do **backup** (`pg_restore --data-only`, em ordem de dependência, numa transação, sem `schema_migrations` e `sessoes`);
  - as 7 rotas, que o banco local nunca teve, vieram do `db:seed-rotas`, que só grava nas duas tabelas de rotas, vazias.
- **Novos comandos:** `db:verificar` (com `--restricoes` e `--data-api`), `db:backup`/`db:restaurar` (SQL puro, sem `pg_dump`; o plano Free não tem backup para baixar) e `storage:preparar`/`storage:verificar`.
- **Testes:**
  - o `globalSetup` do Vitest sobe um PostgreSQL 17 descartável (`embedded-postgres`, só desenvolvimento) quando não há `TEST_DATABASE_URL`;
  - a trava recusa qualquer host do Supabase;
  - `vitest.config.ts` com `hookTimeout` de 30 s.
- **PostgreSQL local removido:** o serviço `postgresql-x64-16` (PostgreSQL 16.15, em `C:\Program Files\PostgreSQL\16`) foi desinstalado pelo desinstalador oficial em modo autônomo, com elevação UAC aprovada pelo usuário. A pasta `data` (98 MB, cluster antigo) foi **mantida**; apagá-la é decisão do usuário.
- **Backups:** em `C:\Users\Kinn\EcoRecife-backups\2026-11-10\`, com acesso restrito ao usuário do Windows (`icacls`):
  - `ecorecife_local_2026-11-10.dump` (`pg_dump -Fc`, SHA-256 `63ccd8a7…f44392a`, validado com `pg_restore --list` e restaurado idêntico num banco temporário);
  - `ecorecife_local_2026-11-10.sql` (SQL legível);
  - `ecorecife_supabase_2026-11-10T11-17-15.sql` (`db:backup`, restaurado idêntico num banco temporário);
  - inventários e comparação em JSON;
  - cópia do `.env` anterior.

**Decisões (coleta · etapa D, Socket.IO):**
- **Observação:** o pedido da etapa D chegou cortado: faltavam o objetivo, os requisitos iniciais e o começo da lista de testes. A implementação seguiu o que já estava registrado: D6, D11, a proposta da etapa C no `docs/06` §6.10 e a próxima tarefa deste arquivo.
- **Dependências:** `socket.io` ^4.8.4 (produção) e `socket.io-client` ^4.8.4 (desenvolvimento, só nos testes), as duas previstas desde a análise da coleta. O lockfile só ganhou entradas; nenhuma versão existente mudou.
- **Módulo:** `server/src/coleta/tempo-real.ts` (`iniciarTempoReal`), ligado pelo `server.ts` depois que a porta abre. Lê as rotas uma vez com `listarRotas` (a mesma consulta de `GET /api/rotas`); uma rota nova só entra ao reiniciar. Banco fora ao subir: a API sobe sem a simulação e registra no log.
- **Evento:** `coleta:posicoes`, `{demonstrativo: true, intervaloMs, posicoes}`, para todos, a cada passo; quem conecta recebe o retrato atual na hora.
- **Configuração:** `SIMULACAO_ATIVA` (`true`/`false`, padrão `true`, D11) e `SIMULACAO_INTERVALO_MS` (1000 a 60000, padrão 3000), validadas com zod no `config.ts` e no `.env.example`. Desligada: sem consulta, sem relógio e `404` em `/socket.io/`. A velocidade não mudou (20 km/h, no código).
- **Segurança:**
  - só leitura: nenhum ouvinte de mensagens do cliente; acima de 1 kB, a conexão cai;
  - `Origin` conferido no handshake contra `CORS_ORIGENS` (`allowRequest`), porque o CORS não vale para WebSocket. Sem `Origin`, segue, como na API HTTP; `null` é recusado;
  - CORS sem `credentials`, e `serveClient: false`.
- **Encerramento:** para o relógio, `io.close()` (desconecta e fecha o HTTP) e depois o pool. O cliente vê `transport close` e reconecta sozinho, de propósito.
- **Sem migração, sem mudança nas APIs HTTP, nos seeds, nos trajetos, na velocidade ou no front.**

**Decisões (coleta · etapa C, motor da simulação):**
- **Módulo:** `server/src/coleta/simulador.ts`, sem banco, rede ou dependência. Recebe as rotas no formato de `GET /api/rotas` (o tipo vem de `listarRotas`) e não duplica trajetos. Posições só em memória (D8). Ainda não está ligado ao `server.ts`: isso é a etapa D.
- **Validação:** só rotas com veículo; pontos com coordenada ou `ordem` inválida são descartados e repetidos consecutivos são unidos; rota com menos de 2 pontos, ou segunda rota do mesmo veículo, é ignorada sem afetar as demais (`ignoradas`, com o motivo).
- **Movimento:** começa no ponto 1, velocidade constante medida por Haversine (raio de `distancia_km`) e interpolação linear dentro do segmento. Cada passo anda no máximo a distância do passo.
- **Reinício:** ao passar do fim, recomeça carregando o restante e soma `volta`. As 7 rotas do seed são fechadas, então a virada é contínua. Numa rota aberta, a volta recomeça no ponto 1, e o `volta` marca isso.
- **Relógio:** `criarSimulador` com `setInterval` (`unref`); cada passo vale exatamente um intervalo, para o resultado não depender de atrasos. `iniciar()` idempotente, `parar()`, `posicoes()`.
- **Valores:** intervalo padrão 3000 ms (D7), aceito de 1000 a 60000; velocidade demonstrativa padrão 20 km/h (≈ 16,7 m por passo), aceita até 80. Não são dados oficiais. Fora da faixa: `RangeError`.
- **Configuração:** não havia variável de intervalo, e o `config.ts` **não foi alterado**. Proposta para a etapa D, no `docs/06` §6.10: `SIMULACAO_ATIVA` (D11) e `SIMULACAO_INTERVALO_MS`, validadas com zod.
- **Posição:** `{codigo, rotaId, latitude, longitude, volta, demonstrativo: true}`.
- **Sem migração, sem endpoint, sem mudança nos seeds ou no front, sem dependência nova.**

**Decisões (coleta · etapa B, leitura de veículos e rotas):**
- **Rotas:** `GET /api/veiculos` e `GET /api/rotas`, públicas (D4), em `src/coleta/coleta.ts` e `src/rotas/coleta.ts`. Não há escrita (D5).
- **Campos:**
  - veículo: `codigo`, `descricao`, `tipoColeta`, `bairro` (nome) e `demonstrativo`. O `codigo` identifica o veículo; o id interno não sai;
  - rota: `id`, `nome`, `demonstrativo`, `veiculo` (mesmos campos) e `pontos` (`ordem`, `latitude`, `longitude`, em ordem).
- **Só ativos:** veículos com `ativo`, rotas com `ativa`. Uma rota ativa sem veículo, ou com veículo inativo, sai com `veiculo: null`, para não expor o veículo inativo.
- **Sem filtros nem paginação:** nenhum documento define, e são 7 itens. Parâmetros na URL são ignorados. Também não há rota de detalhe.
- **SQL:** sem valores da requisição; o filtro de ativos está no próprio SQL. Os pontos vêm agregados em JSON (`json_agg ... ORDER BY rp.ordem`).
- **Sem migração e sem dependência nova.**

**Decisões (coleta · etapa A, seeds de rotas):**
- **Decisões aprovadas pelo usuário (D1–D11):**
  - D1: trajetos do OpenStreetMap sobre ruas reais;
  - D2: comando `pnpm db:seed-rotas`;
  - D3: uma rota por veículo ativo;
  - D4: veículos e rotas com leitura pública, só ativos;
  - D5: sem cadastro pela API;
  - D6: o servidor transmite as posições de todos;
  - D7: a cada 3 s, com movimento suavizado e reinício;
  - D8: posições só em memória;
  - D9: proximidade calculada no navegador;
  - D10: status e previsão no CP3;
  - D11: simulação ativa por padrão e desligável por variável.
  D4–D11 valem para as próximas etapas.
- **Fonte:** com autorização explícita do usuário, 7 consultas únicas (29/10) ao OSRM público (`router.project-osrm.org`, perfil `driving`) sobre o OpenStreetMap. Os pontos de passagem formam um losango de ~450 m em volta do bairro do seed 001. As coordenadas são as do OSRM, sem edição. Crédito "© colaboradores do OpenStreetMap" (ODbL). Detalhes e conferências no `docs/03` §5.1.
- **Dados:** `database/seeds/002_rotas_demonstrativas.sql`, com 7 rotas (`Rota demonstrativa #NN - Bairro`, `ativa` e `demonstrativo = true`) e 1.178 pontos. `rota_pontos` não tem coluna `demonstrativo`; os pontos herdam a marca da rota. Não houve migração nova.
- **Carga segura no próprio SQL:** tabelas temporárias com os dados e um bloco `DO` que decide antes de gravar:
  - carrega quando não há rotas demonstrativas;
  - não faz nada quando as 7 estão iguais ao arquivo;
  - interrompe em carga parcial, rota demonstrativa alterada, veículo com outra rota ou veículo ausente/inativo;
  - rotas sem relação com os 7 veículos são mantidas;
  - o arquivo nunca apaga nem altera nada.
- **Como entra em cada banco:**
  - banco novo: o `semear()` (`pnpm db:seed`) e o `instalar.sql` aplicam o 002 depois do 001;
  - banco instalado: `pnpm db:seed-rotas` (`semearRotas` em `src/banco/migrador.ts` + `src/scripts/seed-rotas.ts`). Ele reutiliza a validação do arquivo, a trava consultiva, a checagem de migrações pendentes e o ROLLBACK do migrador. O `semear()` não mudou.

**Dependências novas (`server/`):**
- produção: `express`, `pg`, `zod`, `helmet`, `cors`, `bcryptjs`;
- desenvolvimento: `typescript`, `tsx`, `vitest`, `supertest`, `@types/{express,pg,cors,supertest,node}`.

Na parte 2 entrou só `express-rate-limit` ^8.7.1, que estava prevista. Na parte 3 entraram `multer` ^2.5.0 e `file-type` ^22.2.0 (produção) e `@types/multer` ^2.3.0 (desenvolvimento), também previstas. Todas estavam previstas no `docs/04`. As partes 4 e 5 e as etapas A a C da coleta não adicionaram nenhuma dependência. Na etapa D entraram `socket.io` ^4.8.4 (produção) e `socket.io-client` ^4.8.4 (desenvolvimento). Na migração para o Supabase entrou só `embedded-postgres` 17.9.0-beta.17 (desenvolvimento, versão exata; o "beta" é o esquema de versões do pacote). Ele traz os binários do PostgreSQL para os testes e substitui o PostgreSQL instalado. O `postinstall` do pacote de binários foi liberado no `pnpm-workspace.yaml` depois de lido: ele só recria links simbólicos de bibliotecas, e a lista é vazia no Windows.

**Comandos (pasta `server/`, via `corepack pnpm`):** `install --frozen-lockfile` · `dev` · `typecheck` · `build` · `test` · `db:status` · `db:migrar` · `db:seed` · `db:seed-rotas` · `db:verificar [--restricoes] [--data-api]` · `db:backup [--pasta]` · `db:restaurar <arquivo>` · `storage:preparar` · `storage:verificar` · `criar-admin`.

**Testes executados na migração para o Supabase (10/11/2026, Windows 11, Node 24.22, pnpm 12.15 via `corepack`):**
- **Comparação original × Supabase**, as duas conexões em `READ ONLY`, com MD5 de cada tabela ordenada pela chave primária e datas em UTC:
  - as 12 tabelas migradas estão **idênticas**, com os mesmos ids mínimos e máximos e as mesmas sequências;
  - restrições, índices, enums e gatilhos iguais; corpo das 3 funções idêntico (só ganharam `SET search_path`);
  - 0 órfãos e os protocolos nos mesmos ids;
  - a `schema_migrations` ganhou a 005, e a `sessoes` não foi migrada, de propósito.
  - Depois do teste ponta a ponta, as 12 tabelas continuaram idênticas ao backup; as sequências só avançaram (lacunas normais).
- **`pnpm db:verificar --restricoes --data-api` no Supabase:**
  - todas as linhas OK: TLS 1.3 verificado, migrações 001–005, 14 tabelas com RLS e 0 policies, nenhum privilégio de `anon`/`authenticated`/`service_role`, funções seguras, 0 órfãos, sequências OK;
  - **24/24 restrições**;
  - Data API com 401 nas 14 tabelas.
- **`pnpm storage:verificar`:**
  - bucket privado com 5 MB e só jpeg/png/webp;
  - ida e volta OK; URL pública com HTTP 400; tipo não permitido recusado;
  - 0 fotos no banco e 0 no bucket (não havia fotos a migrar).
  - Com a publishable key: listar devolve `[]`, ler o bucket dá 404, enviar dá 403 de RLS e criar bucket dá 403.
- **Teste funcional ponta a ponta** (script de uma vez, fora do repositório), com a API real (`src/server.ts`) contra o Supabase e registros temporários marcados e apagados no fim:
  - **42/42**: saúde; login, `eu` e logout; sessões em hash; ocorrência pública com foto no Storage; consulta por protocolo; listagem e detalhe do gestor; foto com e sem sessão e de outra ocorrência; status, conclusão, reabertura, prioridade, CSRF e histórico com o usuário; pontos, filtro, os 3 mais próximos, cadastro/edição/desativação pelo admin e 403 do gestor; 7 veículos; 7 rotas com 1.178 pontos; Socket.IO (7 veículos, posições mudando, origem estranha recusada); limpeza com as contagens de volta ao estado anterior;
  - a primeira execução teve 3 falhas **do script** (material `papel` inexistente); corrigido, deu 42/42, e de novo 42/42 depois da remoção do PostgreSQL;
  - o `Ctrl+C` real não foi testado: no Windows, matar o processo não aciona o encerramento suave, que é coberto pelos testes do `tempo-real`.
- **`corepack pnpm test`: 467/467** (23 arquivos, no PostgreSQL descartável). Executado de novo depois da remoção do PostgreSQL local, com o mesmo resultado; `typecheck` e `build` sem erros.
  - Novos: `armazenamento-supabase.test.ts` (fetch falso), `seguranca.integracao.test.ts` (papéis e privilégios padrão do Supabase, 401/42501 e o `db:verificar` acusando cada falha) e `backup.integracao.test.ts`;
  - também `config.test.ts` reescrito e uma trava nova no `banco-temporario.test.ts`.
- **Teste de mutação:** sem as revogações e a RLS de `usuarios` na 005, 9 testes de segurança falham. O arquivo foi restaurado e conferido com `cmp`.
- **Varredura de segredos:** a senha do banco e a secret key reais não aparecem em nenhum arquivo fora de `server/.env`, e a publishable key não está em nenhum arquivo.
- **Problemas encontrados e resolvidos:**
  - `pg_stat_ssl` mostrava "sem TLS" porque mede o trecho pooler → Postgres; a checagem passou a olhar o socket do cliente;
  - a comparação de conteúdo dependia da collation e do fuso; passou a usar `COLLATE "C"` e UTC;
  - o `pg_restore -L` segue a ordem da lista, e a primeira tentativa (alfabética) violou uma FK; numa transação, nada foi gravado. A lista foi reordenada pelas dependências.

**Testes executados na coleta · etapa D (29/10, Windows 11, Node 24.22, pnpm 12.15 via `corepack`):**
- **`corepack pnpm typecheck` e `corepack pnpm build`:** sem erros.
- **`corepack pnpm test`:** **419/419 aprovados** (20 arquivos, com integração no PostgreSQL local, só em bancos temporários; 0 bancos `ecorecife_teste_*` restantes, por consulta somente leitura).
  - `tempo-real.test.ts`, 16 testes. O servidor HTTP é real, em `127.0.0.1` numa porta livre, e os clientes `socket.io-client` conectam direto por WebSocket. O passo da simulação usa timers falsos só para `setInterval`/`clearInterval`, o que é seguro porque o engine.io só usa `setInterval` no upgrade do polling, que não acontece aqui:
    - retrato inicial e ausência de campos internos;
    - uma consulta só e rota sem veículo ignorada;
    - conexão sem `Origin`;
    - nada antes de 3 s e uma mensagem por passo para todos os clientes;
    - intervalo configurado;
    - 3 origens recusadas no WebSocket e 403 sem CORS no polling;
    - sem o arquivo do cliente;
    - mensagens do cliente (inclusive um `coleta:posicoes` falso) sem efeito na simulação nem nos outros clientes;
    - mensagem acima de 1 kB derruba só aquela conexão;
    - desligada: 404, sem consulta e sem relógio;
    - banco fora: sem relógio pendurado;
    - encerramento sem relógio, sem clientes e com o HTTP fechado;
    - integração com as 7 rotas do seed num banco temporário.
  - `config.test.ts`: padrões e 5 recusas das variáveis novas.
- **Ajustes durante os testes:** o regex de "campos internos" casava "ativo" dentro de "demonstrativo" e foi corrigido. A contagem de timers passou a descontar os dois `setInterval` que o `express-rate-limit` cria no `criarApp`. O motivo esperado no encerramento é `transport close`, para o cliente reconectar sozinho.
- **Estabilidade:** `tempo-real.test.ts` passou 4 vezes seguidas.
- **Teste de mutação:**
  - aceitar qualquer origem: 4 testes falham;
  - sem `simulador.parar()` no encerramento: 1 teste falha;
  - o arquivo foi restaurado e conferido com `cmp`.
- **Teste de subida real do `server.ts`** (`node --import tsx src/server.ts`, porta 3399): `DATABASE_URL` foi trocada por uma porta fechada (`127.0.0.1:1`), sem tocar no banco de desenvolvimento.
  - com a simulação ligada: o log disse `simulação não iniciada ... ECONNREFUSED`, `/api/saude` deu 503 e `/socket.io/` deu 404;
  - com `SIMULACAO_ATIVA=false`: o log disse `simulação desligada` e `/socket.io/` deu 404;
  - o processo foi encerrado e a porta ficou livre.
- **Não executado:**
  - a API contra o banco de `DATABASE_URL` com as rotas carregadas (não autorizado);
  - o encerramento por `Ctrl+C` no terminal real (no teste de subida, o processo foi morto);
  - a conexão de um navegador;
  - o proxy com WebSocket;
  - o Node 22.

**Testes executados na coleta · etapa C (29/10, Windows 11, Node 24.22, pnpm 12.15 via `corepack`):**
- **`corepack pnpm typecheck` e `corepack pnpm build`:** sem erros.
- **`corepack pnpm test`:** **397/397 aprovados** (19 arquivos, com integração no PostgreSQL local, só em bancos temporários; 0 bancos `ecorecife_teste_*` restantes, por consulta somente leitura).
  - `simulador.test.ts`, 40 testes, sem banco:
    - Haversine;
    - preparação (ordem, rotas fechadas, 7 casos de rota inválida, descarte de pontos ruins);
    - inicialização no ponto 1 e rotas ignoradas sem afetar as demais;
    - interpolação, avanço pelos pontos intermediários, imutabilidade, passo inválido e continuidade;
    - fim e reinício (fechada, exatamente no fim, aberta, várias voltas num passo, 5.000 passos);
    - relógio com `vi.useFakeTimers()` (3 s, 2.999 ms não avança, parar/iniciar, intervalo e velocidade configurados, 9 configurações inválidas);
    - as 7 rotas do seed 002 ao mesmo tempo por 450 passos (uma volta completa): nenhum NaN, nenhuma coordenada inválida, deslocamento máximo de um passo (tolerância de 1 mm) e todas na volta 1.
- **Ajuste durante os testes:** a primeira execução acusou um deslocamento de 0,02 mm acima do passo, porque a interpolação é linear em lat/lng e a régua é Haversine. A tolerância do teste passou a ser 1 mm.
- **Teste de mutação:** sem a interpolação (fração sempre 0), 7 testes falham. O arquivo foi restaurado e conferido com `cmp`.
- **Não executado:** o motor rodando dentro da API (etapa D) e a exibição no mapa (CP3).

**Testes executados na coleta · etapa B (29/10, Windows 11, Node 24.22, pnpm 12.15 via `corepack`):**
- **`corepack pnpm typecheck` e `corepack pnpm build`:** sem erros.
- **`corepack pnpm test`:** **357/357 aprovados** (18 arquivos, com integração no PostgreSQL local via `TEST_DATABASE_URL`, só em bancos temporários). Depois da suíte, 0 bancos `ecorecife_teste_*` restantes, conferidos por uma consulta somente leitura.
  - `coleta.test.ts`, com banco falso, 15 testes:
    - acesso sem sessão e campos exatos, inclusive `veiculo: null` e `pontos: []`;
    - filtro de ativos e ordem dos pontos no SQL, sem valores da requisição, mesmo com parâmetros maliciosos na URL;
    - escrita, detalhe e métodos inexistentes dão 404 sem consultar o banco;
    - `Origin` externo (403);
    - falha do banco vira 500 genérico.
  - `coleta.integracao.test.ts`, com PostgreSQL, 6 testes:
    - os 7 veículos iguais à consulta de referência;
    - as 7 rotas com veículo e pontos iguais ao seed 002 (1.178, ordem 1..n);
    - nenhum campo interno e nenhum cookie;
    - veículo inativo, rota inativa e rota sem veículo;
    - regressão de login, ocorrências, pontos e saúde.
- **Teste de mutação:** sem `WHERE r.ativa` e sem `AND v.ativo`, 2 testes falham (1 unitário e 1 de integração). O arquivo foi restaurado e conferido com `cmp`.
- **Não executado:** a API rodando (`pnpm start`) contra o banco de `DATABASE_URL` (não autorizado) e o uso pelo front (CP3).

**Testes executados na coleta · etapa A (29/10, Windows 11, Node 24.22, pnpm 12.15 via `corepack`):**
- **`corepack pnpm typecheck` e `corepack pnpm build`:** sem erros.
- **`corepack pnpm test`:** **336/336 aprovados** (16 arquivos, com integração no PostgreSQL local via `TEST_DATABASE_URL`, só em bancos temporários). Depois da suíte, 0 bancos `ecorecife_teste_*` restantes, conferidos por uma consulta somente leitura.
  - `seed-rotas.test.ts`, sem banco, 9 testes:
    - o arquivo passa na validação do migrador;
    - 7 rotas, iguais aos veículos do seed 001;
    - 2 ou mais pontos por rota, com ordem 1..n sem lacunas;
    - coordenadas no formato `numeric(9,6)`, dentro do Recife e a menos de 1,5 km do bairro;
    - trechos de menos de 500 m, sem repetição, circuito fechado e de 2 a 10 km;
    - créditos e marcação demonstrativa;
    - o arquivo não tem nenhum DELETE, UPDATE ou DROP;
    - ordem no `instalar.sql`;
    - recusa de arquivo inválido sem conectar e de trava ocupada.
  - `seed-rotas.integracao.test.ts`, com PostgreSQL, 11 testes:
    - carga inicial (uma rota por veículo ativo, `ativa` e demonstrativa);
    - pontos iguais ao arquivo;
    - segunda execução sem nenhuma mudança;
    - rota alterada e carga parcial recusadas sem mexer em nada;
    - **rollback real** com um gatilho que derruba o 500º ponto: 0 rotas e 0 pontos, e a carga funciona depois;
    - veículo com rota própria recusado, preservando a rota;
    - rota avulsa mantida;
    - veículos ausentes ou inativos;
    - banco sem migrações;
    - banco novo pelo `db:seed`, reconhecido pelo `db:seed-rotas` como já carregado;
    - regressão do seed 001.
  - ajustes de compatibilidade: `migrador.test.ts` e `integracao.test.ts` agora esperam os seeds 001 e 002 (e 7 rotas no banco novo).
- **Teste de mutação:** trocar a recusa "veículo já tem rota" por um aviso faz o teste correspondente falhar. O arquivo foi restaurado (conferido com `cmp`).
- **`psql` real (banco temporário criado pelas mesmas travas e apagado no fim):**
  - `instalar.sql` aplicou 4 migrações, o seed 001 e o seed 002 (7 rotas, 1.178 pontos, 7 veículos com rota);
  - rodar o 002 de novo deu só o aviso "já estavam carregadas", e o `db:seed-rotas` deu `ja_carregadas`;
  - `verificar_restricoes.sql` deu 24/24 OK, e a consulta 1 de `consultas_teste.sql` segue igual.
- **Não executado:**
  - o `pnpm db:seed-rotas` no banco de `DATABASE_URL` (não autorizado);
  - a conferência visual no mapa, que fica com a equipe.

**Testes executados na parte 5 (28/10, Windows 11, Node 24.22, pnpm 12.15 via `corepack`):**
- **`corepack pnpm typecheck` e `corepack pnpm build`:** sem erros.
- **`corepack pnpm test`:** **316/316 aprovados** (14 arquivos, com integração no PostgreSQL local via `TEST_DATABASE_URL`, só em bancos temporários). Depois da suíte, 0 bancos `ecorecife_teste_*` restantes, conferidos por uma consulta somente leitura.
  - `pontos.test.ts`, com banco falso, 40 testes:
    - ids, filtros, coordenadas, limite e corpos (fonte obrigatória, `site` com `javascript:`/`data:`, telefone, data, materiais);
    - campos públicos sem `ativo`, SQL só com parâmetros e filtro inválido sem consultar o banco;
    - as 5 rotas do admin: 401 sem sessão e 403 para `gestor`, sem consultar pontos; `Origin` externo (403);
    - transações: `COMMIT` no cadastro; `ROLLBACK` para bairro ou material desconhecido, nome repetido (409) e fonte ausente no estado final; erro inesperado vira 500 genérico;
    - `PATCH` com colunas da lista fixa, e `DELETE` que só desativa.
  - `pontos.integracao.test.ts`, com PostgreSQL, 16 testes:
    - listagem igual à consulta 4, inclusive os materiais;
    - filtros conferidos contra o banco;
    - próximos do Derby iguais à consulta 2 e ao `docs/03` (Torre 1,61 · Novo Ciclo 1,85 · Centro 1,95), com eletroeletrônicos iguais à consulta 3 (Pina 3,78 · Casa Amarela 4,95), limite e distância 0;
    - 401/403 sem gravar nada;
    - cadastro, 409, fonte, rollback com material ou bairro inválido;
    - `PATCH` parcial com troca de materiais, `PATCH` recusado pela regra da fonte;
    - **rollback real** com um gatilho que derruba o INSERT dos materiais: o nome não muda;
    - desativação, idempotência, visão do admin e reativação;
    - **regressão:** ocorrências (gestão, protocolo) e saúde seguem iguais.
- **Teste de mutação:** sem `exigirPerfil('admin')`, 11 testes falham (5 unitários, um por rota, e 6 de integração). O código foi restaurado.
- **Não executado:** o `pnpm start` contra o banco de `DATABASE_URL` (acesso não autorizado) e o uso pelo front (CP3).

**Testes executados na parte 4 (27/10, Windows 11, Node 24.22, pnpm 12.15 via `corepack`):**
- **`corepack pnpm typecheck` e `corepack pnpm build`:** sem erros.
- **`corepack pnpm test`:** **260/260 aprovados** (12 arquivos, com integração no PostgreSQL local via `TEST_DATABASE_URL`, só em bancos temporários). Depois da suíte, 0 bancos `ecorecife_teste_*` restantes, conferidos por uma consulta somente leitura.
  - `gestao-ocorrencias.test.ts`, com banco falso, 76 testes:
    - tabela completa de `proximoStatus`, com as 18 combinações;
    - ids e filtros;
    - as 7 rotas: 401 sem sessão e 403 com perfil fora da lista, sempre sem consultar ocorrências;
    - `Origin` externo (403) antes até da consulta de sessão;
    - SQL só com parâmetros e busca escapada;
    - detalhe sem chave de arquivo;
    - usuário do histórico vindo da sessão, mesmo com `usuarioId` no corpo;
    - 409 com `ROLLBACK`, falha no histórico com `ROLLBACK` e conexão devolvida, e 400 para corpos inválidos;
    - fotos: cabeçalhos, foto de outra ocorrência, chaves maliciosas no banco, arquivo ausente, id inválido e pasta não servida como estática.
  - `gestao-ocorrencias.integracao.test.ts`, com PostgreSQL, 25 testes:
    - listagem com total igual ao do banco e ordem correta;
    - 9 filtros conferidos contra `count(*)` no banco;
    - busca com `%` literal;
    - paginação sem repetição;
    - detalhe sem vazamento (chave, hash, e-mail);
    - seed com 4 etapas;
    - o ciclo completo `recebida → em_analise → equipe_designada → recebida → concluida → em_analise`, com 409 nos passos inválidos e o histórico exato (status, observação, nota e `usuario_id` da sessão);
    - prioridade sem histórico;
    - **rollback real**, com um gatilho que derruba o INSERT do histórico: o status e o `atualizado_em` ficam iguais;
    - PATCH de outro site (403);
    - fotos (bytes, 401, outra ocorrência, inexistente, arquivo apagado);
    - 401 sem sessão, com usuário desativado e depois do logout;
    - **regressão:** a consulta pública segue com os 7 campos e sem observações, nomes ou prioridade.
- **Bug achado pelo PostgreSQL real e corrigido:** o UPDATE de status reusava `$2` como enum e como texto (`inconsistent types deduced`). Agora o "concluindo" vai como um parâmetro booleano à parte. O banco falso não pegava esse caso, o que mostra o valor da integração.
- **Teste de mutação:** sem `exigirPerfil`, 7 testes falham, um por rota. O código foi restaurado, e os 76 voltaram a passar.
- **Não executado:** o `pnpm start` contra o banco de `DATABASE_URL`, porque o acesso ao banco real não foi autorizado. Também não houve teste num navegador, porque o front ainda não consome a API (CP3).

**Testes executados na parte 3 (27/10, Windows 11, Node 24.22, pnpm 12.15 via `corepack`):**
- **Configuração:** o usuário criou o `server/.env` com `TEST_DATABASE_URL` (valores não lidos nem registrados), e os testes de integração passaram a rodar no PostgreSQL local. Eles só criam e apagam bancos temporários `ecorecife_teste_*`, com as travas da parte 2. Uma consulta somente leitura depois da suíte confirmou **0 bancos `ecorecife_teste_*` restantes**.
- **`pnpm typecheck` e `pnpm build`:** sem erros.
- **`pnpm test`:** **159/159 aprovados** (10 arquivos, com integração).
  - `ocorrencias.test.ts`, com banco falso, 49 testes:
    - sucesso com e sem fotos e com exatamente 5 MB;
    - nome e MIME enviados ignorados;
    - campos proibidos descartados;
    - validações dos campos e das coordenadas;
    - categoria e bairro inexistentes;
    - texto como `.jpg`, GIF, arquivo vazio e segunda foto inválida;
    - mais de 5 MB (413), 4 fotos, campo errado, JSON (415) e multipart malformado;
    - falhas na segunda foto, no histórico, no `COMMIT`, no disco e na conexão, sempre sem órfãos;
    - colisão de protocolo;
    - `Origin` externo (403);
    - consulta com campos exatos e sem vazamento, minúsculas, 404, formatos inválidos, banco fora e 429 com contadores separados.
  - `ocorrencias.integracao.test.ts`, com PostgreSQL, 6 testes:
    - registro com 2 fotos, conferindo a linha, o histórico, as fotos e os bytes no disco;
    - a consulta do protocolo criado;
    - o protocolo do seed `ECO-2026-DEMA-9JTU` com 4 etapas;
    - 404 e bairro inexistente;
    - uma falha real na segunda foto, forçada por um gatilho no banco temporário, sem nada gravado nem arquivo restante.
- **Teste de mutação:** sem a limpeza dos arquivos, 2 testes de órfãos falham, o que confirma que eles detectam o problema. O código foi restaurado.
- **Não executado:** o `pnpm start` contra o banco de `DATABASE_URL`, porque o acesso ao banco real não foi autorizado. As rotas foram testadas com supertest e com bancos temporários.

**Testes executados na parte 2 (27/10, Windows 11, Node 24.22, pnpm 12.15 via `corepack`):**
- **Antes de alterar o código:** `typecheck` e `build` passaram, e o `pnpm test` deu 42 aprovados e 10 pulados (sem banco).
- **Depois:** `pnpm typecheck` e `pnpm build` passaram sem erros.
- **`pnpm test` sem banco:** 86 aprovados e 17 pulados (os de integração).
- **`pnpm test` com PostgreSQL 16.15:** **103/103 aprovados**.
  - O banco foi um cluster descartável criado com o `initdb` dos binários já instalados, com dados no scratchpad, porta 55432, só em 127.0.0.1 e autenticação `trust`. Ele foi apagado no fim, e o serviço `postgresql-x64-16` da máquina e os bancos dele não foram acessados.
  - Ao final, nenhum banco `ecorecife_teste_*` restou.
- **Manual no mesmo cluster:**
  - o `instalar.sql` via `psql` aplicou as 4 migrações;
  - o `verificar_restricoes.sql` deu 24/24 OK;
  - num banco em 003 com seed, o `db:status` listou só a `004_sessoes` como pendente, e o `db:migrar` aplicou só ela, preservando os 16 bairros;
  - num banco vazio, o `db:migrar` aplicou as 4, e a segunda execução não fez nada.
- **`pnpm start` contra o cluster:**
  - `GET /api/saude` 200;
  - login inválido 401 com mensagem genérica;
  - login com `Origin` externo 403;
  - `/api/auth/eu` sem cookie 401;
  - logout 204.

**Testes executados na parte 1 (27/10, Windows 11, Node 24.18):**
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
- `criar-admin` interativo, com digitação real da senha oculta: o ambiente não tem terminal interativo, mas a lógica de validação e gravação está testada. O login com um usuário gravado por essa lógica foi testado na parte 2;
- o login pelo navegador, com o front de verdade: o front ainda não chama a API (CP3);
- o comportamento atrás de proxy reverso (`trust proxy`), que fica para a implantação;
- Node 22, pois a máquina tem o 24, e PostgreSQL 14, pois os testes usaram o 16.14 e o 16.15;
- `consultas_teste.sql` não foi rodado na parte 2. Só a migração 004 mudou o banco, e ela não altera as tabelas consultadas;
- tiles do mapa e o passo a passo no Windows real (pendências do CP1).

**Problemas conhecidos (front, a corrigir no CP3):** `#gestao` abre sem login; os dados ainda ficam em `localStorage`/IndexedDB; distâncias e posições são fixas.

**Pendências:**
- **equipe:**
  - adicionar os integrantes ao GitHub;
  - validar os guias `docs/03`, `docs/05` e `docs/06` no Windows, incluindo `pnpm criar-admin` e um login real;
  - aplicar a 004 nos bancos locais já instalados com `pnpm db:migrar` (veja `docs/03`, seção 2);
- **CP2:**
  - **EXIF:** decidir antes da implantação se as fotos terão os metadados removidos no upload (hoje: mantidos, acesso só da gestão logada; `docs/06` §6.7);
  - a "visão por bairro" do protótipo (contagens por bairro) não está no plano do CP2. No CP3, ela pode ser calculada no front com a listagem ou ganhar um endpoint, se a equipe aprovar;
- **ocorrências (parte 3):**
  - não há rotina de limpeza de fotos órfãs se o processo cair entre a gravação e o `COMMIT`;
  - o `POST /api/ocorrencias` não tem limite de envios por IP, porque o plano não prevê um. Vale decidir antes da implantação;
  - o bairro precisa casar com os 16 do seed (acentos inclusive). O CP3 pode precisar de um `GET /api/bairros` para o `<datalist>`, ainda não planejado;
- **implantação:**
  - `trust proxy` para o limite de tentativas;
  - front e API no mesmo site, por causa do `SameSite=Lax` (`docs/06`, seção 6.1);
- **coleta · etapa A:**
  - a equipe deve conferir as 7 rotas no mapa (`docs/03` §5.1) e rodar `pnpm db:seed-rotas` nos bancos locais já instalados;
  - as rotas seguem o perfil "carro" do OSRM, que respeita a mão das ruas. Elas não são o roteiro real de coleta;
  - se o OSRM for consultado de novo, os traçados podem mudar, porque o OSM é atualizado. O arquivo versionado é a referência;
- **guia de reciclagem (parte 5):**
  - não há `GET /api/materiais` nem detalhe público de ponto; o front pode usar os slugs do seed. Se o CP3 precisar, a equipe decide;
  - os 10 pontos seguem demonstrativos; dados oficiais dependem de uma fonte da Prefeitura/Emlurb;
  - as rotas públicas de pontos não têm limite de requisições por IP;
- **documentação:** o `docs/06`, seção 1, ainda cita pnpm 10, mas o `corepack` desta máquina usa o 12.15. Vale a pena alinhar quando a equipe validar o guia.

**Pendências que dependem do usuário:**
- **Desligar a Data API** no painel (Settings → Data API). A segurança já está garantida pela 005 e foi conferida de fora; isto é uma camada extra.
- **Criar o primeiro administrador** no Supabase: `corepack pnpm criar-admin` (interativo). Hoje não há usuários.
- **Pausa do plano Free:** acessar o projeto a cada poucos dias, sobretudo na semana da apresentação (01 a 08/12), e rodar `pnpm db:backup` antes dela.
- **Arquivos para revisar e versionar:** `server/certs/prod-ca-2021.crt` é público e pode ir para o Git. Os backups e o `.env` não podem.
- **Opcional:** apagar a pasta `C:\Program Files\PostgreSQL\16\data` (cluster antigo, 98 MB) quando não quiser mais essa cópia extra; os backups validados ficam em `EcoRecife-backups`.

**Próxima tarefa (aguarda aprovação):** CP3, o front consumindo a API.
- Mapa: `GET /api/rotas` para desenhar os trajetos, e Socket.IO (`coleta:posicoes`) para mover os caminhões, com o rótulo "simulação" (`demonstrativo`). A proximidade é calculada no navegador (D9); status e previsão também ficam no CP3 (D10).
- O front precisa do `socket.io-client` (dependência a justificar no `web/`). O front continua sem acesso direto ao Supabase.
- Ocorrências, protocolo, gestão e guia de reciclagem pelas rotas já prontas.
- **Pendências de implantação:**
  - proxy com WebSocket em `/socket.io/`;
  - uma instância só da API;
  - `trust proxy`;
  - front e API no mesmo site (`SameSite=Lax`);
  - região do Supabase em us-west-2, com ~150–200 ms a mais por consulta a partir do Recife.
