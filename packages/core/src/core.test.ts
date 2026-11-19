import { describe, expect, it } from 'vitest';
import {
  ADMIN_ROLE_KEY,
  ALL_PERMISSIONS,
  DEFAULT_ROLES,
  changePasswordInput,
  createUserInput,
  hasPermission,
  isPermission,
  loginInput,
} from './index';

describe('roles por defecto', () => {
  it('tienen claves únicas y solo permisos válidos', () => {
    const keys = DEFAULT_ROLES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const role of DEFAULT_ROLES) {
      for (const p of role.permissions) expect(isPermission(p)).toBe(true);
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
    }
  });

  it('el administrador tiene todos los permisos', () => {
    const admin = DEFAULT_ROLES.find((r) => r.key === ADMIN_ROLE_KEY);
    expect(admin?.permissions.sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('solo el administrador puede gestionar usuarios', () => {
    const withUsers = DEFAULT_ROLES.filter((r) => r.permissions.includes('users.manage'));
    expect(withUsers.map((r) => r.key)).toEqual([ADMIN_ROLE_KEY]);
  });
});

describe('hasPermission', () => {
  it('comprueba la lista concedida', () => {
    expect(hasPermission(['rundown.view'], 'rundown.view')).toBe(true);
    expect(hasPermission(['rundown.view'], 'live.go')).toBe(false);
    expect(hasPermission(null, 'live.go')).toBe(false);
  });
});

describe('validaciones', () => {
  it('normaliza el email', () => {
    expect(loginInput.parse({ email: '  Ana@Ejemplo.ES ', password: 'x' }).email).toBe(
      'ana@ejemplo.es',
    );
  });

  it('rechaza emails no válidos', () => {
    expect(loginInput.safeParse({ email: 'no-es-email', password: 'x' }).success).toBe(false);
  });

  it('exige contraseñas de al menos 10 caracteres', () => {
    const base = {
      name: 'Ana',
      email: 'ana@ejemplo.es',
      roleId: '7b0c1f1e-6d4a-4f55-9a43-2c9d4f6a1b11',
    };
    expect(createUserInput.safeParse({ ...base, password: 'corta' }).success).toBe(false);
    expect(createUserInput.safeParse({ ...base, password: 'suficientemente-larga' }).success).toBe(
      true,
    );
  });

  it('la nueva contraseña debe ser distinta', () => {
    const r = changePasswordInput.safeParse({
      currentPassword: 'misma-clave-123',
      newPassword: 'misma-clave-123',
    });
    expect(r.success).toBe(false);
  });
});
