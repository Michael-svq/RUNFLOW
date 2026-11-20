import { expect, test, type Browser, type Page } from '@playwright/test';

/*
 * Criterio de aceptación de M3: el guion separa paso (verde) y off (negro), los
 * rótulos son bloques estructurados con longitudes y TC, y no se puede guardar
 * un rótulo inválido sin aviso. Colaborativo entre dos personas.
 */

const shots = process.env.SCREENSHOT_DIR;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}

const H = { 'x-runflow-request': '1' };
const ADMIN = { email: 'ana@chaneltv.test', password: 'contraseña-segura-1' };

function row(page: Page, i: number) {
  return page.locator('.rf-rgrid tbody tr').nth(i);
}
function val(page: Page, i: number, col: string) {
  return row(page, i).locator(`td[data-col="${col}"] .rf-cell__text`);
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/entrar');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Hola/ })).toBeVisible();
}

async function redactor(browser: Browser, admin: Page) {
  const roles = (await (await admin.request.get('/api/roles')).json()).roles as {
    id: string;
    key: string;
  }[];
  const email = `redactor-${Date.now()}@chaneltv.test`;
  await admin.request.post('/api/users', {
    headers: H,
    data: {
      name: 'Rafa Redactor',
      email,
      roleId: roles.find((r) => r.key === 'redactor')!.id,
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

test('M3: guion con paso, off y rótulos, en colaboración', async ({ page, browser, request }) => {
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
    data: { name: `Guiones ${Date.now()}`, type: 'informativo' },
  });
  const created = await request.post('/api/rundowns', {
    headers: H,
    data: {
      programId: (await program.json()).program.id,
      airDate: '2026-11-20',
      startTime: '21:00',
      endTime: '21:30',
    },
  });
  const rundownId = (await created.json()).rundown.id;

  await login(page, ADMIN.email, ADMIN.password);
  await page.goto(`/escaletas/${rundownId}`);
  await expect(page.locator('.rf-conn--online')).toBeVisible();
  await page.getByLabel('Vista', { exact: true }).selectOption({ label: 'Completa' });
  await page.getByRole('button', { name: 'Añadir la primera línea' }).click();

  // Línea VTR de 1:10
  await row(page, 0).locator('td[data-col="nombre"]').click();
  await page.keyboard.type('GOBIERNO');
  await page.keyboard.press('Enter');
  await row(page, 0).locator('td[data-col="tipo"]').dblclick();
  await row(page, 0).locator('td[data-col="tipo"] select').selectOption('VTR');
  await row(page, 0).locator('td[data-col="dur_vtr"]').click();
  await page.keyboard.type('1:10');
  await page.keyboard.press('Enter');
  await row(page, 0).locator('td[data-col="nombre"]').click();

  // Guion: paso (verde) y off (negro)
  const panel = page.getByRole('complementary', { name: 'Panel' });
  await expect(panel.locator('.rf-script__name')).toHaveText('GOBIERNO');
  const docEl = panel.locator('.rf-script__doc');
  await docEl.click();
  await page.keyboard.type('Buenas tardes. El Gobierno aprueba hoy los presupuestos.');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+2');
  await page.keyboard.type('El Consejo de Ministros se ha reunido esta mañana.');
  await expect(docEl.locator('p.rf-script-paso')).toHaveText(
    'Buenas tardes. El Gobierno aprueba hoy los presupuestos.',
  );
  await expect(docEl.locator('p.rf-script-off')).toHaveText(
    'El Consejo de Ministros se ha reunido esta mañana.',
  );
  await expect(panel.getByTestId('reading-time')).toHaveText('0:00:03');

  // Rótulo TOT con TC sobre la pieza
  await panel.getByLabel('Añadir rótulo').selectOption('TOT');
  const rotulo = panel.locator('.rf-rotulo').first();
  await rotulo.getByLabel('NOMBRE').fill('ANA PÉREZ');
  await rotulo.getByLabel('CARGO').fill('MINISTRA DE HACIENDA');
  await rotulo.getByLabel('TC entrada').fill('00:12');
  await rotulo.getByLabel('TC salida').fill('00:18');
  await expect(rotulo).not.toHaveClass(/has-issues/);
  // (con permiso de lanzar rótulos, la celda muestra cada rótulo con su ▶)
  await expect(row(page, 0).locator('td[data-col="grafismo"] .rf-cg-item__text')).toHaveText(
    'TOT 00:12 ANA PÉREZ // MINISTRA DE HACIENDA',
  );

  // Longitud máxima: no deja escribir más de 40 caracteres en NOMBRE
  await rotulo.getByLabel('NOMBRE').fill('X'.repeat(60));
  await expect(rotulo.getByLabel('NOMBRE')).toHaveValue('X'.repeat(40));
  await rotulo.getByLabel('NOMBRE').fill('ANA PÉREZ');

  // TC fuera de la pieza: aviso
  await rotulo.getByLabel('TC salida').fill('01:20');
  await expect(rotulo).toHaveClass(/has-issues/);
  await expect(rotulo.getByText('El TC de salida supera la duración de la pieza')).toBeVisible();
  await rotulo.getByLabel('TC salida').fill('00:18');
  await expect(rotulo).not.toHaveClass(/has-issues/);

  // Guardar en personas y autocompletar en otro rótulo
  await rotulo.getByRole('button', { name: '+ Guardar en personas y cargos' }).click();
  // (en un reintento la persona ya estaba guardada)
  await expect(rotulo.getByText(/(Guardado|Ya está) en personas y cargos\./)).toBeVisible();
  await panel.getByLabel('Añadir rótulo').selectOption('TOT');
  const second = panel.locator('.rf-rotulo').nth(1);
  await second.getByLabel('NOMBRE').fill('ana p');
  await second.getByRole('option', { name: /ANA PÉREZ/ }).click();
  await expect(second.getByLabel('CARGO')).toHaveValue('MINISTRA DE HACIENDA');
  await second.getByRole('button', { name: 'Quitar rótulo' }).click();
  await expect(panel.locator('.rf-rotulo')).toHaveCount(1);

  // Tiempo de lectura como tiempo estimado
  await panel.getByRole('button', { name: 'Usar como tiempo estimado' }).click();
  await expect(val(page, 0, 't_est')).toHaveText('0:00:03');
  await shot(page, 'm3-guion');

  // Otra persona (redactor) ve y edita el mismo guion
  const rafaCtx = await redactor(browser, page);
  const rafa = await rafaCtx.newPage();
  await rafa.goto(`/escaletas/${rundownId}`);
  await expect(rafa.locator('.rf-conn--online')).toBeVisible();
  await row(rafa, 0).locator('td[data-col="nombre"]').click();
  const rafaDoc = rafa.getByRole('complementary', { name: 'Panel' }).locator('.rf-script__doc');
  await expect(rafaDoc.locator('p.rf-script-paso')).toHaveText(
    'Buenas tardes. El Gobierno aprueba hoy los presupuestos.',
  );
  await expect(rafaDoc.locator('.rf-rotulo')).toHaveCount(1);
  await rafaDoc.locator('p.rf-script-off').first().click();
  await rafa.keyboard.press('End');
  await rafa.keyboard.type(' Fin.');
  // (incluye la etiqueta del cursor de Rafa: colaboración en vivo)
  await expect(docEl.locator('p.rf-script-off').first()).toContainText(
    'El Consejo de Ministros se ha reunido esta mañana. Fin.',
  );
  await expect(docEl.locator('.collaboration-cursor__label')).toHaveText('Rafa Redactor');
  await rafaCtx.close();
});
