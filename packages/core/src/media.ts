import { z } from 'zod';

/* F2.1 Media: vídeos, imágenes y audio de la empresa. */

export interface MediaDto {
  id: string;
  folder: string;
  name: string;
  mime: string;
  size: number;
  durationS: number | null;
  width: number | null;
  height: number | null;
  proxyStatus: 'none' | 'pending' | 'ready' | 'error';
  createdAt: string;
  /** Nombre del clip en CasparCG si se copia (CARPETA/NOMBRE). */
  clipName: string;
}

const folderSchema = z
  .string()
  .trim()
  .max(120)
  .regex(/^[\p{L}\p{N} _./-]*$/u, 'Solo letras, números, espacios, «-», «_», «.» y «/»')
  .transform((f) =>
    f
      .split('/')
      .map((p) => p.trim())
      .filter((p) => p && p !== '.' && p !== '..')
      .join('/'),
  );

export const mediaPatch = z.object({
  name: z.string().trim().min(1, 'Obligatorio').max(120).optional(),
  folder: folderSchema.optional(),
});
export const mediaFolderSchema = folderSchema;

export const mediaQuery = z.object({
  folder: z.string().max(120).optional(),
  q: z.string().trim().max(100).optional(),
});

/** Nombre de clip para CasparCG: sin acentos ni símbolos, en mayúsculas. */
export function clipNameFor(folder: string, name: string): string {
  const clean = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\.[a-z0-9]{2,4}$/i, '')
      .replace(/[^A-Za-z0-9 _-]+/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .toUpperCase();
  const parts = folder.split('/').map(clean).filter(Boolean);
  return [...parts, clean(name) || 'CLIP'].join('/');
}
