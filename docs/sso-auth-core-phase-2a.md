# Fase 2A — Auth Core SSO (Splitly, estilo Startly)

A Splitly usa **sempre** o Auth Core CodeVertex para login. Não há formulário email/password na UI principal.

## Fluxo

1. Utilizador sem sessão abre a app → `Auth.tsx` redireciona automaticamente para:
   `https://auth.codevertex.cc/auth/login?app=SPLITLY&return_url={origin}/sso/callback`
2. Após login no Core → `/sso/callback?ticket=…&app=SPLITLY`
3. Edge `sso-complete` → `setSession` → navega para `/dashboard` (ou destino guardado / convite)
4. Logout → `signOut()` local + redirect `…/logout?app=SPLITLY&return_to={origin}`

Registo e recuperação de palavra-passe no Core:

- Register: `/auth/register?app=SPLITLY&return_url={origin}/sso/callback`
- Forgot password: `/auth/forgot-password?app=SPLITLY`

## Desenvolvimento local

Login Supabase local **apenas** em:

```
http://127.0.0.1:3000/dev-login
```

Rota registada só com `import.meta.env.DEV` (`npm run dev`). Não aparece na UI principal.

## Variáveis de ambiente (Vercel)

| Variável | Obrigatória |
|----------|-------------|
| `VITE_SUPABASE_URL` | Sim |
| `VITE_SUPABASE_ANON_KEY` | Sim |
| `VITE_AUTH_BASE_URL` | Sim (`https://auth.codevertex.cc`) |
| `VITE_APP_CODE` | `SPLITLY` |

Edge Splitly: `CODEVERTEX_SUPABASE_URL`, `CODEVERTEX_SUPABASE_ANON_KEY` + deploy `sso-complete`.

## Allowlist Auth Core

- `{origin}/sso/callback` (produção + preview Vercel)
- `{origin}` para `return_to` no logout

## Ficheiros

| Área | Ficheiro |
|------|----------|
| Redirect gate | `src/components/Auth.tsx` |
| Dev local auth | `src/pages/DevLoginPage.tsx` |
| Callback | `src/pages/SsoCallbackPage.tsx` |
| URLs | `src/lib/codevertexAuth.ts` |
| Return path | `src/lib/ssoReturnTo.ts` |
| Rotas | `src/App.tsx` |
| Logout | `src/components/AppLayout.tsx` |
| Edge | `supabase/functions/sso-complete/` |

## Sem account linking por email

Utilizadores SSO são criados/ligados só por `profiles.codevertex_user_id`.

## Nota histórica

A flag `VITE_AUTH_CORE_ENABLED` foi removida; o comportamento Startly é o único em produção.
