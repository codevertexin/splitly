# Playwright starter suite for Splitly V2

Este pacote contém uma base de testes E2E alinhada com a nova implementação:
- grupos com primeiro ciclo
- despesas de grupo vs despesas de evento
- fecho de ciclo
- histórico
- relatórios
- PDF

## Pré-requisitos

1. Instalar dependências
   npm install
2. Copiar `.env.example` para `.env`
3. Garantir que a app está a correr em `PLAYWRIGHT_BASE_URL`
4. Garantir que a conta de teste já existe no Supabase

## Executar

- `npm run test:e2e`
- `npm run test:e2e:headed`
- `npm run test:e2e:ui`

## Notas importantes

- Os testes usam seletores acessíveis e regex multi-idioma, mas continuam a assumir a UI atual.
- Onde a UI seja demasiado ambígua, foi usada uma abordagem conservadora. Se houver instabilidade, a recomendação é adicionar `data-testid` aos elementos críticos.
- O fluxo de settlement depende do estado funcional no ambiente. A suite inclui esse fluxo como teste opcional/ajustável.
