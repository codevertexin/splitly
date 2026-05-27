# Bloqueadores antes de production-final (Splitly × CodeVertex)

**Baseline arquitetural:** commit `36c219b` (`feat(codevertex): baseline ecosystem compliance for Splitly`) em `main`  
**Estado:** integração CodeVertex implementada — **não alterar** sem validação contra Billing Core real  
**Referência:** [SPLITLY_CODEVERTEX_COMPLIANCE.md](./SPLITLY_CODEVERTEX_COMPLIANCE.md)

---

## Regra de fase

> Nesta fase, **não fazer alterações** à integração CodeVertex (Auth, SSO, Help, Legal, CORS, routing, proxy billing) até concluir os bloqueadores abaixo com evidência em staging/prod.

Alterações permitidas: documentação, secrets/deploy, testes, alinhamento de `entitlement_key` **após** lista oficial.

---

## Bloqueador 1 — Validar Billing Core real

**Responsável:** _a atribuir_  
**Prioridade:** P0

### Checklist

- [ ] Confirmar URL base e path: `GET {BILLING_CORE_URL}/api/v1/entitlements?app_code=SPLITLY`
- [ ] **Auth / token:** documentar se basta `Authorization: Bearer <supabase_jwt>` ou se `BILLING_SERVICE_TOKEN` (header `X-Billing-Service-Token`) é obrigatório
- [ ] **Shape da resposta:** validar campos reais (`entitlement_key` vs `feature_key`, `active` vs `is_active`, nesting `data.entitlements`, etc.) e ajustar parser em `billing-entitlements` **só com contrato confirmado**
- [ ] **Timeout / fallback:** decidir política acordada (actual: fail-open → `entitlements: []` + tier free); testar comportamento com Billing Core indisponível
- [ ] Teste checkout → return → refresh entitlements em staging

### Ficheiros envolvidos (após validação)

- `supabase/functions/billing-entitlements/index.ts`
- `src/features/billing/services/billing.service.ts` (apenas se contrato exigir)

---

## Bloqueador 2 — Aplicar `entitlement_key` canónicos

**Responsável:** _a atribuir_  
**Prioridade:** P0  
**Depende de:** Bloqueador 1 + lista oficial do Billing Core

### Checklist

- [ ] Obter lista oficial de `entitlement_key` por app `SPLITLY` (ex. `scan_receipt`, tiers, etc.)
- [ ] Mapear cada entrada de `BILLING_FEATURE_REGISTRY` → `entitlementKey` canónico
- [ ] **Não inventar keys** — evitar drift silencioso Splitly ↔ Billing
- [ ] Atualizar `docs/architecture/SPLITLY_CODEVERTEX_COMPLIANCE.md` com tabela key → feature

### Ficheiros envolvidos (após lista oficial)

- `src/features/billing/constants/billing.constants.ts`
- `src/features/billing/hooks/useFeatureAccess.ts` (se necessário)

---

## Bloqueador 3 — Smoke test staging/prod + checklist CodeVertex

**Responsável:** _a atribuir_  
**Prioridade:** P0

### Checklist funcional

- [ ] **SSO:** login Auth Core → `/sso/callback` → sessão Splitly → logout global
- [ ] **Help:** link menu → Help Core com `app_code`, `module_code`, `screen_code`, `return_to`
- [ ] **Legal:** footer → Legal Core `?app=SPLITLY` (privacy, terms, cookies)
- [ ] **billing-entitlements:** utilizador com plano pago vê entitlements activos; free não vê premium
- [ ] **CORS:** chamadas Edge desde `https://splitly.codevertex.cc` sem erros de origem

### Checklist oficial

- [ ] Importar `CODEVERTEX_AUDIT_CHECKLIST.md` do repo site CodeVertex
- [ ] Executar item-a-item em staging; registar PASS/FAIL em `SPLITLY_CODEVERTEX_COMPLIANCE.md`
- [ ] Só então marcar release como **production-final**

---

## Critério de conclusão

Todos os itens P0 dos 3 bloqueadores fechados → atualizar veredicto em `SPLITLY_CODEVERTEX_COMPLIANCE.md` para **production-final PASS**.
