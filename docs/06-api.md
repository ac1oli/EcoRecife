# 06 · API (server/): instalação, comandos e endpoints

Situação atual (CP2, partes 1 a 5, coleta A a D e migração para o Supabase em 10/11/2026): base da API, `GET /api/saude`, migrações e dados no **Supabase**, comando `criar-admin`, login com sessão em cookie, autorização por perfil, proteção contra CSRF, registro público de ocorrências com fotos no **Supabase Storage**, consulta pública por protocolo, gestão de ocorrências (listagem, detalhe, status, conclusão, reabertura, prioridade e fotos protegidas), guia de reciclagem (pontos públicos, mais próximos e cadastro só para `admin`), rotas demonstrativas dos caminhões, leitura pública de veículos e rotas e a simulação da coleta em tempo real por Socket.IO. O front passa a consumir a API no CP3.

Stack: Node.js 22 + TypeScript + Express 5 + `pg` + `zod` + `helmet` + `cors` + `bcryptjs` + `express-rate-limit` + `multer` + `file-type` + `socket.io`. Banco: PostgreSQL 17 do Supabase (plano Free). Testes com vitest + supertest e um PostgreSQL descartável (`embedded-postgres`). Os comandos rodam o TypeScript direto com `tsx`.

## 1. Pré-requisitos

- Node.js 22 e pnpm (via `corepack`): como no [guia do front](05-execucao-local.md), seção 1.
- Acesso ao projeto do Supabase (senha do banco e secret key): [guia do banco](03-banco-de-dados.md), seção 1.
- **Não é preciso instalar PostgreSQL**, nem para rodar a API nem para os testes.

## 2. Instalar e configurar (Windows, PowerShell)

Na pasta do repositório:

```powershell
cd server
corepack pnpm install --frozen-lockfile
Copy-Item .env.example .env
notepad .env
```

Preencha o `.env` como no [guia do banco](03-banco-de-dados.md), seção 1. O certificado da CA do Supabase vai em `server/certs/prod-ca-2021.crt`. O `.env` não é versionado; nunca o envie ao GitHub.

| Variável | Obrigatória | Padrão | Para que serve |
|---|---|---|---|
| `DATABASE_URL` | sim | (nenhum) | Session pooler do Supabase (porta 5432). A API recusa banco local, outro host e o Transaction pooler (6543) |
| `DATABASE_SSL_CA` | não | `certs/prod-ca-2021.crt` | CA do Supabase para verificar o TLS. Parâmetros `ssl*` da URL são ignorados |
| `SUPABASE_URL` | sim (API) | (nenhum) | `https://<id>.supabase.co`, do mesmo projeto do banco |
| `SUPABASE_SECRET_KEY` | sim (API) | (nenhum) | Secret key (`sb_secret_...`) para o Storage das fotos. A publishable key é recusada |
| `SUPABASE_BUCKET_FOTOS` | não | `ocorrencias-fotos` | Bucket privado das fotos (seção 6.12) |
| `PORTA` | não | `3333` | Porta HTTP da API |
| `NODE_ENV` | não | `development` | `development`, `test` ou `production` |
| `CORS_ORIGENS` | não | `http://localhost:5173` | Origens do navegador autorizadas, separadas por vírgula (sem `*`). Também é a lista usada na proteção contra CSRF (seção 6.2) |
| `SESSAO_HORAS` | não | `8` | Duração da sessão de login, de 1 a 168 horas |
| `SIMULACAO_ATIVA` | não | `true` | `false` desliga a simulação da coleta e o Socket.IO inteiro (seção 6.11) |
| `SIMULACAO_INTERVALO_MS` | não | `3000` | Intervalo entre as posições transmitidas, de 1000 a 60000 ms (seção 6.11) |
| `TEST_DATABASE_URL` | não | (nenhum) | Só para os testes, se quiser usar um PostgreSQL de testes próprio (ex.: CI). Sem ela, os testes sobem um descartável (seção 5). Nunca pode ser o Supabase |

Os comandos de banco (`db:*`, `criar-admin`) só precisam de `DATABASE_URL` e do certificado. Com a configuração inválida, a API e os comandos param e dizem qual variável corrigir, sem mostrar a senha.

## 3. Banco: migrações, dados, verificação e backup

Na pasta `server/` (detalhes no [guia do banco](03-banco-de-dados.md)):

```powershell
corepack pnpm db:status          # migrações aplicadas e pendentes (não altera nada)
corepack pnpm db:migrar          # aplica as pendentes de database/migrations (001 a 005)
corepack pnpm db:seed            # só em banco vazio: dados DEMONSTRATIVOS (seeds 001 e 002)
corepack pnpm db:seed-rotas      # só em banco JÁ instalado: as rotas demonstrativas (seed 002)
corepack pnpm db:verificar       # estrutura, RLS, privilégios, funções, órfãos e sequências
corepack pnpm db:backup          # backup dos dados em SQL puro (fora do repositório)
corepack pnpm db:restaurar <arq> # restaura um backup num banco com as tabelas vazias
corepack pnpm storage:preparar   # cria/ajusta o bucket privado das fotos
corepack pnpm storage:verificar  # testa o bucket e compara as fotos do banco com o Storage
corepack pnpm criar-admin        # cria o primeiro administrador (interativo)
```

Cada comando mostra antes o projeto Supabase em uso (`[db] Supabase · projeto <id> (development)`), para não haver dúvida de qual banco está sendo alterado.

Regras de segurança do executor de migrações (`server/src/banco/migrador.ts`):

- nunca apaga nem recria nada: só aplica migrações ainda não registradas, em ordem;
- antes de conectar, valida os arquivos: nome `NNN_descricao.sql`, um único `BEGIN;`/`COMMIT;`, autorregistro em `schema_migrations` e nenhum comando do psql;
- recusa, sem alterar nada:
  - banco que não é UTF8;
  - banco com tabelas mas sem `schema_migrations`;
  - banco com migração registrada que não existe no repositório;
  - migração nova numerada antes da última aplicada;
