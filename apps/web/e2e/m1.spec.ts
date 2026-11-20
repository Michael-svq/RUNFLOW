import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/*
 * Criterio de aceptación de M1: tres navegadores editan la misma escaleta a la
 * vez sin perder datos, también tras cortar la red de uno de ellos.
 */

const shots = process.env.SCREENSHOT_DIR;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}

const ADMIN = { email: 'ana@chaneltv.test', password: 'contraseña-segura-1' };
const H = { 'x-runflow-request': '1' };

async function ensureSetup(request: APIRequestContext) {
  const status = await (await request.get('/api/setup/status')).json();
  if (status.needsSetup) {
    await request.post('/api/setup', {
      headers: H,
      data: { orgName: 'Chanel TV', name: 'Ana Admin', ...ADMIN },
    });
  }
}

/** Crea (si no existe) un usuario con el rol dado y una contraseña definitiva. */
async function ensureUser(
  admin: APIRequestContext,
  browser: Browser,
  name: string,
  email: string,
  role: string,
) {
  const roles = (await (await admin.get('/api/roles')).json()).roles as {
    id: string;
    key: string;
  }[];
  const res = await admin.post('/api/users', {
    headers: H,
    data: {
      name,
      email,
      roleId: roles.find((r) => r.key === role)!.id,
      password: 'temporal-12345',
    },
  });
  const ctx = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    locale: 'es-ES',
  });
  if (res.status() === 201) {
    await ctx.request.post('/api/auth/login', {
      headers: H,
      data: { email, password: 'temporal-12345' },
    });
    await ctx.request.post('/api/me/password', {
      headers: H,
      data: { currentPassword: 'temporal-12345', newPassword: 'clave-definitiva-1' },
    });
  } else {
    await ctx.request.post('/api/auth/login', {
      headers: H,
      data: { email, password: 'clave-definitiva-1' },
    });
  }
  return ctx;
}

function row(page: Page, index: number) {
  return page.locator('.rf-rgrid tbody tr').nth(index);
}
function cell(page: Page, index: number, col: string) {
  return row(page, index).locator(`td[data-col="${col}"]`);
}

/** Texto de una celda (sin la etiqueta de presencia de otras personas). */
function val(page: Page, index: number, col: string) {
  return cell(page, index, col).locator('.rf-cell__text');
}

