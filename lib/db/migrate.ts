// Manual schema bootstrap/migration runner.
// Usage: npx tsx lib/db/migrate.ts [db-path]
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { bootstrapSchema } from './bootstrap';

const dbDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = process.argv[2] ?? path.join(dbDir, 'kvitto.db');
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

bootstrapSchema(sqlite);

console.log('Database migrated successfully:', dbPath);
sqlite.close();
