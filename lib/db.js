// Portal database (SQLite, built into Node.js 22). One file under DATA_DIR, plus uploaded and issued files.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILES_DIR = path.join(DATA_DIR, 'files');
fs.mkdirSync(FILES_DIR, { recursive: true });

const db = new DatabaseSync(process.env.DB_FILE || path.join(DATA_DIR, 'docportal.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS documents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  type_key        TEXT NOT NULL,
  variant         TEXT,
  prefix          TEXT NOT NULL,      -- numbering prefix for this document (POL, SOP, PRT, GLN, FRM, TMP, CHK, REG, DIR)
  dept_code       TEXT NOT NULL,
  title           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft',   -- draft | review | hr | signing | issued | obsolete | withdrawn
  sign_method     TEXT NOT NULL DEFAULT 'electronic', -- electronic | wet
  confidentiality TEXT NOT NULL DEFAULT 'Internal Use',
  applies_to      TEXT,
  owner           TEXT,
  parent_policy   TEXT,
  clinical_impact TEXT NOT NULL DEFAULT 'No',
  effective_from  TEXT,   -- directives: effective from (as entered)
  expiry          TEXT,   -- directives: expiry or review date (as entered)
  content_json    TEXT NOT NULL,
  ai              INTEGER NOT NULL DEFAULT 0,
  author_email    TEXT NOT NULL,
  author_name     TEXT NOT NULL,
  author_designation TEXT,
  submitted_at    TEXT,
  change_summary  TEXT,
  change_clauses  TEXT,
  base_id         INTEGER,            -- first version's id; shared by all versions of one document
  supersedes_id   INTEGER,            -- previous version's id
  version         INTEGER NOT NULL DEFAULT 1,
  seq             INTEGER,            -- register number, assigned by HR
  doc_id          TEXT UNIQUE,        -- e.g. QSD-SOP-004-V2, assigned by HR
  effective_date  TEXT,               -- ISO date, set by HR at issue
  review_date     TEXT,               -- ISO date
  numbered_at     TEXT,
  numbered_by     TEXT,
  issued_at       TEXT,
  issued_by_name  TEXT,
  issued_by_email TEXT,
  issued_file     TEXT,
  signed_file     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docs_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_docs_author ON documents(author_email);
CREATE INDEX IF NOT EXISTS idx_docs_number ON documents(dept_code, prefix, seq);

CREATE TABLE IF NOT EXISTS signatories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id  INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  stage        TEXT NOT NULL,
  email        TEXT NOT NULL,
  name         TEXT,
  designation  TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | approved
  acted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_sig_email ON signatories(email);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  at          TEXT NOT NULL,
  user_email  TEXT,
  user_name   TEXT,
  action      TEXT NOT NULL,
  comment     TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_doc ON events(document_id);

CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  email                TEXT NOT NULL UNIQUE,      -- lower case; the identity used throughout the document records
  name                 TEXT NOT NULL,
  designation          TEXT NOT NULL DEFAULT '',
  dept_code            TEXT,
  roles                TEXT NOT NULL DEFAULT '',  -- comma list: admin, hr, controller, author, signatory (every user is staff)
  active               INTEGER NOT NULL DEFAULT 1,
  password_hash        TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  failed_attempts      INTEGER NOT NULL DEFAULT 0,
  locked_until         TEXT,
  last_login_at        TEXT,
  created_at           TEXT NOT NULL,
  created_by           TEXT,
  updated_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS departments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  head_user_id  INTEGER REFERENCES users(id),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);

-- Administration audit log: users, roles, departments, settings and security events.
CREATE TABLE IF NOT EXISTS admin_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT NOT NULL,
  user_email   TEXT,
  user_name    TEXT,
  action       TEXT NOT NULL,
  target_type  TEXT,
  target       TEXT,
  details      TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_events_at ON admin_events(at);
`);

// Upgrades from version 2.0: signatories now point to a user account.
if (!db.prepare("SELECT 1 FROM pragma_table_info('signatories') WHERE name = 'user_id'").get()) {
  db.exec('ALTER TABLE signatories ADD COLUMN user_id INTEGER REFERENCES users(id)');
}

const now = () => new Date().toISOString();

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

const q = {
  getDoc: db.prepare('SELECT * FROM documents WHERE id = ?'),
  sigs: db.prepare('SELECT * FROM signatories WHERE document_id = ? ORDER BY position'),
  events: db.prepare('SELECT * FROM events WHERE document_id = ? ORDER BY id'),
  addEvent: db.prepare('INSERT INTO events (document_id, at, user_email, user_name, action, comment) VALUES (?, ?, ?, ?, ?, ?)'),
  versions: db.prepare('SELECT * FROM documents WHERE base_id = ? ORDER BY version'),
};

function getDoc(id) {
  const d = q.getDoc.get(id);
  if (!d) return null;
  d.content = JSON.parse(d.content_json);
  return d;
}

function addEvent(docId, user, action, comment) {
  q.addEvent.run(docId, now(), user ? user.email : null, user ? user.name : 'System', action, comment || null);
}

function updateDoc(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sql = `UPDATE documents SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`;
  db.prepare(sql).run(...keys.map((k) => fields[k]), now(), id);
}

function insertDoc(fields) {
  const f = { ...fields, created_at: now(), updated_at: now() };
  const keys = Object.keys(f);
  const r = db.prepare(`INSERT INTO documents (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => f[k]));
  const id = Number(r.lastInsertRowid);
  if (!fields.base_id) db.prepare('UPDATE documents SET base_id = ? WHERE id = ?').run(id, id);
  return id;
}

function replaceSignatories(docId, rows) {
  db.prepare('DELETE FROM signatories WHERE document_id = ?').run(docId);
  const ins = db.prepare('INSERT INTO signatories (document_id, position, stage, email, name, designation, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
  rows.forEach((r, i) => ins.run(docId, i, r.stage, r.email || '', r.name || null, r.designation || null, r.userId || null));
}

// Administration audit log entry. details: an object (e.g. { before, after }) – never passwords.
function adminEvent(user, action, targetType, target, details) {
  db.prepare('INSERT INTO admin_events (at, user_email, user_name, action, target_type, target, details) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(now(), user ? user.email : null, user ? user.name : 'System', action, targetType || null, target || null, details ? JSON.stringify(details) : null);
}

module.exports = { db, q, tx, now, getDoc, addEvent, updateDoc, insertDoc, replaceSignatories, adminEvent, DATA_DIR, FILES_DIR };
