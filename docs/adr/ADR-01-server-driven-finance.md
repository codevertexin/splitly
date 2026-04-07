# ADR-01 — Server-Driven Finance

## Estado
Accepted

## Contexto

A arquitetura atual (V1) da Splitly é funcional, mas mantém parte relevante da lógica financeira no cliente. O frontend consegue calcular shares ajustadas, sugestões settlement-aware e parte da elegibilidade contabilística, enquanto o backend valida e persiste o resultado final.

Este modelo foi útil para a fase inicial do produto, mas cria limitações:

- risco de divergência entre clientes
- baixa auditabilidade dos cálculos
- dificuldade em explicar resultados financeiros
- maior acoplamento entre UX e contabilidade
- dificuldade em evoluir o modelo semântico de expenses e settlements

A evolução V2 pretende introduzir um modelo server-driven finance, em que o servidor passa a ser a fonte de verdade para cálculo financeiro, elegibilidade contabilística e mutações com impacto em balances.

## Decisão

1. O servidor passa a ser a fonte de verdade do cálculo financeiro.
   - O cliente pode simular e pré-visualizar.
   - O cliente deixa de ser authoritative para shares finais, pairwise balances e settlement suggestions canónicas.

2. `affects_balances` passa a ser um campo explícito na entidade `expenses`.
   - O sistema deixa de inferir elegibilidade apenas a partir de `status` e do contexto do evento.
   - O servidor resolve a semântica final.

3. `payment request`, `settlement` e `optimization suggestion` passam a ser separados formalmente.
   - `payment request` = workflow / UX / notificação
   - `settlement` = liquidação contabilística real
   - `optimization suggestion` = recomendação do motor financeiro
   - Apenas `settlement` afeta contabilidade diretamente.

4. A arquitetura V2 será introduzida por rollout faseado.
   - Fase 1: schema e semântica (`affects_balances`)
   - Fase 2: engine financeiro canónico
   - Fase 3: `create-expense-v2` / `update-expense-v2`
   - Fase 4: `settle-v2`
   - Fase 5: read models / snapshots / reporting

5. O engine financeiro deve ser:
   - determinístico
   - auditável
   - versionável
   - testável
   - preparado para reprocessamento futuro

## Consequências

### Positivas
- elimina divergências entre clientes
- melhora auditabilidade
- reduz ambiguidade semântica
- prepara suporte para futuras variantes (`paid_on_the_spot`, `reversed`, etc.)
- reduz risco de inconsistências cross-screen
- facilita testes de regressão financeira

### Custos
- maior complexidade backend
- necessidade de migrations
- coexistência temporária V1/V2
- necessidade de golden tests e shadow comparison

## Regras semânticas iniciais da V2

### Expense
Uma expense pode existir no sistema sem afetar contabilidade.

### affects_balances
- `true` → entra no cálculo consolidado
- `false` → existe no sistema, mas não entra em balances/pairwise/suggestions

### Payment Request
- workflow e UX
- não afeta balances

### Settlement
- registo contabilístico real
- afeta balances

### Optimization Suggestion
- recomendação
- não altera contabilidade diretamente

## Regra inicial de elegibilidade V2

Uma expense é elegível para balances apenas quando:
- `status = confirmed`
- `affects_balances = true`
- `event.status != draft`, quando existe evento

## Rollout

### Feature flags sugeridas
- `finance_engine_v2_write`
- `finance_engine_v2_read`
- `settlement_v2_enabled`
- `finance_trace_debug`

## Decisão final

A Splitly adota a arquitetura server-driven finance como base da V2. A lógica financeira crítica deixa de viver primariamente no cliente e passa a ser centralizada numa camada canónica no servidor.