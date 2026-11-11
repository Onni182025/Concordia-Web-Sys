'use client';

import { can, type Permission } from '@/lib/rbac';
import { useAuth } from '@/hooks/use-auth';

export function usePermission(permission: Permission) {
  const { user } = useAuth();
  return can(user?.role, permission);
}
