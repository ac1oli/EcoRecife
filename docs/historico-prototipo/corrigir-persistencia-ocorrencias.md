# Plano: corrigir integração entre o relato cidadão e a Central de Ocorrências

## Objetivo

Garantir que toda ocorrência criada no formulário de Zeladoria Cidadã apareça na Central de Ocorrências e continue disponível após navegação, atualização da página ou reinício do preview no mesmo navegador.

## Diagnóstico confirmado

- O formulário já cria um objeto `Occurrence` e o adiciona com `setOccurrences` em `src/App.tsx`.
- A Central já renderiza a mesma coleção `occurrences`.
- A coleção é inicializada diretamente com `initialOccurrences` e existe apenas no estado React.
- Não há `localStorage`, `sessionStorage`, banco de dados ou outro mecanismo de persistência no projeto.
- Consequentemente, qualquer recarga/reinicialização recria a coleção somente com os dados demonstrativos e remove as ocorrências registradas pelo usuário.
- Mesmo sem recarga, uma busca, um filtro de bairro/status ou a aba “Visão Geral” previamente selecionada pode impedir que o novo item fique visível ao entrar na gestão.

## Decisão de arquitetura

Usar `localStorage`, adequado ao caráter acadêmico e de protótipo do projeto. A solução ficará explícita como persistência local do navegador, não como banco municipal ou sincronização multiusuário.

Não adicionar dependências nem backend nesta etapa.

## Implementação

### 1. Criar uma fronteira de persistência local

Em `src/App.tsx`:

- Definir uma chave versionada, por exemplo `ecorecife:occurrences:v1`.
- Criar uma função `loadOccurrences` usada como inicializador preguiçoso de `useState`.
- A função deve:
  - ler a chave no `localStorage`;
  - fazer o parse do JSON;
  - aceitar apenas um array;
  - retornar os dados persistidos quando válidos;
  - retornar `initialOccurrences` quando não houver dados, o JSON estiver corrompido ou o armazenamento estiver indisponível.
- Copiar o array demonstrativo ao usar o fallback, evitando tratar a constante como estado mutável.

### 2. Persistir todas as alterações

- Adicionar um `useEffect` dependente de `occurrences` para serializar a coleção completa no `localStorage`.
- Esse efeito deve cobrir tanto:
  - novas ocorrências enviadas pelo formulário;
  - mudanças de status feitas na Central.
- Proteger a escrita com `try/catch`; falhas de armazenamento não devem quebrar o formulário nem a Central.
- Não persistir a URL temporária da foto (`URL.createObjectURL`), pois ela deixa de ser válida após recarga e não faz parte do tipo `Occurrence` atual.

### 3. Garantir visibilidade ao entrar na gestão

- Criar uma função de entrada na gestão, reutilizada pelo submit do login, que:
  - selecione `managementView = 'ocorrencias'`;
  - limpe `occurrenceSearch`;
  - restaure o filtro de status para `Todos`;
  - restaure o filtro de bairro para `Todos`;
  - navegue para `gestao`.
- Isso elimina falsos negativos causados por filtros ou pela aba “Visão Geral” mantidos na sessão.

### 4. Dar feedback de integração no sucesso do formulário

- Manter a confirmação e o protocolo já existentes.
- Acrescentar uma mensagem curta informando que o relato foi encaminhado para a Central de Ocorrências.
- Não abrir a área restrita automaticamente e não contornar o login fictício.

### 5. Manter compatibilidade com os dados atuais

- Preservar `initialOccurrences` como conjunto inicial da demonstração.
- Na primeira execução, a Central começa com os dados demonstrativos.
- Depois da primeira gravação, o estado persistido passa a ser a fonte local de verdade.
- Não mesclar novamente os mocks a cada carregamento, evitando duplicação de protocolos.
- Protocolos novos continuam no formato atual `ECO-2026-####`; nesta etapa não é necessário alterar a estratégia de geração.

## Tratamento de casos extremos

- `localStorage` bloqueado ou indisponível: aplicação continua funcionando em memória durante a sessão.
- JSON inválido na chave: usar os dados demonstrativos sem quebrar a tela.
- Array vazio persistido: respeitar o array vazio, em vez de repor automaticamente os mocks.
- Registro enviado com endereço sem bairro reconhecido: manter `Bairro a confirmar`; ele deve aparecer normalmente na lista e no agrupamento.
- Filtros previamente selecionados: limpar ao concluir o login para tornar o novo protocolo visível.
- Alteração de status seguida de recarga: manter o status persistido.

## Arquivos afetados

- `src/App.tsx`
  - carregamento e salvamento local;
  - entrada padronizada na Central;
  - texto de confirmação do envio.

Nenhuma alteração de dependências ou infraestrutura é necessária.

## Verificação

### Fluxo manual principal

1. Abrir Zeladoria Cidadã.
2. Registrar uma ocorrência e anotar o protocolo exibido.
3. Acessar “Área da Gestão” pelo rodapé e concluir o login fictício.
4. Confirmar que a aba Central de Ocorrências abre com filtros limpos.
5. Confirmar que o protocolo registrado aparece no topo da fila com status `Recebida`.
6. Atualizar a página diretamente em `#gestao` e confirmar que o registro permanece.
7. Alterar o status para `Em análise`, atualizar novamente e confirmar a persistência.

### Casos adicionais

- Aplicar filtros, sair da gestão, registrar outra ocorrência e entrar novamente; confirmar que os filtros foram limpos.
- Inserir manualmente JSON inválido na chave de armazenamento durante desenvolvimento e confirmar o fallback sem tela quebrada.
- Confirmar que os dados demonstrativos não são duplicados após múltiplas recargas.

### Verificação técnica

- Executar `pnpm run build`.
- Executar `git diff --check`.
- Verificar que nenhuma dependência foi adicionada e que o fluxo existente do formulário, login e atualização de status continua funcional.

## Limitação documentada

A persistência será específica do navegador/dispositivo. Sincronização entre usuários ou dispositivos diferentes fica fora deste escopo e exigiria uma etapa futura com backend, autenticação e banco de dados, como Supabase.
