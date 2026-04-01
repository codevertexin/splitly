// tests/manual-screenshots.spec.ts
import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';
const EMAIL = process.env.E2E_EMAIL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';

async function stabilize(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.addStyleTag({
    content: `
      *,
      *::before,
      *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
      html {
        scroll-behavior: auto !important;
      }
    `,
  }).catch(() => {});
  await page.waitForTimeout(1000);
}

async function login(page: Page) {
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await stabilize(page);

  await page.getByRole('textbox', { name: 'seu@email.com' }).fill(EMAIL);
  await page.getByRole('textbox', { name: '••••••••' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();

  await stabilize(page);

  await expect(page.getByRole('button', { name: 'Painel' })).toBeVisible({ timeout: 10000 });
}

async function saveShot(page: Page, path: string) {
  await stabilize(page);
  await page.screenshot({
    path,
    fullPage: true,
  });
}

test.describe('manual visual Splitly', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!EMAIL || !PASSWORD, 'Define E2E_EMAIL e E2E_PASSWORD antes de correr os testes.');
    await login(page);
  });

  test('01 - painel', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Painel' })).toBeVisible();
    await saveShot(page, 'screenshots/01-painel.png');
  });

  test('02 - grupo colegas de trabalho', async ({ page }) => {
    await page.getByRole('button', { name: 'Os meus grupos' }).click();
    await stabilize(page);

    await page.getByText('Colegas de trabalho').click();
    await stabilize(page);

    await saveShot(page, 'screenshots/02-grupo-colegas.png');
  });

  test('03 - convidados', async ({ page }) => {
    await page.goto(`${BASE_URL}/contacts`, { waitUntil: 'domcontentloaded' });
    await stabilize(page);

    await expect(page.getByRole('heading', { name: /convidados/i })).toBeVisible({ timeout: 10000 });
    await saveShot(page, 'screenshots/03-convidados.png');
  });

  test('04 - definições', async ({ page }) => {
    await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded' });
    await stabilize(page);

    await saveShot(page, 'screenshots/04-definicoes.png');
  });

  test('05 - detalhe de despesa', async ({ page }) => {
    await page.getByRole('button', { name: 'Detalhes' }).first().click();
    await stabilize(page);

    await saveShot(page, 'screenshots/05-detalhe-despesa.png');
  });

  test('06 - gerir grupo', async ({ page }) => {
    await page.getByRole('button', { name: 'Os meus grupos' }).click();
    await stabilize(page);

    await page.getByText('Colegas de trabalho').click();
    await stabilize(page);

    await page.getByRole('button', { name: 'Gerir grupo' }).click();
    await stabilize(page);

    await saveShot(page, 'screenshots/06-gerir-grupo.png');
  });

  test('07 - convite para grupo', async ({ page }) => {
    await page.getByRole('button', { name: 'Os meus grupos' }).click();
    await stabilize(page);

    await page.getByText('Colegas de trabalho').click();
    await stabilize(page);

    await page.getByRole('button', { name: 'Convidar' }).click();
    await stabilize(page);

    await saveShot(page, 'screenshots/07-convidar.png');
  });

  test('08 - eventos', async ({ page }) => {
    await page.getByRole('button', { name: 'Eventos' }).click();
    await stabilize(page);

    await saveShot(page, 'screenshots/08-eventos.png');
  });
});