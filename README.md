# EcoRecife

Plataforma de gestão digital de resíduos sólidos urbanos do Recife: acompanhamento da coleta, **Zeladoria Cidadã** (ocorrências com protocolo) e **guia de reciclagem** (EcoPontos, PEVs e cooperativas).

Projeto acadêmico da disciplina *Desenvolvimento de aplicações para internet* (UNINASSAU, 2026.2, turma 2NA/Noite), no Banco de Oportunidades da Prefeitura do Recife (AV2: implementação).

**Equipe:** João Batista de Oliveira · Gabriel Silvestre Gomes · Talles Eduardo Barbosa de Oliveira e Silva · João Vitor da Silva Vieira · Alexsandro Acioli Pimentel Filho.

> **Aviso sobre os dados:** posições de caminhões, ecopontos, cooperativas e ocorrências de exemplo são **demonstrativas**. Não há integração com a frota ou com sistemas da Prefeitura do Recife.

## Estrutura

```
web/        Front-end (React 19, TypeScript, Vite, Tailwind CSS, Leaflet), originado do protótipo Figma
server/     API (Node.js 22, Express, TypeScript, pg): em construção no Checkpoint 2
database/   PostgreSQL: migrações versionadas, dados demonstrativos e consultas de teste
docs/       Documentação técnica (diagnóstico, modelagem, instalação, plano)
```

Andamento por checkpoint: [plano de execução](docs/04-plano-execucao.md).

## Como rodar

| O quê | Guia |
|---|---|
| Front-end | [docs/05-execucao-local.md](docs/05-execucao-local.md): `cd web && pnpm install --frozen-lockfile && pnpm dev` |
| Banco de dados | [docs/03-banco-de-dados.md](docs/03-banco-de-dados.md): `createdb ecorecife` + `psql -f database/instalar.sql` |
| API | [docs/06-api.md](docs/06-api.md): `cd server && pnpm install --frozen-lockfile`, configurar `.env`, `pnpm db:migrar` e `pnpm dev` |

## Documentação

1. [Diagnóstico técnico](docs/01-diagnostico.md)
2. [Modelagem do banco](docs/02-modelagem-banco.md)
3. [Banco: instalação e testes](docs/03-banco-de-dados.md)
4. [Plano de execução (checkpoints)](docs/04-plano-execucao.md)
5. [Execução local do front](docs/05-execucao-local.md)
6. [API: instalação, comandos e endpoints](docs/06-api.md)
7. [Resumo de continuidade](docs/CONTINUIDADE.md)
