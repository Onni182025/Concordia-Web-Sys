import type { Permission, Role } from '@/lib/erp-types';
import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, ROLES } from '@/lib/rbac';
import { prisma } from '@/src/lib/prisma';

export async function ensureRolePermissions() {
  const expectedRows = ROLES.length * ALL_PERMISSIONS.length;
  const existingRows = await prisma.rolePermission.count();
  if (existingRows >= expectedRows) return;

  const rows = ROLES.flatMap(role => ALL_PERMISSIONS.map(permission => ({
    role,
    permission,
    enabled: DEFAULT_ROLE_PERMISSIONS[role].includes(permission),
  })));
  await prisma.rolePermission.createMany({ data: rows, skipDuplicates: true });
}

export async function getEffectivePermissions(role: Role): Promise<Permission[]> {
  await ensureRolePermissions();
  const rows = await prisma.rolePermission.findMany({ where: { role, enabled: true }, select: { permission: true } });
  return rows
    .map(row => row.permission)
    .filter((permission): permission is Permission =>
      (ALL_PERMISSIONS as string[]).includes(permission),
    );
}

export async function roleHasPermission(role: Role, permission: Permission): Promise<boolean> {
  await ensureRolePermissions();
  const configured = await prisma.rolePermission.findUnique({
    where: { role_permission: { role, permission } },
    select: { enabled: true },
  });
  return configured?.enabled === true;
}
