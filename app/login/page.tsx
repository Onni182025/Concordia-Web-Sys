'use client';

import { FormEvent, useState } from 'react';
import Image from 'next/image';
import { LockKeyhole, Mail } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await login(email, password);
      if (!result.ok) {
        setError(result.error || 'Unable to sign in.');
        return;
      }
      // Use a full navigation so the new HTTP-only cookie is included in the
      // first dashboard request and the middleware can establish the session.
      window.location.assign('/');
    } catch {
      setError('Unable to sign in right now. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-950 via-emerald-800 to-emerald-600 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <Image
            src="/concordia-logo.png"
            alt="Concordia Agribusiness Corporation"
            width={220}
            height={220}
            priority
            className="mx-auto mb-5 h-44 w-44 object-contain"
          />
          <h1 className="mt-2 text-2xl font-bold text-neutral-900">Log into Concordia</h1>
          <p className="mt-2 text-sm text-neutral-500">Manage inventory and requests securely.</p>
        </div>
        <form onSubmit={submit} className="space-y-5">
          <label className="block space-y-2 text-sm font-medium text-neutral-700">
            Email
            <div className="relative">
              <Mail className="absolute left-3 top-3 h-4 w-4 text-neutral-400" />
              <Input className="pl-10" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
          </label>
          <label className="block space-y-2 text-sm font-medium text-neutral-700">
            Password
            <div className="relative">
              <LockKeyhole className="absolute left-3 top-3 h-4 w-4 text-neutral-400" />
              <Input className="pl-10" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
          </label>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button disabled={loading} className="h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700">
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
      </div>
    </main>
  );
}
