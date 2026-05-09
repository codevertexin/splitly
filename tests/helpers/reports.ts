import { expect, Page } from '@playwright/test';
import { rx } from '../shared/selectors';

export async function openReports(page: Page) {
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: rx.reportsTitle })).toBeVisible();
}