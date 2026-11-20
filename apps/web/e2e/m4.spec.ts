import { expect, test, type Page } from '@playwright/test';

/*
 * Criterio de aceptación de M4: el prompter fluye en TV y tablet, sincronizado
 * con el operador y con el GO; las salidas se abren por enlace sin usuario.
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

async function writePaso(page: Page, i: number, text: string) {
  await row(page, i).locator('td[data-col="nombre"]').click();
  const doc = page.getByRole('complementary', { name: 'Panel' }).locator('.rf-script__doc');
  await doc.click();
  await page.keyboard.type(text);
  await expect(doc.locator('p.rf-script-paso').first()).toHaveText(text);
}

async function createOutput(page: Page, kind: string, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Salidas' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tipo').selectOption({ label: kind });
  await dialog.getByLabel('Nombre', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Crear salida' }).click();
  const url = await dialog.getByLabel('Enlace de la salida').inputValue();
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  return url;
}

/** ¿Está el bloque de esa línea en el marcador de lectura de la salida? */
async function blockAtMarker(out: Page, text: string) {
  return out.evaluate((t) => {
    const scroll = document.querySelector<HTMLElement>('[data-testid="prompter-scroll"]')!;
    const marker = scroll.getBoundingClientRect().top + scroll.clientHeight * 0.33;
    const block = [...document.querySelectorAll<HTMLElement>('[data-prompter-line]')].find((b) =>
      b.textContent?.includes(t),
    );
    if (!block) return false;
    const r = block.getBoundingClientRect();
    return r.top <= marker + 4 && r.bottom > marker - 4;
  }, text);
}

test('M4: teleprompter y salidas por enlace', async ({ page, browser, request }) => {
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
    data: { name: `Prompter ${Date.now()}`, type: 'informativo' },
  });
  const created = await request.post('/api/rundowns', {
    headers: H,
    data: {
      programId: (await program.json()).program.id,
      airDate: '2026-11-20',
      startTime: '20:00',
      endTime: '21:00',
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

  // Tres líneas con paso
  await page.getByRole('button', { name: 'Añadir la primera línea' }).click();
  await row(page, 0).locator('td[data-col="tipo"]').click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'ACTING\tPRESENTACION\nTEMA\tGOBIERNO\nACTING\tDESPEDIDA\n');
    document
      .querySelector('.rf-rgrid-scroll')!
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await expect(page.locator('.rf-rgrid tbody tr')).toHaveCount(3);
  await writePaso(page, 0, 'Buenas tardes y bienvenidos al informativo de mediodía.');
  await writePaso(page, 1, 'El Gobierno aprueba hoy los presupuestos del próximo año.');
  await writePaso(page, 2, 'Esto ha sido todo. Gracias por su compañía.');

  // Salidas: prompter y mensajes
  const prompterUrl = await createOutput(page, 'Teleprompter', 'Prompter cámara 1');
  const messagesUrl = await createOutput(page, 'Mensajes', 'Pantalla plató');
  expect(prompterUrl).toMatch(/\/salida\/[A-Za-z0-9_-]{32}$/);

  // Se abren sin usuario (otro navegador)
  const screen = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const out = await screen.newPage();
  await out.goto(prompterUrl);
  await expect(
    out.getByText('Buenas tardes y bienvenidos al informativo de mediodía.'),
  ).toBeVisible();
  await expect(
    out.getByText('El Gobierno aprueba hoy los presupuestos del próximo año.'),
  ).toBeVisible();
  const msgPage = await screen.newPage();
  await msgPage.goto(messagesUrl);
  await expect(msgPage.getByText('Sin mensajes')).toBeVisible();

  // Espejo desde el control: llega al instante
  await page.getByRole('button', { name: 'Salidas' }).click();
  await page.getByRole('dialog').getByRole('checkbox', { name: 'Espejo' }).check();
  await expect(out.locator('.rf-prompter__content')).toHaveClass(/is-mirror/);
  await page.getByRole('dialog').getByRole('checkbox', { name: 'Espejo' }).uncheck();
  await expect(out.locator('.rf-prompter__content')).not.toHaveClass(/is-mirror/);
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();

  // Mensaje al plató
  await page.getByRole('button', { name: /^Mensaje/ }).click();
  await page.getByRole('dialog').getByLabel('Mensaje').fill('UN MINUTO');
  await page.getByRole('dialog').getByRole('button', { name: 'Enviar' }).click();
  await expect(msgPage.getByTestId('out-message')).toHaveText('UN MINUTO');
  await shot(msgPage, 'm4-mensaje');

  // Operador del prompter: avanza una línea (AvPág) y la salida le sigue
  const operator = await page.context().newPage();
  await operator.goto(`/escaletas/${rundownId}/prompter`);
  await expect(operator.locator('.rf-conn--online')).toBeVisible();
  await expect(operator.getByText('El Gobierno aprueba hoy')).toBeVisible();
  await operator.locator('.rf-prompter-op__screen').click();
  await operator.keyboard.press('PageDown');
  await expect
    .poll(() => blockAtMarker(out, 'El Gobierno aprueba hoy'), { timeout: 8000 })
    .toBe(true);
  await shot(operator, 'm4-operador');
  await shot(out, 'm4-prompter');

  // Seguir el GO: al poner en aire la despedida, el prompter salta a ella
  await page.getByRole('button', { name: 'GO', exact: true }).click(); // PRESENTACION
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'GO', exact: true }).click(); // GOBIERNO
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'GO', exact: true }).click(); // DESPEDIDA
  await expect.poll(() => blockAtMarker(out, 'Esto ha sido todo'), { timeout: 8000 }).toBe(true);
  await expect(out.locator('.rf-prompter__onair')).toBeVisible();

  // Revocar: la salida deja de funcionar
  await page.getByRole('button', { name: 'Salidas' }).click();
  const item = page
    .getByRole('dialog')
    .getByRole('listitem')
    .filter({ hasText: 'Prompter cámara 1' });
  await item.getByRole('button', { name: 'Revocar' }).click();
  await expect(out.getByText('Esta salida se ha revocado.')).toBeVisible();
  await screen.close();
});
