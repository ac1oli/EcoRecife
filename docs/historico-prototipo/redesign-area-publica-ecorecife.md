# Plano: redesenho da área pública do EcoRecife

## Objetivo

Transformar a área pública do EcoRecife em um portal de serviços ao cidadão mais intuitivo, consistente e fácil de usar em celular e desktop, preservando a identidade atual (DM Sans, eco-green, eco-blue e linguagem ambiental) e todas as funcionalidades existentes.

O redesenho deve deixar imediatamente claras as três tarefas prioritárias:

1. acompanhar a coleta;
2. registrar uma ocorrência;
3. encontrar um ponto de descarte.

A área de gestão não será redesenhada internamente nesta etapa. Ela receberá apenas um shell visual próprio para não compartilhar cabeçalho, navegação móvel e rodapé com a área pública.

## Decisões confirmadas

- Escopo principal: toda a área pública.
- Direção: evolução da identidade existente, não uma substituição de marca.
- Experiência: portal de serviços ao cidadão, com ações antes de conteúdo institucional.
- Responsividade: peso equivalente para celular e desktop.
- Conteúdo: títulos, microcopy e ordem dos blocos podem ser revisados.
- Formulário: bairro passa a ser um campo obrigatório separado do endereço.
- Mobile: navegação inferior persistente.
- Gestão: separação mínima do ambiente público, sem redesenho completo do painel.
- Persistência das ocorrências: manter `localStorage` e o fluxo já implementado.
- Não adicionar biblioteca de componentes, roteador ou outra dependência nesta etapa.
- Não usar fotografia: o produto é um portal utilitário e mapa/formulário são os elementos visuais relevantes.

## Diagnóstico da interface atual

### Estrutura

- `src/App.tsx` concentra rotas, dados demonstrativos, estado, páginas e todos os elementos visuais em um único arquivo com mais de 900 linhas.
- Cabeçalho e rodapé públicos também aparecem na gestão, enfraquecendo a separação entre portal cidadão e sistema operacional.
- A navegação mobile depende de um drawer; as ações mais importantes somem depois que ele é fechado.
- Os padrões de card, campo, chip, badge e feedback são repetidos manualmente e apresentam pequenas diferenças.

### Hierarquia e usabilidade

- A página inicial comunica a proposta, mas demora a apresentar os serviços prioritários.
- O mapa combina busca sobreposta, filtros externos, legenda, painel de detalhe e lista; em telas pequenas, esses elementos competem por espaço.
- O formulário mistura instruções e preenchimento, e o campo livre “Endereço / Bairro” causa registros classificados como “Bairro a confirmar”.
- EcoPontos têm filtros úteis, mas falta uma busca textual e uma indicação de resultado mais clara.
- Benefícios mostra títulos de pilares sem explicações suficientes; a página parece menos completa que as demais.
- Feedbacks, estados vazios e mensagens operacionais não seguem um padrão único.

## Arquitetura de implementação

### 1. Modularizar sem alterar a tecnologia de navegação

Manter o roteamento por hash e as dependências atuais. Não introduzir React Router.

Refatorar `src/App.tsx` para atuar como orquestrador de:

- página atual;
- estado compartilhado do mapa;
- ocorrências e persistência;
- filtros compartilhados quando necessário;
- callbacks de navegação.

Extrair componentes/páginas para uma estrutura pequena e explícita:

- `src/components/AppShell.tsx`
  - `PublicHeader`;
  - `PublicMobileNav`;
  - `PublicFooter`;
  - `ManagementHeader`.
- `src/components/ui.tsx`
  - `PageIntro`;
  - `SectionHeading`;
  - `StatusBadge`;
  - `FilterChip`;
  - `EmptyState`;
  - `FormField` apenas quando remover repetição real.
- `src/pages/HomePage.tsx`
- `src/pages/CollectionMapPage.tsx`
- `src/pages/ReportPage.tsx`
- `src/pages/EcoPointsPage.tsx`
- `src/pages/BenefitsPage.tsx`
- `src/pages/LoginPage.tsx`
- `src/pages/ManagementPage.tsx`
- `src/data/mockData.ts` para os locais do mapa, EcoPontos e ocorrências demonstrativas.
- `src/types.ts` para `Page`, `MapLocation`, `Occurrence` e tipos relacionados.

