import { test, expect } from '@playwright/test';

test('capturar home real', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await page.waitForLoadState('networkidle');

  await expect(page.getByRole('button', { name: 'Começar' })).toBeVisible();

  await page.addStyleTag({
    content: `
      *,
      *::before,
      *::after {
        transition: none !important;
        animation: none !important;
      }
    `,
  });

  await page.screenshot({
    path: 'screenshots/01-home-real.png',
    fullPage: true,
  });
});