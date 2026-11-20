import { expect, test, type Page } from '@playwright/test';

/*
 * Criterio de aceptación de M2: un directo simulado cuadra los tiempos, avanza
 * con GO y solo en los VTR (modo híbrido), y el registro de emisión es correcto.
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

test('M2: directo simulado con GO, autonext del VTR y registro de emisión', async ({
  page,
  request,
}) => {
  // Instalación y escaleta nuevas por API
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
    data: { name: `Directo ${Date.now()}`, type: 'informativo' },
  });
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const created = await request.post('/api/rundowns', {
    headers: H,
    data: {
      programId: (await program.json()).program.id,
      airDate: today,
      startTime: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
      endTime: `${pad((now.getHours() + 1) % 24)}:${pad(now.getMinutes())}`,
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

  // Líneas pegadas desde una hoja: TIEMPO ESTIMADO, TIPO, NOMBRE
  await page.getByRole('button', { name: 'Añadir la primera línea' }).click();
  await row(page, 0).locator('td[data-col="t_est"]').click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData(
      'text/plain',
      [
        '0:30\tACTING\tPRESENTACION',
        '0:02\tVTR\tVTR CORTO',
        '1:00\tTEMA\tTEMA GOBIERNO',
        '0:40\tVARIOS\tRESERVA',
      ].join('\n'),
    );
    document
      .querySelector('.rf-rgrid-scroll')!
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await expect(page.locator('.rf-rgrid tbody tr')).toHaveCount(4);
  await expect(page.getByText('Estimado 0:02:12 de 1:00:00')).toBeVisible();

  // La reserva, flotante: no cuenta en los tiempos
  await row(page, 3).locator('td[data-col="nombre"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Marcar como flotante' }).click();
  await expect(row(page, 3)).toHaveClass(/is-floating/);
  await expect(page.getByText('Estimado 0:01:32 de 1:00:00')).toBeVisible();
  await expect(page.getByTestId('next-line')).toHaveText('2 · PRESENTACION');

  // Modo híbrido (por defecto). GO: arranca el programa
  await page.getByRole('button', { name: 'GO', exact: true }).click();
  await expect(row(page, 0)).toHaveClass(/is-onAir/);
  await expect(page.getByTestId('clock-line')).toContainText('EN AIRE · 2 PRESENTACION');
  await expect(page.getByTestId('next-line')).toHaveText('4 · VTR CORTO');
  await expect(row(page, 1)).toHaveClass(/is-next/);
  await shot(page, 'm2-directo');

  // GO al VTR: dura 2 s y pasa solo al TEMA (autonext)
  await page.waitForTimeout(800); // protección contra doble pulsación
  await page.getByRole('button', { name: 'GO', exact: true }).click();
  await expect(row(page, 1)).toHaveClass(/is-onAir/);
  await expect(val(page, 0, 'estado')).toHaveText('E');
  await expect(row(page, 2)).toHaveClass(/is-onAir/, { timeout: 6000 });
  await expect(page.getByTestId('next-line')).toHaveText('—');

  // Espacio = GO
  await page.getByLabel('Espacio = GO').check();
  await page.locator('.rf-rundown__title h1').click();
  await page.waitForTimeout(800);
  await page.keyboard.press('Space');
  await expect(page.locator('.rf-rgrid tbody tr.is-onAir')).toHaveCount(0);
  await expect(page.locator('.rf-livebar__label')).toHaveText('TERMINADO');

  // Registro de emisión
  await page.getByRole('button', { name: 'Registro de emisión' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('row')).toHaveCount(4); // cabecera + 3
  await expect(dialog.getByRole('row').nth(3)).toContainText('Automático');
  await shot(page, 'm2-registro');
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();

  // Columnas calculadas en la vista de Realización
  await page.getByLabel('Vista', { exact: true }).selectOption({ label: 'Realización' });
  await expect(val(page, 0, 'hora')).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
  await expect(val(page, 0, 'real')).toHaveText(/^0:00:0\d$/);
  await shot(page, 'm2-realizacion');
});