A extração deve preservar os handlers e a persistência atuais. Não criar uma abstração genérica para cada elemento; somente padrões realmente repetidos devem virar componentes.

### 2. Consolidar tokens visuais

Em `src/index.css`, manter os tokens existentes e complementar apenas o necessário:

- superfícies: fundo geral, branco, verde muito claro e azul muito claro;
- texto: `eco-900` para títulos, slate para texto secundário;
- semântica: verde para ação/sucesso, azul para localização/informação, âmbar para atenção, vermelho apenas para urgência/erro e roxo para cooperativas;
- raios consistentes para controles, cards e painéis;
- sombras mais leves e usadas somente para elevação real;
- estados de foco visíveis e uniformes;
- suporte a `prefers-reduced-motion` para reduzir animações de entrada e transições não essenciais.

Evitar adicionar novos valores hexadecimais no JSX. Reutilizar os tokens Tailwind existentes ou declarar novos tokens semânticos em `@theme` quando necessário.

## Shell e navegação

### Desktop/tablet

Criar um cabeçalho público mais leve:

- fundo branco com borda inferior discreta;
- marca EcoRecife à esquerda;
- links centrais com nomes curtos: Início, Coleta, Ocorrências, EcoPontos e Benefícios;
- estado ativo por cor, peso e indicador, não apenas por fundo;
- CTA primário “Relatar ocorrência” à direita;
- cabeçalho sticky sem ocupar altura excessiva.

### Celular

- Cabeçalho superior compacto apenas com marca e status do serviço ou ação contextual.
- Remover o drawer atual e os estados `isMenuOpen` associados.
- Adicionar barra inferior fixa com cinco destinos:
  - Início;
  - Coleta;
  - Relatar;
  - EcoPontos;
  - Benefícios.
- Usar ícone e rótulo em todos os itens.
- Aplicar `aria-current="page"` no item ativo.
- Garantir alvos de toque com pelo menos 44 px e respeitar a safe area inferior.
- Adicionar padding inferior ao conteúdo e ao rodapé para que a barra não cubra elementos.

### Shell da gestão

Quando `currentPage === 'gestao'`:

- não renderizar `PublicHeader`, `PublicMobileNav` nem `PublicFooter`;
- renderizar um cabeçalho operacional compacto com marca, rótulo “Gestão EcoRecife” e ação “Sair”;
- manter intactos os cards, filtros, Central de Ocorrências e Visão Geral atuais.

Na página de login:

- usar um layout intermediário e simples;
- oferecer “Voltar ao portal” claramente;
- não exibir a navegação móvel de serviços durante o preenchimento do login.

## Redesenho por página

### 1. Início

Reordenar a página para priorizar tarefas:

#### Hero utilitário

- Eyebrow de serviço municipal/protótipo.
- Título curto orientado à ação, por exemplo “Cuidar do Recife ficou mais simples”.
- Texto de apoio com uma única frase.
- CTA primário “Acompanhar coleta”.
- CTA secundário “Relatar ocorrência”.
- Card operacional ao lado no desktop e abaixo no mobile, com dados resumidos e indicação clara de que são simulados.

#### Acesso rápido

Logo após o hero, três cards de serviço:

- Coleta em tempo real;
- Relatar problema;
- Encontrar EcoPonto.

Cada card deve conter ícone, título, descrição de uma linha e CTA explícito. O card inteiro pode ser clicável, mas deve manter semântica e foco acessível de botão/link.

#### Panorama e orientação

- Reaproveitar os números atuais em uma faixa compacta, sem competir com as tarefas.
- Acrescentar uma seção curta “Como funciona” com três passos, evitando textos institucionais longos.
- Encaminhar conteúdo ambiental aprofundado para Benefícios.

### 2. Coleta e mapa

#### Controles

- Retirar a busca de dentro do mapa em telas pequenas.
- Criar uma barra de ferramentas acima do mapa com:
  - busca por bairro;
  - filtros Todos, Caminhões, EcoPontos e Cooperativas;
  - contagem de resultados.
- No desktop, busca e filtros podem permanecer na mesma linha; no mobile, usar rolagem horizontal nos chips, sem quebra excessiva.
- Manter busca tolerante a acentos e todos os marcadores, incluindo Vasco da Gama.

#### Conteúdo

