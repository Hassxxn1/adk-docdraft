// Template editor: shows a draft in the ADK Master Template layout and lets the author edit it in place.
// The content stays structured (the same JSON the AI returns), so numbering, tables and styling
// cannot be broken. The Word file is still produced by docgen.js from that structure.

const CONFIRM = /\[Author to confirm[^\]]*\]/g;
const CE_MODE = (() => {
  const d = document.createElement('div');
  d.contentEditable = 'plaintext-only';
  return d.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true';
})();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hl = (s) => esc(s).replace(CONFIRM, (m) => `<mark class="confirm">${m}</mark>`);
const fmtDate = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
const $ = (id) => document.getElementById(id);

let S = null; // { doc, ctx, readonly, canvas, timer, saving, pending, dirty }

// ---------- Public ----------

export function openEditor(doc, ctx) {
  if (S && S.dirty && !S.readonly) save();
  S = { doc, ctx, readonly: !!ctx.readonly, canvas: $('edCanvas'), timer: null, saving: false, pending: false, dirty: false };
  doc.meta.draftedAt = doc.meta.draftedAt || new Date().toISOString();
  shape(doc.content);
  $('edTitle').textContent = doc.meta.title || 'Untitled';
  $('edType').innerHTML = `<span class="dot" style="background:#${esc(doc.type.colour)}"></span>L${doc.type.level} ${esc(doc.type.label)} · ${esc(doc.meta.deptCode)}`;
  $('edSave').hidden = S.readonly;
  $('edReadonly').hidden = !S.readonly;
  $('edHelp').hidden = S.readonly;
  render();
  setStatus(S.readonly ? '' : doc.id ? 'saved' : 'new');
  window.scrollTo(0, 0);
}

export function hasUnsaved() { return !!(S && S.dirty && !S.readonly); }
export function flush() { if (S && S.dirty && !S.readonly) return save(); }

// ---------- Toolbar wiring (once) ----------

$('edNext').addEventListener('click', nextConfirm);
$('edSave').addEventListener('click', () => save());
$('edDownload').addEventListener('click', async () => {
  if (!S) return;
  const btn = $('edDownload');
  btn.disabled = true;
  try {
    if (S.dirty && !S.readonly) await save();
    await S.ctx.download(S.doc.type, S.doc.meta, clean(S.doc.content));
  } finally { btn.disabled = false; }
});
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && S && !$('editorView').hidden) { e.preventDefault(); save(); }
});
window.addEventListener('beforeunload', (e) => { if (hasUnsaved()) { save(); e.preventDefault(); } });

// Clicking a yellow item selects it, so typing replaces it.
$('edCanvas').addEventListener('click', (e) => {
  const m = e.target.closest('mark.confirm');
  if (m && m.isContentEditable) selectNode(m);
});

// ---------- State helpers ----------

function shape(c) {
  for (const k of ['definitions', 'policyStatements', 'roles', 'prerequisites', 'procedure', 'records', 'monitoring', 'training', 'related', 'references', 'authorFlags']) {
    if (!Array.isArray(c[k])) c[k] = [];
  }
  c.purpose = c.purpose || '';
  c.scope = c.scope || '';
  c.roles.forEach((r) => { if (!Array.isArray(r.responsibilities)) r.responsibilities = []; });
  c.procedure.forEach((s) => { if (!Array.isArray(s.steps)) s.steps = []; });
}

