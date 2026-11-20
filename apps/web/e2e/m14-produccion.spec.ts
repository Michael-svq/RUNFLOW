import { expect, test } from '@playwright/test';

/* F3.1 Producción: personal, convocatoria, hoja de llamada y confirmación por enlace. */

const H = { 'x-runflow-request': '1' };
const ADMIN = { email: 'ana@chaneltv.test', password: 'contraseña-segura-1' };

test('F3.1: convocar, confirmar por enlace y hoja de llamada', async ({
  page,
  request,
  browser,
}) => {
  const status = await (await request.get('/api/setup/status')).json();
  if (status.needsSetup) {
    await request.post('/api/setup', {
      headers: H,
      data: { orgName: 'Chanel TV', name: 'Ana Admin', ...ADMIN },
    });
  }
  const n = Date.now();
  const person = `Luis Cámara ${n}`;
  const title = `Gala fin de curso ${n}`;

  await page.goto('/entrar');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Hola/ })).toBeVisible();

  await page.goto('/produccion');
  await expect(page.getByRole('heading', { name: /Producción/ })).toBeVisible();

  // Personal
  await page.getByRole('tab', { name: 'Personal' }).click();
  const newPerson = page.getByRole('form', { name: 'Nueva persona' });
  await newPerson.getByLabel('Nombre').fill(person);
  await newPerson.getByLabel('Puesto').fill('Cámara 1');
  await newPerson.getByLabel('Teléfono').fill('+34 600 000 001');
  await newPerson.getByRole('button', { name: 'Añadir persona' }).click();
  await expect(page.getByLabel(`name de ${person}`)).toHaveValue(person);

  // Convocatoria
  await page.getByRole('tab', { name: 'Calendario' }).click();
  await page.getByRole('button', { name: 'Nueva convocatoria' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nueva convocatoria' });
  await dialog.getByLabel('Título').fill(title);
  await dialog.getByLabel('Tipo').selectOption('directo');
  await dialog.getByLabel('Lugar').fill('Plató 1');
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  const convocar = page.getByRole('form', { name: 'Convocar' });
  await convocar.getByLabel('Convocar a').selectOption({ label: `${person} · Cámara 1` });
  await convocar.getByRole('button', { name: 'Convocar' }).click();
  await expect(page.getByLabel(`Estado de ${person}`)).toHaveValue('pendiente');

  // Enlace de confirmación (sin cuenta)
  const events = (await (await page.request.get('/api/production/events')).json()).events as {
    id: string;
    title: string;
  }[];
  const ev = events.find((e) => e.title === title)!;
  const detail = await (await page.request.get(`/api/production/events/${ev.id}`)).json();
  const token = detail.calls[0].token as string;

  const anon = await browser.newContext();
  const guest = await anon.newPage();
  await guest.goto(`/convocatoria/${token}`);
  await expect(guest.getByRole('heading', { name: title })).toBeVisible();
  await expect(guest.getByText('Plató 1')).toBeVisible();
  await guest.getByLabel('Mensaje para producción (opcional)').fill('Llego media hora antes');
  await guest.getByRole('button', { name: 'Confirmo' }).click();
  await expect(guest.locator('.rf-badge', { hasText: 'Confirmado' })).toBeVisible();
  await anon.close();

  // Producción lo ve (actualización periódica o al volver a abrir)
  await page.reload();
  await page
    .getByRole('button', { name: new RegExp(title) })
    .first()
    .click();
  await expect(page.getByLabel(`Estado de ${person}`)).toHaveValue('confirmado');
  await expect(page.getByText('Llego media hora antes')).toBeVisible();

  // Hoja de llamada imprimible
  await page.goto(`/produccion/${ev.id}/hoja`);
  await expect(page.getByRole('heading', { name: `Hoja de llamada · ${title}` })).toBeVisible();
  await expect(page.getByRole('cell', { name: person })).toBeVisible();
});