- cada arquivo é uma transação: se um falhar, ele é desfeito por inteiro e os anteriores continuam aplicados;
- uma trava consultiva de sessão impede duas execuções ao mesmo tempo (por isso o Session pooler);
- `db:seed` só roda com todas as migrações aplicadas e o banco sem dados, então não duplica registros. Num banco novo, ele aplica os seeds 001 e 002 (rotas);
- `db:seed-rotas` aplica só o seed 002 num banco que já tem os dados do 001. Pode ser repetido: se as 7 rotas estiverem iguais ao arquivo, não faz nada. Para com erro, sem gravar, se encontrar carga parcial, rota demonstrativa alterada, veículo com outra rota ou veículo ausente ([03-banco-de-dados.md](03-banco-de-dados.md), seção 5.1).

**`db:verificar`** (`server/src/banco/verificacao.ts`, só leituras) confere:
- TLS com certificado verificado e as migrações;
- as 14 tabelas, todas com RLS e nenhuma policy;
- nenhum privilégio de `anon`, `authenticated` e `service_role`;
- funções com `search_path` fixo;
- zero órfãos nas 12 chaves estrangeiras e sequências à frente do maior id.

Há duas opções: `--restricoes` roda os 24 casos de `database/queries/verificar_restricoes.sql` numa transação desfeita, e `--data-api` testa a Data API de fora com a publishable key, lida da variável `SUPABASE_PUBLISHABLE_KEY` só nessa execução.

**Nova migração:** crie `database/migrations/006_descricao.sql` com `BEGIN;` no início, `INSERT INTO schema_migrations (versao) VALUES ('006_descricao');` antes do `COMMIT;` e `COMMIT;` no final. Rode `pnpm test`, que a aplica no PostgreSQL descartável, antes de `pnpm db:migrar` no Supabase. Tabelas novas já nascem sem privilégios para a Data API (privilégios padrão da 005); ligue a RLS nelas na própria migração.

### `pnpm criar-admin`

- Pede nome, e-mail, senha e confirmação. A senha não aparece na tela.
- Exige uma senha de pelo menos 12 caracteres e até 72 bytes (limite do bcrypt). A senha não pode ser repetitiva nem conter o e-mail.
- Grava só o hash bcrypt (custo 12), com perfil `admin`.
- Não aceita senha por argumento nem por variável de ambiente, para que ela não fique no histórico do terminal.
- Recusa e-mail já cadastrado (sem diferenciar maiúsculas). Se já houver administrador, pede confirmação antes de criar outro.
- Precisa de um terminal interativo: PowerShell, Prompt de Comando ou Windows Terminal. No terminal do Git Bash (mintty), ele recusa e explica o motivo.

## 4. Rodar a API

```powershell
corepack pnpm dev     # recarrega ao salvar os arquivos
```

Esperado:

```
[api] EcoRecife ouvindo em http://localhost:3333 (development)
[db] banco oficial: Supabase · projeto <id> (TLS verificado)
[fotos] Supabase Storage (projeto <id>, bucket privado ocorrencias-fotos)
[coleta] simulação DEMONSTRATIVA ativa: 7 veículo(s), a cada 3000 ms
```

Se o bucket estiver fora do padrão (público, sem limite ou com outros tipos), aparece `[fotos] aviso: ...`. `Ctrl+C` encerra: para a simulação, desconecta os sockets e fecha o pool. Teste em outro terminal:

```powershell
Invoke-RestMethod http://localhost:3333/api/saude
```

| Comando (na pasta `server/`) | Para que serve |
|---|---|
| `pnpm dev` | API com recarga automática |
| `pnpm start` | API sem recarga |
| `pnpm typecheck` | Verifica os tipos (esperado: nenhuma saída) |
| `pnpm build` | Compila para `server/dist/` (confere que o código compila) |
| `pnpm test` | Testes automatizados (seção 5) |
| `pnpm db:*`, `pnpm storage:*` | Banco, backup e Storage (seção 3) |
| `pnpm criar-admin` | Cria administrador (seção 3) |

## 5. Testes

```powershell
corepack pnpm test
```

Os testes **nunca usam o Supabase**. Os de integração rodam num PostgreSQL 17 **descartável**, que o `globalSetup` do Vitest (`server/test/apoio/postgres-de-teste.ts`) sobe com o pacote `embedded-postgres`. É uma dependência só de desenvolvimento: os binários ficam no `node_modules`, sem serviço nem instalação. Ele escuta só em `127.0.0.1`, numa porta livre, com senha aleatória, e guarda os dados numa pasta temporária, apagada no fim. Com `TEST_DATABASE_URL` definida (ex.: um contêiner de CI), a suíte usa essa URL. A primeira execução pode levar alguns segundos a mais. `PG_TESTE_LOG=<arquivo>` grava o log do PostgreSQL de teste, para diagnóstico.

- **Sem banco (banco falso ou fetch falso):**
  - configuração e aplicação HTTP;
  - validação das migrações e administrador;
  - travas do banco de teste;
  - autenticação, autorização e CSRF;
  - ocorrências, gestão e reciclagem;
  - veículos e rotas e o motor da simulação;
  - Socket.IO;
  - Storage do Supabase (`armazenamento-supabase.test.ts`, com `fetch` falso, sem rede).
- **Com o PostgreSQL descartável:**
  - migrações, seeds e `db:seed-rotas`;
  - login e sessões, ocorrências com fotos (gravadas em disco numa pasta temporária) e gestão;
  - guia de reciclagem, veículos, rotas e Socket.IO com as 7 rotas;
  - **segurança da migração 005** (`seguranca.integracao.test.ts`): papéis `anon`, `authenticated` e `service_role` com os privilégios padrão do Supabase, nenhum acesso depois das migrações, e o `db:verificar` acusando cada falha;
  - **backup e restauração** (`backup.integracao.test.ts`).
- **Travas do banco de teste** (`server/test/apoio/banco-temporario.ts`): `TEST_DATABASE_URL` só é usada para `CREATE DATABASE`/`DROP DATABASE` de bancos criados pelo próprio teste. Os testes recusam:
  - `NODE_ENV=production`;
  - **qualquer host do Supabase** (`*.supabase.co`, `*.supabase.com`);
  - `TEST_DATABASE_URL` apontando para o mesmo banco de `DATABASE_URL`;
  - criar ou apagar um nome fora do padrão `ecorecife_teste_<8 hex>`;
  - seguir adiante se `current_database()` não for o banco temporário.

## 6. Endpoints

