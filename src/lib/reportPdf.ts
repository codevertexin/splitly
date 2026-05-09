import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { CellHookData } from 'jspdf-autotable';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatCurrencyCents, formatDateOnly, formatDateTime } from './dateTime';
import { getExpenseReceiptSignedUrl } from './expenseReceiptStorage';
import type { ReportViewModel } from './reportViewModel';

const MM_MARGIN = 14;
const RECEIPT_SIGN_URL_SEC = 7200;
/** Comprovativos em PDF: grelha para não ocupar largura total da página. */
const RECEIPT_COL_COUNT = 3;
const RECEIPT_COL_GAP_MM = 2.5;
const RECEIPT_MAX_IMAGE_H_MM = 68;
/** Verde da marca: barra de cabeçalho das tabelas da secção Totais (PDF). */
const PDF_TOTALS_TABLE_HEAD_RGB: [number, number, number] = [5, 150, 105];
/** Cabeçalhos das tabelas de pessoas/despesas (alinhado ao ecrã — azul índigo). */
const PDF_GROUP_HEAD_RGB: [number, number, number] = [30, 64, 175];
/** Bordas discretas tipo slate-200 (evita grelha preta pesada do tema `grid`). */
const PDF_BORDER_RGB: [number, number, number] = [226, 232, 240];

const pdfCellBorder = {
  lineWidth: 0.12,
  lineColor: PDF_BORDER_RGB,
};

type TFn = (key: string, params?: Record<string, unknown>) => string;

function splitlyLogoFetchUrl(): string {
  if (typeof window === 'undefined') return '/logo-splitly.png';
  const base = import.meta.env.BASE_URL || '/';
  return new URL('logo-splitly.png', `${window.location.origin}${base.endsWith('/') ? base : `${base}/`}`).href;
}

async function loadSplitlyLogoDataUrlForPdf(): Promise<{ dataUrl: string; format: 'PNG' | 'JPEG' } | null> {
  try {
    const res = await fetch(splitlyLogoFetchUrl(), { cache: 'force-cache' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('read'));
      r.readAsDataURL(blob);
    });
    const isPng = dataUrl.startsWith('data:image/png');
    return { dataUrl, format: isPng ? 'PNG' : 'JPEG' };
  } catch {
    return null;
  }
}

