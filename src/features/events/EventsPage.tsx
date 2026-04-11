import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Calendar, Loader2, AlertCircle, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Session } from '@supabase/supabase-js';
import { useNavigate } from 'react-router-dom';
import { useEvents, EventsStatusFilter } from '../../hooks/useEvents';
import { useGroups } from '../../hooks/useGroups';
import { EventCard } from './components/EventCard';
import { CreateEventForm } from './components/CreateEventForm';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';

interface EventsPageProps {
  session: Session;
}

export function EventsPage({ session }: EventsPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [selectedStatus, setSelectedStatus] = useState<EventsStatusFilter | null>(null);
  const { events, loading: eventsLoading, error: eventsError, actionLoading, createEvent } = useEvents(
    session,
    undefined,
    selectedStatus,
  );
  const { groups, loading: groupsLoading } = useGroups(session);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const handleCreateEvent = async (
    title: string,
    description: string,
    groupId: string,
    status: 'open' | 'draft',
    startsAt: string,
    endsAt?: string | null
  ) => {
    const result = await createEvent(title, description, groupId, status, startsAt, endsAt);
    if (result.success) {
      setShowCreateForm(false);
    }
    return result;
  };

  const selectStatus = (status: EventsStatusFilter) => {
    setSelectedStatus((prev) => (prev === status ? null : status));
  };

  const isStatusFilterActive = (status: EventsStatusFilter) =>
    selectedStatus === null || selectedStatus === status;

  const filteredEvents = useMemo(
    () =>
      events
        .filter(
          (event) =>
            event.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            event.description?.toLowerCase().includes(searchQuery.toLowerCase()),
        )
        .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime()),
    [events, searchQuery],
  );

  const nowMs = Date.now();
  const upcomingEvents = filteredEvents.filter((event) => new Date(event.starts_at).getTime() >= nowMs);
  const pastEvents = filteredEvents.filter((event) => new Date(event.starts_at).getTime() < nowMs);

  const loading = eventsLoading || groupsLoading;

  return (
    <motion.div 
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="space-y-8"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-slate-900">{t('events.title')}</h2>
          <p className="text-slate-500 mt-1">{t('events.subtitle')}</p>
        </div>
        {!showCreateForm && (
          <Button onClick={() => setShowCreateForm(true)}>
            <Plus className="w-5 h-5 mr-2" />
            {t('events.newEvent')}
          </Button>
        )}
      </div>

      <AnimatePresence>
        {showCreateForm && (
          <Card className="p-8">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-slate-900">{t('events.createNewEvent')}</h3>
            </div>
            <CreateEventForm 
              groups={groups}
              onSubmit={handleCreateEvent} 
              onCancel={() => setShowCreateForm(false)} 
              loading={actionLoading} 
            />
          </Card>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-4 md:gap-8">
        {/* Filtros à esquerda — lado a lado com a lista a partir de md (~768px) */}
        <aside className="space-y-4 md:col-span-1 md:sticky md:top-4 md:max-w-full md:self-start">
          <Card className="rounded-3xl border border-slate-100 p-5 shadow-sm">
            <h4 className="mb-4 font-bold text-slate-900">{t('events.filterCardStatusTitle')}</h4>
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => selectStatus('open')}>
                  <Badge variant="green" className={`cursor-pointer transition-opacity ${isStatusFilterActive('open') ? '' : 'opacity-40'}`}>
                    {t('events.open')}
                  </Badge>
                </button>
                <button type="button" onClick={() => selectStatus('closed')}>
                  <Badge variant="slate" className={`cursor-pointer transition-opacity ${isStatusFilterActive('closed') ? '' : 'opacity-40'}`}>
                    {t('events.closed')}
                  </Badge>
                </button>
                <button type="button" onClick={() => selectStatus('draft')}>
                  <Badge variant="yellow" className={`cursor-pointer transition-opacity ${isStatusFilterActive('draft') ? '' : 'opacity-40'}`}>
                    {t('events.draft')}
                  </Badge>
                </button>
              </div>
            </div>
          </Card>

          <Card className="rounded-3xl border border-slate-100 p-4 shadow-sm">
            <h4 className="mb-3 font-bold text-slate-900">{t('events.searchFilterTitle')}</h4>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder={t('events.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-slate-100 bg-slate-50 py-2.5 pl-10 pr-4 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </Card>
        </aside>

        {/* Resultados à direita */}
        <div className="min-w-0 space-y-6 md:col-span-3">
          {eventsError && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-bold text-red-900">{t('events.loadError')}</p>
                  <p className="text-xs text-red-700 mt-1">{eventsError}</p>
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
            </div>
          ) : filteredEvents.length === 0 ? (
            <Card className="py-20 text-center">
              <div className="w-16 h-16 bg-slate-50 rounded-3xl flex items-center justify-center mx-auto mb-4">
                <Calendar className="w-8 h-8 text-slate-300" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">{t('events.empty')}</h3>
              <p className="text-slate-500 text-sm max-w-xs mx-auto">
                {searchQuery ? t('events.noMatch', { query: searchQuery }) : t('events.emptyBody')}
              </p>
              {!searchQuery && (
                <Button variant="outline" className="mt-6" onClick={() => setShowCreateForm(true)}>
                  {t('events.createFirst')}
                </Button>
              )}
            </Card>
          ) : (
            <div className="space-y-6">
              {upcomingEvents.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                    {t('events.upcomingSection')}
                  </h4>
                  <div className="grid grid-cols-1 gap-4">
                    {upcomingEvents.map((event) => (
                      <EventCard
                        key={event.id}
                        event={event}
                        onClick={(e) => navigate(`/events/${e.id}`)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {pastEvents.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                    {t('events.pastSection')}
                  </h4>
                  <div className="grid grid-cols-1 gap-4">
                    {pastEvents.map((event) => (
                      <EventCard
                        key={event.id}
                        event={event}
                        onClick={(e) => navigate(`/events/${e.id}`)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

