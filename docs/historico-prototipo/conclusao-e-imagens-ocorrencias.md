# Plano: conclusão de ocorrências e galeria de imagens na gestão

## Objetivo

Evoluir o fluxo de Zeladoria Cidadã e a Central de Ocorrências para que:

1. o cidadão possa anexar até três imagens a uma ocorrência;
2. as imagens persistam no mesmo navegador após atualização da página;
3. o colaborador consiga identificar ocorrências com anexos e visualizar uma galeria ampliada;
4. o colaborador possa concluir uma ocorrência por uma ação explícita;
5. ocorrências concluídas saiam da fila ativa, permaneçam em um histórico e possam ser reabertas;
6. a conclusão possa receber uma observação opcional e registre automaticamente data e hora.

A solução continuará adequada ao protótipo acadêmico e não adicionará backend, credenciais ou dependências externas.

## Decisões confirmadas

- Armazenamento das imagens: IndexedDB nativo do navegador.
- Metadados das ocorrências: continuar no `localStorage`.
- Quantidade: até três imagens por ocorrência.
- Formatos aceitos: PNG, JPG/JPEG e WEBP.
- Limite: 5 MB por imagem, até 15 MB por ocorrência.
- Conclusão: fila ativa separada do histórico de concluídas.
- Reabertura: permitida.
- Observação de conclusão: opcional.
- Visualização: miniatura na ocorrência e galeria/modal ampliada.
- Escopo local: dados e imagens ficam disponíveis somente no mesmo navegador/dispositivo.
- Não incluir Supabase, upload remoto ou autenticação real nesta etapa.

## Diagnóstico atual

### Imagens

- `reportPhoto` em `src/App.tsx` armazena apenas uma string criada com `URL.createObjectURL`.
- A URL serve somente para a prévia temporária no formulário.
- O arquivo não é incluído no tipo `Occurrence`, não é gravado no `localStorage` e não é acessível pela gestão.
- Após recarregar a página, a URL deixa de ser válida.
- O formulário anuncia limite de 5 MB, mas não valida tamanho ou formato programaticamente.

### Conclusão

- `OccurrenceStatus` já inclui `Resolvida`.
- O colaborador pode escolher esse status em um `select`, mas a ação não tem destaque, confirmação ou observação.
- Ocorrências resolvidas continuam misturadas na mesma fila.
- Não existe data de conclusão, histórico separado ou ação de reabertura.

## Modelo de dados

### 1. Metadados das fotos

Adicionar em `src/types.ts`:

```ts
export type OccurrencePhoto = {
  id: string;
  name: string;
  type: 'image/jpeg' | 'image/png' | 'image/webp';
  size: number;
};
```

Atualizar `Occurrence` com campos opcionais:

```ts
photos?: OccurrencePhoto[];
completedAt?: string;
resolutionNote?: string;
```

Os blobs não entram no objeto `Occurrence` nem no `localStorage`. Somente os metadados e IDs são serializados.

### 2. Status

Alterar o tipo para:

```ts
type OccurrenceStatus =
  | 'Recebida'
  | 'Em análise'
  | 'Equipe designada'
  | 'Concluída';
```

`Concluída` substitui `Resolvida` em novos dados, filtros, indicadores e componentes.

### 3. Chave de persistência e migração

Criar uma chave versionada nova:

```ts
const OCCURRENCES_STORAGE_KEY = 'ecorecife:occurrences:v2';
const LEGACY_OCCURRENCES_STORAGE_KEY = 'ecorecife:occurrences:v1';
```

No carregamento:

1. tentar ler `v2`;
2. se não existir, ler `v1`;
3. normalizar cada ocorrência legada:
   - `Resolvida` vira `Concluída`;
   - ocorrências sem `photos` recebem `photos: []` ou mantêm o campo ausente;
   - ocorrências legadas concluídas podem ficar sem `completedAt`, exibindo “Data não registrada”;
4. validar o objeto normalizado;
5. usar os mocks se o JSON estiver ausente ou inválido;
6. persistir o resultado normalizado em `v2` pelo efeito já existente.

Não duplicar mocks nem apagar a chave antiga durante a migração. A aplicação deve respeitar um array vazio persistido.