| Método e rota | Acesso | Resposta |
|---|---|---|
| `GET /api/saude` | público | `200 {"status":"ok","banco":"conectado","horario":"..."}`; `503 {"status":"erro","banco":"indisponivel",...}` se o banco não responder |
| `POST /api/auth/login` | público, com limite de tentativas | Corpo `{"email","senha"}`. `200 {"usuario":{id,nome,email,perfil},"expiraEm":"..."}` e cookie de sessão; `400` corpo inválido; `401 {"erro":"E-mail ou senha inválidos"}`; `429` excesso de tentativas |
| `GET /api/auth/eu` | sessão | `200 {"usuario":{id,nome,email,perfil}}`; `401` sem sessão válida |
| `POST /api/auth/logout` | público (idempotente) | `204`; apaga a sessão no banco, se houver, e limpa o cookie |
| `POST /api/ocorrencias` | público (cidadão anônimo) | `multipart/form-data` (seção 6.5). `201 {"protocolo","status":"recebida","criadoEm"}` com cabeçalho `Location`; `400` dados ou fotos inválidos; `413` foto com mais de 5 MB; `415` sem multipart |
| `GET /api/ocorrencias/protocolo/:protocolo` | público, com limite de tentativas | `200` com os campos públicos (seção 6.6); `400` formato inválido; `404 {"erro":"Protocolo não encontrado"}`; `429` excesso de consultas sem sucesso |
| `GET /api/ocorrencias`, `GET /api/ocorrencias/:id` | sessão + `admin`/`gestor` | Listagem paginada com filtros e detalhe (seção 6.7) |
| `PATCH /api/ocorrencias/:id/status`, `POST .../concluir`, `POST .../reabrir`, `PATCH .../prioridade` | sessão + `admin`/`gestor` | Mudanças com transições validadas e histórico (seção 6.7) |
| `GET /api/ocorrencias/:id/fotos/:fotoId` | sessão + `admin`/`gestor` | A imagem (seção 6.7) |
| `GET /api/pontos`, `GET /api/pontos/proximos` | público | Pontos ativos do guia e os mais próximos de uma posição (seção 6.8) |
| `GET /api/pontos/gestao`, `GET /api/pontos/:id`, `POST /api/pontos`, `PATCH /api/pontos/:id`, `DELETE /api/pontos/:id` | sessão + `admin` | Cadastro e gestão dos pontos; o `DELETE` desativa (seção 6.8) |
| `GET /api/veiculos`, `GET /api/rotas` | público | Veículos e rotas ativos da coleta, todos demonstrativos (seção 6.9) |
| Socket.IO em `/socket.io/`, evento `coleta:posicoes` | público, só leitura, origem conferida | Posições demonstrativas dos caminhões a cada `SIMULACAO_INTERVALO_MS` (seção 6.11) |

Erros são sempre JSON (`{"erro": "..."}`), sem detalhes internos: `404` para rota inexistente, `400` para JSON malformado ou corpo maior que 100 kB, `500` genérico (o detalhe só vai para o log do servidor). As respostas de `/api/auth` levam `Cache-Control: no-store`.

### 6.1 Sessão e cookie

- **Token:** o login gera um token aleatório de 32 bytes (`crypto.randomBytes`). O navegador recebe o token, e a tabela `sessoes` (migração 004) guarda só o SHA-256 dele. Quem ler o banco não consegue usar as sessões.
- **Cookie:**
  - `HttpOnly`, `SameSite=Lax`, `Path=/` e `Max-Age` = `SESSAO_HORAS`;
  - em `production`, também `Secure`, com o nome `__Host-eco_sessao`, aceito pelo navegador só via HTTPS e sem `Domain`;
  - em desenvolvimento e testes, o nome é `eco_sessao`, sem `Secure`, porque a API roda em `http://localhost`.
- **Validade:** a sessão vale até `expira_em`, um prazo fixo, sem renovação a cada uso. A cada requisição, a API confere a sessão no banco, e ela deixa de valer:
  - no logout, que apaga a linha;
  - quando expira;
  - quando o usuário é desativado (`ativo = false`) ou excluído, o que apaga as sessões em cascata;
  - quando há um novo login no mesmo navegador, que troca o token.
- **Limpeza:** as sessões expiradas são apagadas a cada login bem-sucedido.
- **Login:**
  - a mensagem é a mesma para e-mail inexistente, senha errada e usuário inativo;
  - quando o e-mail não existe, o bcrypt roda mesmo assim, contra um hash fictício, para que o tempo de resposta não revele quais e-mails estão cadastrados;
  - o login atualiza `usuarios.ultimo_login_em`.
- **Front em outro domínio:** com `SameSite=Lax`, o navegador só envia o cookie quando o front e a API estão no mesmo "site". Em desenvolvimento, `localhost:5173` e `localhost:3333` são o mesmo site. Na implantação (dezembro), o front e a API precisam ficar no mesmo domínio, ou o front encaminha `/api` para a API. Essa decisão fica para a fase de implantação.

### 6.2 Proteção contra CSRF (`server/src/origem.ts`)

Vale para toda requisição `POST`, `PUT`, `PATCH` e `DELETE`, inclusive nas rotas públicas:
- com o cabeçalho `Origin`, que todo navegador atual envia nesses métodos, a origem precisa estar em `CORS_ORIGENS`. `Origin: null` é recusado;
- sem `Origin`, a requisição é recusada se trouxer `Sec-Fetch-Site: cross-site`;
- a recusa é `403 {"erro":"Origem da requisição não permitida"}`, antes de qualquer acesso ao banco;
- clientes fora do navegador (curl, testes), que não enviam esses cabeçalhos, passam. Eles não carregam o cookie de ninguém, que é o que um ataque CSRF explora.

O `SameSite=Lax` do cookie é a primeira barreira, e essa verificação é a segunda. `GET` não passa por ela, então nenhuma rota `GET` pode alterar dados.

### 6.3 Limite de tentativas (login e consulta de protocolo)

- **Regra:** 10 tentativas **malsucedidas** por IP a cada 15 minutos (`express-rate-limit`, regra comum em `server/src/limite.ts`). Só as respostas de erro contam: login recusado ou protocolo inválido ou inexistente. Ao passar do limite, a API responde `429`, com os cabeçalhos `RateLimit-*`, mesmo que o pedido seguinte esteja certo:
  - no login: `{"erro":"Muitas tentativas de login. Tente novamente em alguns minutos."}`;
  - na consulta: `{"erro":"Muitas consultas de protocolo sem sucesso. Tente novamente em alguns minutos."}`.
