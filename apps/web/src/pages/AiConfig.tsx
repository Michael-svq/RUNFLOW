import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AI_DEFAULT_MODEL,
  AI_FEATURES,
  AI_KIND_LABEL,
  AI_KINDS,
  type AiKind,
  type AiProviderDto,
  type AiUsageDto,
  type OrgSettings,
} from '@runflow/core';
import { Alert, Badge, Button, Spinner, TextField } from '@runflow/ui';
import { api, errorMessage } from '../api/client';

/*
 * Configuración → Inteligencia artificial (PLAN §18): proveedores con su
 * clave (cifrada en el servidor; nunca vuelve al navegador), límite mensual y
 * consumo.
 */

const providersKey = ['ai-providers'];
const usageKey = ['ai-usage'];

const BASE_HINT: Record<AiKind, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  mistral: 'https://api.mistral.ai/v1',
  ollama: 'http://127.0.0.1:11434',
};

interface Form {
  id: string | null;
  kind: AiKind;
  name: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  clearKey: boolean;
  hasKey: boolean;
  isDefault: boolean;
  enabled: boolean;
}

const emptyForm = (kind: AiKind): Form => ({
  id: null,
  kind,
  name: AI_KIND_LABEL[kind],
  model: AI_DEFAULT_MODEL[kind],
  baseUrl: '',
  apiKey: '',
  clearKey: false,
  hasKey: false,
  isDefault: false,
  enabled: true,
});

const featureLabel = (key: string) => AI_FEATURES.find((f) => f.key === key)?.label ?? key;
const nf = new Intl.NumberFormat('es-ES');

