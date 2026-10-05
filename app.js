// ADK Policy and SOP Drafting Portal (prototype: Supabase + Netlify)
// Sign-in and data: Supabase. AI drafting: the `draft` Edge Function. Word file: built in the browser.
import { SUPABASE_URL, SUPABASE_ANON_KEY, ALLOWED_EMAIL_DOMAIN } from './config.js';
import { createDocgen } from './docgen.js';
import { openEditor, flush } from './editor.js';

const $ = (id) => document.getElementById(id);
const form = $('form');
const STORE = 'adk-docdraft-form';
const SESSION_HOURS = 8;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (d) => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

if (SUPABASE_URL.includes('YOUR-PROJECT-REF')) {
  document.body.insertAdjacentHTML('beforeend', '<div class="wrap" style="padding-top:40px"><div class="notice">Set <b>SUPABASE_URL</b> and <b>SUPABASE_ANON_KEY</b> in <code>config.js</code>, then reload.</div></div>');
  throw new Error('Supabase is not configured.');
}

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let cfg = null;      // { user, isAdmin, departments, types }
let docgen = null;   // lazily created once the letterhead has loaded
let started = false;

// ---------- Sign-in ----------

function showLogin() {
  started = false;
  $('loginView').hidden = false;
  $('tabs').hidden = true;
  $('userBox').hidden = true;
  document.querySelectorAll('.view').forEach((v) => (v.hidden = true));
}

$('loginForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const email = $('loginForm').elements.email.value.trim().toLowerCase();
  const password = $('loginForm').elements.password.value;
  const status = $('loginStatus');
  status.className = '';
  if (!email || !password) { status.className = 'err'; status.textContent = 'Enter your email and password.'; return; }
  if (ALLOWED_EMAIL_DOMAIN && !email.endsWith('@' + ALLOWED_EMAIL_DOMAIN)) {
    status.className = 'err'; status.textContent = 'Access is limited to ADK Hospital staff accounts.'; return;
  }
  $('loginBtn').disabled = true;
  status.innerHTML = '<span class="spinner"></span>Signing in…';
  const { error } = await sb.auth.signInWithPassword({ email, password });
  $('loginBtn').disabled = false;
  if (error) { status.className = 'err'; status.textContent = 'Sign-in failed. Check your email and password.'; return; }
  status.textContent = '';
  $('loginForm').reset();
});

$('signOut').addEventListener('click', async (e) => { e.preventDefault(); await sb.auth.signOut(); });

sb.auth.onAuthStateChange((event, session) => {
  if (!session) return showLogin();
  if (!started) { started = true; setTimeout(() => start(session.user), 0); }
});

// ---------- Start-up after sign-in ----------

async function start(user) {
  // Sessions end after 8 hours, as in the original portal.
  if (user.last_sign_in_at && Date.now() - new Date(user.last_sign_in_at).getTime() > SESSION_HOURS * 3600_000) {
    await sb.auth.signOut();
    return;
  }
  $('loginView').hidden = true;

  const [deps, types] = await Promise.all([
    sb.from('departments').select('code,name').eq('active', true).order('sort'),
    sb.from('doc_types').select('*').eq('active', true).order('sort'),
  ]);
  if (deps.error || types.error) {
    document.body.insertAdjacentHTML('beforeend', '<div class="wrap"><div class="notice">Could not load the portal settings. Check that <code>supabase/schema.sql</code> has been run.</div></div>');
    return;
  }

  cfg = {
    user: { id: user.id, email: user.email, name: user.user_metadata?.full_name || user.email.split('@')[0] },
    isAdmin: user.app_metadata?.role === 'admin',
    departments: deps.data,
    types: Object.fromEntries(types.data.map((t) => [t.key, {
      label: t.label, level: t.level, prefix: t.prefix, colour: t.colour, template: t.template,
      reviewYears: t.review_years, reviewText: t.review_text, reviewers: t.reviewers || [],
      finalApproval: t.final_approval, rollout: t.rollout, forceDept: t.force_dept, clinical: t.clinical,
    }])),
  };

  $('userName').textContent = cfg.user.name;
  $('userBox').hidden = false;
  $('tabs').hidden = false;
  $('allTab').hidden = !cfg.isAdmin;

  const typeSel = $('docType'), deptSel = $('deptCode');
  typeSel.length = 1; deptSel.length = 1;
  for (const [k, v] of Object.entries(cfg.types)) typeSel.add(new Option(`Level ${v.level} · ${v.label}`, k));
  for (const d of cfg.departments) deptSel.add(new Option(`${d.name} (${d.code})`, d.code));

  restore();
  updateView();
  showView('newView');
}

// ---------- Tabs ----------

function showView(id) {
  if (id !== 'editorView') flush();
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== id));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === id));
  if (id === 'mineView') loadList(false);
  if (id === 'allView') loadList(true);
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));

// ---------- Form ----------

