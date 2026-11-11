import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

if (process.env.NODE_ENV !== 'production' || !process.argv.includes('--confirm-production')) {
  throw new Error('Set NODE_ENV=production and pass --confirm-production to create the first production Super Admin.');
}

if (!process.env.AUTH_SECRET || Buffer.byteLength(process.env.AUTH_SECRET, 'utf8') < 32) {
  throw new Error('Configure AUTH_SECRET with at least 32 bytes before bootstrapping the production administrator.');
}

const name = process.env.BOOTSTRAP_SUPER_ADMIN_NAME?.trim();
const email = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD;

if (!name || !email || !password) {
  throw new Error('Set BOOTSTRAP_SUPER_ADMIN_NAME, BOOTSTRAP_SUPER_ADMIN_EMAIL, and BOOTSTRAP_SUPER_ADMIN_PASSWORD for this command.');
}
if (name.length < 2 || name.length > 120) {
  throw new Error('The Super Admin name must be between 2 and 120 characters.');
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error('BOOTSTRAP_SUPER_ADMIN_EMAIL must be a valid email address.');
}
if (password.length < 16 || password.length > 1024) {
  throw new Error('The bootstrap password must be between 16 and 1024 characters.');
}

const prisma = new PrismaClient();

try {
  await prisma.$transaction(async tx => {
    const existingUser = await tx.user.findUnique({ where: { email }, select: { id: true } });
    if (existingUser) throw new Error('A user with the bootstrap email already exists; no account was changed.');

    const existingSuperAdmin = await tx.user.findFirst({
      where: { role: 'SUPER_ADMIN' },
      select: { id: true },
    });
    if (existingSuperAdmin) throw new Error('A Super Admin account already exists; this command only bootstraps a fresh database.');

    const user = await tx.user.create({
      data: {
        name,
        email,
        password: await bcrypt.hash(password, 12),
        role: 'SUPER_ADMIN',
        isActive: true,
      },
      select: { id: true, name: true },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: user.id,
        actorName: user.name,
        action: 'SUPER_ADMIN_BOOTSTRAPPED',
        entityType: 'USER',
        entityId: user.id,
      },
    });
  });

  console.log('The first production Super Admin account was created. Remove the bootstrap credentials from the environment now.');
} finally {
  await prisma.$disconnect();
}