- **Contadores separados:** o login e a consulta de protocolo têm contadores independentes. Com 32^8 combinações de protocolo por ano, 10 erros a cada 15 minutos inviabilizam a varredura sem atrapalhar o cidadão que digitou errado.
- **Limitação:** a contagem fica **na memória do processo**. Ela **zera quando a API reinicia** e não é compartilhada entre instâncias. Isso basta para uma única instância, que é o caso do projeto. Com várias instâncias, seria preciso um armazenamento compartilhado.
- **Atrás de proxy:** atrás de um proxy reverso, na implantação, o IP visto pela API seria o do proxy. Nesse caso, é preciso configurar o `trust proxy` do Express (pendência da implantação).

### 6.4 Autorização por perfil

```ts
router.patch('/:id', exigirSessao(banco, config.ambiente), exigirPerfil('admin', 'gestor'), handler);
```

- `exigirSessao` responde `401` sem sessão válida e coloca o usuário em `res.locals.usuario`.
- `exigirPerfil` responde `403` quando o perfil não está na lista.
- Cada endpoint protegido precisa dos dois middlewares. Esconder a tela no front não protege nada.

### 6.5 Registro de ocorrência (`POST /api/ocorrencias`)

Formulário `multipart/form-data`, sem login:

| Campo | Obrigatório | Regra |
|---|---|---|
| `categoria` | sim | Slug de uma categoria ativa (`descarte`, `lixeira`, `entulho` nos dados atuais), como no `<select>` do front |
| `bairro` | sim | Nome de um bairro cadastrado, sem diferenciar maiúsculas (`boa viagem` = `Boa Viagem`); até 80 caracteres |
| `endereco` | sim | Endereço ou ponto de referência, até 200 caracteres |
| `descricao` | sim | Até 1000 caracteres |
| `latitude`, `longitude` | não | Juntas; de -90 a 90 e de -180 a 180 |
| `origemLocalizacao` | com coordenadas | `gps` ou `manual`; obrigatória com coordenadas e proibida sem elas |
| `precisaoMetros` | não | ≥ 0; só com coordenadas |
| `fotos` | não | Até 3 arquivos, de até 5 MB cada, JPEG, PNG ou WebP |

- **Validação:** zod, com as mesmas regras dos `CHECK`s da tabela `ocorrencias`. A resposta de erro traz a primeira mensagem (`{"erro":"Informe a descrição"}`). Os campos vazios contam como não informados.
- **Campos ignorados:** os que o cidadão não pode definir (`status`, `prioridade`, `demonstrativo`, `protocolo`...) são descartados. O banco aplica `recebida`, `media` e `demonstrativo = false`.
- **Fotos:**
  - o multer guarda o upload **em memória**, então nada vai ao disco antes da validação;
  - o tipo é detectado **pelo conteúdo** (`file-type`); o nome, a extensão e o MIME enviados são ignorados;
  - arquivo vazio, GIF ou texto com nome `.jpg` são recusados;
  - os limites do multer são 3 arquivos, 5 MB por arquivo, até 12 campos, 8 KB por campo e 15 partes;
  - os arquivos só são aceitos no campo `fotos`.
- **Armazenamento:**
  - os arquivos vão para o **Supabase Storage**, no bucket privado (seção 6.12), com a chave `ocorrencias/<uuid>.<jpg|png|webp>` gerada pela API e a extensão do tipo detectado;
  - o envio usa `x-upsert: false` e nunca sobrescreve;
  - a `ocorrencia_fotos` guarda só a chave (`ocorrencias/<uuid>.<ext>`), o MIME detectado, o tamanho e a ordem (1–3).
- **Transação:** a ocorrência, a primeira linha do histórico (`NULL → recebida`, sem usuário) e as fotos são gravadas numa só transação.
  - Se algo falhar (banco, Storage ou `COMMIT`), a API faz `ROLLBACK` e **apaga os arquivos já enviados**, então não ficam arquivos órfãos nem registros pela metade.
  - O protocolo vem de `gerar_protocolo()`, o padrão da coluna. Numa colisão (improvável), a transação é refeita até 3 vezes.
- **Resposta:** `201 {"protocolo":"ECO-2026-XXXX-XXXX","status":"recebida","criadoEm":"..."}`, sem id interno.
- **CSRF:** passa pela verificação de `Origin` (seção 6.2): um formulário enviado de outro site é recusado com `403` antes de o upload ser lido.
- **Limitações:**
  - se o processo da API cair entre a gravação de um arquivo e o `COMMIT`, o arquivo fica órfão. Ainda não há rotina de limpeza que compare a pasta com o banco;
  - as fotos são guardadas como foram enviadas, **com os metadados EXIF** (que podem trazer a localização do celular). Elas não aparecem na consulta pública e só são servidas à gestão logada (decisão na seção 6.7);
  - o registro não tem limite de envios por IP, porque o plano não prevê um (veja as pendências no `CONTINUIDADE.md`).

### 6.6 Consulta pública por protocolo (`GET /api/ocorrencias/protocolo/:protocolo`)

Sem login. O protocolo é aceito em minúsculas e com espaços nas pontas. O formato é conferido antes de qualquer consulta ao banco.

```json
{
  "protocolo": "ECO-2026-DEMA-9JTU",
  "categoria": "Descarte irregular",
  "bairro": "Boa Viagem",
  "status": "concluida",
  "criadoEm": "2026-10-27T12:00:00.000Z",
  "concluidoEm": "2026-10-27T14:00:00.000Z",
  "linhaDoTempo": [
    { "statusAnterior": null, "status": "recebida", "em": "2026-10-27T12:00:00.000Z" }
  ]
}
```

- **Campos expostos:** exatamente os do [docs/02](02-modelagem-banco.md), seção 4, e das consultas 5–6 de `consultas_teste.sql`. A resposta é montada campo a campo, com uma lista do que é permitido.
- **Fora da resposta:** descrição, endereço, coordenadas, fotos, prioridade, nota de conclusão, observações do histórico, ids e usuários.
- **Status:** o valor é o do banco (`em_analise`...). A tradução para a interface está no `docs/02`, seção 6.
- **Cache:** a resposta leva `Cache-Control: no-store`.

