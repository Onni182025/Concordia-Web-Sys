'use client';

import { useEffect, useState } from 'react';
import type { DocumentSeriesType } from '@prisma/client';
import { getDocumentSeriesSettings, updateDocumentSeries } from '@/app/actions/erp-actions';
import { getRolePermissionSettings, saveRolePermissions } from '@/app/actions/rbac-actions';
import { useAuth } from '@/hooks/use-auth';
import { can, PERMISSION_GROUPS, ROLE_LABELS, ROLES } from '@/lib/rbac';
import type { Permission, Role } from '@/lib/erp-types';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Settings, ShieldAlert } from 'lucide-react';

type SeriesSettings = {
  type: DocumentSeriesType;
  prefix: string;
  nextNumber: number;
  padding: number;
  yearFormat: '' | 'YYYY' | 'YY';
};

const labels: Record<DocumentSeriesType, { title: string; description: string }> = {
  WORK_ORDER: { title: 'Job Order ID Series', description: 'Used for all newly created Job Orders.' },
  MRS: { title: 'MRS ID / Number Series', description: 'Used for all newly created Material Requisition Slips.' },
  RECEIVING: { title: 'Receiving Report ID / Number Series', description: 'Used for all newly created Receiving Reports.' },
};

type SeriesRecord = Omit<SeriesSettings, 'yearFormat'> & { yearFormat: string | null };
type RolePermissionSettings = {
  role: Role;
  permissions: Array<{ key: Permission; enabled: boolean; locked: boolean }>;
};

const toSeriesSettings = (series: SeriesRecord[]): SeriesSettings[] =>
  series.map(value => ({
    ...value,
    yearFormat: value.yearFormat === 'YYYY' || value.yearFormat === 'YY' ? value.yearFormat : '',
  }));

function sampleNumber(series: SeriesSettings) {
  const year = series.yearFormat === 'YYYY' ? `${new Date().getFullYear()}-` : series.yearFormat === 'YY' ? `${String(new Date().getFullYear()).slice(-2)}-` : '';
  return `${series.prefix}${year}${String(series.nextNumber).padStart(series.padding, '0')}`;
}

