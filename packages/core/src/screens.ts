import { z } from 'zod';

/*
 * F3.3 Pantallas / videowall. Cada pantalla del plató abre /pantalla/:token a
 * pantalla completa. Muestra su contenido por defecto o el de la escena activa.
 * Una escena se activa a mano o con el GO de una línea cuya columna PANTALLAS
 * tiene el nombre de la escena.
 */

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color #RRGGBB');

export const screenContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({
    type: z.literal('media'),
    mediaId: z.uuid(),
    fit: z.enum(['cover', 'contain']).default('cover'),
  }),
  z.object({
    type: z.literal('text'),
    text: z.string().trim().max(300),
    color: color.default('#FFFFFF'),
    background: color.default('#1F2A2E'),
  }),
  z.object({ type: z.literal('clock') }),
  z.object({
    type: z.literal('url'),
    url: z
      .string()
      .trim()
      .url('Dirección no válida')
      .max(500)
      .refine((u) => /^https?:\/\//i.test(u), 'Solo http o https'),
  }),
]);
export type ScreenContent = z.infer<typeof screenContentSchema>;

export const SCREEN_CONTENT_TYPES: { value: ScreenContent['type']; label: string }[] = [
  { value: 'none', label: 'Negro' },
  { value: 'media', label: 'Imagen o vídeo de Media' },
  { value: 'text', label: 'Texto' },
  { value: 'clock', label: 'Reloj' },
  { value: 'url', label: 'Página web' },
];

export const screenInput = z.object({
  name: z.string().trim().min(1, 'Obligatorio').max(60),
  content: screenContentSchema.default({ type: 'none' }),
});
export const screenPatch = z
  .object({
    name: z.string().trim().min(1).max(60),
    content: screenContentSchema,
  })
  .partial();

export interface ScreenDto {
  id: string;
  name: string;
  token: string;
  content: ScreenContent;
}

/** Contenido por pantalla; las que no aparecen siguen con su contenido por defecto. */
export const sceneContents = z.record(z.uuid(), screenContentSchema);

export const sceneInput = z.object({
  name: z.string().trim().min(1, 'Obligatorio').max(40),
  contents: sceneContents.default({}),
});
export const scenePatch = z
  .object({
    name: z.string().trim().min(1).max(40),
    contents: sceneContents,
  })
  .partial();

export interface SceneDto {
  id: string;
  name: string;
  contents: Record<string, ScreenContent>;
  active: boolean;
}

/** Clave para casar la columna PANTALLAS con el nombre de la escena. */
export const sceneKey = (name: string): string =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();

/** Contenido listo para pintar (con la dirección del fichero si es media). */
export type ResolvedScreenContent =
  | Exclude<ScreenContent, { type: 'media' }>
  | {
      type: 'media';
      mediaId: string;
      fit: 'cover' | 'contain';
      kind: 'video' | 'image' | 'audio';
      src: string;
    };

export interface PublicScreenState {
  orgName: string;
  name: string;
  timezone: string;
  /** Escena activa (null = contenido por defecto). */
  scene: string | null;
  content: ResolvedScreenContent;
}
