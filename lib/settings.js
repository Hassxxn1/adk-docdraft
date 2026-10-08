// Departments, document types (review cycles, approval matrix) and general settings, held in the database
// and managed by the Super Admin. lib/config.js provides the first-run defaults (COR-POL-001 clause 5 and
// COR-SOP-001 Appendix 1).
const defaults = require('./config');
const { db, now } = require('./db');

// ---------- First-run seeding ----------
function seed() {
  if (!db.prepare('SELECT 1 FROM departments LIMIT 1').get()) {
    const ins = db.prepare('INSERT INTO departments (code, name, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)');
    for (const d of defaults.DEPARTMENTS) ins.run(d.code, d.name, now(), now());
  }
  if (!getSetting('doc_types')) putSetting('doc_types', defaults.DOC_TYPES, null);
  if (!getSetting('general')) {
    const domains = (process.env.ALLOWED_EMAIL_DOMAINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    putSetting('general', { allowedEmailDomains: domains, draftsPerHour: Number(process.env.DRAFTS_PER_HOUR || 15) }, null);
  }
}

function getSetting(key) {
  const r = db.prepare('SELECT value_json, updated_at, updated_by FROM settings WHERE key = ?').get(key);
  return r ? { value: JSON.parse(r.value_json), updatedAt: r.updated_at, updatedBy: r.updated_by } : null;
}
function putSetting(key, value, user) {
  db.prepare(`INSERT INTO settings (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .run(key, JSON.stringify(value), now(), user ? user.name : null);
}

// ---------- Document types ----------
function docTypes() {
  const s = getSetting('doc_types');
  return s ? s.value : defaults.DOC_TYPES;
}

// A document type plus optional variant (Level 5 form type, Level 6 directive scope) as one definition.
function resolveType(key, variantKey) {
  const base = docTypes()[key];
  if (!base) return null;
  if (!base.variants) return { key, ...base };
  const vk = base.variants[variantKey] ? variantKey : Object.keys(base.variants)[0];
  const { label: variantName, ...overrides } = base.variants[vk];
  return { key, ...base, ...overrides, variantKey: vk, variantName };
}

function general() {
  const s = getSetting('general');
  return s ? s.value : { allowedEmailDomains: [], draftsPerHour: 15 };
}

// ---------- Departments ----------
const deptQ = {
  all: db.prepare(`SELECT d.*, u.name AS head_name FROM departments d LEFT JOIN users u ON u.id = d.head_user_id ORDER BY d.name`),
  byCode: db.prepare('SELECT * FROM departments WHERE code = ?'),
};
const departments = ({ activeOnly = false } = {}) => deptQ.all.all().filter((d) => !activeOnly || d.active);
const department = (code) => deptQ.byCode.get(code) || null;
const deptName = (code) => (department(code) || { name: code }).name;

module.exports = { seed, getSetting, putSetting, docTypes, resolveType, general, departments, department, deptName };
