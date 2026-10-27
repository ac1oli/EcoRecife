# 05 · Executar o front-end localmente

Situação atual (Etapa 0): o front roda sozinho, ainda com dados locais do navegador (`localStorage` e IndexedDB). A ligação com a API e o banco vem no CP3.

## 1. Pré-requisitos (uma vez por máquina)

1. **Node.js 22 LTS:** <https://nodejs.org/> → instalador "LTS" (Windows .msi), com as opções padrão.
   Verifique num terminal novo: `node --version` deve mostrar `v22.x`.
2. **pnpm** (o projeto usa `pnpm-lock.yaml`):
   ```powershell
   npm install -g pnpm@10
   pnpm --version
   ```
   Esperado: `10.x`. No Windows, se o PowerShell bloquear scripts (`execução de scripts foi desabilitada`), rode uma vez:
   `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
3. **Git:** <https://git-scm.com/download/win>.

## 2. Baixar e rodar

```powershell
git clone https://github.com/ac1oli/EcoRecife.git
cd EcoRecife\web
pnpm install --frozen-lockfile
pnpm dev
```

Esperado: `Local: http://localhost:5173/`. Abra esse endereço no navegador. `Ctrl+C` encerra.

| Comando (na pasta `web/`) | Para que serve |
|---|---|
| `pnpm dev` | Servidor de desenvolvimento com recarga automática |
| `pnpm typecheck` | Verifica os tipos TypeScript (esperado: nenhuma saída) |
| `pnpm build` | Gera a versão de produção em `web/dist/` |
| `pnpm preview` | Serve o `dist/` em `http://localhost:4173` para conferir o build |

## 3. Testar no celular (mesma rede Wi-Fi)

```powershell
pnpm dev --host
```

O Vite mostra um endereço `Network: http://192.168.x.x:5173/`; abra-o no navegador do celular. Se não abrir, libere o Node.js no firewall do Windows (rede privada).

> A geolocalização (GPS) do navegador só funciona em `https://` ou `localhost`. O teste de GPS pelo celular vai precisar de HTTPS (veremos no CP3/implantação).

## 4. Problemas comuns

| Sintoma | Solução |
|---|---|
| `ERR_PNPM_OUTDATED_LOCKFILE` | Alguém mudou o `package.json` sem atualizar o lockfile. Rode `pnpm install` e versione o `pnpm-lock.yaml`. |
| Mapa cinza, sem ruas | Falta internet ou o servidor de tiles bloqueou o acesso (ver riscos em `01-diagnostico.md`) |
| Porta 5173 ocupada | O Vite tenta a próxima (5174); use o endereço que ele mostrar |
