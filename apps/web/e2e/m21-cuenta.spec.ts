import { expect, test } from '@playwright/test';

/* Lanzamiento: recuperar contraseña, enlaces caducados y textos legales. */

const H = { 'x-runflow-request': '1' };
const ADMIN = { email: 'ana@chaneltv.test', password: 'contraseña-segura-1' };

test('recuperar contraseña y textos legales', async ({ page, request }) => {
  const status = await (await request.get('/api/setup/status')).json();
  if (status.needsSetup) {
    await request.post('/api/setup', {
      headers: H,
      data: { orgName: 'Chanel TV', name: 'Ana Admin', ...ADMIN },
    });
  }
  await page.goto('/entrar');
  await page.getByRole('link', { name: '¿Has olvidado la contraseña?' }).click();
  await expect(page.getByRole('heading', { name: 'Recuperar la contraseña' })).toBeVisible();
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByRole('button', { name: 'Enviar enlace' }).click();
  await expect(page.getByText(/te hemos enviado un enlace/)).toBeVisible();

  // Enlaces que no valen.
  await page.goto('/restablecer/enlace-que-no-existe-0123456789abcdef');
  const fields = page.locator('input[type="password"]');
  await fields.nth(0).fill('otra-clave-segura-9');
  await fields.nth(1).fill('otra-clave-segura-9');
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(page.getByText(/no es válido o ha caducado/)).toBeVisible();
  await page.goto('/verificar/enlace-que-no-existe-0123456789abcdef');
  await expect(page.getByText(/no es válido o ha caducado/)).toBeVisible();

  // Textos legales.
  await page.goto('/legal/privacidad');
  await expect(page.getByRole('heading', { name: 'Política de privacidad' })).toBeVisible();
  await expect(page.getByText(/Agencia Española de Protección de Datos/)).toBeVisible();
  await page.getByRole('link', { name: 'Cookies' }).click();
  await expect(page.getByText('rf_session')).toBeVisible();

  // La cuenta sigue entrando con su contraseña (pedir el enlace no la cambia).
  await page.goto('/entrar');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Hola/ })).toBeVisible();
});
