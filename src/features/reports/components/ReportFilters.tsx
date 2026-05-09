import React from 'react';
import type { ReportBatchRow, ReportEventOption } from '../../../hooks/useReportData';
import { REPORT_EVENT_FILTER_GROUP_ONLY } from '../../../hooks/useReportData';
import type { Group } from '../../../dbAliases';

type ReportFiltersProps = {
  groups: Group[];
  selectedGroupId: string;
  onGroupChange: (groupId: string) => void;
  batches: ReportBatchRow[];
  selectedBatchId: string;
  onBatchChange: (batchId: string) => void;
  eventOptions: ReportEventOption[];
  selectedEventId: string;
  onEventChange: (eventId: string) => void;
  labels: {
    group: string;
    batch: string;
    event: string;
    allEvents: string;
    groupExpensesOnly: string;
    batchOptionCurrent: string;
    batchOptionClosed: string;
  };
};

const selectClassName =
  'h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

export function ReportFilters({
  groups,
  selectedGroupId,
  onGroupChange,
  batches,
  selectedBatchId,
  onBatchChange,
  eventOptions,
  selectedEventId,
  onEventChange,
  labels,
}: ReportFiltersProps) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {labels.group}
        </span>
        <select
          className={selectClassName}
          value={selectedGroupId}
          onChange={(e) => onGroupChange(e.target.value)}
        >
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {labels.batch}
        </span>
        <select
          className={selectClassName}
          value={selectedBatchId}
          onChange={(e) => onBatchChange(e.target.value)}
          disabled={!batches.length}
        >
          {batches.map((batch) => {
            const suffix = batch.is_active
              ? labels.batchOptionCurrent
              : batch.closed_at
                ? labels.batchOptionClosed
                : '';
            return (
              <option key={batch.id} value={batch.id}>
                {batch.title}
                {suffix}
              </option>
            );
          })}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {labels.event}
        </span>
        <select
          className={selectClassName}
          value={selectedEventId}
          onChange={(e) => onEventChange(e.target.value)}
        >
          <option value="all">{labels.allEvents}</option>
          <option value={REPORT_EVENT_FILTER_GROUP_ONLY}>{labels.groupExpensesOnly}</option>
          {eventOptions.map((event) => (
            <option key={event.id} value={event.id}>
              {event.title}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
