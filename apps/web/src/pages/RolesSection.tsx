import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ADMIN_ROLE_KEY, PERMISSIONS, type Permission, type RoleDetail } from '@runflow/core';
import { Alert, Badge, Button, Dialog, Spinner, TextField } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { t } from '../i18n';
import { useFormState } from '../lib/forms';

const ALL = Object.entries(PERMISSIONS) as [Permission, string][];

/** Roles y permisos de la empresa (PLAN §26): ver, crear y editar roles propios. */
export function RolesSection() {
  const qc = useQueryClient();
  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: async () => (await api.get<{ roles: RoleDetail[] }>('/api/roles')).roles,
  });
  const [editing, setEditing] = useState<RoleDetail | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="rf-card rf-section rf-roles">
      <div className="rf-page-header">
        <div>
          <h2 className="rf-section__title">Roles y permisos</h2>
          <p className="rf-muted rf-small">
            Cada rol es un conjunto de permisos. Los de serie se pueden ajustar; el de administrador
            no.
          </p>
        </div>
        <Button onClick={() => setEditing('new')}>+ Nuevo rol</Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {roles.isPending ? (
        <Spinner label={t('common.loading')} />
      ) : roles.isError ? (
        <Alert tone="error">{errorMessage(roles.error)}</Alert>
      ) : (
        <ul className="rf-sidelist__items">
          {roles.data.map((r) => (
            <li key={r.id}>
              <div>
                <strong>{r.name}</strong> {!r.isSystem && <Badge>Propio</Badge>}
                <span className="rf-muted rf-small"> · {r.permissions.length} permisos</span>
                {r.description && <div className="rf-muted rf-small">{r.description}</div>}
              </div>
              {r.key !== ADMIN_ROLE_KEY && (
                <span className="rf-sidelist__confirm">
                  <Button size="sm" onClick={() => setEditing(r)}>
                    {t('common.edit')}
                  </Button>
                  {!r.isSystem && (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        setError(null);
                        try {
                          await api.delete(`/api/roles/${r.id}`);
                          void qc.invalidateQueries({ queryKey: ['roles'] });
                        } catch (err) {
                          setError(errorMessage(err));
                        }
                      }}
                    >
                      {t('common.delete')}
                    </Button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <RoleDialog
          role={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void qc.invalidateQueries({ queryKey: ['roles'] });
            void qc.invalidateQueries({ queryKey: ['members'] });
          }}
        />
      )}
    </section>
  );
}

function RoleDialog({
  role,
  onClose,
  onSaved,
}: {
  role: RoleDetail | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [perms, setPerms] = useState<Set<Permission>>(
    new Set(role?.permissions ?? ['rundown.view']),
  );
  const form = useFormState();
  const toggle = (p: Permission) =>
    setPerms((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  return (
    <Dialog
      open
      title={role ? `Rol: ${role.name}` : 'Nuevo rol'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={form.submitting}
            onClick={async () => {
              if (!name.trim()) return form.setFieldErrors({ name: 'Obligatorio' });
              const body = { name, description, permissions: [...perms] };
              const ok = await form.submit(() =>
                role ? api.patch(`/api/roles/${role.id}`, body) : api.post('/api/roles', body),
              );
              if (ok) onSaved();
            }}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      {form.formError && <Alert tone="error">{form.formError}</Alert>}
      <TextField
        label="Nombre"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={form.fieldErrors.name}
      />
      <TextField
        label="Descripción"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <fieldset className="rf-perms">
        <legend className="rf-field__label">Permisos</legend>
        {ALL.map(([key, label]) => (
          <label key={key} className="rf-checkbox">
            <input type="checkbox" checked={perms.has(key)} onChange={() => toggle(key)} />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
    </Dialog>
  );
}
