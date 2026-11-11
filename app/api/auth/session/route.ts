import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/app/actions/auth-actions';

export async function GET() {
  return NextResponse.json({ user: await getCurrentUser() });
}
