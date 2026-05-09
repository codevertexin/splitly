import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { openGroupByName } from '../helpers/groups';
import { openReports } from '../helpers/reports';
import {
  clickSettlementCtaRequired,
  openSummaryTabRequired,
  pause,
} from './demoHelpers';
import { DEMO_COPY, DEMO_CTA, DEMO_GROUP_NAME, DEMO_TIMING } from './demoData';

test('Demo short Splitly', async ({ page }) => {
  test.setTimeout(90_000);

  await login(page);
  await pause(DEMO_TIMING.short);

  await openGroupByName(page, DEMO_GROUP_NAME);
  await pause(DEMO_TIMING.short);

  await openSummaryTabRequired(page);
  await pause(DEMO_TIMING.medium);

  await clickSettlementCtaRequired(page, {
    primary: DEMO_CTA.primarySettlement,
    requestOnly: DEMO_CTA.requestOnly,
    settleOnly: DEMO_CTA.settleOnly,
  });

  await expect(page.getByText(DEMO_COPY.settlementDialogTitle)).toBeVisible();
  await pause(DEMO_TIMING.medium);

  await openReports(page);
  await expect(page.getByRole('button', { name: DEMO_COPY.pdfButton })).toBeVisible();
  await pause(DEMO_TIMING.medium);
});