- Desktop: mapa em aproximadamente 8 colunas e painel de detalhe em 4 colunas.
- Mobile: mapa primeiro, com altura reduzida e adequada à viewport; detalhe selecionado logo abaixo.
- Antes de uma seleção, o painel deve mostrar instrução objetiva e uma lista curta de pontos visíveis, em vez de blocos vazios.
- Depois da seleção, destacar nome, bairro, status, atendimento e atualização.
- Manter a ação simulada de rota, mas rotulá-la como “Simular rota” para não sugerir navegação real.
- Preservar diferenciação dos marcadores por cor, forma e letra.
- Tornar legenda e lista coerentes com os filtros ativos.

#### Feedback

- Mensagens de bairro não encontrado e rota simulada devem usar um componente de feedback consistente.
- Não usar timeout como única forma de acesso à mensagem; incluir região `aria-live`.

### 3. Zeladoria Cidadã

Reestruturar como fluxo de formulário claro, sem transformar em wizard de múltiplas telas:

#### Introdução

- Título direto: “Relate um problema ambiental”.
- Explicação curta do que pode ser registrado.
- Linha de confiança: envio rápido, protocolo imediato e acompanhamento pela gestão.

#### Formulário

Organizar em três grupos visuais numerados:

1. **O que aconteceu**
   - tipo de ocorrência;
   - descrição.
2. **Onde aconteceu**
   - bairro obrigatório em campo separado;
   - endereço ou ponto de referência obrigatório.
3. **Comprove, se puder**
   - foto opcional;
   - prévia com ação clara de remover/trocar.

Para o bairro:

- usar um input obrigatório com `datalist` de bairros demonstrados no sistema, permitindo também digitar outro bairro do Recife;
- salvar diretamente o valor em `Occurrence.neighborhood`;
- manter fallback defensivo para dados antigos que não tenham bairro separado;
- remover a dependência de inferir bairro a partir do endereço para novos registros.

Outros ajustes:

- indicar campos obrigatórios uma única vez no início e nos labels;
- usar mensagens de validação junto ao grupo relevante;
- manter o botão principal fixado apenas visualmente ao final do formulário, sem sticky que cubra conteúdo;
- desabilitar o botão durante o processamento simulado, ainda que breve, para evitar envio duplicado;
- preservar geração de protocolo e persistência em `localStorage`.

#### Sucesso

- Mostrar confirmação com protocolo em destaque.
- Explicar que o relato foi enviado à Central.
- Oferecer duas ações: “Registrar outra ocorrência” e “Voltar ao início”.
- Não dar acesso direto à área restrita.

### 4. EcoPontos

- Adicionar busca textual por nome, bairro e materiais.
- Manter chips de materiais, com estado ativo mais evidente e botão para limpar filtros.
- Mostrar quantidade de resultados.
- Reestruturar cards com esta ordem:
  1. tipo e status;
  2. nome e bairro/distância;
  3. horário;
  4. materiais aceitos;
  5. ação “Ver no mapa”.
- Usar badge azul para EcoPonto e roxo para cooperativa.
- Preservar a navegação que seleciona o marcador correspondente no mapa.
- Melhorar estado vazio com ação “Limpar filtros”.

### 5. Benefícios

- Manter o simulador como elemento principal da página.
- Completar os cinco pilares com descrições curtas e orientadas a impacto real.
- Reduzir cards puramente decorativos; cada pilar deve explicar o benefício em uma ou duas frases.
- Organizar a página em:
  - introdução;
  - simulador;
  - impactos para cidadão, cidade e cooperativas;
  - CTA final para encontrar um EcoPonto.
- Garantir que o range tenha label acessível, valor atual anunciado e bom alvo de toque.

### 6. Rodapé

- Simplificar a navegação repetida.
- Separar marca/proposta, links de serviço e acesso à gestão.
- Tratar “Área da Gestão” como link secundário com ícone de cadeado.
- Manter a indicação de protótipo acadêmico visível.
- No mobile, respeitar o espaço da navegação inferior.

## Dados e fluxo das ocorrências

Atualizar o envio para usar campos separados:

- `neighborhood = formData.get('neighborhood')`;
- `address = formData.get('location')`;
- manter `type`, `description`, protocolo, status e prioridade atuais.

Compatibilidade:

