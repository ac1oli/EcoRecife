# Plano: eliminar o “piscar” na navegação pública

## Objetivo

Tornar a troca entre **Início, Coleta, Zeladoria, EcoPontos e Benefícios** visualmente imediata e estável, sem tela intermediária, fade repetido, salto do rodapé ou rolagem perceptível, preservando o estado atual de cada serviço e a navegação por hash.

## Diagnóstico confirmado no código

- Cada página pública é renderizada condicionalmente em `src/App.tsx`; a página anterior é desmontada e a próxima é montada a cada mudança de `currentPage`.
- Todas as cinco páginas públicas recebem `animate-in fade-in duration-500`, fazendo a entrada visual ser reiniciada em toda navegação e favorecendo a percepção de “piscar”.
- `navigateTo` executa `window.scrollTo({ top: 0, behavior: 'smooth' })` no mesmo fluxo em que troca o conteúdo e atualiza o hash. A altura da página muda durante a rolagem suave, o que pode expor temporariamente o fundo ou deslocar o rodapé.
- O cabeçalho, rodapé e menu móvel já ficam fora dos blocos condicionais e podem continuar sendo a estrutura visual estável.
- Não é necessário introduzir React Router nem manter todas as páginas montadas. Manter tudo montado aumentaria o custo inicial e poderia causar problemas de dimensão no mapa Leaflet enquanto oculto.

## Abordagem recomendada

### 1. Remover a animação de entrada das páginas públicas

Em `src/App.tsx`, remover `animate-in fade-in duration-500` das seções de:

- Início;
- Coleta;
- Zeladoria;
- EcoPontos;
- Benefícios.

Manter transições locais de botões, cartões e controles. A mudança elimina apenas a animação de página inteira que reinicia a cada troca.

A animação da área de gestão pode permanecer fora deste escopo, pois o problema relatado ocorre apenas na navegação pública.

### 2. Tornar o reposicionamento de rolagem imediato

Ajustar `navigateTo` para:

- atualizar `currentPage` e o hash como hoje;
- posicionar o documento no topo sem `behavior: 'smooth'`;
- não repetir trabalho quando o destino já for a página atual, salvo quando for necessário voltar ao topo por uma ação explícita.

Usar rolagem instantânea (`behavior: 'auto'`) evita que a troca de conteúdo aconteça enquanto o viewport ainda percorre a página anterior.

### 3. Estabilizar a área central durante a troca

Adicionar à região principal pública uma altura mínima baseada na viewport, utilizando as classes e tokens já presentes no projeto, para impedir que o rodapé suba por um frame quando uma página curta substitui outra longa.

A altura mínima deve:

- considerar aproximadamente a área entre cabeçalho e rodapé;
- ser aplicada somente ao shell público, sem alterar login e gestão;
- não impor altura fixa nem criar rolagem extra em páginas com conteúdo longo.

### 4. Preservar o comportamento existente

Não alterar:

- URLs com hash (`#inicio`, `#coleta` etc.);
- botão voltar/avançar do navegador;
- estado dos filtros e formulários que já vive em `App`;
- inicialização normal do Leaflet ao entrar em Coleta;
- cabeçalho, rodapé ou navegação móvel;
- animações de interação internas.

## Casos especiais

- **Entrada direta por hash:** continuar abrindo diretamente a seção correta sem animação de página inteira.
- **Voltar/avançar do navegador:** o listener de `hashchange` continua sincronizando `currentPage`; a troca deve ocorrer sem fade.
- **Entrada no mapa:** o Leaflet continuará sendo montado apenas quando Coleta estiver ativa, evitando mapa inicializado em contêiner oculto.
- **Preferência por movimento reduzido:** a navegação ficará naturalmente compatível, pois não dependerá mais de animação global ou rolagem suave.
- **Mobile:** o menu inferior permanece fixo e a altura mínima deve respeitar o espaço já reservado para ele.

## Verificação

1. Navegar repetidamente entre as cinco seções pelo cabeçalho desktop.
2. Repetir pelo menu móvel em uma viewport estreita.
3. Testar a troca estando no topo e após rolar até o final de uma página longa.
4. Confirmar que não há fade branco, salto do rodapé ou rolagem animada.
5. Abrir diretamente cada hash e testar voltar/avançar do navegador.
6. Entrar em Coleta e confirmar que o mapa ocupa a dimensão correta e mantém os controles funcionais.
7. Confirmar que login e gestão não sofreram alterações visuais.
8. Executar `pnpm build` e registrar qualquer aviso não relacionado separadamente.

## Critério de conclusão

A troca entre as cinco páginas públicas deve acontecer no próximo frame, com cabeçalho/menu/rodapé visualmente estáveis, sem fade de página inteira, tela vazia, salto perceptível ou rolagem suave concorrente com a mudança de conteúdo.
