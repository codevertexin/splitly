import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Users, Loader2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Session } from '@supabase/supabase-js';
import { useNavigate } from 'react-router-dom';
import { useGroups } from '../../hooks/useGroups';
import { useGroupAccountingTotals } from '../../hooks/useGroupAccountingTotals';
import { GroupCard } from './components/GroupCard';
import { CreateGroupForm } from './components/CreateGroupForm';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { trackProductEvent } from '../../lib/productTracking';
import { getOnboardingState, updateOnboardingState } from '../../lib/onboardingState';

interface GroupsPageProps {
  session: Session;
}

export function GroupsPage({ session }: GroupsPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { groups, loading, error, actionLoading, createGroup } = useGroups(session);
  const groupIds = useMemo(() => groups.map((g) => g.id), [groups]);
  const { totalsByGroupId, loading: totalsLoading } = useGroupAccountingTotals(session, groupIds);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'all'>('active');

  const filteredGroups = groups.filter((group) => {
    const isArchived = Boolean(group.archived_at);
    if (statusFilter === 'active') return !isArchived;
    if (statusFilter === 'archived') return isArchived;
    return true;
  });
  const hasNoGroups = groups.length === 0;

  useEffect(() => {
    if (!showCreateForm) return;
    if (getOnboardingState().hasCreatedGroup) return;
    // Funnel: first intent signal that user started creating their first group.
    void trackProductEvent('first_group_started', { once_key: 'first_group_started' });
  }, [showCreateForm]);

  const handleCreateGroup = async (name: string, description: string) => {
    const result = await createGroup(name, description);
    if (result.success) {
      // Funnel: user completed first key value step (first group created).
      void trackProductEvent('first_group_created', { once_key: 'first_group_created', entity_type: 'group', entity_id: result.groupId ?? null });
      updateOnboardingState({ hasCreatedGroup: true });
      setShowCreateForm(false);
      if (result.groupId) {
        navigate(`/groups/${result.groupId}`, { state: { onboardingNextExpense: true } });
      }
    }
    return result;
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
    >
      <Card padding="none">
        <div className="p-8 border-b border-slate-50">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-slate-900">{t('groups.title')}</h2>
            {!showCreateForm && (
              <Button 
                onClick={() => setShowCreateForm(true)}
                size="sm"
              >
                <Plus className="w-4 h-4 mr-2" />
                {t('groups.newGroup')}
              </Button>
            )}
          </div>
          
          <AnimatePresence>
            {showCreateForm && (
              <CreateGroupForm 
                onSubmit={handleCreateGroup} 
                onCancel={() => setShowCreateForm(false)} 
                loading={actionLoading} 
              />
            )}
          </AnimatePresence>
        </div>

        <div className="p-8 bg-slate-50/30">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-bold text-red-900">{t('groups.databaseError')}</p>
                  <p className="text-xs text-red-700 mt-1">{error}</p>
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
            </div>
          ) : hasNoGroups ? (
            <div className="text-center py-12 px-4">
              <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Users className="w-7 h-7 text-blue-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">{t('groups.emptyOnboardingTitle')}</h3>
              <p className="text-slate-500 text-sm mt-2 max-w-sm mx-auto">{t('groups.emptyOnboardingDescription')}</p>
              {!showCreateForm && (
                <Button onClick={() => setShowCreateForm(true)} className="mt-5">
                  <Plus className="w-4 h-4 mr-2" />
                  {t('groups.emptyOnboardingCta')}
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 mb-4">
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
                  {statusFilter === 'active'
                    ? t('groups.activeGroups')
                    : statusFilter === 'archived'
                      ? t('groups.archivedGroups')
                      : t('groups.allGroups')}
                </h3>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setStatusFilter('active')}>
                    <Badge variant="green" className={`cursor-pointer transition-opacity ${statusFilter === 'active' ? '' : 'opacity-40'}`}>
                      {t('groups.statusActive')}
                    </Badge>
                  </button>
                  <button type="button" onClick={() => setStatusFilter('archived')}>
                    <Badge variant="slate" className={`cursor-pointer transition-opacity ${statusFilter === 'archived' ? '' : 'opacity-40'}`}>
                      {t('groups.statusArchived')}
                    </Badge>
                  </button>
                  <button type="button" onClick={() => setStatusFilter('all')}>
                    <Badge variant="blue" className={`cursor-pointer transition-opacity ${statusFilter === 'all' ? '' : 'opacity-40'}`}>
                      {t('groups.statusAll')}
                    </Badge>
                  </button>
                </div>
              </div>
              {filteredGroups.length === 0 ? (
                <div className="text-center py-12 px-4">
                  <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                    <Users className="w-6 h-6 text-slate-300" />
                  </div>
                  <p className="text-slate-500 text-sm">{t('groups.empty')}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredGroups.map((group) => (
                    <GroupCard
                      key={group.id}
                      group={group}
                      onClick={(g) => navigate(`/groups/${g.id}`)}
                      totalOpenExpensesCents={totalsByGroupId[group.id] ?? 0}
                      totalsLoading={totalsLoading}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </Card>
    </motion.div>
  );
}
