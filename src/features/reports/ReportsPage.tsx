import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileDown, FileSpreadsheet, Printer, RefreshCw } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { useReportData } from '../../hooks/useReportData';
import { ReportFilters } from './components/ReportFilters';
import { ReportDocument } from './components/ReportDocument';
import { supabase } from '../../lib/supabase';
import { downloadCycleReportPdf } from '../../lib/reportPdf';
import { buildReportViewModel } from '../../lib/reportViewModel';

type ReportsPageProps = {
  session: Session;
};

export function ReportsPage({ session }: ReportsPageProps) {
  const { t, i18n } = useTranslation();
  const {
    groups,
    selectedGroup,
    selectedGroupId,
    setSelectedGroupId,
    batches,
    selectedBatch,
    selectedBatchId,
    setSelectedBatchId,
    eventOptions,
    selectedEventId,
    setSelectedEventId,
    expenses,
    settlements,
    members,
    loading,
    error,
    refetchReport,
  } = useReportData(session);

  useEffect(() => {
    document.body.classList.add('reports-page-active');
    return () => document.body.classList.remove('reports-page-active');
  }, []);

  const locale = useMemo(() => {
    if (i18n.language === 'pt-PT') return 'pt-PT';
    if (i18n.language === 'pt-BR') return 'pt-BR';
    if (i18n.language === 'es') return 'es';
    return 'en';
  }, [i18n.language]);

  const generatedAtIso = useMemo(
    () => new Date().toISOString(),
    [selectedGroupId, selectedBatchId, selectedEventId, expenses.length, settlements.length],
  );

  const reportViewModel = useMemo(() => {
    if (!selectedGroup || !selectedBatch) return null;
    const selectedEvent = eventOptions.find((event) => event.id === selectedEventId) ?? null;
    return buildReportViewModel({
      group: selectedGroup,
      batch: selectedBatch,
      selectedEventId,
      selectedEventTitle: selectedEvent?.title ?? null,
      expenses,
      settlements,
      members,
      generatedAtIso,
      locale,
      t: (key, params) => t(key, params as Record<string, unknown>),
    });
  }, [
    selectedGroup,
    selectedBatch,
    selectedEventId,
    eventOptions,
    expenses,
    settlements,
    members,
    generatedAtIso,
    locale,
    t,
  ]);

  const selectedEvent = eventOptions.find((event) => event.id === selectedEventId) ?? null;
  const hasGroups = groups.length > 0;
  const hasBatches = batches.length > 0;

  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const handleDownloadPdf = async () => {
    if (!selectedGroup || !selectedBatch) return;
    setPdfError(null);
    setPdfBusy(true);
    const pdfVm = buildReportViewModel({
      group: selectedGroup,
      batch: selectedBatch,
      selectedEventId,
      selectedEventTitle: selectedEvent?.title ?? null,
      expenses,
      settlements,
      members,
      generatedAtIso: new Date().toISOString(),
      locale,
      t: (key, params) => t(key, params as Record<string, unknown>),
    });
    const result = await downloadCycleReportPdf({
      supabase,
      viewModel: pdfVm,
      t: (key, params) => t(key, params as Record<string, unknown>),
    });
    setPdfBusy(false);
    if (result.ok === false) setPdfError(result.error);
  };

  return (
    <div className="reports-page space-y-6">
      <section className="reports-no-print no-print">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t('reports.title')}</h1>
            <p className="mt-1 text-sm text-slate-600">{t('reports.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => void refetchReport()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('reports.refresh')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleDownloadPdf()}
              disabled={!hasGroups || !hasBatches || loading || pdfBusy}
              loading={pdfBusy}
            >
              <FileDown className="mr-2 h-4 w-4" />
              {t('reports.downloadPdf')}
            </Button>
            <Button
              onClick={() => window.print()}
              disabled={!hasGroups || !hasBatches}
            >
              <Printer className="mr-2 h-4 w-4" />
              {t('reports.print')}
            </Button>
          </div>
        </div>
      </section>

      <Card className="reports-no-print no-print" padding="md">
        <ReportFilters
          groups={groups}
          selectedGroupId={selectedGroupId}
          onGroupChange={setSelectedGroupId}
          batches={batches}
          selectedBatchId={selectedBatchId}
          onBatchChange={setSelectedBatchId}
          eventOptions={eventOptions}
          selectedEventId={selectedEventId}
          onEventChange={setSelectedEventId}
          labels={{
            group: t('reports.group'),
            batch: t('reports.batch'),
            event: t('reports.eventFilter'),
            allEvents: t('reports.allEvents'),
            groupExpensesOnly: t('reports.groupExpensesOnly'),
            batchOptionCurrent: t('reports.batchOptionCurrent'),
            batchOptionClosed: t('reports.batchOptionClosed'),
          }}
        />
      </Card>

      {!hasGroups ? (
        <Card className="text-slate-600">{t('reports.noGroups')}</Card>
      ) : !hasBatches ? (
        <Card className="text-slate-600">{t('reports.noBatches')}</Card>
      ) : loading ? (
        <Card className="flex items-center gap-2 text-slate-600">
          <RefreshCw className="h-4 w-4 animate-spin" />
          {t('reports.loading')}
        </Card>
      ) : error ? (
        <Card className="border-red-200 bg-red-50 text-red-700">{error}</Card>
      ) : !selectedGroup || !selectedBatch ? (
        <Card className="text-slate-600">{t('reports.noData')}</Card>
      ) : (
        <div className="space-y-4">
          {selectedBatch.is_active && (
            <div className="reports-no-print no-print rounded-xl border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-900">
              <p className="font-semibold">{t('reports.activeCyclePreviewBanner')}</p>
            </div>
          )}
          <div className="reports-no-print no-print rounded-xl border border-blue-100 bg-blue-50/70 p-4 text-sm text-blue-800">
            <div className="flex items-center gap-2 font-semibold">
              <FileSpreadsheet className="h-4 w-4" />
              {t('reports.printHintTitle')}
            </div>
            <p className="mt-1">{t('reports.printHintBody')}</p>
            <p className="mt-2">{t('reports.pdfHintBody')}</p>
          </div>

          {pdfError && (
            <div className="reports-no-print no-print rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {t('reports.pdfError')}: {pdfError}
            </div>
          )}

          <ReportDocument
            supabase={supabase}
            viewModel={reportViewModel}
            t={(key, params) => t(key, params)}
          />
        </div>
      )}
    </div>
  );
}
