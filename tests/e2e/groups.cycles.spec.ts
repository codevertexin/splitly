import { test, expect } from '@playwright/test';
import { createGroup, openGroupByName } from '../helpers/groups';
import { rx } from '../shared/selectors';
import { login } from '../helpers/auth';
import {
  TEST_GROUP_WITH_EXPENSES_NAME,
  TEST_INITIAL_CYCLE,
} from '../shared/testData';

test.describe('Grupos e batches', () => {
  test('GRP-02 / CYC-01 criar grupo com primeiro ciclo', async ({ page }) => {
    const groupName = `QA Grupo ${Date.now()}`;

    await login(page);
    await createGroup(page, groupName, TEST_INITIAL_CYCLE);

    await expect(page.getByText(groupName, { exact: false })).toBeVisible();
  });

  test('CYC-02 botão fechar ciclo fica disponível em grupo com despesas', async ({ page }) => {
    await login(page);
    await openGroupByName(page, TEST_GROUP_WITH_EXPENSES_NAME);

    await expect(page.getByRole('button', { name: rx.closeBatch })).toBeVisible();
  });
});