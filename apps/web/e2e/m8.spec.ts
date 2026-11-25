import { expect, test, type Page } from '@playwright/test';
import { VmixSimulator } from '../../server/src/mixers/vmix';

/*
 * M8 en el navegador: configurar vMix con su mapa de fuentes, GO que corta a
 * la FUENTE de cada línea y mando por enlace en una tablet.
 */

const shots = process.env.SCREENSHOT_DIR;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}
const H = { 'x-runflow-request': '1' };
const ADMIN = { email: 'ana@chaneltv.test', password: 'contraseña-segura-1' };
const row = (page: Page, i: number) => page.locator('.rf-rgrid tbody tr').nth(i);

test('M8: vMix con mapa de fuentes, corte con GO y mando por enlace', async ({
  page,
  request,
  browser,
}) => {
  const vmix = new VmixSimulator();
  const port = await vmix.start();
  try {
    const status = await (await request.get('/api/setup/status')).json();
    if (status.needsSetup) {
      await request.post('/api/setup', {
        headers: H,
        data: { orgName: 'Chanel TV', name: 'Ana Admin', ...ADMIN },
      });
    } else {
      await request.post('/api/auth/login', { headers: H, data: ADMIN });
    }
    for (const d of (await (await request.get('/api/devices')).json()).devices as { id: string }[])
      await request.delete(`/api/devices/${d.id}`, { headers: H });
    const program = await request.post('/api/programs', {
      headers: H,
      data: { name: `Magacín mezclador ${Date.now()}`, type: 'magacin' },
    });
    const rundownId = (
      await (
        await request.post('/api/rundowns', {
          headers: H,
          data: {
            programId: (await program.json()).program.id,
            airDate: '2026-11-20',
            startTime: '18:00',
            endTime: '19:00',
          },
        })
      ).json()
    ).rundown.id;

    await page.goto('/entrar');
    await page.getByLabel('Email').fill(ADMIN.email);
    await page.getByLabel('Contraseña').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('heading', { name: /Hola/ })).toBeVisible();

    // 1. vMix en Configuración con su mapa de fuentes
    await page.goto('/station');
    await page.getByRole('tab', { name: 'Equipos' }).click();
    await page.getByLabel('Tipo de equipo').selectOption({ label: 'vMix' });
    await page.getByRole('button', { name: 'Añadir equipo' }).click();
    const form = page.getByRole('form', { name: 'Equipo vMix' });
    await form.getByLabel('Puerto de la API TCP').fill(String(port));
    await form.getByLabel('Entrada para CAM 1').fill('1');
    await form.getByLabel('Entrada para CAM 2').fill('3');
    await form.getByLabel('Entrada para VTR').fill('2');
    await form.getByRole('button', { name: 'Quitar CAM 3' }).click();
    await form.getByRole('button', { name: 'Probar conexión' }).click();
    await expect(page.getByText(/Conectado: vMix 27/)).toBeVisible();
    await shot(page, 'm8-vmix');
    await form.getByRole('button', { name: 'Guardar equipo' }).click();
    await expect(page.locator('li', { hasText: 'vMix' }).getByText('Conectado')).toBeVisible();

    // 2. Escaleta: CAM 1 → VTR → CAM 2
    await page.goto(`/escaletas/${rundownId}`);
    await expect(page.locator('.rf-conn--online')).toBeVisible();
    await page.getByLabel('Vista', { exact: true }).selectOption({ label: 'Realización' });
    await page.getByRole('button', { name: 'Añadir la primera línea' }).click();
    await row(page, 0).locator('td[data-col="t_est"]').click();
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData(
        'text/plain',
        ['0:30\tACTING\tPRESENTACION', '1:00\tVTR\tPIEZA', '2:00\tTEMA\tENTREVISTA'].join('\n'),
      );
      document
        .querySelector('.rf-rgrid-scroll')!
        .dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
    });
    await expect(page.locator('.rf-rgrid tbody tr')).toHaveCount(3);
    for (const [i, source] of [
      [0, 'CAM 1'],
      [2, 'cam 2'],
    ] as const) {
      await row(page, i).locator('td[data-col="fuente"]').click();
      await page.keyboard.type(source);
      await page.keyboard.press('Enter');
    }

    await page.getByLabel('Armar equipos').click();
    await expect(page.getByLabel('Armar equipos')).toBeChecked();
    await page.getByRole('combobox', { name: 'Modo', exact: true }).selectOption('manual');
    await page.getByRole('button', { name: 'GO', exact: true }).click();
    await expect.poll(() => vmix.program).toBe('1');
    await expect(page.locator('.rf-cgbar__program')).toContainText('PGM CAM 1');
    await page.getByRole('button', { name: 'GO', exact: true }).click();
    await expect.poll(() => vmix.program).toBe('2');
    await expect(page.locator('.rf-cgbar__program')).toContainText('PGM VTR');
    await shot(page, 'm8-directo');

    // F2.3: emisión en streaming desde la barra de equipos
    const bar = page.locator('.rf-cgbar');
    await bar.getByRole('button', { name: 'Emitir' }).click();
    await expect(bar.getByText('EN EMISIÓN')).toBeVisible();
    expect(vmix.streaming).toBe(true);
    await bar.getByRole('button', { name: 'Cortar emisión' }).click();
    await bar.getByRole('button', { name: 'Confirmar corte' }).click();
    await expect(bar.getByText('EN EMISIÓN')).toHaveCount(0);
    expect(vmix.streaming).toBe(false);

    // 3. Mando por enlace en una tablet
    await page.getByRole('button', { name: 'Salidas' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Tipo').selectOption({ label: 'Mando' });
    await dialog.getByRole('button', { name: 'Crear salida' }).click();
    const url = await dialog.getByLabel('Enlace de la salida').inputValue();
    await expect(dialog.getByText(/\/api\/public\/control\/.+\/go$/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Cerrar ventana' }).click();

    const tablet = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    await tablet.goto(url);
    await expect(tablet.locator('.rf-control__now')).toContainText('PIEZA');
    await expect(tablet.locator('.rf-control__next')).toContainText('ENTREVISTA');
    await shot(tablet, 'm8-mando');
    // (protección contra doble pulsación: 700 ms entre dos GO)
    await tablet.waitForTimeout(800);
    await tablet.getByRole('button', { name: 'GO', exact: true }).click();
    await expect.poll(() => vmix.program).toBe('3');
    await expect(row(page, 2)).toHaveClass(/is-onAir/);
    await expect(tablet.locator('.rf-control__now')).toContainText('ENTREVISTA');
    await tablet.getByRole('button', { name: '◀ Volver' }).click();
    await expect(row(page, 1)).toHaveClass(/is-onAir/);
    await tablet.close();
  } finally {
    await vmix.stop();
  }
});
