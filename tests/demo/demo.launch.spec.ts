import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { openGroupByName } from '../helpers/groups';
import { openReports } from '../helpers/reports';
import {
  cinematicClick,
  cinematicScrollTo,
  openExpensesTabRequired,
  openSummaryTabRequired,
  pause,
} from './demoHelpers';
import { DEMO_COPY, DEMO_CTA, DEMO_GROUP_NAME } from './demoData';

const T = {
  short: 400,
  medium: 700,
  long: 1000,
};

async function showEventAreaIfPresent(page: import('@playwright/test').Page) {
  const candidates = [
    page.getByText(/with event|com evento/i).first(),
    page.getByText(/view event|ver evento/i).first(),
    page.getByText(/starts|começa/i).first(),
    page.getByText(/^jantar$/i).first(),
  ];

  for (const candidate of candidates) {
    if (await candidate.count()) {
      await candidate.scrollIntoViewIfNeeded();

      if (await candidate.isVisible().catch(() => false)) {
        await cinematicScrollTo(candidate, { settleMs: T.medium });
        return true;
      }
    }
  }

  return false;
}

test('Demo launch Splitly (optimized)', async ({ page }) => {
  test.setTimeout(90_000);

  // LOGIN
  await login(page);
  await pause(T.short);

  // GROUP
  await openGroupByName(page, DEMO_GROUP_NAME);
  await pause(500);

  // DESPESAS
  await openExpensesTabRequired(page);
  await expect(page.locator('body')).toContainText(/expenses|despesas/i);
  await pause(500);

  const firstAmount = page.getByText(/€|\$/).first();
  if (await firstAmount.count()) {
    await cinematicScrollTo(firstAmount, { settleMs: T.medium });
  }

  // EVENTO
  await showEventAreaIfPresent(page);
  await pause(700);

  // OVERVIEW
  await page.evaluate(() => window.scrollTo(0, 0));
  await openSummaryTabRequired(page);

  await pause(300);

  await cinematicScrollTo(
    page.getByText(/€|\$/).first(),
    { settleMs: 600 }
  );

  await expect(page.locator('body')).toContainText(DEMO_COPY.summarySignals);
  await pause(900);

  // RELATÓRIO
  await openReports(page);
  await pause(500);

  await expect(page.locator('body')).toContainText(DEMO_COPY.reportsTopSignals);

  const pdfButton = page.getByRole('button', {
    name: DEMO_COPY.pdfButton,
  }).first();

  await expect(pdfButton).toBeVisible();
  await pause(500);

  // BACK
  await openGroupByName(page, DEMO_GROUP_NAME);
  await pause(T.short);

  await openSummaryTabRequired(page);
  await pause(500);

  // SETTLEMENT
  // SETTLEMENT
await openSummaryTabRequired(page);
await pause(400);

// mostrar primeiro os cards do overview
await expect(page.locator('body')).toContainText(DEMO_COPY.summarySignals);
await pause(700);

// localizar CTA real
const primaryCta = page.getByRole('button', {
  name: DEMO_CTA.primarySettlement,
}).first();

const requestCta = page.getByRole('button', {
  name: DEMO_CTA.requestOnly,
}).first();

const settleCta = page.getByRole('button', {
  name: DEMO_CTA.settleOnly,
}).first();

let cta: typeof primaryCta | null = null;

if (await primaryCta.count()) cta = primaryCta;
else if (await requestCta.count()) cta = requestCta;
else if (await settleCta.count()) cta = settleCta;

if (!cta) {
  throw new Error('CTA de settlement não encontrado');
}

// 👇 importante: scroll até ao CTA, não para o topo da página
await cinematicScrollTo(cta, { settleMs: 900 });

// pequena pausa para o viewer ver o botão
await pause(900);

// click claro e visível
await cinematicClick(page, cta, {
  showTrail: false,
  beforeMs: 200,
  afterMs: 800,
});

await expect(
  page.getByText(DEMO_COPY.settlementDialogTitle)
).toBeVisible();

await expect(
  page.getByText(DEMO_COPY.settlementDialogHint)
).toBeVisible();

await pause(1400);
});