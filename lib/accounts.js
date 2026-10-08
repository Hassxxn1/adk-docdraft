// User accounts: password hashing, sign-in checks and role helpers.
const crypto = require('crypto');
const { db, now } = require('./db');

const ROLES = {
  admin: 'Super Admin',
  hr: 'HR (document custodian)',
  controller: 'Department Head / Document Controller',
  author: 'Author',
  signatory: 'Signatory',
};
const ROLE_KEYS = Object.keys(ROLES);
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

// ---------- Passwords (scrypt, built into Node.js) ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, saltB64, keyB64] = stored.split('$');
  const expected = Buffer.from(keyB64, 'base64');
  const key = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(key, expected);
}

// Readable temporary password, e.g. "Kp7m-Xq4t-Rw9z". The user must change it at first sign-in.
function tempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const pick = () => Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join('');
  return `${pick()}-${pick()}-${pick()}`;
}

function passwordProblem(password, email) {
  const p = String(password || '');
  if (p.length < 10) return 'Use at least 10 characters.';
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return 'Use both letters and numbers.';
  if (email && p.toLowerCase().includes(email.split('@')[0].toLowerCase())) return 'Do not include your e-mail name in the password.';
  return null;
}

// ---------- Users ----------
const uq = {
  byId: db.prepare('SELECT * FROM users WHERE id = ?'),
  byEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
};
const getUser = (id) => uq.byId.get(id) || null;
const getUserByEmail = (email) => uq.byEmail.get(String(email || '').toLowerCase()) || null;
const rolesOf = (u) => String(u.roles || '').split(',').filter((r) => ROLE_KEYS.includes(r));

// Departments the user oversees: their own department as Document Controller, plus any they head.
function oversight(u) {
  const depts = new Set();
  if (rolesOf(u).includes('controller') && u.dept_code) depts.add(u.dept_code);
  for (const r of db.prepare('SELECT code FROM departments WHERE head_user_id = ? AND active = 1').all(u.id)) depts.add(r.code);
  return [...depts];
}

// The signed-in user as the rest of the application sees it. Loaded fresh on every request,
// so deactivation and role changes take effect immediately.
function sessionUser(u) {
  const roles = rolesOf(u);
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    designation: u.designation,
    dept: u.dept_code,
    roles,
    isAdmin: roles.includes('admin'),
    isHR: roles.includes('hr'),
    isController: roles.includes('controller'),
    isAuthor: roles.includes('author'),
    isSignatory: roles.includes('signatory'),
    oversees: oversight(u),
    mustChange: !!u.must_change_password,
  };
}

// Returns { user } on success or { error } with a message safe to show.
function checkLogin(email, password) {
  const u = getUserByEmail(email);
  const generic = { error: 'The e-mail or password is incorrect.' };
  if (!u || !u.active || !u.password_hash) {
    if (!u) verifyPassword(password, hashPassword('timing-equaliser')); // similar response time for unknown accounts
    return u && !u.active ? { error: 'This account has been deactivated. Contact the Super Admin.', user: null, inactive: u } : generic;
  }
  if (u.locked_until && u.locked_until > now()) return { error: `Too many failed attempts. Try again after ${new Date(u.locked_until).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Indian/Maldives' })}.`, locked: u };
  if (!verifyPassword(password, u.password_hash)) {
    const failed = u.failed_attempts + 1;
    const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null;
    db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : failed, lock, u.id);
    return { ...generic, failedUser: u, lockedNow: !!lock };
  }
  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(now(), u.id);
  return { user: getUser(u.id) };
}

function recordLogin(u) {
  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(now(), u.id);
}

const activeAdmins = () => db.prepare("SELECT id FROM users WHERE active = 1 AND (',' || roles || ',') LIKE '%,admin,%'").all();

module.exports = {
  ROLES, ROLE_KEYS, hashPassword, verifyPassword, tempPassword, passwordProblem,
  getUser, getUserByEmail, rolesOf, sessionUser, checkLogin, recordLogin, activeAdmins,
};
