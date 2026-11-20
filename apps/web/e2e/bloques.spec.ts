import { expect, test, type Page } from '@playwright/test';

/* Bloques con reloj propio (PLAN §10): marcar un inicio de bloque y verlo en directo. */

const H = { 'x-runflow-request': '1' };
const ADMIN = { email: 'ana@chaneltv.test', password: 'contraseña-segura-1' };
const row = (page: Page, i: number) => page.locator('.rf-rgrid tbody tr').nth(i);

test('bloque con reloj propio en el directo', async ({ page, request }) => {
  const status = await (await request.get('/api/setup/status')).json();
  if (status.needsSetup) {
    await request.post('/api/setup', {
      headers: H,
      data: { orgName: 'Chanel TV', name: 'Ana Admin', ...ADMIN },
    });
  } else {
    await request.post('/api/auth/login', { headers: H, data: ADMIN });
  }
  const program = await request.post('/api/programs', {
    headers: H,
    data: { name: `Bloques ${Date.now()}`, type: 'informativo' },
  });
  const rundownId = (
    await (
      await request.post('/api/rundowns', {
        headers: H,
        data: {
          programId: (await program.json()).program.id,
          airDate: '2026-11-20',
          startTime: '21:00',
          endTime: '21:30',
        },
      })
    ).json()
  ).rundown.id;

  await page.goto('/entrar');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Hola/ })).toBeVisible();
  await page.goto(`/escaletas/${rundownId}`);
  await expect(page.locator('.rf-conn--online')).toBeVisible();
  await page.getByRole('button', { name: 'Añadir la primera línea' }).click();
  await row(page, 0).locator('td[data-col="t_est"]').click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData(
      'text/plain',
      ['0:20\tCAB_RAF\tCABECERA', '0:30\tACTING\tHEADLINES 1', '1:00\tTEMA\tGOBIERNO'].join('\n'),
    );
    document
      .querySelector('.rf-rgrid-scroll')!
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await expect(page.locator('.rf-rgrid tbody tr')).toHaveCount(3);

  await row(page, 1).locator('td[data-col="nombre"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Inicio de bloque (reloj propio)' }).click();
  await expect(row(page, 1)).toHaveClass(/is-block/);

  await page.getByRole('combobox', { name: 'Modo', exact: true }).selectOption('manual');
  await page.getByRole('button', { name: 'GO', exact: true }).click();
  await expect(page.getByTestId('clock-block')).toHaveCount(0); // la cabecera no es del bloque
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'GO', exact: true }).click();
  await expect(page.getByTestId('clock-block')).toContainText('BLOQUE · HEADLINES 1');
  await expect(page.getByTestId('clock-block')).toContainText('1:30 previsto');
});
