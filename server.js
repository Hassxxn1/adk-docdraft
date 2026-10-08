// ADK Hospital Document Portal
// Drafting, review, approval, numbering and issue of controlled documents under the
// Document Governance Policy (COR-POL-001) and SOP (COR-SOP-001).
require('dotenv').config();
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 13)) {
  console.error(`ADK Document Portal needs Node.js 22.13 or later; this server runs ${process.versions.node}.`);
  process.exit(1);
}
const VERSION = require('./package.json').version;
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const msal = require('@azure/msal-node');

const { db, q, tx, now, getDoc, addEvent, updateDoc, insertDoc, replaceSignatories, adminEvent, DATA_DIR, FILES_DIR } = require('./lib/db');
const settings = require('./lib/settings');
const accounts = require('./lib/accounts');
const { draft } = require('./lib/ai');
const { buildDocx } = require('./lib/docgen');
const { renderHtml } = require('./lib/preview');
const sections = require('./lib/sections');
const wf = require('./lib/workflow');
const notify = require('./lib/notify');
const { SqliteStore } = require('./lib/session-store');
const adminRoutes = require('./lib/admin-routes');
const { HttpError, wrap, clean } = require('./lib/http');

const PROD = process.env.NODE_ENV !== 'development';
const PORT = process.env.PORT || 3000;
const MICROSOFT = !!(process.env.TENANT_ID && process.env.CLIENT_ID && process.env.CLIENT_SECRET && process.env.REDIRECT_URI);

if (process.env.AUTH_MODE === 'none') {
  console.error('AUTH_MODE=none (testing sign-in) has been removed: it allowed anyone to sign in as anyone. Remove AUTH_MODE from the settings and create user accounts instead (see README).');
  process.exit(1);
}
if (PROD && !process.env.SESSION_SECRET) { console.error('SESSION_SECRET must be set. Generate a long random value (see README).'); process.exit(1); }

settings.seed();
bootstrapAdmin();

// First Super Admin: created from ADMIN_EMAIL / ADMIN_PASSWORD when the portal has no active Super Admin.
function bootstrapAdmin() {
  if (accounts.activeAdmins().length) return;
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !password) {
    console.warn('No Super Admin exists yet. Set ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD (temporary) and restart, or run: npm run create-admin -- <e-mail> "<name>"');
    return;
  }
  const existing = accounts.getUserByEmail(email);
  if (existing) {
    const roles = new Set([...accounts.rolesOf(existing), 'admin']);
    db.prepare('UPDATE users SET roles = ?, active = 1, password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?')
      .run([...roles].join(','), accounts.hashPassword(password), now(), existing.id);
  } else {
    db.prepare(`INSERT INTO users (email, name, designation, roles, password_hash, must_change_password, created_at, created_by, updated_at)
      VALUES (?, ?, ?, 'admin', ?, 1, ?, 'Setup', ?)`).run(email, process.env.ADMIN_NAME || 'Super Admin', process.env.ADMIN_DESIGNATION || '', accounts.hashPassword(password), now(), now());
  }
  adminEvent(null, 'Super Admin created at setup', 'user', email, null);
  console.log(`Super Admin ${email} is ready. Sign in with the ADMIN_PASSWORD value; you will be asked to choose a new password. Then remove ADMIN_PASSWORD from the settings.`);
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:'], styleSrc: ["'self'", "'unsafe-inline'"] } } }));
app.use(session({
  name: 'adkdocs.sid',
  store: new SqliteStore(),
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 8 * 60 * 60 * 1000 },
}));

const noCache = (res) => res.setHeader('Cache-Control', 'no-cache, must-revalidate');
const page = (name) => (req, res) => { noCache(res); res.sendFile(path.join(__dirname, 'public', name)); };

// ---------- Sign-in ----------
function startSession(req, res, user, method) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.method = method;
      resolve();
    });
  });
}

// Simple per-address limit on sign-in attempts, alongside the per-account lockout.
const attempts = new Map();
function tooManyAttempts(ip) {
  const t = Date.now();
  const list = (attempts.get(ip) || []).filter((x) => t - x < 15 * 60000);
  list.push(t); attempts.set(ip, list);
  return list.length > 30;
}

app.get('/login', (req, res) => (req.session.userId ? res.redirect('/') : page('login.html')(req, res)));
app.get('/login.js', page('login.js'));
app.get('/auth/options', (req, res) => res.json({ microsoft: MICROSOFT, setupNeeded: accounts.activeAdmins().length === 0 }));

app.post('/auth/login', express.json({ limit: '10kb' }), wrap(async (req, res) => {
  if (tooManyAttempts(req.ip)) throw new HttpError(429, 'Too many sign-in attempts from this network. Wait 15 minutes and try again.');
  const email = clean(req.body.email, 160).toLowerCase();
  const r = accounts.checkLogin(email, String(req.body.password || ''));
  if (r.error) {
    if (r.failedUser) adminEvent({ email, name: r.failedUser.name }, r.lockedNow ? 'Account locked after failed sign-ins' : 'Failed sign-in', 'user', email, null);
    if (r.inactive) adminEvent({ email, name: r.inactive.name }, 'Sign-in refused: account deactivated', 'user', email, null);
    throw new HttpError(401, r.error);
  }
  await startSession(req, res, r.user, 'password');
  res.json({ ok: true, mustChange: !!r.user.must_change_password });
}));

