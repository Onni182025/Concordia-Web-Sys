import type { Permission, Role, Warehouse } from '@/lib/erp-types';
export type { Permission } from '@/lib/erp-types';

export const ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'ACCOUNTING',
  'FARM_WH_SUPERVISOR',
  'FARM_WH_PERSONNEL',
  'ENGINEERING_SUPERVISOR',
  'ENGINEERING_WH_PERSONNEL',
  'SALES_MANAGER',
  'EGG_ROOM_SUPERVISOR',
  'SALES_SUPERVISOR',
  'ADMIN_SUPERVISOR',
  'HR_SUPERVISOR',
  'MARKETING_SUPERVISOR',
  'PROCESS_ENGINEER',
  'EGG_ROOM_STAFF',
  'SALES_STAFF',
  'ADMIN_STAFF',
  'HR_ASSISTANT',
  'MARKETING_OFFICER',
  'MARKETING_STAFF',
  'PROCESS_ANALYST',
  'STAFF',
] as const satisfies readonly Role[];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  ACCOUNTING: 'Accounting',
  FARM_WH_SUPERVISOR: 'Farm Warehouse Supervisor',
  FARM_WH_PERSONNEL: 'Farm Warehouse Personnel',
  ENGINEERING_SUPERVISOR: 'Engineering Supervisor',
  ENGINEERING_WH_PERSONNEL: 'Engineering Warehouse Personnel',
  SALES_MANAGER: 'Sales Manager',
  EGG_ROOM_SUPERVISOR: 'Egg Room Supervisor',
  SALES_SUPERVISOR: 'Sales Supervisor',
  ADMIN_SUPERVISOR: 'Admin Supervisor',
  HR_SUPERVISOR: 'HR Supervisor',
  MARKETING_SUPERVISOR: 'Marketing Supervisor',
  PROCESS_ENGINEER: 'Process Engineer',
  EGG_ROOM_STAFF: 'Egg Room Staff',
  SALES_STAFF: 'Sales Staff',
  ADMIN_STAFF: 'Admin Staff',
  HR_ASSISTANT: 'HR Assistant',
  MARKETING_OFFICER: 'Marketing Officer',
  MARKETING_STAFF: 'Marketing Staff',
  PROCESS_ANALYST: 'Process Analyst',
  STAFF: 'Staff',
};

export const PERMISSION_GROUPS: Array<{ label: string; permissions: Array<{ key: Permission; label: string }> }> = [
  { label: 'Dashboard', permissions: [{ key: 'dashboard:view', label: 'View dashboard' }] },
  { label: 'Job Orders', permissions: [
    { key: 'work-orders:view', label: 'View Job Orders' },
    { key: 'work-orders:create', label: 'Create Job Orders' },
    { key: 'work-orders:approve', label: 'Manage Job Order progress' },
    { key: 'work-orders:mrrf:approve', label: 'Approve MRRF' },
  ] },
  { label: 'Material Requisitions', permissions: [
    { key: 'mrs:view', label: 'View MRS' },
    { key: 'mrs:create', label: 'Create MRS' },
    { key: 'mrs:approve', label: 'Approve MRS' },
    { key: 'mrs:issue', label: 'Issue MRS' },
  ] },
  { label: 'Inventory', permissions: [
    { key: 'inventory:view', label: 'View inventory' },
    { key: 'inventory:manage', label: 'Manage inventory' },
    { key: 'inventory:issue', label: 'Issue stock' },
    { key: 'inventory:transfer', label: 'Transfer stock' },
  ] },
  { label: 'Receiving', permissions: [
    { key: 'receiving:view', label: 'View Receiving Reports' },
    { key: 'receiving:create', label: 'Create Receiving Reports' },
    { key: 'receiving:attachments:upload', label: 'Upload receiving attachments' },
  ] },
  { label: 'Reports and Movements', permissions: [
    { key: 'movements:view', label: 'View stock movements' },
    { key: 'reports:view', label: 'View reports' },
  ] },
  { label: 'User Management and Settings', permissions: [
    { key: 'users:view', label: 'View users' },
    { key: 'users:create', label: 'Create users' },
    { key: 'users:update', label: 'Update users' },
    { key: 'users:deactivate', label: 'Activate/deactivate users' },
    { key: 'users:create-super-admin', label: 'Create Super Admin' },
    { key: 'settings:manage', label: 'Manage document series settings' },
  ] },
];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap(group => group.permissions.map(permission => permission.key));

