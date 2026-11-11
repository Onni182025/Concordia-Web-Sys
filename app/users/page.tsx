'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import type { User, Role } from '@/lib/erp-types';
import { createUser, getUserListPage, setUserActive, updateUser } from '@/app/actions/erp-actions';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Search, UserPlus, ShieldAlert, Edit2, UserCheck, UserX, Building, Mail, IdCard, KeyRound } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { TablePagination } from '@/components/shared/table-pagination';
import { ROLES, ROLE_LABELS, can } from '@/lib/rbac';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

// Zod Validation Schemas
const createUserSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string().min(6, 'Confirm password must be at least 6 characters'),
  employeeId: z.string().optional(),
  role: z.enum(ROLES),
  department: z.string().optional(),
  isActive: z.boolean().default(true),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

const editUserSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().optional().or(z.literal('')),
  confirmPassword: z.string().optional().or(z.literal('')),
  employeeId: z.string().optional(),
  role: z.enum(ROLES),
  department: z.string().optional(),
  isActive: z.boolean(),
}).refine((data) => {
  if (data.password && data.password.length > 0) {
    return data.password === data.confirmPassword;
  }
  return true;
}, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type CreateUserFormValues = z.infer<typeof createUserSchema>;
type EditUserFormValues = z.infer<typeof editUserSchema>;

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [listPage, setListPage] = useState(1);
  const [listTotal, setListTotal] = useState(0);

  // Modals State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // React Hook Forms
  const createForm = useForm<CreateUserFormValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
      employeeId: '',
      role: 'STAFF',
      department: '',
      isActive: true,
    }
  });

  const editForm = useForm<EditUserFormValues>({
    resolver: zodResolver(editUserSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
      employeeId: '',
      role: 'STAFF',
      department: '',
      isActive: true,
    }
  });

  useEffect(() => {
    if (!currentUser?.id) return;
    getUserListPage({ page: listPage, search: searchQuery, role: roleFilter, status: statusFilter }, currentUser.id)
      .then(result => { setUsers(result.rows); setListTotal(result.total); })
      .catch(error => toast({ title: 'Unable to load users', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }));
  }, [currentUser?.id, listPage, roleFilter, searchQuery, statusFilter]);

  // Sync edit form values when selected user changes
  useEffect(() => {
    if (selectedUser) {
      editForm.reset({
        name: selectedUser.name,
        email: selectedUser.email,
        employeeId: selectedUser.employeeId || '',
        role: selectedUser.role,
        department: selectedUser.department || '',
        isActive: selectedUser.isActive,
        password: '',
        confirmPassword: '',
      });
    }
  }, [selectedUser, editForm]);

  // Security Check: Only ADMIN can access
  if (!currentUser || !can(currentUser.role, 'users:view', currentUser.permissions)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6">
        <div className="bg-red-50 p-4 rounded-full text-red-600 mb-4 animate-bounce">
          <ShieldAlert className="h-12 w-12" />
        </div>
        <h1 className="text-2xl font-bold text-neutral-900 mb-2">Access Denied</h1>
        <p className="text-neutral-500 max-w-md">
          You do not have permission to view this page. Only System Administrators are authorized to manage users.
        </p>
      </div>
    );
  }

  // Create User Action
  const onCreateSubmit = async (values: CreateUserFormValues) => {
    const { confirmPassword: _confirmPassword, ...userData } = values;

    try { const newUser = await createUser({ ...userData, employeeId: userData.employeeId || undefined, department: userData.department || undefined, actorId: currentUser.id }); setUsers(current => [...current, newUser]);

    toast({
      title: 'User Created Successfully',
      description: `${userData.name} has been added as a ${userData.role.replace(/_/g, ' ')}.`
    });

    setIsCreateOpen(false);
    createForm.reset(); } catch (error) { toast({ title: 'Unable to create user', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }); }
  };

  // Edit User Action
  const onEditSubmit = async (values: EditUserFormValues) => {
    if (!selectedUser) return;

    const { confirmPassword: _confirmPassword, ...userData } = values;

    // Prevent self-deactivation
    if (selectedUser.id === currentUser.id && !userData.isActive) {
      toast({
        title: 'Action Blocked',
        description: 'You cannot deactivate your own administrator account.',
        variant: 'destructive'
      });
      return;
    }

    try { const updated = await updateUser(selectedUser.id, { ...userData, employeeId: userData.employeeId || undefined, department: userData.department || undefined, actorId: currentUser.id }); setUsers(current => current.map(user => user.id === updated.id ? updated : user));

    toast({
      title: 'User Updated',
      description: `Successfully updated profile for ${userData.name}.`
    });

    setIsEditOpen(false);
    setSelectedUser(null); } catch (error) { toast({ title: 'Unable to update user', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }); }
  };

  // Toggle Active Status Action
  const handleToggleActive = async (userToToggle: User) => {
    if (userToToggle.id === currentUser.id) {
      toast({
        title: 'Action Blocked',
        description: 'You cannot deactivate your own administrator account.',
        variant: 'destructive'
      });
      return;
    }

    try { const updated = await setUserActive(userToToggle.id, !userToToggle.isActive, currentUser.id); setUsers(current => current.map(user => user.id === updated.id ? updated : user));

    toast({
      title: userToToggle.isActive ? 'User Deactivated' : 'User Activated',
      description: `${userToToggle.name} is now ${userToToggle.isActive ? 'Inactive' : 'Active'}.`
    }); } catch (error) { toast({ title: 'Unable to update user status', description: error instanceof Error ? error.message : 'Database operation failed.', variant: 'destructive' }); }
  };

  // Filter Logic
  const filteredUsers = users;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">User Management</h1>
          <p className="text-sm text-neutral-500">Manage system access, roles, and departments for Concordia employees</p>
        </div>

        {can(currentUser.role, 'users:create', currentUser.permissions) && <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2">
              <UserPlus className="h-4 w-4" /> Create New User
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create New User</DialogTitle>
              <DialogDescription>
                Add a new employee to the ERP system. All fields marked with * are required.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-neutral-500 uppercase">Full Name *</label>
                  <Input {...createForm.register('name')} placeholder="John Doe" />
                  {createForm.formState.errors.name && (
                    <p className="text-xs text-red-500">{createForm.formState.errors.name.message}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-neutral-500 uppercase">Employee ID</label>
                  <Input {...createForm.register('employeeId')} placeholder="EMP-2025-001" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-neutral-500 uppercase">Email Address *</label>
                <Input {...createForm.register('email')} type="email" placeholder="john@concordia.com" />
                {createForm.formState.errors.email && (
                  <p className="text-xs text-red-500">{createForm.formState.errors.email.message}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-neutral-500 uppercase">Role *</label>
                  <Select 
                    onValueChange={(val: any) => createForm.setValue('role', val)}
                    defaultValue={createForm.getValues('role')}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select Role" />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.filter(role => role !== 'SUPER_ADMIN' || currentUser?.role === 'SUPER_ADMIN').map(role => <SelectItem key={role} value={role}>{ROLE_LABELS[role]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-neutral-500 uppercase">Department</label>
                  <Input {...createForm.register('department')} placeholder="Engineering" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-neutral-500 uppercase">Password *</label>
                  <Input {...createForm.register('password')} type="password" placeholder="••••••" />
                  {createForm.formState.errors.password && (
                    <p className="text-xs text-red-500">{createForm.formState.errors.password.message}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-neutral-500 uppercase">Confirm Password *</label>
                  <Input {...createForm.register('confirmPassword')} type="password" placeholder="••••••" />
                  {createForm.formState.errors.confirmPassword && (
                    <p className="text-xs text-red-500">{createForm.formState.errors.confirmPassword.message}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t">
                <span className="text-sm font-medium text-neutral-700">Set Account Active</span>
                <Switch 
                  checked={createForm.watch('isActive')}
                  onCheckedChange={(checked) => createForm.setValue('isActive', checked)}
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white">Create User</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-white p-4 rounded-xl border shadow-sm">
        <div className="flex items-center gap-3 md:col-span-2 border-r pr-4">
          <Search className="h-5 w-5 text-neutral-400" />
          <Input 
            placeholder="Search by Name, Email, or Employee ID..." 
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setListPage(1); }}
            className="border-none shadow-none focus-visible:ring-0"
          />
        </div>

        <div>
          <Select value={roleFilter} onValueChange={(val: any) => { setRoleFilter(val); setListPage(1); }}>
            <SelectTrigger>
              <SelectValue placeholder="Filter by Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Roles</SelectItem>
              {ROLES.filter(role => role !== 'SUPER_ADMIN' || currentUser?.role === 'SUPER_ADMIN').map(role => <SelectItem key={role} value={role}>{ROLE_LABELS[role]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Select value={statusFilter} onValueChange={(val: any) => { setStatusFilter(val); setListPage(1); }}>
            <SelectTrigger>
              <SelectValue placeholder="Filter by Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              <SelectItem value="ACTIVE">Active Only</SelectItem>
              <SelectItem value="INACTIVE">Inactive Only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Users Table */}
      <Card className="shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-neutral-400">
                    No users found matching the criteria.
                  </TableCell>
                </TableRow>
              ) : (
                filteredUsers.map(u => (
                  <TableRow key={u.id} className={cn(!u.isActive && "opacity-60 bg-neutral-50")}>
                    <TableCell className="font-bold text-neutral-700">
                      {u.employeeId ? (
                        <span className="flex items-center gap-1.5">
                          <IdCard className="h-3.5 w-3.5 text-neutral-400" />
                          {u.employeeId}
                        </span>
                      ) : (
                        <span className="text-neutral-400 italic">N/A</span>
                      )}
                    </TableCell>
                    <TableCell className="font-semibold text-neutral-900">{u.name}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5 text-neutral-600">
                        <Mail className="h-3.5 w-3.5 text-neutral-400" />
                        {u.email}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant="outline" 
                        className={cn(
                          "font-semibold",
                          (u.role === 'ADMIN' || u.role === 'SUPER_ADMIN') && "border-red-200 text-red-700 bg-red-50",
                          u.role.includes('SUPERVISOR') && "border-amber-200 text-amber-700 bg-amber-50",
                          u.role.includes('PERSONNEL') && "border-blue-200 text-blue-700 bg-blue-50",
                          u.role.endsWith('_STAFF') && "border-emerald-200 text-emerald-700 bg-emerald-50"
                        )}
                      >
                        {ROLE_LABELS[u.role]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {u.department ? (
                        <span className="flex items-center gap-1.5 text-neutral-600">
                          <Building className="h-3.5 w-3.5 text-neutral-400" />
                          {u.department}
                        </span>
                      ) : (
                        <span className="text-neutral-400 italic">N/A</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={cn(
                        u.isActive ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-neutral-100 text-neutral-600 border-neutral-200"
                      )}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {can(currentUser.role, 'users:update', currentUser.permissions) && <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => {
                            setSelectedUser(u);
                            setIsEditOpen(true);
                          }}
                          className="h-8 w-8 text-neutral-500 hover:text-emerald-600"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>}

                        {can(currentUser.role, 'users:deactivate', currentUser.permissions) && <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleToggleActive(u)}
                          disabled={u.id === currentUser.id}
                          className={cn(
                            "h-8 w-8",
                            u.isActive ? "text-red-500 hover:text-red-600 hover:bg-red-50" : "text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50"
                          )}
                          title={u.isActive ? "Deactivate User" : "Activate User"}
                        >
                          {u.isActive ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                        </Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
        <TablePagination page={listPage} pageSize={20} total={listTotal} onPageChange={setListPage} />
      </Card>

      {/* Edit User Modal */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit User Profile</DialogTitle>
            <DialogDescription>
              Update details for {selectedUser?.name}. Leave password fields blank to keep current password.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-neutral-500 uppercase">Full Name *</label>
                <Input {...editForm.register('name')} placeholder="John Doe" />
                {editForm.formState.errors.name && (
                  <p className="text-xs text-red-500">{editForm.formState.errors.name.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-neutral-500 uppercase">Employee ID</label>
                <Input {...editForm.register('employeeId')} placeholder="EMP-2025-001" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-neutral-500 uppercase">Email Address *</label>
              <Input {...editForm.register('email')} type="email" placeholder="john@concordia.com" />
              {editForm.formState.errors.email && (
                <p className="text-xs text-red-500">{editForm.formState.errors.email.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-neutral-500 uppercase">Role *</label>
                <Select 
                  onValueChange={(val: any) => editForm.setValue('role', val)}
                  value={editForm.watch('role')}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select Role" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.filter(role => role !== 'SUPER_ADMIN' || currentUser?.role === 'SUPER_ADMIN').map(role => <SelectItem key={role} value={role}>{ROLE_LABELS[role]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-neutral-500 uppercase">Department</label>
                <Input {...editForm.register('department')} placeholder="Engineering" />
              </div>
            </div>

            <div className="bg-neutral-50 p-3 rounded-lg border space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-neutral-600 uppercase">
                <KeyRound className="h-4 w-4 text-emerald-600" /> Change Password (Optional)
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-neutral-500 uppercase">New Password</label>
                  <Input {...editForm.register('password')} type="password" placeholder="••••••" />
                  {editForm.formState.errors.password && (
                    <p className="text-xs text-red-500">{editForm.formState.errors.password.message}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-neutral-500 uppercase">Confirm New Password</label>
                  <Input {...editForm.register('confirmPassword')} type="password" placeholder="••••••" />
                  {editForm.formState.errors.confirmPassword && (
                    <p className="text-xs text-red-500">{editForm.formState.errors.confirmPassword.message}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-sm font-medium text-neutral-700">Account Active Status</span>
              <Switch 
                checked={editForm.watch('isActive')}
                onCheckedChange={(checked) => editForm.setValue('isActive', checked)}
                disabled={selectedUser?.id === currentUser.id}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => {
                setIsEditOpen(false);
                setSelectedUser(null);
              }}>Cancel</Button>
              <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white">Save Changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
