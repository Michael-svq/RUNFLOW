import { expect, test } from '@playwright/test';

/* F3.4 Redes: mensaje de la audiencia → rótulo RRS en la escaleta. */

const H = { 'x-runflow-request': '1' };
const ADMIN = { email: 'ana@chaneltv.test', password: 'contraseña-segura-1' };

test('F3.4: mensaje de la audiencia rotulado en la escaleta', async ({ page, request }) => {
  const status = await (await request.get('/api/setup/status')).json();
  if (status.needsSetup) {
    await request.post('/api/setup', {
      headers: H,
      data: { orgName: 'Chanel TV', name: 'Ana Admin', ...ADMIN },
    });
  }
  const n = Date.now();
  const author = `Carmen ${n}`;
  const title = `Gala redes ${n}`;

  await page.goto('/entrar');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Hola/ })).toBeVisible();

  // Escaleta de hoy para rotular en ella.
  const program = await page.request.post('/api/programs', {
    headers: H,
    data: { name: `Gala ${n}`, type: 'evento' },
  });
  const today = new Date().toISOString().slice(0, 10);
  const rundown = await page.request.post('/api/rundowns', {
    headers: H,
    data: {
      programId: (await program.json()).program.id,
      title,
      airDate: today,
      startTime: '20:00',
      endTime: '22:00',
    },
  });
  const rundownId = (await rundown.json()).rundown.id as string;

  await page.goto('/social');
  await expect(page.getByRole('heading', { name: /Redes sociales/ })).toBeVisible();
  const form = page.getByRole('form', { name: 'Publicación manual' });
  await form.getByLabel('Nombre').fill(author);
  await form.getByLabel('Mensaje').fill('Saludos a mi nieta, que actúa hoy en la gala');
  await form.getByRole('button', { name: 'Añadir' }).click();

  await page.getByRole('tab', { name: /Aprobadas/ }).click();
  const post = page.locator('.rf-social__post', { hasText: author });
  await expect(post).toContainText('WhatsApp');
  await post.getByRole('button', { name: 'Rotular…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rotular en una escaleta' });
  await dialog.getByLabel('Escaleta').selectOption({ label: `${today} · ${title}` });
  await dialog.getByRole('button', { name: 'Añadir rótulo' }).click();
  await expect(page.getByText(`Rótulo de redes añadido a «${title}».`)).toBeVisible();

  // En la escaleta: línea de GRAFISMO con el rótulo RRS.
  await page.goto(`/escaletas/${rundownId}`);
  await expect(page.getByText(new RegExp(`RRSS ${author}`, 'i')).first()).toBeVisible();
});
