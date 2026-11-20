import { useRef, useState, type DragEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDuration, type DeviceDto, type MediaDto } from '@runflow/core';
import { Alert, Badge, Button, Dialog, Spinner, TextField } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { useCan } from '../auth/session';
import { PageHeader } from '../components/PageHeader';

/* 05 Media (F2.1): vídeos, imágenes y audio; previsualizar y enviar a CasparCG. */

const mediaKey = ['media'];

const sizeFmt = (n: number) =>
  n > 1024 ** 3
    ? `${(n / 1024 ** 3).toFixed(1)} GB`
    : n > 1024 ** 2
      ? `${(n / 1024 ** 2).toFixed(1)} MB`
      : `${Math.max(1, Math.round(n / 1024))} KB`;

/** Subida con progreso (XMLHttpRequest). */
function uploadFile(
  file: File,
  folder: string,
  onProgress: (pct: number) => void,
): Promise<MediaDto> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('folder', folder);
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media');
    xhr.setRequestHeader('x-runflow-request', '1');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress((e.loaded / e.total) * 100);
    xhr.onload = () => {
      const body = (() => {
        try {
          return JSON.parse(xhr.responseText) as { media?: MediaDto; error?: { message?: string } };
        } catch {
          return {};
        }
      })();
      if (xhr.status === 201 && body.media) resolve(body.media);
      else reject(new Error(body.error?.message ?? `Error ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Sin conexión'));
    xhr.send(form);
  });
}

/** Código de tiempo HH:MM:SS:FF (25 fps) para marcar rótulos sobre el vídeo. */
export const toTc = (t: number, fps = 25) => {
  const f = Math.floor(t * fps);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(f / (3600 * fps)))}:${p(Math.floor(f / (60 * fps)) % 60)}:${p(
    Math.floor(f / fps) % 60,
  )}:${p(f % fps)}`;
};

function VideoPreview({ src }: { src: string }) {
  const [t, setT] = useState(0);
  const [marks, setMarks] = useState<number[]>([]);
  return (
    <>
      <video controls autoPlay src={src} onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} />
      <div className="rf-media__tc">
        <code aria-label="Código de tiempo">{toTc(t)}</code>
        <Button size="sm" variant="ghost" onClick={() => setMarks((m) => [...m, t])}>
          Marcar TC
        </Button>
        {marks.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void navigator.clipboard?.writeText(
                marks.map((m) => `${formatDuration(Math.round(m))}`).join('\n'),
              )
            }
          >
            Copiar marcas
          </Button>
        )}
      </div>
      {marks.length > 0 && (
        <ol className="rf-media__marks rf-small" aria-label="Marcas de TC">
          {marks.map((m, i) => (
            <li key={i}>
              {toTc(m)}{' '}
              <span className="rf-muted">(rótulo en {formatDuration(Math.round(m))})</span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

export function MediaPage() {
  const qc = useQueryClient();
  const canManage = useCan('media.manage');
  const [folder, setFolder] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const list = useQuery({
    queryKey: [...mediaKey, folder, q],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (folder !== null) params.set('folder', folder);
      if (q.trim()) params.set('q', q.trim());
      return api.get<{ media: MediaDto[]; folders: string[] }>(`/api/media?${params}`);
    },
    refetchInterval: (query) =>
      query.state.data?.media.some((m) => m.proxyStatus === 'pending') ? 3000 : false,
  });
  const casparDevices = useQuery({
    queryKey: ['devices'],
    queryFn: async () => (await api.get<{ devices: DeviceDto[] }>('/api/devices')).devices,
    enabled: canManage,
  });
  const casparWithMedia = (casparDevices.data ?? []).filter(
    (d) => d.kind === 'casparcg' && d.config.mediaPath,
  );
  const [uploads, setUploads] = useState<{ name: string; pct: number }[]>([]);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [preview, setPreview] = useState<MediaDto | null>(null);
  const [edit, setEdit] = useState<{ item: MediaDto; name: string; folder: string } | null>(null);
  const [newFolder, setNewFolder] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | File[]) {
    setNotice(null);
    const target = folder ?? newFolder.trim();
    for (const file of Array.from(files)) {
      setUploads((u) => [...u, { name: file.name, pct: 0 }]);
      try {
        await uploadFile(file, target, (pct) =>
          setUploads((u) => u.map((x) => (x.name === file.name ? { ...x, pct } : x))),
        );
      } catch (err) {
        setNotice({ tone: 'error', text: `${file.name}: ${errorMessage(err)}` });
      } finally {
        setUploads((u) => u.filter((x) => x.name !== file.name));
      }
    }
    void qc.invalidateQueries({ queryKey: mediaKey });
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (canManage && e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
  };

  return (
    <>
      <PageHeader
        number="05"
        title="Media"
        intro="Vídeos, imágenes y audio de la empresa. Previsualízalos y envíalos a CasparCG para usarlos en la columna CLIP."
      />
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <div className="rf-sources">
        <aside className="rf-card rf-sources__list" aria-label="Carpetas">
          <h2 className="rf-form__title">Carpetas</h2>
          <ul className="rf-sidelist__items">
            <li>
              <button
                type="button"
                className={`rf-sources__pick${folder === null ? ' is-active' : ''}`}
                onClick={() => setFolder(null)}
              >
                Todo
              </button>
            </li>
            {(list.data?.folders ?? []).map((f) => (
              <li key={f || '(raíz)'}>
                <button
                  type="button"
                  className={`rf-sources__pick${folder === f ? ' is-active' : ''}`}
                  onClick={() => setFolder(f)}
                >
                  {f || '(sin carpeta)'}
                </button>
              </li>
            ))}
          </ul>
          {canManage && folder === null && (
            <TextField
              label="Carpeta para lo que subas"
              value={newFolder}
              placeholder="p. ej. Noticias/2026-11-20"
              onChange={(e) => setNewFolder(e.target.value)}
            />
          )}
        </aside>
        <section className="rf-sources__items" aria-label="Ficheros">
          {canManage && (
            <div className="rf-media__drop" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
              <p>
                Arrastra aquí vídeos, imágenes o audio
                {folder !== null || newFolder ? ` a «${folder ?? newFolder}»` : ''} o{' '}
                <button type="button" className="rf-link" onClick={() => input.current?.click()}>
                  elígelos
                </button>
                .
              </p>
              <input
                ref={input}
                type="file"
                multiple
                accept="video/*,image/*,audio/*"
                hidden
                aria-label="Subir ficheros"
                onChange={(e) => {
                  if (e.target.files) void addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              {uploads.map((u) => (
                <div key={u.name} className="rf-media__progress">
                  <span>{u.name}</span>
                  <progress max={100} value={u.pct} />
                </div>
              ))}
            </div>
          )}
          <input
            className="rf-input"
            placeholder="Buscar por nombre…"
            aria-label="Buscar media"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {list.isPending ? (
            <Spinner label="Cargando…" />
          ) : list.isError ? (
            <Alert tone="error">{errorMessage(list.error)}</Alert>
          ) : list.data.media.length === 0 ? (
            <div className="rf-card rf-empty">No hay ficheros.</div>
          ) : (
            <ul className="rf-media__grid">
              {list.data.media.map((m) => (
                <li key={m.id} className="rf-card rf-media__item">
                  <button type="button" className="rf-media__thumb" onClick={() => setPreview(m)}>
                    {m.mime.startsWith('image/') ? (
                      <img src={`/api/media/${m.id}/file`} alt="" loading="lazy" />
                    ) : (
                      <span aria-hidden="true">{m.mime.startsWith('video/') ? '▶' : '♪'}</span>
                    )}
                  </button>
                  <div className="rf-media__info">
                    <strong>{m.name}</strong>
                    <span className="rf-muted rf-small">
                      {m.folder && `${m.folder} · `}
                      {m.durationS !== null && `${formatDuration(m.durationS)} · `}
                      {m.width && m.height && `${m.width}×${m.height} · `}
                      {sizeFmt(m.size)}
                      {m.proxyStatus === 'pending' && ' · preparando vista previa…'}
                    </span>
                    <code className="rf-media__clip" title="Nombre del clip en CasparCG">
                      {m.clipName}
                    </code>
                  </div>
                  <div className="rf-form__actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void navigator.clipboard?.writeText(m.clipName)}
                    >
                      Copiar clip
                    </Button>
                    {canManage &&
                      m.mime.startsWith('video/') &&
                      casparWithMedia.map((d) => (
                        <Button
                          key={d.id}
                          size="sm"
                          onClick={async () => {
                            try {
                              const r = await api.post<{ clipName: string }>(
                                `/api/media/${m.id}/casparcg`,
                                { deviceId: d.id },
                              );
                              setNotice({
                                tone: 'success',
                                text: `En ${d.name} como ${r.clipName}.`,
                              });
                            } catch (err) {
                              setNotice({ tone: 'error', text: errorMessage(err) });
                            }
                          }}
                        >
                          A {d.name}
                        </Button>
                      ))}
                    {canManage && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEdit({ item: m, name: m.name, folder: m.folder })}
                      >
                        Editar
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {preview && (
        <Dialog open title={preview.name} onClose={() => setPreview(null)}>
          <div className="rf-media__preview">
            {preview.mime.startsWith('video/') ? (
              <VideoPreview
                src={`/api/media/${preview.id}/file${preview.proxyStatus === 'ready' ? '?proxy=1' : ''}`}
              />
            ) : preview.mime.startsWith('image/') ? (
              <img src={`/api/media/${preview.id}/file`} alt={preview.name} />
            ) : (
              <audio controls autoPlay src={`/api/media/${preview.id}/file`} />
            )}
            {preview.proxyStatus === 'ready' && <Badge>Vista previa ligera</Badge>}
          </div>
        </Dialog>
      )}

      {edit && (
        <Dialog
          open
          title="Editar"
          onClose={() => setEdit(null)}
          footer={
            <>
              <Button
                variant="danger"
                onClick={async () => {
                  await api.delete(`/api/media/${edit.item.id}`).catch(() => undefined);
                  setEdit(null);
                  void qc.invalidateQueries({ queryKey: mediaKey });
                }}
              >
                Borrar
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  try {
                    await api.patch(`/api/media/${edit.item.id}`, {
                      name: edit.name,
                      folder: edit.folder,
                    });
                    setEdit(null);
                    void qc.invalidateQueries({ queryKey: mediaKey });
                  } catch (err) {
                    setNotice({ tone: 'error', text: errorMessage(err) });
                  }
                }}
              >
                Guardar
              </Button>
            </>
          }
        >
          <TextField
            label="Nombre"
            value={edit.name}
            maxLength={120}
            onChange={(e) => setEdit({ ...edit, name: e.target.value })}
          />
          <TextField
            label="Carpeta"
            value={edit.folder}
            maxLength={120}
            onChange={(e) => setEdit({ ...edit, folder: e.target.value })}
          />
        </Dialog>
      )}
    </>
  );
}
