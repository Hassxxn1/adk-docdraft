// Super Admin: user accounts, roles, departments, settings and the administration audit log.
// Every change is written to admin_events with who made it, when, and what changed.
const express = require('express');
const { db, tx, now, adminEvent } = require('./db');
const settings = require('./settings');
const accounts = require('./accounts');
const { HttpError, wrap, clean } = require('./http');

const r = express.Router();

const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const emailDomainOk = (e) => {
  const domains = settings.general().allowedEmailDomains || [];
  return !domains.length || domains.includes(e.split('@')[1]);
};

// Field-by-field differences for the audit log.
function diff(before, after) {
  const changes = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = JSON.stringify(before[k] ?? null);
    const b = JSON.stringify(after[k] ?? null);
    if (a !== b) changes[k] = { from: before[k] ?? null, to: after[k] ?? null };
  }
  return changes;
}

// ======================================================================
// Users
// ======================================================================
function userRow(u) {
  const pending = db.prepare(`SELECT COUNT(*) AS n FROM documents d JOIN signatories s ON s.document_id = d.id
    WHERE d.status = 'review' AND s.status = 'pending' AND s.email = ?`).get(u.email).n;
  const authored = db.prepare("SELECT COUNT(*) AS n FROM documents WHERE author_email = ? AND status IN ('draft', 'review')").get(u.email).n;
  return {
    id: u.id, email: u.email, name: u.name, designation: u.designation, dept: u.dept_code,
    deptName: u.dept_code ? settings.deptName(u.dept_code) : '', roles: accounts.rolesOf(u), active: !!u.active,
    mustChange: !!u.must_change_password, locked: !!(u.locked_until && u.locked_until > now()),
    lastLogin: u.last_login_at, createdAt: u.created_at, createdBy: u.created_by,
    pendingApprovals: pending, openDrafts: authored,
  };
}

const auditView = (u) => ({ name: u.name, designation: u.designation, department: u.dept_code || null, roles: accounts.rolesOf(u).join(', ') || 'Staff' });

function readUserInput(b, existing) {
  const name = clean(b.name, 120);
  const designation = clean(b.designation, 120);
  const dept = clean(b.dept, 10) || null;
  const roles = [...new Set((Array.isArray(b.roles) ? b.roles : []).filter((x) => accounts.ROLE_KEYS.includes(x)))];
  const problems = [];
  if (!name) problems.push('Enter the full name.');
  if (!designation) problems.push('Enter the designation. It appears in signature tables.');
  if (dept && !settings.department(dept)) problems.push('Choose a valid department.');
  if (!dept && (roles.includes('author') || roles.includes('controller'))) problems.push('Authors and document controllers need a department.');
  if (!existing) {
    const email = clean(b.email, 160).toLowerCase();
    if (!validEmail(email)) problems.push('Enter a valid e-mail address.');
    else if (!emailDomainOk(email)) problems.push(`E-mail addresses must end in ${settings.general().allowedEmailDomains.map((d) => `@${d}`).join(' or ')}.`);
    else if (accounts.getUserByEmail(email)) problems.push('A user with this e-mail already exists.');
    return { problems, values: { email, name, designation, dept, roles } };
  }
  return { problems, values: { name, designation, dept, roles } };
}

r.get('/users', (req, res) => res.json(db.prepare('SELECT * FROM users ORDER BY active DESC, name').all().map(userRow)));

r.post('/users', wrap(async (req, res) => {
  const { problems, values } = readUserInput(req.body || {});
  if (problems.length) throw new HttpError(400, 'Please correct the details.', problems);
  const temp = accounts.tempPassword();
  const id = tx(() => {
    const rr = db.prepare(`INSERT INTO users (email, name, designation, dept_code, roles, active, password_hash, must_change_password, created_at, created_by, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, 1, ?, ?, ?)`).run(values.email, values.name, values.designation, values.dept, values.roles.join(','), accounts.hashPassword(temp), now(), req.user.name, now());
    const newId = Number(rr.lastInsertRowid);
    adminEvent(req.user, 'User created', 'user', values.email, auditView(accounts.getUser(newId)));
    return newId;
  });
  res.json({ ok: true, id, tempPassword: temp });
}));

