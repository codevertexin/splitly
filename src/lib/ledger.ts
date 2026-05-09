type Expense = {
    paid_by_user_id: string;
    splits?: { user_id: string; share_cents: number }[];
  };
  
  type Settlement = {
    from_user_id: string;
    to_user_id: string;
    amount_cents: number;
  };
  
  export function computeLedger({
    currentUserId,
    expenses,
    settlements,
  }: {
    currentUserId: string;
    expenses: Expense[];
    settlements: Settlement[];
  }) {
    const ledger = new Map<string, number>();
  
    // ---- EXPENSES ----
    for (const e of expenses) {
      const splits = e.splits || [];
  
      if (e.paid_by_user_id === currentUserId) {
        for (const s of splits) {
          if (s.user_id === currentUserId) continue;
          ledger.set(s.user_id, (ledger.get(s.user_id) || 0) + s.share_cents);
        }
      } else {
        const mySplit = splits.find((s) => s.user_id === currentUserId);
        if (!mySplit) continue;
  
        ledger.set(
          e.paid_by_user_id,
          (ledger.get(e.paid_by_user_id) || 0) - mySplit.share_cents
        );
      }
    }
  
    // ---- SETTLEMENTS (CRÍTICO) ----
    for (const s of settlements) {
      const amt = s.amount_cents || 0;
  
      if (s.from_user_id === currentUserId) {
        ledger.set(
          s.to_user_id,
          (ledger.get(s.to_user_id) || 0) + amt
        );
      } else if (s.to_user_id === currentUserId) {
        ledger.set(
          s.from_user_id,
          (ledger.get(s.from_user_id) || 0) - amt
        );
      }
    }
  
    return ledger;
  }