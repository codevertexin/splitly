import React from 'react';
import { Calendar, Users, ChevronRight, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Event } from '../../../types';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { formatEventDateLabel } from '../datePresentation';

interface EventCardProps {
  event: Event;
  onClick: (event: Event) => void;
}

export function EventCard({ event, onClick }: EventCardProps) {
  const { i18n } = useTranslation();
  const dateLabel = formatEventDateLabel({
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    locale: i18n.language,
  });

  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'open': return 'green';
      case 'closed': return 'slate';
      case 'draft': return 'yellow';
      default: return 'slate';
    }
  };

  return (
    <Card 
      className="group cursor-pointer hover:border-blue-200 hover:shadow-md transition-all"
      onClick={() => onClick(event)}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-all">
            <Calendar className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-bold text-slate-900">{event.title}</h4>
              <Badge variant={getStatusVariant(event.status)} size="sm">
                {event.status}
              </Badge>
            </div>
            <p className="text-slate-500 text-sm line-clamp-1 mb-3">
              {event.description || 'No description provided.'}
            </p>
            
            <div className="flex items-center gap-4 text-xs font-medium text-slate-400">
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {dateLabel}
              </div>
              <div className="flex items-center gap-1">
                <Users className="w-3 h-3" />
                Participants
              </div>
            </div>
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-blue-600 transition-all" />
      </div>
    </Card>
  );
}