function safeFilePart(s: string): string {
  const t = s.replace(/[^a-z0-9-_]+/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return t.slice(0, 48) || 'report';
}

function getLastAutoTableFinalY(doc: jsPDF): number {
  const d = doc as unknown as { lastAutoTable?: { finalY?: number } };
  return typeof d.lastAutoTable?.finalY === 'number' ? d.lastAutoTable.finalY : MM_MARGIN;
}

function receiptPickShortestCol(colYs: number[]): number {
  let best = 0;
  for (let i = 1; i < colYs.length; i++) {
    if (colYs[i] < colYs[best]) best = i;
  }
  return best;
}

/** headStyles do autotable não herdam halign de columnStyles — força cabeçalho = corpo. */
function pdfHeadHalignRightCols(indices: number[]): (data: CellHookData) => void {
  const set = new Set(indices);
  return (data) => {
    if (data.section === 'head' && set.has(data.column.index)) {
      data.cell.styles.halign = 'right';
    }
  };
}

function pdfHeadHalignLeftAll(): (data: CellHookData) => void {
  return (data) => {
    if (data.section === 'head') {
      data.cell.styles.halign = 'left';
    }
  };
}

/**
 * Carrega imagem via URL assinada e converte para JPEG (data URL) para o jsPDF.
 */
export function loadImageAsJpegDataUrlForPdf(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h) {
          resolve(null);
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export type DownloadCycleReportPdfParams = {
  supabase: SupabaseClient;
  viewModel: ReportViewModel;
  t: TFn;
};

export async function downloadCycleReportPdf(
  params: DownloadCycleReportPdfParams,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, viewModel: vm, t } = params;

  try {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const innerW = pageW - MM_MARGIN * 2;

    const { locale, currency, filterMode } = vm.meta;
    const h = vm.header;

    const periodEndLabel = h.periodEndIso
      ? formatDateOnly(h.periodEndIso, locale)
      : t('reports.periodUntilNow');

    let y = MM_MARGIN;
    const headerBlockTopY = y;
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(t('reports.documentTitle'), MM_MARGIN, y);
    y += 8;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(h.groupName, MM_MARGIN, y);
    y += 6;
    doc.setFontSize(9);
    const headerLines = [
      `${t('reports.batch')}: ${h.batchTitle}`,
      `${t('reports.batchState')}: ${h.batchStateLabel}`,
      `${t('reports.period')}: ${formatDateOnly(h.periodStartIso, locale)} — ${periodEndLabel}`,
      `${t('reports.generatedAt')}: ${formatDateTime(h.generatedAtIso, locale)}`,
      `${t('reports.eventFilter')}: ${h.eventFilterLabel}`,
    ];
    for (const line of headerLines) {
      doc.text(line, MM_MARGIN, y);
      y += 4.5;
    }
    const headerTextEndY = y;
    y += 4;

    const logoAsset = await loadSplitlyLogoDataUrlForPdf();
    if (logoAsset) {
      const blockH = Math.max(18, headerTextEndY - headerBlockTopY);
      const logoMaxW = innerW * 0.36;
      let iw = 1;
      let ih = 1;
      try {
        const props = doc.getImageProperties(logoAsset.dataUrl);
        iw = props.width || 1;
        ih = props.height || 1;
      } catch {
        iw = 1;
        ih = 1;
      }
      const ratio = ih / iw;
      let dispW = logoMaxW;
      let dispH = dispW * ratio;
      if (dispH > blockH) {
        dispH = blockH;
        dispW = dispH / ratio;
      }
      const logoX = pageW - MM_MARGIN - dispW;
      const logoY = headerBlockTopY;
      doc.addImage(logoAsset.dataUrl, logoAsset.format, logoX, logoY, dispW, dispH);
    }

    const addSectionTitle = (title: string) => {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text(title, MM_MARGIN, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
    };

    /* 1. Pessoas */
    addSectionTitle(t('reports.sectionPeople'));
    autoTable(doc, {
      startY: y,
      tableWidth: innerW,
      head: [
        [
          t('reports.columnName'),
          t('reports.columnRole'),
          t('reports.columnStatus'),
          t('reports.columnNotes'),
        ],
      ],
      body: vm.peopleSection.rows.map((m) => [
        m.displayName,
        m.roleLabel,
        m.statusLabel,
        m.notes ?? '—',
      ]),
      theme: 'striped',
      styles: { ...pdfCellBorder, fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: PDF_GROUP_HEAD_RGB, textColor: 255 },
      didParseCell: pdfHeadHalignLeftAll(),
      columnStyles: {
        0: { cellWidth: innerW * 0.34 },
        1: { cellWidth: innerW * 0.2 },
        2: { cellWidth: innerW * 0.18 },
        3: { cellWidth: innerW * 0.28 },
      },
    });
    y = getLastAutoTableFinalY(doc) + 8;

    /* 2. Despesas do grupo */
    if (filterMode !== 'single_event') {
      addSectionTitle(t('reports.sectionGroupExpenses'));
      if (vm.groupExpensesSection.rows.length === 0) {
        doc.setFontSize(9);
        doc.text(t('reports.noGroupExpensesInSelection'), MM_MARGIN, y);
        y += 8;
      } else {
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        const groupPartLine = `${t('reports.eventParticipantsHeading')}: ${vm.groupExpensesSection.participantSummary}`;
        const groupPartWrapped = doc.splitTextToSize(groupPartLine, innerW);
        doc.text(groupPartWrapped, MM_MARGIN, y);
        y += groupPartWrapped.length * 3.5 + 3;

        autoTable(doc, {
          startY: y,
          tableWidth: innerW,
          head: [
            [
              t('reports.expenseDate'),
              t('reports.columnDescription'),
              t('reports.expensePayer'),
              t('reports.expenseAmount'),
              t('reports.batch'),
              t('reports.columnReceipt'),
            ],
          ],
          body: vm.groupExpensesSection.rows.map((r) => [
            formatDateOnly(r.dateIso, locale),
            r.description,
            r.payerLabel,
            formatCurrencyCents(r.amountCents, { locale, currency: r.currency }),
            r.batchTitle,
            r.hasReceipt ? r.receiptFilename ?? t('reports.receiptYes') : '—',
          ]),
          theme: 'striped',
          styles: { ...pdfCellBorder, fontSize: 7, cellPadding: 1 },
          headStyles: { fillColor: PDF_GROUP_HEAD_RGB, textColor: 255 },
          didParseCell: pdfHeadHalignRightCols([3]),
          columnStyles: {
            0: { cellWidth: 22 },
            1: { cellWidth: innerW - 22 - 28 - 26 - 22 - 26 },
            2: { cellWidth: 28 },
            3: { cellWidth: 26, halign: 'right' },
            4: { cellWidth: 22 },
            5: { cellWidth: 26 },
          },
        });
        y = getLastAutoTableFinalY(doc) + 8;
      }
    }

    /* 3. Eventos */
    if (filterMode !== 'group_only') {
      addSectionTitle(t('reports.sectionEvents'));
      if (vm.eventSections.length === 0) {
        doc.setFontSize(9);
        doc.text(t('reports.noEventsInSelection'), MM_MARGIN, y);
        y += 8;
      } else {
        for (const ev of vm.eventSections) {
          if (y > pageH - 40) {
            doc.addPage();
            y = MM_MARGIN;
          }
          doc.setFontSize(10);
          doc.setFont('helvetica', 'bold');
          doc.text(ev.eventTitle, MM_MARGIN, y);
          y += 5;
          doc.setFontSize(8);
          doc.setFont('helvetica', 'normal');
          const partLine = `${t('reports.eventParticipantsHeading')}: ${ev.participantSummary}`;
          const partWrapped = doc.splitTextToSize(partLine, innerW);
          doc.text(partWrapped, MM_MARGIN, y);
          y += partWrapped.length * 3.5 + 3;

          autoTable(doc, {
            startY: y,
            tableWidth: innerW,
            head: [
              [
                t('reports.expenseDate'),
                t('reports.columnDescription'),
                t('reports.expensePayer'),
                t('reports.expenseAmount'),
                t('reports.columnReceipt'),
              ],
            ],
            body: ev.expenses.map((r) => [
              formatDateOnly(r.dateIso, locale),
              r.description,
              r.payerLabel,
              formatCurrencyCents(r.amountCents, { locale, currency: r.currency }),
              r.hasReceipt ? r.receiptFilename ?? t('reports.receiptYes') : '—',
            ]),
            theme: 'striped',
            styles: { ...pdfCellBorder, fontSize: 7, cellPadding: 1 },
            headStyles: { fillColor: PDF_GROUP_HEAD_RGB, textColor: 255 },
            didParseCell: pdfHeadHalignRightCols([3]),
            columnStyles: {
              0: { cellWidth: 22 },
              1: { cellWidth: innerW - 22 - 28 - 26 - 26 },
              2: { cellWidth: 28 },
              3: { cellWidth: 26, halign: 'right' },
              4: { cellWidth: 26 },
            },
          });
          y = getLastAutoTableFinalY(doc) + 8;
        }
      }
    }

    /* 4. Totais */
    if (y > pageH - 50) {
      doc.addPage();
      y = MM_MARGIN;
    }
    addSectionTitle(t('reports.sectionTotals'));
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(
      `${t('reports.totalCycle')}: ${formatCurrencyCents(vm.totalsSection.grandTotalCents, { locale, currency })}`,
      MM_MARGIN,
      y,
    );
    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);

    doc.setFont('helvetica', 'bold');
    doc.text(t('reports.totalsByPayer'), MM_MARGIN, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
    autoTable(doc, {
      startY: y,
      tableWidth: innerW,
      head: [[t('reports.payerName'), t('reports.payerTotalPaid'), t('reports.payerExpenseCount')]],
      body: vm.totalsSection.byPayer.map((row) => [
        row.label,
        formatCurrencyCents(row.amountCents, { locale, currency }),
        t('reports.payerExpensesCountValue', { count: row.expenseCount }),
      ]),
      theme: 'striped',
      styles: { ...pdfCellBorder, fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: PDF_TOTALS_TABLE_HEAD_RGB, textColor: 255 },
      didParseCell: pdfHeadHalignRightCols([1, 2]),
      columnStyles: {
        0: { cellWidth: innerW * 0.52 },
        1: { cellWidth: innerW * 0.24, halign: 'right' },
        2: { cellWidth: innerW * 0.24, halign: 'right' },
      },
    });
    y = getLastAutoTableFinalY(doc) + 6;

    doc.setFont('helvetica', 'bold');
    doc.text(t('reports.eventSummary'), MM_MARGIN, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
    if (vm.totalsSection.byEvent.length === 0) {
      doc.text(t('reports.noEventsWithExpenses'), MM_MARGIN, y);
      y += 8;
    } else {
      autoTable(doc, {
        startY: y,
        tableWidth: innerW,
        head: [[t('reports.eventName'), t('reports.eventTotal'), t('reports.eventExpenseCount')]],
        body: vm.totalsSection.byEvent.map((row) => [
          row.label,
          formatCurrencyCents(row.amountCents, { locale, currency }),
          String(row.expenseCount),
        ]),
        theme: 'striped',
        styles: { ...pdfCellBorder, fontSize: 8, cellPadding: 1.5 },
        headStyles: { fillColor: PDF_TOTALS_TABLE_HEAD_RGB, textColor: 255 },
        didParseCell: pdfHeadHalignRightCols([1, 2]),
        columnStyles: {
          0: { cellWidth: innerW * 0.52 },
          1: { cellWidth: innerW * 0.24, halign: 'right' },
          2: { cellWidth: innerW * 0.24, halign: 'right' },
        },
      });
      y = getLastAutoTableFinalY(doc) + 6;
    }

    doc.setFont('helvetica', 'bold');
    doc.text(t('reports.finalBalance'), MM_MARGIN, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
    doc.setFont('helvetica', 'italic');
    const hintLines = doc.splitTextToSize(t('accounting.reportScopeHint'), innerW);
    doc.text(hintLines, MM_MARGIN, y);
    y += hintLines.length * 3.5 + 2;
    doc.setFont('helvetica', 'normal');
    autoTable(doc, {
      startY: y,
      tableWidth: innerW,
      head: [[t('reports.memberName'), t('reports.netBalance')]],
      body: vm.totalsSection.memberNet.map((row) => [
        row.label,
        formatCurrencyCents(row.netCents, { locale, currency }),
      ]),
      theme: 'striped',
      styles: { ...pdfCellBorder, fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: PDF_TOTALS_TABLE_HEAD_RGB, textColor: 255 },
      didParseCell: pdfHeadHalignRightCols([1]),
      columnStyles: {
        0: { cellWidth: innerW * 0.58 },
        1: { cellWidth: innerW * 0.42, halign: 'right' },
      },
    });
    y = getLastAutoTableFinalY(doc) + 6;

    doc.setFont('helvetica', 'bold');
    doc.text(t('reports.whoOwesWho'), MM_MARGIN, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
    if (vm.totalsSection.transfers.length === 0) {
      doc.text(t('reports.noTransfersNeeded'), MM_MARGIN, y);
      y += 8;
    } else {
      autoTable(doc, {
        startY: y,
        tableWidth: innerW,
        head: [[t('reports.transferFrom'), t('reports.transferTo'), t('reports.expenseAmount')]],
        body: vm.totalsSection.transfers.map((row) => [
          row.fromLabel,
          row.toLabel,
          formatCurrencyCents(row.amountCents, { locale, currency }),
        ]),
        theme: 'striped',
        styles: { ...pdfCellBorder, fontSize: 8, cellPadding: 1.5 },
        headStyles: { fillColor: PDF_TOTALS_TABLE_HEAD_RGB, textColor: 255 },
        didParseCell: pdfHeadHalignRightCols([2]),
        columnStyles: {
          0: { cellWidth: innerW * 0.34 },
          1: { cellWidth: innerW * 0.34 },
          2: { cellWidth: innerW * 0.32, halign: 'right' },
        },
      });
      y = getLastAutoTableFinalY(doc) + 8;
    }

    /* 5. Comprovativos — grelha 3 colunas (legenda + miniatura) */
    const receiptItems = vm.receiptsSection.items;
    if (receiptItems.length > 0) {
      if (y > pageH - 40) {
        doc.addPage();
        y = MM_MARGIN;
      }
      addSectionTitle(t('reports.sectionReceipts'));

      const receiptColW = (innerW - (RECEIPT_COL_COUNT - 1) * RECEIPT_COL_GAP_MM) / RECEIPT_COL_COUNT;
      const receiptColX = (col: number) => MM_MARGIN + col * (receiptColW + RECEIPT_COL_GAP_MM);
      let receiptColYs = [y, y, y];

      const newReceiptPage = () => {
        doc.addPage();
        receiptColYs = [MM_MARGIN, MM_MARGIN, MM_MARGIN];
      };

      for (const item of receiptItems) {
        let dataUrl: string | null = null;
        if (item.embeddableAsImage) {
          const signed = await getExpenseReceiptSignedUrl(supabase, item.receiptPath, RECEIPT_SIGN_URL_SEC);
          if (signed) {
            dataUrl = await loadImageAsJpegDataUrlForPdf(signed);
          }
        }

        let iw = 1;
        let ih = 1;
        if (dataUrl) {
          try {
            const props = doc.getImageProperties(dataUrl);
            iw = props.width || 1;
            ih = props.height || 1;
          } catch {
            iw = 1;
            ih = 1;
          }
        }
        const ratio = ih / iw;

        const bottomLimit = pageH - MM_MARGIN;

        const placeBlock = (): boolean => {
          const c = receiptPickShortestCol(receiptColYs);
          const x = receiptColX(c);
          let cy = receiptColYs[c];

          if (cy > bottomLimit - 22) {
            return false;
          }

          doc.setFontSize(9);
          doc.setFont('helvetica', 'bold');
          const capLines = doc.splitTextToSize(item.expenseTitle, receiptColW);
          doc.text(capLines, x, cy);
          const lineGap = 3.8;
          let lineY = cy + capLines.length * lineGap + 2;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7);

          if (!item.embeddableAsImage || !dataUrl) {
            const errText = !item.embeddableAsImage
              ? `${item.filename ?? '—'} — ${t('reports.receiptSkipNonImage')}`
              : t('reports.receiptCouldNotLoad');
            const msg = doc.splitTextToSize(errText, receiptColW);
            const msgH = msg.length * 3.2;
            if (lineY + msgH > bottomLimit) {
              return false;
            }
            doc.text(msg, x, lineY);
            receiptColYs[c] = lineY + msgH + 4;
            return true;
          }

          const maxW = receiptColW;
          let maxH = Math.min(RECEIPT_MAX_IMAGE_H_MM, bottomLimit - lineY);
          if (maxH < 12) {
            return false;
          }
          let dispW = maxW;
          let dispH = dispW * ratio;
          if (dispH > maxH) {
            dispH = maxH;
            dispW = dispH / ratio;
          }
          if (lineY + dispH > bottomLimit) {
            return false;
          }
          doc.addImage(dataUrl, 'JPEG', x, lineY, dispW, dispH);
          receiptColYs[c] = lineY + dispH + 4;
          return true;
        };

        while (!placeBlock()) {
          newReceiptPage();
        }
      }
    }

    const stamp = `${safeFilePart(h.groupName)}_${safeFilePart(h.batchTitle)}_${new Date().toISOString().slice(0, 10)}`;
    doc.save(`splitly-relatorio-${stamp}.pdf`);
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'PDF failed';
    return { ok: false, error: msg };
  }
}
