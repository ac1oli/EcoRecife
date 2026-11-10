# 03 · Banco de dados: Supabase, migrações, verificação e backup

O banco oficial do EcoRecife é o **PostgreSQL gerenciado do Supabase** (plano Free). Não é preciso instalar nem iniciar um PostgreSQL na sua máquina: as migrações, os dados, a verificação e o backup são comandos Node na pasta `server/`. Cada passo diz **onde** rodar, **o que** esperar e **como** saber se deu certo.

> Requisitos: Node 22+ e pnpm (via `corepack`). O banco é o PostgreSQL 17 do Supabase, sem extensões além das padrão. Docker não é usado.

---

## 1. O projeto no Supabase

O projeto já existe (id `ywsdluoitgwbbavbryju`, região **us-west-2**, Oregon). Para um projeto novo, crie-o no [painel do Supabase](https://supabase.com/dashboard) e anote o id e a senha do banco.

**Conexão:** a API usa o **Session pooler** (porta 5432, IPv4). Motivos:
- a conexão direta (`db.<id>.supabase.co`) só tem IPv6 no plano Free, e muitas redes domésticas não têm IPv6;
- o **Transaction pooler** (porta 6543) não serve, porque o migrador usa uma trava consultiva de sessão. A API recusa essa porta.

**TLS verificado:** a API confere o certificado do Supabase com a CA oficial (`Supabase Root 2021 CA`, válida até 2031), salva em `server/certs/prod-ca-2021.crt`. Esse arquivo é público, não é segredo. Se precisar baixá-lo de novo, use o painel (Settings → Database → SSL Configuration → Download certificate) ou:

```powershell
cd server
New-Item -ItemType Directory -Force certs
Invoke-WebRequest https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt -OutFile certs/prod-ca-2021.crt
```

A API nunca usa `rejectUnauthorized: false`. Sem o certificado, ela não sobe.

**`server/.env`** (modelo em `server/.env.example`; o `.env` nunca vai para o Git):

| Variável | O que colocar |
|---|---|
| `DATABASE_URL` | Painel → **Connect** → Session pooler. Ex.: `postgresql://postgres.<id>:<senha>@aws-0-us-west-2.pooler.supabase.com:5432/postgres`. Caracteres especiais da senha são codificados (`@` vira `%40`) |
| `DATABASE_SSL_CA` | `certs/prod-ca-2021.crt` |
| `SUPABASE_URL` | `https://<id>.supabase.co` |
| `SUPABASE_SECRET_KEY` | Painel → Settings → API Keys → Secret keys (`sb_secret_...`). **Segredo**: fica só no `.env` do servidor |

A **publishable key** (`sb_publishable_...`) não é usada pela API nem pelo front: o navegador fala só com a API Express.

---

## 2. Criar as tabelas e carregar os dados

Na pasta `server/`:

```powershell
corepack pnpm db:status    # mostra o que já foi aplicado e o que falta (não altera nada)
corepack pnpm db:migrar    # aplica as migrações pendentes (001 a 005)
corepack pnpm db:seed      # só num banco vazio: dados demonstrativos (seed 001) e rotas (seed 002)
corepack pnpm db:verificar # confere estrutura, segurança, órfãos e sequências
```

Saída esperada do `db:migrar` num banco vazio: `Aplicadas agora: 001_tipos_e_funcoes, 002_tabelas, 003_indices_e_gatilhos, 004_sessoes, 005_seguranca`. Cada migração é uma transação: se uma falhar, nada dela fica gravado e as anteriores continuam aplicadas.

- **O `db:seed` recusa banco com dados** (`bairros` não vazia), para nunca duplicar registros.
- **Banco já instalado, sem as rotas dos caminhões:** `corepack pnpm db:seed-rotas` (seção 5.1).
- **Primeiro administrador:** `corepack pnpm criar-admin` (interativo; a senha é digitada, não fica em arquivo).

A migração **005 (segurança)** liga a RLS nas 14 tabelas, sem nenhuma policy, e retira todos os privilégios de `anon`, `authenticated` e `service_role`, os papéis da Data API do Supabase. Só a API, conectada como dona das tabelas, lê e grava. Ela também fixa o `search_path` das funções. Detalhes na seção 6.

---

## 3. Verificar se deu certo

**3.1 Verificação completa** (só leituras, mais os casos de restrição numa transação desfeita):

```powershell
corepack pnpm db:verificar --restricoes
```

Esperado: todas as linhas `OK`, inclusive `restrições (24 casos): 24/24 OK`, e a mensagem `Todas as verificações passaram`. O `--restricoes` executa `database/queries/verificar_restricoes.sql` sem o `psql`: o arquivo tenta gravar dados inválidos e desfaz tudo no fim. Cada execução consome um número da sequência de ocorrências, então os próximos ids pulam um número (não é erro).

**3.2 Data API fechada** (teste de fora, como um visitante com a publishable key, que é pública):

```powershell
$env:SUPABASE_PUBLISHABLE_KEY = "sb_publishable_..."
corepack pnpm db:verificar --data-api
Remove-Item Env:SUPABASE_PUBLISHABLE_KEY
```

Esperado: `Data API com a publishable key: nenhuma tabela acessível` (HTTP 401 em todas).

**3.3 Consultas de teste** (`database/queries/consultas_teste.sql`, opcional, só para quem tiver o `psql`). Resultados esperados com os dados demonstrativos:

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

Os horários das ocorrências demonstrativas são relativos ao momento em que o seed foi aplicado ("há 2 horas", "há 1 dia"...). No Supabase oficial, eles vieram do banco local original, importado em 10/11/2026.

**Protocolos demonstrativos para testar a consulta:** `ECO-2026-DEMA-2BVW` até `ECO-2026-DEMA-9JTU` (veja `seeds/001_dados_demonstrativos.sql`).

**3.4 Explorar manualmente:** no painel do Supabase, o **Table Editor** mostra as tabelas e o **SQL Editor** roda consultas. O editor entra como administrador do banco, então cuidado com `UPDATE` e `DELETE`.

---

## 4. Recriar o banco do zero

**Isto apaga todos os dados.** Antes, faça um backup (seção 6.2). Este procedimento está documentado, mas não foi executado no projeto oficial: a restauração foi testada num banco temporário.

No painel do Supabase, no **SQL Editor**, apague o schema do EcoRecife e recrie o `public` com os privilégios padrão do Supabase:

```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres;
```

Depois, na pasta `server/`, rode `corepack pnpm db:migrar`, `corepack pnpm db:seed` (ou `db:restaurar`, seção 6.2), `corepack pnpm db:verificar --restricoes` e `corepack pnpm storage:verificar`. O `DROP SCHEMA` não apaga as fotos do bucket; as que ficarem sem registro no banco aparecem como "órfãs" no `storage:verificar`.

---

## 5. O que é real e o que é demonstrativo

| Dado | Situação |
|---|---|
| Bairros (16) | Nomes reais do Recife, coordenadas **aproximadas** do protótipo: `demonstrativo = true` |
| Ecopontos e cooperativas (10) | **Demonstrativos.** Nomes, horários e materiais vêm do protótipo e não foram verificados na Prefeitura/Emlurb. Sem telefone ou endereço (não inventados). |
| Veículos (7) | **Simulados.** Não há integração com a frota municipal. |
| Ocorrências (8) | **Exemplos** (`demonstrativo = true`), com protocolos `DEMA` |
| Rotas dos caminhões (7, com 1.178 pontos) | **Demonstrativas** (`rotas.demonstrativo = true`). Uma por veículo, em volta do bairro dele, sobre ruas reais do OpenStreetMap. **Não** são os roteiros da Emlurb (seção 5.1) |
| Ocorrências registradas pela API | Reais (`demonstrativo = false`), anônimas. Cada uma ganha um protocolo de `gerar_protocolo()` e uma primeira linha no histórico (`NULL → recebida`, sem usuário) |
| Histórico de status | Gravado pela API na mesma transação de cada mudança feita pela gestão, com o `usuario_id` da sessão. Mudar a prioridade não gera histórico. O banco não tem gatilho de histórico, então alterar o `status` direto no SQL Editor do Supabase **não** registra a linha |
| Fotos das ocorrências | Arquivos no **Supabase Storage**, bucket privado `ocorrencias-fotos` (`ocorrencias/<uuid>.<ext>`), fora do banco e do Git. A `ocorrencia_fotos` guarda só a chave, o tipo e o tamanho. Só a gestão logada acessa, pela API; os arquivos mantêm os metadados EXIF ([06-api.md](06-api.md), seções 6.7 e 6.12) |

Para cadastrar um ponto oficial, use `demonstrativo = false` com `fonte` (ex.: URL da página oficial) e `verificado_em`. Sem `fonte`, o banco recusa. Pela API, o cadastro é feito por um `admin` em `POST /api/pontos`, que aplica a mesma regra ([06-api.md](06-api.md), seção 6.8). Excluir um ponto pela API só o desativa (`ativo = false`).

---

### 5.1 Rotas demonstrativas dos caminhões (seed 002)

**Fonte e créditos:**
- malha viária © colaboradores do OpenStreetMap ([openstreetmap.org/copyright](https://www.openstreetmap.org/copyright)), licença ODbL. Ao exibir as rotas, mantenha esse crédito;
- os trajetos foram calculados **uma única vez**, em 29/10/2026, pelo servidor público de demonstração do OSRM (`router.project-osrm.org`, perfil `driving`), com autorização da equipe. A carga e a API não fazem nenhuma chamada externa;
- em cada bairro, os pontos de passagem formam um losango de ~450 m (norte, leste, sul, oeste e de volta ao norte) em volta da coordenada do bairro no seed 001. O OSRM encaixa cada ponto na rua mais próxima e devolve o traçado. As coordenadas gravadas são as do OSRM, sem edição, e o cabeçalho de `seeds/002_rotas_demonstrativas.sql` lista os pontos de passagem de cada rota.

**Natureza:** são rotas **demonstrativas**, criadas para a simulação de coleta. Não representam os roteiros reais da Emlurb e não vêm de integração com a frota.

**Conferido:**
- cada ponto de passagem ficou a no máximo 49 m da rua;
- nenhum ponto passa de 1,03 km do centro do bairro;
- cada circuito fecha no ponto inicial;
- não há pontos repetidos;
- o maior trecho entre dois pontos é de 303 m;
- cada rota tem de 103 a 308 pontos e de 4,2 a 6,2 km.

**Como carregar:**
- **banco novo:** `pnpm db:seed` já aplica o seed 002 depois do 001;
- **banco já instalado:** `pnpm db:seed-rotas`, na pasta `server/`. Ele exige as migrações em dia (`pnpm db:status`) e usa a mesma trava e a mesma transação dos outros comandos.

**O que o comando faz, conforme o estado do banco** (as verificações rodam antes de qualquer gravação):

| Estado do banco | Resultado |
|---|---|
| Sem as rotas demonstrativas | Grava as 7 rotas e os pontos numa só transação |
| As 7 já carregadas, iguais ao arquivo | Não faz nada ("já estavam carregadas") |
| Só parte das 7 rotas existe | Para com erro ("Carga parcial") |
| Uma rota demonstrativa foi alterada | Para com erro ("alteradas desde a carga") |
| Um dos 7 veículos já tem outra rota | Para com erro e cita a rota encontrada |
| Veículo ausente ou inativo (sem o seed 001) | Para com erro |
| Rotas de outros veículos ou sem veículo | São mantidas, e a carga segue |

Em todos os erros, nada é gravado nem apagado. O comando não corrige o banco sozinho: revise as rotas citadas na mensagem.

**Pela API:** `GET /api/rotas` devolve as rotas ativas com os pontos em ordem ([06-api.md](06-api.md), seção 6.9). A simulação lê essas mesmas rotas ao subir a API e transmite as posições demonstrativas por Socket.IO (seções 6.10 e 6.11). Uma rota nova ou alterada só entra na simulação depois de reiniciar a API.

**Validação visual:** a consulta abaixo (no SQL Editor do painel do Supabase) gera um GeoJSON. Cole o resultado num visualizador de mapas (por exemplo geojson.io ou uMap) e confira se as linhas seguem as ruas de cada bairro. A conferência visual é da equipe.

```sql
SELECT json_build_object('type', 'FeatureCollection', 'features', json_agg(json_build_object(
         'type', 'Feature',
         'properties', json_build_object('rota', r.nome, 'demonstrativo', r.demonstrativo),
         'geometry', json_build_object('type', 'LineString', 'coordinates',
           (SELECT json_agg(json_build_array(rp.longitude, rp.latitude) ORDER BY rp.ordem)
              FROM rota_pontos rp WHERE rp.rota_id = r.id)))))
  FROM rotas r WHERE r.demonstrativo;
```


## 6. Segurança, backup e plano Free

### 6.1 Segurança do banco

- **Credenciais:** `DATABASE_URL` (com a senha do banco) e `SUPABASE_SECRET_KEY` ficam só em `server/.env`, que o Git ignora. O `.env.example` tem só valores de exemplo, e a API recusa a publishable key e o valor de exemplo no lugar da secret key.
- **Data API:** a migração 005 deixa as 14 tabelas com RLS e **sem nenhuma policy**. Ela também tira de `anon`, `authenticated` e `service_role` todos os privilégios em tabelas, sequências e funções, inclusive nos objetos criados depois. Quem tem a publishable key recebe 401 em qualquer tabela (seção 3.2). Os hashes de senha (`usuarios.senha_hash`) e de sessão (`sessoes.token_hash`) só são lidos pela API.
- **Recomendado no painel:** desligar a Data API em Settings → Data API, já que o EcoRecife não a usa. A segurança não depende disso: o `db:verificar --data-api` comprova o bloqueio mesmo com ela ligada.
- **Funções:** `search_path` fixo em `pg_catalog` e sem `EXECUTE` para `PUBLIC`.
- **Storage:** o bucket `ocorrencias-fotos` é **privado**, aceita até 5 MB e só jpeg/png/webp, e não tem policies para `anon` e `authenticated`. A publishable key não lista, não lê e não envia arquivos; só a API acessa, com a secret key.

### 6.2 Backup e restauração (sem pg_dump)

O plano Free não oferece backups para baixar. Faça backups manuais, por exemplo antes de cada apresentação ou mudança grande:

```powershell
corepack pnpm db:backup                  # salva em <pasta do usuário>\EcoRecife-backups\ e mostra o SHA-256
corepack pnpm db:backup --pasta D:\backups
```

O arquivo é SQL puro. Ele traz os dados das 12 tabelas, com ids, datas e sequências preservados, e a lista de migrações. As sessões de login não entram. **O arquivo contém hashes de senha:** guarde-o em local privado, nunca no repositório.

**Para restaurar**, use um banco com as mesmas migrações e as tabelas **vazias** (por exemplo, depois da seção 4, sem rodar o `db:seed`):

```powershell
corepack pnpm db:restaurar C:\caminho\ecorecife_supabase_AAAA-MM-DDTHH-MM-SS.sql
corepack pnpm db:verificar --restricoes
```

A restauração roda numa transação e recusa banco com dados ou com outra versão das migrações; se falhar, nada é gravado. **Fotos:** o backup do banco não inclui os arquivos do Storage. Para um backup completo, baixe também o bucket `ocorrencias-fotos` pelo painel (Storage).

**Backup da migração para o Supabase (10/11/2026):** a cópia do antigo banco local (PostgreSQL 16) está em `C:\Users\<usuário>\EcoRecife-backups\2026-11-10\`, com acesso restrito ao usuário do Windows, e não vai para o Git. A pasta contém:
- `ecorecife_local_2026-11-10.dump` (`pg_dump -Fc`), com o SHA-256 ao lado;
- `ecorecife_local_2026-11-10.sql`, em SQL legível;
- `ecorecife_supabase_*.sql`, o primeiro `db:backup` do Supabase;
- os inventários em JSON.

O processo está descrito no `docs/CONTINUIDADE.md`.

### 6.3 Limites do plano Free

| Limite | Efeito no EcoRecife | Cuidado |
|---|---|---|
| **Pausa depois de 7 dias sem uso** | A API não conecta (erro de conexão no log) | Reative no painel (Restore project) e **acesse o projeto na semana da apresentação** (01 a 08/12) |
| Sem backups para baixar e sem recuperação de um ponto no tempo | Um erro nos dados não tem volta pelo painel | `pnpm db:backup` manual (seção 6.2) |
| Banco de 500 MB | Os dados atuais ocupam poucos MB | Nenhum |
| Storage de 1 GB (arquivos de até 50 MB) | Fotos de até 5 MB, no máximo 3 por ocorrência | Acompanhar o uso no painel |
| Poucas conexões no pooler | A API usa no máximo 5 conexões | Rodar uma instância só da API |
| Região us-west-2 (Oregon) | Cada consulta leva ~150–200 ms a mais a partir do Recife | A região não muda depois que o projeto é criado |

As cotas podem mudar: confira a página de preços do Supabase. Nada no projeto depende de recurso pago, e nenhum upgrade foi feito.