export const MRRF_APPROVER_ROLES: readonly Role[] = [
  'ENGINEERING_SUPERVISOR',
  'FARM_WH_SUPERVISOR',
  'ADMIN_SUPERVISOR',
  'ADMIN',
  'SUPER_ADMIN',
];

const adminPermissions: Permission[] = ALL_PERMISSIONS.filter(permission => permission !== 'users:create-super-admin');
const accountingPermissions: Permission[] = ALL_PERMISSIONS.filter(permission =>
  !permission.startsWith('users:') && permission !== 'settings:manage',
);
const operationalPermissions: Permission[] = ALL_PERMISSIONS.filter(permission =>
  !permission.startsWith('users:') && permission !== 'settings:manage',
);
const requesterPermissions: Permission[] = ALL_PERMISSIONS.filter(permission =>
  !permission.startsWith('users:')
  && permission !== 'settings:manage'
  && permission !== 'reports:view'
  && !permission.startsWith('receiving:'),
);

function withMRRFApproval(role: Role, permissions: Permission[]): Permission[] {
  return MRRF_APPROVER_ROLES.includes(role)
    ? [...permissions.filter(permission => permission !== 'work-orders:mrrf:approve'), 'work-orders:mrrf:approve']
    : permissions.filter(permission => permission !== 'work-orders:mrrf:approve');
}

export const DEFAULT_ROLE_PERMISSIONS = {
  SUPER_ADMIN: [...ALL_PERMISSIONS],
  ADMIN: withMRRFApproval('ADMIN', adminPermissions),
  ACCOUNTING: withMRRFApproval('ACCOUNTING', accountingPermissions),
  FARM_WH_SUPERVISOR: withMRRFApproval('FARM_WH_SUPERVISOR', operationalPermissions),
  FARM_WH_PERSONNEL: withMRRFApproval('FARM_WH_PERSONNEL', operationalPermissions),
  ENGINEERING_SUPERVISOR: withMRRFApproval('ENGINEERING_SUPERVISOR', operationalPermissions),
  ENGINEERING_WH_PERSONNEL: withMRRFApproval('ENGINEERING_WH_PERSONNEL', operationalPermissions),
  SALES_MANAGER: withMRRFApproval('SALES_MANAGER', operationalPermissions),
  EGG_ROOM_SUPERVISOR: withMRRFApproval('EGG_ROOM_SUPERVISOR', operationalPermissions),
  SALES_SUPERVISOR: withMRRFApproval('SALES_SUPERVISOR', operationalPermissions),
  ADMIN_SUPERVISOR: withMRRFApproval('ADMIN_SUPERVISOR', operationalPermissions),
  HR_SUPERVISOR: withMRRFApproval('HR_SUPERVISOR', operationalPermissions),
  MARKETING_SUPERVISOR: withMRRFApproval('MARKETING_SUPERVISOR', operationalPermissions),
  PROCESS_ENGINEER: withMRRFApproval('PROCESS_ENGINEER', operationalPermissions),
  EGG_ROOM_STAFF: withMRRFApproval('EGG_ROOM_STAFF', requesterPermissions),
  SALES_STAFF: withMRRFApproval('SALES_STAFF', requesterPermissions),
  ADMIN_STAFF: withMRRFApproval('ADMIN_STAFF', requesterPermissions),
  HR_ASSISTANT: withMRRFApproval('HR_ASSISTANT', requesterPermissions),
  MARKETING_OFFICER: withMRRFApproval('MARKETING_OFFICER', requesterPermissions),
  MARKETING_STAFF: withMRRFApproval('MARKETING_STAFF', requesterPermissions),
  PROCESS_ANALYST: withMRRFApproval('PROCESS_ANALYST', requesterPermissions),
  STAFF: withMRRFApproval('STAFF', requesterPermissions),
} satisfies Record<Role, readonly Permission[]>;

export const can = (role: Role | null | undefined, permission: Permission, granted?: readonly Permission[]) => {
  if (!role) return false;
  if (role === 'SUPER_ADMIN' && granted === undefined) return true;
  const permissions = granted ?? DEFAULT_ROLE_PERMISSIONS[role];
  return permissions.includes(permission);
};

export const warehouseForRole = (role: Role | null | undefined): Warehouse | null => {
  if (role === 'FARM_WH_SUPERVISOR' || role === 'FARM_WH_PERSONNEL') return 'FARM';
  if (role === 'ENGINEERING_SUPERVISOR' || role === 'ENGINEERING_WH_PERSONNEL') return 'ENGINEERING';
  return null;
};

export const canManageUser = (actor: Role, target: Role) =>
  actor === 'SUPER_ADMIN' || (actor === 'ADMIN' && target !== 'SUPER_ADMIN');
