import { expect, Page } from '@playwright/test';
import { rx } from './selectors';

export async function waitForAppShell(page: Page) {
  await expect(page.getByRole('navigation')).toBeVisible();
}

export async function waitForReportsPage(page: Page) {
  await expect(page.getByRole('heading', { name: rx.reportsTitle })).toBeVisible();
}

export async function waitForGroupPage(page: Page) {
  await expect(page).toHaveURL(/\/groups\//);
}