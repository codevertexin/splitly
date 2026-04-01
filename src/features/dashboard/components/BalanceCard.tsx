import React from 'react';

interface BalanceCardProps {
  label: string;
  amount: string;
  variant?: 'blue' | 'green' | 'slate';
}

export function BalanceCard({ label, amount, variant = 'blue' }: BalanceCardProps) {
  const styles = {
    blue: 'bg-blue-50 border-blue-100 text-blue-600 text-blue-900',
    green: 'bg-green-50 border-green-100 text-green-600 text-green-900',
    slate: 'bg-slate-50 border-slate-100 text-slate-600 text-slate-900'
  };

  const currentStyle = styles[variant].split(' ');

  return (
    <div className={`${currentStyle[0]} p-6 rounded-2xl border ${currentStyle[1]}`}>
      <p className={`text-xs font-bold ${currentStyle[2]} uppercase tracking-wider mb-1`}>{label}</p>
      <p className={`text-2xl font-bold ${currentStyle[3]}`}>{amount}</p>
    </div>
  );
}