/** Escribe en una celda de texto: clic, teclear e Intro. */
async function typeIn(page: Page, index: number, col: string, text: string) {
  await cell(page, index, col).click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

test('M1: tres navegadores editan la misma escaleta, uno se queda sin red', async ({
  browser,
  page,
  request,
}) => {
  // Contexto de peticiones independiente (sin compartir la cookie con la página).
  await ensureSetup(request);
  await page.goto('/entrar');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Hola/ })).toBeVisible();

  // Programa y escaleta desde la interfaz
  await page.getByRole('link', { name: '04 Escaletas' }).click();
  await page.getByRole('button', { name: 'Programas' }).click();
  const programs = page.getByRole('dialog');
  await programs.getByLabel('Nombre').fill('Informativo Mediodía');
  await programs.getByLabel('Hora habitual de inicio').fill('14:00');
  await programs.getByLabel('Duración habitual (minutos)').fill('60');
  await programs.getByRole('button', { name: 'Crear' }).click();
  await expect(programs.getByText('Informativo Mediodía')).toBeVisible();
  await programs.getByRole('button', { name: 'Cerrar' }).click();

  await page.getByRole('button', { name: '+ Nueva escaleta' }).click();
  await expect(page.getByRole('dialog').getByLabel('Hora de inicio')).toHaveValue('14:00');
  await page.getByRole('dialog').getByRole('button', { name: 'Crear' }).click();
  await expect(page).toHaveURL(/\/escaletas\/[0-9a-f-]{36}$/);
  await expect(page.locator('.rf-conn--online')).toBeVisible();
  const url = page.url();

  // Primeras líneas (Ana)
  await page.getByRole('button', { name: 'Añadir la primera línea' }).click();
  await expect(row(page, 0)).toBeVisible();
  await typeIn(page, 0, 'nombre', 'PRESENTACION');
  await cell(page, 0, 'tipo').dblclick();
  await cell(page, 0, 'tipo').locator('select').selectOption('ACTING');
  await typeIn(page, 0, 't_est', '30');
  await cell(page, 0, 'estado').click();
  await page.keyboard.press('c');
  await expect(val(page, 0, 'estado')).toHaveText('C');
  await expect(val(page, 0, 't_est')).toHaveText('0:00:30');
  await expect(val(page, 0, 'tipo')).toHaveText('ACTING');
  await expect(val(page, 0, 'num')).toContainText('2');

  // Otras dos personas abren la misma escaleta
  const rosaCtx = await ensureUser(
    page.request,
    browser,
    'Rosa Realizadora',
    'rosa@chaneltv.test',
    'realizador',
  );
  const pedroCtx = await ensureUser(
    page.request,
    browser,
    'Pedro Productor',
    'pedro@chaneltv.test',
    'productor',
  );
  const rosa = await rosaCtx.newPage();
  const pedro = await pedroCtx.newPage();
  await Promise.all([rosa.goto(url), pedro.goto(url)]);
  for (const p of [rosa, pedro]) {
    await expect(p.locator('.rf-conn--online')).toBeVisible();
    // Rosa abre por defecto la vista de Realización; todos usan la completa en esta prueba.
    await p.getByLabel('Vista', { exact: true }).selectOption({ label: 'Completa' });
    await expect(val(p, 0, 'nombre')).toHaveText('PRESENTACION');
  }
  // Presencia: Ana ve a las otras dos personas
  await expect(page.locator('.rf-presence__avatar')).toHaveCount(3);

  // Ediciones simultáneas en celdas distintas
  await Promise.all([
    typeIn(page, 0, 'presenta', 'EDU'),
    typeIn(rosa, 0, 'fuente', 'CAM 1'),
    typeIn(pedro, 0, 'observaciones', 'Mapa de España'),
  ]);
  for (const p of [page, rosa, pedro]) {
    await expect(val(p, 0, 'presenta')).toHaveText('EDU');
    await expect(val(p, 0, 'fuente')).toHaveText('CAM 1');
    await expect(val(p, 0, 'observaciones')).toHaveText('Mapa de España');
  }

  // Pedro añade una línea con Ctrl+Intro
  await cell(pedro, 0, 'nombre').click();
  await pedro.keyboard.press('Control+Enter');
  await pedro.keyboard.type('VTR ANDALUCIA');
  await pedro.keyboard.press('Enter');
  for (const p of [page, rosa]) await expect(val(p, 1, 'nombre')).toHaveText('VTR ANDALUCIA');
  await expect(val(page, 1, 'num')).toContainText('4');

  // Pedro se queda sin red y sigue trabajando (edita y añade una línea)
  await pedroCtx.setOffline(true);
  await expect(pedro.locator('.rf-conn--offline')).toBeVisible({ timeout: 15_000 });
  await typeIn(pedro, 1, 'dur_vtr', '1:10');
  await cell(pedro, 1, 'nombre').click();
  await pedro.keyboard.press('Control+Enter');
  await pedro.keyboard.type('COLAS GOBIERNO (sin red)');
  await pedro.keyboard.press('Enter');
  await expect(pedro.locator('.rf-rgrid tbody tr')).toHaveCount(3);
  // Mientras tanto, Ana y Rosa editan la misma línea
  await typeIn(page, 1, 'pie', 'EN ANDALUCIA');
  await typeIn(rosa, 1, 'fuente', 'VTR 1');
  await expect(val(page, 1, 'fuente')).toHaveText('VTR 1');
  await expect(val(page, 1, 'dur_vtr')).toHaveText('');
  await expect(page.locator('.rf-rgrid tbody tr')).toHaveCount(2);
  await shot(pedro, 'm1-sin-red');

  // Vuelve la red: todo converge sin perder nada
  await pedroCtx.setOffline(false);
  for (const p of [page, rosa, pedro]) {
    await expect(p.locator('.rf-conn--online')).toBeVisible({ timeout: 15_000 });
    await expect(p.locator('.rf-rgrid tbody tr')).toHaveCount(3);
    await expect(val(p, 1, 'dur_vtr')).toHaveText('0:01:10');
    await expect(val(p, 1, 'pie')).toHaveText('EN ANDALUCIA');
    await expect(val(p, 1, 'fuente')).toHaveText('VTR 1');
    await expect(val(p, 2, 'nombre')).toHaveText('COLAS GOBIERNO (sin red)');
    await expect(val(p, 2, 'num')).toHaveText('6');
  }

  // Un realizador no puede añadir líneas (solo editar celdas)
  await cell(rosa, 0, 'observaciones').click();
  await rosa.keyboard.press('Control+Enter');
  await expect(rosa.locator('.rf-rgrid tbody tr')).toHaveCount(3);

  // Lo guardado persiste al recargar
  await page.reload();
  await expect(val(page, 2, 'nombre')).toHaveText('COLAS GOBIERNO (sin red)');
  await expect(page.getByText('3 líneas')).toBeVisible();
  await shot(page, 'm1-escaleta');

  await rosaCtx.close();
  await pedroCtx.close();
});

