export const DEMO_GROUP_NAME =
  process.env.PLAYWRIGHT_DEMO_GROUP_NAME ||
  process.env.PLAYWRIGHT_SETTLEMENT_ACTION_GROUP_NAME ||
  process.env.PLAYWRIGHT_SETTLEMENT_OVERVIEW_GROUP_NAME ||
  'Clube de Xadrez';

export const DEMO_TIMING = {
  tiny: 250,
  short: 600,
  medium: 1000,
  long: 1500,
};

export const DEMO_TABS = {
  summary: /resumo|summary|overview/i,
  expenses: /despesas|expenses/i,
  history: /histórico|history/i,
  members: /pessoas|members/i,
};

export const DEMO_COPY = {
  summarySignals:
    /receber|pagar|acertos|settlement|pagamentos|to receive|to pay|balances?|payments?/i,
  settlementDialogTitle:
    /registar acertos neste grupo|record settlements for this group/i,
  settlementDialogHint:
    /vamos pedir confirmação do pagamento|we.ll ask for payment confirmation/i,
  expensesSignals: /despesas|expenses|confirmadas|confirmed/i,
  historySignals: /histórico|history/i,
  reportsTopSignals:
    /relatório financeiro|financial report|reports|totais|totals|pdf/i,
  reportsTotals: /totais|totals/i,
  pdfButton: /descarregar pdf|download pdf|pdf/i,
};

export const DEMO_CTA = {
  primarySettlement:
    /pedir pagamentos|request payments|request payment|saldar dívidas|settle debts/i,
  requestOnly: /^pedir$|^request$/i,
  settleOnly: /^acertar$|^settle$/i,
};