import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { openEvents } from '../helpers/navigation';
import { openGroupByName } from '../helpers/groups';
import { rx } from '../shared/selectors';
import {
  TEST_EVENT_NAME,
  TEST_GROUP_WITH_EXPENSES_NAME,
} from '../shared/testData';

test.describe('Despesas', () => {
  test('EXP-GRP-03 criar despesa de grupo com participantes não editáveis', async ({ page }) => {
    await login(page);
    await openGroupByName(page, TEST_GROUP_WITH_EXPENSES_NAME);

    await page.getByRole('button', { name: rx.addExpense }).click();

    await expect(
      page.getByText(/todos os membros ativos|all active members/i)
    ).toBeVisible();
  });

  test('EXP-EVT-01 criar despesa de evento mantém participantes editáveis', async ({ page }) => {
    await login(page);
    await openEvents(page);

    const eventItem = page.getByRole('heading', {
      name: TEST_EVENT_NAME,
      exact: true,
    });
    await expect(eventItem).toBeVisible();
    await eventItem.click();

    await page.getByRole('button', { name: rx.addExpenseToEvent }).click();

    await expect(page.getByRole('checkbox').first()).toBeVisible();
  });
});