import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to seed a Super Admin account in production. Create production administrators through the controlled account-provisioning process.');
}

const name = process.env.BOOTSTRAP_SUPER_ADMIN_NAME?.trim();
const email = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD;

if (!name || !email || !password) {
  throw new Error('Set BOOTSTRAP_SUPER_ADMIN_NAME, BOOTSTRAP_SUPER_ADMIN_EMAIL, and BOOTSTRAP_SUPER_ADMIN_PASSWORD before seeding.');
}
if (password.length < 16) {
  throw new Error('BOOTSTRAP_SUPER_ADMIN_PASSWORD must be at least 16 characters long.');
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error('BOOTSTRAP_SUPER_ADMIN_EMAIL must be a valid email address.');
}

const prisma = new PrismaClient();

try {
  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existingUser) {
    console.log('A user with the bootstrap email already exists; no account data was changed.');
  } else {
    await prisma.user.create({
      data: {
        name,
        email,
        password: await bcrypt.hash(password, 12),
        role: 'SUPER_ADMIN',
        isActive: true,
      },
    });
    console.log('Bootstrap Super Admin account created.');
  }
} finally {
  await prisma.$disconnect();
}
