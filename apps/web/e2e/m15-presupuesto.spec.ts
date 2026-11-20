import { expect, test } from '@playwright/test';

/* F3.2 Presupuesto: partidas de una convocatoria, previsto frente a real. */

const H = { 'x-runflow-request': '1' };
const ADMIN = { email: 'ana@chaneltv.test', password: 'contraseña-segura-1' };

test('F3.2: partidas con previsto, real y desviación', async ({ page, request }) => {
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

  const title = `Grabación exteriores ${Date.now()}`;
  const created = await page.request.post('/api/production/events', {
    headers: H,
    data: { title, kind: 'grabacion', startsAt: new Date().toISOString() },
  });
  expect(created.status()).toBe(201);

  await page.goto('/produccion');
  await page
    .getByRole('button', { name: new RegExp(title) })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.getByRole('tab', { name: 'Presupuesto' }).last().click();

  const form = page.getByRole('form', { name: 'Nueva partida' });
  await form.getByLabel('Categoría').selectOption('catering');
  await form.getByLabel('Concepto').fill('Bocadillos');
  await form.getByLabel('Previsto (€)').fill('300');
  await form.getByLabel('Real (€)').fill('340,50');
  await form.getByRole('button', { name: 'Añadir partida' }).click();

  await expect(page.getByTestId('budget-planned')).toContainText('300,00');
  await expect(page.getByTestId('budget-actual')).toContainText('340,50');
  await expect(page.getByTestId('budget-deviation')).toContainText('+40,50');

  // Corregir el real en la tabla.
  const real = page.getByLabel('Real de Bocadillos');
  await real.fill('290');
  await real.blur();
  await expect(page.getByTestId('budget-deviation')).toContainText('-10,00');
  await expect(page.getByRole('link', { name: 'Exportar CSV' })).toHaveAttribute(
    'href',
    /eventId=/,
  );
});