## Persistência de imagens com IndexedDB

### 1. Criar serviço isolado

Adicionar `src/lib/occurrencePhotoStorage.ts` sem dependências externas.

Configuração:

- banco: `ecorecife-media`;
- versão: `1`;
- object store: `occurrence-photos`;
- `keyPath`: `id`.

Registro interno:

```ts
type StoredOccurrencePhoto = OccurrencePhoto & {
  occurrenceId: number;
  blob: Blob;
};
```

Expor funções:

```ts
saveOccurrencePhotos(
  occurrenceId: number,
  files: File[]
): Promise<OccurrencePhoto[]>

getOccurrencePhoto(photoId: string): Promise<Blob | null>

deleteOccurrencePhotos(photoIds: string[]): Promise<void>
```

IDs devem ser determinísticos e únicos no contexto do envio, por exemplo `occurrence-${occurrenceId}-${index}`. O `occurrenceId` será criado antes da gravação usando `Date.now()`.

### 2. Transação de gravação

- Salvar as imagens de uma ocorrência em uma única transação `readwrite`.
- Resolver a promise somente após `transaction.oncomplete`.
- Rejeitar em `transaction.onerror` ou `transaction.onabort`.
- Se um `put` falhar, abortar a transação para evitar galeria parcialmente salva.
- Não serializar Blob como base64 e não gravar conteúdo binário no `localStorage`.

### 3. Falhas

- IndexedDB indisponível sem imagens selecionadas: a ocorrência continua podendo ser enviada.
- IndexedDB indisponível com imagens selecionadas: não concluir silenciosamente o envio; mostrar erro junto à seção de anexos e permitir remover as imagens ou tentar novamente.
- Blob ausente para um metadado: a gestão mostra “Imagem indisponível” sem quebrar o card ou a galeria.
- Falha ao carregar uma imagem não impede as demais de aparecerem.
- Não excluir fotos ao concluir ou reabrir, pois elas fazem parte do registro.

## Formulário público

### 1. Estado dos arquivos

Substituir `reportPhoto: string | null` por uma coleção que preserve `File` e URL de prévia:

```ts
type SelectedReportPhoto = {
  file: File;
  previewUrl: string;
};
```

Estado:

```ts
const [reportPhotos, setReportPhotos] = useState<SelectedReportPhoto[]>([]);
const [reportSubmitting, setReportSubmitting] = useState(false);
const [reportPhotoError, setReportPhotoError] = useState<string | null>(null);
```

### 2. Seleção e validação

Configurar o input com `multiple` e `accept="image/png,image/jpeg,image/webp"`.

Ao selecionar:

- aceitar no máximo três imagens no total, incluindo as já selecionadas;
- rejeitar MIME types diferentes de PNG, JPEG ou WEBP;
- rejeitar arquivo maior que 5 MB;
- evitar duplicação do mesmo arquivo usando nome, tamanho e `lastModified`;
- criar `URL.createObjectURL` somente para arquivos aceitos;
- informar erros específicos, sem descartar arquivos válidos do mesmo lote.

Exemplos de mensagens:

- “Você pode enviar no máximo 3 imagens.”
- “A imagem foto.png ultrapassa o limite de 5 MB.”
- “O formato de arquivo documento.pdf não é aceito.”

### 3. Prévia

Exibir uma grade responsiva com até três miniaturas. Cada item deve ter:

- imagem com `alt` descritivo baseado na posição;
- nome do arquivo truncado;
- tamanho formatado;
- botão “Remover imagem”.

A área de seleção permanece visível enquanto houver menos de três imagens, indicando quantas vagas restam.

Ao remover ou resetar:

- chamar `URL.revokeObjectURL` para a URL correspondente;
- limpar erros que deixaram de ser aplicáveis.

No unmount do componente/aplicação, revogar todas as URLs ainda existentes para evitar vazamento de memória.

### 4. Envio assíncrono

Transformar `handleReportSubmit` em função assíncrona:

