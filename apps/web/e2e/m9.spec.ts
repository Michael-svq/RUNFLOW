import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';

/*
 * M9 en el navegador: proveedor de IA local (Ollama, simulado) configurado en
 * Configuración y asistente en el guion: paso a partir del off y rótulos.
 */

const shots = process.env.SCREENSHOT_DIR;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}
const H = { 'x-runflow-request': '1' };
const ADMIN = { email: 'ana@chaneltv.test', password: 'contraseña-segura-1' };
const row = (page: Page, i: number) => page.locator('.rf-rgrid tbody tr').nth(i);

test('M9: IA local (Ollama) en Configuración y en el guion', async ({ page, request }) => {
  const prompts: string[] = [];
  const ollama = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}') as { messages?: { content: string }[] };
      const system = body.messages?.[0]?.content ?? '';
      prompts.push(body.messages?.[1]?.content ?? '');
      const content = system.includes('rótulos de una noticia')
        ? '[{"type":"TOT","f0":"María Jesús Montero","f1":"Ministra de Hacienda"}]'
        : system.includes('«paso»')
          ? 'El Gobierno aprueba hoy los presupuestos más sociales de la legislatura.'
          : 'OK';
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          model: 'llama-local',
          message: { role: 'assistant', content },
          prompt_eval_count: 50,
          eval_count: 12,
        }),
      );
    });
  });
  await new Promise<void>((r) => ollama.listen(0, '127.0.0.1', r));
  const ollamaUrl = `http://127.0.0.1:${(ollama.address() as AddressInfo).port}`;
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
    for (const p of (await (await request.get('/api/ai/providers')).json()).providers as {
      id: string;
    }[])
      await request.delete(`/api/ai/providers/${p.id}`, { headers: H });
    const program = await request.post('/api/programs', {
      headers: H,
      data: { name: `IA ${Date.now()}`, type: 'informativo' },
    });
    const rundownId = (
      await (
        await request.post('/api/rundowns', {
          headers: H,
          data: {
            programId: (await program.json()).program.id,
            airDate: '2026-11-20',
            startTime: '15:00',
            endTime: '15:30',
          },
        })
      ).json()
    ).rundown.id;

    await page.goto('/entrar');
    await page.getByLabel('Email').fill(ADMIN.email);
    await page.getByLabel('Contraseña').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('heading', { name: /Hola/ })).toBeVisible();

    // 1. Ollama en local como proveedor predeterminado
    await page.goto('/configuracion');
    await page.getByLabel('Proveedor de IA').selectOption({ label: 'Ollama (local)' });
    await page.getByRole('button', { name: 'Añadir proveedor' }).click();
    const form = page.getByRole('form', { name: 'Proveedor Ollama (local)' });
    await form.getByLabel('Modelo').fill('llama-local');
    await form.getByLabel('Dirección (opcional)').fill(ollamaUrl);
    await form.getByLabel('Proveedor predeterminado').check();
    await form.getByRole('button', { name: 'Guardar proveedor' }).click();
    const item = page.locator('li', { hasText: 'llama-local' });
    await expect(item).toBeVisible();
    await item.getByRole('button', { name: 'Probar' }).click();
    await expect(page.getByText(/responde \(llama-local\)/)).toBeVisible();

    // 2. Guion: escribir el off y pedir el paso a la IA
    await page.goto(`/escaletas/${rundownId}`);
    await expect(page.locator('.rf-conn--online')).toBeVisible();
    await page.getByRole('button', { name: 'Añadir la primera línea' }).click();
    await row(page, 0).locator('td[data-col="nombre"]').click();
    await page.keyboard.type('PRESUPUESTOS');
    await page.keyboard.press('Enter');
    await row(page, 0).locator('td[data-col="nombre"]').click();
    const panel = page.getByRole('complementary', { name: 'Panel' });
    await expect(panel.locator('.rf-script__name')).toHaveText('PRESUPUESTOS');
    await panel.locator('.rf-script__doc').click();
    await page.keyboard.press('Control+2');
    await page.keyboard.type(
      'La ministra María Jesús Montero ha presentado las cuentas en Sevilla.',
    );
    await expect(panel.locator('p.rf-script-off')).toHaveCount(1);

    await panel.getByRole('button', { name: '✦ IA' }).click();
    const dialog = page.getByRole('dialog', { name: 'Asistente de IA' });
    await expect(dialog.getByLabel('Texto para la IA')).toHaveValue(/María Jesús Montero/);
    await dialog.getByRole('button', { name: 'Pedir propuesta' }).click();
    await expect(dialog.getByText('El Gobierno aprueba hoy los presupuestos')).toBeVisible();
    await expect(dialog.getByText(/Propuesta de Ollama/)).toBeVisible();
    await shot(page, 'm9-asistente');
    await dialog.getByRole('button', { name: 'Añadir como paso' }).click();
    await expect(panel.locator('p.rf-script-paso').first()).toHaveText(
      'El Gobierno aprueba hoy los presupuestos más sociales de la legislatura.',
    );
    expect(prompts.at(-1)).toContain('<texto>');

    // 3. Rótulos sugeridos
    await panel.getByRole('button', { name: '✦ IA' }).click();
    await dialog.getByLabel('Qué quieres hacer').selectOption({ label: 'Sugerir rótulos' });
    await dialog.getByRole('button', { name: 'Pedir propuesta' }).click();
    await expect(dialog.getByText('MARÍA JESÚS MONTERO')).toBeVisible();
    await dialog.getByRole('button', { name: 'Añadir 1 rótulos' }).click();
    await expect(panel.locator('.rf-rotulo')).toHaveCount(1);
    await expect(panel.locator('.rf-rotulo').getByLabel('NOMBRE')).toHaveValue(
      'MARÍA JESÚS MONTERO',
    );

    // 4. Consumo en Configuración
    await page.goto('/configuracion');
    await expect(page.getByText(/Consumo de \d{4}-\d{2}/)).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Sugerir rótulos' })).toBeVisible();
  } finally {
    await new Promise<void>((r) => ollama.close(() => r()));
  }
});
