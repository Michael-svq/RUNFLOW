import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createOrgInput, PLANS, type PlatformOrgDto } from '@runflow/core';
import { Alert, Badge, Button, Dialog, Spinner, TextField } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { formatDate, t } from '../i18n';
import { useFormState, validate } from '../lib/forms';

const orgsKey = ['platform-orgs'] as const;

export function PlatformPage() {
  const qc = useQueryClient();
  const orgs = useQuery({
    queryKey: orgsKey,
    queryFn: async () =>
      (await api.get<{ organizations: PlatformOrgDto[] }>('/api/platform/orgs')).organizations,
  });
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title={t('platform.title')}
        intro={t('platform.intro')}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            + {t('platform.new')}
          </Button>
        }
      />
      {notice && (
        <div className="rf-notice">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      {orgs.isPending ? (
        <div className="rf-center">
          <Spinner label={t('common.loading')} />
        </div>
      ) : orgs.isError ? (
        <Alert tone="error">{errorMessage(orgs.error)}</Alert>
      ) : (
        <div className="rf-table-wrap">
          <table className="rf-table">
            <thead>
              <tr>
                <th>{t('platform.col.name')}</th>
                <th>{t('platform.col.plan')}</th>
                <th>{t('platform.col.mode')}</th>
                <th>{t('platform.col.members')}</th>
                <th>{t('platform.col.created')}</th>
              </tr>
            </thead>
            <tbody>
              {orgs.data.map((o) => (
                <tr key={o.id}>
                  <td>
                    <strong>{o.name}</strong>
                    <div className="rf-muted rf-small">{o.slug}</div>
                  </td>
                  <td>
                    <select
                      className="rf-select"
                      aria-label={`Plan de ${o.name}`}
                      value={o.plan}
                      onChange={async (e) => {
                        await api
                          .patch(`/api/platform/orgs/${o.id}/plan`, { plan: e.target.value })
                          .catch(() => undefined);
                        void qc.invalidateQueries({ queryKey: orgsKey });
                      }}
                    >
                      {PLANS.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <Badge>{o.mode}</Badge>
                  </td>
                  <td className="rf-tabular">{o.members}</td>
                  <td className="rf-muted">{formatDate(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && (
        <CreateOrgDialog
          onClose={() => setCreating(false)}
          onCreated={(name, existing) => {
            setCreating(false);
            setNotice(t(existing ? 'platform.createdExisting' : 'platform.created', { name }));
            void qc.invalidateQueries({ queryKey: orgsKey });
          }}
        />
      )}
    </>
  );
}

function CreateOrgDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (name: string, existingAccount: boolean) => void;
}) {
  const [values, setValues] = useState({
    orgName: '',
    adminName: '',
    adminEmail: '',
    adminPassword: '',
  });
  const form = useFormState();
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const { data, errors } = validate(createOrgInput, {
      ...values,
      adminPassword: values.adminPassword || undefined,
    });
    if (!data) return form.setFieldErrors(errors);
    const res = await form.submit(() =>
      api.post<{ existingAccount: boolean }>('/api/platform/orgs', data),
    );
    if (res) onCreated(data.orgName, res.existingAccount);
  }

  return (
    <Dialog
      open
      title={t('platform.new')}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" form="create-org" loading={form.submitting}>
            {t('common.create')}
          </Button>
        </>
      }
    >
      <form id="create-org" className="rf-form" onSubmit={onSubmit} noValidate>
        {form.formError && <Alert tone="error">{form.formError}</Alert>}
        <TextField
          label={t('platform.orgName')}
          value={values.orgName}
          onChange={set('orgName')}
          error={form.fieldErrors.orgName}
          autoFocus
        />
        <TextField
          label={t('platform.adminName')}
          value={values.adminName}
          onChange={set('adminName')}
          error={form.fieldErrors.adminName}
        />
        <TextField
          label={t('platform.adminEmail')}
          type="email"
          value={values.adminEmail}
          onChange={set('adminEmail')}
          error={form.fieldErrors.adminEmail}
          autoComplete="off"
        />
        <TextField
          label={t('platform.adminPassword')}
          type="password"
          value={values.adminPassword}
          onChange={set('adminPassword')}
          error={form.fieldErrors.adminPassword}
          hint={t('platform.adminPasswordHint')}
          autoComplete="new-password"
        />
      </form>
    </Dialog>
  );
}