1. validar campos textuais;
2. impedir novo envio com `reportSubmitting = true`;
3. gerar `id` e protocolo;
4. se houver arquivos, chamar `saveOccurrencePhotos`;
5. montar `Occurrence` com os metadados retornados;
6. adicionar a ocorrência ao estado e, por consequência, ao `localStorage` v2;
7. mostrar a confirmação atual;
8. limpar e revogar as prévias;
9. restaurar `reportSubmitting` em `finally`.

Enquanto envia:

- desabilitar o botão;
- trocar o texto para “Registrando ocorrência…”;
- exibir indicador visual discreto;
- bloquear envio duplicado.

Se a gravação das fotos falhar:

- não criar a ocorrência;
- preservar campos e prévias;
- informar que as imagens não puderam ser salvas;
- permitir tentar novamente ou remover os anexos.

## Central de Ocorrências

### 1. Separar fila e histórico

Adicionar estado:

```ts
const [occurrenceQueueView, setOccurrenceQueueView] =
  useState<'active' | 'completed'>('active');
```

No topo da Central, incluir controle segmentado:

- **Em aberto**: status diferente de `Concluída`;
- **Concluídas**: status `Concluída`.

Cada opção mostra sua contagem. Ao entrar na gestão:

- abrir `managementView = 'ocorrencias'`;
- abrir `occurrenceQueueView = 'active'`;
- limpar busca e filtros, como já ocorre.

Atualizar a filtragem nesta ordem:

1. separar pela fila ativa/concluída;
2. aplicar busca;
3. aplicar bairro;
4. na fila ativa, aplicar status operacional.

No histórico, ocultar o seletor de status global porque todas as ocorrências já são concluídas.

### 2. Indicadores

Atualizar os cards:

- Recebidas;
- Urgentes em aberto;
- Em atendimento;
- Concluídas.

Todos devem derivar do estado real. Substituir textos “Resolvidas” por “Concluídas”.

O resumo de demanda por bairro deve continuar contando somente ocorrências não concluídas.

### 3. Andamento ativo

Para ocorrências abertas, manter o seletor somente com:

- Recebida;
- Em análise;
- Equipe designada.

Remover `Concluída` do seletor. A conclusão passa a ser uma ação explícita e destacada.

Adicionar botão **“Concluir ocorrência”** no card. O botão abre o diálogo de conclusão.

### 4. Diálogo de conclusão

Criar um diálogo acessível com:

- protocolo e tipo da ocorrência;
- confirmação de que ela sairá da fila ativa;
- textarea “Observação do atendimento (opcional)”;
- limite de 500 caracteres e contador;
- botão “Cancelar”;
- botão primário “Concluir ocorrência”.

Ao confirmar:

```ts
status: 'Concluída'
completedAt: new Date().toISOString()
resolutionNote: trimmedNote || undefined
```

Depois:

- fechar o diálogo;
- manter o usuário na fila ativa;
- remover o card da fila por derivação do estado;
- atualizar contadores;
- anunciar em uma região `aria-live` que a ocorrência foi concluída.

### 5. Histórico e reabertura

Cards concluídos devem mostrar:

- badge “Concluída”;
- data e hora formatadas em `pt-BR`, ou “Data não registrada” para dados migrados;
- observação, quando existir;
- fotos, quando existirem;
- ação “Reabrir ocorrência”.

A reabertura deve pedir confirmação simples. Ao confirmar:

```ts
status: 'Em análise'
completedAt: undefined
resolutionNote: undefined
```

Depois:

- remover o card do histórico por derivação;
- atualizar contadores;
- anunciar que a ocorrência voltou para a fila ativa.

Não excluir a ocorrência nem as imagens.

## Visualização das imagens na gestão

### 1. Componente de miniatura

Criar componentes em arquivo dedicado, por exemplo `src/components/OccurrencePhotos.tsx`:

- `OccurrencePhotoThumbnail`;
- `OccurrencePhotoGallery`.

A miniatura deve:

- carregar o primeiro Blob por ID usando `getOccurrencePhoto`;
- criar uma URL com `URL.createObjectURL`;
- revogar a URL no cleanup;
- exibir skeleton enquanto carrega;
- exibir fallback se o Blob estiver ausente;
- mostrar badge `+1` ou `+2` quando houver mais imagens;
- abrir a galeria ao clicar;
- incluir texto “Ver imagens” para não depender apenas da miniatura.

