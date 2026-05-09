import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatDateOnly, formatDateTime, formatMoneyFromCents } from '../../../lib/dateTime';
import type { ReportViewModel } from '../../../lib/reportViewModel';

export type ReportTranslate = (key: string, params?: Record<string, string | number>) => string;

type Props = {
  supabase: SupabaseClient;
  viewModel: ReportViewModel | null;
  t: ReportTranslate;
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-foreground text-lg font-semibold tracking-tight">{children}</h2>;
}

/** Alinha com PDF: fillColor [30, 64, 175] */
const groupReportTableTheadClass = 'border-border/60 border-b bg-[rgb(30,64,175)] text-white';
const groupReportTableThClass = 'px-4 py-3 text-left font-medium text-white';

const totalsTableTheadClass = 'border-border/60 border-b bg-emerald-600 text-white';
const totalsTableThClass = 'px-4 py-3 text-left font-medium text-white';

function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="report-table-shell border-border/60 bg-card overflow-hidden rounded-xl border shadow-sm">
      <div className="report-table-inner overflow-x-auto">{children}</div>
    </div>
  );
}

export function ReportDocument({ supabase, viewModel, t }: Props) {
  const vm = viewModel;
  const locale = vm?.meta.locale ?? 'en';
  const currency = vm?.meta.currency ?? 'EUR';
  const [receiptUrls, setReceiptUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!vm?.receiptsSection.items.length) {
      setReceiptUrls({});
      return;
    }
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        vm.receiptsSection.items.map(async (item) => {
          const { data, error } = await supabase.storage
            .from('expense-receipts')
            .createSignedUrl(item.receiptPath, 3600);
          if (!cancelled && !error && data?.signedUrl) next[item.expenseId] = data.signedUrl;
        }),
      );
      if (!cancelled) setReceiptUrls(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, vm?.receiptsSection.items]);

  const generatedLabel = useMemo(() => {
    if (!vm) return '';
    return formatDateTime(vm.header.generatedAtIso, locale);
  }, [vm, locale]);

  if (!vm) {
    return (
      <div className="text-muted-foreground border-border/60 bg-card border p-6 text-sm">
        {t('reports.selectGroupAndCycle')}
      </div>
    );
  }

  const h = vm.header;
  const { filterMode } = vm.meta;
  const showGroupSection = filterMode !== 'single_event';
  const showEventsSection = filterMode !== 'group_only';

  const periodEndDisplay = h.periodEndIso
    ? formatDateOnly(h.periodEndIso, locale)
    : t('reports.periodUntilNow');

  return (
    <div className="reports-document space-y-10">
      <div className="report-doc-header flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="report-doc-header-text min-w-0 flex-1 space-y-2">
          <div className="text-foreground text-2xl font-semibold tracking-tight">{t('reports.documentTitle')}</div>
          <div className="text-foreground text-xl font-semibold tracking-tight">{h.groupName}</div>
          <div className="text-muted-foreground text-sm">
            {t('reports.batch')}: {h.batchTitle}
          </div>
          <div className="text-muted-foreground text-sm">
            {t('reports.batchState')}: {h.batchStateLabel}
          </div>
          <div className="text-muted-foreground text-sm">
            {t('reports.period')}: {formatDateOnly(h.periodStartIso, locale)} — {periodEndDisplay}
          </div>
          <div className="text-muted-foreground text-sm">
            {t('reports.generatedAt')}: {generatedLabel}
          </div>
          <div className="text-muted-foreground text-sm">
            {t('reports.eventFilter')}: {h.eventFilterLabel}
          </div>
        </div>
        <img
          src="/logo-splitly.png"
          alt=""
          width={220}
          height={48}
          className="report-doc-header-logo h-10 w-auto max-w-[min(220px,42vw)] shrink-0 object-contain object-right sm:h-12"
        />
      </div>

      {/* 1. Pessoas — keep title + table together when the browser can (impressão). */}
      <section className="space-y-3">
        <div className="report-print-keep space-y-3">
          <SectionTitle>{t('reports.sectionPeople')}</SectionTitle>
          <TableShell>
          <table className="report-data-table w-full min-w-[720px] text-sm">
            <thead className={groupReportTableTheadClass}>
              <tr>
                <th className={groupReportTableThClass}>{t('reports.columnName')}</th>
                <th className={groupReportTableThClass}>{t('reports.columnRole')}</th>
                <th className={groupReportTableThClass}>{t('reports.columnStatus')}</th>
                <th className={groupReportTableThClass}>{t('reports.columnNotes')}</th>
              </tr>
            </thead>
            <tbody>
              {vm.peopleSection.rows.map((m) => (
                <tr key={m.userId} className="border-border/60 border-b last:border-b-0">
                  <td className="text-foreground px-4 py-3 font-medium">{m.displayName}</td>
                  <td className="text-muted-foreground px-4 py-3">{m.roleLabel}</td>
                  <td className="text-muted-foreground px-4 py-3">{m.statusLabel}</td>
                  <td className="text-muted-foreground px-4 py-3">{m.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
        </div>
      </section>

      {/* 2. Despesas do grupo */}
      {showGroupSection && (
        <section className="space-y-3">
          <SectionTitle>{t('reports.sectionGroupExpenses')}</SectionTitle>
          {vm.groupExpensesSection.rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('reports.noGroupExpensesInSelection')}</p>
          ) : (
            <div className="space-y-3">
              <div className="text-muted-foreground text-sm">
                <span className="font-medium text-foreground">{t('reports.eventParticipantsHeading')}: </span>
                {vm.groupExpensesSection.participantSummary}
              </div>
              <TableShell>
                <table className="report-data-table w-full min-w-[720px] text-sm">
                  <thead className={groupReportTableTheadClass}>
                    <tr>
                      <th className={groupReportTableThClass}>{t('reports.expenseDate')}</th>
                      <th className={groupReportTableThClass}>{t('reports.columnDescription')}</th>
                      <th className={groupReportTableThClass}>{t('reports.expensePayer')}</th>
                      <th className={`${groupReportTableThClass} text-right`}>{t('reports.expenseAmount')}</th>
                      <th className={groupReportTableThClass}>{t('reports.batch')}</th>
                      <th className={groupReportTableThClass}>{t('reports.columnReceipt')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vm.groupExpensesSection.rows.map((r) => (
                      <tr key={r.expenseId} className="border-border/60 border-b last:border-b-0">
                        <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">
                          {formatDateOnly(r.dateIso, locale)}
                        </td>
                        <td className="text-foreground px-4 py-3">{r.description}</td>
                        <td className="text-muted-foreground px-4 py-3">{r.payerLabel}</td>
                        <td className="text-foreground px-4 py-3 text-right font-medium tabular-nums">
                          {formatMoneyFromCents(r.amountCents, r.currency, { locale })}
                        </td>
                        <td className="text-muted-foreground px-4 py-3">{r.batchTitle}</td>
                        <td className="text-muted-foreground px-4 py-3">
                          {r.hasReceipt ? r.receiptFilename ?? t('reports.receiptYes') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
            </div>
          )}
        </section>
      )}

      {/* 3. Eventos */}
      {showEventsSection && (
        <section className="space-y-6">
          <SectionTitle>{t('reports.sectionEvents')}</SectionTitle>
          {vm.eventSections.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('reports.noEventsInSelection')}</p>
          ) : (
            vm.eventSections.map((ev) => (
              <div key={ev.eventId} className="space-y-3">
                <div className="text-foreground font-semibold">{ev.eventTitle}</div>
                <div className="text-muted-foreground text-sm">
                  <span className="font-medium text-foreground">{t('reports.eventParticipantsHeading')}: </span>
                  {ev.participantSummary}
                </div>
                <TableShell>
                  <table className="report-data-table w-full min-w-[720px] text-sm">
                    <thead className={groupReportTableTheadClass}>
                      <tr>
                        <th className={groupReportTableThClass}>{t('reports.expenseDate')}</th>
                        <th className={groupReportTableThClass}>{t('reports.columnDescription')}</th>
                        <th className={groupReportTableThClass}>{t('reports.expensePayer')}</th>
                        <th className={`${groupReportTableThClass} text-right`}>{t('reports.expenseAmount')}</th>
                        <th className={groupReportTableThClass}>{t('reports.columnReceipt')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ev.expenses.map((r) => (
                        <tr key={r.expenseId} className="border-border/60 border-b last:border-b-0">
                          <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">
                            {formatDateOnly(r.dateIso, locale)}
                          </td>
                          <td className="text-foreground px-4 py-3">{r.description}</td>
                          <td className="text-muted-foreground px-4 py-3">{r.payerLabel}</td>
                          <td className="text-foreground px-4 py-3 text-right font-medium tabular-nums">
                            {formatMoneyFromCents(r.amountCents, r.currency, { locale })}
                          </td>
                          <td className="text-muted-foreground px-4 py-3">
                            {r.hasReceipt ? r.receiptFilename ?? t('reports.receiptYes') : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableShell>
              </div>
            ))
          )}
        </section>
      )}

      {/* 4. Totais */}
      <section className="space-y-4">
        <div className="report-print-keep space-y-3">
          <SectionTitle>{t('reports.sectionTotals')}</SectionTitle>
          <div className="text-foreground text-base font-semibold">
            {t('reports.totalCycle')}: {formatMoneyFromCents(vm.totalsSection.grandTotalCents, currency, { locale })}
          </div>
        </div>

        <div className="report-print-keep space-y-2">
          <div className="text-muted-foreground text-sm font-medium">{t('reports.totalsByPayer')}</div>
          <TableShell>
            <table className="report-data-table w-full min-w-[520px] text-sm">
              <thead className={totalsTableTheadClass}>
                <tr>
                  <th className={totalsTableThClass}>{t('reports.payerName')}</th>
                  <th className={`${totalsTableThClass} text-right`}>{t('reports.payerTotalPaid')}</th>
                  <th className={`${totalsTableThClass} text-right`}>{t('reports.payerExpenseCount')}</th>
                </tr>
              </thead>
              <tbody>
                {vm.totalsSection.byPayer.map((row) => (
                  <tr key={row.userId} className="border-border/60 border-b last:border-b-0">
                    <td className="text-foreground px-4 py-3">{row.label}</td>
                    <td className="text-foreground px-4 py-3 text-right font-medium tabular-nums">
                      {formatMoneyFromCents(row.amountCents, currency, { locale })}
                    </td>
                    <td className="text-muted-foreground px-4 py-3 text-right tabular-nums">
                      {t('reports.payerExpensesCountValue', { count: row.expenseCount })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </div>

        <div className="report-print-keep space-y-2">
          <div className="text-muted-foreground text-sm font-medium">{t('reports.eventSummary')}</div>
          <TableShell>
            <table className="report-data-table w-full min-w-[520px] text-sm">
              <thead className={totalsTableTheadClass}>
                <tr>
                  <th className={totalsTableThClass}>{t('reports.eventName')}</th>
                  <th className={`${totalsTableThClass} text-right`}>{t('reports.eventTotal')}</th>
                  <th className={`${totalsTableThClass} text-right`}>{t('reports.eventExpenseCount')}</th>
                </tr>
              </thead>
              <tbody>
                {vm.totalsSection.byEvent.length === 0 ? (
                  <tr>
                    <td className="text-muted-foreground px-4 py-3" colSpan={3}>
                      {t('reports.noEventsWithExpenses')}
                    </td>
                  </tr>
                ) : (
                  vm.totalsSection.byEvent.map((row) => (
                    <tr key={row.eventId} className="border-border/60 border-b last:border-b-0">
                      <td className="text-foreground px-4 py-3">{row.label}</td>
                      <td className="text-foreground px-4 py-3 text-right font-medium tabular-nums">
                        {formatMoneyFromCents(row.amountCents, currency, { locale })}
                      </td>
                      <td className="text-muted-foreground px-4 py-3 text-right tabular-nums">{row.expenseCount}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableShell>
        </div>

        <div className="report-print-keep space-y-2">
          <div className="text-muted-foreground text-sm font-medium">{t('reports.finalBalance')}</div>
          <p className="text-muted-foreground text-xs italic">{t('accounting.reportScopeHint')}</p>
          <TableShell>
            <table className="report-data-table w-full min-w-[520px] text-sm">
              <thead className={totalsTableTheadClass}>
                <tr>
                  <th className={totalsTableThClass}>{t('reports.memberName')}</th>
                  <th className={`${totalsTableThClass} text-right`}>{t('reports.netBalance')}</th>
                </tr>
              </thead>
              <tbody>
                {vm.totalsSection.memberNet.map((row) => (
                  <tr key={row.userId} className="border-border/60 border-b last:border-b-0">
                    <td className="text-foreground px-4 py-3">{row.label}</td>
                    <td
                      className={[
                        'px-4 py-3 text-right font-medium tabular-nums',
                        row.netCents > 0 ? 'text-emerald-700' : '',
                        row.netCents < 0 ? 'text-destructive' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {formatMoneyFromCents(row.netCents, currency, { locale })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </div>

        <div className="report-print-keep space-y-2">
          <div className="text-muted-foreground text-sm font-medium">{t('reports.whoOwesWho')}</div>
          <TableShell>
            <table className="report-data-table w-full min-w-[720px] text-sm">
              <thead className={totalsTableTheadClass}>
                <tr>
                  <th className={totalsTableThClass}>{t('reports.transferFrom')}</th>
                  <th className={totalsTableThClass}>{t('reports.transferTo')}</th>
                  <th className={`${totalsTableThClass} text-right`}>{t('reports.expenseAmount')}</th>
                </tr>
              </thead>
              <tbody>
                {vm.totalsSection.transfers.length === 0 ? (
                  <tr>
                    <td className="text-muted-foreground px-4 py-3" colSpan={3}>
                      {t('reports.noTransfersNeeded')}
                    </td>
                  </tr>
                ) : (
                  vm.totalsSection.transfers.map((row, idx) => (
                    <tr key={`${row.fromUserId}-${row.toUserId}-${idx}`} className="border-border/60 border-b last:border-b-0">
                      <td className="text-foreground px-4 py-3">{row.fromLabel}</td>
                      <td className="text-foreground px-4 py-3">{row.toLabel}</td>
                      <td className="text-foreground px-4 py-3 text-right font-medium tabular-nums">
                        {formatMoneyFromCents(row.amountCents, currency, { locale })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableShell>
        </div>
      </section>

      {/* 5. Comprovativos — quebra de página forçada antes desta secção (impressão / PDF). */}
      {vm.receiptsSection.items.length > 0 && (
        <section className="report-section-receipts space-y-4">
          <SectionTitle>{t('reports.sectionReceipts')}</SectionTitle>
          <div className="grid gap-8 sm:grid-cols-2">
            {vm.receiptsSection.items.map((item) => {
              const url = receiptUrls[item.expenseId];
              return (
                <figure key={item.expenseId} className="border-border/60 bg-card space-y-2 rounded-xl border p-4 shadow-sm">
                  <figcaption className="text-foreground text-sm font-semibold">{item.expenseTitle}</figcaption>
                  {item.embeddableAsImage && url ? (
                    <img
                      src={url}
                      alt=""
                      className="border-border/60 max-h-[28rem] w-full rounded-md border object-contain"
                    />
                  ) : (
                    <div className="text-muted-foreground space-y-1 text-sm">
                      <p>{item.filename ?? '—'}</p>
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-4">
                          {t('reports.receiptOpenFile')}
                        </a>
                      ) : (
                        <span>—</span>
                      )}
                    </div>
                  )}
                </figure>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