export function AiConfig({ settings }: { settings: OrgSettings }) {
  const qc = useQueryClient();
  const providers = useQuery({
    queryKey: providersKey,
    queryFn: async () =>
      (await api.get<{ providers: AiProviderDto[] }>('/api/ai/providers')).providers,
  });
  const usage = useQuery({
    queryKey: usageKey,
    queryFn: () => api.get<AiUsageDto>('/api/ai/usage'),
  });
  const [form, setForm] = useState<Form | null>(null);
  const [addKind, setAddKind] = useState<AiKind>('anthropic');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(
    null,
  );
  const [limit, setLimit] = useState(String(settings.aiMonthlyTokens));

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: providersKey });
    void qc.invalidateQueries({ queryKey: usageKey });
  };

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setNotice(null);
    try {
      const body = {
        kind: form.kind,
        name: form.name,
        model: form.model,
        baseUrl: form.baseUrl.trim(),
        isDefault: form.isDefault,
        enabled: form.enabled,
        // Sin tocar: se conserva la clave guardada.
        ...(form.clearKey ? { apiKey: '' } : form.apiKey ? { apiKey: form.apiKey } : {}),
      };
      if (form.id) await api.patch(`/api/ai/providers/${form.id}`, body);
      else await api.post('/api/ai/providers', body);
      setForm(null);
      refresh();
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function test(p: AiProviderDto) {
    setNotice({ tone: 'info', text: `Probando ${p.name}…` });
    try {
      const res = await api.post<{ ok: boolean; model?: string; error?: string }>(
        `/api/ai/providers/${p.id}/test`,
      );
      setNotice(
        res.ok
          ? { tone: 'success', text: `${p.name} responde (${res.model}).` }
          : { tone: 'error', text: `${p.name}: ${res.error}` },
      );
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err) });
    }
  }

  async function saveLimit() {
    try {
      await api.patch('/api/org/settings', { aiMonthlyTokens: Math.max(0, Number(limit) || 0) });
      void qc.invalidateQueries({ queryKey: ['org-settings'] });
      void qc.invalidateQueries({ queryKey: usageKey });
      setNotice({ tone: 'success', text: 'Límite guardado.' });
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err) });
    }
  }

  const needsKey = form && form.kind !== 'ollama';
  return (
    <section className="rf-card rf-config">
      <div className="rf-config__head">
        <h2 className="rf-form__title">Inteligencia artificial</h2>
        {!form && (
          <span className="rf-config__add">
            <select
              className="rf-select"
              aria-label="Proveedor de IA"
              value={addKind}
              onChange={(e) => setAddKind(e.target.value as AiKind)}
            >
              {AI_KINDS.map((k) => (
                <option key={k} value={k}>
                  {AI_KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={() => setForm(emptyForm(addKind))}>
              Añadir proveedor
            </Button>
          </span>
        )}
      </div>
      <p className="rf-muted rf-small">
        Ayuda en la redacción: corregir, escribir el paso o el off, ajustar a una duración, resumir
        teletipos, sugerir rótulos y traducir. Las llamadas salen del servidor con la clave de la
        empresa; con Ollama todo queda en vuestra red.
      </p>

      {providers.isPending ? (
        <Spinner label="Cargando…" />
      ) : providers.isError ? (
        <Alert tone="error">{errorMessage(providers.error)}</Alert>
      ) : providers.data.length === 0 && !form ? (
        <p className="rf-muted">Todavía no hay proveedores de IA.</p>
      ) : (
        <ul className="rf-sidelist__items">
          {providers.data.map((p) => (
            <li key={p.id}>
              <div>
                <strong>{p.name}</strong> <Badge>{AI_KIND_LABEL[p.kind]}</Badge>{' '}
                {p.isDefault && <Badge tone="accent">Predeterminado</Badge>}{' '}
                {!p.enabled && <Badge tone="muted">Desactivado</Badge>}
                <span className="rf-muted rf-small">
                  {' '}
                  {p.model}
                  {p.kind !== 'ollama' && (p.hasKey ? ' · clave guardada' : ' · sin clave')}
                </span>
              </div>
              <span className="rf-sidelist__confirm">
                <Button size="sm" variant="ghost" onClick={() => void test(p)}>
                  Probar
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    setForm({
                      ...emptyForm(p.kind),
                      id: p.id,
                      name: p.name,
                      model: p.model,
                      baseUrl: p.baseUrl,
                      hasKey: p.hasKey,
                      isDefault: p.isDefault,
                      enabled: p.enabled,
                    })
                  }
                >
                  Editar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await api.delete(`/api/ai/providers/${p.id}`).catch(() => undefined);
                    refresh();
                  }}
                >
                  Quitar
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {form && (
        <form
          className="rf-config__device"
          onSubmit={onSave}
          aria-label={`Proveedor ${AI_KIND_LABEL[form.kind]}`}
        >
          <TextField
            label="Nombre"
            required
            maxLength={60}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <TextField
            label="Modelo"
            required
            maxLength={120}
            value={form.model}
            placeholder={form.kind === 'ollama' ? 'p. ej. el modelo que tengáis instalado' : ''}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
          />
          <TextField
            label="Dirección (opcional)"
            value={form.baseUrl}
            placeholder={BASE_HINT[form.kind]}
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
          />
          {needsKey && (
            <TextField
              label="Clave de la API"
              type="password"
              autoComplete="off"
              value={form.apiKey}
              placeholder={form.hasKey ? 'Guardada · escribe otra para cambiarla' : ''}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value, clearKey: false })}
            />
          )}
          {needsKey && form.hasKey && (
            <label className="rf-check">
              <input
                type="checkbox"
                checked={form.clearKey}
                onChange={(e) => setForm({ ...form, clearKey: e.target.checked, apiKey: '' })}
              />
              <span>Borrar la clave guardada</span>
            </label>
          )}
          <label className="rf-check">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
            />
            <span>Proveedor predeterminado</span>
          </label>
          <label className="rf-check">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            <span>Activado</span>
          </label>
          <div className="rf-form__actions">
            <Button type="submit" variant="primary" loading={busy}>
              Guardar proveedor
            </Button>
            <Button type="button" variant="ghost" onClick={() => setForm(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <div className="rf-config__usage">
        <div className="rf-config__limit">
          <TextField
            label="Límite mensual de la empresa (tokens; 0 = sin límite)"
            type="number"
            min={0}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
          <Button onClick={() => void saveLimit()}>Guardar límite</Button>
        </div>
        {usage.data && (
          <div>
            <p className="rf-small">
              Consumo de {usage.data.month}: <strong>{nf.format(usage.data.totalTokens)}</strong>{' '}
              tokens
              {usage.data.limit > 0 && ` de ${nf.format(usage.data.limit)}`}
            </p>
            {usage.data.byFeature.length > 0 && (
              <table className="rf-table rf-table--compact">
                <thead>
                  <tr>
                    <th>Función</th>
                    <th>Peticiones</th>
                    <th>Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.data.byFeature.map((f) => (
                    <tr key={f.feature}>
                      <td>{featureLabel(f.feature)}</td>
                      <td className="rf-tabular">{f.requests}</td>
                      <td className="rf-tabular">{nf.format(f.tokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