function updateView() {
  if (!cfg) return;
  const t = cfg.types[$('docType').value];
  const tpl = t ? t.template : null;
  document.querySelectorAll('.policy-only').forEach((el) => (el.hidden = tpl !== 'policy'));
  document.querySelectorAll('.sop-only').forEach((el) => (el.hidden = tpl !== 'sop'));
  $('clinicalWrap').hidden = !!(t && t.clinical);
  if (t && t.forceDept) { $('deptCode').value = t.forceDept; $('deptCode').disabled = true; }
  else $('deptCode').disabled = false;

  const dept = $('deptCode').value || 'DEPT';
  $('band').style.background = t ? '#' + t.colour : '';
  $('bandLevel').textContent = t ? `Level ${t.level}` : 'Choose a document type';
  $('bandType').textContent = t ? t.label : '';
  $('sumId').textContent = t ? `${dept}-${t.prefix}-NNN-V1` : '—';
  $('sumReview').textContent = t ? t.reviewText : '—';
  $('sumApproval').textContent = t ? t.finalApproval : '—';
}

// Keep an unsent draft in this browser so a long form is not lost.
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(new FormData(form)))); } catch (e) {}
}
function restore() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE) || '{}');
    for (const [k, v] of Object.entries(data)) if (form.elements[k]) form.elements[k].value = v;
  } catch (e) {}
}

form.addEventListener('input', () => { updateView(); save(); });
form.addEventListener('change', () => { updateView(); save(); });

$('clear').addEventListener('click', () => {
  if (!confirm('Clear everything in the form?')) return;
  form.reset();
  try { localStorage.removeItem(STORE); } catch (e) {}
  updateView();
});

function setStatus(msg, cls, html) {
  const s = $('status');
  s.className = cls || '';
  if (html) s.innerHTML = msg; else s.textContent = msg;
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const t = cfg.types[$('docType').value];
  const need = ['docType', 'title', 'deptCode', 'purpose'];
  if (t) need.push(t.template === 'policy' ? 'statements' : 'procedure');
  let ok = true;
  form.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
  for (const n of need) {
    const el = form.elements[n];
    if (!el.value.trim()) { el.classList.add('invalid'); ok = false; }
  }
  if (!ok) { setStatus('Complete the highlighted fields.', 'err'); return; }

  const body = Object.fromEntries(new FormData(form));
  body.deptCode = $('deptCode').value;
  $('submit').disabled = true;
  setStatus('<span class="spinner"></span>Drafting your document. This usually takes under a minute…', '', true);
  try {
    const { data, error } = await sb.functions.invoke('draft', { body });
    if (error) {
      let msg = 'The draft could not be generated.';
      try {
        const res = error.context;
        if (res && res.status === 401) { await sb.auth.signOut(); return; }
        const j = await res.json();
        if (j && j.error) msg = j.error;
      } catch (e) {}
      throw new Error(msg);
    }
    setStatus(data.meta.ai ? 'Draft ready.' : 'AI drafting is not switched on yet, so your text was laid into the template unchanged.', 'ok');
    openDraft({ id: data.id, docType: body.docType, type: data.type, meta: data.meta, content: data.content, userId: cfg.user.id });
  } catch (e) {
    setStatus(e.message, 'err');
  } finally {
    $('submit').disabled = false;
  }
});

// ---------- Template editor ----------

function openDraft(doc) {
  const readonly = doc.userId !== cfg.user.id;
  $('editorTab').hidden = false;
  showView('editorView');
  openEditor(doc, { sb, cfg, download, readonly });
}

