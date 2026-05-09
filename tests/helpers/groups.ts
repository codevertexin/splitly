import { expect, Page } from '@playwright/test';

export async function openGroups(page: Page) {
  await page.goto('/groups');
  await expect(page).toHaveURL(/\/groups/);
  await expect(page.getByRole('navigation')).toBeVisible();
}

export async function openGroupByName(page: Page, groupName: string) {
  await openGroups(page);

  const groupItem = page.getByText(groupName, { exact: false });

  await expect
    .poll(async () => await groupItem.count(), { timeout: 15000 })
    .toBeGreaterThan(0);

  await expect(groupItem.first()).toBeVisible({ timeout: 15000 });
  await groupItem.first().click();

  await expect(page).toHaveURL(/\/groups\//);
}

export async function createGroup(
  page: Page,
  groupName: string,
  cycleName: string
) {
  await openGroups(page);

  await page.getByRole('button', { name: /^novo$/i }).click();

  await page.getByPlaceholder(/esqui 2024|group/i).fill(groupName);
  await page.getByPlaceholder(/despesas partilhadas|description/i).fill('Teste automático');
  await page.getByPlaceholder(/ciclo 1|initial cycle|ciclo/i).fill(cycleName);

  await page.getByRole('button', { name: /criar grupo|create group/i }).click();

  await expect(page.getByText(groupName, { exact: false })).toBeVisible();
}