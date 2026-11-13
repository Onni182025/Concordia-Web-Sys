'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { can, type Permission } from '@/lib/rbac';
import { 
  LayoutDashboard, 
  FileText, 
  ClipboardList, 
  Package, 
  ArrowDownLeft, 
  History, 
  Users, 
  LogOut,
  Settings,
  BarChart3,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { reportNavigation } from '@/lib/reports';

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [reportsOpen, setReportsOpen] = useState(pathname.startsWith('/reports'));

  useEffect(() => {
    if (pathname.startsWith('/reports')) setReportsOpen(true);
  }, [pathname]);

  const menuItems = [
    {
      title: 'Dashboard',
      href: '/',
      icon: LayoutDashboard,
      permission: 'dashboard:view'
    },
    {
      title: 'Job Orders',
      href: '/work-orders',
      icon: FileText,
      permission: 'work-orders:view'
    },
    {
      title: 'Stock Requisitions',
      href: '/mrs',
      icon: ClipboardList,
      permission: 'mrs:view'
    },
    {
      title: 'Inventory Stock',
      href: '/inventory',
      icon: Package,
      permission: 'inventory:view'
    },
    {
      title: 'Receiving (DR/Invoice)',
      href: '/receiving',
      icon: ArrowDownLeft,
      permission: 'receiving:view'
    },
    {
      title: 'Stock Movements',
      href: '/movements',
      icon: History,
      permission: 'movements:view'
    },
    {
      title: 'User Management',
      href: '/users',
      icon: Users,
      permission: 'users:view'
    }
  ];

  const filteredMenu = menuItems.filter(item => 
    user && can(user.role, item.permission as Permission, user.permissions)
  );

  return (
    <aside className="w-64 bg-neutral-900 text-white flex flex-col h-screen border-r border-neutral-800">
      {/* Brand Header */}
      <div className="flex justify-center border-b border-neutral-800 px-4 py-3">
        <Image
          src="/concordia-logo.png"
          alt="Concordia Agribusiness Corporation"
          width={220}
          height={220}
          priority
          className="h-32 w-full object-contain"
        />
      </div>

      {/* User Profile & Role Switcher */}
      <div className="p-4 border-b border-neutral-800 bg-neutral-950/50">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-9 w-9 rounded-full bg-emerald-800 flex items-center justify-center text-white font-bold text-sm">
            {user?.name.charAt(0)}
          </div>
          <div className="overflow-hidden">
            <p className="text-sm font-medium truncate">{user?.name}</p>
            <span className="inline-block text-[9px] bg-emerald-950 text-emerald-400 px-2 py-0.5 rounded font-semibold border border-emerald-800/50 truncate max-w-full">
              {user?.role.replace(/_/g, ' ')}
            </span>
          </div>
        </div>

      </div>

      {/* Navigation Links */}
      <nav className="flex-1 overflow-y-auto p-4 space-y-1">
        {filteredMenu.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                isActive 
                  ? "bg-emerald-600 text-white shadow-md shadow-emerald-900/20" 
                  : "text-neutral-400 hover:bg-emerald-950 hover:text-emerald-100 focus-visible:bg-emerald-950 focus-visible:text-emerald-100"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.title}</span>
            </Link>
          );
        })}
        {user && can(user.role, 'reports:view', user.permissions) && (
          <div>
            <button
              type="button"
              onClick={() => setReportsOpen(open => !open)}
              aria-expanded={reportsOpen}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-all duration-200',
                pathname.startsWith('/reports')
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/20'
                  : 'text-neutral-400 hover:bg-emerald-950 hover:text-emerald-100 focus-visible:bg-emerald-950 focus-visible:text-emerald-100',
              )}
            >
              <BarChart3 className="h-4 w-4 shrink-0" />
              <span className="flex-1">Reports</span>
              {reportsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            {reportsOpen && (
              <div className="ml-4 mt-1 space-y-1 border-l border-neutral-700 pl-3">
                {reportNavigation.map(report => {
                  const href = `/reports/${report.key}`;
                  const isActive = pathname === href;
                  return (
                    <Link
                      key={report.key}
                      href={href}
                      className={cn(
                        'block rounded-md px-3 py-2 text-xs font-medium transition-colors',
                        isActive ? 'bg-emerald-700 text-white' : 'text-neutral-400 hover:bg-emerald-950 hover:text-emerald-100 focus-visible:bg-emerald-950 focus-visible:text-emerald-100',
                      )}
                    >
                      {report.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* Footer / Logout */}
      <div className="p-4 border-t border-neutral-800">
        {user && (user.role === 'SUPER_ADMIN' || can(user.role, 'settings:manage', user.permissions)) && (
          <Link
            href="/settings"
            className={cn(
              "mb-2 flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              pathname === '/settings'
                ? "bg-emerald-600 text-white"
                : "text-neutral-400 hover:bg-emerald-950 hover:text-emerald-100 focus-visible:bg-emerald-950 focus-visible:text-emerald-100"
            )}
          >
            <Settings className="h-4 w-4" />
            <span>Settings</span>
          </Link>
        )}
        <button
          onClick={() => void logout()}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-neutral-400 hover:bg-red-950/30 hover:text-red-400 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
