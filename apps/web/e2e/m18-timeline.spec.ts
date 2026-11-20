import { expect, test, type Page } from '@playwright/test';

/* F4.1 Timeline: cues en pistas, cue list / shot list y cabezal en directo. */

const H = { 'x-runflow-request': '1' };
const ADMIN = { email: 'ana@chaneltv.test', password: 'contraseña-segura-1' };
const row = (page: Page, i: number) => page.locator('.rf-rgrid tbody tr').nth(i);

test('F4.1: timeline con cues, cue list y directo', async ({ page, request }) => {
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
    data: { name: `Timeline ${Date.now()}`, type: 'entretenimiento' },
  });
  const rundownId = (
    await (
      await request.post('/api/rundowns', {
        headers: H,
        data: {
          programId: (await program.json()).program.id,
          airDate: '2026-11-20',
          startTime: '21:00',
          endTime: '22:00',
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
    data.setData('text/plain', ['0:30\tACTING\tAPERTURA', '3:00\tVARIOS\tCANCIÓN'].join('\n'));
    document
      .querySelector('.rf-rgrid-scroll')!
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await expect(page.locator('.rf-rgrid tbody tr')).toHaveCount(2);

  // Timeline: un cue de cámara al principio y uno de luces en la canción.
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.locator('.rf-timeline__line')).toHaveCount(2);
  await page.locator('.rf-timeline__row[data-track="camara"]').click({ position: { x: 4, y: 15 } });
  let dialog = page.getByRole('dialog', { name: 'Nuevo cue' });
  await dialog.getByLabel('Texto').fill('CAM 1 PG');
  await dialog.getByLabel('Dato para automatizar (opcional)').fill('CAM 1');
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('button', { name: /Cue CAM 1 PG/ })).toBeVisible();

  await page
    .locator('.rf-timeline__row[data-track="luces"]')
    .click({ position: { x: 320, y: 15 } });
  dialog = page.getByRole('dialog', { name: 'Nuevo cue' });
  await expect(dialog.getByLabel('Línea', { exact: true }).locator('option:checked')).toHaveText(
    /CANCIÓN/,
  );
  await dialog.getByLabel('Texto').fill('LQ 5');
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('button', { name: /Cue LQ 5/ })).toBeVisible();

  // Editar el tiempo del cue de cámara.
  await page.getByRole('button', { name: /Cue CAM 1 PG/ }).click();
  dialog = page.getByRole('dialog', { name: 'Editar cue' });
  await dialog.getByLabel('Tiempo en la línea (m:ss:ff)').fill('0:02:10');
  await dialog.getByRole('button', { name: 'Guardar' }).click();

  // Cue list y shot list.
  await page.getByRole('tab', { name: 'Cue list' }).click();
  await expect(page.getByRole('table', { name: 'Cue list' }).locator('tbody tr')).toHaveCount(2);
  await page.getByLabel('Pista').selectOption('camara');
  const shots = page.getByRole('table', { name: 'Shot list' });
  await expect(shots.locator('tbody tr')).toHaveCount(1);
  await expect(shots.locator('tbody tr').first()).toContainText('0:02:10');
  await expect(shots.locator('tbody tr').first()).toContainText('CAM 1 PG');

  // En directo: cabezal y siguiente cue.
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await page.getByRole('combobox', { name: 'Modo', exact: true }).selectOption('manual');
  await page.getByRole('button', { name: 'GO', exact: true }).click();
  await expect(page.locator('.rf-timeline__playhead')).toBeVisible();
  await expect(page.locator('.rf-timeline__next')).toContainText('CAM 1 PG');
  // La automatización lo ejecuta a su tiempo (sin armar: solo aviso).
  await expect(page.getByTestId('last-cue')).toContainText('CAM 1 PG', { timeout: 8000 });
  await expect(page.getByTestId('last-cue')).toContainText('sin armar');
});