### 6.7 Gestão de ocorrências (perfis `admin` e `gestor`)

Todas as rotas abaixo passam por `exigirSessao` e `exigirPerfil('admin', 'gestor')` (`server/src/rotas/gestao-ocorrencias.ts`). Sem sessão, a resposta é `401`; com um perfil fora da lista, `403`. A recusa acontece antes de qualquer consulta de ocorrência. Nenhum documento do projeto restringe essas ações a um perfil só, então os dois perfis têm o mesmo acesso. As respostas levam `Cache-Control: private, no-store`.

| Método e rota | Corpo / parâmetros | Resposta |
|---|---|---|
| `GET /api/ocorrencias` | `fila` (`ativas`/`concluidas`), `status`, `prioridade`, `categoria` (slug), `bairro` (nome, sem diferenciar maiúsculas), `busca` (até 100 caracteres), `pagina` (≥ 1, padrão 1), `porPagina` (1–50, padrão 20) | `200 {"itens":[...],"pagina","porPagina","total","totalPaginas"}`, da mais recente para a mais antiga; `400` filtro inválido |
| `GET /api/ocorrencias/:id` | — | `200` com o detalhe; `404` |
| `PATCH /api/ocorrencias/:id/status` | `{"status":"recebida"\|"em_analise"\|"equipe_designada","observacao"?}` | `200` com o detalhe atualizado; `409` transição não permitida; `400`; `404` |
| `POST /api/ocorrencias/:id/concluir` | `{"nota"?}` (até 500) | `200`; `409` se já estiver concluída |
| `POST /api/ocorrencias/:id/reabrir` | `{"observacao"?}` (até 500) | `200` (volta para `em_analise`); `409` se não estiver concluída |
| `PATCH /api/ocorrencias/:id/prioridade` | `{"prioridade":"urgente"\|"alta"\|"media"\|"baixa"}` | `200`; sem linha no histórico |
| `GET /api/ocorrencias/:id/fotos/:fotoId` | — | `200` com a imagem; `404` se a foto não existir, não for dessa ocorrência ou faltar no disco |

- **Item da listagem:** `id`, `protocolo`, `categoria {slug, nome}`, `bairro`, `endereco`, `descricao`, `status`, `prioridade`, `criadoEm`, `atualizadoEm`, `concluidoEm`, `demonstrativo` e `quantidadeFotos`.
- **Busca:** é literal (`%` e `_` são escapados) e procura nos mesmos campos do protótipo: protocolo, tipo, bairro e endereço.
- **Detalhe:** os campos do item mais `latitude`, `longitude`, `origemLocalizacao`, `precisaoMetros`, `notaConclusao` e mais:
  - `fotos[]`: `id`, `ordem`, `tipoMime`, `tamanhoBytes` e `url` da rota protegida. A chave de armazenamento nunca sai da API;
  - `historico[]`: `statusAnterior`, `status`, `observacao`, `responsavel` e `em`. Do usuário sai só o nome, sem e-mail nem perfil. `null` indica um registro do cidadão ou um usuário que foi excluído depois.
- **Ids da URL:** só inteiros positivos (ocorrência) e UUID (foto). Qualquer outra coisa responde `404` sem consultar o banco.

**Transições** ([docs/02](02-modelagem-banco.md), seção 3, e o `<select>` da gestão no protótipo):

| De | Para | Rota |
|---|---|---|
| `recebida`, `em_analise`, `equipe_designada` | qualquer outro estado ativo (avançar ou corrigir) | `PATCH /status` |
| qualquer estado ativo | `concluida` (grava `concluido_em` e a nota) | `POST /concluir` |
| `concluida` | `em_analise` (limpa `concluido_em` e `nota_conclusao`) | `POST /reabrir` |

Recusas com `409`:
- o status igual ao atual;
- qualquer mudança em uma ocorrência concluída que não seja a reabertura;
- concluir de novo;
- reabrir uma ocorrência ativa.

`concluida` não é aceita no `PATCH /status`, que responde `400`, porque a conclusão tem rota própria.

**Histórico e consistência:**
- cada troca de status grava, **na mesma transação**, uma linha em `ocorrencia_historico` com o status anterior, o novo, a observação (na conclusão, a nota) e o `usuario_id` **da sessão**. Um id enviado no corpo é ignorado;
- a linha da ocorrência fica travada (`SELECT ... FOR UPDATE`) entre a leitura do status atual e a gravação, então duas mudanças simultâneas não validam contra um estado desatualizado;
- qualquer falha desfaz tudo (`ROLLBACK`; helper `emTransacao` em `server/src/db.ts`);
- a mudança de prioridade não gera histórico, porque o histórico registra só trocas de status (`CHECK historico_muda_status`).

