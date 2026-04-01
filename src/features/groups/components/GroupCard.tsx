import React from 'react';
import { useTranslation } from 'react-i18next';
import { Users, ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';
import { Group } from '../../../types';
import { formatCurrencyCents } from '../../../lib/dateTime';

interface GroupCardProps {
  key?: React.Key;
  group: Group;
  onClick: (group: Group) => void;
  variant?: 'compact' | 'full';
}

export function GroupCard({ group, onClick, variant = 'full' }: GroupCardProps) {
  const { t, i18n } = useTranslation();
  const sampleCompactAmount = formatCurrencyCents(4250, { locale: i18n.language });
  const zeroAmount = formatCurrencyCents(0, { locale: i18n.language });

  if (variant === 'compact') {
    return (
      <div 
        onClick={() => onClick(group)}
        className="p-4 bg-slate-50 rounded-2xl border border-slate-100 hover:border-blue-200 transition-all cursor-pointer group"
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-blue-600 shadow-sm">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900">{group.name}</p>
            <p className="text-xs text-slate-400">{t('groupCard.youOwe', { amount: sampleCompactAmount })}</p>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-lg font-bold text-slate-900">{sampleCompactAmount}</span>
          <div className="flex -space-x-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="w-6 h-6 rounded-full border-2 border-white bg-slate-200 overflow-hidden">
                <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${i}`} alt="Member" referrerPolicy="no-referrer" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => onClick(group)}
      className="flex items-center justify-between p-4 bg-white border border-slate-100 rounded-2xl shadow-sm hover:shadow-md transition-all cursor-pointer group"
    >
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
          <Users className="w-5 h-5" />
        </div>
        <div>
          <h4 className="font-bold text-slate-900 text-sm">{group.name}</h4>
          <p className="text-slate-400 text-xs line-clamp-1">{group.description || t('groupCard.noDescription')}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm font-bold text-green-600">{zeroAmount}</span>
        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500 transition-colors" />
      </div>
    </motion.div>
  );
}
