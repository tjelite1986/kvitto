// Creates the initial admin user if the users table is empty.
// Usage: ADMIN_EMAIL=... ADMIN_PASSWORD=... npx tsx scripts/seed.ts [db-path]
import Database from 'better-sqlite3';
import { hashSync } from 'bcryptjs';
import path from 'path';

const dbPath = process.argv[2] ?? path.join(process.cwd(), 'data', 'kvitto.db');
const sqlite = new Database(dbPath);

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME ?? 'Admin';

if (!email || !password) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD environment variables.');
  process.exit(1);
}

const { count } = sqlite.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
if (count > 0) {
  console.log('Users already exist, skipping seed.');
  process.exit(0);
}

sqlite
  .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
  .run(name, email, hashSync(password, 10), 'admin');

console.log(`Admin user ${email} created.`);
sqlite.close();
