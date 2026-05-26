# PoC: `sso-complete-poc` (Fase 2A.0)

Edge Function isolada que valida um ticket SSO do Auth Core (CodeVertex) e devolve uma sessão Supabase **local** da Splitly.

**Estado:** PoC técnico apenas — **não** ligado à UI, rotas (`/sso/callback`), `Auth.tsx`, `App.tsx`, RLS, JWT, billing ou fluxo de login atual.

## Objetivo

Provar que:

1. A Splitly consegue consumir `consume-sso-ticket` no projeto Supabase do Auth Core.
2. Existe (ou é criado) um `profiles` local com `profiles.id = auth.uid()` e `profiles.codevertex_user_id = profile.id` do Core.
3. É possível obter `access_token` / `refresh_token` locais via `auth.admin.generateLink` + `auth.verifyOtp`.

## Endpoint

```
POST {SUPABASE_URL}/functions/v1/sso-complete-poc
```

### Headers

| Header | Valor |
|--------|--------|
| `Content-Type` | `application/json` |
| `apikey` | `{SUPABASE_ANON_KEY}` |
| `Authorization` | `Bearer {SUPABASE_ANON_KEY}` (recomendado em hosted; local com `verify_jwt = false` pode omitir) |

### Body

```json
{
  "ticket": "<ticket-uuid-ou-string-do-auth-core>"
}
```

## Resposta de sucesso (200)

```json
{
  "ok": true,
  "local_user_id": "uuid-splitly",
  "codevertex_user_id": "uuid-auth-core",
  "email": "user@example.com",
  "has_session": true,
  "access_token": "...",
  "refresh_token": "..."
}
```

- `local_user_id` = `profiles.id` = `auth.users.id` local.
- `codevertex_user_id` = `profile.id` devolvido pelo Core.

## Resposta de erro (JSON seguro)

```json
{
  "ok": false,
  "step": "consume_ticket",
  "code": "http_401",
  "message": "..."
}
```

| `step` | Significado |
|--------|-------------|
| `env` | Secrets em falta na Edge |
| `validate_body` | Body inválido ou `ticket` em falta |
| `consume_ticket` | Falha ao chamar Auth Core |
| `validate_core` | Payload Core inválido (`ok`, `profile.id`, membership SPLITLY) |
| `find_profile` | Erro ao ler `profiles` |
| `create_auth_user` | Falha `auth.admin.createUser` |
| `create_profile` | Falha insert em `profiles` |
| `sync_profile` | Falha update não destrutivo |
| `generate_link` | Falha `auth.admin.generateLink` |
| `verify_otp` | Falha `verifyOtp` ou sessão sem tokens |

## Secrets (Edge / Supabase)

Configurar no projeto Splitly (Dashboard → Edge Functions → Secrets ou `supabase secrets set`):

| Nome | Descrição |
|------|-----------|
| `SUPABASE_URL` | URL do projeto Splitly (geralmente injetado automaticamente) |
| `SUPABASE_ANON_KEY` | Anon key Splitly |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role Splitly |
| `CODEVERTEX_SUPABASE_URL` | URL do projeto Supabase do Auth Core |
| `CODEVERTEX_SUPABASE_ANON_KEY` | Anon key do Auth Core |

**Não** usar prefixo `VITE_*` na Edge. No frontend, os equivalentes são `VITE_CODEVERTEX_SUPABASE_URL` e `VITE_CODEVERTEX_SUPABASE_ANON_KEY`; na função usam-se os nomes sem `VITE_`.

## Chamada manual (exemplo)

Substitua URLs e chaves reais.

```bash
curl -s -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/sso-complete-poc" \
  -H "Content-Type: application/json" \
  -H "apikey: <SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  -d '{"ticket":"<TICKET_FROM_AUTH_CORE>"}'
```

### Local (`supabase functions serve`)

1. Aplicar migration `20260510120000_profiles_codevertex_user_id.sql` se ainda não estiver aplicada.
2. Definir secrets locais (ver acima).
3. `supabase functions serve sso-complete-poc --env-file supabase/.env.local` (ou secrets do CLI).
4. Obter um ticket válido do fluxo SSO do Auth Core (app `SPLITLY`).
5. POST para `http://127.0.0.1:54321/functions/v1/sso-complete-poc`.

## Fluxo interno (resumo)

1. Validar `ticket`.
2. `POST {CODEVERTEX_SUPABASE_URL}/functions/v1/consume-sso-ticket` com `app_code: "SPLITLY"`.
3. Validar `ok`, `profile.id`, membership SPLITLY `active` se vier no payload.
4. `SELECT` em `profiles` por `codevertex_user_id`.
5. Se não existir: `auth.admin.createUser` + `INSERT` em `profiles`.
6. Se existir: `UPDATE` só de campos Core não nulos (nunca apagar com `null`).
7. `auth.admin.generateLink({ type: 'magiclink', email })` → `verifyOtp({ type: 'email', token_hash })`.
8. Devolver tokens da sessão local.

## Limitações

- **PoC:** qualquer caller com anon key (ou sem JWT se `verify_jwt = false`) pode tentar consumir tickets — não usar em produção sem proteção adicional.
- Depende do contrato real de `consume-sso-ticket` (forma de `memberships` / campos de perfil).
- Email placeholder `{uuid}@sso.codevertex.local` se o Core não enviar email.
- `generateLink` + `verifyOtp` pode falhar conforme configuração de Auth (email, OTP, rate limits); o campo `step` na resposta indica onde parou.
- Não cria ligação billing, não altera JWT custom claims, não integra callback browser.
- Primeira execução com utilizador novo exige migration `codevertex_user_id` aplicada.

## Verificar sessão (opcional)

Com os tokens devolvidos:

```bash
curl -s "https://<PROJECT_REF>.supabase.co/auth/v1/user" \
  -H "apikey: <SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <access_token>"
```

O `id` deve coincidir com `local_user_id`.

## Ficheiros

- `supabase/functions/sso-complete-poc/index.ts`
- `supabase/functions/sso-complete-poc/deno.json`
- `supabase/config.toml` — secção `[functions.sso-complete-poc]` com `verify_jwt = false` para testes manuais com ticket apenas.
