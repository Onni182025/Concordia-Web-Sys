'use client';

import React from 'react';
import { AuthProvider } from '@/hooks/use-auth';
import Sidebar from '@/components/layout/sidebar';
import { Toaster } from '@/components/ui/toaster';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider><ProtectedLayout>{children}</ProtectedLayout></AuthProvider>;
}

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();

  React.useEffect(() => {
    if (!loading && !user && pathname !== '/login') router.replace('/login');
  }, [loading, pathname, router, user]);

  if (pathname === '/login') return <>{children}</>;
  if (loading || !user) return <div className="flex min-h-screen items-center justify-center text-sm text-neutral-500">Loading Concordia ERP...</div>;

  return (
    <>
      <div className="flex h-screen bg-neutral-50 text-neutral-900 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-8">
          <div className="max-w-7xl mx-auto space-y-6">
            {children}
          </div>
        </main>
      </div>
      <Toaster />
    </>
  );
}
