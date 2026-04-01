import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Session } from '@supabase/supabase-js';
import { motion } from 'motion/react';
import { UserRound, Ban, Trash2, UserPlus, Loader2, AlertCircle, Search } from 'lucide-react';
import { useUserContacts, CoMemberSuggestion } from '../../hooks/useUserContacts';
import { supabase } from '../../lib/supabase';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import type { UserContact } from '../../types';
import { useNavigate } from 'react-router-dom';

type Filter = 'all' | 'active' | 'blocked';

interface ContactsPageProps {
  session: Session;
}

const CATEGORY_VALUES: UserContact['category'][] = ['friend', 'family', 'colleague', 'other'];

export function ContactsPage({ session }: ContactsPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [coMembers, setCoMembers] = useState<CoMemberSuggestion[]>([]);
  const [coMembersLoading, setCoMembersLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [sharedGroupsByUser, setSharedGroupsByUser] = useState<Record<string, string[]>>({});

  const {
    contacts,
    loading,
    error,
    actionLoading,
    updateCategory,
    setBlocked,
    removeContact,
    addContacts,
    fetchCoMemberSuggestions,
  } = useUserContacts(session);

  useEffect(() => {
    const run = async () => {
      const userIds = contacts.map((c) => c.contact_user_id);
      if (userIds.length === 0) {
        setSharedGroupsByUser({});
        return;
      }

      const { data: myGroups, error: gErr } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', session.user.id)
        .eq('status', 'active');
      if (gErr) {
        setSharedGroupsByUser({});
        return;
      }

      const groupIds = [...new Set((myGroups || []).map((r) => r.group_id))];
      if (groupIds.length === 0) {
        setSharedGroupsByUser({});
        return;
      }

      const { data: rows, error: mErr } = await supabase
        .from('group_members')
        .select('user_id, group:groups(name)')
        .in('group_id', groupIds)
        .in('user_id', userIds)
        .eq('status', 'active');
      if (mErr) {
        setSharedGroupsByUser({});
        return;
      }

      const map: Record<string, string[]> = {};
      for (const row of rows || []) {
        const r = row as { user_id: string; group: { name: string } | { name: string }[] | null };
        const groupObj = Array.isArray(r.group) ? r.group[0] : r.group;
        const name = groupObj?.name?.trim();
        if (!name) continue;
        if (!map[r.user_id]) map[r.user_id] = [];
        if (!map[r.user_id].includes(name)) map[r.user_id].push(name);
      }
      setSharedGroupsByUser(map);
    };
    void run();
  }, [contacts, session.user.id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      const statusMatch =
        filter === 'all' ? true : filter === 'active' ? c.status === 'active' : c.status === 'blocked';
      if (!statusMatch) return false;
      if (!q) return true;
      const name = (c.contact_profile?.full_name || '').toLowerCase();
      const username = (c.contact_profile?.username || '').toLowerCase();
      return name.includes(q) || username.includes(q);
    });
  }, [contacts, filter, search]);

  const openAddModal = useCallback(async () => {
    setAddModalOpen(true);
    setSelectedIds(new Set());
    setCoMembersLoading(true);
    setActionMessage(null);
    try {
      const rows = await fetchCoMemberSuggestions();
      const existing = new Set(contacts.map((c) => c.contact_user_id));
      setCoMembers(rows.filter((r) => !existing.has(r.user_id)));
    } catch {
      setCoMembers([]);
      setActionMessage(t('contacts.coMembersLoadError'));
    } finally {
      setCoMembersLoading(false);
    }
  }, [fetchCoMemberSuggestions, contacts, t]);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddSelected = async () => {
    const res = await addContacts([...selectedIds]);
    if (res.success) {
      setAddModalOpen(false);
      setActionMessage(null);
    } else {
      setActionMessage(res.error || t('contacts.genericError'));
    }
  };

  const handleRemove = async (id: string, name: string) => {
    if (!window.confirm(t('contacts.confirmRemove', { name }))) return;
    const res = await removeContact(id);
    if (!res.success) setActionMessage(res.error || t('contacts.genericError'));
    else setActionMessage(null);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="space-y-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('contacts.title')}</h1>
          <p className="text-slate-500 text-sm mt-1 max-w-xl">{t('contacts.subtitle')}</p>
        </div>
        <Button type="button" onClick={() => void openAddModal()} size="sm" className="shrink-0">
          <UserPlus className="w-4 h-4 mr-2" />
          {t('contacts.addFromGroups')}
        </Button>
      </div>

      {actionMessage && (
        <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl text-sm text-amber-900 flex gap-2">
          <AlertCircle className="w-5 h-5 shrink-0" />
          {actionMessage}
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-sm text-red-800">
          <p className="font-semibold">{t('contacts.loadErrorTitle')}</p>
          <p className="mt-1 text-red-700">{error}</p>
          <p className="mt-2 text-xs text-red-600">{t('contacts.migrationHint')}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(['all', 'active', 'blocked'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              filter === key
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-100 hover:border-slate-200'
            }`}
          >
            {t(`contacts.filter.${key}`)}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('contacts.searchPlaceholder')}
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
      </div>

      <Card padding="none">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin mr-2" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 px-6">
            <p className="text-slate-700 font-semibold">{t('contacts.empty')}</p>
            <p className="text-slate-500 text-sm mt-1">{t('contacts.emptyHint')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((row) => {
              const name =
                row.contact_profile?.full_name || t('contacts.unnamed', { id: row.contact_user_id.slice(0, 8) });
              const relationship = row.status === 'blocked' ? t('contacts.blockedBadge') : t(`contacts.source.${row.source}`);
              const groups = sharedGroupsByUser[row.contact_user_id] || [];
              const groupsCount = groups.length;
              return (
                <li
                  key={row.id}
                  className="cursor-pointer p-4 sm:p-5 hover:bg-slate-50/60 transition-colors"
                  onClick={() => navigate(`/people/${row.contact_user_id}`)}
                >
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                        <UserRound className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-900 truncate">{name}</p>
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                            {t(`contacts.category.${row.category}`)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500">
                          {relationship}
                          {row.contact_profile?.username ? ` · @${row.contact_profile.username}` : ''}
                        </p>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {groupsCount === 1 ? t('contacts.inOneGroup') : t('contacts.inXGroups', { count: groupsCount })}
                      </p>
                      {groups.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {groups.slice(0, 3).map((g) => (
                            <li key={g} className="text-sm text-slate-700">
                              - {g}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                      <label className="sr-only" htmlFor={`cat-${row.id}`}>
                        {t('contacts.categoryLabel')}
                      </label>
                      <select
                        id={`cat-${row.id}`}
                        value={row.category}
                        disabled={actionLoading}
                        onChange={(e) =>
                          void updateCategory(row.id, e.target.value as UserContact['category'])
                        }
                        className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/25 min-w-[9rem]"
                      >
                        {CATEGORY_VALUES.map((c) => (
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
                        onClick={() => void setBlocked(row.id, row.status !== 'blocked')}
                        title={row.status === 'blocked' ? t('contacts.unblock') : t('contacts.block')}
                      >
                        <Ban className="w-4 h-4 sm:mr-1" />
                        <span className="hidden sm:inline">
                          {row.status === 'blocked' ? t('contacts.unblock') : t('contacts.block')}
                        </span>
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={actionLoading}
                        className="text-red-600 border-red-100 hover:bg-red-50"
                        onClick={() => void handleRemove(row.id, name)}
                        title={t('contacts.remove')}
                      >
                        <Trash2 className="w-4 h-4 sm:mr-1" />
                        <span className="hidden sm:inline">{t('contacts.remove')}</span>
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Modal
        isOpen={addModalOpen}
        onClose={() => !actionLoading && setAddModalOpen(false)}
        title={t('contacts.addModalTitle')}
        size="lg"
      >
        <p className="text-sm text-slate-600 mb-4">{t('contacts.addModalBody')}</p>
        {coMembersLoading ? (
          <div className="flex justify-center py-12 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        ) : coMembers.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center">{t('contacts.coMembersEmpty')}</p>
        ) : (
          <ul className="max-h-[50vh] overflow-y-auto space-y-2 mb-6">
            {coMembers.map((m) => (
              <li key={m.user_id}>
                <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(m.user_id)}
                    onChange={() => toggleSelected(m.user_id)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-slate-900">
                    {m.full_name || t('contacts.unnamed', { id: m.user_id.slice(0, 8) })}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-3 justify-end">
          <Button type="button" variant="secondary" onClick={() => setAddModalOpen(false)} disabled={actionLoading}>
            {t('contacts.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void handleAddSelected()}
            disabled={actionLoading || selectedIds.size === 0 || coMembersLoading}
            loading={actionLoading}
          >
            {t('contacts.addSelected', { count: selectedIds.size })}
          </Button>
        </div>
      </Modal>
    </motion.div>
  );
}
