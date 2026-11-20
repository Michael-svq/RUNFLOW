import { expect, test } from '@playwright/test';

/* F2.1 Media: subir un fichero, verlo y obtener su nombre de clip. */

const H = { 'x-runflow-request': '1' };
const ADMIN = { email: 'ana@chaneltv.test', password: 'contraseña-segura-1' };
// PNG de 1×1 píxel
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('F2.1: subir media, previsualizar y nombre de clip', async ({ page, request }) => {
  const status = await (await request.get('/api/setup/status')).json();
  if (status.needsSetup) {
    await request.post('/api/setup', {
      headers: H,
      data: { orgName: 'Chanel TV', name: 'Ana Admin', ...ADMIN },
    });
  }
  await page.goto('/entrar');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Hola/ })).toBeVisible();

  await page.goto('/media');
  await expect(page.getByRole('heading', { name: /Media/ })).toBeVisible();
  const folder = `Pruebas ${Date.now()}`;
  await page.getByLabel('Carpeta para lo que subas').fill(folder);
  await page.getByLabel('Subir ficheros').setInputFiles({
    name: 'Mosca del canal.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  const card = page.locator('.rf-media__item', { hasText: 'Mosca del canal' }).first();
  await expect(card).toBeVisible();
  await expect(card.locator('.rf-media__clip')).toHaveText(
    `${folder.toUpperCase().replace(/ /g, '_')}/MOSCA_DEL_CANAL`,
  );
  await page.getByRole('button', { name: folder }).click();
  await card.locator('.rf-media__thumb').click();
  const dialog = page.getByRole('dialog', { name: 'Mosca del canal' });
  await expect(dialog.locator('img')).toBeVisible();
});
