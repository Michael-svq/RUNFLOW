import { expect, test, type Page } from '@playwright/test';

/* Dirección TV → Reproductor de vídeos: lista de vídeos de la escaleta, pasar y ordenar. */

const H = { 'x-runflow-request': '1' };
const ADMIN = { email: 'ana@chaneltv.test', password: 'contraseña-segura-1' };
const shots = process.env.SCREENSHOT_DIR;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}
const clipRows = (page: Page) => page.locator('.rf-player__table tbody tr');

test('Reproductor: vídeos de la escaleta en orden, siguiente y mover', async ({
  page,
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
  const program = await request.post('/api/programs', {
    headers: H,
    data: { name: `Vídeos ${Date.now()}`, type: 'informativo' },
  });
  const rundownId = (
    await (
      await request.post('/api/rundowns', {
        headers: H,
        data: {
          programId: (await program.json()).program.id,
          airDate: '2026-11-25',
          startTime: '22:00',
          endTime: '22:30',
        },
      })
    ).json()
  ).rundown.id as string;
  const { token } = await (
    await request.post('/api/api-tokens', {
      headers: H,
      data: { name: `Prueba vídeos ${Date.now()}`, scopes: ['write'] },
    })
  ).json();
  for (const cells of [
    { tipo: 'ACTING', nombre: 'PRESENTACION' },
    { tipo: 'VTR', nombre: 'PIEZA A', clip: 'PIEZA_A', dur_vtr: 20 },
    { tipo: 'VTR', nombre: 'PIEZA B', clip: 'PIEZA_B', dur_vtr: 35 },
    { tipo: 'ACTING', nombre: 'DESPEDIDA' },
  ]) {
    const res = await request.post(`/api/v1/rundowns/${rundownId}/lines`, {
      headers: { authorization: `Bearer ${token}` },
      data: { cells },
    });
    expect(res.status()).toBe(201);
  }

  await page.goto('/entrar');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Hola/ })).toBeVisible();

  await page.goto('/reproductor');
  await expect(page.getByRole('heading', { name: 'Reproductor de vídeos' })).toBeVisible();
  await page.getByLabel('Escaleta', { exact: true }).selectOption(rundownId);
  await expect(clipRows(page)).toHaveCount(2);
  await expect(clipRows(page).nth(0)).toContainText('PIEZA_A');
  await expect(clipRows(page).nth(1)).toContainText('PIEZA_B');
  await expect(clipRows(page).nth(1)).toContainText('0:35');
  await expect(page.getByTestId('player-clip')).toHaveText('PIEZA_A');

  // Pasar al siguiente vídeo.
  await page.getByRole('button', { name: 'Siguiente ▶▶' }).click();
  await expect(page.getByTestId('player-clip')).toHaveText('PIEZA_B');
  await expect(page.getByText('Sin vista previa')).toBeVisible();
  await shot(page, 'm23-reproductor');

  // Bajar el primero: también cambia el orden de la escaleta.
  await page.getByRole('button', { name: 'Bajar el vídeo 1' }).click();
  await expect(clipRows(page).nth(0)).toContainText('PIEZA_B');
  await expect(clipRows(page).nth(1)).toContainText('PIEZA_A');

  await page.goto(`/escaletas/${rundownId}`);
  const names = page.locator('.rf-rgrid tbody tr td[data-col="nombre"] .rf-cell__text');
  await expect(names).toHaveText(['PRESENTACION', 'PIEZA B', 'PIEZA A', 'DESPEDIDA']);
});
