import { expect, Locator, Page } from '@playwright/test';
import { DEMO_COPY, DEMO_TABS } from './demoData';

export async function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureDemoOverlay(page: Page) {
  await page.evaluate(() => {
    if (document.getElementById('__demo-overlay-style__')) return;

    const style = document.createElement('style');
    style.id = '__demo-overlay-style__';
    style.textContent = `
      .__demo-tap-indicator__ {
        position: fixed;
        width: 34px;
        height: 34px;
        margin-left: -17px;
        margin-top: -17px;
        border-radius: 9999px;
        pointer-events: none;
        z-index: 2147483647;
        border: 3px solid rgba(37, 99, 235, 0.95);
        background: rgba(37, 99, 235, 0.18);
        box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.35);
        animation: demoTapPulse 700ms ease-out forwards;
      }

      .__demo-trail-dot__ {
        position: fixed;
        width: 10px;
        height: 10px;
        margin-left: -5px;
        margin-top: -5px;
        border-radius: 9999px;
        pointer-events: none;
        z-index: 2147483646;
        background: rgba(37, 99, 235, 0.35);
        animation: demoTrailFade 500ms ease-out forwards;
      }

      @keyframes demoTapPulse {
        0% {
          transform: scale(0.7);
          opacity: 0.95;
          box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.35);
        }
        70% {
          transform: scale(1.35);
          opacity: 0.55;
          box-shadow: 0 0 0 18px rgba(37, 99, 235, 0);
        }
        100% {
          transform: scale(1.55);
          opacity: 0;
          box-shadow: 0 0 0 24px rgba(37, 99, 235, 0);
        }
      }

      @keyframes demoTrailFade {
        0% { transform: scale(1); opacity: 0.55; }
        100% { transform: scale(0.5); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  });
}

export async function showTapIndicator(page: Page, x: number, y: number) {
  await ensureDemoOverlay(page);

  await page.evaluate(({ x, y }) => {
    const el = document.createElement('div');
    el.className = '__demo-tap-indicator__';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    document.body.appendChild(el);
    window.setTimeout(() => el.remove(), 800);
  }, { x, y });
}

export async function showTrailDot(page: Page, x: number, y: number) {
  await ensureDemoOverlay(page);

  await page.evaluate(({ x, y }) => {
    const el = document.createElement('div');
    el.className = '__demo-trail-dot__';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    document.body.appendChild(el);
    window.setTimeout(() => el.remove(), 550);
  }, { x, y });
}

export async function cinematicClick(
  page: Page,
  locator: Locator,
  options?: {
    beforeMs?: number;
    afterMs?: number;
    hoverSteps?: number;
    showTrail?: boolean;
  }
) {
  const beforeMs = options?.beforeMs ?? 200;
  const afterMs = options?.afterMs ?? 700;
  const hoverSteps = options?.hoverSteps ?? 12;
  const showTrail = options?.showTrail ?? true;

  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();

  const box = await locator.boundingBox();
  if (box) {
    const targetX = box.x + box.width / 2;
    const targetY = box.y + box.height / 2;
    const start = { x: Math.max(20, targetX - 80), y: Math.max(20, targetY - 80) };

    for (let i = 1; i <= hoverSteps; i += 1) {
      const progress = i / hoverSteps;
      const x = start.x + (targetX - start.x) * progress;
      const y = start.y + (targetY - start.y) * progress;

      await page.mouse.move(x, y, { steps: 1 });

      if (showTrail && i < hoverSteps) {
        await showTrailDot(page, x, y);
      }

      await pause(12);
    }

    await pause(beforeMs);
    await showTapIndicator(page, targetX, targetY);
  } else {
    await pause(beforeMs);
  }

  await locator.click();
  await pause(afterMs);
}

export async function cinematicScrollTo(
  locator: Locator,
  options?: { settleMs?: number }
) {
  const settleMs = options?.settleMs ?? 900;

  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();

  await pause(settleMs);
}

export async function cinematicScrollPage(
  page: Page,
  amount: number,
  options?: {
    steps?: number;
    settleMs?: number;
  }
) {
  const steps = options?.steps ?? 8;
  const settleMs = options?.settleMs ?? 700;
  const perStep = amount / steps;

  for (let i = 0; i < steps; i += 1) {
    await page.evaluate((y) => window.scrollBy(0, y), perStep);
    await pause(80);
  }

  await pause(settleMs);
}

async function findTab(page: Page, pattern: RegExp) {
  const byTab = page.getByRole('tab', { name: pattern });
  if (await byTab.count()) return byTab.first();

  const byButton = page.getByRole('button', { name: pattern });
  if (await byButton.count()) return byButton.first();

  const byLink = page.getByRole('link', { name: pattern });
  if (await byLink.count()) return byLink.first();

  const byText = page.getByText(pattern, { exact: false });
  if (await byText.count()) return byText.first();

  return null;
}

export async function openSummaryTabRequired(page: Page) {
  const summaryTab = await findTab(page, DEMO_TABS.summary);

  if (summaryTab) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await cinematicClick(page, summaryTab);
  }

  await expect(page.locator('body')).toContainText(DEMO_COPY.summarySignals);
}

export async function openExpensesTabRequired(page: Page) {
  const expensesTab = await findTab(page, DEMO_TABS.expenses);

  if (expensesTab) {
    await cinematicClick(page, expensesTab);
  }

  await expect(page.locator('body')).toContainText(DEMO_COPY.expensesSignals);
}

export async function openHistoryTabRequired(page: Page) {
  const historyTab = await findTab(page, DEMO_TABS.history);

  if (historyTab) {
    await cinematicClick(page, historyTab);
  }

  await expect(page.locator('body')).toContainText(DEMO_COPY.historySignals);
}

export async function clickSettlementCtaRequired(
  page: Page,
  patterns: {
    primary: RegExp;
    requestOnly: RegExp;
    settleOnly: RegExp;
  }
) {
  const primarySettlementCta = page.getByRole('button', { name: patterns.primary });
  const individualRequestBtn = page.getByRole('button', { name: patterns.requestOnly });
  const individualSettleBtn = page.getByRole('button', { name: patterns.settleOnly });

  if (await primarySettlementCta.count()) {
    await cinematicClick(page, primarySettlementCta.first());
    return;
  }

  if (await individualRequestBtn.count()) {
    await cinematicClick(page, individualRequestBtn.first());
    return;
  }

  if (await individualSettleBtn.count()) {
    await cinematicClick(page, individualSettleBtn.first());
    return;
  }

  throw new Error('Nenhum CTA de settlement disponível na fixture de demo.');
}

export async function showEventAreaIfPresent(page: Page, settleMs = 700) {
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
        await cinematicScrollTo(candidate, { settleMs });
        return true;
      }
    }
  }

  return false;
}