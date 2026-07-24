import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { bootstrapSchema } from './bootstrap';
import path from 'path';
import fs from 'fs';

const dbDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'kvitto.db');
export const sqlite = new Database(dbPath);
// busy_timeout FIRST: the journal_mode switch itself needs the write lock, and
// parallel next-build workers open this DB concurrently.
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// Idempotent — makes a fresh container/volume work without a migrate step.
bootstrapSchema(sqlite);

export const db = drizzle(sqlite, { schema });
