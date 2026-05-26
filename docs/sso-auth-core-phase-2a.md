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

## Linking controlado (migração contas antigas)

Contas **standalone** Splitly (criadas antes do Auth Core) podem ser ligadas **uma vez** ao CodeVertex quando:

1. Não existe `profiles` com o `codevertex_user_id` do Core.
2. `auth.admin.createUser` falha porque o email já existe no Supabase Auth local.
3. O Core envia **email não vazio** no `profile`.
4. Existe **exatamente um** `auth.users` local com esse email (comparação trim + lowercase).
5. Existe `profiles` com `id = auth.users.id` e `codevertex_user_id IS NULL`.
6. O email em `auth.users` coincide com o do Core (mesma regra de normalização).

Nesse caso a Edge atualiza `profiles.codevertex_user_id`, sincroniza campos não destrutivos e gera sessão (mesmo fluxo `generateLink` + `verifyOtp`).

**Bloqueios (HTTP 409, `step: link_existing_local_user`):**

| `code` | Significado |
|--------|-------------|
| `ambiguous_local_account_linking` | Mais de um `auth.users` com o mesmo email |
| `account_already_linked_to_different_codevertex_user` | `profiles.codevertex_user_id` já preenchido com outro UUID |
| `link_requires_core_email` | Core sem email (não se liga por email) |
| `link_missing_profile` | Utilizador auth sem linha em `profiles` |
| `email_mismatch` | Email auth local ≠ email Core após verificação |
| `link_no_local_auth_user` | Erro duplicado mas não encontrado user na listagem |

**Nota:** A listagem de utilizadores via Admin API é paginada; em projetos muito grandes o primeiro match pode exigir mais páginas (limite interno ~100×1000).

## Sem merge por email genérico

O linking **só** ocorre no ramo acima (duplicado de email + condições). Não se fundem contas por email sem `createUser` falhar por duplicado ou sem `codevertex_user_id` nulo.

## Nota histórica

A flag `VITE_AUTH_CORE_ENABLED` foi removida; o comportamento Startly é o único em produção.
