import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { Session } from '@supabase/supabase-js';
import { Loader2, AlertCircle } from 'lucide-react';
import { useEvents, EventDetailData } from '../../hooks/useEvents';
import { EventDetail } from './components/EventDetail';

interface EventDetailPageProps {
  session: Session;
}

export function EventDetailPage({ session }: EventDetailPageProps) {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    getEventDetails,
    actionLoading,
    addParticipant,
    updateEventDetails,
    closeEvent,
    finalizeEvent,
    setMyParticipantStatus,
  } = useEvents(session);
  const [event, setEvent] = useState<EventDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [participantError, setParticipantError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDetails = async () => {
      if (!id) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const result = await getEventDetails(id);
        if (result.success) {
          setError(null);
          setEvent(result.data);
        } else {
          setError(result.error || 'Failed to load event details');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [id]);

  const handleAddParticipant = async (userId: string) => {
    if (!id) {
      return;
    }
    setParticipantError(null);
    const result = await addParticipant(id, userId);
    if (result.success) {
      const refreshResult = await getEventDetails(id);
      if (refreshResult.success) {
        setEvent(refreshResult.data);
      } else {
        setParticipantError(refreshResult.error || t('eventDetail.refreshParticipantsFailed'));
      }
    } else {
      setParticipantError(result.error || t('eventDetail.addParticipantFailed'));
    }
  };

  const handleRefresh = async (): Promise<{ success: boolean; error?: string }> => {
    if (!id) {
      return { success: false, error: t('eventDetail.eventNotFound') };
    }
    const result = await getEventDetails(id);
    if (result.success && result.data) {
      setEvent(result.data);
      return { success: true };
    }
    return { success: false, error: result.error || t('eventDetail.dataRefreshFailed') };
  };

  const handleUpdateEvent = async (input: {
    title: string;
    description: string | null;
    participantUserIds: string[];
    startsAt: string;
    endsAt?: string | null;
    recalculateDraftExpenses?: boolean;
  }) => {
    if (!id) {
      return { success: false as const, error: t('eventDetail.eventNotFound') };
    }
    const result = await updateEventDetails(id, input);
    if (!result.success) return result;
    const refreshResult = await getEventDetails(id);
    if (!refreshResult.success || !refreshResult.data) {
      return { success: false as const, error: refreshResult.error || t('eventDetail.dataRefreshFailed') };
    }
    setEvent(refreshResult.data);
    return { success: true as const };
  };

  const handleCloseEvent = async () => {
    if (!id) {
      return { success: false as const, error: t('eventDetail.eventNotFound') };
    }
    const result = await closeEvent(id);
    if (result.success) {
      const refreshResult = await getEventDetails(id);
      if (refreshResult.success) {
        setEvent(refreshResult.data);
      }
    }
    return result;
  };

  const handleSetParticipantStatus = async (status: 'going' | 'not_going') => {
    if (!id) {
      return { success: false as const, error: t('eventDetail.eventNotFound') };
    }
    const result = await setMyParticipantStatus(id, status);
    if (!result.success) return result;
    const refresh = await getEventDetails(id);
    if (refresh.success && refresh.data) {
      setEvent(refresh.data);
      return { success: true as const };
    }
    return {
      success: false as const,
      error: refresh.error || t('eventDetail.dataRefreshFailed'),
    };
  };

  const handleFinalizeEvent = async () => {
    if (!id) {
      return { success: false as const, error: t('eventDetail.eventNotFound') };
    }
    const result = await finalizeEvent(id);
    if (!result.success) return result;
    const refreshResult = await getEventDetails(id);
    if (!refreshResult.success || !refreshResult.data) {
      return { success: false as const, error: refreshResult.error || t('eventDetail.dataRefreshFailed') };
    }
    setEvent(refreshResult.data);
    return { success: true as const };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="p-8 bg-red-50 border border-red-100 rounded-3xl text-center">
        <AlertCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
        <h3 className="text-xl font-bold text-red-900 mb-2">{t('eventDetail.errorLoadingEvent')}</h3>
        <p className="text-red-700 mb-6">{error || t('eventDetail.eventNotFound')}</p>
        <button 
          onClick={() => navigate('/events')}
          className="px-6 py-2 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-all"
        >
          {t('eventDetail.backToEvents')}
        </button>
      </div>
    );
  }

  return (
    <EventDetail 
      event={event} 
      onBack={() => navigate('/events')} 
      onAddParticipant={handleAddParticipant} 
      onRefresh={handleRefresh}
      onUpdateEvent={handleUpdateEvent}
      onCloseEvent={handleCloseEvent}
      onFinalizeEvent={handleFinalizeEvent}
      onSetParticipantStatus={handleSetParticipantStatus}
      actionLoading={actionLoading} 
      participantError={participantError}
      session={session}
    />
  );
}
