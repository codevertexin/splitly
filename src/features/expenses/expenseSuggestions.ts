import type { Expense } from '../../dbAliases';

export type ExpenseSuggestion = {
  id: string;
  icon: string;
  keywords: string[];
};

const CATALOG: ExpenseSuggestion[] = [
  { id: 'hotel', icon: '🏨', keywords: ['hotel', 'alojamento', 'quarto', 'hostel', 'airbnb'] },
  { id: 'meal', icon: '🍽️', keywords: ['jantar', 'almoco', 'almoço', 'refeicao', 'refeição', 'restaurante', 'food', 'comida'] },
  { id: 'groceries', icon: '🛒', keywords: ['supermercado', 'mercado', 'compras', 'mercearia'] },
  { id: 'fuel', icon: '⛽', keywords: ['combustivel', 'combustível', 'gasolina', 'diesel', 'bomba'] },
  { id: 'shopping', icon: '🛍', keywords: ['shopping', 'loja', 'retail', 'roupa', 'clothes', 'mall'] },
  { id: 'bachelor-party', icon: '👰', keywords: ['despedida de solteira', 'despedida de solteiro', 'hen party', 'stag party'] },
  {
    id: 'transport',
    icon: '🚗',
    keywords: ['taxi', 'uber', 'bolt', 'transporte', 'metro', 'comboio', 'autocarro', 'car', 'carro', 'drive', 'viagem'],
  },
];

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

export const classifyExpenseTitle = (title: string): ExpenseSuggestion | null => {
  const text = normalize(title);
  if (!text) return null;

  for (const suggestion of CATALOG) {
    const match = suggestion.keywords.some((keyword) => text.includes(normalize(keyword)));
    if (match) return suggestion;
  }
  return null;
};

/** Emoji for list rows; consistent with classifyExpenseTitle. */
export function iconForExpenseTitle(title: string): string {
  return classifyExpenseTitle(title)?.icon ?? '🧾';
}

export const getDefaultExpenseSuggestions = (): ExpenseSuggestion[] => CATALOG.slice(0, 6);

export const buildTopExpenseSuggestions = (expenses: Expense[], limit = 6): ExpenseSuggestion[] => {
  const counts = new Map<string, { item: ExpenseSuggestion; count: number }>();

  for (const expense of expenses) {
    const matched = classifyExpenseTitle(expense.title);
    if (!matched) continue;
    const current = counts.get(matched.id);
    if (current) {
      current.count += 1;
    } else {
      counts.set(matched.id, { item: matched, count: 1 });
    }
  }

  const ranked = Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .map((entry) => entry.item);

  const byId = new Set(ranked.map((item) => item.id));
  const withFallback = [...ranked, ...CATALOG.filter((item) => !byId.has(item.id))];

  return withFallback.slice(0, limit);
};