export default function SettingsPage() {
  const { user, refresh } = useAuth();
  const [series, setSeries] = useState<SeriesSettings[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingType, setSavingType] = useState<DocumentSeriesType | null>(null);
  const [activeTab, setActiveTab] = useState<'series' | 'permissions'>('series');
  const [roleSettings, setRoleSettings] = useState<RolePermissionSettings[]>([]);
  const [selectedRole, setSelectedRole] = useState<Role>('ADMIN');
  const [permissionsLoading, setPermissionsLoading] = useState(true);
  const [savingPermissions, setSavingPermissions] = useState(false);
  const isAuthorized = user?.role === 'SUPER_ADMIN' || can(user?.role, 'settings:manage', user?.permissions);
  const canManageRolePermissions = user?.role === 'SUPER_ADMIN';
  const canManageSeries = can(user?.role, 'settings:manage', user?.permissions);

  useEffect(() => {
    if (!user?.id || !isAuthorized) {
      setIsLoading(false);
      return;
    }
    Promise.all([
      canManageSeries ? getDocumentSeriesSettings(user.id) : Promise.resolve([]),
      canManageRolePermissions ? getRolePermissionSettings(user.id) : Promise.resolve([]),
    ])
      .then(([values, roleValues]) => {
        setSeries(toSeriesSettings(values));
        setRoleSettings(roleValues);
      })
      .catch(error => toast({ title: 'Unable to load settings', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }))
      .finally(() => {
        setIsLoading(false);
        setPermissionsLoading(false);
      });
  }, [canManageRolePermissions, canManageSeries, isAuthorized, user?.id]);

  useEffect(() => {
    if (canManageRolePermissions && !canManageSeries) setActiveTab('permissions');
  }, [canManageRolePermissions, canManageSeries]);

  const updateValue = <K extends keyof SeriesSettings>(type: DocumentSeriesType, key: K, value: SeriesSettings[K]) => {
    setSeries(current => current.map(entry => entry.type === type ? { ...entry, [key]: value } : entry));
  };

  const saveSeries = async (entry: SeriesSettings) => {
    if (!user?.id) {
      toast({ title: 'Session expired', description: 'Sign in again to update document settings.', variant: 'destructive' });
      return;
    }
    setSavingType(entry.type);
    try {
      const saved = await updateDocumentSeries({ ...entry, userId: user.id });
      const savedSettings: SeriesSettings = {
        type: saved.type,
        prefix: saved.prefix,
        nextNumber: saved.nextNumber,
        padding: saved.padding,
        yearFormat: saved.yearFormat === 'YYYY' || saved.yearFormat === 'YY' ? saved.yearFormat : '',
      };
      setSeries(current => current.map(value => value.type === entry.type ? savedSettings : value));
      toast({ title: 'Series settings saved', description: `${labels[entry.type].title} is now ${sampleNumber(savedSettings)}.` });
    } catch (error) {
      toast({ title: 'Unable to save series settings', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' });
    } finally {
      setSavingType(null);
    }
  };

  const selectedRoleSettings = roleSettings.find(settings => settings.role === selectedRole);
  const updatePermission = (permission: Permission, enabled: boolean) => {
    setRoleSettings(current => current.map(settings => settings.role === selectedRole
      ? { ...settings, permissions: settings.permissions.map(value => value.key === permission && !value.locked ? { ...value, enabled } : value) }
      : settings));
  };

  const savePermissions = async () => {
    if (!user?.id || !selectedRoleSettings) return;
    setSavingPermissions(true);
    try {
      const updated = await saveRolePermissions({
        userId: user.id,
        role: selectedRole,
        permissions: selectedRoleSettings.permissions.filter(permission => permission.enabled).map(permission => permission.key),
      });
      setRoleSettings(updated);
      await refresh();
      toast({ title: 'Role permissions saved', description: `Permissions for ${ROLE_LABELS[selectedRole]} have been updated.` });
    } catch (error) {
      toast({ title: 'Unable to save role permissions', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' });
    } finally {
      setSavingPermissions(false);
    }
  };

  if (!isAuthorized) {
    return <Alert variant="destructive"><ShieldAlert className="h-4 w-4" /><AlertTitle>Access restricted</AlertTitle><AlertDescription>Only Admin and Super Admin users can access document series settings.</AlertDescription></Alert>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600">Administration</p>
        <h1 className="mt-1 flex items-center gap-2 text-3xl font-bold tracking-tight text-neutral-900"><Settings className="h-7 w-7 text-emerald-600" />Settings</h1>
        <p className="mt-1 text-sm text-neutral-500">Configure document numbering and role-based access permissions.</p>
      </div>
      <div className="flex flex-wrap gap-2 border-b pb-3">
        {canManageSeries && <Button type="button" variant={activeTab === 'series' ? 'default' : 'outline'} onClick={() => setActiveTab('series')} className={activeTab === 'series' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : ''}>Document Series</Button>}
        {canManageRolePermissions && <Button type="button" variant={activeTab === 'permissions' ? 'default' : 'outline'} onClick={() => setActiveTab('permissions')} className={activeTab === 'permissions' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : ''}>Role Permissions</Button>}
      </div>
      {activeTab === 'series' && (isLoading ? <Card><CardContent className="p-6 text-sm text-neutral-500">Loading document series…</CardContent></Card> : (
        <div className="grid gap-5">
          {series.map(entry => (
            <Card key={entry.type} className="border-emerald-100 shadow-sm">
              <CardHeader>
                <CardTitle>{labels[entry.type].title}</CardTitle>
                <CardDescription>{labels[entry.type].description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Prefix</label>
                    <Input value={entry.prefix} onChange={event => updateValue(entry.type, 'prefix', event.target.value)} maxLength={32} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Next Number</label>
                    <Input type="number" min="1" max="2147483646" step="1" value={entry.nextNumber} onChange={event => updateValue(entry.type, 'nextNumber', Number(event.target.value))} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Number Padding</label>
                    <Input type="number" min="1" max="12" step="1" value={entry.padding} onChange={event => updateValue(entry.type, 'padding', Number(event.target.value))} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Year Format</label>
                    <select value={entry.yearFormat} onChange={event => updateValue(entry.type, 'yearFormat', event.target.value as SeriesSettings['yearFormat'])} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                      <option value="">No year</option>
                      <option value="YYYY">Four-digit year</option>
                      <option value="YY">Two-digit year</option>
                    </select>
                  </div>
                </div>
                <div className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 text-sm text-emerald-950">
                    <span className="font-medium">Next document number</span>
                    <Badge className="border-emerald-200 bg-white font-mono text-emerald-800">{sampleNumber(entry)}</Badge>
                  </div>
                  <Button onClick={() => void saveSeries(entry)} disabled={savingType !== null} className="bg-emerald-600 text-white hover:bg-emerald-700">
                    {savingType === entry.type ? 'Saving…' : 'Save Series'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {!series.length && <Card><CardContent className="p-6 text-sm text-neutral-500">No document series are configured.</CardContent></Card>}
        </div>
      ))}
      {canManageRolePermissions && activeTab === 'permissions' && (permissionsLoading ? <Card><CardContent className="p-6 text-sm text-neutral-500">Loading role permissions…</CardContent></Card> : (
        <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
          <Card className="h-fit border-emerald-100">
            <CardHeader><CardTitle>Roles</CardTitle><CardDescription>Select a role to configure its permissions.</CardDescription></CardHeader>
            <CardContent className="space-y-1">
              {ROLES.map(role => (
                <Button key={role} type="button" variant={role === selectedRole ? 'default' : 'ghost'} className={`w-full justify-start ${role === selectedRole ? 'bg-emerald-600 text-white hover:bg-emerald-700' : ''}`} onClick={() => setSelectedRole(role)}>
                  {ROLE_LABELS[role]}
                </Button>
              ))}
            </CardContent>
          </Card>
          <div className="space-y-4">
            <Card className="border-emerald-100">
              <CardHeader>
                <CardTitle>{ROLE_LABELS[selectedRole]} Permissions</CardTitle>
                <CardDescription>
                  {selectedRole === 'SUPER_ADMIN'
                    ? 'These permissions control Super Admin access as well. If you disable Settings, the Role Permissions tab remains available so access can be restored.'
                    : 'Changes are enforced by server-side checks as well as the user interface.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {PERMISSION_GROUPS.map(group => (
                  <section key={group.label} className="space-y-3">
                    <h3 className="border-b pb-2 text-sm font-semibold text-emerald-800">{group.label}</h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {group.permissions.map(permission => {
                        const value = selectedRoleSettings?.permissions.find(entry => entry.key === permission.key);
                        return (
                          <label key={permission.key} className="flex items-center justify-between gap-4 rounded-lg border p-3">
                            <span className="text-sm text-neutral-700">
                              {permission.label}
                              {value?.locked && <span className="ml-2 text-xs text-neutral-400">Restricted</span>}
                            </span>
                            <Switch
                              checked={value?.enabled || false}
                              disabled={!value || value.locked || savingPermissions}
                              onCheckedChange={enabled => updatePermission(permission.key, enabled)}
                              aria-label={`${permission.label} for ${ROLE_LABELS[selectedRole]}`}
                            />
                          </label>
                        );
                      })}
                    </div>
                  </section>
                ))}
                <div className="flex justify-end border-t pt-4">
                  <Button type="button" onClick={() => void savePermissions()} disabled={!selectedRoleSettings || selectedRole === 'SUPER_ADMIN' || savingPermissions} className="bg-emerald-600 text-white hover:bg-emerald-700">
                    {savingPermissions ? 'Saving permissions…' : 'Save Role Permissions'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ))}
    </div>
  );
}
