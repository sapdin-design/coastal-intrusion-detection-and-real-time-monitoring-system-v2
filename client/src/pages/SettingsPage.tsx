import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Activity,
  Bell,
  Cpu,
  Database,
  HardDrive,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  UserCog,
  Volume2,
} from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { ROLE_LABELS } from '@/lib/constants';
import { cn, formatNumber, formatUptime, timeAgo } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { useRealtime } from '@/store/realtime';
import { useToast } from '@/store/toast';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  Field,
  Input,
  Modal,
  Select,
  StatCard,
  Toggle,
  type Column,
} from '@/components/ui';
import type { PublicUser } from '@/types';

const userFormSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(80),
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Use at least 8 characters').optional().or(z.literal('')),
  role: z.enum(['ADMIN', 'OPERATOR', 'ANALYST']),
  active: z.boolean(),
});

type UserFormValues = z.infer<typeof userFormSchema>;

/**
 * Settings (spec §6.2 — supporting page).
 *
 * Three concerns kept visually separate: the signed-in operator's own session, the
 * account directory (administrators only) and the system/data controls. The health
 * panel polls the backend directly so it reports the *server's* view, not the
 * browser's cached one.
 */
export function SettingsPage() {
  const { user, isAdmin, logout } = useAuth();
  const { soundEnabled, setSoundEnabled, connection, sessionIntrusions, stats } = useRealtime();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<PublicUser | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PublicUser | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [busy, setBusy] = useState(false);

  const health = useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    refetchInterval: 10_000,
  });

  const users = useQuery({
    queryKey: ['users'],
    queryFn: api.users.list,
    enabled: isAdmin,
  });

  const deleteUser = useMutation({
    mutationFn: (target: PublicUser) => api.users.remove(target._id),
    onSuccess: () => {
      toast.success('Account removed');
      setPendingDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => toast.error('Delete failed', (error as Error).message),
  });

  const purgeHistory = async () => {
    setBusy(true);
    try {
      await api.simulation.reset(true);
      toast.success('Detection history purged', 'Alerts and incidents have been cleared.');
      setConfirmPurge(false);
      await queryClient.invalidateQueries();
    } catch (error) {
      toast.error('Purge failed', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const columns: Array<Column<PublicUser>> = [
    {
      key: 'name',
      header: 'Name',
      sortValue: (row) => row.name,
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-700">
            {row.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-slate-800">{row.name}</p>
            <p className="truncate text-[11px] text-slate-400">{row.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      width: '170px',
      sortValue: (row) => row.role,
      render: (row) => (
        <Badge className="bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200">
          {ROLE_LABELS[row.role]}
        </Badge>
      ),
    },
    {
      key: 'active',
      header: 'State',
      width: '110px',
      align: 'center',
      sortValue: (row) => (row.active ? 1 : 0),
      render: (row) => (
        <Badge
          className={
            row.active
              ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
              : 'bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200'
          }
        >
          {row.active ? 'Active' : 'Disabled'}
        </Badge>
      ),
    },
    {
      key: 'lastLoginAt',
      header: 'Last sign-in',
      width: '140px',
      align: 'right',
      sortValue: (row) => row.lastLoginAt ?? '',
      render: (row) => <span className="text-[11px] text-slate-500">{timeAgo(row.lastLoginAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      width: '80px',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button
            size="xs"
            variant="ghost"
            icon={<UserCog className="h-3 w-3" />}
            onClick={() => {
              setEditingUser(row);
              setUserModalOpen(true);
            }}
          />
          <Button
            size="xs"
            variant="ghost"
            className="text-rose-600 hover:bg-rose-50"
            icon={<Trash2 className="h-3 w-3" />}
            disabled={row._id === user?._id}
            onClick={() => setPendingDelete(row)}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4 p-4">
      {/* ══ Session + preferences ═══════════════════════════════════════ */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Your session" subtitle="Authenticated identity and access scope" icon={<ShieldCheck className="h-4 w-4" />} />
          <div className="grid gap-px bg-slate-200 sm:grid-cols-3">
            <Cell label="Name" value={user?.name ?? '—'} hint={user?.email ?? ''} />
            <Cell label="Role" value={user ? ROLE_LABELS[user.role] : '—'} hint={user?.role ?? ''} />
            <Cell
              label="Last sign-in"
              value={user?.lastLoginAt ? timeAgo(user.lastLoginAt) : '—'}
              hint="JWT session, 12 hour expiry"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
            <div className="flex items-center gap-3 text-[11px] text-slate-500">
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'h-2 w-2 rounded-full',
                    connection === 'connected' ? 'bg-emerald-500' : 'bg-amber-500',
                  )}
                />
                Realtime {connection}
              </span>
              <span className="h-3 w-px bg-slate-200" />
              <span>{formatNumber(sessionIntrusions)} intrusions observed this session</span>
            </div>
            <Button variant="secondary" size="sm" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Notifications" subtitle="Alerting behaviour in this browser" icon={<Bell className="h-4 w-4" />} />
          <div className="space-y-4 p-4">
            <Toggle
              checked={soundEnabled}
              onChange={setSoundEnabled}
              label="Audible intrusion alarm"
              description="Plays a two-tone chime when the engine confirms an unauthorized entry."
            />
            <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <Volume2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
              <p className="text-[11px] leading-relaxed text-slate-500">
                The alarm is synthesised in the browser, so no audio asset is downloaded. Browsers may block
                it until you have interacted with the page — signing in counts as that interaction.
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* ══ System status ═══════════════════════════════════════════════ */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="API health"
          value={health.data?.status ?? '—'}
          hint={health.data ? `${health.data.environment} · v${health.data.version}` : 'Checking…'}
          icon={<Server className="h-4 w-4" />}
          tone={health.data?.status === 'ok' ? 'positive' : 'danger'}
        />
        <StatCard
          label="Data driver"
          value={health.data?.driver ?? '—'}
          hint="MongoDB when MONGODB_URI is set"
          icon={<Database className="h-4 w-4" />}
        />
        <StatCard
          label="Uptime"
          value={health.data ? formatUptime(health.data.uptimeSeconds) : '—'}
          hint="Backend process"
          icon={<Activity className="h-4 w-4" />}
        />
        <StatCard
          label="Geofence pairs"
          value={formatNumber(health.data?.geofencePairs ?? 0)}
          hint="Cached vessel × zone episodes"
          icon={<Cpu className="h-4 w-4" />}
        />
      </div>

      {/* ══ Account directory ══════════════════════════════════════════ */}
      {isAdmin ? (
        <Card>
          <CardHeader
            title="Account directory"
            subtitle="Role-based access control — Administrators manage everything, Operators action incidents, Analysts are read-only"
            icon={<UserCog className="h-4 w-4" />}
            action={
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RefreshCw className="h-3.5 w-3.5" />}
                  onClick={() => void users.refetch()}
                />
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => {
                    setEditingUser(null);
                    setUserModalOpen(true);
                  }}
                >
                  Add account
                </Button>
              </div>
            }
          />
          <DataTable
            columns={columns}
            rows={users.data ?? []}
            rowKey={(row) => row._id}
            loading={users.isLoading}
            initialSortKey="name"
            initialSortDir="asc"
            emptyTitle="No accounts"
          />
        </Card>
      ) : (
        <Card>
          <CardHeader title="Account directory" subtitle="Administrator access required" icon={<UserCog className="h-4 w-4" />} />
          <p className="px-4 py-6 text-center text-xs text-slate-500">
            Your role is <span className="font-semibold">{user?.role}</span>. Only Administrators can view or
            modify the account directory.
          </p>
        </Card>
      )}

      {/* ══ Data controls ══════════════════════════════════════════════ */}
      <Card>
        <CardHeader
          title="Data & maintenance"
          subtitle="Operational controls over the detection history"
          icon={<HardDrive className="h-4 w-4" />}
        />
        <div className="divide-y divide-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
            <div>
              <p className="text-[13px] font-medium text-slate-800">Reset simulator positions</p>
              <p className="text-[11px] text-slate-500">
                Repositions every simulated vessel and clears the geofence state cache. Alerts and incidents are
                kept.
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={!isAdmin}
              onClick={async () => {
                try {
                  await api.simulation.reset(false);
                  toast.success('Simulation reset');
                } catch (error) {
                  toast.error('Reset failed', (error as Error).message);
                }
              }}
            >
              Reset positions
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
            <div>
              <p className="text-[13px] font-medium text-slate-800">Purge detection history</p>
              <p className="text-[11px] text-slate-500">
                Deletes every alert and incident. Use this before a fresh evaluation run or a project
                demonstration.
              </p>
            </div>
            <Button size="sm" variant="danger" disabled={!isAdmin} onClick={() => setConfirmPurge(true)}>
              Purge history
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
            <div>
              <p className="text-[13px] font-medium text-slate-800">Detections all-time</p>
              <p className="text-[11px] text-slate-500">
                {formatNumber(stats?.alerts.total ?? 0)} alerts · {formatNumber(stats?.incidents.total ?? 0)}{' '}
                incidents · {formatNumber(stats?.vessels.total ?? 0)} vessels
              </p>
            </div>
            <Badge className="bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200">
              Read-only summary
            </Badge>
          </div>
        </div>
      </Card>

      {/* ══ Modals ═════════════════════════════════════════════════════ */}
      <UserFormModal
        open={userModalOpen}
        target={editingUser}
        onClose={() => {
          setUserModalOpen(false);
          setEditingUser(null);
        }}
        onSaved={() => {
          setUserModalOpen(false);
          setEditingUser(null);
          void queryClient.invalidateQueries({ queryKey: ['users'] });
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && deleteUser.mutate(pendingDelete)}
        title="Delete account?"
        message={
          <>
            <span className="font-semibold">{pendingDelete?.name}</span> ({pendingDelete?.email}) will lose
            access immediately. Actions they have already performed remain in the audit log.
          </>
        }
        confirmLabel="Delete account"
        loading={deleteUser.isPending}
      />

      <ConfirmDialog
        open={confirmPurge}
        onClose={() => setConfirmPurge(false)}
        onConfirm={() => void purgeHistory()}
        title="Purge all detection history?"
        message="Every alert and every incident will be permanently deleted. Vessels, zones and accounts are not affected. This cannot be undone."
        confirmLabel="Purge history"
        loading={busy}
      />
    </div>
  );
}

function Cell({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-slate-800">{value}</p>
      <p className="mt-0.5 truncate text-[11px] text-slate-500">{hint}</p>
    </div>
  );
}

function UserFormModal({
  open,
  target,
  onClose,
  onSaved,
}: {
  open: boolean;
  target: PublicUser | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isEdit = Boolean(target);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<UserFormValues>({
    resolver: zodResolver(userFormSchema),
    defaultValues: { name: '', email: '', password: '', role: 'OPERATOR', active: true },
  });

  const active = watch('active');

  useEffect(() => {
    if (!open) return;
    reset(
      target
        ? { name: target.name, email: target.email, password: '', role: target.role, active: target.active }
        : { name: '', email: '', password: '', role: 'OPERATOR', active: true },
    );
  }, [open, target, reset]);

  const onSubmit = async (values: UserFormValues) => {
    try {
      if (isEdit && target) {
        await api.users.update(target._id, {
          name: values.name,
          role: values.role,
          active: values.active,
          ...(values.password ? { password: values.password } : {}),
        });
        toast.success('Account updated', values.name);
      } else {
        await api.users.create({
          name: values.name,
          email: values.email,
          password: values.password || '',
          role: values.role,
          active: values.active,
        });
        toast.success('Account created', values.email);
      }
      onSaved();
    } catch (error) {
      if (error instanceof ApiError) {
        const fieldErrors = error.fieldErrors();
        let matched = false;
        for (const [field, message] of Object.entries(fieldErrors)) {
          setError(field as keyof UserFormValues, { message });
          matched = true;
        }
        if (!matched) toast.error('Save failed', error.message);
      } else {
        toast.error('Save failed', (error as Error).message);
      }
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit account' : 'Create account'}
      description={
        isEdit
          ? 'Leave the password field empty to keep the existing credential.'
          : 'The new operator can sign in immediately with these credentials.'
      }
      footer={
        <>
          <Button onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit(onSubmit)} loading={isSubmitting}>
            {isEdit ? 'Save changes' : 'Create account'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Full name" error={errors.name?.message} required>
          <Input placeholder="e.g. Priya Nair" invalid={Boolean(errors.name)} {...register('name')} />
        </Field>

        <Field label="Email address" error={errors.email?.message} required>
          <Input
            type="email"
            placeholder="operator@cidrtm.gov.in"
            disabled={isEdit}
            invalid={Boolean(errors.email)}
            {...register('email')}
          />
        </Field>

        <Field
          label={isEdit ? 'New password (optional)' : 'Password'}
          error={errors.password?.message}
          hint="Minimum 8 characters."
        >
          <Input type="password" placeholder="••••••••" {...register('password')} />
        </Field>

        <Field label="Role" error={errors.role?.message} required>
          <Select {...register('role')}>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Account status"
          className="sm:col-span-2"
          hint={
            active
              ? 'This account can sign in to the console.'
              : 'Sign-in is blocked until the account is reactivated.'
          }
        >
          <Toggle
            checked={active}
            onChange={(next) => setValue('active', next, { shouldDirty: true })}
            label={active ? 'Active' : 'Inactive'}
            description={
              active
                ? 'The operator can sign in and act on alerts and incidents.'
                : 'The operator is disabled and cannot sign in.'
            }
          />
        </Field>
      </form>
    </Modal>
  );
}
