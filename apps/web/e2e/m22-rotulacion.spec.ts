import { expect, test, type Page } from '@playwright/test';

/* Dirección TV → Rotulación: hoja de rótulos en orden de guion, importar y exportar. */

const H = { 'x-runflow-request': '1' };
const ADMIN = { email: 'ana@chaneltv.test', password: 'contraseña-segura-1' };
const shots = process.env.SCREENSHOT_DIR;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}
const sheetRow = (page: Page, i: number) => page.locator('.rf-gsheet tbody tr').nth(i);

test('Rotulación: crear, editar, importar, exportar y borrar rótulos', async ({
  page,
  request,
}) => {
  const status = await (await request.get('/api/setup/status')).json();
  if (status.needsSetup) {
    await request.post('/api/setup', {
      headers: H,
      data: { orgName: 'Chanel TV', name: 'Ana Admin', ...ADMIN },
    });
  } else {
    await request.post('/api/auth/login', { headers: H, data: ADMIN });
  }
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const program = await request.post('/api/programs', {
    headers: H,
    data: { name: `Rotulación ${Date.now()}`, type: 'informativo' },
  });
  const rundownId = (
    await (
      await request.post('/api/rundowns', {
        headers: H,
        data: {
          programId: (await program.json()).program.id,
          airDate: today,
          startTime: '23:00',
          endTime: '23:30',
        },
      })
    ).json()
  ).rundown.id as string;

  await page.goto('/entrar');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Hola/ })).toBeVisible();

  // Escaleta con dos noticias.
  await page.goto(`/escaletas/${rundownId}`);
  await expect(page.locator('.rf-conn--online')).toBeVisible();
  await page.getByRole('button', { name: 'Añadir la primera línea' }).click();
  await page.locator('.rf-rgrid tbody tr').nth(0).locator('td[data-col="t_est"]').click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', ['0:30\tACTING\tAPERTURA', '1:00\tVTR\tPIEZA'].join('\n'));
    document
      .querySelector('.rf-rgrid-scroll')!
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await expect(page.locator('.rf-rgrid tbody tr')).toHaveCount(2);

  // Hoja de rótulos.
  await page.goto('/rotulacion');
  await expect(page.getByRole('heading', { name: 'Rotulación' })).toBeVisible();
  await page.getByLabel('Escaleta', { exact: true }).selectOption(rundownId);
  await expect(page.getByText('Esta escaleta no tiene rótulos')).toBeVisible();
  await page.getByLabel('Noticia del rótulo nuevo').selectOption({ label: '2 · APERTURA' });
  await page.getByLabel('Plantilla del rótulo nuevo').selectOption('TOT');
  await page.getByRole('button', { name: '+ Rótulo' }).click();
  await expect(sheetRow(page, 0).getByLabel(/Campo 1 del rótulo 1/)).toBeFocused();
  await page.keyboard.type('Ana Pérez');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Presentadora');
  await page.keyboard.press('Enter');
  await expect(sheetRow(page, 0).getByLabel(/Campo 2 del rótulo 1/)).toHaveValue('Presentadora');
  await expect(sheetRow(page, 0).getByLabel(/Campo 1 del rótulo 1/)).toHaveValue('Ana Pérez');

  // Importar un CSV: un localizador en la pieza.
  await page.getByLabel('Archivo CSV de rótulos').setInputFiles({
    name: 'rotulos.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Nº;Noticia;Plantilla;Campo 1;Campo 2;TC IN;TC OUT\n;PIEZA;LOC;Sevilla, Andalucía;;00:05;00:10\n',
    ),
  });
  await expect(page.getByText('1 rótulos nuevos, 0 actualizados.')).toBeVisible();
  await expect(page.locator('.rf-gsheet tbody tr')).toHaveCount(2);
  await expect(sheetRow(page, 1).getByLabel(/Campo 1 del rótulo 2/)).toHaveValue(
    'Sevilla, Andalucía',
  );
  await expect(sheetRow(page, 1).getByLabel('TC IN del rótulo 2')).toHaveValue('00:05');
  await expect(page.getByRole('heading', { name: /Vista previa/ })).toBeVisible();
  await shot(page, 'm22-rotulacion');

  // Exportar.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Exportar CSV' }).click(),
  ]);
  const csv = (await download.createReadStream())!;
  const chunks: Buffer[] = [];
  for await (const c of csv) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  expect(text).toContain('Plantilla');
  expect(text).toContain('Ana Pérez;Presentadora');
  expect(text).toContain('Sevilla, Andalucía');

  // Borrar el localizador.
  await page.getByRole('button', { name: 'Borrar el rótulo 2' }).click();
  await page.getByRole('button', { name: 'Confirmar borrar el rótulo 2' }).click();
  await expect(page.locator('.rf-gsheet tbody tr')).toHaveCount(1);

  // El rótulo está en el guion de la escaleta.
  await page.goto(`/escaletas/${rundownId}`);
  await expect(
    page.locator('.rf-rgrid tbody tr').nth(0).locator('td[data-col="grafismo"]'),
  ).toContainText('Ana Pérez');
});