// Lays whatever the author typed in the form into the template, without AI.
const lines = (v) => String(v || '').split(/\r?\n/).map((x) => x.replace(/^\s*([-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);
const pair = (l, a, b) => { const i = l.indexOf(':'); return i > 0 ? { [a]: l.slice(0, i).trim(), [b]: l.slice(i + 1).trim() } : { [a]: l, [b]: '' }; };

$('blankBtn').addEventListener('click', () => {
  const f = Object.fromEntries(new FormData(form));
  const t = cfg.types[f.docType];
  const deptCode = $('deptCode').value;
  form.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
  let ok = true;
  for (const n of ['docType', 'title', 'deptCode']) if (!form.elements[n].value.trim()) { form.elements[n].classList.add('invalid'); ok = false; }
  if (!ok) { setStatus('Choose the document type and department, and enter a title.', 'err'); return; }
  setStatus('');
  const dept = cfg.departments.find((d) => d.code === deptCode);
  const meta = {
    title: f.title.trim(), deptCode, deptName: dept.name, owner: f.owner || '', appliesTo: f.appliesTo || '',
    supersedes: f.supersedes || '', parentPolicy: t.template === 'sop' ? (f.parentPolicy || '') : '',
    clinicalImpact: t.clinical ? 'Yes' : (f.clinicalImpact === 'Yes' ? 'Yes' : 'No'),
    draftedBy: cfg.user.name, ai: false, draftedAt: new Date().toISOString(),
  };
  const proc = lines(f.procedure);
  const content = {
    purpose: f.purpose || '', scope: f.scope || '',
    definitions: lines(f.definitions).map((l) => pair(l, 'term', 'definition')),
    policyStatements: t.template === 'policy' ? lines(f.statements) : [],
    roles: lines(f.roles).map((l) => { const x = pair(l, 'role', 'r'); return { role: x.role, responsibilities: x.r ? [x.r] : [] }; }),
    prerequisites: t.template === 'sop' ? lines(f.prerequisites) : [],
    procedure: t.template === 'sop' && proc.length ? [{ stage: 'Procedure', steps: proc.map((a) => ({ actor: '', action: a })) }] : [],
    records: t.template === 'sop' ? lines(f.records).map((r) => ({ record: r, keptBy: '', retention: '' })) : [],
    monitoring: lines(f.monitoring), training: lines(f.training), related: lines(f.related), references: lines(f.references),
    authorFlags: [],
  };
  openDraft({ id: null, docType: f.docType, type: t, meta, content, userId: cfg.user.id });
});

async function openSaved(id) {
  const { data, error } = await sb.from('drafts').select('id,user_id,doc_type,meta,content,created_at').eq('id', id).single();
  if (error || !data.content || !cfg.types[data.doc_type]) throw new Error('This draft could not be opened.');
  return {
    id: data.id, docType: data.doc_type, type: cfg.types[data.doc_type], userId: data.user_id,
    meta: { ...data.meta, draftedAt: data.meta.draftedAt || data.created_at }, content: data.content,
  };
}

// ---------- Word file ----------

async function getDocgen() {
  if (docgen) return docgen;
  const r = await fetch('/assets/letterhead.png');
  if (!r.ok) throw new Error('Could not load the letterhead image.');
  docgen = createDocgen(window.docx, new Uint8Array(await r.arrayBuffer()));
  return docgen;
}

async function download(type, meta, content) {
  const { buildDocument } = await getDocgen();
  const blob = await window.docx.Packer.toBlob(buildDocument(type, meta, content));
  const name = `DRAFT ${meta.deptCode}-${type.prefix} ${meta.title}`.replace(/[^\w\- ]+/g, '').slice(0, 90) + '.docx';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- Draft lists ----------

async function loadList(all) {
  const tbody = $(all ? 'allRows' : 'mineRows');
  const cols = all ? 8 : 6;
  tbody.innerHTML = `<tr><td colspan="${cols}" class="empty"><span class="spinner"></span>Loading…</td></tr>`;
  let q = sb.from('drafts')
    .select('id,created_at,user_name,user_email,doc_type,dept_code,title,status,ai,flags')
    .order('created_at', { ascending: false })
    .limit(200);
  if (!all) q = q.eq('user_id', cfg.user.id);
  const { data, error } = await q;
  if (error) { tbody.innerHTML = `<tr><td colspan="${cols}" class="empty">Could not load drafts.</td></tr>`; return; }
  if (!data.length) { tbody.innerHTML = `<tr><td colspan="${cols}" class="empty">No drafts yet.</td></tr>`; return; }

  tbody.innerHTML = data.map((d) => {
    const t = cfg.types[d.doc_type];
    const typeCell = t ? `<span class="dot" style="background:#${esc(t.colour)}"></span>L${t.level} ${esc(t.label)}` : esc(d.doc_type);
    const btn = d.status === 'ok'
      ? `<span class="row-btns"><button type="button" class="ghost small-btn" data-open="${esc(d.id)}">Open</button><button type="button" class="ghost small-btn" data-id="${esc(d.id)}">Word</button></span>`
      : '';
    const notes = d.status === 'failed'
      ? '<span class="chip fail">Failed</span>'
      : d.flags ? `<span class="chip warn">${d.flags} to confirm</span>` : '<span class="chip">Ready to review</span>';
    if (all) {
      return `<tr><td class="nowrap">${fmt(d.created_at)}</td><td>${esc(d.user_name)}<br><span class="small muted">${esc(d.user_email)}</span></td>
        <td>${esc(d.title)}</td><td>${typeCell}</td><td>${esc(d.dept_code)}</td><td>${d.ai ? 'Yes' : 'No'}</td><td>${notes}</td><td>${btn}</td></tr>`;
    }
    return `<tr><td class="nowrap">${fmt(d.created_at)}</td><td>${esc(d.title)}</td><td>${typeCell}</td><td>${esc(d.dept_code)}</td><td>${notes}</td><td>${btn}</td></tr>`;
  }).join('');
}

document.addEventListener('click', async (e) => {
  const ob = e.target.closest('button[data-open]');
  if (ob) {
    ob.disabled = true;
    try { openDraft(await openSaved(ob.dataset.open)); } catch (err) { alert(err.message); } finally { ob.disabled = false; }
    return;
  }
  const btn = e.target.closest('button[data-id]');
  if (!btn) return;
  btn.disabled = true;
  const old = btn.textContent;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    const doc = await openSaved(btn.dataset.id);
    await download(doc.type, doc.meta, doc.content);
  } catch (err) {
    alert('This draft could not be downloaded.');
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
});
