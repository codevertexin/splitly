export const rx = {
  email: /email/i,
  password: /password|palavra-passe|contrase(?:n|ñ)a/i,
  signInSubmit: /entrar|iniciar sess[aã]o|sign in|login/i,

  groupsNav: /grupos|groups/i,
  reportsNav: /relat[óo]rios|reports/i,

  newButton: /^novo$|^new$|criar grupo|create group/i,

  createGroupName: /nome do grupo|group name/i,
  createGroupDescription: /descri[cç][aã]o|description/i,
  initialCycle: /primeiro ciclo|initial cycle/i,
  createGroupSubmit: /criar grupo|create group/i,

  addExpense: /adicionar despesa|nova despesa|new expense/i,
  addExpenseToEvent: /adicionar despesa ao evento|add expense to event/i,
  closeBatch: /fechar ciclo|close batch/i,
  closeBatchConfirm: /fechar e abrir novo ciclo|close and open new cycle/i,

  reportsTitle: /relat[óo]rios|reports/i,
  downloadPdf: /descarregar pdf|download pdf/i,
  historyTab: /hist[óo]rico|history/i,
  groupExpensesOnly: /s[óo] despesas de grupo|group expenses only/i,
  allEvents: /todos os eventos|all events/i,
};