export function clean(c) {
  const s = (x) => String(x ?? '').replace(/\s+/g, ' ').trim();
  const strs = (a) => a.map(s).filter(Boolean);
  return {
    purpose: s(c.purpose),
    scope: s(c.scope),
    definitions: c.definitions.map((d) => ({ term: s(d.term), definition: s(d.definition) }))
      .filter((d) => d.term || d.definition).sort((a, b) => a.term.localeCompare(b.term)),
    policyStatements: strs(c.policyStatements),
    roles: c.roles.map((r) => ({ role: s(r.role), responsibilities: strs(r.responsibilities) }))
      .filter((r) => r.role || r.responsibilities.length),
    prerequisites: strs(c.prerequisites),
    procedure: c.procedure.map((st) => ({
      stage: s(st.stage),
      steps: st.steps.map((x) => ({ actor: s(x.actor), action: s(x.action) })).filter((x) => x.actor || x.action),
    })).filter((st) => st.stage || st.steps.length),
    records: c.records.map((r) => ({ record: s(r.record), keptBy: s(r.keptBy), retention: s(r.retention) }))
      .filter((r) => r.record || r.keptBy || r.retention),
    monitoring: strs(c.monitoring),
    training: strs(c.training),
    related: strs(c.related),
    references: strs(c.references),
    authorFlags: strs(c.authorFlags),
  };
}

// Items that will appear highlighted in Word.
function countConfirm() {
  const { meta, content, type } = S.doc;
  let n = 0;
  const walk = (v) => {
    if (typeof v === 'string') n += (v.match(CONFIRM) || []).length;
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { if (k !== 'authorFlags') walk(x); });
  };
  walk(content);
  ['title', 'owner', 'appliesTo', 'supersedes', 'parentPolicy'].forEach((k) => walk(meta[k]));
  const blank = (x) => !String(x || '').trim();
  if (blank(meta.owner)) n++;
  if (blank(meta.appliesTo)) n++;
  if (type.template === 'sop' && blank(meta.parentPolicy)) n++;
  if (blank(content.purpose)) n++;
  if (blank(content.scope)) n++;
  return n;
}

function updateCounts() {
  const n = countConfirm();
  const f = S.doc.content.authorFlags.filter((x) => String(x).trim()).length;
  $('edCount').textContent = n ? `${n} to confirm` : 'Nothing highlighted';
  $('edCount').className = n ? 'chip warn' : 'chip';
  $('edNext').hidden = !n;
  $('edFlags').textContent = f ? `${f} drafting note${f > 1 ? 's' : ''}` : 'No drafting notes';
}

function changed() {
  if (S.readonly) return;
  S.dirty = true;
  updateCounts();
  setStatus('unsaved');
  clearTimeout(S.timer);
  if (S.saving) { S.pending = true; return; }
  S.timer = setTimeout(save, 1500);
}

function setStatus(st) {
  const el = $('edStatus');
  el.className = 'ed-status ' + st;
  el.innerHTML = {
    new: 'Not saved yet',
    unsaved: 'Unsaved changes',
    saving: '<span class="spinner"></span>Saving…',
    saved: 'All changes saved',
    error: 'Could not save – check your connection',
    '': '',
  }[st];
}

async function save() {
  if (!S || S.readonly) return;
  if (S.saving) { S.pending = true; return; }
  clearTimeout(S.timer);
  const cur = S;
  cur.saving = true;
  setStatus('saving');
  const { sb, cfg } = cur.ctx;
  const d = cur.doc;
  const content = clean(d.content);
  const row = {
    title: String(d.meta.title || '').trim() || 'Untitled',
    meta: d.meta,
    content,
    flags: countConfirm() + content.authorFlags.length,
    updated_at: new Date().toISOString(),
  };
  const r = d.id
    ? await sb.from('drafts').update(row).eq('id', d.id).select('id').single()
    : await sb.from('drafts').insert({
      ...row, user_id: cfg.user.id, user_email: cfg.user.email, user_name: cfg.user.name,
      doc_type: d.docType, dept_code: d.meta.deptCode, source: 'blank', ai: false, status: 'ok',
    }).select('id').single();
  cur.saving = false;
  if (S !== cur) return;
  if (r.error) { console.error(r.error); setStatus('error'); return; }
  if (!d.id) d.id = r.data.id;
  if (cur.pending) { cur.pending = false; cur.timer = setTimeout(save, 600); setStatus('unsaved'); return; }
  cur.dirty = false;
  setStatus('saved');
  cur.ctx.onSaved && cur.ctx.onSaved();
}

