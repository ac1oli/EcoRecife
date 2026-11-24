# 07 · Implantação (hospedar o EcoRecife)

Guia para colocar o EcoRecife no ar em qualquer hospedagem de Node.js. O site e a API rodam juntos, num único serviço e num único endereço: a API entrega o build do front e responde em `/api` e `/socket.io`. O banco e as fotos continuam no Supabase.

> **Situação do front (CP3 pendente):** o site publicado ainda é o protótipo. Ele guarda ocorrências e fotos no navegador e não usa a API. A API, o banco e o tempo real já estão prontos e no ar; a ligação das telas com a API é o Checkpoint 3.

## 1. O que a hospedagem precisa oferecer

| Requisito | Motivo |
|---|---|
| Node.js 22 ou superior | Versão exigida pela API (`engines`) |
| Processo contínuo (não "serverless"/funções) | A simulação da coleta roda em memória e transmite pelo Socket.IO |
| Suporte a WebSocket | Socket.IO (sem ele, o cliente cai para o polling HTTP, que funciona, mas pesa mais) |
| HTTPS no endereço público | Em produção, o cookie de login é `Secure` e usa o prefixo `__Host-` |
| Uma instância só | A simulação e o limite de tentativas ficam em memória |
| Acesso de saída IPv4 à internet | O Supabase é acessado pelo Session pooler (IPv4) |

Plataformas como Render, Railway, Koyeb ou Fly.io atendem esses requisitos. Confira o plano e os custos de cada uma antes de criar a conta. Planos gratuitos costumam **hibernar o serviço** sem acesso, e a primeira visita depois disso demora a responder. Nada no projeto exige plano pago.

## 2. Comandos

Na configuração do serviço, use a **raiz do repositório** como pasta de trabalho.

**Build** (um comando só):

```bash
cd web && corepack pnpm install --frozen-lockfile && corepack pnpm build && cd ../server && corepack pnpm install --frozen-lockfile && corepack pnpm build
```

**Start:**

```bash
cd server && node dist/server.js
```

**Health check** (se a plataforma pedir): `/api/saude`. Ele responde `200` com o banco conectado e `503` com o banco fora. Se a plataforma reiniciar o serviço a cada `503`, use `/` (o site) como verificação.

O build instala as dependências de desenvolvimento do `server/` porque o TypeScript precisa delas para compilar. Uma delas, o `embedded-postgres`, usado só nos testes, baixa os binários do PostgreSQL. Isso deixa o build mais lento, mas não roda nada em produção.

## 3. Variáveis de ambiente

Cadastre-as no painel da hospedagem. **Nunca** num arquivo do repositório.

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | A mesma do `server/.env`: Session pooler do Supabase, com a senha (**segredo**) |
| `SUPABASE_URL` | `https://<id do projeto>.supabase.co` |
| `SUPABASE_SECRET_KEY` | Secret key `sb_secret_...` (**segredo**) |
| `CORS_ORIGENS` | O endereço público do site, por exemplo `https://ecorecife.exemplo.com` (sem barra no fim) |
| `TRUST_PROXY` | `1` (a hospedagem tem um proxy na frente da API) |
| `PORT` | Em geral definida pela própria hospedagem. Não defina `PORTA` |

Opcionais: `SUPABASE_BUCKET_FOTOS`, `SESSAO_HORAS`, `SIMULACAO_ATIVA`, `SIMULACAO_INTERVALO_MS`, `SERVIR_FRONT` e `FRONT_DIST` ([06-api.md](06-api.md), seção 2).

O certificado da CA do Supabase (`server/certs/prod-ca-2021.crt`) está no repositório. Ele é público, e a API o encontra sozinha.

## 4. Banco

O banco do Supabase já está migrado e verificado. A hospedagem **não** roda migrações. Quando houver uma migração nova, aplique-a da sua máquina, na pasta `server/`:

```powershell
corepack pnpm db:status
corepack pnpm db:migrar
corepack pnpm db:verificar --restricoes
```

O primeiro administrador também é criado da sua máquina, com `corepack pnpm criar-admin`.

## 5. Estabilidade: o que a API já faz sozinha

| Situação | Comportamento |
|---|---|
| Supabase lento ou uma conexão cai | Cada consulta tem tempo-limite de 20 s, e o pool abre conexões novas na próxima requisição. Nenhuma requisição fica pendurada |
| Supabase fora do ar (ou pausado) quando a API sobe | A API sobe mesmo assim: o site responde e `/api/saude` dá `503`. A simulação tenta de novo sozinha (10 s, 20 s, 40 s… até 2 min) e liga assim que o banco voltar, sem reiniciar |
| Erro inesperado | Uma promessa rejeitada sem tratamento é registrada no log, e a API continua. Uma exceção não tratada é registrada e encerra a API de forma limpa, para a hospedagem reiniciar o serviço |
| Atualização ou reinício pela hospedagem (SIGTERM) | Para a simulação, desconecta os sockets, fecha o HTTP e depois o pool |
| Muitas conexões | O pool usa no máximo 5 conexões, dentro do limite do plano Free |
| Proxy da hospedagem | Com `TRUST_PROXY=1`, o limite de tentativas conta o IP real do visitante |

**Logs esperados ao subir:**

```
[api] EcoRecife ouvindo em http://localhost:<porta> (production)
[db] banco oficial: Supabase · projeto <id> (TLS verificado)
[fotos] Supabase Storage (projeto <id>, bucket privado ocorrencias-fotos)
[site] servido pela API a partir de .../web/dist
[api] atrás de 1 proxy(s) confiável(is) (TRUST_PROXY)
[coleta] simulação DEMONSTRATIVA ativa: 7 veículo(s), a cada 3000 ms
```

## 6. Conferência depois de publicar

1. Abra o endereço público: o site deve carregar, com o mapa e as fontes.
2. `https://<seu-site>/api/saude` deve responder `{"status":"ok","banco":"conectado"}`.
3. `https://<seu-site>/api/rotas` deve trazer as 7 rotas.
4. No log da hospedagem, procure a linha `[coleta] simulação DEMONSTRATIVA ativa`.

## 7. Cuidados com os planos gratuitos

- **Supabase Free:** o projeto **pausa depois de 7 dias sem uso**. Reative-o no painel (Restore project) e acesse o sistema com frequência, principalmente na semana da apresentação (01 a 08/12). Faça um `corepack pnpm db:backup` antes dela ([03-banco-de-dados.md](03-banco-de-dados.md), seção 6).
- **Hospedagem gratuita:** se o serviço hibernar, a primeira visita depois de um tempo parado demora a responder. Para a apresentação, abra o site alguns minutos antes.
- **Região:** o banco fica em us-west-2 (EUA). Escolher a hospedagem numa região dos EUA reduz a latência das consultas.

## 8. Testado localmente (23/11/2026)

- **Modo de produção:** a API compilada (`node dist/server.js`), com `NODE_ENV=production`, `PORT`, `TRUST_PROXY=1` e o Supabase oficial (só leituras):
  - site na raiz, com `no-cache`;
  - assets com cache longo e CSP liberando os tiles do mapa;
  - `/api/saude` 200, 7 veículos e 7 rotas;
  - 404 da API em JSON e login inválido com 401 e limite de tentativas ativo;
  - Socket.IO entregando as posições na mesma origem.
- **Banco inalcançável:** o site continuou no ar, `/api/saude` deu 503 e a simulação tentou de novo em 10, 20 e 40 s.
- **Não testado:** uma hospedagem real (nenhuma conta foi criada) e o HTTPS com o cookie `Secure` atrás de um proxy de verdade.
