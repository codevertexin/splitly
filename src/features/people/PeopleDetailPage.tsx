import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Session } from '@supabase/supabase-js';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, UserRound } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useUserContacts } from '../../hooks/useUserContacts';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { formatCurrencyCents, formatDateOnly } from '../../lib/dateTime';
import type { UserContact } from '../../dbAliases';

type SharedGroup = {
  id: string;
  name: string;
  description: string | null;
};

type SharedExpense = {
  id: string;
  group_id: string;
  title: string;
  amount_cents: number;
  incurred_at: string;
  paid_by_user_id: string;
  splits: Array<{ user_id: string; share_cents: number }> | null;
};

interface PeopleDetailPageProps {
  session: Session;
}

function groupNetCents(expenses: SharedExpense[], meId: string, personId: string) {
  let net = 0;
  for (const e of expenses) {
    const splits = e.splits || [];
    const myShare = splits.find((s) => s.user_id === meId)?.share_cents ?? 0;
    const theirShare = splits.find((s) => s.user_id === personId)?.share_cents ?? 0;
    if (e.paid_by_user_id === personId) net += myShare;
    if (e.paid_by_user_id === meId) net -= theirShare;
  }
  return net;
}

export function PeopleDetailPage({ session }: PeopleDetailPageProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { personId } = useParams<{ personId: string }>();
  const { contacts, actionLoading, updateCategory, setBlocked, removeContact } = useUserContacts(session);
  const [sharedGroups, setSharedGroups] = useState<SharedGroup[]>([]);
  const [sharedExpenses, setSharedExpenses] = useState<SharedExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  const person = contacts.find((c) => c.contact_user_id === personId);
  const locale =
    i18n.language === 'pt-BR' ? 'pt-BR' : i18n.language === 'pt-PT' ? 'pt-PT' : i18n.language === 'es' ? 'es-ES' : 'en-IE';
  const formatMoney = (cents: number) => formatCurrencyCents(cents, { locale });

  useEffect(() => {
    const run = async () => {
      if (!personId) {
        setLoading(false);
        return;
      }
      setLoading(true);

      const { data: myMemberships } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', session.user.id)
        .eq('status', 'active');
      const groupIds = [...new Set((myMemberships || []).map((m) => m.group_id))];
      if (groupIds.length === 0) {
        setSharedGroups([]);
        setSharedExpenses([]);
        setLoading(false);
        return;
      }

      const { data: memberships } = await supabase
        .from('group_members')
        .select('group:groups(id, name, description)')
        .eq('user_id', personId)
        .eq('status', 'active')
        .in('group_id', groupIds);

      const groups: SharedGroup[] = [];
      const ids: string[] = [];
      for (const row of memberships || []) {
        const g = row as { group: SharedGroup | SharedGroup[] | null };
        const group = Array.isArray(g.group) ? g.group[0] : g.group;
        if (!group?.id) continue;
        if (ids.includes(group.id)) continue;
        ids.push(group.id);
        groups.push(group);
      }
      setSharedGroups(groups);

      if (ids.length > 0) {
        const { data: expenses } = await supabase
          .from('expenses')
          .select('id, group_id, title, amount_cents, incurred_at, paid_by_user_id, splits:expense_splits(user_id, share_cents)')
          .in('group_id', ids)
          .is('deleted_at', null)
          .order('incurred_at', { ascending: false });
        setSharedExpenses(((expenses || []) as SharedExpense[]).map((e) => ({ ...e, splits: e.splits || [] })));
      } else {
        setSharedExpenses([]);
      }
      setLoading(false);
    };
    void run();
  }, [personId, session.user.id]);

  const perGroupNet = useMemo(() => {
    const out: Record<string, number> = {};
    if (!personId) return out;
    for (const g of sharedGroups) {
      const rows = sharedExpenses.filter((e) => e.group_id === g.id);
      out[g.id] = groupNetCents(rows, session.user.id, personId);
    }
    return out;
  }, [sharedGroups, sharedExpenses, personId, session.user.id]);

  const sharedActivity = useMemo(() => {
    if (!personId) return [];
    return sharedExpenses.filter((e) => {
      const splits = e.splits || [];
      const meIn = e.paid_by_user_id === session.user.id || splits.some((s) => s.user_id === session.user.id);
      const personIn = e.paid_by_user_id === personId || splits.some((s) => s.user_id === personId);
      return meIn && personIn;
    });
  }, [sharedExpenses, personId, session.user.id]);

  const totalNet = useMemo(() => Object.values(perGroupNet).reduce((s, n) => s + n, 0), [perGroupNet]);
  const name =
    person?.contact_profile?.full_name || t('contacts.unnamed', { id: (personId || '').slice(0, 8) });

  const handleRemove = async () => {
    if (!person) return;
    if (!window.confirm(t('contacts.confirmRemove', { name }))) return;
    const res = await removeContact(person.id);
    if (!res.success) setActionError(res.error || t('contacts.genericError'));
    else navigate('/people');
  };

  if (!personId || (!loading && !person)) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">{t('contacts.notFoundTitle')}</h1>
        <p className="text-slate-600">{t('contacts.notFoundBody')}</p>
        <Button type="button" variant="outline" onClick={() => navigate('/people')}>
          {t('contacts.backToPeople')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => navigate('/people')}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('contacts.backToPeople')}
      </button>

      <Card className="p-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <UserRound className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900 truncate">{name}</h1>
            <p className="text-sm text-slate-500">
              {person?.contact_profile?.username ? `@${person.contact_profile.username} · ` : ''}
              {sharedGroups.length === 1 ? t('contacts.inOneSharedGroup') : t('contacts.inXSharedGroups', { count: sharedGroups.length })}
            </p>
            {person && (
              <span className="mt-2 inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                {t(`contacts.category.${person.category}`)}
              </span>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-bold text-slate-900">{t('contacts.relationshipSummary')}</h2>
        <div className="mt-3 space-y-1 text-sm text-slate-700">
          <p>{t('contacts.youShareXGroups', { count: sharedGroups.length })}</p>
          {totalNet < 0 ? (
            <p>{t('contacts.youAreOwedAcrossGroups', { amount: formatMoney(Math.abs(totalNet)) })}</p>
          ) : totalNet > 0 ? (
            <p>{t('contacts.youOweAcrossGroups', { amount: formatMoney(totalNet) })}</p>
          ) : (
            <p>{t('contacts.sharedGroupsCountSimple', { count: sharedGroups.length })}</p>
          )}
          <p>{t('contacts.expensesTogether', { count: sharedActivity.length })}</p>
        </div>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900">{t('contacts.sharedGroupsTitle')}</h2>
        {loading ? (
          <Card className="p-6 text-sm text-slate-500">{t('contacts.loadingSharedGroups')}</Card>
        ) : sharedGroups.length === 0 ? (
          <Card className="p-6 text-sm text-slate-600">{t('contacts.noSharedGroupsWithPerson')}</Card>
        ) : (
          <div className="space-y-3">
            {sharedGroups.map((g) => {
              const net = perGroupNet[g.id] || 0;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => navigate(`/groups/${g.id}`)}
                  className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left hover:bg-slate-50"
                >
                  <p className="font-semibold text-slate-900">{g.name}</p>
                  {g.description && <p className="mt-1 text-sm text-slate-500">{g.description}</p>}
                  <p className="mt-2 text-xs text-slate-600">
                    {net < 0
                      ? t('contacts.youAreOwedInGroup', { amount: formatMoney(Math.abs(net)) })
                      : net > 0
                        ? t('contacts.youOweInGroup', { amount: formatMoney(net) })
                        : t('contacts.youAreEvenInGroup')}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900">{t('contacts.sharedActivityTitle')}</h2>
        {sharedActivity.length === 0 ? (
          <Card className="p-6 text-sm text-slate-600">{t('contacts.noSharedActivityYet')}</Card>
        ) : (
          <Card padding="none">
            <ul className="divide-y divide-slate-100">
              {sharedActivity.slice(0, 8).map((e) => {
                const groupName = sharedGroups.find((g) => g.id === e.group_id)?.name || t('contacts.unknownGroup');
                return (
                  <li key={e.id} className="p-4">
                    <p className="font-medium text-slate-900">{e.title}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {groupName} · {formatDateOnly(e.incurred_at, locale)}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">{formatMoney(e.amount_cents)}</p>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>

      {person && (
        <Card className="p-6">
          <h2 className="text-lg font-bold text-slate-900">{t('contacts.actionsTitle')}</h2>
          {actionError && <p className="mt-2 text-sm text-red-700">{actionError}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <select
              value={person.category}
              disabled={actionLoading}
              onChange={(e) => void updateCategory(person.id, e.target.value as UserContact['category'])}
              className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/25 min-w-[9rem]"
            >
              {(['friend', 'family', 'colleague', 'other'] as const).map((c) => (
                <option key={c} value={c}>
                  {t(`contacts.category.${c}`)}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={actionLoading}
              onClick={() => void setBlocked(person.id, person.status !== 'blocked')}
            >
              {person.status === 'blocked' ? t('contacts.unblock') : t('contacts.block')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={actionLoading}
              className="text-red-600 border-red-100 hover:bg-red-50"
              onClick={() => void handleRemove()}
            >
              {t('contacts.remove')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
