# 01 · Diagnóstico técnico do protótipo

Análise do código exportado do Figma Make (ZIP `EcoRecife_Environmental_Management_Platform`), feita em 27/10/2026 e aplicada na Etapa 0.
Legenda: **[Confirmado]** verificado no código ou por execução · **[Recomendação]** · **[Dúvida]**.

## 1. Tecnologias

| Item | Versão (lockfile) | Situação |
|---|---|---|
| React / React DOM | 19 | [Confirmado] mantido |
| TypeScript | 5.9 | [Confirmado] mantido |
| Vite + `@vitejs/plugin-react` | 8.0 / 6.0 | [Confirmado] mantido |
| Tailwind CSS (`@tailwindcss/vite`) | 4.2 | [Confirmado] mantido |
| Leaflet + React Leaflet | 1.9 / 5.0 | [Confirmado] mantido |
| lucide-react (ícones) | 1.x | [Confirmado] mantido |
| oxfmt (formatação) | 0.2 | [Confirmado] mantido |
| Gerenciador de pacotes | pnpm (`pnpm-lock.yaml`), Node 22 (`.mise.toml`) | [Confirmado] mantido |

Não há roteador: a página atual é um estado React sincronizado com o `#hash` da URL (`#inicio`, `#coleta`, `#zeladoria`, `#ecopontos`, `#beneficios`, `#login`, `#gestao`).

## 2. Dependências do Figma removidas na Etapa 0

| Item original | Problema | Ação |
|---|---|---|
| `vite.config.ts` importava `.figma/make/site.json` e 4 plugins `figma*` | O build quebrava sem a pasta `.figma/` | Configuração reduzida a React + Tailwind + alias `@` |
| `index.html` com marcadores `<!-- figma:* -->` | Título "Figma Make App", `lang="en"` | `lang="pt-BR"`, título "EcoRecife", descrição em português; `noindex` mantido |
| Variáveis `FIGMA_PUBLIC_URL`, `FIGMA_DEV_SERVER_HOST`, porta 8443 fixa | Específicas do Figma | Portas padrão do Vite (5173 dev, 4173 preview) |
| `.figma/make/*` (scripts `figma make deploy`) | Só funcionam no Figma | Não importados |
| `CLAUDE.md`, `AGENTS.md` | Descreviam o ambiente do Figma Make | Não importados |
| `.gitattributes` | Forçava Git LFS para imagens e PDFs (exige LFS em toda a equipe) | Não importado |
| `.figma/attachments/image-0.png` | Captura de tela do bloqueio de tiles do OSM no Figma | Não importada (registrada como risco abaixo) |
| `package.json` nome `figma-make-app` | — | Renomeado `ecorecife-web`; script `typecheck` adicionado |

A pasta `plans/` não era referenciada por código, configuração ou documentação. Foi preservada em [`historico-prototipo/`](historico-prototipo/README.md).

## 3. Telas e funcionalidades existentes

| Tela | O que faz hoje | Origem dos dados |
|---|---|---|
| Início | Atalhos e indicadores "Operação de hoje" | Números fixos (18/24/12/94%), rotulados como demonstrativos |
| Coleta | Mapa Leaflet com 17 marcadores, filtro por tipo e busca por bairro | Array `mapLocations` (posições paradas) |
| Zeladoria | Formulário (tipo, bairro, endereço, descrição, até 3 fotos de 5 MB) que gera um protocolo | `localStorage` + IndexedDB |
| EcoPontos | Lista com filtro por material e busca; botão abre o ponto no mapa | Array `ecoPointsList` (distâncias fixas) |
| Benefícios | Calculadora de impacto | Fórmula local (pode continuar estática) |
| Login | Formulário de acesso | Nenhuma validação |
| Gestão | Fila ativa/histórico, filtros, troca de status, conclusão com nota, galeria de fotos, visão por bairro | `localStorage` + IndexedDB |

## 4. Armazenamento atual (será substituído pela API)

