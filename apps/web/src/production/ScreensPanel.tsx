import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SCREEN_CONTENT_TYPES,
  type MediaDto,
  type SceneDto,
  type ScreenContent,
  type ScreenDto,
} from '@runflow/core';
import { Alert, Badge, Button, Spinner, TextField } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { useCan } from '../auth/session';

/* F3.3 Pantallas / videowall: pantallas del plató, contenido por defecto y escenas. */

const key = ['screens'];
type Data = { screens: ScreenDto[]; scenes: SceneDto[]; clients: number };

const defaults: Record<ScreenContent['type'], ScreenContent> = {
  none: { type: 'none' },
  media: { type: 'media', mediaId: '', fit: 'cover' } as ScreenContent,
  text: { type: 'text', text: '', color: '#FFFFFF', background: '#1F2A2E' },
  clock: { type: 'clock' },
  url: { type: 'url', url: '' },
};

export function describeContent(c: ScreenContent, media: MediaDto[]): string {
  switch (c.type) {
    case 'none':
      return 'Negro';
    case 'clock':
      return 'Reloj';
    case 'text':
      return `Texto: «${c.text}»`;
    case 'url':
      return `Web: ${c.url}`;
    case 'media':
      return `Media: ${media.find((m) => m.id === c.mediaId)?.name ?? '¿?'}`;
  }
}