let cca;
if (MICROSOFT) {
  cca = new msal.ConfidentialClientApplication({
    auth: { clientId: process.env.CLIENT_ID, authority: `https://login.microsoftonline.com/${process.env.TENANT_ID}`, clientSecret: process.env.CLIENT_SECRET },
  });
}
app.get('/auth/microsoft', wrap(async (req, res) => {
  if (!MICROSOFT) throw new HttpError(404, 'Microsoft sign-in is not set up.');
  req.session.authState = crypto.randomBytes(16).toString('hex');
  res.redirect(await cca.getAuthCodeUrl({ scopes: ['openid', 'profile', 'email'], redirectUri: process.env.REDIRECT_URI, state: req.session.authState, prompt: 'select_account' }));
}));
app.get('/auth/redirect', wrap(async (req, res) => {
  if (!MICROSOFT) throw new HttpError(404, 'Microsoft sign-in is not set up.');
  if (!req.query.code || req.query.state !== req.session.authState) return res.redirect('/login?e=verify');
  const r = await cca.acquireTokenByCode({ code: req.query.code, scopes: ['openid', 'profile', 'email'], redirectUri: process.env.REDIRECT_URI });
  const claims = r.idTokenClaims || {};
  if (claims.tid !== process.env.TENANT_ID) return res.redirect('/login?e=tenant');
  // Microsoft confirms who the person is; the portal account decides whether they may sign in and what they can do.
  const email = String(claims.preferred_username || r.account.username).toLowerCase();
  const u = accounts.getUserByEmail(email);
  if (!u || !u.active) {
    adminEvent({ email, name: claims.name || email }, 'Microsoft sign-in refused: no active portal account', 'user', email, null);
    return res.redirect('/login?e=noaccount');
  }
  accounts.recordLogin(u);
  // An unused temporary password is cancelled: this person signs in through Microsoft (a portal password can be set later in My account).
  if (u.must_change_password) db.prepare('UPDATE users SET must_change_password = 0, password_hash = NULL WHERE id = ?').run(u.id);
  await startSession(req, res, u, 'microsoft');
  res.redirect('/');
}));

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/signed-out')));
app.get('/signed-out', page('signed-out.html'));

// Every request reloads the account, so deactivation and role changes apply at once.
function requireUser(req, res, next) {
  const u = req.session.userId ? accounts.getUser(req.session.userId) : null;
  if (!u || !u.active) {
    if (req.session.userId) req.session.destroy(() => {});
    if (req.path.startsWith('/api/') || req.baseUrl.startsWith('/api')) return res.status(401).json({ error: 'Your session has ended. Please sign in again.' });
    return res.redirect('/login');
  }
  req.user = accounts.sessionUser(u);
  req.user.method = req.session.method;
  // A temporary password must be changed before anything else.
  const allowed = ['/me', '/account/password'];
  if (req.user.mustChange && req.baseUrl === '/api' && !allowed.includes(req.path)) return res.status(403).json({ error: 'Choose a new password first.', code: 'password_change_required' });
  next();
}
const requireRole = (flag, label) => (req, res, next) => (req.user[flag] ? next() : next(new HttpError(403, `Only ${label} can do this.`)));
const requireHR = requireRole('isHR', 'HR');

// ---------- Static app ----------
app.get('/health', (req, res) => res.json({ ok: true, app: 'ADK Document Portal', version: VERSION, node: process.versions.node }));
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets'), { maxAge: '1d' }));
app.get('/', requireUser, page('index.html'));
app.get('/app.js', requireUser, page('app.js'));
app.get('/admin.js', requireUser, page('admin.js'));
app.get('/styles.css', page('styles.css'));

const api = express.Router();
api.use(requireUser);
api.use(express.json({ limit: '400kb' }));

// ---------- Helpers ----------
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
const todayIso = () => new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10); // Maldives date
const pad3 = (n) => String(n).padStart(3, '0');
const CONFIDENTIALITY = ['Public', 'Internal Use', 'Confidential', 'Highly Confidential'];

function loadDoc(req) {
  const doc = getDoc(Number(req.params.id));
  if (!doc) throw new HttpError(404, 'Document not found.');
  const sigs = q.sigs.all(doc.id);
  const can = wf.permissions(doc, sigs, req.user);
  if (!can.view) throw new HttpError(403, 'You do not have access to this document.');
  return { doc, sigs, can, type: wf.typeOf(doc) };
}

const typeName = (type) => (type.variantName ? `${type.label} – ${type.variantName.split(' – ')[0]}` : type.label);

function summary(d) {
  const sigs = q.sigs.all(d.id);
  const current = wf.currentSignatory(d, sigs);
  const type = settings.resolveType(d.type_key, d.variant) || { label: d.type_key, level: '', colour: 'DDDDDD' };
  return {
    id: d.id, title: d.title, status: d.status, statusName: wf.STATUS_NAMES[d.status], docId: d.doc_id,
    pendingId: `${d.dept_code}-${d.prefix}-NNN-V${d.version}`, version: d.version,
    type: typeName(type), level: type.level, colour: type.colour,
    dept: d.dept_code, deptName: settings.deptName(d.dept_code), author: d.author_name, signMethod: d.sign_method,
    waitingOn: current ? (current.name || current.email) : null, effectiveDate: d.effective_date, reviewDate: d.review_date,
    confidentiality: d.confidentiality, updatedAt: d.updated_at, issuedAt: d.issued_at,
  };
}

async function docxFor(doc, statusOverride) {
  const { type, meta } = wf.buildMeta(doc, statusOverride);
  return buildDocx(type, meta, JSON.parse(doc.content_json));
}

