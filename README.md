# Splitly

App de divisão de despesas do ecossistema **CodeVertex** (`SPLITLY`).

- **Produção:** https://splitly.codevertex.cc  
- **Auth:** https://auth.codevertex.cc  
- **Billing / Help / Legal:** Core URLs via `VITE_*_BASE_URL` (ver `.env.example`)

## Setup local

1. `npm install`
2. Copiar `.env.example` → `.env` e preencher `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
3. `npm run dev` (porta 3000)

Login local apenas em desenvolvimento: `/dev-login`.

## Scripts

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Servidor Vite |
| `npm run build` | Build de produção |
| `npm run lint` | `tsc --noEmit` |

## CodeVertex

Documentação de compliance: [docs/architecture/SPLITLY_CODEVERTEX_COMPLIANCE.md](docs/architecture/SPLITLY_CODEVERTEX_COMPLIANCE.md)

SSO / Auth Core: [docs/sso-auth-core-phase-2a.md](docs/sso-auth-core-phase-2a.md)

## E2E (Playwright)

Ver ficheiros na raiz do projeto Playwright e variáveis `PLAYWRIGHT_*` em `.env.example`.
