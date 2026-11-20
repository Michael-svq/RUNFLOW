import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Editor } from '@tiptap/react';
import { AI_FEATURES, type AiFeature, type AiProviderDto, type AiRunResult } from '@runflow/core';
import type { LineSnapshot, ScriptSummary } from '@runflow/sync';
import { Alert, Button, Dialog, SelectField, Spinner, TextField } from '@runflow/ui';
import { api, errorMessage } from '../api/client';

/*
 * Asistencia de IA en el guion (PLAN §18). La propuesta se revisa antes de
 * aplicarla: nada se escribe en el guion sin que la persona lo decida.
 */

interface Props {
  editor: Editor;
  line: LineSnapshot;
  summary: ScriptSummary;
  /** Texto seleccionado al abrir (y su posición en el editor). */
  selection: { from: number; to: number; text: string } | null;
  onClose: () => void;
}

function sourceFor(feature: AiFeature, summary: ScriptSummary, selection: Props['selection']) {
  if (selection?.text.trim()) return selection.text;
  const paso = summary.paso.join('\n');
  const off = summary.off.join('\n');
  switch (feature) {
    case 'paso_desde_off':
      return off;
    case 'off_desde_paso':
    case 'ajustar':
      return paso;
    case 'teletipo':
      return '';
    default:
      return [paso, off].filter(Boolean).join('\n\n');
  }
}

