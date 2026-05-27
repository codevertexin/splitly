# Splitly × CodeVertex — compliance status

**App code:** `SPLITLY`  
**Production:** https://splitly.codevertex.cc  
**Baseline arquitetural:** commit com integração CodeVertex (Auth, SSO, Billing proxy, Help, Legal, CORS, env, routing)  
**Last updated:** 2026-05-27  
**Release readiness:** **NOT production-final** — ver secção «Bloqueadores de release»

Reference standards (CodeVertex site repo):

- `docs/architecture/CODEVERTEX_MASTER_ARCHITECTURE.md`
- `docs/architecture/CODEVERTEX_AUDIT_CHECKLIST.md`

---

## Veredicto final

| Classificação | Significado |
|---------------|-------------|
| **Baseline CodeVertex** | **PASS** — integração implementada e tratada como standard oficial da Splitly |
| **Release produção** | **PASS WITH WARNINGS** — arquitectura OK; Billing Core real e entitlement keys canónicos por fechar |

---

## Estado da baseline (implementado)

| Área | Estado | Ficheiros / notas |
|------|--------|-------------------|
| Auth / SSO | ✅ Baseline | `codevertexAuth.ts`, `sso-complete`, `/sso/callback`, `codevertex_user_id` |
| Billing | ⚠️ Proxy | `billing-entitlements`, `codevertexBilling.ts`, gating por entitlements (contrato API por validar) |
| Help | ✅ Baseline | `codevertexHelp.ts` — Help Core query params canónicos |
| Legal | ✅ Baseline | `getLegalUrl` → Legal Core `?app=SPLITLY` |
| Env vars | ✅ Baseline | `.env.example` documentado |
| CORS (Edge) | ✅ Baseline | `_shared/cors.ts` — allowlist, sem `*` |
| RLS | ✅ (auditoria) | Sem `USING (true)` nas migrations revistas |
| Routing | ✅ Baseline | `/login`, `/register`, `/profile`, `/help`, `/sso/callback`, `/settings` |
| TypeScript | ✅ | `npm run lint` limpo (após fix `dbAliases.ts`, `SettingsPage.tsx`) |
| Build | ✅ | `npm run build` sucesso |

---

## Bloqueadores de release (obrigatório antes de production-final)

### 1. Billing Core real

| Tarefa | Estado |
|--------|--------|
| Validar contrato real `GET /api/v1/entitlements` | ⬜ Pendente |
| Confirmar shape da resposta (campos, nesting) | ⬜ Pendente |
| Confirmar se `BILLING_SERVICE_TOKEN` é obrigatório | ⬜ Pendente |
| Validar timeout / fallback (hoje: lista vazia + `warning` no proxy) | ⬜ Pendente |
| Teste E2E checkout → return → refresh entitlements | ⬜ Pendente |

**Comportamento actual (baseline):** Edge `billing-entitlements` faz proxy com parsing flexível (`entitlement_key` / `feature_key` / `key`). Em falha upstream devolve `{ entitlements: [], warning }` — utilizador fica em tier free (sem mock premium).

### 2. entitlement_key oficiais

| Regra | Estado |
|-------|--------|
| Não alterar `BILLING_FEATURE_REGISTRY` até lista canónica do Billing Core | ✅ Respeitado |
| Evitar drift Splitly ↔ Billing | ⬜ Aguarda lista oficial |

### 3. Checklist CodeVertex oficial

| Tarefa | Estado |
|--------|--------|
| Importar `CODEVERTEX_AUDIT_CHECKLIST.md` do repo site | ⬜ Pendente |
| Validação item-a-item em staging | ⬜ Pendente |

---

## Integrações (baseline)

### Auth Core — https://auth.codevertex.cc

- Login/register: redirect (`Auth.tsx`, `/login`, `/register`)
- SSO: `/sso/callback` → `sso-complete`
- Perfil: `getAuthProfileManageUrl`
- Logout: `logoutFromSplitlyAndCore()`
- Dev: `/dev-login` só com `import.meta.env.DEV`

### Billing Core — https://billing.codevertex.cc

- URLs: `src/lib/codevertexBilling.ts`
- Entitlements: `supabase/functions/billing-entitlements`
- Sem Stripe SDK / sem `price_id` na app
- Gating: `hasActiveEntitlement()` (não `product_code`)

### Help Core — https://help.codevertex.cc

