import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

/*
 * Criterio de aceptación de M5: migrar la escaleta de referencia desde XLSX e
 * imprimir sus vistas; chat, nevera, plantillas, versiones y papelera.
 */

const shots = process.env.SCREENSHOT_DIR;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}
const H = { 'x-runflow-request': '1' };
const ADMIN = { email: 'ana@chaneltv.test', password: 'contraseña-segura-1' };

/** Abre una opción del menú «Escaleta ▾». */
async function rundownMenu(page: Page, item: string) {
  await page.locator('summary', { hasText: 'Escaleta ▾' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

function row(page: Page, i: number) {
  return page.locator('.rf-rgrid tbody tr').nth(i);
}
function val(page: Page, i: number, col: string) {
  return row(page, i).locator(`td[data-col="${col}"] .rf-cell__text`);
}

async function productor(browser: Browser, admin: Page) {
  const roles = (await (await admin.request.get('/api/roles')).json()).roles as {
    id: string;
    key: string;
  }[];
  const email = `pedro-${Date.now()}@chaneltv.test`;
  await admin.request.post('/api/users', {
    headers: H,
    data: {
      name: 'Pedro Productor',
      email,
      roleId: roles.find((r) => r.key === 'productor')!.id,
      password: 'temporal-12345',
    },
  });
  const ctx = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    locale: 'es-ES',
  });
  await ctx.request.post('/api/auth/login', {
    headers: H,
    data: { email, password: 'temporal-12345' },
  });
  await ctx.request.post('/api/me/password', {
    headers: H,
    data: { currentPassword: 'temporal-12345', newPassword: 'clave-definitiva-1' },
  });
  return ctx;
}

test('M5: migrar la escaleta de referencia desde XLSX, imprimir y colaborar', async ({
  page,
  browser,
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
  const programName = `Magacín ${Date.now()}`;
  const program = await request.post('/api/programs', {
    headers: H,
    data: { name: programName, type: 'magacin' },
  });
  const programId = (await program.json()).program.id;
  const created = await request.post('/api/rundowns', {
    headers: H,
    data: {
      programId,
      airDate: '2026-11-20',
      startTime: '12:00',
      endTime: '13:30',
      title: 'Migración referencia',
    },
  });
  const rundownId = (await created.json()).rundown.id;

  await page.goto('/entrar');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Hola/ })).toBeVisible();
  await page.goto(`/escaletas/${rundownId}`);
  await expect(page.locator('.rf-conn--online')).toBeVisible();
  await page.getByLabel('Vista', { exact: true }).selectOption({ label: 'Completa' });

  // 1. Importar la escaleta de referencia desde XLSX
  await rundownMenu(page, 'Importar/Exportar');
  const io = page.getByRole('dialog');
  await io
    .getByLabel('Archivo para importar')
    .setInputFiles(path.join(import.meta.dirname, 'fixtures/escaleta-referencia.xlsx'));
  await expect(io.getByText(/líneas listas/)).toBeVisible();
  const importButton = io.getByRole('button', { name: /^Importar \d+ líneas$/ });
  const count = Number((await importButton.textContent())!.match(/\d+/)![0]);
  expect(count).toBeGreaterThanOrEqual(14);
  await importButton.click();
  await expect(io.getByText(`${count} líneas importadas.`)).toBeVisible();
  await io.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(page.locator('.rf-rgrid tbody tr')).toHaveCount(count);
  await expect(val(page, 0, 'nombre')).toHaveText('PRESENTACION');
  await expect(val(page, 0, 'estado')).toHaveText('C');
  await expect(val(page, 0, 't_est')).toHaveText('0:00:30');
  await expect(val(page, 0, 'tipo')).toHaveText('ACTING');
  const vtr = page.locator('.rf-rgrid tbody tr', { hasText: 'VTR ANDALUCIA' });
  await expect(vtr.locator('td[data-col="tipo"] .rf-cell__text')).toHaveText('VTR');
  await expect(vtr.locator('td[data-col="fuente"] .rf-cell__text')).toHaveText('VTR 1');
  await expect(vtr.locator('td[data-col="dur_vtr"] .rf-cell__text')).toHaveText('0:01:10');
  await shot(page, 'm5-importada');

  // 2. Imprimir la vista de realización
  const printPage = await page.context().newPage();
  await printPage.goto(`/escaletas/${rundownId}/imprimir?vista=realizacion`);
  await expect(printPage.getByRole('heading', { name: 'Migración referencia' })).toBeVisible();
  await expect(printPage.locator('.rf-print__table tbody tr')).toHaveCount(count);
  await expect(printPage.locator('.rf-print__table th', { hasText: 'FUENTE' })).toBeVisible();
  await shot(printPage, 'm5-imprimir');
  const pdf = await printPage.pdf({ format: 'A4', landscape: true });
  expect(pdf.byteLength).toBeGreaterThan(10_000);
  await printPage.close();

  // 3. Chat entre dos personas
  const pedroCtx = await productor(browser, page);
  const pedro = await pedroCtx.newPage();
  await pedro.goto(`/escaletas/${rundownId}`);
  await expect(pedro.locator('.rf-conn--online')).toBeVisible();
  await page.getByRole('tab', { name: 'Chat' }).click();
  await page.getByLabel('Mensaje del chat').fill('¿Está el VTR de Andalucía?');
  await page.getByLabel('Mensaje del chat').press('Enter');
  await expect(pedro.getByRole('tab', { name: 'Chat (1)' })).toBeVisible();
  await pedro.getByRole('tab', { name: /Chat/ }).click();
  await expect(pedro.getByText('¿Está el VTR de Andalucía?')).toBeVisible();
  await pedro.getByLabel('Mensaje del chat').fill('Sí, subido.');
  await pedro.getByLabel('Mensaje del chat').press('Enter');
  await expect(page.getByText('Sí, subido.')).toBeVisible();
  await pedroCtx.close();

  // 4. Nevera: guardar una línea e insertarla
  await vtr.locator('td[data-col="nombre"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Guardar en la nevera' }).click();
  await expect(page.getByRole('tab', { name: 'Nevera' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel').getByText('VTR ANDALUCIA')).toBeVisible();
  await row(page, 0).locator('td[data-col="nombre"]').click();
  await page.getByRole('tabpanel').getByRole('button', { name: 'Insertar' }).first().click();
  await expect(page.locator('.rf-rgrid tbody tr')).toHaveCount(count + 1);
  await expect(val(page, 1, 'nombre')).toHaveText('VTR ANDALUCIA');

  // 5. Versiones: guardar, cambiar y restaurar
  await page.getByRole('tab', { name: 'Versiones' }).click();
  await page.getByLabel('Nombre de la versión').fill('Tras importar');
  await page.getByRole('button', { name: 'Guardar versión' }).click();
  await expect(page.getByText('Versión guardada.')).toBeVisible();
  await row(page, 1).locator('td[data-col="nombre"]').click();
  await page.keyboard.press('Control+Delete');
  await expect(page.locator('.rf-rgrid tbody tr')).toHaveCount(count);
  const item = page
    .getByRole('tabpanel')
    .getByRole('listitem')
    .filter({ hasText: 'Tras importar' });
  await item.getByRole('button', { name: 'Restaurar' }).click();
  await item.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.locator('.rf-rgrid tbody tr')).toHaveCount(count + 1);

  // 6. Plantilla y escaleta nueva a partir de ella
  await rundownMenu(page, 'Guardar como plantilla');
  await page.getByRole('dialog').getByLabel('Nombre').fill('Magacín tipo');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Plantilla «Magacín tipo» guardada.')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.goto('/escaletas');
  await page.getByRole('button', { name: '+ Nueva escaleta' }).click();
  const nd = page.getByRole('dialog');
  await nd.getByLabel('Programa').selectOption({ label: programName });
  await nd.getByLabel('Plantilla').selectOption({ label: `Magacín tipo (${count + 1} líneas)` });
  await nd.getByLabel('Fecha de emisión').fill('2026-11-27');
  await nd.getByRole('button', { name: 'Crear' }).click();
  await expect(page).toHaveURL(/\/escaletas\/[0-9a-f-]{36}$/);
  await expect(page.locator('.rf-rgrid tbody tr')).toHaveCount(count + 1);
  await expect(
    page.locator('.rf-rgrid tbody tr').first().locator('td[data-col="estado"] .rf-cell__text'),
  ).toHaveText('');

  // 7. Papelera: borrar y recuperar
  await rundownMenu(page, 'Datos de la escaleta');
  await page.getByRole('dialog').getByRole('button', { name: 'Borrar escaleta' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Borrar escaleta' }).click();
  await expect(page).toHaveURL(/\/escaletas$/);
  await page.goto('/archivo');
  await page
    .getByRole('listitem')
    .filter({ hasText: programName })
    .getByRole('button', { name: 'Recuperar' })
    .first()
    .click();
  await expect(page.getByText('Escaleta recuperada.')).toBeVisible();
  // Búsqueda en el archivo
  await page.getByLabel('Buscar', { exact: true }).fill('andalucia');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.locator('.rf-results li').first()).toContainText('VTR ANDALUCIA');
  await shot(page, 'm5-archivo');
});
