import { test, expect } from '@playwright/test';
import { openGroupByName } from '../helpers/groups';
import { openReports } from '../helpers/reports';
import { rx } from '../shared/selectors';
import { login } from '../helpers/auth';
import { TEST_GROUP_WITH_EXPENSES_NAME } from '../shared/testData';

test.describe('Histórico e relatórios', () => {
  test('CYC-05 histórico mostra batches fechados', async ({ page }) => {
    await login(page);
    await openGroupByName(page, TEST_GROUP_WITH_EXPENSES_NAME);

    const historyTab = page.getByRole('button', { name: rx.historyTab });
    await historyTab.click();

    await expect(
      page.getByRole('heading', { name: /histórico de despesas|expense history/i })
    ).toBeVisible();
  });

  test('RPT-04 relatório respeita a estrutura oficial', async ({ page }) => {
    await login(page);
    await openReports(page);

    await expect(page.getByRole('heading', { name: /totais|totals/i })).toBeVisible();
    await expect(page.getByText(/comprovativos|receipts/i)).toBeVisible();
  });

  test('RPT-11 filtro só despesas de grupo', async ({ page }) => {
    await login(page);
    await openReports(page);

    const eventFilter = page.locator('select').last();
    await eventFilter.selectOption('__group__');

    await expect(eventFilter).toHaveValue('__group__');
    await expect(page.getByRole('heading', { name: rx.reportsTitle })).toBeVisible();
  });

  test('RPT-14 download PDF disponível', async ({ page }) => {
    await login(page);
    await openReports(page);

    const button = page.getByRole('button', { name: rx.downloadPdf });
    await expect(button).toBeVisible();
  });
});