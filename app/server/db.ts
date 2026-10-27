import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });

export const dbPath = path.join(config.dataDir, 'app.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

const CONTENT_TABLES = [
  'paper_questions',
  'options',
  'questions',
  'materials',
  'paper_modules',
  'papers',
] as const;

const USER_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT,
  pin_hash TEXT,
  created_at INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  paper_id TEXT NOT NULL,
  duration_sec INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  deadline_at INTEGER NOT NULL,
  submitted_at INTEGER,
  status TEXT NOT NULL,
  correct_count INTEGER,
  scored_total INTEGER,
  total INTEGER,
  elapsed_sec INTEGER,
  expire_reason TEXT
);
CREATE INDEX IF NOT EXISTS ix_attempts_profile ON attempts(profile_id, started_at DESC);

CREATE TABLE IF NOT EXISTS attempt_answers (
  attempt_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  choice TEXT NOT NULL DEFAULT '',
  flagged INTEGER NOT NULL DEFAULT 0,
  answered_at INTEGER,
  PRIMARY KEY(attempt_id, question_id)
);

CREATE TABLE IF NOT EXISTS practice_sessions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  filter_json TEXT NOT NULL,
  questions_json TEXT NOT NULL,
  immediate INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  total INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_practice_profile ON practice_sessions(profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS practice_answers (
  session_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  choice TEXT NOT NULL DEFAULT '',
  is_correct INTEGER,
  revealed INTEGER NOT NULL DEFAULT 0,
  answered_at INTEGER,
  PRIMARY KEY(session_id, question_id)
);

CREATE TABLE IF NOT EXISTS wrong_book (
  profile_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  wrong_count INTEGER NOT NULL DEFAULT 1,
  correct_streak INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL,
  last_wrong_at INTEGER NOT NULL,
  mastered INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(profile_id, question_id)
);
CREATE INDEX IF NOT EXISTS ix_wrong_profile ON wrong_book(profile_id, mastered, last_wrong_at DESC);

CREATE TABLE IF NOT EXISTS favorites (
  profile_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY(profile_id, question_id)
);

CREATE TABLE IF NOT EXISTS question_flags (
  profile_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(profile_id, question_id)
);
CREATE INDEX IF NOT EXISTS ix_flags_profile ON question_flags(profile_id, created_at DESC);
`;

const CONTENT_SCHEMA = `
CREATE TABLE IF NOT EXISTS papers (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  province TEXT NOT NULL,
  name TEXT NOT NULL,
  question_count INTEGER NOT NULL,
  material_count INTEGER NOT NULL DEFAULT 0,
  source_file TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_papers_identity ON papers(year, province, name);

CREATE TABLE IF NOT EXISTS paper_modules (
  paper_id TEXT NOT NULL,
  module TEXT NOT NULL,
  ord INTEGER NOT NULL,
  question_count INTEGER NOT NULL,
  PRIMARY KEY(paper_id, module)
);

CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL,
  module TEXT NOT NULL,
  module_ord INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  html TEXT NOT NULL,
  has_missing_image INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_materials_paper ON materials(paper_id, module_ord, ordinal);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  qid TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  stem_html TEXT NOT NULL,
  analysis_html TEXT NOT NULL,
  answer TEXT NOT NULL,
  option_count INTEGER NOT NULL,
  scorable INTEGER NOT NULL,
  has_image INTEGER NOT NULL,
  has_missing_image INTEGER NOT NULL,
  content_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS options (
  question_id TEXT NOT NULL,
  letter TEXT NOT NULL,
  html TEXT NOT NULL,
  is_correct INTEGER NOT NULL,
  ord INTEGER NOT NULL,
  PRIMARY KEY(question_id, letter)
);

CREATE TABLE IF NOT EXISTS paper_questions (
  paper_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  module TEXT NOT NULL,
  module_ord INTEGER NOT NULL,
  tag TEXT NOT NULL,
  material_id TEXT,
  PRIMARY KEY(paper_id, ord)
);
CREATE INDEX IF NOT EXISTS ix_pq_question ON paper_questions(question_id);
CREATE INDEX IF NOT EXISTS ix_pq_tag ON paper_questions(tag, question_id);
CREATE INDEX IF NOT EXISTS ix_pq_module ON paper_questions(module, question_id);
`;

let contentReady = false;

export function tableExists(name: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
}

export function ensureSchema(): void {
  db.exec(USER_SCHEMA);
  const wrongCols = db.prepare('PRAGMA table_info(wrong_book)').all() as { name: string }[];
  if (!wrongCols.some((c) => c.name === 'correct_streak')) {
    db.exec('ALTER TABLE wrong_book ADD COLUMN correct_streak INTEGER NOT NULL DEFAULT 0');
  }
  db.prepare(`INSERT OR IGNORE INTO profiles(id, name, color, created_at) VALUES (?, ?, ?, ?)`)
    .run('default', '我', '#4f6ef7', Date.now());
}

export function dropContentTables(): void {
  db.exec('BEGIN');
  try {
    for (const t of CONTENT_TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`);
    db.exec(CONTENT_SCHEMA);
    db.exec('COMMIT');
    contentReady = false;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function markContentReady(): void {
  contentReady = true;
}

export function isContentReady(): boolean {
  return contentReady;
}

export function getMeta(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setMeta(key: string, value: string): void {
  db.prepare(
    `INSERT INTO meta(key, value) VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export type ProfileRow = {
  id: string;
  name: string;
  color: string | null;
  pin_hash: string | null;
  created_at: number;
  archived_at: number | null;
};

export function getProfile(id: string): ProfileRow | undefined {
  return db
    .prepare('SELECT * FROM profiles WHERE id = ? AND archived_at IS NULL')
    .get(id) as ProfileRow | undefined;
}

ensureSchema();