r.put('/users/:id', wrap(async (req, res) => {
  const u = accounts.getUser(Number(req.params.id));
  if (!u) throw new HttpError(404, 'User not found.');
  const { problems, values } = readUserInput(req.body || {}, u);
  if (u.id === req.user.id && !values.roles.includes('admin')) problems.push('You cannot remove your own Super Admin role. Ask another Super Admin.');
  if (accounts.rolesOf(u).includes('admin') && !values.roles.includes('admin') && accounts.activeAdmins().length <= 1) problems.push('There must always be at least one active Super Admin.');
  if (problems.length) throw new HttpError(400, 'Please correct the details.', problems);
  const before = auditView(u);
  db.prepare('UPDATE users SET name = ?, designation = ?, dept_code = ?, roles = ?, updated_at = ? WHERE id = ?')
    .run(values.name, values.designation, values.dept, values.roles.join(','), now(), u.id);
  const changes = diff(before, auditView(accounts.getUser(u.id)));
  if (Object.keys(changes).length) adminEvent(req.user, changes.roles ? 'User roles changed' : 'User updated', 'user', u.email, changes);
  res.json({ ok: true, user: userRow(accounts.getUser(u.id)) });
}));

r.post('/users/:id/reset-password', wrap(async (req, res) => {
  const u = accounts.getUser(Number(req.params.id));
  if (!u) throw new HttpError(404, 'User not found.');
  const temp = accounts.tempPassword();
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?')
    .run(accounts.hashPassword(temp), now(), u.id);
  db.prepare("DELETE FROM sessions WHERE json_extract(data, '$.userId') = ?").run(u.id); // signs the user out everywhere
  adminEvent(req.user, 'Password reset', 'user', u.email, null);
  res.json({ ok: true, tempPassword: temp });
}));