Ocorrências sem `photos` não exibem área vazia nem botão desabilitado.

### 2. Galeria ampliada

A galeria deve ser um modal acessível:

- `role="dialog"`;
- `aria-modal="true"`;
- título associado ao protocolo;
- fundo escurecido;
- botão fechar visível;
- fechar com Escape e clique no backdrop;
- impedir que o clique dentro do conteúdo feche o modal;
- foco inicial no botão fechar;
- restaurar foco ao botão que abriu;
- bloquear rolagem do documento enquanto aberta.

Para até três imagens:

- mostrar imagem principal com `object-contain`;
- botões anterior/próxima quando houver mais de uma;
- faixa de miniaturas selecionáveis;
- indicador “1 de 3”;
- nome do arquivo;
- fallback individual para arquivo indisponível.

As URLs de objeto criadas para a galeria devem ser revogadas ao fechar ou desmontar.

### 3. Posição no card

Na fila e no histórico:

- desktop: miniatura à esquerda ou dentro do bloco principal, sem reduzir excessivamente a largura dos detalhes;
- mobile: miniatura em largura total abaixo da descrição;
- manter ações de status/conclusão separadas da ação “Ver imagens”.

## Componentes e organização

Arquivos previstos:

- `src/types.ts`
  - metadados das fotos;
  - novo status;
  - campos de conclusão.
- `src/lib/occurrencePhotoStorage.ts`
  - acesso ao IndexedDB.
- `src/components/OccurrencePhotos.tsx`
  - miniatura e galeria.
- `src/components/OccurrenceCompletionDialog.tsx`
  - confirmação, observação e reabertura, ou dois componentes pequenos se a composição ficar mais clara.
- `src/App.tsx`
  - estado do formulário;
  - envio assíncrono;
  - migração de persistência;
  - separação fila/histórico;
  - integração dos componentes.
- `src/index.css`
  - apenas ajustes globais necessários ao modal, foco ou bloqueio visual que não sejam bem expressos pelas classes existentes.

Não adicionar bibliotecas de modal, IndexedDB, formulário ou galeria.

## Acessibilidade e segurança de interface

- Não confiar apenas em cor para diferenciar concluída/aberta.
- Botões de anexos devem ter rótulos específicos, como “Remover imagem 2”.
- Erros de seleção e gravação em região `aria-live`.
- Modal fecha por teclado e mantém foco controlado.
- Imagens usam `alt` contextual, sem repetir o nome bruto quando não for útil.
- Botão de conclusão tem confirmação para evitar mudança acidental.
- Reabertura também exige confirmação.
- Observação é tratada como texto e renderizada diretamente pelo React; não usar `dangerouslySetInnerHTML`.
- Não registrar conteúdo binário ou nomes de arquivos em logs.

## Casos extremos

- Seleção de quatro ou mais arquivos: aceitar somente até completar três e explicar o limite.
- Lote misto com arquivos válidos e inválidos: manter válidos e listar erros dos inválidos.
- Arquivo duplicado: ignorar e informar.
- Arquivo renomeado mas com mesmo conteúdo: não é necessário detectar hash; deduplicação por nome, tamanho e `lastModified` é suficiente.
- Falta de espaço no IndexedDB: manter o formulário preenchido, mostrar erro e não criar ocorrência incompleta.
- Metadado existe, Blob não: fallback individual na gestão.
- Ocorrência sem fotos: card permanece compacto.
- Ocorrência v1 com `Resolvida`: migrar para `Concluída` sem data.
- Ocorrência concluída sem observação: omitir o bloco de observação.
- Reabrir e concluir novamente: a nova conclusão substitui data e observação anteriores; histórico de múltiplos ciclos fica fora deste escopo.
- Atualização durante modal aberto: estado persistido continua sendo a fonte; o modal não deve gerar exceção se o item deixar de existir da lista derivada.

## Fora de escopo

