'use server';

import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/src/lib/prisma';
import type { User } from '@/lib/erp-types';
import { getEffectivePermissions } from '@/lib/rbac-data';

const SESSION_COOKIE = 'concordia_session';
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 8;
let lastLoginRateLimitCleanupAt = 0;
const loginCredentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(1024),
});
const configuredSecret = () => {
  const value = process.env.AUTH_SECRET;
  return value && Buffer.byteLength(value, 'utf8') >= 32 ? value : null;
};
const secret = () => {
  const value = configuredSecret();
  if (!value) {
    throw new Error('AUTH_SECRET must be configured with at least 32 bytes.');
  }
  return value;
};

const userDto = async (user: { id: string; employeeId: string | null; email: string; name: string; role: User['role']; department: string | null; isActive: boolean; createdAt: Date }): Promise<User> => ({
  id: user.id,
  employeeId: user.employeeId || undefined,
  email: user.email,
  name: user.name,
  role: user.role,
  permissions: await getEffectivePermissions(user.role),
  department: user.department || undefined,
  isActive: user.isActive,
  createdAt: user.createdAt.toISOString().split('T')[0],
});

function sign(value: string) {
  return createHmac('sha256', secret()).update(value).digest('base64url');
}

function sessionValue(userId: string, sessionVersion: number) {
  const payload = `${userId}.${sessionVersion}.${Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS}`;
  return `${payload}.${sign(payload)}`;
}

function loginRateLimitKey(email: string) {
  return createHmac('sha256', secret()).update(`login:${email}`).digest('hex');
}

async function recordLoginFailure(key: string) {
  const now = new Date();
  if (now.getTime() - lastLoginRateLimitCleanupAt >= 60 * 60 * 1000) {
    await prisma.loginRateLimit.deleteMany({
      where: { windowStartedAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
    });
    lastLoginRateLimitCleanupAt = now.getTime();
  }
  await prisma.$transaction(async tx => {
    const current = await tx.loginRateLimit.findUnique({ where: { key } });
    if (!current || now.getTime() - current.windowStartedAt.getTime() >= LOGIN_ATTEMPT_WINDOW_MS) {
      await tx.loginRateLimit.upsert({
        where: { key },
        create: { key, failedAttempts: 1, windowStartedAt: now },
        update: { failedAttempts: 1, windowStartedAt: now, blockedUntil: null },
      });
      return;
    }

    const updated = await tx.loginRateLimit.update({
      where: { key },
      data: { failedAttempts: { increment: 1 } },
    });
    if (updated.failedAttempts >= MAX_LOGIN_FAILURES) {
      await tx.loginRateLimit.update({
        where: { key },
        data: { blockedUntil: new Date(now.getTime() + LOGIN_LOCKOUT_MS) },
      });
    }
  });
}

function readSession() {
  const value = cookies().get(SESSION_COOKIE)?.value;
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const [userId, sessionVersionText, expiresAt, signature] = parts;
  const sessionVersion = Number(sessionVersionText);
  if (!userId || !Number.isSafeInteger(sessionVersion) || sessionVersion < 0 || !/^\d+$/.test(expiresAt)) return null;
  const payload = `${userId}.${sessionVersionText}.${expiresAt}`;
  if (Number(expiresAt) <= Math.floor(Date.now() / 1000)) return null;
  const expected = sign(payload);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return { userId, sessionVersion };
}

export async function loginUser(email: string, password: string) {
  if (!configuredSecret()) {
    return { ok: false as const, error: 'Sign-in is unavailable. Please contact your administrator.' };
  }
  const credentials = loginCredentialsSchema.safeParse({ email, password });
  if (!credentials.success) return { ok: false as const, error: 'Invalid email or password.' };
  const normalizedEmail = credentials.data.email.toLowerCase();
  const rateLimitKey = loginRateLimitKey(normalizedEmail);
  const now = new Date();
  const loginRateLimit = await prisma.loginRateLimit.findUnique({ where: { key: rateLimitKey } });
  if (loginRateLimit?.blockedUntil && loginRateLimit.blockedUntil > now) {
    return { ok: false as const, error: 'Too many sign-in attempts. Please try again later.' };
  }

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  const passwordMatches = user
    ? await bcrypt.compare(password, user.password)
    : await bcrypt.compare(password, await bcrypt.hash('nonexistent-account-password', 12));
  if (!user || !user.isActive || !passwordMatches) {
    await recordLoginFailure(rateLimitKey);
    return { ok: false as const, error: 'Invalid email or password.' };
  }

  await prisma.$transaction(async tx => {
    await tx.loginRateLimit.deleteMany({ where: { key: rateLimitKey } });
    await tx.auditLog.create({
      data: {
        actorUserId: user.id,
        actorName: user.name,
        action: 'LOGIN_SUCCESS',
        entityType: 'USER',
        entityId: user.id,
      },
    });
  });
  cookies().set(SESSION_COOKIE, sessionValue(user.id, user.sessionVersion), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return { ok: true as const, user: await userDto(user) };
}

export async function getCurrentUser() {
  const session = readSession();
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user?.isActive || user.sessionVersion !== session.sessionVersion) return null;
  return userDto(user);
}

export async function logoutUser() {
  try {
    const session = readSession();
    if (session) {
      await prisma.user.updateMany({
        where: { id: session.userId, sessionVersion: session.sessionVersion },
        data: { sessionVersion: { increment: 1 } },
      });
    }
  } finally {
    cookies().set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', expires: new Date(0), path: '/' });
  }
}
