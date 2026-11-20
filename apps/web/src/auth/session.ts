import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeResponse, Permission, SetupStatusResponse } from '@runflow/core';
import { api, ApiError } from '../api/client';
import { clearLocalRundowns } from '../rundown/useRundownDoc';

export const meKey = ['me'] as const;

/** Sesión actual. `null` = sin sesión. */
export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: async () => {
      try {
        return await api.get<MeResponse>('/api/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
    retry: (count, err) => !(err instanceof ApiError && err.status > 0) && count < 2,
  });
}

export function useSetupStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['setup-status'],
    queryFn: () => api.get<SetupStatusResponse>('/api/setup/status'),
    enabled,
    staleTime: 30_000,
  });
}

/** Actualiza la sesión en caché con la respuesta de login, setup, cambio de empresa… */
export function useApplyMe() {
  const qc = useQueryClient();
  return (me: MeResponse | null) => {
    qc.setQueryData(meKey, me);
    qc.setQueryData(['setup-status'], { needsSetup: false });
  };
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      // En equipos compartidos no deben quedar copias locales de escaletas.
      await clearLocalRundowns().catch(() => undefined);
      qc.clear();
      qc.setQueryData(meKey, null);
    }
  };
}

/** Usuario con sesión y empresa activa (solo dentro de las rutas protegidas). */
export function useSession() {
  const { data } = useMe();
  if (!data || !data.activeOrg) throw new Error('useSession fuera de una ruta con empresa activa');
  return { me: data, org: data.activeOrg };
}

export function useCan(permission: Permission): boolean {
  const { data } = useMe();
  return !!data?.activeOrg?.permissions.includes(permission);
}
