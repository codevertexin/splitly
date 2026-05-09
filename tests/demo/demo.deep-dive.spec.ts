import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { openGroupByName } from '../helpers/groups';
import { openReports } from '../helpers/reports';
import {
  clickSettlementCtaRequired,
  cinematicClick,
  cinematicScrollPage,
  cinematicScrollTo,
  openExpensesTabRequired,
  openHistoryTabRequired,
  openSummaryTabRequired,
  pause,
} from './demoHelpers';
import { DEMO_COPY, DEMO_CTA, DEMO_GROUP_NAME, DEMO_TIMING } from './demoData';

test('Demo deep dive Splitly', async ({ page }) => {
  test.setTimeout(150_000);

  await test.step('Entrar', async () => {
    await login(page);
    await pause(DEMO_TIMING.medium);
  });

  await test.step('Abrir grupo', async () => {
    await openGroupByName(page, DEMO_GROUP_NAME);
    await pause(DEMO_TIMING.medium);
  });

  await test.step('Resumo', async () => {
    await openSummaryTabRequired(page);
    await cinematicScrollPage(page, 350, { settleMs: DEMO_TIMING.medium });
    await cinematicScrollPage(page, -350, { settleMs: DEMO_TIMING.medium });
  });

  await test.step('Settlement', async () => {
    const hasPrimary = await page.getByRole('button', {
      name: DEMO_CTA.primarySettlement,
    }).count();

    const hasRequest = await page.getByRole('button', {
      name: DEMO_CTA.requestOnly,
    }).count();

    const hasSettle = await page.getByRole('button', {
      name: DEMO_CTA.settleOnly,
    }).count();

    if (hasPrimary || hasRequest || hasSettle) {
      await clickSettlementCtaRequired(page, {
        primary: DEMO_CTA.primarySettlement,
        requestOnly: DEMO_CTA.requestOnly,
        settleOnly: DEMO_CTA.settleOnly,
      });

      await expect(page.getByText(DEMO_COPY.settlementDialogTitle)).toBeVisible();
      await expect(page.getByText(DEMO_COPY.settlementDialogHint)).toBeVisible();
      await pause(DEMO_TIMING.long);

      const maybeClose = page.getByRole('button', { name: /fechar|close|cancelar|cancel/i });
      if (await maybeClose.count()) {
        await cinematicClick(page, maybeClose.first());
      } else {
        await page.keyboard.press('Escape').catch(() => {});
        await pause(DEMO_TIMING.short);
      }
    } else {
      await pause(DEMO_TIMING.medium);
    }
  });

  await test.step('Despesas', async () => {
    await openExpensesTabRequired(page);
    await cinematicScrollPage(page, 700, { settleMs: DEMO_TIMING.long });
  });

  await test.step('Histórico', async () => {
    await openHistoryTabRequired(page);
    await pause(DEMO_TIMING.long);
  });

  await test.step('Relatório', async () => {
    await openReports(page);
    await pause(DEMO_TIMING.medium);

    await expect(page.locator('body')).toContainText(DEMO_COPY.reportsTopSignals);

    const totalsSection = page.getByText(DEMO_COPY.reportsTotals).first();
    if (await totalsSection.count()) {
      await cinematicScrollTo(totalsSection, { settleMs: DEMO_TIMING.long });
    }

    const pdfButton = page.getByRole('button', { name: DEMO_COPY.pdfButton }).first();
    await expect(pdfButton).toBeVisible();

    await pause(DEMO_TIMING.long);
  });
});