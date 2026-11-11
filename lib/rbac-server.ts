import type { Permission } from '@/lib/rbac';
import { can, warehouseForRole } from '@/lib/rbac';
import type { Warehouse } from '@/lib/erp-types';
import { getCurrentUser } from '@/app/actions/auth-actions';
import type { Role } from '@/lib/erp-types';

export async function requirePermission(userId: string, permission: Permission) {
  const sessionUser = await getCurrentUser();
  if (!sessionUser || sessionUser.id !== userId || !sessionUser.isActive) throw new Error('Your session is invalid or has expired.');
  if (!can(sessionUser.role, permission, sessionUser.permissions)) throw new Error('You do not have permission to perform this action.');
  return sessionUser;
}

export async function requireWarehousePermission(userId: string, permission: Permission, warehouse: Warehouse) {
  const user = await requirePermission(userId, permission);
  const assigned = warehouseForRole(user.role);
  if (assigned && assigned !== warehouse) throw new Error(`Your role can only access the ${assigned} Warehouse.`);
  return user;
}

export async function requireRole(userId: string, allowedRole: Role) {
  const user = await requireAuthenticatedUser(userId);
  if (user.role !== allowedRole) throw new Error('You do not have permission to perform this action.');
  return user;
}

export async function requireAuthenticatedUser(userId: string) {
  const sessionUser = await getCurrentUser();
  if (!sessionUser || sessionUser.id !== userId) throw new Error('Your session is invalid or has expired.');
  if (!sessionUser.isActive) throw new Error('Your account is inactive or unavailable.');
  return sessionUser;
}
