'use server';

import type { Permission, Role } from '@/lib/erp-types';
import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, ROLES } from '@/lib/rbac';
import { ensureRolePermissions } from '@/lib/rbac-data';
import { requirePermission, requireRole } from '@/lib/rbac-server';
import { prisma } from '@/src/lib/prisma';

export async function getRolePermissionSettings(userId: string) {
  await requireRole(userId, 'SUPER_ADMIN');
  await ensureRolePermissions();
  const rows = await prisma.rolePermission.findMany({ orderBy: [{ role: 'asc' }, { permission: 'asc' }] });
  return ROLES.map(role => ({
    role,
    permissions: ALL_PERMISSIONS.map(permission => {
      const saved = rows.find(row => row.role === role && row.permission === permission);
      return {
        key: permission,
        enabled: saved?.enabled ?? DEFAULT_ROLE_PERMISSIONS[role].includes(permission),
        locked: false,
      };
    }),
  }));
}

export async function saveRolePermissions(input: { userId: string; role: Role; permissions: Permission[] }) {
  const actor = await requireRole(input.userId, 'SUPER_ADMIN');
  if (!ROLES.includes(input.role)) throw new Error('Select a valid role.');
  if (!Array.isArray(input.permissions) || input.permissions.some(permission => !ALL_PERMISSIONS.includes(permission))) {
    throw new Error('The permission list contains an unsupported permission.');
  }
  const requested = new Set(input.permissions);

  await ensureRolePermissions();
  await prisma.$transaction(async tx => {
    await Promise.all(ALL_PERMISSIONS.map(permission => tx.rolePermission.upsert({
      where: { role_permission: { role: input.role, permission } },
      update: { enabled: requested.has(permission) },
      create: { role: input.role, permission, enabled: requested.has(permission) },
    })));
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'ROLE_PERMISSIONS_UPDATED',
        entityType: 'ROLE',
        entityId: input.role,
        details: JSON.stringify({ enabledPermissions: [...requested].length }),
      },
    });
  });

  return getRolePermissionSettings(input.userId);
}