// ---------- DOM helpers ----------

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

function selectNode(n) {
  const r = document.createRange();
  r.selectNodeContents(n);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

function caretTo(e, where) {
  const r = document.createRange();
  r.selectNodeContents(e);
  r.collapse(where === 'start');
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

// Text before and after the caret (a selection is treated as deleted).
function splitAt(e) {
  const s = getSelection();
  if (!s.rangeCount || !e.contains(s.anchorNode)) return [e.textContent, ''];
  const r = s.getRangeAt(0);
  const pre = document.createRange(); pre.selectNodeContents(e); pre.setEnd(r.startContainer, r.startOffset);
  const post = document.createRange(); post.selectNodeContents(e); post.setStart(r.endContainer, r.endOffset);
  return [pre.toString(), post.toString()];
}

function rerender(focus) {
  render();
  if (!focus) return;
  const e = S.canvas.querySelector(`[data-key="${CSS.escape(focus.key)}"]`);
  if (e) { e.focus(); caretTo(e, focus.pos || 'end'); }
}

const cleanLines = (txt) => txt.split(/\r?\n/).map((x) => x.replace(/^\s*([-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);

// An editable text element bound to a value in the draft.
function ed(value, set, o = {}) {
  const e = el(o.tag || 'div', 'ed' + (o.cls ? ' ' + o.cls : '') + (o.need ? ' need' : ''));
  e.innerHTML = hl(value || '');
  if (o.key) e.dataset.key = o.key;
  if (o.ph) e.dataset.ph = o.ph;
  if (S.readonly) return e;
  e.contentEditable = CE_MODE;
  e.spellcheck = true;
  e.addEventListener('input', () => {
    if (!e.textContent) e.innerHTML = '';
    set(e.textContent.replace(/\u00a0/g, ' '));
    if (o.onInput) o.onInput(e.textContent);
    changed();
  });
  e.addEventListener('blur', () => { if (e.isConnected) e.innerHTML = hl(e.textContent); });
  e.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (o.onEnter) { const [a, b] = splitAt(e); o.onEnter(a, b); }
    } else if (ev.key === 'Backspace' && !e.textContent && o.onEmptyBackspace) {
      ev.preventDefault();
      o.onEmptyBackspace();
    }
  });
  e.addEventListener('paste', (ev) => {
    ev.preventDefault();
    const txt = ev.clipboardData.getData('text/plain') || '';
    const lines = cleanLines(txt);
    if (o.onPasteLines && lines.length > 1) {
      document.execCommand('insertText', false, lines[0]);
      o.onPasteLines(lines.slice(1));
    } else {
      document.execCommand('insertText', false, txt.replace(/\s*\r?\n\s*/g, ' '));
    }
  });
  return e;
}

function ctrls(arr, i, keyOf, o = {}) {
  if (S.readonly) return el('div', 'cc');
  const box = el('div', 'cc');
  const b = (label, title, fn, dis) => {
    const x = el('button', 'cb-btn', label);
    x.type = 'button'; x.title = title; x.disabled = !!dis;
    x.addEventListener('mousedown', (ev) => ev.preventDefault());
    x.addEventListener('click', fn);
    box.append(x);
  };
  b('↑', 'Move up', () => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; changed(); rerender(keyOf && { key: keyOf(i - 1) }); }, i === 0);
  b('↓', 'Move down', () => { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; changed(); rerender(keyOf && { key: keyOf(i + 1) }); }, i === arr.length - 1);
  b(o.removeLabel || '×', o.removeTitle || 'Delete', () => {
    if (o.confirm && !confirm(o.confirm)) return;
    arr.splice(i, 1); changed(); rerender();
  });
  return box;
}

function addBtn(label, fn) {
  if (S.readonly) return document.createComment('');
  const b = el('button', 'add', '+ ' + esc(label));
  b.type = 'button';
  b.addEventListener('click', fn);
  return b;
}

function row(num, body, level, controls) {
  const r = el('div', `cl l${level}`);
  r.append(el('span', 'cn', esc(num)));
  const b = el('div', 'cbody');
  (Array.isArray(body) ? body : [body]).forEach((x) => b.append(x));
  r.append(b);
  if (controls) r.append(controls);
  return r;
}

const heading = (n, title) => el('div', 'hd', `<span class="hn">${n}</span>${esc(title)}`);
const placeholder = (text) => el('p', 'phd', esc(text));
const subhead = (t) => el('div', 'subhead', esc(t.toUpperCase()));

// A list of plain strings rendered as numbered clauses.
function stringItems(arr, keyBase, numBase, level, ph, o = {}) {
  const key = (i) => `${keyBase}.${i}`;
  return arr.map((v, i) => row(`${numBase}.${i + 1}`, ed(v, (x) => { arr[i] = x; }, {
    key: key(i), ph,
    onEnter: (a, b) => { arr[i] = a; arr.splice(i + 1, 0, b); changed(); rerender({ key: key(i + 1), pos: 'start' }); },
    onEmptyBackspace: () => { arr.splice(i, 1); changed(); rerender(i > 0 ? { key: key(i - 1) } : o.backKey ? { key: o.backKey } : null); },
    onPasteLines: (lines) => { arr.splice(i + 1, 0, ...lines); changed(); rerender({ key: key(i + lines.length) }); },
  }), level, ctrls(arr, i, key)));
}

// ---------- Front matter ----------

function letterhead() {
  const f = el('div', 'lh');
  f.append(el('img', 'lh-img'));
  f.firstChild.src = '/assets/letterhead.png';
  f.firstChild.alt = 'ADK Hospital letterhead';
  const rule = el('div', 'lh-rule');
  rule.style.borderColor = '#' + S.doc.type.colour;
  f.append(rule);
  return f;
}

function footer() {
  const { type, meta } = S.doc;
  return el('div', 'sheet-foot', `${esc(meta.deptCode)}-${esc(type.prefix)}-NNN-V1 &nbsp;·&nbsp; DRAFT – not valid until approved and issued by HR`);
}

function dataTable(widths, rows, header) {
  const t = el('table', 'dt');
  const cg = el('colgroup');
  widths.forEach((w) => { const c = el('col'); c.style.width = w; cg.append(c); });
  t.append(cg);
  if (header) {
    const tr = el('tr', 'th');
    header.forEach((h) => tr.append(el('th', null, esc(h))));
    t.append(tr);
  }
  rows.forEach((r, ri) => {
    const tr = el('tr', ri % 2 ? 'z' : null);
    r.forEach((c) => { const td = el('td'); (Array.isArray(c) ? c : [c]).forEach((x) => td.append(typeof x === 'string' ? el('span', null, x) : x)); tr.append(td); });
    t.append(tr);
  });
  return t;
}

function mirrorTitle(v) {
  S.canvas.querySelectorAll('[data-mirror="title"]').forEach((x) => { x.textContent = v; });
  $('edTitle').textContent = v.trim() || 'Untitled';
}

function controlTable() {
  const { type, meta } = S.doc;
  const drafted = new Date(meta.draftedAt);
  const next = new Date(drafted); next.setFullYear(next.getFullYear() + type.reviewYears);
  const hr = (s) => `<i class="grey">${esc(s)}</i>`;
  const lab = (s) => `<b>${esc(s)}</b>`;
  const titleMirror = el('span'); titleMirror.dataset.mirror = 'title'; titleMirror.textContent = meta.title || '';
  const rows = [
    [lab('Document title'), titleMirror],
    [lab('Document ID'), `${esc(meta.deptCode)}-${esc(type.prefix)}-${hr('NNN')}-V1 &nbsp;${hr('[Assigned by HR on issue]')}`],
    [lab('Classification'), `Level ${type.level} – ${esc(type.label)}`],
  ];
  if (type.template === 'sop') {
    rows.push([lab('Parent policy'), ed(meta.parentPolicy, (v) => { meta.parentPolicy = v; }, { key: 'meta.parentPolicy', need: true, ph: '[Author to confirm: parent policy ID]' })]);
  }
  let clinical;
  if (type.clinical) clinical = 'Yes – CMO review required';
  else if (S.readonly) clinical = meta.clinicalImpact === 'Yes' ? 'Yes – CMO review required' : 'No';
  else {
    clinical = el('select', 'inline-select');
    clinical.innerHTML = '<option value="No">No</option><option value="Yes">Yes – CMO review required</option>';
    clinical.value = meta.clinicalImpact === 'Yes' ? 'Yes' : 'No';
    clinical.addEventListener('change', () => { meta.clinicalImpact = clinical.value; changed(); rerender(); });
  }
  rows.push(
    [lab('Owning department'), `${esc(meta.deptName)} (${esc(meta.deptCode)})`],
    [lab('Document owner'), ed(meta.owner, (v) => { meta.owner = v; }, { key: 'meta.owner', need: true, ph: '[Author to confirm: owner name and designation]' })],
    [lab('Applies to'), ed(meta.appliesTo, (v) => { meta.appliesTo = v; }, { key: 'meta.appliesTo', need: true, ph: '[Author to confirm: who this applies to]' })],
    [lab('Version'), `V1 &nbsp;${hr('[Confirmed by HR on issue]')}`],
    [lab('Supersedes'), ed(meta.supersedes, (v) => { meta.supersedes = v; }, { key: 'meta.supersedes', ph: 'None' })],
    [lab('Effective date'), hr('[Assigned by HR on issue]')],
    [lab('Next review date'), `${esc(type.reviewText)} from effective date &nbsp;${hr(`(indicative: ${fmtDate(next)})`)}`],
    [lab('Clinical impact'), clinical],
    [lab('Drafted'), `${fmtDate(drafted)} by ${esc(meta.draftedBy)}${meta.ai ? ', with AI assistance' : ''}`],
  );
  return dataTable(['30%', '70%'], rows);
}

function endorsementTable() {
  const { type, meta } = S.doc;
  const stages = [['Drafted by', meta.draftedBy]];
  type.reviewers.forEach((r) => stages.push([`Reviewed by (${r})`, '']));
  if (meta.clinicalImpact === 'Yes' && !type.reviewers.some((r) => /CMO/.test(r))) stages.push(['Reviewed by (CMO – clinical impact)', '']);
  stages.push([`Approved by (${type.finalApproval})`, '']);
  stages.push(['Issued by (HR – custodian)', '']);
  return dataTable(['31%', '21%', '20%', '17%', '11%'], stages.map(([s, n]) => [`<b class="sm">${esc(s)}</b>`, esc(n), '', '', '']), ['Stage', 'Name', 'Designation', 'Signature', 'Date']);
}

function revisionTable() {
  const ai = S.doc.meta.ai;
  return dataTable(['10%', '16%', '16%', '41%', '17%'], [['V1', '', 'All', `New document${ai ? '. Drafted with AI assistance.' : '.'}`, '']], ['Version', 'Date', 'Clause(s)', 'Summary of change', 'Approved by']);
}

function flagsBox() {
  const flags = S.doc.content.authorFlags;
  const box = el('div', 'flags' + (flags.length ? '' : ' none'));
  if (!flags.length) {
    box.append(el('p', 'flags-none', 'No drafting notes. This box will not appear in the Word file.'));
  } else {
    box.append(el('div', 'flags-h', 'DRAFTING NOTES – RESOLVE AND DELETE THIS BOX BEFORE ENDORSEMENT'));
    box.append(el('p', 'flags-p', 'Highlighted [Author to confirm] items in the text must also be completed. Verify every reference, number and clinical value against its source.'));
    const key = (i) => `flags.${i}`;
    flags.forEach((f, i) => {
      const r = row(`${i + 1}.`, ed(f, (x) => { flags[i] = x; }, {
        key: key(i), ph: 'Drafting note',
        onEnter: (a, b) => { flags[i] = a; flags.splice(i + 1, 0, b); changed(); rerender({ key: key(i + 1), pos: 'start' }); },
        onEmptyBackspace: () => { flags.splice(i, 1); changed(); rerender(i ? { key: key(i - 1) } : null); },
      }), 'f', ctrls(flags, i, key, { removeLabel: '✓', removeTitle: 'Resolved – remove note' }));
      box.append(r);
    });
  }
  box.append(addBtn('Add drafting note', () => { flags.push(''); changed(); rerender({ key: `flags.${flags.length - 1}` }); }));
  return box;
}

function frontSheet() {
  const { type, meta } = S.doc;
  const sh = el('div', 'sheet');
  sh.append(letterhead());
  const band = el('div', 'band-doc');
  band.style.background = '#' + type.colour;
  band.append(el('div', 'band-level', `LEVEL ${type.level} &nbsp;·&nbsp; ${esc(type.label.toUpperCase())}`));
  band.append(ed(meta.title, (v) => { meta.title = v; }, { key: 'meta.title', cls: 'band-title', ph: 'Document title', onInput: mirrorTitle }));
  band.append(el('div', 'band-sub', `${esc(meta.deptName)} &nbsp;·&nbsp; <b>DRAFT FOR DEPARTMENTAL REVIEW</b>`));
  sh.append(
    band,
    subhead('Document control'), controlTable(),
    subhead('Endorsement'),
    el('p', 'grey-note', 'At least two signatures are required. The owning department collects all endorsements before submitting to HR.'),
    endorsementTable(),
    subhead('Revision history'), revisionTable(),
    flagsBox(),
    footer(),
  );
  return sh;
}

// ---------- Body sections ----------

function proseSection(n, title, field, ph) {
  const c = S.doc.content;
  return [heading(n, title), row(`${n}.1`, ed(c[field], (v) => { c[field] = v; }, { key: field, need: true, ph }), 2)];
}

function listSection(n, title, field, emptyText, addLabel, ph) {
  const arr = S.doc.content[field];
  const out = [heading(n, title)];
  if (!arr.length) out.push(placeholder(emptyText));
  out.push(...stringItems(arr, field, n, 2, ph));
  out.push(addBtn(addLabel, () => { arr.push(''); changed(); rerender({ key: `${field}.${arr.length - 1}` }); }));
  return out;
}

function definitionsSection(n) {
  const defs = S.doc.content.definitions;
  const out = [heading(n, 'Definitions')];
  if (!defs.length) out.push(placeholder('No specific definitions. Terms carry their ordinary meaning.'));
  else {
    const key = (i, f) => `def.${i}.${f}`;
    out.push(dataTable(['27%', '73%'], defs.map((d, i) => [
      ed(d.term, (v) => { d.term = v; }, { key: key(i, 't'), cls: 'b', ph: 'Term', onEnter: () => rerender({ key: key(i, 'd') }) }),
      [ed(d.definition, (v) => { d.definition = v; }, {
        key: key(i, 'd'), ph: 'Meaning',
        onEnter: () => { defs.splice(i + 1, 0, { term: '', definition: '' }); changed(); rerender({ key: key(i + 1, 't') }); },
      }), ctrls(defs, i, (j) => key(j, 't'))],
    ]), ['Term', 'Definition']));
  }
  out.push(addBtn('Add term', () => { defs.push({ term: '', definition: '' }); changed(); rerender({ key: `def.${defs.length - 1}.t` }); }));
  return out;
}

function rolesSection(n) {
  const roles = S.doc.content.roles;
  const out = [heading(n, 'Roles and responsibilities')];
  if (!roles.length) out.push(placeholder('[Author to confirm: roles]'));
  roles.forEach((r, i) => {
    const rk = `role.${i}`;
    out.push(row(`${n}.${i + 1}`, ed(r.role, (v) => { r.role = v; }, {
      key: rk, cls: 'b', ph: 'Role (e.g. Ward Manager)',
      onEnter: () => { r.responsibilities.unshift(''); changed(); rerender({ key: `${rk}.r.0` }); },
    }), 2, ctrls(roles, i, (j) => `role.${j}`, { confirm: 'Delete this role and its responsibilities?' })));
    out.push(...stringItems(r.responsibilities, `${rk}.r`, `${n}.${i + 1}`, 3, 'Responsibility', { backKey: rk }));
    if (!r.responsibilities.length) {
      const w = el('div', 'indent3');
      w.append(addBtn('Add responsibility', () => { r.responsibilities.push(''); changed(); rerender({ key: `${rk}.r.0` }); }));
      out.push(w);
    }
  });
  out.push(addBtn('Add role', () => { roles.push({ role: '', responsibilities: [] }); changed(); rerender({ key: `role.${roles.length - 1}` }); }));
  return out;
}

function procedureSection(n) {
  const stages = S.doc.content.procedure;
  const out = [heading(n, 'Procedure')];
  if (!stages.length) out.push(placeholder('[Author to confirm: procedure steps]'));
  stages.forEach((st, i) => {
    const sk = `stage.${i}`;
    out.push(row(`${n}.${i + 1}`, ed(st.stage, (v) => { st.stage = v; }, {
      key: sk, cls: 'stage', ph: 'Stage (e.g. Prepare the audit)',
      onEnter: () => { st.steps.unshift({ actor: '', action: '' }); changed(); rerender({ key: `${sk}.s.0.a` }); },
    }), 2, ctrls(stages, i, (j) => `stage.${j}`, { confirm: 'Delete this stage and all its steps?' })));
    st.steps.forEach((step, j) => {
      const k = (x, f) => `${sk}.s.${x}.${f}`;
      const actor = ed(step.actor, (v) => { step.actor = v; }, {
        tag: 'span', key: k(j, 'a'), cls: 'actor', ph: 'Role',
        onEnter: () => rerender({ key: k(j, 'x'), pos: 'start' }),
      });
      const action = ed(step.action, (v) => { step.action = v; }, {
        tag: 'span', key: k(j, 'x'), cls: 'action', ph: 'Action, starting with a verb',
        onEnter: (a, b) => { step.action = a; st.steps.splice(j + 1, 0, { actor: '', action: b }); changed(); rerender({ key: k(j + 1, 'a') }); },
        onEmptyBackspace: () => {
          if (!String(step.actor).trim()) { st.steps.splice(j, 1); changed(); rerender(j ? { key: k(j - 1, 'x') } : { key: sk }); }
          else rerender({ key: k(j, 'a') });
        },
      });
      out.push(row(`${n}.${i + 1}.${j + 1}`, [actor, el('span', 'colon', ':&nbsp;'), action], 3, ctrls(st.steps, j, (x) => k(x, 'a'))));
    });
    out.push(el('div', 'indent3')); out[out.length - 1].append(addBtn('Add step', () => { st.steps.push({ actor: '', action: '' }); changed(); rerender({ key: `${sk}.s.${st.steps.length - 1}.a` }); }));
  });
  out.push(addBtn('Add stage', () => { stages.push({ stage: '', steps: [] }); changed(); rerender({ key: `stage.${stages.length - 1}` }); }));
  return out;
}

function recordsSection(n) {
  const recs = S.doc.content.records;
  const out = [heading(n, 'Records')];
  if (!recs.length) out.push(placeholder('No controlled records are generated by this procedure.'));
  else {
    const key = (i, f) => `rec.${i}.${f}`;
    out.push(dataTable(['44%', '29%', '27%'], recs.map((r, i) => [
      ed(r.record, (v) => { r.record = v; }, { key: key(i, 'r'), ph: 'Record or form', onEnter: () => rerender({ key: key(i, 'k') }) }),
      ed(r.keptBy, (v) => { r.keptBy = v; }, { key: key(i, 'k'), ph: 'Kept by', onEnter: () => rerender({ key: key(i, 't') }) }),
      [ed(r.retention, (v) => { r.retention = v; }, {
        key: key(i, 't'), ph: 'Retention',
        onEnter: () => { recs.splice(i + 1, 0, { record: '', keptBy: '', retention: '' }); changed(); rerender({ key: key(i + 1, 'r') }); },
      }), ctrls(recs, i, (j) => key(j, 'r'))],
    ]), ['Record', 'Kept by', 'Retention']));
  }
  out.push(addBtn('Add record', () => { recs.push({ record: '', keptBy: '', retention: '' }); changed(); rerender({ key: `rec.${recs.length - 1}.r` }); }));
  return out;
}

function bodySheet() {
  const { type } = S.doc;
  const rollout = type.rollout;
  const refs = '[Author to confirm: regulations or standards relied on, or None]';
  const mon = '[Author to confirm: how compliance is monitored]';
  const parts = type.template === 'policy' ? [
    proseSection(1, 'Purpose', 'purpose', 'What this policy achieves, and why the hospital needs it'),
    proseSection(2, 'Scope', 'scope', 'Who and what it covers, and any exclusions'),
    definitionsSection(3),
    listSection(4, 'Policy statements', 'policyStatements', '[Author to confirm: policy requirements]', 'Add policy statement', 'One auditable "shall" requirement'),
    rolesSection(5),
    listSection(6, 'Compliance and monitoring', 'monitoring', mon, 'Add monitoring item', 'Indicator, audit or report'),
    listSection(7, 'Implementation and training', 'training', rollout, 'Add implementation item', 'Briefing, training or acknowledgement'),
    listSection(8, 'Related documents', 'related', 'None.', 'Add related document', 'Document ID and title'),
    listSection(9, 'References', 'references', refs, 'Add reference', 'Law, regulation or standard, cited exactly'),
    [heading(10, 'Annexes'), placeholder('None.')],
  ] : [
    proseSection(1, 'Purpose', 'purpose', 'What this procedure achieves, and why'),
    proseSection(2, 'Scope', 'scope', 'Who and what it covers, and any exclusions'),
    definitionsSection(3),
    rolesSection(4),
    listSection(5, 'Prerequisites', 'prerequisites', 'None.', 'Add prerequisite', 'Equipment, system, form or competency'),
    procedureSection(6),
    recordsSection(7),
    listSection(8, 'Monitoring', 'monitoring', mon, 'Add monitoring item', 'Indicator, audit or report'),
    listSection(9, 'Training', 'training', rollout, 'Add training item', 'Briefing, training or competency check'),
    listSection(10, 'Related documents', 'related', 'None.', 'Add related document', 'Document ID and title'),
    listSection(11, 'References', 'references', refs, 'Add reference', 'Law, regulation or standard, cited exactly'),
    [heading(12, 'Annexes'), placeholder('None.')],
  ];
  const sh = el('div', 'sheet body-sheet');
  sh.append(letterhead());
  parts.flat().forEach((x) => sh.append(x));
  sh.append(footer());
  return sh;
}

function render() {
  const c = S.canvas;
  c.innerHTML = '';
  c.classList.toggle('readonly', S.readonly);
  c.append(frontSheet(), bodySheet());
  updateCounts();
}

// ---------- Jump to the next highlighted item ----------

function nextConfirm() {
  const items = [...S.canvas.querySelectorAll('mark.confirm, .ed.need')].filter((x) => x.tagName === 'MARK' || !x.textContent.trim());
  if (!items.length) return;
  const sel = getSelection();
  const here = sel.rangeCount ? sel.getRangeAt(0).endContainer : null;
  let target = items[0];
  if (here && S.canvas.contains(here)) {
    target = items.find((x) => !x.contains(here) && (here.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING)) || items[0];
  }
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const host = target.tagName === 'MARK' ? target.closest('.ed') : target;
  host.focus({ preventScroll: true });
  if (target.tagName === 'MARK') selectNode(target); else caretTo(target, 'end');
}
