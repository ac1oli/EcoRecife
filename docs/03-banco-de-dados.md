# 03 · Banco de dados: instalação, criação e verificação

Guia para quem nunca configurou PostgreSQL. Cada passo diz **onde** rodar o comando, **o que** esperar e **como** saber se deu certo.

> Requisito: PostgreSQL **14 ou superior** (recomendado: 16). Nenhuma extensão é necessária e Docker não é obrigatório.

---

## 1. Instalar o PostgreSQL

### Windows (recomendado para a equipe)

1. Baixe o instalador em <https://www.postgresql.org/download/windows/> (link "Download the installer", da EDB). Escolha a versão 16 para Windows x86-64.
2. Execute o instalador e aceite os padrões, com estes cuidados:
   - **Componentes:** deixe marcados "PostgreSQL Server" e "Command Line Tools" (pgAdmin é opcional). O **Stack Builder não é necessário**; desmarque ou feche no final.
   - **Senha do superusuário `postgres`:** crie uma senha forte e **anote**. Ela não vai para o repositório.
   - **Porta:** `5432`. **Locale:** "Default locale".
3. Coloque os comandos no PATH, para usar `psql` em qualquer pasta:
   - Menu Iniciar → "Editar as variáveis de ambiente do sistema" → Variáveis de Ambiente → em *Path* (do usuário), clique em **Novo** → `C:\Program Files\PostgreSQL\16\bin` → OK.
   - **Feche e abra de novo** o PowerShell.
4. **Verifique.** No PowerShell:
   ```powershell
   psql --version
   ```
   Esperado: `psql (PostgreSQL) 16.x`. Se aparecer "psql não é reconhecido", o passo 3 não funcionou.
5. Acentos no terminal: antes de usar o `psql`, rode `chcp 65001` no PowerShell para exibir a saída em UTF-8.

### Linux (Ubuntu/Debian)

```bash
sudo apt update && sudo apt install -y postgresql
sudo systemctl status postgresql        # esperado: "active"
sudo -u postgres psql -c "SELECT version();"
```

No Linux, troque `psql -U postgres ...` por `sudo -u postgres psql ...` nos comandos abaixo (ou crie uma senha para o usuário `postgres`).

### macOS

