// Creates (or restores) a Super Admin account and prints a temporary password.
// Usage: node scripts/create-admin.js <e-mail> "<Full name>" ["<Designation>"]
require('dotenv').config();
const { db, now, adminEvent } = require('../lib/db');
const settings = require('../lib/settings');
const accounts = require('../lib/accounts');

const [email, name, designation = ''] = process.argv.slice(2);
if (!email || !name) { console.error('Usage: node scripts/create-admin.js <e-mail> "<Full name>" ["<Designation>"]'); process.exit(1); }
settings.seed();
const e = email.toLowerCase();
const temp = accounts.tempPassword();
const u = accounts.getUserByEmail(e);
if (u) {
  const roles = new Set([...accounts.rolesOf(u), 'admin']);
  db.prepare('UPDATE users SET roles = ?, active = 1, password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?')
    .run([...roles].join(','), accounts.hashPassword(temp), now(), u.id);
} else {
  db.prepare(`INSERT INTO users (email, name, designation, roles, password_hash, must_change_password, created_at, created_by, updated_at)
    VALUES (?, ?, ?, 'admin', ?, 1, ?, 'Command line', ?)`).run(e, name, designation, accounts.hashPassword(temp), now(), now());
}
adminEvent({ email: 'command line', name: 'Server administrator' }, u ? 'Super Admin restored from the command line' : 'Super Admin created from the command line', 'user', e, null);
console.log(`Super Admin: ${e}\nTemporary password: ${temp}\nSign in and choose a new password.`);