test('M1: copiar y pegar desde una hoja de cálculo, deshacer y vistas', async ({ page }) => {
  await page.goto('/entrar');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('link', { name: '04 Escaletas' }).click();
  await page.locator('.rf-rundowns-table tbody tr').first().click();
  await expect(page.locator('.rf-conn--online')).toBeVisible();
  await expect(page.locator('.rf-rgrid tbody tr')).toHaveCount(3);

  // Pegar dos filas (TIPO, NOMBRE) desde Google Sheets / Excel en la línea 3
  await cell(page, 2, 'tipo').click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'COLAS\tCOLAS GOBIERNO\nGRAFISMO\tMAPA ESTADISTICO\n');
    document
      .querySelector('.rf-rgrid-scroll')!
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await expect(page.locator('.rf-rgrid tbody tr')).toHaveCount(4);
  await expect(val(page, 2, 'tipo')).toHaveText('COLAS');
  await expect(val(page, 3, 'nombre')).toHaveText('MAPA ESTADISTICO');
  await expect(val(page, 3, 'tipo')).toHaveText('GRAFISMO');

  // Deshacer el pegado
  await page.keyboard.press('Control+z');
  await expect(page.locator('.rf-rgrid tbody tr')).toHaveCount(3);
  await expect(val(page, 2, 'nombre')).toHaveText('COLAS GOBIERNO (sin red)');
  await page.keyboard.press('Control+y');
  await expect(page.locator('.rf-rgrid tbody tr')).toHaveCount(4);

  // Mover una línea con Alt+↓
  await cell(page, 0, 'nombre').click();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(val(page, 1, 'nombre')).toHaveText('PRESENTACION');
  await page.keyboard.press('Alt+ArrowUp');
  await expect(val(page, 0, 'nombre')).toHaveText('PRESENTACION');

  // Vista de Realización y guardado de una vista personal
  await page.getByLabel('Vista', { exact: true }).selectOption({ label: 'Realización' });
  await expect(page.locator('.rf-rgrid th', { hasText: 'TELÉFONOS' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Columnas' }).click();
  await page
    .getByRole('dialog')
    .getByLabel(/TELÉFONOS/)
    .check();
  await page.getByRole('dialog').getByText('Cerrar', { exact: true }).click();
  await expect(page.locator('.rf-rgrid th', { hasText: 'TELÉFONOS' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Guardar vista' }).click();
  await page.getByRole('dialog').getByLabel('Nombre de la vista').fill('Realización con teléfonos');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar como nueva vista' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Vista', { exact: true })).toHaveValue(/[0-9a-f-]{36}/);
  await page.reload();
  await expect(page.locator('.rf-rgrid th', { hasText: 'TELÉFONOS' })).toHaveCount(1);
  await shot(page, 'm1-vista-realizacion');
});