// Freezes the issued Word file so the controlled copy never changes after issue.
async function freezeIssued(id) {
  const doc = getDoc(id);
  const buf = await docxFor(doc, 'issued');
  const name = `${doc.doc_id}.docx`;
  fs.writeFileSync(path.join(FILES_DIR, name), buf);
  updateDoc(id, { issued_file: name });
}

function obsoletePrevious(doc, user) {
  if (!doc.supersedes_id) return;
  const prev = getDoc(doc.supersedes_id);
  if (prev && prev.status === 'issued') {
    updateDoc(prev.id, { status: 'obsolete' });
    addEvent(prev.id, user, 'Made obsolete', `Superseded by ${doc.doc_id}`);
  }
}

const hrRecipients = () => db.prepare("SELECT email FROM users WHERE active = 1 AND (',' || roles || ',') LIKE '%,hr,%'").all().map((r) => r.email)
  .concat(process.env.HR_NOTIFY_EMAIL ? [process.env.HR_NOTIFY_EMAIL] : []);

// Users who may be named as reviewers or approvers.
const signatoryUsers = () => db.prepare(`SELECT u.id, u.email, u.name, u.designation, u.dept_code FROM users u
  WHERE u.active = 1 AND (',' || u.roles || ',') LIKE '%,signatory,%' ORDER BY u.name`).all();

// ---------- Configuration ----------
api.get('/me', (req, res) => {
  const types = settings.docTypes();
  res.json({
    version: VERSION,
    user: req.user,
    userDeptName: req.user.dept ? settings.deptName(req.user.dept) : null,
    aiEnabled: !!process.env.ANTHROPIC_API_KEY,
    notifications: notify.enabled(),
    departments: settings.departments({ activeOnly: true }).map((d) => ({ code: d.code, name: d.name })),
    statusNames: wf.STATUS_NAMES,
    roleNames: accounts.ROLES,
    types: Object.fromEntries(Object.entries(types).map(([k, v]) => [k, {
      label: v.label, level: v.level, prefix: v.prefix, colour: v.colour, template: v.template,
      reviewText: v.reviewText, finalApproval: v.finalApproval, forceDept: v.forceDept || null, clinical: !!v.clinical,
      variantLabel: v.variantLabel || null,
      variants: v.variants ? Object.fromEntries(Object.entries(v.variants).map(([vk, vv]) => [vk, {
        label: vv.label, prefix: vv.prefix || v.prefix, forceDept: vv.forceDept || null,
        finalApproval: vv.finalApproval || v.finalApproval, clinical: !!(vv.clinical || v.clinical),
      }])) : null,
    }])),
  });
});

api.post('/account/password', wrap(async (req, res) => {
  const u = accounts.getUser(req.user.id);
  const current = String(req.body.current || '');
  const next = String(req.body.password || '');
  if (u.password_hash && !accounts.verifyPassword(current, u.password_hash)) throw new HttpError(400, 'Your current password is not correct.');
  const problem = accounts.passwordProblem(next, u.email);
  if (problem) throw new HttpError(400, problem);
  if (u.password_hash && accounts.verifyPassword(next, u.password_hash)) throw new HttpError(400, 'Choose a password different from the current one.');
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?').run(accounts.hashPassword(next), now(), u.id);
  // Sign out other sessions of this user.
  db.prepare("DELETE FROM sessions WHERE sid <> ? AND json_extract(data, '$.userId') = ?").run(req.sessionID, u.id);
  adminEvent(req.user, 'Password changed', 'user', u.email, null);
  res.json({ ok: true });
}));

// Reviewers and approvers an author can choose from.
api.get('/signatories', (req, res) => {
  res.json(signatoryUsers().filter((u) => u.email !== req.user.email).map((u) => ({
    id: u.id, name: u.name, designation: u.designation, dept: u.dept_code, deptName: u.dept_code ? settings.deptName(u.dept_code) : '',
  })));
});

// ---------- Lists ----------
api.get('/work', (req, res) => {
  const email = req.user.email;
  const tasks = db.prepare(`SELECT d.* FROM documents d WHERE d.status = 'review' AND (
      SELECT s.email FROM signatories s WHERE s.document_id = d.id AND s.status = 'pending' ORDER BY s.position LIMIT 1) = ?
      ORDER BY d.updated_at DESC`).all(email).map(summary);
  const mine = db.prepare(`SELECT * FROM documents WHERE author_email = ? AND status NOT IN ('withdrawn') ORDER BY updated_at DESC LIMIT 100`).all(email).map((d) => {
    const s = summary(d);
    const last = db.prepare('SELECT action, comment FROM events WHERE document_id = ? ORDER BY id DESC LIMIT 1').get(d.id);
    s.returned = d.status === 'draft' && last && last.action === 'Returned to author' ? last.comment : null;
    return s;
  });
  const involved = db.prepare(`SELECT DISTINCT d.* FROM documents d JOIN signatories s ON s.document_id = d.id
      WHERE s.email = ? AND d.author_email <> ? AND d.status NOT IN ('draft', 'withdrawn') ORDER BY d.updated_at DESC LIMIT 50`).all(email, email).map(summary);
  const depts = req.user.oversees;
  const department = depts.length ? db.prepare(`SELECT * FROM documents WHERE dept_code IN (${depts.map(() => '?').join(',')})
      AND status NOT IN ('withdrawn', 'obsolete') ORDER BY updated_at DESC LIMIT 100`).all(...depts).map(summary) : [];
  const hr = req.user.isHR ? db.prepare(`SELECT * FROM documents WHERE status IN ('hr', 'signing') ORDER BY updated_at`).all().map(summary) : [];
  const dueSoon = (req.user.isHR || depts.length) ? db.prepare(`SELECT * FROM documents WHERE status = 'issued' AND review_date IS NOT NULL AND review_date <= date('now', '+60 days') ORDER BY review_date`).all()
    .filter((d) => req.user.isHR || depts.includes(d.dept_code)).map(summary) : [];
  res.json({ tasks, mine, involved, department, hr, dueSoon });
});

