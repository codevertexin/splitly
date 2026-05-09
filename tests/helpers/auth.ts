import { expect, Page } from '@playwright/test';
import { rx } from '../shared/selectors';

export async function login(page: Page) {
  const email = process.env.PLAYWRIGHT_USER_EMAIL;
  const password = process.env.PLAYWRIGHT_USER_PASSWORD;

  if (!email || !password) {
    throw new Error('PLAYWRIGHT_USER_EMAIL e PLAYWRIGHT_USER_PASSWORD são obrigatórios.');
  }

  await page.goto('/');
  await page.getByPlaceholder(/you@example\.com|email/i).fill(email);
  await page.getByPlaceholder(/enter your password|password/i).fill(password);
  await page.getByRole('button', { name: rx.signInSubmit }).click();

  await expect
    .poll(async () => {
      const url = page.url();
      const navCount = await page.getByRole('navigation').count();
      return /\/dashboard/.test(url) || navCount > 0;
    }, { timeout: 15000 })
    .toBeTruthy();

  await expect(page.getByRole('navigation')).toBeVisible();
}