Instale o [Postgres.app](https://postgresapp.com/) (versão 16), abra-o e clique em "Initialize". Siga as instruções do site para colocar o `psql` no PATH.

### Opcional: Docker

Só para quem já usa Docker. Não é necessário.

```bash
docker run --name ecorecife-db -e POSTGRES_PASSWORD=<sua-senha> -p 5432:5432 -d postgres:16
```

---

## 2. Criar o banco e instalar as tabelas

Abra o terminal **na pasta `database/` do repositório**:

```powershell
cd caminho\para\EcoRecife\database
```

**2.1 Criar o banco vazio** (pede a senha do `postgres`):

```powershell
createdb -U postgres -E UTF8 -T template0 ecorecife
```

Esperado: nenhuma mensagem. Se aparecer `database "ecorecife" already exists`, veja a seção 4.

**2.2 Rodar migrações e dados demonstrativos:**

```powershell
psql -U postgres -d ecorecife -f instalar.sql
```

Saída esperada (resumida):

```
>> Migração 001: tipos e funções
>> Migração 002: tabelas
>> Migração 003: índices e gatilhos
>> Seed 001: dados demonstrativos
>> Concluído. Migrações aplicadas:
 001_tipos_e_funcoes    | ...
 002_tabelas            | ...
 003_indices_e_gatilhos | ...
(3 rows)
```

Se houver qualquer erro, o script para (`ON_ERROR_STOP`) e cada arquivo é uma transação: nada fica pela metade.

> **Alternativa sem `psql`:** os comandos `pnpm db:migrar` e `pnpm db:seed`, na pasta `server/`, aplicam os mesmos arquivos com verificações extras. Veja [06-api.md](06-api.md), seção 3.

---

## 3. Verificar se deu certo

**3.1 Restrições** (insere dados inválidos de propósito e desfaz tudo no final):

```powershell
psql -U postgres -d ecorecife -f queries/verificar_restricoes.sql
```

Esperado: uma tabela com **24 linhas "OK"** e a mensagem `Todas as restrições verificadas com sucesso`. Se aparecer `FALHOU: ...`, há um problema no banco.

**3.2 Consultas de teste** (somente leitura):

```powershell
psql -U postgres -d ecorecife -f queries/consultas_teste.sql
```

Resultados esperados com os dados demonstrativos (verificados em 27/10/2026, PostgreSQL 16.15):

| Consulta | Esperado |
|---|---|
| 1. Contagens | bairros 16 · categorias 3 · materiais 6 · pontos 10 · ponto_materiais 16 · veículos 7 · ocorrências 8 · histórico 20 · usuários 0 |
| 2. 3 mais próximos do Derby | EcoPonto Torre (1,61 km) · Cooperativa Novo Ciclo (1,85 km) · EcoPonto Centro / Santo Antônio (1,95 km) |
| 3. Mais próximos com eletroeletrônicos | EcoPonto Pina (3,78 km) · EcoPonto Casa Amarela (4,95 km) |
| 5–6. Protocolo `ECO-2026-DEMA-9JTU` | Concluída; 4 etapas no histórico |
| 7. Protocolo inexistente | 0 |
| 8. Fila ativa, página 1 | 5 ocorrências, da mais recente para a mais antiga |
| 10. Por status | 2 em cada um dos 4 status |
| 12. Protocolo gerado | Dois códigos diferentes no formato `ECO-2026-XXXX-XXXX` |

Os horários das ocorrências demonstrativas são relativos ao momento da instalação ("há 2 horas", "há 1 dia"...).

**Protocolos demonstrativos para testar a consulta:** `ECO-2026-DEMA-2BVW` até `ECO-2026-DEMA-9JTU` (veja `seeds/001_dados_demonstrativos.sql`).

**3.3 Explorar manualmente:**

```powershell
psql -U postgres -d ecorecife
```

Dentro do `psql`: `\dt` lista as tabelas, `\d ocorrencias` mostra a estrutura de uma tabela, `\q` sai. O pgAdmin, se instalado, mostra o mesmo em interface gráfica.

---

## 4. Recriar o banco do zero

**Isto apaga todos os dados do banco `ecorecife`.**

```powershell
dropdb -U postgres --if-exists ecorecife
createdb -U postgres -E UTF8 -T template0 ecorecife
psql -U postgres -d ecorecife -f instalar.sql
```

Rodar `instalar.sql` duas vezes no mesmo banco falha de propósito (`relation "schema_migrations" already exists`) e não altera nada.

---

## 5. O que é real e o que é demonstrativo

| Dado | Situação |
|---|---|
| Bairros (16) | Nomes reais do Recife, coordenadas **aproximadas** do protótipo: `demonstrativo = true` |
| Ecopontos e cooperativas (10) | **Demonstrativos.** Nomes, horários e materiais vêm do protótipo e não foram verificados na Prefeitura/Emlurb. Sem telefone ou endereço (não inventados). |
| Veículos (7) | **Simulados.** Não há integração com a frota municipal. |
| Ocorrências (8) | **Exemplos** (`demonstrativo = true`), com protocolos `DEMA` |
| Rotas | Ainda vazias (pendência do CP2) |

Para cadastrar um ponto oficial, use `demonstrativo = false` com `fonte` (ex.: URL da página oficial) e `verificado_em`. Sem `fonte`, o banco recusa.

---

## 6. Segurança e backup básicos

- **Nunca** coloque senhas em arquivos versionados. A API lê a conexão de `server/.env`, que é ignorado pelo Git; só `.env.example` é versionado.
- [Planejado para o CP2] Criar um usuário próprio da aplicação com permissões mínimas (sem ser superusuário), em vez de usar `postgres`.
- **Backup** (gera um arquivo compactado):
  ```powershell
  pg_dump -U postgres -Fc -d ecorecife -f ecorecife_AAAA-MM-DD.dump
  ```
  **Restaurar** num banco vazio:
  ```powershell
  createdb -U postgres -E UTF8 -T template0 ecorecife_restaurado
  pg_restore -U postgres -d ecorecife_restaurado ecorecife_AAAA-MM-DD.dump
  ```
  Arquivos `.dump` podem conter dados reais: não versione e guarde em local privado.