r.post('/users/:id/active', wrap(async (req, res) => {
  const u = accounts.getUser(Number(req.params.id));
  if (!u) throw new HttpError(404, 'User not found.');
  const active = !!req.body.active;
  if (!active && u.id === req.user.id) throw new HttpError(400, 'You cannot deactivate your own account.');
  if (!active && accounts.rolesOf(u).includes('admin') && accounts.activeAdmins().length <= 1) throw new HttpError(400, 'There must always be at least one active Super Admin.');
  db.prepare('UPDATE users SET active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, now(), u.id);
  if (!active) db.prepare("DELETE FROM sessions WHERE json_extract(data, '$.userId') = ?").run(u.id);
  const reason = clean(req.body.reason, 300);
  adminEvent(req.user, active ? 'User reactivated' : 'User deactivated', 'user', u.email, reason ? { reason } : null);
  const row = userRow(accounts.getUser(u.id));
  res.json({ ok: true, user: row, warning: !active && (row.pendingApprovals || row.openDrafts)
    ? `${u.name} has ${row.pendingApprovals} document(s) waiting for their approval and ${row.openDrafts} draft(s) in progress. The authors can recall those documents and choose another signatory.` : null });
}));

// ======================================================================
// Departments
// ======================================================================
const deptRow = (d) => ({
  id: d.id, code: d.code, name: d.name, headUserId: d.head_user_id, headName: d.head_name || '', active: !!d.active,
  documents: db.prepare('SELECT COUNT(*) AS n FROM documents WHERE dept_code = ?').get(d.code).n,
  users: db.prepare('SELECT COUNT(*) AS n FROM users WHERE dept_code = ? AND active = 1').get(d.code).n,
});
const deptAudit = (d) => ({ code: d.code, name: d.name, head: d.head_user_id ? (accounts.getUser(d.head_user_id) || {}).name : null, active: !!d.active });

r.get('/departments', (req, res) => res.json(settings.departments().map(deptRow)));

function readDept(b) {
  const code = clean(b.code, 10).toUpperCase();
  const name = clean(b.name, 120);
  const head = b.headUserId ? Number(b.headUserId) : null;
  const problems = [];
  if (!/^[A-Z]{2,4}$/.test(code)) problems.push('The code must be 2 to 4 capital letters (Appendix 1 of COR-SOP-001).');
  if (!name) problems.push('Enter the department name.');
  if (head) { const u = accounts.getUser(head); if (!u || !u.active) problems.push('The Head of Department must be an active user.'); }
  return { problems, values: { code, name, head } };
}

r.post('/departments', wrap(async (req, res) => {
  const { problems, values } = readDept(req.body || {});
  if (settings.department(values.code)) problems.push(`Code ${values.code} is already used.`);
  if (problems.length) throw new HttpError(400, 'Please correct the details.', problems);
  db.prepare('INSERT INTO departments (code, name, head_user_id, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(values.code, values.name, values.head, now(), now());
  adminEvent(req.user, 'Department added', 'department', values.code, deptAudit(settings.department(values.code)));
  res.json({ ok: true });
}));

r.put('/departments/:id', wrap(async (req, res) => {
  const d = db.prepare('SELECT * FROM departments WHERE id = ?').get(Number(req.params.id));
  if (!d) throw new HttpError(404, 'Department not found.');
  const { problems, values } = readDept({ ...req.body, code: req.body.code || d.code });
  const active = req.body.active === undefined ? !!d.active : !!req.body.active;
  if (values.code !== d.code) {
    // Codes are part of document numbers, so they can change only while nothing uses them.
    const used = db.prepare('SELECT (SELECT COUNT(*) FROM documents WHERE dept_code = ?) + (SELECT COUNT(*) FROM users WHERE dept_code = ?) AS n').get(d.code, d.code).n;
    if (used) problems.push(`The code ${d.code} is already used in documents or user accounts, so it cannot be changed. Add a new department instead and deactivate this one.`);
    if (settings.department(values.code)) problems.push(`Code ${values.code} is already used.`);
  }
  if (problems.length) throw new HttpError(400, 'Please correct the details.', problems);
  const before = deptAudit(d);
  db.prepare('UPDATE departments SET code = ?, name = ?, head_user_id = ?, active = ?, updated_at = ? WHERE id = ?').run(values.code, values.name, values.head, active ? 1 : 0, now(), d.id);
  const changes = diff(before, deptAudit(db.prepare('SELECT * FROM departments WHERE id = ?').get(d.id)));
  if (Object.keys(changes).length) adminEvent(req.user, changes.active ? (active ? 'Department reactivated' : 'Department deactivated') : 'Department updated', 'department', values.code, changes);
  res.json({ ok: true });
}));

// ======================================================================
// Settings: document types, review cycles, approval matrix, general
// ======================================================================
r.get('/settings', (req, res) => {
  const types = settings.getSetting('doc_types');
  const gen = settings.getSetting('general');
  res.json({
    types: types.value, typesUpdatedAt: types.updatedAt, typesUpdatedBy: types.updatedBy,
    general: gen.value, generalUpdatedAt: gen.updatedAt, generalUpdatedBy: gen.updatedBy,
  });
});

const lines = (v) => (Array.isArray(v) ? v : String(v || '').split(/\r?\n/)).map((x) => clean(x, 120)).filter(Boolean);

function readTypeFields(input, current, problems, label) {
  const out = {};
  if (input.label !== undefined) { out.label = clean(input.label, 80); if (!out.label) problems.push(`${label}: enter a name.`); }
  if (input.prefix !== undefined) { out.prefix = clean(input.prefix, 4).toUpperCase(); if (!/^[A-Z]{2,4}$/.test(out.prefix)) problems.push(`${label}: the prefix must be 2 to 4 capital letters.`); }
  if (input.reviewers !== undefined) { out.reviewers = lines(input.reviewers).slice(0, 5); if (!out.reviewers.length) problems.push(`${label}: name at least one review stage.`); }
  if (input.finalApproval !== undefined) { out.finalApproval = clean(input.finalApproval, 120); if (!out.finalApproval) problems.push(`${label}: name the final approval authority.`); }
  return out;
}

r.put('/settings/types/:key', wrap(async (req, res) => {
  const types = JSON.parse(JSON.stringify(settings.docTypes()));
  const t = types[req.params.key];
  if (!t) throw new HttpError(404, 'Unknown document type.');
  const b = req.body || {};
  const problems = [];
  const before = JSON.parse(JSON.stringify(t));
  Object.assign(t, readTypeFields(b, t, problems, t.label));
  if (b.colour !== undefined) { const c = clean(b.colour, 7).replace('#', '').toUpperCase(); if (!/^[0-9A-F]{6}$/.test(c)) problems.push('The colour must be a six-digit hex code, e.g. FEAD77.'); else t.colour = c; }
  if (b.reviewYears !== undefined) {
    const y = b.reviewYears === '' || b.reviewYears === null ? null : Number(b.reviewYears);
    if (y !== null && (!Number.isInteger(y) || y < 1 || y > 10)) problems.push('The review cycle must be 1 to 10 years, or blank for "as needed".');
    else t.reviewYears = y;
  }
  if (b.reviewText !== undefined) { t.reviewText = clean(b.reviewText, 120); if (!t.reviewText) problems.push('Describe the review cycle, e.g. "Every 2 years".'); }
  if (b.rollout !== undefined) t.rollout = clean(b.rollout, 300);
  if (b.variants && t.variants) {
    for (const [vk, vin] of Object.entries(b.variants)) {
      if (!t.variants[vk]) continue;
      Object.assign(t.variants[vk], readTypeFields(vin, t.variants[vk], problems, `${t.label} – ${t.variants[vk].label || vk}`));
    }
  }
  if (problems.length) throw new HttpError(400, 'Please correct the settings.', problems);
  const changes = diff(before, t);
  if (!Object.keys(changes).length) return res.json({ ok: true, unchanged: true });
  settings.putSetting('doc_types', types, req.user);
  adminEvent(req.user, 'Document type settings changed', 'setting', `${t.label} (Level ${t.level})`, changes);
  res.json({ ok: true });
}));

r.put('/settings/general', wrap(async (req, res) => {
  const before = settings.general();
  const after = { ...before };
  const problems = [];
  if (req.body.allowedEmailDomains !== undefined) {
    after.allowedEmailDomains = lines(req.body.allowedEmailDomains).map((d) => d.toLowerCase().replace(/^@/, ''));
    if (after.allowedEmailDomains.some((d) => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))) problems.push('Enter each e-mail domain on its own line, e.g. adkhospital.com');
  }
  if (req.body.draftsPerHour !== undefined) {
    after.draftsPerHour = Number(req.body.draftsPerHour);
    if (!Number.isInteger(after.draftsPerHour) || after.draftsPerHour < 1 || after.draftsPerHour > 200) problems.push('Drafts per hour must be between 1 and 200.');
  }
  if (problems.length) throw new HttpError(400, 'Please correct the settings.', problems);
  const changes = diff(before, after);
  if (Object.keys(changes).length) {
    settings.putSetting('general', after, req.user);
    adminEvent(req.user, 'General settings changed', 'setting', 'General', changes);
  }
  res.json({ ok: true });
}));

// ======================================================================
// Administration audit log
// ======================================================================
function auditRows(q, limit) {
  const term = `%${clean(q, 100).toLowerCase()}%`;
  return db.prepare(`SELECT * FROM admin_events WHERE ? = '%%' OR lower(action || ' ' || COALESCE(target, '') || ' ' || COALESCE(user_name, '') || ' ' || COALESCE(details, '')) LIKE ?
    ORDER BY id DESC LIMIT ?`).all(term, term, limit).map((e) => ({ at: e.at, user: e.user_name, email: e.user_email, action: e.action, targetType: e.target_type, target: e.target, details: e.details ? JSON.parse(e.details) : null }));
}
r.get('/audit', (req, res) => res.json(auditRows(req.query.q, 500)));
r.get('/audit.csv', (req, res) => {
  const rows = auditRows(req.query.q, 100000);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['When,By,Action,Target type,Target,Details', ...rows.map((e) => [e.at, e.user, e.action, e.targetType, e.target, e.details ? JSON.stringify(e.details) : ''].map(esc).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="ADK portal admin audit log.csv"');
  res.send('﻿' + csv);
});

module.exports = r;