- `getHelpUrl({ moduleCode, screenCode, locale, returnTo, sourceSurface })`

### Legal Core — https://legal.codevertex.cc

- `getLegalUrl(page, { locale, embedded })`

---

## Variáveis de ambiente

### Frontend (Vite) — obrigatórias em produção

| Variável | Valor exemplo | Descrição |
|----------|---------------|-----------|
| `VITE_APP_CODE` | `SPLITLY` | App code ecossistema |
| `VITE_APP_BASE_URL` | `https://splitly.codevertex.cc` | URL canónica |
| `VITE_ECOSYSTEM_CODE` | `codevertex` | Ecossistema |
| `VITE_SUPABASE_URL` | — | Supabase **da app** (dados) |
| `VITE_SUPABASE_ANON_KEY` | — | Anon key **da app** |
| `VITE_AUTH_BASE_URL` | `https://auth.codevertex.cc` | Auth Core |
| `VITE_BILLING_BASE_URL` | `https://billing.codevertex.cc` | Billing Core |
| `VITE_HELP_BASE_URL` | `https://help.codevertex.cc` | Help Core |
| `VITE_LEGAL_BASE_URL` | `https://legal.codevertex.cc` | Legal Core |

### Frontend — opcionais

| Variável | Descrição |
|----------|-----------|
| `VITE_SITE_URL` | SSO callback quando não há `window` |
| `VITE_CODEVERTEX_SUPABASE_URL` | Referência documental (não usar para queries no cliente) |
| `VITE_CODEVERTEX_SUPABASE_ANON_KEY` | Idem |

### Edge / Supabase secrets (nunca no frontend)

| Secret | Obrigatório | Descrição |
|--------|-------------|-----------|
| `SUPABASE_URL` | Sim (auto) | Projeto Splitly |
| `SUPABASE_ANON_KEY` | Sim (auto) | |
| `SUPABASE_SERVICE_ROLE_KEY` | Sim | Edge Functions |
| `CODEVERTEX_SUPABASE_URL` | Sim (SSO) | Auth Core Supabase |
| `CODEVERTEX_SUPABASE_ANON_KEY` | Sim (SSO) | |
| `BILLING_CORE_URL` | Recomendado | Default: `https://billing.codevertex.cc` |
| `BILLING_SERVICE_TOKEN` | **Por confirmar** | M2M Billing Core |
| `APP_BASE_URL` | Recomendado | CORS allowlist |
| `CORS_ALLOWED_ORIGINS` | Opcional | Origens extra (CSV) |
| `ALLOW_LOCALHOST_CORS` | Dev only | `true` em local |

### Proibido no frontend / `.env` com prefixo `VITE_`

`SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `SSO_SHARED_SECRET`, `JWT_PRIVATE_KEY`, `BILLING_SERVICE_TOKEN`

---

## Validação técnica (última execução)

```
npm run lint  → ver relatório no PR/commit
npm run build → ver relatório no PR/commit
```

---

## Checklist produção pendente

Ver também: [CODEVERTEX_RELEASE_BLOCKERS.md](./CODEVERTEX_RELEASE_BLOCKERS.md) (nota interna / tracking).

- [ ] Billing Core: contrato `/api/v1/entitlements` validado em staging
- [ ] Billing Core: `BILLING_SERVICE_TOKEN` confirmado (sim/não) e configurado
- [ ] Billing Core: política de timeout/fallback acordada (fail-open vs fail-closed)
- [ ] Lista canónica `entitlement_key` aplicada ao `BILLING_FEATURE_REGISTRY`
- [ ] Deploy Edge `billing-entitlements` + secrets Supabase
- [ ] Smoke test SSO login/logout em `splitly.codevertex.cc`
- [ ] Smoke test Help/Legal links em produção
- [ ] `CODEVERTEX_AUDIT_CHECKLIST.md` executado item-a-item
- [ ] CORS origins de preview/staging adicionados a `CORS_ALLOWED_ORIGINS` se necessário

---

## Decisões de baseline (não reverter sem ADR)

1. Auth centralizado no Auth Core; sem login local em produção.
2. Billing: checkout e entitlements no Billing Core; Splitly é cliente.
3. Help/Legal: sempre Core em produção; fallback local só em dev.
4. CORS: allowlist explícita; nunca `*` em Edge Functions.
5. Identidade canónica: `codevertex_user_id` em `profiles`.
