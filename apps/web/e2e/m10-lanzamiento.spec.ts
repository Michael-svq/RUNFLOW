import { expect, test } from '@playwright/test';

/* Lanzamiento: portada pública, registro autoservicio y ayuda. */

test('portada pública, registro autoservicio y ayuda', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /Escaletas, guiones, rótulos y directo/ }),
  ).toBeVisible();
  const plans = page.locator('#planes');
  await expect(plans.getByRole('heading', { name: 'Profesional' })).toBeVisible();
  await expect(plans.getByText('Sin publicidad en ningún plan.')).toBeVisible();

  await page.getByRole('link', { name: 'Ayuda' }).first().click();
  await expect(page.getByRole('heading', { name: 'Ayuda de RunFlow' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'El directo' })).toBeVisible();

  await page.goto('/');
  await page.getByRole('link', { name: 'Crear cuenta gratis' }).click();
  await expect(page).toHaveURL(/\/registro$/);
  const email = `lola-${Date.now()}@tvlocal.test`;
  await page.getByLabel('Nombre de la televisión, centro o productora').fill('TV Local de Prueba');
  await page.getByLabel('Tu nombre').fill('Lola');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill('contraseña-segura-1');
  await page.getByRole('button', { name: 'Crear cuenta gratis' }).click();
  await expect(page.getByText('Hay que aceptar las condiciones')).toBeVisible();
  await page.getByLabel(/Acepto las condiciones/).check();
  await page.getByRole('button', { name: 'Crear cuenta gratis' }).click();
  await expect(page).toHaveURL(/\/inicio/);
  await expect(page.getByText('TV Local de Prueba').first()).toBeVisible();
});