**Fotos:**
- não existe URL pública: o bucket é privado e a URL pública do Storage responde erro (seção 6.12);
- a rota protegida só encontra a foto se ela pertencer à ocorrência da URL. Ela confere se a chave vinda do banco tem o formato exato `ocorrencias/<uuid>.<ext>` antes de pedir o arquivo ao Storage (com a secret key, só no servidor) e o repassa ao navegador;
- a resposta leva o `Content-Type` gravado, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` (helmet) e `Cross-Origin-Resource-Policy: same-site`. Esse último cabeçalho permite que o front, em outra porta do mesmo site, exiba a foto num `<img>` com o cookie.

**Metadados EXIF (decisão):**
- **o que foi decidido:** as fotos são guardadas e entregues **como foram enviadas**, com EXIF. A proteção é de acesso: elas não aparecem na consulta pública e só saem para `admin`/`gestor` logados, sem cache;
- **motivo:** remover o EXIF exige decodificar e recodificar a imagem, o que pede uma dependência nativa como o `sharp` ou um parser próprio para JPEG/PNG/WebP. As duas opções ampliam o escopo e o risco desta etapa;
- **risco que fica:** um gestor que baixar a foto recebe a localização do celular, se ela existir no arquivo. O cidadão já informa o endereço e, opcionalmente, as coordenadas, que a gestão vê de qualquer forma;
- **antes da implantação:** a equipe deve decidir se remove o EXIF no upload (registrado como pendência).

### 6.8 Guia de reciclagem (`/api/pontos`)

Tabelas `pontos_descarte`, `materiais` e `ponto_materiais` (migração 002), em `server/src/pontos/pontos.ts` e `server/src/rotas/pontos.ts`. Sem migração nova.

**Rotas públicas** (sem login, só pontos com `ativo = true`):
- `GET /api/pontos?tipo=&material=`: lista na ordem da consulta 4 de `consultas_teste.sql` (tipo e nome). `tipo` é `ecoponto`, `pev` ou `cooperativa`; `material` é o slug (`reciclaveis`, `eletronicos`, `oleo_vegetal`, `entulho`, `volumosos`, `pilhas_baterias`). Material inexistente devolve a lista vazia; tipo fora da lista, `400`;
- `GET /api/pontos/proximos?lat=&lng=&limite=&tipo=&material=`: os pontos mais próximos pela função `distancia_km` (Haversine, sem PostGIS), como nas consultas 2 e 3. `lat` e `lng` são obrigatórias (`400 Informe lat e lng`); `limite` vai de 1 a 10, com padrão 3. A ordem usa a distância exata, e `distanciaKm` sai com 2 casas. A resposta leva `Cache-Control: private, no-store`, porque a URL contém a posição do cidadão.

Resposta: `{"itens": [...]}`. Cada item tem `id`, `tipo`, `nome`, `bairro`, `endereco`, `latitude`, `longitude`, `horarioFuncionamento`, `situacao`, `telefone`, `email`, `site`, `materiais` (`[{slug, nome}]`), `demonstrativo`, `fonte` e `verificadoEm` (`AAAA-MM-DD`), mais `distanciaKm` nos próximos. `ativo` e as datas internas não saem na área pública. Os 10 pontos do seed são demonstrativos.

**Rotas do admin** (`exigirSessao` + `exigirPerfil('admin')`; `gestor` recebe `403`, sem sessão `401`, antes de qualquer consulta de ponto; respostas com `Cache-Control: private, no-store`):
- `GET /api/pontos/gestao?ativo=&tipo=&material=`: todos os pontos, inclusive os inativos, com `ativo`, `criadoEm` e `atualizadoEm`;
- `GET /api/pontos/:id`: o mesmo formato, para um ponto;
- `POST /api/pontos`: corpo JSON com `tipo`, `nome` (até 120), `bairro` (nome de um bairro cadastrado), `latitude` e `longitude` (números), e opcionais `endereco` (200), `horarioFuncionamento` (120), `situacao` (80), `telefone` (8 a 20 caracteres: dígitos, espaço, `+ ( ) -`), `email`, `site` (só `http://` ou `https://`), `demonstrativo` (padrão `true`), `fonte` (500), `verificadoEm` (`AAAA-MM-DD`) e `materiais` (lista de slugs, até 20, repetidos ignorados). Responde `201` com `Location` e o ponto;
- `PATCH /api/pontos/:id`: os mesmos campos, todos opcionais, mais `ativo` (reativar). Só os campos enviados mudam; `null` ou `""` limpa um campo opcional; `materiais` troca a lista inteira;
- `DELETE /api/pontos/:id`: **desativa** (`ativo = false`) e responde `204`, mesmo se o ponto já estava inativo. O ponto some do guia e dos próximos, mas continua no banco e volta com `PATCH {"ativo": true}`.

**Regras e erros:**
- dado não demonstrativo exige `fonte`, como no CHECK `pontos_fonte_obrigatoria`. No `PATCH`, a regra é conferida contra o estado final (corpo + valores gravados), com a linha travada (`FOR UPDATE`);
- cadastro e edição rodam numa transação (`emTransacao`): ponto, bairro e materiais entram juntos ou nada entra;
- `400` para dados inválidos, bairro não encontrado ou material desconhecido (`Material inválido: <slug>`); `404` para ponto inexistente ou id inválido; `409` para nome repetido no mesmo tipo (`UNIQUE (tipo, nome)`);
- campos fora da lista (como `id`, `bairro_id` ou `ativo` no `POST`) são ignorados; as colunas do `UPDATE` vêm de uma lista fixa no código, e todos os valores vão como parâmetros.

**Dúvidas registradas (não definidas nos documentos) e decisões seguras:**
- "excluir" desativa em vez de apagar, porque é reversível e nenhum documento pede exclusão física;
- `limite` máximo de 10 nos próximos;
- não há rota pública de detalhe nem lista de materiais (`GET /api/materiais`); o front pode montar os filtros com os slugs acima. Se o CP3 precisar, a equipe decide.

### 6.9 Coleta: veículos e rotas (`/api/veiculos`, `/api/rotas`)

Leitura pública, sem sessão, em `server/src/coleta/coleta.ts` e `server/src/rotas/coleta.ts`. **Todos os dados são demonstrativos:** os veículos são simulados e as rotas vêm do seed 002 (OpenStreetMap via OSRM, [03-banco-de-dados.md](03-banco-de-dados.md), seção 5.1). Não há integração com a frota, e cada item traz `demonstrativo` para o front exibir o rótulo de simulação. Não existe cadastro, edição ou exclusão pela API.

- `GET /api/veiculos`: `{"itens": [{codigo, descricao, tipoColeta, bairro, demonstrativo}]}`. Só veículos com `ativo = true`, em ordem de `codigo`. `tipoColeta` é `domiciliar` ou `seletiva`; `bairro` é o nome (ou `null`). O veículo é identificado pelo `codigo`, e o id interno não sai.
- `GET /api/rotas`: `{"itens": [{id, nome, demonstrativo, veiculo, pontos}]}`. Só rotas com `ativa = true`, em ordem de `nome`:
  - `veiculo` tem os mesmos campos de `/api/veiculos`, ou é `null` se a rota não tem veículo ou se o veículo está inativo (um veículo inativo nunca aparece);
  - `pontos` é o trajeto `[{ordem, latitude, longitude}]` em ordem crescente, ou `[]`.
  Com os seeds, são 7 rotas e 1.178 pontos.

**Decisões registradas (não definidas nos documentos):**
- não há filtros nem paginação, porque nenhum documento os define e são só 7 veículos e 7 rotas; o front filtra localmente. Parâmetros na URL são ignorados;
- não há rota de detalhe (`/api/rotas/:id`). O `id` da rota vai na resposta para as próximas etapas.

Os campos `ativo`/`ativa`, `veiculo_id` e `bairro_id` não saem. As consultas não recebem valores da requisição; o filtro de ativos está no próprio SQL.

