import { test, expect, Page } from '@playwright/test';
import { login } from '../helpers/auth';
import {
  openGroupByName,
  openGroupSummaryIfPresent,
} from '../helpers/groups';
import {
  TEST_SETTLEMENT_ACTION_GROUP_NAME,
  TEST_SETTLEMENT_OVERVIEW_GROUP_NAME,
} from '../shared/testData';

test.describe.configure({ mode: 'serial' });

test.skip(
  ({ isMobile }) => isMobile,
  'Settlement E2E usa fixture partilhado e corre apenas em desktop.'
);

async function openSettlementGroup(page: Page, groupName: string) {
  await openGroupByName(page, groupName);
  await openGroupSummaryIfPresent(page);
}

test.describe('Settlements', () => {
  test('STL-00 grupo mostra área financeira de settlement', async ({ page }) => {
    await login(page);
    await openSettlementGroup(page, TEST_SETTLEMENT_OVERVIEW_GROUP_NAME);

    await expect(page.locator('body')).toContainText(
      /receber|pagar|acertos|settlement|pagamentos/i
    );
  });

  test('STL-01 fluxo de settlement abre interação de confirmação', async ({ page }) => {
    await login(page);
    await openSettlementGroup(page, TEST_SETTLEMENT_ACTION_GROUP_NAME);

    await expect(page.locator('body')).toContainText(
      /receber|pagar|acertos|pagamentos/i
    );

    const primarySettlementCta = page.getByRole('button', {
      name: /pedir pagamentos|request payments|saldar dívidas|settle debts/i,
    });

    const individualRequestBtn = page.getByRole('button', {
      name: /^pedir$|^request$/i,
    });

    const individualSettleBtn = page.getByRole('button', {
      name: /^acertar$|^settle$/i,
    });

    const totalCtas =
      (await primarySettlementCta.count()) +
      (await individualRequestBtn.count()) +
      (await individualSettleBtn.count());

    test.skip(totalCtas === 0, 'Fixture de settlement sem CTA acionável neste momento.');

    if (await primarySettlementCta.count()) {
      await primarySettlementCta.first().click();
    } else if (await individualRequestBtn.count()) {
      await individualRequestBtn.first().click();
    } else {
      await individualSettleBtn.first().click();
    }

    await expect(
      page.getByText(/registar acertos neste grupo|record settlements for this group/i)
    ).toBeVisible();

    await expect(
      page.getByText(/vamos pedir confirmação do pagamento|we.ll ask for payment confirmation/i)
    ).toBeVisible();
  });
});