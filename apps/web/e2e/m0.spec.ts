import { expect, test, type Page } from '@playwright/test';

/*
 * Criterio de aceptación de M0: se puede entrar y crear usuarios,
 * y dos empresas no ven datos entre sí.
 */

const shots = process.env.SCREENSHOT_DIR;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/entrar');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

async function changePassword(page: Page, current: string, next: string) {
  await expect(page.getByRole('heading', { name: 'Cambia tu contraseña' })).toBeVisible();
  await page.getByLabel('Contraseña actual').fill(current);
  await page.getByLabel('Nueva contraseña', { exact: true }).fill(next);
  await page.getByLabel('Repite la nueva contraseña').fill(next);
  await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
}

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Mi cuenta' }).click();
  await page.getByRole('menuitem', { name: 'Salir' }).click();
  await expect(page).toHaveURL(/\/entrar/);
}

/** Menú de administración (rueda dentada). */
async function admin(page: Page, item: string) {
  await page.getByRole('button', { name: 'Administración' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test('M0: configuración inicial, usuarios y aislamiento entre empresas', async ({ page }) => {
  // 1. Instalación nueva → configuración inicial
  await page.goto('/');
  await expect(page).toHaveURL(/configuracion-inicial/);
  await shot(page, '01-configuracion-inicial');
  await page.getByLabel('Nombre de la empresa o centro').fill('Chanel TV');
  await page.getByLabel('Tu nombre').fill('Ana Admin');
  await page.getByLabel('Email').fill('ana@chaneltv.test');
  await page.getByLabel('Contraseña').fill('contraseña-segura-1');
  await page.getByRole('button', { name: 'Crear y entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Hola, Ana' })).toBeVisible();
  await shot(page, '02-inicio');

  // 2. Alta de un redactor
  await admin(page, 'Gestión de usuarios');
  await page.getByRole('button', { name: '+ Nuevo usuario' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre y apellidos').fill('Rafa Redactor');
  await dialog.getByLabel('Email').fill('rafa@chaneltv.test');
  await dialog.getByLabel('Rol').selectOption({ label: 'Redactor / Periodista' });
  await dialog.getByLabel('Contraseña inicial').fill('temporal-12345');
  await shot(page, '03-nuevo-usuario');
  await dialog.getByRole('button', { name: 'Crear' }).click();
  await expect(page.getByText('Rafa Redactor añadido.')).toBeVisible();
  await expect(page.getByRole('row', { name: /Rafa Redactor/ })).toContainText(
    'Redactor / Periodista',
  );
  await shot(page, '04-usuarios');

  // Validación en el formulario
  await page.getByRole('button', { name: '+ Nuevo usuario' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Crear' }).click();
  await expect(page.getByRole('dialog').getByText('Obligatorio').first()).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();

  // 3. Alta de otra empresa desde la administración de plataforma
  await admin(page, 'Plataforma');
  await page.getByRole('button', { name: '+ Nueva empresa' }).click();
  const orgDialog = page.getByRole('dialog');
  await orgDialog.getByLabel('Nombre de la empresa').fill('Escuela Audiovisual');
  await orgDialog.getByLabel('Nombre del administrador').fill('Bea Profe');
  await orgDialog.getByLabel('Email del administrador').fill('bea@escuela.test');
  await orgDialog.getByLabel('Contraseña inicial').fill('temporal-12345');
  await orgDialog.getByRole('button', { name: 'Crear' }).click();
  await expect(page.getByRole('row', { name: /Escuela Audiovisual/ })).toBeVisible();
  await shot(page, '05-plataforma');
  await logout(page);

  // 4. El redactor entra, cambia la contraseña provisional y no ve la gestión de usuarios
  await login(page, 'rafa@chaneltv.test', 'temporal-12345');
  await shot(page, '06-cambiar-contrasena');
  await changePassword(page, 'temporal-12345', 'clave-de-rafa-123');
  await expect(page.getByRole('heading', { name: 'Hola, Rafa' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Administración' })).toHaveCount(0);
  await page.goto('/usuarios');
  await expect(page).toHaveURL(/\/inicio/);
  await logout(page);

  // 5. La administradora de la otra empresa solo ve a su gente
  await login(page, 'bea@escuela.test', 'temporal-12345');
  await changePassword(page, 'temporal-12345', 'clave-de-bea-123');
  await admin(page, 'Gestión de usuarios');
  await expect(page.getByRole('row', { name: /Bea Profe/ })).toBeVisible();
  await expect(page.getByText('ana@chaneltv.test')).toHaveCount(0);
  await expect(page.getByText('rafa@chaneltv.test')).toHaveCount(0);
  await page.getByRole('button', { name: 'Administración' }).click();
  await expect(page.getByRole('menuitem', { name: 'Plataforma' })).toHaveCount(0);
  await shot(page, '07-aislamiento');
});

test('modo claro y vista de móvil', async ({ page }) => {
  await login(page, 'ana@chaneltv.test', 'contraseña-segura-1');
  await page.getByRole('button', { name: 'Cambiar a modo claro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'exterior');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'exterior');
  await expect(page.getByRole('button', { name: 'Cambiar a modo oscuro' })).toBeVisible();
  await admin(page, 'Gestión de usuarios');
  await expect(page.getByRole('row', { name: /Rafa Redactor/ })).toBeVisible();
  await shot(page, '08-tema-exterior');

  await page.setViewportSize({ width: 390, height: 844 });
  // Sin desbordamiento horizontal en el móvil.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(page, '09-movil-usuarios');
  await page.getByRole('button', { name: 'Menú' }).click();
  await expect(page.getByRole('link', { name: 'Escaletas' })).toBeVisible();
  await shot(page, '10-movil-menu');
  await page.getByRole('button', { name: 'Mi cuenta' }).click();
  await page.getByRole('menuitem', { name: /Configuración de usuario/ }).click();
  await expect(page.getByRole('heading', { name: /Configuración de usuario/ })).toBeVisible();
  await shot(page, '11-movil-perfil');
});
