# Histórico do protótipo (Figma Make)

Planos escritos durante a prototipação no Figma Make, antes da AV2. Estão aqui só como registro das decisões de interface.

Alguns trechos estão **superados** pela arquitetura da AV2:
- persistência em `localStorage` e IndexedDB: substituída por API + PostgreSQL;
- "não incluir backend nem autenticação real": a AV2 exige os dois.

Veja [`../01-diagnostico.md`](../01-diagnostico.md) e [`../04-plano-execucao.md`](../04-plano-execucao.md).

| Arquivo | Assunto |
|---|---|
| `corrigir-persistencia-ocorrencias.md` | Integração do formulário com a Central de Ocorrências (`localStorage`) |
| `conclusao-e-imagens-ocorrencias.md` | Fotos (até 3, 5 MB), conclusão com nota, histórico e reabertura |
| `navegacao-publica-sem-piscar.md` | Navegação entre páginas sem "piscar" |
| `redesign-area-publica-ecorecife.md` | Redesenho mobile-first da área pública |
