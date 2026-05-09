import { Page } from '@playwright/test';

export async function openEvents(page: Page) {
  await page.goto('/events');
}