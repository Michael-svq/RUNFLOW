import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createUserInput,
  resetPasswordInput,
  updateUserInput,
  type CreateMemberResponse,
  type MemberDto,
  type RoleDetail,
} from '@runflow/core';
import { Alert, Badge, Button, Dialog, SelectField, Spinner, TextField } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { useSession } from '../auth/session';
import { PageHeader } from '../components/PageHeader';
import { formatDateTime, t } from '../i18n';
import { useFormState, validate } from '../lib/forms';
import { RolesSection } from './RolesSection';

const membersKey = ['members'] as const;
const rolesKey = ['roles'] as const;

function useRoles() {
  return useQuery({
    queryKey: rolesKey,
    queryFn: async () => (await api.get<{ roles: RoleDetail[] }>('/api/roles')).roles,
    staleTime: 5 * 60_000,
  });
}

function roleOptions(roles: RoleDetail[] | undefined) {
  return (roles ?? []).map((r) => ({ value: r.id, label: r.name }));
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

type DialogState =
  | { kind: 'create' }
  | { kind: 'edit'; member: MemberDto }
  | { kind: 'password'; member: MemberDto }
  | { kind: 'delete'; member: MemberDto }
  | null;

export function UsersPage() {
  const { me } = useSession();
  const qc = useQueryClient();
  const members = useQuery({
    queryKey: membersKey,
    queryFn: async () => (await api.get<{ members: MemberDto[] }>('/api/users')).members,
  });
  const roles = useRoles();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'info' | 'error'; text: string } | null>(
    null,
  );

  const toggleActive = useMutation({
    mutationFn: (m: MemberDto) => api.patch(`/api/users/${m.userId}`, { active: !m.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: membersKey }),
    onError: (err) => setNotice({ tone: 'error', text: errorMessage(err) }),
  });

  const close = () => setDialog(null);
  const done = (tone: 'success' | 'info', text: string) => {
    setNotice({ tone, text });
    setDialog(null);
    void qc.invalidateQueries({ queryKey: membersKey });
  };

  return (
    <>
      <PageHeader
        number="07"
        title={t('users.title')}
        intro={t('users.intro')}
        actions={
          <Button variant="primary" onClick={() => setDialog({ kind: 'create' })}>
            + {t('users.new')}
          </Button>
        }
      />

      {notice && (
        <div className="rf-notice">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}

      {members.isPending ? (
        <div className="rf-center">
          <Spinner label={t('common.loading')} />
        </div>
      ) : members.isError ? (
        <Alert tone="error">{errorMessage(members.error)}</Alert>
      ) : members.data.length === 0 ? (
        <div className="rf-card rf-empty">{t('users.empty')}</div>
      ) : (
        <div className="rf-table-wrap">
          <table className="rf-table rf-users-table">
            <thead>
              <tr>
                <th>{t('users.col.name')}</th>
                <th>{t('users.col.role')}</th>
                <th>{t('users.col.status')}</th>
                <th>{t('users.col.lastLogin')}</th>
                <th className="rf-table__actions">
                  <span className="rf-visually-hidden">{t('users.col.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.data.map((m) => {
                const isSelf = m.userId === me.user.id;
                return (
                  <tr key={m.userId} className={m.active ? undefined : 'is-inactive'}>
                    <td>
                      <div className="rf-person">
                        <span className="rf-avatar" aria-hidden="true">
                          {initials(m.name)}
                        </span>
                        <span className="rf-person__text">
                          <span className="rf-person__name">
                            {m.name}
                            {isSelf && <span className="rf-muted"> ({t('common.you')})</span>}
                          </span>
                          <span className="rf-person__email">{m.email}</span>
                        </span>
                      </div>
                    </td>
                    <td>{m.role.name}</td>
                    <td>
                      <span className="rf-badges">
                        <Badge tone={m.active ? 'success' : 'muted'}>
                          {m.active ? t('users.active') : t('users.inactive')}
                        </Badge>
                        {m.sharedAccount && (
                          <Badge title={t('users.sharedHint')}>{t('users.shared')}</Badge>
                        )}
                      </span>
                    </td>
                    <td className="rf-tabular rf-muted">{formatDateTime(m.lastLoginAt)}</td>
                    <td className="rf-table__actions">
                      <div className="rf-row-actions">
                        <Button size="sm" onClick={() => setDialog({ kind: 'edit', member: m })}>
                          {t('common.edit')}
                        </Button>
                        <Button
                          size="sm"
                          disabled={isSelf || toggleActive.isPending}
                          onClick={() => toggleActive.mutate(m)}
                        >
                          {m.active ? t('users.deactivate') : t('users.activate')}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={isSelf}
                          onClick={() => setDialog({ kind: 'delete', member: m })}
                        >
                          {t('common.delete')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="rf-notice-gap" />
      <RolesSection />

      {dialog?.kind === 'create' && (
        <CreateUserDialog
          roles={roles.data}
          onClose={close}
          onCreated={(r) =>
            done(
              r.existingAccount ? 'info' : 'success',
              r.existingAccount
                ? t('users.createdExisting', { email: r.member.email })
                : t('users.created', { name: r.member.name }),
            )
          }
        />
      )}
      {dialog?.kind === 'edit' && (
        <EditUserDialog
          member={dialog.member}
          isSelf={dialog.member.userId === me.user.id}
          roles={roles.data}
          onClose={close}
          onSaved={() => done('success', t('profile.saved'))}
          onResetPassword={() => setDialog({ kind: 'password', member: dialog.member })}
        />
      )}
      {dialog?.kind === 'password' && (
        <ResetPasswordDialog
          member={dialog.member}
          onClose={close}
          onDone={() => done('success', t('users.resetDone'))}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteUserDialog
          member={dialog.member}
          onClose={close}
          onDeleted={() => done('success', t('users.deleted', { name: dialog.member.name }))}
        />
      )}
    </>
  );
}

function CreateUserDialog({
  roles,
  onClose,
  onCreated,
}: {
  roles: RoleDetail[] | undefined;
  onClose: () => void;
  onCreated: (r: CreateMemberResponse) => void;
}) {
  const [values, setValues] = useState({ name: '', email: '', roleId: '', password: '' });
  const form = useFormState();
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const input = { ...values, password: values.password || undefined };
    const { data, errors } = validate(createUserInput, input);
    if (!data) return form.setFieldErrors(errors);
    const res = await form.submit(() => api.post<CreateMemberResponse>('/api/users', data));
    if (res) onCreated(res);
  }

  return (
    <Dialog
      open
      title={t('users.new')}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" form="create-user" loading={form.submitting}>
            {t('common.create')}
          </Button>
        </>
      }
    >
      <form id="create-user" className="rf-form" onSubmit={onSubmit} noValidate>
        {form.formError && <Alert tone="error">{form.formError}</Alert>}
        <TextField
          label={t('users.name')}
          value={values.name}
          onChange={set('name')}
          error={form.fieldErrors.name}
          autoFocus
        />
        <TextField
          label={t('users.email')}
          type="email"
          value={values.email}
          onChange={set('email')}
          error={form.fieldErrors.email}
          autoComplete="off"
        />
        <SelectField
          label={t('users.role')}
          value={values.roleId}
          onChange={set('roleId')}
          options={roleOptions(roles)}
          placeholder={t('users.rolePlaceholder')}
          error={form.fieldErrors.roleId}
        />
        <TextField
          label={t('users.initialPassword')}
          type="password"
          value={values.password}
          onChange={set('password')}
          error={form.fieldErrors.password}
          hint={t('users.initialPasswordHint')}
          autoComplete="new-password"
        />
      </form>
    </Dialog>
  );
}

function EditUserDialog({
  member,
  isSelf,
  roles,
  onClose,
  onSaved,
  onResetPassword,
}: {
  member: MemberDto;
  isSelf: boolean;
  roles: RoleDetail[] | undefined;
  onClose: () => void;
  onSaved: () => void;
  onResetPassword: () => void;
}) {
  const [name, setName] = useState(member.name);
  const [roleId, setRoleId] = useState(member.role.id);
  const form = useFormState();
  const nameLocked = member.sharedAccount && !isSelf;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const changes: Record<string, string> = {};
    if (name !== member.name) changes.name = name;
    if (roleId !== member.role.id) changes.roleId = roleId;
    if (Object.keys(changes).length === 0) return onClose();
    const { data, errors } = validate(updateUserInput, changes);
    if (!data) return form.setFieldErrors(errors);
    const res = await form.submit(() => api.patch(`/api/users/${member.userId}`, data));
    if (res) onSaved();
  }

  return (
    <Dialog
      open
      title={t('users.editTitle')}
      onClose={onClose}
      footer={
        <>
          {!isSelf && !member.sharedAccount && (
            <Button variant="ghost" onClick={onResetPassword} className="rf-dialog__left">
              {t('users.resetPassword')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" form="edit-user" loading={form.submitting}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="edit-user" className="rf-form" onSubmit={onSubmit} noValidate>
        {form.formError && <Alert tone="error">{form.formError}</Alert>}
        {nameLocked && <Alert tone="info">{t('users.sharedNotice')}</Alert>}
        <TextField
          label={t('users.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={form.fieldErrors.name}
          disabled={nameLocked}
        />
        <TextField label={t('users.email')} value={member.email} disabled readOnly />
        <SelectField
          label={t('users.role')}
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
          options={roleOptions(roles)}
          error={form.fieldErrors.roleId}
          disabled={isSelf}
        />
      </form>
    </Dialog>
  );
}

function ResetPasswordDialog({
  member,
  onClose,
  onDone,
}: {
  member: MemberDto;
  onClose: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState('');
  const form = useFormState();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const { data, errors } = validate(resetPasswordInput, { password });
    if (!data) return form.setFieldErrors(errors);
    const res = await form.submit(() => api.post(`/api/users/${member.userId}/password`, data));
    if (res) onDone();
  }

  return (
    <Dialog
      open
      title={t('users.resetPasswordTitle', { name: member.name })}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" form="reset-password" loading={form.submitting}>
            {t('users.resetPassword')}
          </Button>
        </>
      }
    >
      <form id="reset-password" className="rf-form" onSubmit={onSubmit} noValidate>
        {form.formError && <Alert tone="error">{form.formError}</Alert>}
        <TextField
          label={t('changePassword.new')}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={form.fieldErrors.password}
          hint={t('users.resetPasswordHint')}
          autoComplete="new-password"
          autoFocus
        />
      </form>
    </Dialog>
  );
}

function DeleteUserDialog({
  member,
  onClose,
  onDeleted,
}: {
  member: MemberDto;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const form = useFormState();
  return (
    <Dialog
      open
      title={t('users.deleteTitle')}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={form.submitting}
            onClick={async () => {
              const res = await form.submit(() => api.delete(`/api/users/${member.userId}`));
              if (res) onDeleted();
            }}
          >
            {t('common.delete')}
          </Button>
        </>
      }
    >
      {form.formError && <Alert tone="error">{form.formError}</Alert>}
      <p>{t('users.deleteBody', { name: member.name })}</p>
    </Dialog>
  );
}