| Dado | Mecanismo | Substituição |
|---|---|---|
| Ocorrências | `localStorage` `ecorecife:occurrences:v2` (migra a chave `v1`) | API + PostgreSQL (CP2/CP3) |
| Fotos | IndexedDB `ecorecife` / store `occurrencePhotos` | Upload pela API + armazenamento de arquivos |
| Veículos, ecopontos e cooperativas | Array `mapLocations` | Tabelas `veiculos`, `pontos_descarte` |
| Lista do guia | Array `ecoPointsList` (duplica `mapLocations` com nomes diferentes) | Unificada em `pontos_descarte` |
| Bairros | Objeto `neighborhoodCoords` | Tabela `bairros` |
| Ocorrências iniciais | Array `initialOccurrences` | Seed demonstrativo |

Decisão: os dados antigos do `localStorage` **não** serão importados automaticamente; as seeds recriam os exemplos.

## 5. Problemas encontrados

| # | Problema | Evidência | Etapa da correção |
|---|---|---|---|
| 1 | **A gestão não tem proteção:** o login aceita qualquer valor (vem preenchido com `servidor.teste`/`123456`), e abrir `#gestao` direto mostra o painel | `App.tsx` (`enterManagement`, `syncPageFromHash`); teste Playwright de 27/10 | CP2 (API) + CP3 (front) |
| 2 | Protocolo `ECO-2026-` + 4 dígitos aleatórios: pode repetir e pode ser adivinhado | `handleReportSubmit` | Resolvido no banco (`gerar_protocolo`); front no CP3 |
| 3 | Datas guardadas como texto ("Agora", "Hoje, 08:42") | `reportedAt` | Banco usa `timestamptz` |
| 4 | O cidadão não consegue consultar o próprio protocolo | Não há tela de consulta | CP3 |
| 5 | Não usa geolocalização (GPS) | `navigator.geolocation` ausente | CP3 |
| 6 | Caminhões parados; "há 1 min" é texto fixo; não há rotas nem alerta | `mapLocations` | CP2 (Socket.IO) + CP3 |
| 7 | Distâncias inventadas ("1,2 km de você") e nenhum contato | `ecoPointsList` | CP2/CP3 (cálculo real) |
| 8 | O filtro "cooperativas" mistura tipo de ponto com material | `ecoPointsList.tags` | CP3 |
| 9 | Qualquer status pode ir para qualquer outro, sem histórico; prioridade fixa em "Média" | `updateOccurrenceStatus` | CP2 (regra na API + `ocorrencia_historico`) |
| 10 | `App.tsx` com 1.074 linhas | — | CP3 (separar páginas aos poucos) |
| 11 | Upload aceita `image/*`, mas o plano previa só PNG/JPG/WEBP | `handleReportPhotos` | CP2 (validação no servidor) |

## 6. Verificação de execução fora do Figma (27/10/2026)

Executado neste repositório, sem a pasta `.figma/`:

- `pnpm install --frozen-lockfile`: OK.
- `pnpm typecheck` (`tsc --noEmit`): sem erros.
- `pnpm build`: OK (JS 432 kB / 126 kB gzip).
- `pnpm preview` + Playwright (Chromium), desktop 1366×900 e celular 390×844:
  - as 6 telas públicas renderizam (título `h1` verificado);
  - o mapa cria 17 marcadores;
  - o formulário gera um protocolo;
  - nenhum erro de JavaScript.
- Os tiles do mapa não carregaram no ambiente de teste porque a rede bloqueia `tile.openstreetmap.de`. O carregamento real dos tiles **não foi verificado** e precisa ser testado numa máquina com internet.

## 7. Riscos

- **Tiles do mapa:** o protótipo já foi bloqueado no Figma por violar a política de uso dos servidores do OpenStreetMap (captura em `.figma/attachments`). O código atual usa `tile.openstreetmap.de`, que também tem política de uso. [Recomendação] No CP3, avaliar um provedor com uso gratuito permitido e crédito correto, e testar antes da apresentação.
- **Google Fonts** (DM Sans) depende de internet. Sem ela, a fonte cai para o padrão do sistema.