### 6.10 Coleta: motor da simulação (`server/src/coleta/simulador.ts`)

**O motor não é um endpoint:** quem o liga ao servidor e transmite as posições é o Socket.IO (seção 6.11). O módulo não acessa banco nem rede e não tem dependência; ele recebe as rotas no formato de `GET /api/rotas` (seção 6.9) e guarda as posições só na memória (D8). As posições são **demonstrativas** (`demonstrativo: true`) e não vêm da frota.

- **Preparação:** só rotas com veículo. Pontos com coordenada inválida (não numérica, `NaN`, fora de ±90/±180) ou `ordem` inválida são descartados, e repetidos consecutivos são unidos. Uma rota que fica com menos de 2 pontos é ignorada, assim como uma segunda rota do mesmo veículo. As demais seguem; as ignoradas saem em `ignoradas` (`sem_veiculo`, `pontos_insuficientes` ou `veiculo_repetido`).
- **Movimento (D7):** cada veículo começa no ponto 1 e anda a velocidade constante pelo trajeto, medido por Haversine (o mesmo raio de `distancia_km`). Dentro de cada segmento, a posição é interpolada entre os dois pontos, então a cada passo o caminhão anda no máximo a distância do passo, sem saltos.
- **Fim do trajeto:** recomeça do início, levando o que sobrou do passo, e soma 1 em `volta`. As 7 rotas do seed 002 são circuitos fechados (o último ponto é o primeiro), então a virada é contínua. Numa rota aberta, a volta 1 recomeça no ponto 1; o `volta` indica essa virada.
- **Relógio:** `criarSimulador(rotas, {intervaloMs, velocidadeKmh, aoAvancar})` usa um `setInterval`. Cada passo vale exatamente um intervalo, então atrasos do relógio não mudam o resultado. `iniciar()` não cria um segundo relógio se já estiver rodando; `parar()` interrompe; `posicoes()` dá o retrato atual.
- **Posição:** `{codigo, rotaId, latitude, longitude, volta, demonstrativo: true}`.

**Valores (decisões registradas):**

| Parâmetro | Padrão | Faixa aceita | Origem |
|---|---|---|---|
| `intervaloMs` | `3000` | 1000 a 60000 (inteiro) | D7 (3 s) |
| `velocidadeKmh` | `20` | maior que 0 e até 80 | Valor demonstrativo de caminhão em rua de bairro, não é dado oficial. Com 20 km/h, cada passo de 3 s anda ≈ 16,7 m e uma volta de 4,2 a 6,2 km leva de 13 a 19 min |

Fora da faixa, `criarSimulador` lança `RangeError`.

O intervalo vem de `SIMULACAO_INTERVALO_MS` (seção 6.11). A velocidade fica constante no código.

### 6.11 Coleta em tempo real (Socket.IO)

Em `server/src/coleta/tempo-real.ts`, ligado pelo `server.ts` depois que a porta abre. Dependência: `socket.io` 4.8.4 (o `socket.io-client` 4.8.4 entra só como dependência de desenvolvimento, nos testes). **As posições são demonstrativas:** não há integração com a frota.

- **Ao subir:** lê as rotas ativas uma vez, pela mesma consulta de `GET /api/rotas`, inicia o motor (seção 6.10) e registra no log quantos veículos estão na simulação e quais rotas foram ignoradas. Uma rota nova ou alterada só entra ao reiniciar a API.
- **Conexão:** caminho padrão `/socket.io/`, sem login (D4/D6). Quem conecta recebe na hora o retrato atual; depois, todos recebem a cada `SIMULACAO_INTERVALO_MS`.
- **Evento `coleta:posicoes`** (só do servidor para o cliente): `{"demonstrativo": true, "intervaloMs": 3000, "posicoes": [{codigo, rotaId, latitude, longitude, volta, demonstrativo: true}]}`. O `codigo` é o de `GET /api/veiculos`, e o `rotaId`, o `id` de `GET /api/rotas`. O front pode usar `intervaloMs` para animar entre duas posições, e o `volta` para não animar a virada de uma rota aberta.
- **Exemplo no navegador (CP3):** `io('http://localhost:3333').on('coleta:posicoes', (m) => ...)`.

**Segurança:**
- **Só leitura:** o servidor não trata nenhuma mensagem do cliente, então nenhum cliente para, acelera ou altera a simulação, e nada que um cliente envia chega aos outros. Mensagem acima de 1 kB derruba a conexão (`maxHttpBufferSize`).
- **Origem:** o handshake (polling e WebSocket) confere o `Origin` contra `CORS_ORIGENS` e recusa os demais, inclusive `null`. O CORS do navegador não protege WebSocket, por isso a conferência fica no servidor. Sem `Origin` (cliente fora do navegador, ou o polling do próprio site, que o navegador envia sem `Origin`), segue, como na API HTTP. Os cabeçalhos CORS saem só para as origens permitidas e sem `credentials`: o Socket.IO não usa o cookie de sessão.
- **Sem o arquivo do cliente:** `serveClient: false`; o front usa o `socket.io-client` do próprio build.
- **Dados:** só as posições; nenhum id interno, trajeto completo ou dado do banco.

**Comportamento:**
- **`SIMULACAO_ATIVA=false`:** não há consulta nem relógio, e `/socket.io/` responde `404`. O log diz `simulação desligada`.
- **Banco fora ao subir:** a API sobe sem a simulação (`[coleta] simulação não iniciada: ...`) e `/socket.io/` responde `404`. A simulação volta ao reiniciar a API com o banco no ar.
- **Encerramento (`Ctrl+C`):** para o relógio, desconecta os clientes, fecha o servidor HTTP e depois o pool. O cliente vê uma queda de transporte e reconecta sozinho quando a API voltar.

**Implantação:**
- o proxy reverso precisa repassar o WebSocket em `/socket.io/`, com os cabeçalhos `Upgrade` e `Connection` e um tempo ocioso maior que o ping do Socket.IO (25 s). Sem isso, o cliente cai para o polling HTTP, que funciona, mas é mais pesado;
- com mais de uma instância da API, cada uma teria a sua simulação, e as posições divergiriam. Use uma instância só;
- não há limite de conexões por IP: um excesso de conexões precisa ser tratado no proxy.

### 6.12 Fotos no Supabase Storage