export function AiDialog({ editor, line, summary, selection, onClose }: Props) {
  const providers = useQuery({
    queryKey: ['ai-providers'],
    queryFn: async () =>
      (await api.get<{ providers: AiProviderDto[] }>('/api/ai/providers')).providers.filter(
        (p) => p.enabled,
      ),
  });
  const [feature, setFeature] = useState<AiFeature>(selection ? 'corregir' : 'paso_desde_off');
  const [text, setText] = useState(() => sourceFor(feature, summary, selection));
  const [seconds, setSeconds] = useState(
    String(typeof line.cells.t_est === 'number' && line.cells.t_est > 0 ? line.cells.t_est : 20),
  );
  const [language, setLanguage] = useState('inglés');
  const [providerId, setProviderId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiRunResult | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const defaultProvider = useMemo(
    () => providers.data?.find((p) => p.isDefault) ?? providers.data?.[0],
    [providers.data],
  );

  const changeFeature = (f: AiFeature) => {
    setFeature(f);
    setText(sourceFor(f, summary, selection));
    setResult(null);
    setError(null);
  };

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post<AiRunResult>('/api/ai/run', {
        feature,
        text,
        ...(providerId ? { providerId } : {}),
        options: {
          ...(feature === 'ajustar' ? { seconds: Number(seconds) || 20 } : {}),
          ...(feature === 'traducir' ? { language } : {}),
        },
      });
      setResult(res);
      if (res.output.kind === 'graphics') {
        setPicked(new Set(res.output.graphics.map((_, i) => i)));
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const paragraphs = (kind: string, value: string) =>
    value
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => ({ type: 'paragraph', attrs: { kind }, content: [{ type: 'text', text: p }] }));

  const insert = (content: object[], atStart = false) => {
    const pos = atStart ? 0 : editor.state.doc.content.size;
    editor.chain().insertContentAt(pos, content).run();
    onClose();
  };

  const output = result?.output;
  return (
    <Dialog
      open
      title="Asistente de IA"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!text.trim()}
            onClick={() => void run()}
          >
            {result ? 'Volver a pedir' : 'Pedir propuesta'}
          </Button>
        </>
      }
    >
      {providers.isPending ? (
        <Spinner label="Cargando…" />
      ) : !providers.data?.length ? (
        <Alert tone="info">
          No hay ningún proveedor de IA activo. Quien administra la empresa lo configura en 10
          Configuración (Anthropic, OpenAI, Gemini, Mistral u Ollama en local).
        </Alert>
      ) : (
        <div className="rf-ai">
          <div className="rf-ai__row">
            <SelectField
              label="Qué quieres hacer"
              value={feature}
              options={AI_FEATURES.map((f) => ({ value: f.key, label: f.label }))}
              onChange={(e) => changeFeature(e.target.value as AiFeature)}
            />
            {providers.data.length > 1 && (
              <SelectField
                label="Proveedor"
                value={providerId || defaultProvider?.id || ''}
                options={providers.data.map((p) => ({
                  value: p.id,
                  label: `${p.name} · ${p.model}`,
                }))}
                onChange={(e) => setProviderId(e.target.value)}
              />
            )}
            {feature === 'ajustar' && (
              <TextField
                label="Duración (segundos)"
                type="number"
                min={3}
                max={3600}
                value={seconds}
                onChange={(e) => setSeconds(e.target.value)}
              />
            )}
            {feature === 'traducir' && (
              <TextField
                label="Idioma"
                value={language}
                maxLength={40}
                onChange={(e) => setLanguage(e.target.value)}
              />
            )}
          </div>
          <label className="rf-field">
            <span className="rf-field__label">
              {feature === 'teletipo' ? 'Pega aquí el teletipo' : 'Texto'}
              {selection?.text.trim() && feature !== 'teletipo' && ' (selección)'}
            </span>
            <textarea
              className="rf-input rf-textarea rf-ai__source"
              rows={6}
              value={text}
              maxLength={20_000}
              onChange={(e) => setText(e.target.value)}
              aria-label="Texto para la IA"
            />
          </label>
          {error && <Alert tone="error">{error}</Alert>}
          {busy && <Spinner label="Pensando…" />}
          {output && result && (
            <section className="rf-ai__result" aria-label="Propuesta de la IA">
              <p className="rf-muted rf-small">
                Propuesta de {result.provider.name} ({result.provider.model}) ·{' '}
                {result.usage.inputTokens + result.usage.outputTokens} tokens. Revísala antes de
                usarla.
              </p>
              {output.kind === 'text' && (
                <>
                  <div className="rf-ai__text">{output.text}</div>
                  <div className="rf-form__actions">
                    {selection?.text.trim() && (
                      <Button
                        variant="primary"
                        onClick={() => {
                          editor
                            .chain()
                            .insertContentAt(
                              { from: selection.from, to: selection.to },
                              output.text,
                            )
                            .run();
                          onClose();
                        }}
                      >
                        Sustituir la selección
                      </Button>
                    )}
                    <Button
                      onClick={() =>
                        insert(paragraphs('paso', output.text), feature === 'paso_desde_off')
                      }
                    >
                      Añadir como paso
                    </Button>
                    <Button onClick={() => insert(paragraphs('off', output.text))}>
                      Añadir como off
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => void navigator.clipboard?.writeText(output.text)}
                    >
                      Copiar
                    </Button>
                  </div>
                </>
              )}
              {output.kind === 'script' && (
                <>
                  <div className="rf-ai__text">
                    <p className="rf-script-paso">{output.paso}</p>
                    <p className="rf-script-off">{output.off}</p>
                  </div>
                  <div className="rf-form__actions">
                    <Button
                      variant="primary"
                      onClick={() =>
                        insert([
                          ...paragraphs('paso', output.paso),
                          ...paragraphs('off', output.off),
                        ])
                      }
                    >
                      Añadir paso y off al guion
                    </Button>
                  </div>
                </>
              )}
              {output.kind === 'graphics' &&
                (output.graphics.length === 0 ? (
                  <p>No se han encontrado personas ni lugares para rotular.</p>
                ) : (
                  <>
                    <ul className="rf-ai__graphics">
                      {output.graphics.map((g, i) => (
                        <li key={i}>
                          <label className="rf-check">
                            <input
                              type="checkbox"
                              checked={picked.has(i)}
                              onChange={(e) => {
                                const next = new Set(picked);
                                if (e.target.checked) next.add(i);
                                else next.delete(i);
                                setPicked(next);
                              }}
                            />
                            <span>
                              <strong>{g.type}</strong> {g.f0}
                              {g.f1 && ` // ${g.f1}`}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <div className="rf-form__actions">
                      <Button
                        variant="primary"
                        disabled={!picked.size}
                        onClick={() =>
                          insert(
                            output.graphics
                              .filter((_, i) => picked.has(i))
                              .map((g) => ({
                                type: 'rotulo',
                                attrs: {
                                  id: crypto.randomUUID(),
                                  type: g.type,
                                  f0: g.f0,
                                  f1: g.f1,
                                  f2: '',
                                  f3: '',
                                  tcIn: '',
                                  tcOut: '',
                                },
                              })),
                          )
                        }
                      >
                        Añadir {picked.size} rótulos
                      </Button>
                    </div>
                  </>
                ))}
            </section>
          )}
        </div>
      )}
    </Dialog>
  );
}