/** Editor de contenido de una pantalla. */
function ContentEditor({
  label,
  value,
  media,
  onChange,
}: {
  label: string;
  value: ScreenContent;
  media: MediaDto[];
  onChange: (c: ScreenContent) => void;
}) {
  const visual = media.filter((m) => m.mime.startsWith('image/') || m.mime.startsWith('video/'));
  return (
    <div className="rf-screens__editor">
      <select
        className="rf-select rf-select--sm"
        aria-label={`Contenido de ${label}`}
        value={value.type}
        onChange={(e) => onChange(defaults[e.target.value as ScreenContent['type']])}
      >
        {SCREEN_CONTENT_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      {value.type === 'media' && (
        <>
          <select
            className="rf-select rf-select--sm"
            aria-label={`Fichero de ${label}`}
            value={value.mediaId}
            onChange={(e) => onChange({ ...value, mediaId: e.target.value })}
          >
            <option value="">Elige un fichero…</option>
            {visual.map((m) => (
              <option key={m.id} value={m.id}>
                {m.folder ? `${m.folder} / ` : ''}
                {m.name}
              </option>
            ))}
          </select>
          <select
            className="rf-select rf-select--sm"
            aria-label={`Encaje de ${label}`}
            value={value.fit}
            onChange={(e) => onChange({ ...value, fit: e.target.value as 'cover' | 'contain' })}
          >
            <option value="cover">Llenar</option>
            <option value="contain">Entero</option>
          </select>
        </>
      )}
      {value.type === 'text' && (
        <>
          <input
            className="rf-input rf-input--sm"
            aria-label={`Texto de ${label}`}
            value={value.text}
            maxLength={300}
            onChange={(e) => onChange({ ...value, text: e.target.value })}
          />
          <input
            type="color"
            aria-label={`Color del texto de ${label}`}
            value={value.color}
            onChange={(e) => onChange({ ...value, color: e.target.value.toUpperCase() })}
          />
          <input
            type="color"
            aria-label={`Fondo de ${label}`}
            value={value.background}
            onChange={(e) => onChange({ ...value, background: e.target.value.toUpperCase() })}
          />
        </>
      )}
      {value.type === 'url' && (
        <input
          className="rf-input rf-input--sm"
          type="url"
          placeholder="https://…"
          aria-label={`Dirección web de ${label}`}
          value={value.url}
          onChange={(e) => onChange({ ...value, url: e.target.value })}
        />
      )}
    </div>
  );
}

const valid = (c: ScreenContent) =>
  c.type === 'media' ? !!c.mediaId : c.type === 'url' ? /^https?:\/\/.+/.test(c.url) : true;

export function ScreensPanel() {
  const qc = useQueryClient();
  const canProduction = useCan('production.manage');
  const canConfigure = useCan('org.configure');
  const canGo = useCan('live.go');
  const canManage = canProduction || canConfigure;
  const canTake = canGo || canProduction;
  const data = useQuery({
    queryKey: key,
    queryFn: () => api.get<Data>('/api/screens'),
    refetchInterval: 5000,
  });
  const media = useQuery({
    queryKey: ['media', null, ''],
    queryFn: () => api.get<{ media: MediaDto[]; folders: string[] }>('/api/media'),
    enabled: canManage,
  });
  const mediaList = media.data?.media ?? [];
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [newScreen, setNewScreen] = useState('');
  const [newScene, setNewScene] = useState('');
  const refresh = () => void qc.invalidateQueries({ queryKey: key });
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setNotice(null);
    try {
      await fn();
      if (ok) setNotice({ tone: 'success', text: ok });
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err) });
    }
    refresh();
  };

  if (data.isPending) return <Spinner label="Cargando…" />;
  if (data.isError) return <Alert tone="error">{errorMessage(data.error)}</Alert>;
  const { screens, scenes, clients } = data.data;
  const active = scenes.find((s) => s.active);
  const link = (s: ScreenDto) => `${window.location.origin}/pantalla/${s.token}`;

  return (
    <div className="rf-screens">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <section className="rf-card" aria-label="Pantallas">
        <h2 className="rf-form__title">Pantallas</h2>
        <p className="rf-muted rf-small">
          Abre el enlace de cada pantalla en el navegador del equipo que la alimenta (videowall,
          monitores del plató, público) y ponlo a pantalla completa. {clients} conectada
          {clients === 1 ? '' : 's'} ahora.
        </p>
        {screens.length === 0 && <p className="rf-muted rf-small">Aún no hay pantallas.</p>}
        <ul className="rf-screens__list">
          {screens.map((s) => (
            <ScreenRow
              key={`${s.id}:${s.token}:${JSON.stringify(s.content)}`}
              screen={s}
              media={mediaList}
              canManage={canManage}
              link={link(s)}
              act={act}
            />
          ))}
        </ul>
        {canManage && (
          <form
            className="rf-config__inline"
            aria-label="Nueva pantalla"
            onSubmit={(e) => {
              e.preventDefault();
              void act(() => api.post('/api/screens', { name: newScreen })).then(() =>
                setNewScreen(''),
              );
            }}
          >
            <TextField
              label="Nombre de la pantalla"
              value={newScreen}
              placeholder="Videowall, Mesa, Público…"
              maxLength={60}
              onChange={(e) => setNewScreen(e.target.value)}
            />
            <Button type="submit" size="sm" disabled={!newScreen.trim()}>
              Añadir pantalla
            </Button>
          </form>
        )}
      </section>

      <section className="rf-card" aria-label="Escenas">
        <div className="rf-screens__head">
          <h2 className="rf-form__title">Escenas</h2>
          {active ? (
            <Badge tone="danger">En pantallas: {active.name}</Badge>
          ) : (
            <Badge tone="muted">Contenido por defecto</Badge>
          )}
          {canTake && active && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void act(() => api.post('/api/screens/release'))}
            >
              Volver al contenido por defecto
            </Button>
          )}
        </div>
        <p className="rf-muted rf-small">
          Una escena dice qué sale en cada pantalla. Escribe su nombre en la columna{' '}
          <strong>PANTALLAS</strong> de una línea de la escaleta y, al darle GO, las pantallas
          cambian solas. También se lanzan a mano.
        </p>
        <ul className="rf-screens__list">
          {scenes.map((sc) => (
            <SceneRow
              key={`${sc.id}:${JSON.stringify(sc.contents)}:${sc.name}`}
              scene={sc}
              screens={screens}
              media={mediaList}
              canManage={canManage}
              canTake={canTake}
              act={act}
            />
          ))}
        </ul>
        {canManage && (
          <form
            className="rf-config__inline"
            aria-label="Nueva escena"
            onSubmit={(e) => {
              e.preventDefault();
              void act(() => api.post('/api/screens/scenes', { name: newScene })).then(() =>
                setNewScene(''),
              );
            }}
          >
            <TextField
              label="Nombre de la escena"
              value={newScene}
              placeholder="APERTURA, ENTREVISTA, CIERRE…"
              maxLength={40}
              onChange={(e) => setNewScene(e.target.value)}
            />
            <Button type="submit" size="sm" disabled={!newScene.trim()}>
              Añadir escena
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}

type Act = (fn: () => Promise<unknown>, ok?: string) => Promise<void>;

function ScreenRow({
  screen,
  media,
  canManage,
  link,
  act,
}: {
  screen: ScreenDto;
  media: MediaDto[];
  canManage: boolean;
  link: string;
  act: Act;
}) {
  const [content, setContent] = useState(screen.content);
  const dirty = JSON.stringify(content) !== JSON.stringify(screen.content);
  return (
    <li className="rf-screens__item">
      <div className="rf-screens__title">
        <strong>{screen.name}</strong>
        <span className="rf-muted rf-small">
          Por defecto: {describeContent(screen.content, media)}
        </span>
      </div>
      {canManage && (
        <div className="rf-screens__row">
          <ContentEditor label={screen.name} value={content} media={media} onChange={setContent} />
          <Button
            size="sm"
            disabled={!dirty || !valid(content)}
            onClick={() => void act(() => api.patch(`/api/screens/${screen.id}`, { content }))}
          >
            Guardar
          </Button>
        </div>
      )}
      <div className="rf-screens__row">
        <code className="rf-screens__link">{link}</code>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void act(
              async () => navigator.clipboard?.writeText(link),
              `Enlace de ${screen.name} copiado.`,
            )
          }
        >
          Copiar
        </Button>
        <a className="rf-btn rf-btn--sm rf-btn--ghost" href={link} target="_blank" rel="noreferrer">
          Abrir
        </a>
        {canManage && (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                window.confirm('El enlace actual dejará de funcionar. ¿Crear uno nuevo?') &&
                void act(() => api.post(`/api/screens/${screen.id}/token`))
              }
            >
              Nuevo enlace
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                window.confirm(`¿Borrar la pantalla «${screen.name}»?`) &&
                void act(() => api.delete(`/api/screens/${screen.id}`))
              }
            >
              Borrar
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function SceneRow({
  scene,
  screens,
  media,
  canManage,
  canTake,
  act,
}: {
  scene: SceneDto;
  screens: ScreenDto[];
  media: MediaDto[];
  canManage: boolean;
  canTake: boolean;
  act: Act;
}) {
  const [contents, setContents] = useState(scene.contents);
  const dirty = JSON.stringify(contents) !== JSON.stringify(scene.contents);
  return (
    <li className={`rf-screens__item${scene.active ? ' is-active' : ''}`}>
      <div className="rf-screens__head">
        <strong>{scene.name}</strong>
        {scene.active && <Badge tone="danger">En pantallas</Badge>}
        {canTake && !scene.active && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => void act(() => api.post(`/api/screens/scenes/${scene.id}/take`))}
          >
            Lanzar
          </Button>
        )}
        {canManage && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              window.confirm(`¿Borrar la escena «${scene.name}»?`) &&
              void act(() => api.delete(`/api/screens/scenes/${scene.id}`))
            }
          >
            Borrar
          </Button>
        )}
      </div>
      {screens.map((s) => {
        const own = contents[s.id];
        return (
          <div key={s.id} className="rf-screens__row">
            <span className="rf-screens__screen">{s.name}</span>
            {canManage ? (
              <>
                <label className="rf-check">
                  <input
                    type="checkbox"
                    checked={!own}
                    onChange={() => {
                      const next = { ...contents };
                      if (own) delete next[s.id];
                      else next[s.id] = s.content;
                      setContents(next);
                    }}
                  />
                  <span>Por defecto</span>
                </label>
                {own && (
                  <ContentEditor
                    label={`${s.name} en ${scene.name}`}
                    value={own}
                    media={media}
                    onChange={(c) => setContents({ ...contents, [s.id]: c })}
                  />
                )}
              </>
            ) : (
              <span className="rf-muted rf-small">
                {own ? describeContent(own, media) : 'Por defecto'}
              </span>
            )}
          </div>
        );
      })}
      {canManage && (
        <div>
          <Button
            size="sm"
            disabled={!dirty || !Object.values(contents).every(valid)}
            onClick={() =>
              void act(() => api.patch(`/api/screens/scenes/${scene.id}`, { contents }))
            }
          >
            Guardar escena
          </Button>
        </div>
      )}
    </li>
  );
}