- Sincronização de imagens entre dispositivos.
- Supabase ou outro backend.
- Upload com progresso real de rede.
- Compressão ou edição de imagem.
- Captura direta obrigatória pela câmera.
- Download das imagens pela gestão.
- Exclusão definitiva de ocorrências.
- Histórico/auditoria de múltiplas conclusões e reaberturas.
- Identificação real do colaborador que concluiu.
- Fotos de resolução enviadas pela equipe de campo.

## Sequência de implementação

1. Atualizar tipos e criar migração de `v1` para `v2`.
2. Implementar e validar o serviço IndexedDB isolado.
3. Refatorar seleção de fotos para até três arquivos com validação e cleanup.
4. Tornar o envio assíncrono e salvar blobs antes da ocorrência.
5. Criar carregamento de miniaturas e galeria.
6. Integrar anexos aos cards da Central.
7. Separar fila ativa e histórico concluído.
8. Criar diálogo de conclusão com observação opcional.
9. Criar confirmação de reabertura.
10. Atualizar indicadores, filtros e textos de `Resolvida` para `Concluída`.
11. Revisar acessibilidade, persistência e estados de erro.
12. Executar build e testes manuais do fluxo completo.

Cada etapa deve permanecer compilável e preservar o formulário sem fotos, as ocorrências legadas e o painel existente.

## Verificação

### Técnica

- Executar `pnpm run build`.
- Executar `git diff --check`.
- Confirmar que nenhuma dependência foi adicionada.
- Confirmar que nenhum Blob ou Data URL foi gravado no `localStorage`.
- Confirmar que a chave `v1` continua legível para migração.

### Formulário

1. Enviar ocorrência sem foto e confirmar comportamento atual.
2. Enviar com uma foto e confirmar a miniatura na gestão após recarga.
3. Enviar com três fotos e confirmar galeria completa após recarga.
4. Tentar uma quarta foto e validar a mensagem de limite.
5. Tentar arquivo acima de 5 MB.
6. Tentar formato não aceito.
7. Selecionar lote misto e confirmar que arquivos válidos permanecem.
8. Remover uma imagem antes do envio e confirmar que ela não chega à gestão.
9. Clicar duas vezes no envio e confirmar que apenas uma ocorrência é criada.

### Gestão e galeria

1. Entrar na Central e confirmar que abre em “Em aberto”.
2. Identificar visualmente cards com e sem imagens.
3. Abrir uma imagem única e fechar por botão, backdrop e Escape.
4. Abrir três imagens, navegar por setas e miniaturas e validar indicador.
5. Recarregar `#gestao` e confirmar que os blobs continuam visíveis.
6. Simular Blob ausente e validar fallback sem quebra.

### Conclusão

1. Abrir conclusão e cancelar sem alterar o item.
2. Concluir sem observação.
3. Concluir com observação e validar limite de 500 caracteres.
4. Confirmar remoção da fila ativa e inclusão imediata em “Concluídas”.
5. Recarregar e confirmar status, data, nota e imagens.
6. Reabrir e confirmar retorno como “Em análise”.
7. Concluir novamente e confirmar substituição da data/nota anterior.

### Migração

1. Preparar ocorrência v1 com status `Resolvida`.
2. Carregar a aplicação e confirmar conversão para `Concluída`.
3. Confirmar exibição no histórico com “Data não registrada”.
4. Confirmar que ocorrências abertas e filtros permanecem funcionais.
5. Confirmar que mocks não são duplicados.

### Responsividade

Verificar aproximadamente em 390 px, 768 px e 1280 px:

- grade de prévias do formulário;
- miniatura no card;
- modal da galeria;
- diálogo de conclusão;
- abas Em aberto/Concluídas;
- ações sem overflow ou sobreposição.

## Critérios de sucesso

- Uma ocorrência com até três fotos pode ser registrada e consultada pela gestão após recarregar a página no mesmo navegador.
- Ocorrências sem foto não exibem controles irrelevantes.
- O colaborador conclui por uma ação explícita e confirmada.
- Concluídas deixam a fila ativa, aparecem no histórico e podem ser reabertas.
- Data e observação opcional persistem corretamente.
- Dados legados com `Resolvida` são migrados sem perda.
- Nenhuma dependência ou backend é necessário.
- O build termina com sucesso e os fluxos atuais continuam operacionais.
