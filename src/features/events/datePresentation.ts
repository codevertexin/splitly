import { normalizeLocale } from '../../lib/dateTime';

type EventDateLabelInput = {
  startsAt: string;
  endsAt?: string | null;
  locale?: string;
};

function hasExplicitTimeComponent(date: Date) {
  return date.getHours() !== 0 || date.getMinutes() !== 0;
}

function isSameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatEventDateLabel({ startsAt, endsAt, locale }: EventDateLabelInput) {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return '';

  const end = endsAt ? new Date(endsAt) : null;
  const validEnd = end && !Number.isNaN(end.getTime()) ? end : null;

  const resolvedLocale = normalizeLocale(locale);
  const dateFmt = new Intl.DateTimeFormat(resolvedLocale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const timeFmt = new Intl.DateTimeFormat(resolvedLocale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const startHasTime = hasExplicitTimeComponent(start);
  const endHasTime = validEnd ? hasExplicitTimeComponent(validEnd) : false;
  const hasTime = startHasTime || endHasTime;

  if (!validEnd) {
    if (!hasTime) return dateFmt.format(start);
    return `${dateFmt.format(start)} · ${timeFmt.format(start)}`;
  }

  if (!hasTime) {
    return `${dateFmt.format(start)} → ${dateFmt.format(validEnd)}`;
  }

  if (isSameLocalDay(start, validEnd)) {
    return `${dateFmt.format(start)} ${timeFmt.format(start)} → ${timeFmt.format(validEnd)}`;
  }

  return `${dateFmt.format(start)} ${timeFmt.format(start)} → ${dateFmt.format(validEnd)} ${timeFmt.format(validEnd)}`;
}
