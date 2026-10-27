# 06 · API (server/): instalação, comandos e endpoints

Situação atual (CP2, parte 1): base da API, `GET /api/saude`, executor de migrações, carga dos dados demonstrativos e comando `criar-admin`. Autenticação, ocorrências, pontos e coleta vêm nas próximas partes.

Stack: Node.js 22 + TypeScript + Express 5 + `pg` + `zod` + `helmet` + `cors` + `bcryptjs`. Testes com vitest + supertest. Os comandos rodam o TypeScript direto com `tsx`.

## 1. Pré-requisitos

- Node.js 22 e pnpm 10: como no [guia do front](05-execucao-local.md), seção 1.
- PostgreSQL 16 instalado e com `psql`/`createdb` no PATH: [guia do banco](03-banco-de-dados.md), seção 1.

## 2. Instalar e configurar (Windows, PowerShell)

Na pasta do repositório:

```powershell
cd server
pnpm install --frozen-lockfile
Copy-Item .env.example .env
notepad .env
```

No `.env`, troque `USUARIO` e `SENHA` em `DATABASE_URL` (ex.: `postgres://postgres:SuaSenha@localhost:5432/ecorecife`). Se a senha tiver `@ : / # ?`, codifique-os (`@` vira `%40`). O `.env` não é versionado; nunca o envie ao GitHub.

| Variável | Obrigatória | Padrão | Para que serve |
|---|---|---|---|
| `DATABASE_URL` | sim | (nenhum) | Conexão com o PostgreSQL |
| `PORTA` | não | `3333` | Porta HTTP da API |
| `NODE_ENV` | não | `development` | `development`, `test` ou `production` |
| `CORS_ORIGENS` | não | `http://localhost:5173` | Origens do navegador autorizadas, separadas por vírgula (sem `*`) |
| `TEST_DATABASE_URL` | não | (nenhum) | Só para os testes de integração (seção 5) |

Com a configuração inválida, a API e os comandos param e dizem qual variável corrigir.

## 3. Criar o banco pela API (alternativa ao `instalar.sql`)

O banco precisa existir e estar **vazio** e em **UTF8**:

```powershell
createdb -U postgres -E UTF8 -T template0 ecorecife
pnpm db:status     # mostra as migrações aplicadas e pendentes (não altera nada)
pnpm db:migrar     # aplica as pendentes de database/migrations
pnpm db:seed       # opcional: carrega os dados DEMONSTRATIVOS de database/seeds
pnpm criar-admin   # cria o primeiro administrador (interativo)
```

Os dois caminhos (`instalar.sql` com o `psql`, ou os comandos acima) usam os mesmos arquivos SQL e a mesma tabela `schema_migrations`, e chegam ao mesmo resultado. Um banco instalado pelo `instalar.sql` já aparece como atualizado em `pnpm db:status`.

Regras de segurança do executor de migrações (`server/src/banco/migrador.ts`):

- nunca apaga nem recria nada: só aplica migrações ainda não registradas, em ordem;
- antes de conectar, valida os arquivos: nome `NNN_descricao.sql`, um único `BEGIN;`/`COMMIT;`, autorregistro em `schema_migrations` e nenhum comando do psql;
- recusa, sem alterar nada:
  - banco que não é UTF8;
  - banco com tabelas mas sem `schema_migrations`;
  - banco com migração registrada que não existe no repositório;
  - migração nova numerada antes da última aplicada;
- cada arquivo é uma transação: se um falhar, ele é desfeito por inteiro e os anteriores continuam aplicados;
- uma trava do PostgreSQL impede duas execuções ao mesmo tempo;
- `db:seed` só roda com todas as migrações aplicadas e o banco sem dados, então não duplica registros.

**Nova migração:** crie `database/migrations/004_descricao.sql` com `BEGIN;` no início, `INSERT INTO schema_migrations (versao) VALUES ('004_descricao');` antes do `COMMIT;` e `COMMIT;` no final. Inclua-a também em `database/instalar.sql`.

### `pnpm criar-admin`

- Pede nome, e-mail, senha e confirmação. A senha não aparece na tela.
- Exige uma senha de pelo menos 12 caracteres e até 72 bytes (limite do bcrypt). A senha não pode ser repetitiva nem conter o e-mail.
- Grava só o hash bcrypt (custo 12), com perfil `admin`.
- Não aceita senha por argumento nem por variável de ambiente, para que ela não fique no histórico do terminal.
- Recusa e-mail já cadastrado (sem diferenciar maiúsculas). Se já houver administrador, pede confirmação antes de criar outro.
- Precisa de um terminal interativo: PowerShell, Prompt de Comando ou Windows Terminal. No terminal do Git Bash (mintty), ele recusa e explica o motivo.

## 4. Rodar a API

```powershell
pnpm dev     # recarrega ao salvar os arquivos
```

Esperado: `[api] EcoRecife ouvindo em http://localhost:3333 (development)`. `Ctrl+C` encerra. Teste em outro terminal:

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
| `pnpm db:status` / `db:migrar` / `db:seed` | Migrações e dados demonstrativos (seção 3) |
| `pnpm criar-admin` | Cria administrador (seção 3) |

## 5. Testes

```powershell
pnpm test
```

- **Sem banco:** rodam os testes de configuração, da aplicação HTTP (saúde, helmet, CORS, 404, JSON inválido), da validação dos arquivos de migração e do administrador. Os testes de integração aparecem como `skipped`.
- **Com banco:** defina `TEST_DATABASE_URL` no `.env` com um usuário que possa criar bancos (o `postgres` local serve), por exemplo `postgres://postgres:SuaSenha@localhost:5432/postgres`. Os testes criam bancos temporários `ecorecife_teste_...`, testam migrações, seed, saúde, administrador e as recusas de segurança, e apagam esses bancos no fim. O banco de `DATABASE_URL` não é tocado.

## 6. Endpoints

| Método e rota | Acesso | Resposta |
|---|---|---|
| `GET /api/saude` | público | `200 {"status":"ok","banco":"conectado","horario":"..."}`; `503 {"status":"erro","banco":"indisponivel",...}` se o banco não responder |

Erros são sempre JSON (`{"erro": "..."}`), sem detalhes internos: `404` para rota inexistente, `400` para JSON malformado ou corpo maior que 100 kB, `500` genérico (o detalhe só vai para o log do servidor).

## 7. Problemas comuns

| Sintoma | Solução |
|---|---|
| `Configuração inválida: DATABASE_URL...` | Falta o `.env` ou a variável está errada (seção 2) |
| `não foi possível conectar ao PostgreSQL` | O serviço do PostgreSQL está parado ou a porta está errada |
| `usuário ou senha do banco recusados` | Confira a senha em `DATABASE_URL` (caracteres especiais codificados) |
| `o banco informado em DATABASE_URL não existe` | `createdb -U postgres -E UTF8 -T template0 ecorecife` |
| `O banco usa a codificação WIN1252...` | O banco foi criado sem `-E UTF8 -T template0`: recrie-o ([guia do banco](03-banco-de-dados.md), seção 4) |
| `a porta 3333 já está em uso` | Mude `PORTA` no `.env` |
| Aviso `Ignored build scripts: esbuild` no `pnpm install` | Pode ignorar: o `tsx` funciona sem esse script |
