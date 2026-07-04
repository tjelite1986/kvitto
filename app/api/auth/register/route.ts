import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { hashSync } from 'bcryptjs';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

// Open registration only bootstraps the first account (which becomes admin).
// After that, accounts are created by an admin.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, email, password, confirmPassword } = body;

  if (!name || !email || !password) {
    return NextResponse.json({ error: 'Name, email and password are required' }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
  }
  if (password !== confirmPassword) {
    return NextResponse.json({ error: 'Passwords do not match' }, { status: 400 });
  }

  const { count } = db.get<{ count: number }>(sql`SELECT COUNT(*) as count FROM users`)!;
  if (count > 0) {
    return NextResponse.json(
      { error: 'Registration is closed. Ask the admin for an account.' },
      { status: 403 }
    );
  }

  const passwordHash = hashSync(password, 10);
  const user = db
    .insert(users)
    .values({ name, email, passwordHash, role: 'admin' })
    .returning()
    .get();

  return NextResponse.json({ id: user.id, name: user.name, email: user.email });
}