Em `server/src/ocorrencias/armazenamento-supabase.ts`, pela API REST do Storage com o `fetch` nativo do Node. Não há dependência nova.

- **Bucket `ocorrencias-fotos`, privado**, com limite de 5 MB por arquivo e só `image/jpeg`, `image/png` e `image/webp`. Os limites do bucket repetem os da API. O `pnpm storage:preparar` cria ou ajusta o bucket; o `pnpm storage:verificar` confere tudo isso e mais:
  - um envio e uma leitura de teste, apagados em seguida;
  - a URL pública sem acesso;
  - a recusa de tipo não permitido;
  - as fotos do banco comparadas com o bucket (faltando, tamanho diferente e órfãs).
- **Acesso:** só a API, com a `SUPABASE_SECRET_KEY`. O bucket não tem policies para `anon` e `authenticated`, então a publishable key não lista, não lê e não envia (403 de RLS, conferido em 10/11/2026). O navegador nunca fala com o Storage: a foto passa pela rota protegida por sessão e perfil (seção 6.7).
- **Chaves:** `ocorrencias/<uuid>.<ext>`, iguais às da época do disco. A API recusa qualquer chave fora desse formato antes de chamar o Storage.
- **Erros:** falha do Storage vira `500` genérico para o cliente. O log registra só o status HTTP, nunca a chave secreta nem a URL completa. Tempo limite de 15 s por chamada.
- **Na subida**, a API confere o bucket e só avisa no log se ele estiver fora do padrão.
- **Nos testes**, as fotos vão para uma pasta temporária em disco (`criarArmazenamentoDisco`), com a mesma interface.

## 7. Problemas comuns

| Sintoma | Solução |
|---|---|
| `Configuração inválida: DATABASE_URL...` | Falta o `.env` ou a variável está errada (seção 2). Banco local não é aceito: use o Session pooler do Supabase |
| `DATABASE_SSL_CA: certificado não encontrado` | Baixe a CA do Supabase para `server/certs/prod-ca-2021.crt` ([guia do banco](03-banco-de-dados.md), seção 1) |
| `não foi possível conectar ao Supabase` | Confira a internet e a `DATABASE_URL`. No plano Free, um projeto sem uso por 7 dias fica **pausado**: reative-o no painel |
| `o certificado TLS do Supabase não foi validado` | O arquivo de `DATABASE_SSL_CA` não é a CA do Supabase, ou a URL não é do Supabase |
| `usuário ou senha do banco recusados` | Confira a senha em `DATABASE_URL` (caracteres especiais codificados) |
| `a porta 3333 já está em uso` | Mude `PORTA` no `.env` |
| Aviso `Ignored build scripts: esbuild` no `pnpm install` | Pode ignorar: o `tsx` funciona sem esse script |
| `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` no `pnpm install` | O pnpm 11+ recusa pacotes publicados há menos de 24 h. Espere um dia ou regenere o lockfile (sem `--frozen-lockfile`) e revise as versões alteradas |
| `401` em `/api/auth/eu` logo depois do login, no navegador | O front precisa enviar `credentials: 'include'`, e o front e a API precisam estar no mesmo site (seção 6.1) |
| `403 Origem da requisição não permitida` | A origem do front não está em `CORS_ORIGENS` |
| `429 Muitas tentativas de login` ou `Muitas consultas de protocolo` | Espere 15 minutos ou reinicie a API (o contador fica na memória) |
| `415 Envie o formulário como multipart/form-data` em `POST /api/ocorrencias` | Envie um `FormData`, sem definir o `Content-Type` à mão; o navegador define o `boundary` |
| `400 Bairro não encontrado` | O nome precisa ser igual ao de um bairro cadastrado, com os acentos (só maiúsculas e minúsculas são ignoradas) |
| `500` ao registrar ocorrência com fotos | Veja o log (`Supabase Storage recusou ...`) e rode `pnpm storage:verificar`; confira `SUPABASE_SECRET_KEY` e o bucket |
| `400 Informe lat e lng` em `/api/pontos/proximos` | Envie a posição: `?lat=-8.057&lng=-34.899` (sem GPS, use as coordenadas do bairro escolhido) |
| `db:seed-rotas`: `Carga parcial`, `alteradas desde a carga` ou `já têm rota cadastrada` | O comando não mexe em rotas existentes. Revise as rotas citadas no SQL Editor do Supabase e decida com a equipe ([03-banco-de-dados.md](03-banco-de-dados.md), seção 5.1) |
| `db:seed-rotas`: `Veículos ausentes ou inativos` | Aplique o seed 001 (banco vazio: `pnpm db:seed`) ou reative os veículos citados |
| `403` em `POST`/`PATCH`/`DELETE /api/pontos` com usuário logado | Essas rotas são só do perfil `admin`; o `gestor` não cadastra pontos |
| `409` ao mudar o status | A transição não é permitida a partir do status atual (seção 6.7). Uma ocorrência concluída precisa ser reaberta antes |
| `[coleta] simulação não iniciada: não foi possível ler as rotas` | O Supabase não respondeu ao subir (pausado ou sem internet). Resolva e reinicie a API |
| `[coleta] simulação DEMONSTRATIVA ativa: 0 veículo(s)` | Não há rotas com veículo ativo: rode `pnpm db:seed-rotas` (seção 3) e reinicie a API |
| Socket.IO não conecta (`connect_error`) no navegador | A origem do front não está em `CORS_ORIGENS`, ou a simulação está desligada (`SIMULACAO_ATIVA=false`, `404` em `/socket.io/`) |
| Foto não aparece no `<img>` do front | O `<img>` precisa ir com o cookie (front e API no mesmo site). A foto também responde `404` se o arquivo não existir no bucket (`pnpm storage:verificar` aponta as faltantes) |
| `db:restaurar`: `A restauração exige tabelas vazias` | Restaure só num banco recém-migrado, sem `db:seed` ([guia do banco](03-banco-de-dados.md), seções 4 e 6.2) |
| `db:verificar`: linha `FALHA privilégios da Data API` ou `RLS` | Alguém mudou permissões pelo painel. Revise e reaplique o que a migração 005 faz; não crie policies públicas |
| Testes: `Recusado: TEST_DATABASE_URL aponta para o Supabase` | Os testes nunca usam o banco oficial. Apague `TEST_DATABASE_URL` do `.env` para usar o PostgreSQL descartável |
