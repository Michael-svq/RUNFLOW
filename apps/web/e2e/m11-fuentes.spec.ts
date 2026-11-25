import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';

/* F2.2 Fuentes: alta de un RSS, noticia a la nevera e inserción en la escaleta. */

const H = { 'x-runflow-request': '1' };
const ADMIN = { email: 'ana@chaneltv.test', password: 'contraseña-segura-1' };
const row = (page: Page, i: number) => page.locator('.rf-rgrid tbody tr').nth(i);
const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Agencia</title>
<item><title>El Gobierno aprueba los presupuestos</title><guid>p-1</guid>
<link>https://agencia.test/1</link><pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate>
<description>El Consejo de Ministros ha aprobado hoy las cuentas.</description></item>
<item><title>Lluvias en Sevilla</title><guid>p-2</guid><pubDate>Fri, 20 Nov 2026 09:00:00 GMT</pubDate></item>
</channel></rss>`;

test('F2.2: fuentes RSS a la nevera y a la escaleta', async ({ page, request }) => {
  const feed = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/rss+xml');
    res.end(RSS);
  });
  await new Promise<void>((r) => feed.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(feed.address() as AddressInfo).port}/rss`;
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
    const program = await request.post('/api/programs', {
      headers: H,
      data: { name: `Fuentes ${Date.now()}`, type: 'informativo' },
    });
    const rundownId = (
      await (
        await request.post('/api/rundowns', {
          headers: H,
          data: {
            programId: (await program.json()).program.id,
            airDate: '2026-11-20',
            startTime: '14:00',
            endTime: '14:30',
          },
        })
      ).json()
    ).rundown.id;

    await page.goto('/entrar');
    await page.getByLabel('Email').fill(ADMIN.email);
    await page.getByLabel('Contraseña').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('heading', { name: /Hola/ })).toBeVisible();

    await page.goto('/fuentes');
    const add = page.getByRole('form', { name: 'Nueva fuente' });
    await add.getByLabel('Nombre').fill(`Agencia ${Date.now()}`);
    await add.getByLabel('Dirección del RSS o Atom').fill(url);
    await add.getByRole('button', { name: 'Añadir fuente' }).click();
    await expect(page.getByText(/: 2 noticias\./)).toBeVisible();
    const item = page
      .locator('.rf-sources__item', { hasText: 'El Gobierno aprueba los presupuestos' })
      .first();
    await expect(item).toContainText('El Consejo de Ministros');
    await item.getByRole('button', { name: 'A la nevera' }).click();
    await expect(page.getByText(/está en la nevera/)).toBeVisible();

    await page.goto(`/escaletas/${rundownId}`);
    await expect(page.locator('.rf-conn--online')).toBeVisible();
    await page.getByRole('button', { name: 'Añadir la primera línea' }).click();
    await row(page, 0).locator('td[data-col="nombre"]').click();
    await page.keyboard.type('CABECERA');
    await page.keyboard.press('Enter');
    await row(page, 0).locator('td[data-col="nombre"]').click();
    const panel = page.getByRole('complementary', { name: 'Panel' });
    if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Panel' }).click();
    await panel.getByRole('tab', { name: 'Fuentes' }).click();
    await panel.getByLabel('Buscar en las fuentes').fill('sevilla');
    await panel
      .locator('li', { hasText: 'Lluvias en Sevilla' })
      .first()
      .getByRole('button', { name: 'Insertar' })
      .click();
    await expect(row(page, 1).locator('td[data-col="nombre"]')).toContainText('LLUVIAS EN SEVILLA');
  } finally {
    await new Promise<void>((r) => feed.close(() => r()));
  }
});
