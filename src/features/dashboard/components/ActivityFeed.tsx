import React from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityItem, MyBalanceHighlight } from '../../../hooks/useDashboardData';
import { formatDateOnly } from '../../../lib/dateTime';

interface ActivityFeedProps {
  activities: ActivityItem[];
  myBalanceHighlight: MyBalanceHighlight;
  currentUserName: string;
  onSettleUp: () => void;
  onDetails?: () => void;
}

export function ActivityFeed({
  activities,
  myBalanceHighlight,
  currentUserName,
  onSettleUp,
  onDetails,
}: ActivityFeedProps) {
  const { t, i18n } = useTranslation();

  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold text-slate-900">{t('activityFeed.title')}</h3>
        <button
          type="button"
          onClick={onDetails}
          className="text-sm font-semibold text-blue-600 hover:text-blue-700"
        >
          {t('activityFeed.details')}
        </button>
      </div>

      <div className="space-y-6">
        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 mt-0.5 rounded-full overflow-hidden border-2 border-white shadow-sm bg-slate-200 flex items-center justify-center shrink-0">
              {myBalanceHighlight.avatarUrl ? (
                <img src={myBalanceHighlight.avatarUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <img
                  src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(myBalanceHighlight.avatarSeed)}`}
                  alt=""
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              )}
            </div>
            <div className="flex-1">
              <p className="text-xl md:text-2xl font-bold text-slate-900 leading-tight">
                {t('activityFeed.positionTitle', { name: currentUserName })}
              </p>
              <div className="mt-2.5 grid grid-cols-2 gap-3">
                <div className="text-center">
                  <p className="text-2xl md:text-3xl leading-tight font-bold text-green-600">{myBalanceHighlight.toReceiveAmount}</p>
                  <p className="mt-1 text-lg md:text-xl leading-tight font-bold text-green-700">{t('activityFeed.toReceiveLabel')}</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl md:text-3xl leading-tight font-bold text-red-600">{myBalanceHighlight.toPayAmount}</p>
                  <p className="mt-1 text-lg md:text-xl leading-tight font-bold text-red-700">{t('activityFeed.toPayLabel')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {activities.length === 0 ? (
            <div className="p-2 text-sm text-slate-500">{t('activityFeed.empty')}</div>
          ) : activities.map((item) => (
            <div key={item.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full overflow-hidden border border-slate-100 bg-slate-100 flex items-center justify-center">
                  {item.avatarUrl ? (
                    <img src={item.avatarUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <img
                      src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(item.avatarSeed)}`}
                      alt=""
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  )}
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">{item.title}</p>
                  <p className="text-xs text-slate-400">
                    {t(item.subtitle)} · {formatDateOnly(item.occurredAt, i18n.language)}
                  </p>
                </div>
              </div>
              <span className={`text-sm font-bold ${item.type === 'credit' ? 'text-green-600' : 'text-red-600'}`}>
                {item.amount}
              </span>
            </div>
          ))}
        </div>

        <button
          onClick={onSettleUp}
          className="w-full py-4 bg-[#6FCF97] text-white font-bold rounded-2xl hover:bg-[#5bbd85] transition-all shadow-lg shadow-green-100"
        >
          {t('activityFeed.settleUp')}
        </button>
      </div>
    </div>
  );
}
