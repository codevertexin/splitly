import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

test('AUTH-01 login com credenciais válidas', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('navigation')).toBeVisible();
});