- ocorrências já persistidas em `localStorage` continuam válidas porque já possuem `neighborhood` e `address`;
- não alterar a chave `ecorecife:occurrences:v1` se o formato do objeto não mudar;
- o registro novo deve aparecer na Central depois do login, com filtros limpos, como já planejado/implementado;
- não persistir URLs temporárias de fotos.

## Estados e acessibilidade

Aplicar em todas as páginas:

- foco visível em botões, links, inputs, selects e chips;
- labels associados corretamente aos controles;
- `aria-current` na navegação;
- `aria-live` para mensagens de busca, envio e simulação de rota;
- ícones sempre acompanhados por texto quando representam uma ação;
- contraste mínimo adequado para texto e controles;
- não depender apenas de cor para status;
- estados de hover, focus, active e disabled consistentes;
- estados vazios com explicação e próximo passo;
- áreas clicáveis com tamanho adequado;
- títulos em ordem semântica por página;
- redução de movimento conforme preferência do sistema.

## Fora de escopo

- Redesenho interno completo da área de gestão.
- Backend, autenticação real ou sincronização entre dispositivos.
- Otimização real de rotas.
- Geolocalização real do cidadão.
- Upload persistente de fotos.
- Novas bibliotecas de UI, gráficos ou mapas.
- Mudança de React, Vite, Tailwind ou Leaflet.

## Sequência de implementação

1. Extrair tipos e dados demonstrativos sem alterar comportamento.
2. Criar shells público/gestão e componentes visuais compartilhados.
3. Implementar novo cabeçalho desktop e navegação inferior mobile.
4. Redesenhar Início.
5. Redesenhar mapa e seus estados responsivos.
6. Redesenhar Zeladoria e separar bairro/endereço no fluxo de dados.
7. Redesenhar EcoPontos.
8. Redesenhar Benefícios.
9. Simplificar login e rodapé.
10. Revisar consistência visual, acessibilidade e responsividade.
11. Executar verificação funcional e build.

Cada etapa deve preservar o funcionamento das páginas já migradas; evitar uma substituição integral sem pontos intermediários compiláveis.

## Verificação

### Técnica

- Executar `pnpm run build`.
- Executar `git diff --check`.
- Não iniciar outro servidor de desenvolvimento.
- Confirmar que nenhuma dependência foi adicionada.

### Responsividade

Verificar no preview pelo menos:

- celular estreito, aproximadamente 390 px;
- tablet, aproximadamente 768 px;
- desktop, aproximadamente 1280 px.

Em cada largura, confirmar:

- ausência de overflow horizontal;
- conteúdo não encoberto pela navegação inferior;
- filtros utilizáveis;
- mapa com altura adequada;
- campos e botões com alvos de toque confortáveis.

### Fluxos funcionais

1. Navegar por todas as páginas no desktop e na barra inferior mobile.
2. Confirmar destaque correto da página ativa.
3. Buscar bairros no mapa com e sem acentos.
4. Filtrar os tipos de marcador, selecionar um ponto e simular rota.
5. Abrir um EcoPonto no mapa a partir do card.
6. Filtrar e buscar EcoPontos; limpar filtros e validar estado vazio.
7. Registrar ocorrência com bairro e endereço separados.
8. Confirmar protocolo e persistência após recarga.
9. Entrar na gestão e confirmar que o registro aparece com o bairro informado.
10. Alterar status, recarregar e confirmar persistência.
11. Sair da gestão e confirmar retorno ao portal público.
12. Usar o simulador de benefícios por teclado e toque.

### Regressões específicas

- O mapa continua usando tiles sem chave da OpenStreetMap DE.
- Todos os 16 marcadores permanecem disponíveis, incluindo Vasco da Gama.
- Marcadores mantêm tipos, cores, seleção e detalhes.
- A gestão não perde Central, filtros, dados ou Visão Geral.
- Dados existentes no `localStorage` não são apagados ou duplicados.
- O login fictício continua funcional.

## Critérios de sucesso

- Um novo usuário identifica as três ações principais sem abrir menus.
- Em celular, qualquer seção pública fica acessível em um toque pela barra inferior.
- O formulário deixa de gerar “Bairro a confirmar” para novos registros preenchidos corretamente.
- Mapa e EcoPontos apresentam filtros e resultados de forma coerente.
- A gestão é percebida como ambiente separado, sem redesenho fora do escopo.
- Todas as funcionalidades atuais continuam operacionais e o build termina com sucesso.
