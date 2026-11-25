import { expect, test, type Page } from '@playwright/test';
import { CasparSimulator } from '../../server/src/cg/simulator';

/*
 * M7 RunFlow CG en el navegador, con un CasparCG simulado: configurar el
 * equipo y el diseño, ver la columna PLAY, lanzar el VTR con GO y los
 * rótulos con ▶/■ desde la escaleta.
 */

const shots = process.env.SCREENSHOT_DIR;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}
const H = { 'x-runflow-request': '1' };
const ADMIN = { email: 'ana@chaneltv.test', password: 'contraseña-segura-1' };

function row(page: Page, i: number) {
  return page.locator('.rf-rgrid tbody tr').nth(i);
}

const rotulo = (id: string, type: string, f0: string, f1 = '', tcIn = '', tcOut = '') => ({
  kind: 'rotulo',
  id,
  type,
  f0,
  f1,
  f2: '',
  f3: '',
  tcIn,
  tcOut,
});

test('M7: CasparCG, diseño de rótulos, PLAY, GO con VTR y ▶/■', async ({ page, request }) => {
  const sim = new CasparSimulator({ clips: [{ name: 'PIEZA_GOBIERNO', duration: 70 }] });
  const port = await sim.start();
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
    // Equipos de pruebas anteriores fuera.
    for (const d of (await (await request.get('/api/devices')).json()).devices as { id: string }[])
      await request.delete(`/api/devices/${d.id}`, { headers: H });
    const program = await request.post('/api/programs', {
      headers: H,
      data: { name: `Informativo CG ${Date.now()}`, type: 'informativo' },
    });
    const rundownId = (
      await (
        await request.post('/api/rundowns', {
          headers: H,
          data: {
            programId: (await program.json()).program.id,
            airDate: '2026-11-20',
            startTime: '14:00',
            endTime: '15:00',
          },
        })
      ).json()
    ).rundown.id;

    await page.goto('/entrar');
    await page.getByLabel('Email').fill(ADMIN.email);
    await page.getByLabel('Contraseña').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('heading', { name: /Hola/ })).toBeVisible();

    // 1. Configuración: diseño con vista previa real y equipo CasparCG
    await page.goto('/diseno');
    await expect(page.getByRole('heading', { name: 'Diseño' })).toBeVisible();
    const preview = page.frameLocator('iframe[title="Vista previa del rótulo TOT"]');
    await expect(preview.getByText('MARÍA JESÚS MONTERO')).toBeVisible();
    await page.getByRole('tab', { name: 'BAN' }).click();
    await expect(
      page
        .frameLocator('iframe[title="Vista previa del rótulo BAN"]')
        .getByText('EL GOBIERNO APRUEBA LOS PRESUPUESTOS'),
    ).toBeVisible();
    await page.getByLabel('Mosca (texto junto a la fecha)').fill('CHANEL TV');
    await page.getByRole('button', { name: 'Guardar diseño' }).click();
    await expect(page.getByText('Guardado.')).toBeVisible();
    await shot(page, 'm7-configuracion');

    await page.goto('/station');
    await page.getByRole('tab', { name: 'Equipos' }).click();
    await page.getByRole('button', { name: 'Añadir equipo' }).click();
    const form = page.getByRole('form', { name: 'Equipo CasparCG' });
    await form.getByLabel('Nombre', { exact: true }).fill('CasparCG plató');
    await form.getByLabel('Puerto AMCP').fill(String(port));
    await form.getByLabel('Puerto OSC (0 = sin OSC)').fill('0');
    await form.getByRole('button', { name: 'Probar conexión' }).click();
    await expect(page.getByText(/Conectado: 2\.3/)).toBeVisible();
    await form.getByRole('button', { name: 'Guardar equipo' }).click();
    await expect(
      page.locator('li', { hasText: 'CasparCG plató' }).getByText('Conectado'),
    ).toBeVisible();

    // 2. Escaleta con cámara + VTR (con su clip y dos rótulos por TC), importada
    await page.goto(`/escaletas/${rundownId}`);
    await expect(page.locator('.rf-conn--online')).toBeVisible();
    await page.getByLabel('Vista', { exact: true }).selectOption({ label: 'Completa' });
    await page.locator('summary', { hasText: 'Escaleta ▾' }).click();
    await page.getByRole('menuitem', { name: 'Importar/Exportar' }).click();
    const io = page.getByRole('dialog');
    const backup = {
      format: 'runflow-escaleta',
      version: 1,
      title: 'CG',
      lines: [
        {
          cells: { tipo: 'ACTING', nombre: 'PRESENTACION', t_est: 30 },
          script: [
            { kind: 'paso', text: 'Buenas tardes.' },
            rotulo('r-cam', 'TOT', 'Ana Pérez', 'Presentadora'),
          ],
        },
        {
          cells: { tipo: 'VTR', nombre: 'PRESUPUESTOS', dur_vtr: 70, clip: 'PIEZA_GOBIERNO' },
          script: [
            rotulo('r-tot', 'TOT', 'María Jesús Montero', 'Ministra de Hacienda', '00:05', '00:10'),
            rotulo('r-loc', 'LOC', 'Madrid', '', '00:12'),
          ],
        },
        { cells: { tipo: 'VTR', nombre: 'SIN PIEZA', dur_vtr: 20, clip: 'NO_EXISTE' }, script: [] },
      ],
    };
    await io.getByLabel('Archivo para importar').setInputFiles({
      name: 'cg.runflow.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    await io.getByRole('button', { name: 'Importar 3 líneas' }).click();
    await io.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect(page.locator('.rf-rgrid tbody tr')).toHaveCount(3);

    // PLAY: preparado con su duración; el clip que no está en CasparCG, aviso
    await expect(row(page, 1).locator('td[data-col="play"]')).toContainText('◼ 1:10');
    await expect(row(page, 2).locator('td[data-col="play"]')).toContainText('⚠ falta');

    // 3. Armar equipos, modo manual y GO a cámara: el VTR siguiente se precarga
    // (casilla controlada por el estado del servidor)
    await page.getByLabel('Armar equipos').click();
    await expect(page.getByLabel('Armar equipos')).toBeChecked();
    await page.getByRole('combobox', { name: 'Modo', exact: true }).selectOption('manual');
    await page.getByRole('button', { name: 'GO', exact: true }).click();
    await expect(row(page, 0)).toHaveClass(/is-onAir/);
    await expect.poll(() => sim.sent('LOADBG 1-10').length).toBe(1);
    await expect(row(page, 1).locator('.rf-play.is-preloaded')).toBeVisible();

    // ▶ del rótulo de cámara: entra (celda roja, botón ■)
    await row(page, 0)
      .getByRole('button', { name: /Lanzar rótulo TOT Ana Pérez/ })
      .click();
    await expect(row(page, 0).locator('.rf-cg-item.is-onair')).toBeVisible();
    expect(sim.sent('CG 1-20 ADD')).toHaveLength(1);
    await expect(page.locator('.rf-cgbar')).toContainText('CasparCG plató');
    await shot(page, 'm7-rotulo-en-aire');
    await row(page, 0)
      .getByRole('button', { name: /Sacar rótulo/ })
      .click();
    await expect(row(page, 0).locator('.rf-cg-item.is-done')).toBeVisible();
    expect(sim.sent('CG 1-20 STOP')).toHaveLength(1);

    // 4. GO al VTR: arranca en CasparCG y la columna PLAY cuenta hacia atrás
    await page.getByRole('button', { name: 'GO', exact: true }).click();
    await expect.poll(() => sim.sent('PLAY 1-10').length).toBe(1);
    await expect(row(page, 1).locator('.rf-play.is-playing')).toContainText('►');
    await page.getByRole('button', { name: 'Pausa' }).click();
    await expect(row(page, 1).locator('.rf-play.is-paused')).toBeVisible();
    expect(sim.sent('PAUSE 1-10')).toHaveLength(1);
    await page.getByRole('button', { name: 'Continuar' }).click();
    await shot(page, 'm7-vtr');
  } finally {
    await sim.stop();
  }
});