function registerRows(user) {
  const rows = db.prepare(`SELECT * FROM documents WHERE status NOT IN ('withdrawn') ORDER BY dept_code, prefix, seq, version`).all();
  return rows.filter((d) => {
    if (['issued', 'obsolete'].includes(d.status)) return wf.permissions(d, q.sigs.all(d.id), user).view;
    return user.isHR || user.oversees.includes(d.dept_code); // documents in progress: HR and the department's overseers
  }).map(summary);
}
api.get('/register', (req, res) => res.json(registerRows(req.user)));
api.get('/register.csv', requireHR, (req, res) => {
  const cols = ['docId', 'title', 'type', 'level', 'dept', 'version', 'statusName', 'signMethod', 'effectiveDate', 'reviewDate', 'confidentiality', 'author'];
  const csv = [cols.join(','), ...registerRows(req.user).map((r) => cols.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ADK document register ${todayIso()}.csv"`);
  res.send('﻿' + csv);
});

// ---------- Create (intake form → AI draft) ----------
const usage = new Map();
function withinLimit(email) {
  const limit = Number(settings.general().draftsPerHour) || 15;
  const t = Date.now();
  const list = (usage.get(email) || []).filter((x) => t - x < 3600_000);
  if (list.length >= limit) return false;
  list.push(t); usage.set(email, list); return true;
}

const REQUIRED_INTAKE = {
  policy: [['statements', 'policy requirements']],
  sop: [['procedure', 'procedure steps']],
  guideline: [['guidance', 'recommended practice']],
  form: [['formFields', 'form fields']],
  directive: [['background', 'reason for the directive'], ['instructions', 'instructions'], ['expiry', 'expiry or review date']],
};

api.post('/documents', requireRole('isAuthor', 'authors'), wrap(async (req, res) => {
  const b = req.body || {};
  const type = settings.resolveType(b.docType, b.variant);
  if (!type) throw new HttpError(400, 'Choose a document type.');
  // Authors draft for their own department; organisation-wide and clinical types have a fixed department.
  const deptCode = type.forceDept || req.user.dept;
  if (!deptCode) throw new HttpError(400, 'Your account has no department. Ask the Super Admin to set it.');
  const dept = settings.department(deptCode);
  if (!dept || !dept.active) throw new HttpError(400, `Department ${deptCode} is not active.`);
  if (!req.user.designation) throw new HttpError(400, 'Your account has no designation. Ask the Super Admin to add it; it appears as "Prepared by".');
  const title = clean(b.title, 200);
  if (!title) throw new HttpError(400, 'Enter a document title.');
  for (const [k, lbl] of [['purpose', 'purpose'], ...REQUIRED_INTAKE[type.template]]) if (!clean(b[k])) throw new HttpError(400, `Complete the ${lbl} field.`);
  if (!withinLimit(req.user.email)) throw new HttpError(429, 'Hourly drafting limit reached. Please try again later.');

  const clinicalImpact = type.clinical ? 'Yes' : (b.clinicalImpact === 'Yes' ? 'Yes' : 'No');
  const intake = {
    title, deptName: dept.name, appliesTo: clean(b.appliesTo, 500), clinicalImpact, parentPolicy: clean(b.parentPolicy, 200),
    purpose: clean(b.purpose), scope: clean(b.scope), definitions: clean(b.definitions), statements: clean(b.statements, 15000),
    prerequisites: clean(b.prerequisites), procedure: clean(b.procedure, 15000), records: clean(b.records), roles: clean(b.roles),
    monitoring: clean(b.monitoring), training: clean(b.training), related: clean(b.related), references: clean(b.references),
    notes: clean(b.notes), guidance: clean(b.guidance, 15000), formFields: clean(b.formFields, 15000), completion: clean(b.completion),
    background: clean(b.background), instructions: clean(b.instructions, 15000), conversion: clean(b.conversion),
    effectiveFrom: clean(b.effectiveFrom, 20), expiry: clean(b.expiry, 20),
  };

  let result;
  try { result = await draft(intake, type); } catch (e) {
    console.error(e);
    throw new HttpError(502, 'The draft could not be generated. Please try again in a minute.');
  }

  const id = tx(() => {
    const newId = insertDoc({
      type_key: b.docType, variant: type.variantKey || null, prefix: type.prefix, dept_code: deptCode, title,
      sign_method: b.signMethod === 'wet' ? 'wet' : 'electronic',
      confidentiality: CONFIDENTIALITY.includes(b.confidentiality) ? b.confidentiality : 'Internal Use',
      applies_to: intake.appliesTo, owner: clean(b.owner, 200), parent_policy: intake.parentPolicy, clinical_impact: clinicalImpact,
      effective_from: isoDate(intake.effectiveFrom), expiry: isoDate(intake.expiry),
      content_json: JSON.stringify(result.content), ai: result.ai ? 1 : 0,
      author_email: req.user.email, author_name: req.user.name, author_designation: req.user.designation,
    });
    replaceSignatories(newId, wf.defaultStages(type, clinicalImpact).map((stage) => ({ stage })));
    addEvent(newId, req.user, 'Created', result.ai ? 'Drafted with AI from the intake form' : 'Created from the intake form');
    return newId;
  });
  res.json({ id });
}));

// ---------- Read ----------
api.get('/documents/:id', wrap(async (req, res) => {
  const { doc, sigs, can, type } = loadDoc(req);
  const content = JSON.parse(doc.content_json);
  const prev = doc.supersedes_id ? q.getDoc.get(doc.supersedes_id) : null;
  const userState = (s) => {
    if (!s.user_id && !s.email) return null;
    const u = s.user_id ? accounts.getUser(s.user_id) : accounts.getUserByEmail(s.email);
    if (!u) return 'No portal account';
    if (!u.active) return 'Account deactivated';
    if (!accounts.rolesOf(u).includes('signatory')) return 'No longer a signatory';
    return null;
  };
  res.json({
    summary: summary(doc),
    doc: {
      id: doc.id, title: doc.title, typeKey: doc.type_key, variant: doc.variant, template: type.template, prefix: doc.prefix,
      deptCode: doc.dept_code, status: doc.status, signMethod: doc.sign_method, confidentiality: doc.confidentiality,
      appliesTo: doc.applies_to, owner: doc.owner, parentPolicy: doc.parent_policy, clinicalImpact: doc.clinical_impact,
      effectiveFrom: doc.effective_from, expiry: doc.expiry, authorName: doc.author_name, authorEmail: doc.author_email,
      authorDesignation: doc.status === 'draft' && can.isAuthor ? req.user.designation : doc.author_designation,
      version: doc.version, docId: doc.doc_id, seq: doc.seq,
      supersedes: prev ? prev.doc_id : null, changeSummary: doc.change_summary, changeClauses: doc.change_clauses,
      effectiveDate: doc.effective_date, reviewDate: doc.review_date, hasSigned: !!doc.signed_file, verbatim: !!content.blocks,
    },
    type: { label: type.label, level: type.level, colour: type.colour, reviewText: type.reviewText, finalApproval: type.finalApproval, clinical: !!type.clinical, template: type.template },
    sectionList: content.blocks ? [] : sections.sectionList(type.template),
    sections: content.blocks ? {} : sections.serialise(type.template, content),
    outstanding: sections.outstanding(content),
    signatories: sigs.map((s) => ({ id: s.id, stage: s.stage, userId: s.user_id, email: s.email, name: s.name, designation: s.designation, status: s.status, actedAt: s.acted_at, problem: s.status === 'pending' ? userState(s) : null })),
    current: (wf.currentSignatory(doc, sigs) || {}).email || null,
    events: q.events.all(doc.id).map((e) => ({ at: e.at, user: e.user_name, action: e.action, comment: e.comment })),
    can,
  });
}));

api.get('/documents/:id/preview', wrap(async (req, res) => {
  const { doc } = loadDoc(req);
  const { type, meta } = wf.buildMeta(doc);
  res.type('html').send(renderHtml(type, meta, JSON.parse(doc.content_json)));
}));

api.get('/documents/:id/docx', wrap(async (req, res) => {
  const { doc } = loadDoc(req);
  let buf;
  if (['issued', 'obsolete'].includes(doc.status) && doc.issued_file && fs.existsSync(path.join(FILES_DIR, doc.issued_file)) && doc.status === 'issued') buf = fs.readFileSync(path.join(FILES_DIR, doc.issued_file));
  else buf = await docxFor(doc);
  const base = doc.doc_id || `DRAFT ${doc.dept_code}-${doc.prefix}`;
  const fname = `${base} ${doc.title}`.replace(/[^\w\- ]+/g, '').slice(0, 100) + '.docx';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
  res.send(buf);
}));

// ---------- Edit (author, while in draft) ----------
api.put('/documents/:id', wrap(async (req, res) => {
  const { doc, can, type } = loadDoc(req);
  if (!can.edit) throw new HttpError(403, 'This document can only be edited by its author while it is a draft.');
  const b = req.body || {};
  const fields = {};
  if (b.title !== undefined) { const v = clean(b.title, 200); if (!v) throw new HttpError(400, 'The title cannot be empty.'); fields.title = v; }
  if (b.appliesTo !== undefined) fields.applies_to = clean(b.appliesTo, 500);
  if (b.owner !== undefined) fields.owner = clean(b.owner, 200);
  if (b.parentPolicy !== undefined) fields.parent_policy = clean(b.parentPolicy, 200);
  if (b.changeSummary !== undefined) fields.change_summary = clean(b.changeSummary, 2000);
  if (b.changeClauses !== undefined) fields.change_clauses = clean(b.changeClauses, 200);
  if (b.signMethod !== undefined) fields.sign_method = b.signMethod === 'wet' ? 'wet' : 'electronic';
  if (b.confidentiality !== undefined && CONFIDENTIALITY.includes(b.confidentiality)) fields.confidentiality = b.confidentiality;
  if (b.clinicalImpact !== undefined && !type.clinical) fields.clinical_impact = b.clinicalImpact === 'Yes' ? 'Yes' : 'No';
  if (b.effectiveFrom !== undefined) fields.effective_from = isoDate(b.effectiveFrom);
  if (b.expiry !== undefined) fields.expiry = isoDate(b.expiry);
  if (b.sections && typeof b.sections === 'object') {
    const content = JSON.parse(doc.content_json);
    if (!content.blocks) fields.content_json = JSON.stringify(sections.parse(type.template, b.sections, content));
  }
  tx(() => {
    updateDoc(doc.id, fields);
    if (Array.isArray(b.signatories)) {
      // Signatories are chosen from user accounts; name, designation and e-mail come from the account.
      const rows = b.signatories.slice(0, 12).map((s) => {
        const u = s.userId ? accounts.getUser(Number(s.userId)) : null;
        return { stage: clean(s.stage, 160) || 'Reviewed by', userId: u ? u.id : null, email: u ? u.email : '', name: u ? u.name : null, designation: u ? u.designation : null };
      });
      replaceSignatories(doc.id, rows);
    }
  });
  const updated = getDoc(doc.id);
  res.json({ ok: true, outstanding: sections.outstanding(updated.content), savedAt: updated.updated_at });
}));

// ---------- Workflow actions ----------
api.post('/documents/:id/submit', wrap(async (req, res) => {
  const { doc, sigs, can, type } = loadDoc(req);
  if (!can.submit) throw new HttpError(403, 'Only the author can submit a draft.');
  const problems = [];
  const out = sections.outstanding(doc.content);
  if (out.placeholders) problems.push(`${out.placeholders} highlighted [Author to confirm] item(s) still need completing.`);
  if (out.notes) problems.push(`${out.notes} drafting note(s) still need resolving and deleting.`);
  if (!req.user.designation) problems.push('Your account has no designation. Ask the Super Admin to add it.');
  if (!doc.applies_to) problems.push('Enter who the document applies to (Applicable to).');
  if (type.template === 'sop' && !doc.parent_policy) problems.push('Enter the parent policy ID, or "None".');
  if (sigs.length < 2) problems.push('At least two approval signatories are required (COR-SOP-001 clause 14.1).');
  sigs.forEach((s, i) => {
    const u = s.user_id ? accounts.getUser(s.user_id) : null;
    if (!u) problems.push(`Signatory ${i + 1} (${s.stage}): choose a person from the list.`);
    else if (!u.active) problems.push(`Signatory ${i + 1}: ${u.name}'s account is deactivated. Choose someone else.`);
    else if (!accounts.rolesOf(u).includes('signatory')) problems.push(`Signatory ${i + 1}: ${u.name} is not a signatory. Choose someone else.`);
    else if (u.email === req.user.email) problems.push(`Signatory ${i + 1}: you cannot approve your own document.`);
  });
  const ids = sigs.map((s) => s.user_id).filter(Boolean);
  if (new Set(ids).size !== ids.length) problems.push('Each person can appear only once in the approval list.');
  if (type.template === 'directive' && !doc.expiry) problems.push('A management directive needs an expiry or review date (COR-SOP-001 clause 24.4).');
  if (doc.version > 1 && !doc.change_summary) problems.push('Describe the changes made in this version (COR-SOP-001 clause 23.1).');
  if (problems.length) return res.status(400).json({ error: 'The document is not ready to submit.', problems });

  tx(() => {
    // Snapshot names and designations from the accounts at submission.
    for (const s of sigs) {
      const u = accounts.getUser(s.user_id);
      db.prepare("UPDATE signatories SET status = 'pending', acted_at = NULL, email = ?, name = ?, designation = ? WHERE id = ?").run(u.email, u.name, u.designation, s.id);
    }
    updateDoc(doc.id, { status: 'review', submitted_at: now(), author_name: req.user.name, author_designation: req.user.designation });
    addEvent(doc.id, req.user, 'Submitted for review', clean(req.body && req.body.comment, 1000));
  });
  const first = q.sigs.all(doc.id)[0];
  notify.send(first.email, `Review requested: ${doc.title}`, [`${req.user.name} has submitted “${doc.title}” for your review as ${first.stage}.`, 'Open the document to review the content, and approve or return it.'], doc.id);
  res.json({ ok: true });
}));

api.post('/documents/:id/recall', wrap(async (req, res) => {
  const { doc, can } = loadDoc(req);
  if (!can.recall) throw new HttpError(403, 'Only the author can recall a document under review.');
  tx(() => {
    db.prepare("UPDATE signatories SET status = 'pending', acted_at = NULL WHERE document_id = ?").run(doc.id);
    updateDoc(doc.id, { status: 'draft', submitted_at: null });
    addEvent(doc.id, req.user, 'Recalled to draft', clean(req.body && req.body.comment, 1000) || 'Recalled by the author; approvals given so far are cleared.');
  });
  res.json({ ok: true });
}));

api.post('/documents/:id/approve', wrap(async (req, res) => {
  const { doc, sigs, can } = loadDoc(req);
  if (!can.approve) throw new HttpError(403, 'This document is not waiting for your approval.');
  if (!req.user.isSignatory) throw new HttpError(403, 'Your account is no longer a signatory. Contact the Super Admin.');
  const current = wf.currentSignatory(doc, sigs);
  const remaining = sigs.filter((s) => s.status === 'pending').length - 1;
  tx(() => {
    db.prepare("UPDATE signatories SET status = 'approved', acted_at = ?, name = ?, designation = ?, user_id = ? WHERE id = ?")
      .run(now(), req.user.name, req.user.designation, req.user.id, current.id);
    addEvent(doc.id, req.user, `Approved (${current.stage})`, clean(req.body.comment, 1000));
    updateDoc(doc.id, remaining === 0 ? { status: 'hr' } : {});
  });
  if (remaining > 0) {
    const next = q.sigs.all(doc.id).find((s) => s.status === 'pending');
    notify.send(next.email, `Review requested: ${doc.title}`, [`“${doc.title}” is ready for your review as ${next.stage}.`], doc.id);
  } else {
    notify.send(hrRecipients(), `Ready for numbering: ${doc.title}`, [`All approvals are complete for “${doc.title}”. Please verify the approvals and assign the document number.`], doc.id);
    notify.send(doc.author_email, `Approved: ${doc.title}`, [`All approvals are complete for “${doc.title}”. It has gone to HR for numbering and issue.`], doc.id);
  }
  res.json({ ok: true, complete: remaining === 0 });
}));

api.post('/documents/:id/return', wrap(async (req, res) => {
  const { doc, can } = loadDoc(req);
  if (!can.returnToAuthor) throw new HttpError(403, 'You cannot return this document.');
  const comment = clean(req.body.comment, 2000);
  if (!comment) throw new HttpError(400, 'Explain what needs to change, so the author can act on it.');
  tx(() => {
    db.prepare("UPDATE signatories SET status = 'pending', acted_at = NULL WHERE document_id = ?").run(doc.id);
    updateDoc(doc.id, { status: 'draft', submitted_at: null });
    addEvent(doc.id, req.user, 'Returned to author', comment);
  });
  notify.send(doc.author_email, `Returned for changes: ${doc.title}`, [`${req.user.name} returned “${doc.title}” with this comment:`, comment], doc.id);
  res.json({ ok: true });
}));

api.post('/documents/:id/withdraw', wrap(async (req, res) => {
  const { doc, can } = loadDoc(req);
  if (!can.withdraw) throw new HttpError(403, 'Only the author or the department\'s document controller can withdraw a document before approval.');
  updateDoc(doc.id, { status: 'withdrawn' });
  addEvent(doc.id, req.user, 'Withdrawn', clean(req.body && req.body.comment, 1000));
  res.json({ ok: true });
}));

// ---------- HR: numbering, issue, signed copies ----------
function nextSeq(doc) {
  if (doc.supersedes_id) return q.getDoc.get(doc.supersedes_id).seq; // a new version keeps its number
  const r = db.prepare('SELECT MAX(seq) AS m FROM documents WHERE dept_code = ? AND prefix = ? AND seq IS NOT NULL').get(doc.dept_code, doc.prefix);
  return (r.m || 0) + 1;
}

api.get('/documents/:id/next-number', requireHR, wrap(async (req, res) => {
  const { doc, type } = loadDoc(req);
  const seq = nextSeq(doc);
  const eff = doc.effective_from || todayIso();
  res.json({
    seq, fixed: !!doc.supersedes_id, docId: `${doc.dept_code}-${doc.prefix}-${pad3(seq)}-V${doc.version}`,
    effectiveDate: eff, reviewDate: wf.reviewDateFor(type, eff, doc), reviewText: type.reviewText,
  });
}));

api.post('/documents/:id/number', requireHR, wrap(async (req, res) => {
  const { doc, can, type } = loadDoc(req);
  if (!can.assignNumber) throw new HttpError(403, 'This document is not waiting for a number.');
  const sigs = q.sigs.all(doc.id);
  if (sigs.some((s) => s.status !== 'approved')) throw new HttpError(400, 'Not all approvals are complete.');
  const seq = doc.supersedes_id ? nextSeq(doc) : Number(req.body.seq);
  if (!Number.isInteger(seq) || seq < 1 || seq > 999) throw new HttpError(400, 'Enter a document number between 1 and 999.');
  const clash = db.prepare('SELECT doc_id FROM documents WHERE dept_code = ? AND prefix = ? AND seq = ? AND base_id <> ?').get(doc.dept_code, doc.prefix, seq, doc.base_id);
  if (clash) throw new HttpError(409, `Number ${pad3(seq)} is already used by ${clash.doc_id}.`);
  const effective = isoDate(req.body.effectiveDate);
  if (!effective) throw new HttpError(400, 'Enter the effective date.');
  const docId = `${doc.dept_code}-${doc.prefix}-${pad3(seq)}-V${doc.version}`;
  const reviewDate = isoDate(req.body.reviewDate) || wf.reviewDateFor(type, effective, doc);
  const electronic = doc.sign_method === 'electronic';

  tx(() => {
    updateDoc(doc.id, {
      seq, doc_id: docId, effective_date: effective, review_date: reviewDate, numbered_at: now(), numbered_by: req.user.name,
      status: electronic ? 'issued' : 'signing',
      ...(electronic ? { issued_at: now(), issued_by_name: req.user.name, issued_by_email: req.user.email } : {}),
    });
    addEvent(doc.id, req.user, `Number assigned: ${docId}`, `Effective ${effective}${reviewDate ? `, review ${reviewDate}` : ''}`);
    if (electronic) addEvent(doc.id, req.user, 'Issued', 'Approved electronically; controlled copy issued');
  });
  const updated = getDoc(doc.id);
  if (electronic) {
    await freezeIssued(doc.id);
    obsoletePrevious(updated, req.user);
    notify.send([doc.author_email, ...sigs.map((s) => s.email)], `Issued: ${docId} ${doc.title}`, [`${docId} “${doc.title}” has been issued and is in the document register.`, 'The owning department should now complete rollout and training as required.'], doc.id);
  } else {
    notify.send(doc.author_email, `Ready to print and sign: ${docId}`, [`HR has assigned ${docId} to “${doc.title}”.`, 'Download the FINAL Word file, print it, collect the signatures, and return the signed copy to HR for scanning and issue.'], doc.id);
  }
  res.json({ ok: true, docId, status: updated.status });
}));

api.post('/documents/:id/signed', requireHR, express.raw({ type: 'application/pdf', limit: '25mb' }), wrap(async (req, res) => {
  const { doc, can } = loadDoc(req);
  if (!can.uploadSigned) throw new HttpError(403, 'This document is not waiting for a signed copy.');
  if (!Buffer.isBuffer(req.body) || req.body.subarray(0, 5).toString() !== '%PDF-') throw new HttpError(400, 'Upload the signed copy as a PDF file.');
  const name = `${doc.doc_id}-signed.pdf`;
  fs.writeFileSync(path.join(FILES_DIR, name), req.body);
  tx(() => {
    updateDoc(doc.id, { signed_file: name, status: 'issued', issued_at: now(), issued_by_name: req.user.name, issued_by_email: req.user.email });
    addEvent(doc.id, req.user, 'Signed copy uploaded', `${Math.round(req.body.length / 1024)} KB`);
    addEvent(doc.id, req.user, 'Issued', 'Signed by hand; signed copy held by HR');
  });
  await freezeIssued(doc.id);
  obsoletePrevious(getDoc(doc.id), req.user);
  const sigs = q.sigs.all(doc.id);
  notify.send([doc.author_email, ...sigs.map((s) => s.email)], `Issued: ${doc.doc_id} ${doc.title}`, [`${doc.doc_id} “${doc.title}” has been issued and is in the document register.`], doc.id);
  res.json({ ok: true });
}));

api.get('/documents/:id/signed', wrap(async (req, res) => {
  const { doc } = loadDoc(req);
  if (!doc.signed_file) throw new HttpError(404, 'No signed copy has been uploaded.');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${doc.doc_id} signed.pdf"`);
  res.send(fs.readFileSync(path.join(FILES_DIR, doc.signed_file)));
}));

api.post('/documents/:id/revise', wrap(async (req, res) => {
  const { doc, sigs, can } = loadDoc(req);
  if (!can.revise) throw new HttpError(403, 'Only the author, the department\'s document controller or HR can start a revision.');
  const open = db.prepare("SELECT id FROM documents WHERE supersedes_id = ? AND status NOT IN ('withdrawn')").get(doc.id);
  if (open) return res.json({ id: open.id, existing: true });
  const content = JSON.parse(doc.content_json);
  content.authorFlags = [];
  const id = tx(() => {
    const newId = insertDoc({
      type_key: doc.type_key, variant: doc.variant, prefix: doc.prefix, dept_code: doc.dept_code, title: doc.title,
      sign_method: doc.sign_method, confidentiality: doc.confidentiality, applies_to: doc.applies_to, owner: doc.owner,
      parent_policy: doc.parent_policy, clinical_impact: doc.clinical_impact, effective_from: null, expiry: doc.expiry,
      content_json: JSON.stringify(content), ai: 0,
      author_email: req.user.email, author_name: req.user.name, author_designation: req.user.designation,
      base_id: doc.base_id, supersedes_id: doc.id, version: doc.version + 1, seq: doc.seq,
    });
    // Keep the previous signatories where they still hold active signatory accounts.
    replaceSignatories(newId, sigs.map((s) => {
      const u = s.user_id ? accounts.getUser(s.user_id) : accounts.getUserByEmail(s.email);
      const ok = u && u.active && accounts.rolesOf(u).includes('signatory') && u.email !== req.user.email;
      return ok ? { stage: s.stage, userId: u.id, email: u.email, name: u.name, designation: u.designation } : { stage: s.stage };
    }));
    addEvent(newId, req.user, 'Revision started', `From ${doc.doc_id}`);
    addEvent(doc.id, req.user, 'Revision started', `Version ${doc.version + 1} in draft`);
    return newId;
  });
  res.json({ id });
}));

api.post('/documents/:id/obsolete', requireHR, wrap(async (req, res) => {
  const { doc, can } = loadDoc(req);
  if (!can.makeObsolete) throw new HttpError(403, 'Only issued documents can be made obsolete.');
  const comment = clean(req.body.comment, 1000);
  if (!comment) throw new HttpError(400, 'Give the reason for making this document obsolete.');
  updateDoc(doc.id, { status: 'obsolete' });
  addEvent(doc.id, req.user, 'Made obsolete', comment);
  res.json({ ok: true });
}));

// ---------- Super Admin ----------
api.use('/admin', requireRole('isAdmin', 'the Super Admin'), adminRoutes);

app.use('/api', api);

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  const message = status >= 500 ? 'Something went wrong. Please try again.' : err.message;
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) return res.status(status).json({ error: message, ...(err.problems ? { problems: err.problems } : {}) });
  res.status(status).send(message);
});

app.listen(PORT, () => console.log(`ADK Document Portal v${VERSION} on port ${PORT} (Microsoft sign-in: ${MICROSOFT ? 'on' : 'off'}, AI: ${process.env.ANTHROPIC_API_KEY ? 'on' : 'off'}, e-mail: ${notify.enabled() ? 'on' : 'off'}, data: ${DATA_DIR})`));
