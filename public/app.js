// ADK Document Portal – browser application (no build step).
(function () {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const view = $('#view');
  let ME = null;
  window.ADK = {};

  // ---------- Helpers ----------
  async function api(method, url, body, raw) {
    const opts = { method, headers: {} };
    if (body !== undefined && !raw) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    if (raw) { opts.headers['Content-Type'] = raw; opts.body = body; }
    const r = await fetch(url, opts);
    if (r.status === 401) { location.href = '/login'; throw new Error('Signed out'); }
    const isJson = (r.headers.get('Content-Type') || '').includes('json');
    const data = isJson ? await r.json() : await r.text();
    if (r.status === 403 && data && data.code === 'password_change_required') { location.hash = '#/account'; location.reload(); throw new Error(data.error); }
    if (!r.ok) { const e = new Error((data && data.error) || 'Something went wrong.'); e.problems = data && data.problems; throw e; }
    return data;
  }

  let toastTimer;
  function toast(msg, err) {
    const t = $('#toast');
    t.textContent = msg; t.className = err ? 'err' : ''; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
  }

  const fmtDate = (iso) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
  const fmtStamp = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const pill = (status, name) => `<span class="pill ${esc(status)}">${esc(name || ME.statusNames[status] || status)}</span>`;
  const docLabel = (d) => d.docId || `${d.pendingId} (unnumbered)`;
  const busy = (btn, on, text) => {
    if (!btn) return;
    if (on) { btn.dataset.t = btn.textContent; btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>${esc(text || 'Working…')}`; } else { btn.disabled = false; btn.textContent = btn.dataset.t || btn.textContent; }
  };

  function row(d, extra = '') {
    return `<a class="row" href="#/doc/${d.id}">
      <span class="chip" style="background:#${esc(d.colour)}"></span>
      <span><span class="t">${esc(d.title)}</span><br><span class="m">${esc(docLabel(d))} · ${esc(d.type)} · ${esc(d.deptName)}${d.waitingOn ? ` · waiting on ${esc(d.waitingOn)}` : ''}</span>${extra}</span>
      <span>${pill(d.status, d.statusName)}</span></a>`;
  }
  const panel = (title, items, empty, render = (d) => row(d), cls = '') => `<section class="panel ${cls}"><h2>${esc(title)}${items.length ? ` <span class="count">${items.length}</span>` : ''}</h2>${items.length ? items.map(render).join('') : `<p class="empty">${esc(empty)}</p>`}</section>`;

  // ---------- Router ----------
  let leaveGuard = null;
  async function route() {
    if (leaveGuard) { const g = leaveGuard; leaveGuard = null; await g(); }
    window.onbeforeunload = null;
    const h = location.hash || '#/';
    const m = h.match(/^#\/doc\/(\d+)/);
    $$('#nav a').forEach((a) => a.classList.toggle('active', (a.dataset.nav === 'work' && (h === '#/' || h === '')) || h.startsWith(`#/${a.dataset.nav}`)));
    view.innerHTML = '<p class="loading">Loading…</p>';
    try {
      if (ME.user.mustChange) passwordView(true);
      else if (m) await docView(Number(m[1]));
      else if (h.startsWith('#/new') && ME.user.isAuthor) newView();
      else if (h.startsWith('#/register')) await registerView();
      else if (h.startsWith('#/account')) passwordView(false);
      else if (h.startsWith('#/admin') && ME.user.isAdmin) await window.AdminViews.render(h.slice(8) || 'users', view);
      else await workView();
    } catch (e) {
      view.innerHTML = `<div class="view"><p class="problems" style="padding-left:14px">${esc(e.message)}</p><p><a href="#/">Back to My work</a></p></div>`;
    }
    window.scrollTo(0, 0);
  }

  // ---------- My work ----------
  async function workView() {
    const w = await api('GET', '/api/work');
    const returned = (d) => row(d, d.returned ? `<div class="note">Returned: ${esc(d.returned)}</div>` : '');
    let html = '<div class="view"><h1 class="page-title">My work</h1><p class="lead">Documents waiting for you, and documents you are drafting.</p><div class="dash">';
    html += panel('Waiting for your approval', w.tasks, 'Nothing is waiting for your approval.', undefined, 'wide');
    if (ME.user.isHR) html += panel('HR: ready for numbering or awaiting signed copy', w.hr, 'Nothing is waiting for HR.', undefined, 'wide');
    if (ME.user.oversees.length) html += panel(`My department's documents (${ME.user.oversees.join(', ')})`, w.department, 'No documents in progress or issued yet.', undefined, 'wide');
    if (ME.user.isHR || ME.user.oversees.length) html += panel('Reviews due within 60 days', w.dueSoon, 'No reviews are due in the next 60 days.', (d) => row(d, `<div class="m">Review due ${esc(fmtDate(d.reviewDate))}</div>`), 'wide');
    if (ME.user.isAuthor || w.mine.length) html += panel('My documents', w.mine, 'You have not started any documents yet.', returned);
    html += panel('Documents I review or approve', w.involved, 'None yet.');
    html += `</div>${ME.user.isAuthor ? '<p><a class="button" href="#/new">Start a new document</a></p>' : ''}</div>`;
    view.innerHTML = html;
  }

  // ---------- New document ----------
  function newView() {
    view.innerHTML = '<div class="view"></div>';
    view.firstChild.appendChild($('#tpl-new').content.cloneNode(true));
    const form = $('#form');
    const STORE = 'adk-portal-new';
    const REQUIRED = { policy: ['statements'], sop: ['procedure'], guideline: ['guidance'], form: ['formFields'], directive: ['background', 'instructions', 'expiry'] };
    const SCOPE_LABEL = { form: 'When the form is used', directive: 'Scope and exceptions' };

    if (!ME.aiEnabled) $('#aiNote').hidden = false;
    for (const [k, v] of Object.entries(ME.types)) $('#docType').add(new Option(`Level ${v.level} · ${v.label}`, k));
    for (const d of ME.departments) $('#deptCode').add(new Option(`${d.name} (${d.code})`, d.code));
    $('#preparedBy').value = `${ME.user.name}${ME.user.designation ? `, ${ME.user.designation}` : ' (no designation – ask the Super Admin)'}`;

    function fillVariants(keep) {
      const t = ME.types[$('#docType').value];
      const sel = $('#variant');
      const current = keep || sel.value;
      sel.innerHTML = '';
      if (!t || !t.variants) { $('#variantWrap').hidden = true; return; }
      $('#variantLabel').textContent = t.variantLabel;
      for (const [k, v] of Object.entries(t.variants)) sel.add(new Option(v.label, k));
      if (t.variants[current]) sel.value = current;
      $('#variantWrap').hidden = false;
    }
    function effective() {
      const t = ME.types[$('#docType').value];
      if (!t) return null;
      const v = t.variants ? t.variants[$('#variant').value] : null;
      return v ? { ...t, prefix: v.prefix, forceDept: v.forceDept, finalApproval: v.finalApproval, clinical: v.clinical, variantName: v.label.split(' – ')[0] } : t;
    }
    function updateView() {
      const t = effective();
      const tpl = t ? t.template : null;
      $$('[data-show]', form).forEach((el) => { el.hidden = !tpl || !el.dataset.show.split(' ').includes(tpl); });
      $('#scopeLabel').textContent = SCOPE_LABEL[tpl] || 'Scope';
      $('#clinicalWrap').hidden = !!(t && t.clinical);
      $('#deptCode').value = (t && t.forceDept) || ME.user.dept || '';
      const dept = $('#deptCode').value || 'DEPT';
      $('#band').style.background = t ? `#${t.colour}` : '';
      $('#bandLevel').textContent = t ? `Level ${t.level}` : 'Choose a document type';
      $('#bandType').textContent = t ? (t.variantName ? `${t.label} – ${t.variantName}` : t.label) : '';
      $('#sumId').textContent = t ? `${dept}-${t.prefix}-NNN-V1` : '—';
      $('#sumReview').textContent = t ? t.reviewText : '—';
      $('#sumApproval').textContent = t ? t.finalApproval : '—';
    }
    const save = () => { try { localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(new FormData(form)))); } catch (e) { /* storage unavailable */ } };
    try {
      const data = JSON.parse(localStorage.getItem(STORE) || '{}');
      for (const [k, v] of Object.entries(data)) if (form.elements[k] && k !== 'variant') form.elements[k].value = v;
      fillVariants(data.variant);
    } catch (e) { /* ignore */ }
    updateView();
    $('#docType').addEventListener('change', () => fillVariants());
    form.addEventListener('input', () => { updateView(); save(); });
    form.addEventListener('change', () => { updateView(); save(); });
    $('#clear').addEventListener('click', () => {
      if (!confirm('Clear everything in the form?')) return;
      form.reset(); try { localStorage.removeItem(STORE); } catch (e) { /* ignore */ }
      fillVariants(); updateView();
    });
    function setStatus(msg, cls) { const s = $('#status'); s.className = cls || ''; s.textContent = msg; }
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const t = effective();
      const need = ['docType', 'title', 'purpose', ...(t ? REQUIRED[t.template] : [])];
      $$('.invalid', form).forEach((el) => el.classList.remove('invalid'));
      const missing = need.filter((n) => !form.elements[n].value.trim());
      missing.forEach((n) => form.elements[n].classList.add('invalid'));
      if (missing.length) { setStatus('Complete the highlighted fields.', 'err'); return; }
      const body = Object.fromEntries(new FormData(form));
      body.deptCode = $('#deptCode').value;
      busy($('#submit'), true, 'Drafting your document…');
      setStatus('This usually takes under a minute.');
      try {
        const r = await api('POST', '/api/documents', body);
        try { localStorage.removeItem(STORE); } catch (e) { /* ignore */ }
        location.hash = `#/doc/${r.id}`;
      } catch (e) { setStatus(e.message, 'err'); busy($('#submit'), false); }
    });
  }

  // ---------- Document ----------
  async function docView(id) {
    const d = await api('GET', `/api/documents/${id}`);
    const { doc, can, summary: s } = d;
    const wet = doc.signMethod === 'wet';

    const stepNames = ['Draft', 'Review', 'HR numbering', ...(wet ? ['Signatures'] : []), 'Issued'];
    const order = { draft: 0, review: 1, hr: 2, signing: 3, issued: stepNames.length, obsolete: stepNames.length, withdrawn: -1 };
    const at = order[doc.status];
    const steps = stepNames.map((n, i) => `<span class="${i < at ? 'done' : i === at ? 'now' : ''}">${esc(n)}</span>`).join('');

    view.innerHTML = `<div class="view">
      <div class="doc-head">
        <div class="stripe" style="background:#${esc(d.type.colour)}">
          <div class="lv">Level ${d.type.level} · ${esc(s.type)}</div>
          <h1>${esc(doc.title)}</h1>
          <div>${esc(s.deptName)}</div>
        </div>
        <div class="meta">
          ${pill(doc.status, s.statusName)}
          <span><strong>${esc(docLabel(s))}</strong></span>
          <span>Version ${doc.version}${doc.supersedes ? ` (replaces ${esc(doc.supersedes)})` : ''}</span>
          <span>Prepared by ${esc(doc.authorName)}</span>
          <span>${wet ? 'Signed by hand' : 'Electronic approval'}</span>
          <span class="acts">
            <a class="button small ghost" href="/api/documents/${id}/docx">Download Word</a>
            ${doc.hasSigned ? `<a class="button small ghost" href="/api/documents/${id}/signed">Signed copy (PDF)</a>` : ''}
          </span>
        </div>
        ${doc.status !== 'withdrawn' ? `<div class="steps">${steps}</div>` : ''}
      </div>
      <div class="doc-grid"><div class="work-col" id="workCol"></div>
      <div class="preview-col"><div class="preview-box" id="previewBox"><p class="loading">Loading preview…</p></div></div></div></div>`;
    const col = $('#workCol');

    const refreshPreview = async () => { $('#previewBox').innerHTML = await api('GET', `/api/documents/${id}/preview`); };
    refreshPreview().catch(() => { $('#previewBox').innerHTML = '<p class="loading">Preview unavailable.</p>'; });
    const reload = () => docView(id);

    if (can.edit) editorPanels(col, d, refreshPreview);
    else {
      if (can.approve) col.insertAdjacentHTML('beforeend', approvalCard(d));
      if (can.recall) col.insertAdjacentHTML('beforeend', '<section class="card"><h3>Recall to draft</h3><p class="small muted">Brings the document back to you for changes, for example to replace a signatory. Approvals given so far are cleared and the review starts again when you resubmit.</p><p><button class="ghost small" id="recallBtn">Recall to draft</button></p></section>');
      if (can.assignNumber) col.insertAdjacentHTML('beforeend', hrNumberCard(d));
      if (can.uploadSigned) col.insertAdjacentHTML('beforeend', uploadCard(d));
      if (doc.status === 'issued' || doc.status === 'obsolete') col.insertAdjacentHTML('beforeend', issuedCard(d));
      if (doc.status === 'signing' && !can.uploadSigned) col.insertAdjacentHTML('beforeend', `<section class="card action"><h3>Ready to print and sign</h3><p>HR has assigned <strong>${esc(doc.docId)}</strong>. Download the Word file, print it, collect the signatures, and return the signed copy to HR. HR scans it and issues the document.</p></section>`);
      if (doc.status === 'review' && !can.approve) {
        const stuck = d.signatories.find((x) => x.email === d.current && x.problem);
        col.insertAdjacentHTML('beforeend', `<section class="card"><h3>Under review</h3><p class="small">Waiting on <strong>${esc(s.waitingOn || '')}</strong>.${stuck ? ` <span class="warn-chip">${esc(stuck.problem)}</span> The author should recall the document and choose another signatory.` : ' You will see it again if it is returned.'}</p></section>`);
      }
      col.insertAdjacentHTML('beforeend', signatoryView(d));
      if (can.withdraw) col.insertAdjacentHTML('beforeend', '<section class="card"><h3>Withdraw</h3><p class="small muted">Stops the review. The document stays in your list as withdrawn.</p><p><button class="danger small" id="withdrawBtn">Withdraw document</button></p></section>');
    }
    col.insertAdjacentHTML('beforeend', historyCard(d));
    wireActions(d, reload);
  }

  // ----- Draft editor (author) -----
  function editorPanels(col, d, refreshPreview) {
    const { doc } = d;
    const id = doc.id;
    const sel = (name, opts, v) => `<select name="${name}">${opts.map((o) => { const [val, lbl] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}"${val === v ? ' selected' : ''}>${esc(lbl)}</option>`; }).join('')}</select>`;
    const last = d.events[d.events.length - 1];
    const returnedNote = last && last.action === 'Returned to author' ? last : null;

    col.innerHTML = `
      ${returnedNote ? `<div class="notice"><strong>Returned by ${esc(returnedNote.user)}:</strong> ${esc(returnedNote.comment)}</div>` : ''}
      <section class="card action" id="submitCard">
        <h3>Ready to submit?</h3>
        <p class="small">Resolve every highlighted item and drafting note, check the cover details, and name each reviewer and approver. Changes save automatically.</p>
        <div id="problems"></div>
        <div class="actions" style="margin-bottom:14px">
          <button id="submitBtn">Submit for review</button>
          <span id="outstanding"></span><span class="save-state" id="saveState"></span>
        </div>
      </section>
      <form id="editor" autocomplete="off">
      <section class="card"><h3>Cover page details</h3><div class="grid">
        <label class="full">Document title<input name="title" value="${esc(doc.title)}" maxlength="200"></label>
        <label class="full">Applicable to<input name="appliesTo" value="${esc(doc.appliesTo)}" maxlength="500" placeholder="e.g. All Departments"></label>
        <label>Document owner (optional)<input name="owner" value="${esc(doc.owner)}" maxlength="200" placeholder="Role within the department"></label>
        <label>Prepared by<input value="${esc(doc.authorName)}${doc.authorDesignation ? `, ${esc(doc.authorDesignation)}` : ''}" disabled></label>
        ${d.type.template === 'sop' ? `<label>Parent policy ID<input name="parentPolicy" value="${esc(doc.parentPolicy)}" maxlength="200" placeholder="e.g. QSD-POL-002-V1, or None"></label>` : ''}
        ${d.type.template === 'directive' ? `<label>Effective from<input type="date" name="effectiveFrom" value="${esc(doc.effectiveFrom)}"></label><label>Expiry or review date<input type="date" name="expiry" value="${esc(doc.expiry)}"></label>` : ''}
        <label>Confidentiality level${sel('confidentiality', ['Internal Use', 'Public', 'Confidential', 'Highly Confidential'], doc.confidentiality)}</label>
        ${d.type.clinical ? '' : `<label>Clinical impact${sel('clinicalImpact', ['No', 'Yes'], doc.clinicalImpact)}</label>`}
        <label class="full">How will it be signed?${sel('signMethod', [['electronic', 'Approved electronically in the portal'], ['wet', 'Printed and signed by hand after HR assigns the number']], doc.signMethod)}</label>
        ${doc.version > 1 ? `<label class="full">Summary of changes in this version<textarea name="changeSummary" rows="2">${esc(doc.changeSummary)}</textarea></label><label>Clause(s) changed<input name="changeClauses" value="${esc(doc.changeClauses)}" placeholder="e.g. 6.2, 7.1"></label>` : ''}
      </div></section>
      <section class="card"><h3>Reviewers and approvers</h3>
        <p class="small muted">Choose each reviewer and approver from the portal's signatories, in the order they will approve. Names and designations come from their accounts. Stages follow the approval matrix (COR-SOP-001 clause 14). If someone is missing from the list, ask the Super Admin to give them the Signatory role.</p>
        <div class="table-wrap"><table class="sig-table"><thead><tr><th style="width:38%">Stage</th><th>Person</th><th></th></tr></thead><tbody id="sigRows"></tbody></table></div>
        <p><button type="button" class="ghost small" id="addSig">Add a reviewer</button></p>
      </section>
      <section class="card"><h3>Content</h3>
        <p class="small muted">Edit each section in plain text. The preview and the Word file update when your changes are saved.</p>
        ${d.sectionList.map((sc) => `<label class="sec">${esc(sc.title)}${sc.hint ? `<span class="sec-hint">${esc(sc.hint)}</span>` : ''}<textarea name="sec_${esc(sc.key)}" rows="${sc.kind === 'text' ? 3 : Math.min(14, Math.max(3, (d.sections[sc.key] || '').split('\n').length + 1))}">${esc(d.sections[sc.key])}</textarea></label>`).join('')}
        ${doc.verbatim ? '<p class="small muted">This document was imported as written and its text is not editable here.</p>' : ''}
      </section>
      </form>
      ${d.can.withdraw ? '<section class="card"><h3>Withdraw</h3><p><button class="danger small" id="withdrawBtn" type="button">Withdraw document</button></p></section>' : ''}`;

    const sigRows = $('#sigRows');
    let people = [];
    const personOptions = (selected) => `<option value="">Choose a person…</option>${people.map((p) => `<option value="${p.id}"${p.id === selected ? ' selected' : ''}>${esc(p.name)} – ${esc(p.designation)}${p.deptName ? ` (${esc(p.deptName)})` : ''}</option>`).join('')}`;
    const addRow = (x, before) => {
      const tr = document.createElement('tr');
      const missing = x.userId && !people.some((p) => p.id === x.userId);
      tr.innerHTML = `<td><input data-k="stage" value="${esc(x.stage)}"></td><td><select data-k="userId">${personOptions(missing ? null : x.userId)}</select>${missing ? `<div class="small"><span class="warn-chip">${esc(x.name || 'Previous signatory')} is no longer available – choose again</span></div>` : ''}</td><td><button type="button" class="rm" title="Remove">×</button></td>`;
      if (before) sigRows.insertBefore(tr, before); else sigRows.appendChild(tr);
    };
    api('GET', '/api/signatories').then((list) => {
      people = list;
      d.signatories.forEach((x) => addRow(x));
    }).catch((e) => toast(e.message, true));

    const form = $('#editor');
    const payload = () => {
      const f = form.elements;
      const body = {};
      ['title', 'appliesTo', 'owner', 'parentPolicy', 'effectiveFrom', 'expiry', 'confidentiality', 'clinicalImpact', 'signMethod', 'changeSummary', 'changeClauses']
        .forEach((k) => { if (f[k]) body[k] = f[k].value; });
      body.sections = {};
      d.sectionList.forEach((sc) => { body.sections[sc.key] = f[`sec_${sc.key}`].value; });
      body.signatories = $$('tr', sigRows).map((tr) => ({ stage: $('[data-k=stage]', tr).value, userId: Number($('[data-k=userId]', tr).value) || null }));
      return body;
    };

    let timer = null; let saving = Promise.resolve(); let dirty = false;
    const showOutstanding = (o) => {
      const n = o.placeholders + o.notes;
      $('#outstanding').innerHTML = `<span class="outstanding${n ? ' bad' : ''}">${n ? `${o.placeholders} highlighted item(s), ${o.notes} note(s) to resolve` : 'No items outstanding'}</span>`;
    };
    showOutstanding(d.outstanding);
    const saveNow = () => {
      clearTimeout(timer); timer = null;
      if (!dirty) return saving;
      dirty = false;
      $('#saveState').textContent = 'Saving…';
      saving = saving.then(() => api('PUT', `/api/documents/${id}`, payload())).then((r) => {
        showOutstanding(r.outstanding);
        $('#saveState').textContent = `Saved ${new Date(r.savedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
        return refreshPreview();
      }).catch((e) => { dirty = true; $('#saveState').textContent = ''; toast(e.message, true); });
      return saving;
    };
    function schedule() { dirty = true; $('#saveState').textContent = 'Unsaved changes'; clearTimeout(timer); timer = setTimeout(saveNow, 1200); }
    form.addEventListener('input', schedule);
    form.addEventListener('change', schedule);
    $('#addSig').addEventListener('click', () => { addRow({ stage: 'Reviewed by (', userId: null }, sigRows.lastElementChild); schedule(); });
    sigRows.addEventListener('click', (e) => { if (e.target.classList.contains('rm')) { e.target.closest('tr').remove(); schedule(); } });
    leaveGuard = () => saveNow();
    window.onbeforeunload = () => (dirty ? 'You have unsaved changes.' : undefined);

    $('#submitBtn').addEventListener('click', async () => {
      const btn = $('#submitBtn');
      await saveNow();
      busy(btn, true, 'Submitting…');
      $('#problems').innerHTML = '';
      try {
        await api('POST', `/api/documents/${id}/submit`, {});
        toast('Submitted. The first reviewer can now see it under My work.');
        window.onbeforeunload = null; leaveGuard = null;
        docView(id);
      } catch (e) {
        busy(btn, false);
        $('#problems').innerHTML = `<ul class="problems">${(e.problems || [e.message]).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
      }
    });
  }

  // ----- Cards -----
  function approvalCard(d) {
    const me = d.signatories.find((s) => s.email === d.current);
    return `<section class="card action" id="approveCard"><h3>Your approval: ${esc(me.stage)}</h3>
      <p class="small">Read the document in the preview, then approve or return it to the author.${d.doc.signMethod === 'wet' ? ' This document will also be printed for your handwritten signature after HR assigns the number.' : ' Your approval is recorded as your electronic signature, with the date and time.'}</p>
      <dl class="profile"><dt>Signing as</dt><dd>${esc(ME.user.name)}</dd><dt>Designation</dt><dd>${esc(ME.user.designation || '—')}</dd></dl>
      <p class="small muted">Your name and designation come from your account. If they are wrong, ask the Super Admin to correct them before you approve.</p>
      <label>Comment (optional when approving, required when returning)<textarea id="apComment" rows="3"></textarea></label>
      <div class="actions" style="margin-bottom:16px"><button class="ok" id="approveBtn">Approve</button><button class="ghost" id="returnBtn">Return to author</button></div></section>`;
  }

  function hrNumberCard(d) {
    const wet = d.doc.signMethod === 'wet';
    return `<section class="card action hrc" id="hrCard"><h3>HR: verify approvals and assign the number</h3>
      <p class="small">All ${d.signatories.length} approvals are recorded. Check the signature table in the preview, then assign the number. ${wet ? 'The document then becomes FINAL for printing. The author collects handwritten signatures, and you upload the signed scan to issue it.' : 'The document is issued at once as a controlled copy.'}</p>
      <div class="id-preview" id="idPreview">…</div>
      <div class="inline"><label>Number<input id="hrSeq" type="number" min="1" max="999" style="width:110px"></label>
      <label>Effective date<input id="hrEff" type="date"></label><label>Review date<input id="hrRev" type="date"></label></div>
      <p class="small muted" id="hrRevNote"></p>
      <div class="actions" style="margin-bottom:12px"><button id="numberBtn">${wet ? 'Assign number – ready for printing' : 'Assign number and issue'}</button></div>
      <details><summary class="small">Return to the author instead</summary><label style="margin-top:10px">Reason<textarea id="hrReturnComment" rows="2"></textarea></label><button class="ghost small" id="hrReturnBtn">Return to author</button></details>
      </section>`;
  }

  function uploadCard(d) {
    return `<section class="card action hrc"><h3>HR: upload the signed copy</h3>
      <p class="small">The FINAL Word file (<strong>${esc(d.doc.docId)}</strong>) is ready to print. When all signatures are on it, scan it to PDF and upload it here to issue the document.</p>
      <label>Signed copy (PDF)<input type="file" id="signedFile" accept="application/pdf,.pdf"></label>
      <p><button id="uploadBtn">Upload and issue</button></p></section>`;
  }

  function issuedCard(d) {
    const { doc, can } = d;
    const issued = doc.status === 'issued';
    return `<section class="card ${issued ? 'action' : ''}"><h3>${issued ? 'Issued – controlled copy' : 'Obsolete – do not use'}</h3>
      <p class="small">${issued ? `Effective ${esc(fmtDate(doc.effectiveDate))}${doc.reviewDate ? `, review due ${esc(fmtDate(doc.reviewDate))}` : ''}. The owning department now completes rollout, training and acknowledgement as required (COR-SOP-001 clauses 16–20).` : 'This version has been superseded or withdrawn from use. It is kept for audit purposes.'}</p>
      <div class="actions" style="margin-bottom:12px">
        <a class="button small" href="/api/documents/${doc.id}/docx">Download ${issued ? 'controlled copy' : 'archived copy'}</a>
        ${doc.hasSigned ? `<a class="button small ghost" href="/api/documents/${doc.id}/signed">Signed copy (PDF)</a>` : ''}
        ${can.revise ? '<button class="ghost small" id="reviseBtn">Start a revision</button>' : ''}
      </div>
      ${can.makeObsolete ? '<details><summary class="small">HR: make this document obsolete</summary><label style="margin-top:10px">Reason<textarea id="obsComment" rows="2"></textarea></label><button class="danger small" id="obsBtn">Make obsolete</button></details>' : ''}
      </section>`;
  }

  function signatoryView(d) {
    const rows = [{ stage: 'Prepared by', name: d.doc.authorName, designation: d.doc.authorDesignation, prepared: true }, ...d.signatories];
    return `<section class="card"><h3>Reviewers and approvers</h3><div class="table-wrap"><table class="sig-table"><thead><tr><th>Stage</th><th>Name</th><th>Designation</th><th>Status</th></tr></thead><tbody>
      ${rows.map((x) => {
        let st = '';
        if (x.problem) st = `<span class="warn-chip">${esc(x.problem)}</span>`;
        else if (!x.prepared) st = x.status === 'approved' ? `<span class="sig-status approved">${x.actedAt ? `Approved ${esc(fmtStamp(x.actedAt))}` : 'Approved (signed on paper)'}</span>` : x.email === d.current ? '<span class="sig-status current">With them now</span>' : '<span class="sig-status pending">Pending</span>';
        return `<tr><td>${esc(x.stage)}</td><td>${esc(x.name)}</td><td>${esc(x.designation)}</td><td>${st}</td></tr>`;
      }).join('')}</tbody></table></div></section>`;
  }

  function historyCard(d) {
    return `<section class="card"><h3>History</h3><ul class="history">${d.events.slice().reverse().map((e) => `<li><strong>${esc(e.action)}</strong> · ${esc(e.user || '')}<br><span class="when">${esc(fmtStamp(e.at))}</span>${e.comment ? `<div class="c">${esc(e.comment)}</div>` : ''}</li>`).join('')}</ul></section>`;
  }

  // ----- Card actions -----
  function wireActions(d, reload) {
    const id = d.doc.id;
    const on = (s, fn) => { const el = $(s); if (el) el.addEventListener('click', (e) => { e.preventDefault(); fn(el); }); };
    const act = async (btn, text, fn, done) => {
      busy(btn, true, text);
      try { await fn(); toast(done); reload(); } catch (e) { busy(btn, false); toast(e.problems ? e.problems.join(' ') : e.message, true); }
    };

    on('#approveBtn', (b) => act(b, 'Approving…', () => api('POST', `/api/documents/${id}/approve`, { comment: $('#apComment').value }), 'Approved. Thank you.'));
    on('#recallBtn', (b) => { if (confirm('Recall this document to draft? Approvals given so far will be cleared.')) act(b, 'Recalling…', () => api('POST', `/api/documents/${id}/recall`, {}), 'Recalled. You can now edit it and resubmit.'); });
    on('#returnBtn', (b) => {
      if (!$('#apComment').value.trim()) { toast('Add a comment explaining what needs to change.', true); $('#apComment').focus(); return; }
      act(b, 'Returning…', () => api('POST', `/api/documents/${id}/return`, { comment: $('#apComment').value }), 'Returned to the author.');
    });
    on('#withdrawBtn', (b) => { if (confirm('Withdraw this document? Reviewers will no longer see it.')) act(b, 'Withdrawing…', () => api('POST', `/api/documents/${id}/withdraw`, {}), 'Withdrawn.'); });

    if ($('#hrCard')) {
      api('GET', `/api/documents/${id}/next-number`).then((n) => {
        $('#hrSeq').value = n.seq; $('#hrSeq').disabled = n.fixed;
        $('#hrEff').value = n.effectiveDate; $('#hrRev').value = n.reviewDate || '';
        $('#hrRevNote').textContent = n.fixed ? 'A new version keeps the number of the version it replaces.' : `Next free number for ${d.doc.deptCode}-${d.doc.prefix}. Review cycle: ${n.reviewText}.`;
        const upd = () => { $('#idPreview').textContent = `${d.doc.deptCode}-${d.doc.prefix}-${String($('#hrSeq').value || 0).padStart(3, '0')}-V${d.doc.version}`; };
        $('#hrSeq').addEventListener('input', upd); upd();
      }).catch((e) => toast(e.message, true));
      on('#numberBtn', (b) => act(b, 'Assigning…', () => api('POST', `/api/documents/${id}/number`, { seq: Number($('#hrSeq').value), effectiveDate: $('#hrEff').value, reviewDate: $('#hrRev').value }),
        d.doc.signMethod === 'wet' ? 'Number assigned. The document is FINAL and ready to print.' : 'Number assigned. The document is issued.'));
      on('#hrReturnBtn', (b) => act(b, 'Returning…', () => api('POST', `/api/documents/${id}/return`, { comment: $('#hrReturnComment').value }), 'Returned to the author.'));
    }
    on('#uploadBtn', (b) => {
      const f = $('#signedFile').files[0];
      if (!f) { toast('Choose the signed PDF first.', true); return; }
      act(b, 'Uploading…', () => api('POST', `/api/documents/${id}/signed`, f, 'application/pdf'), 'Signed copy uploaded. The document is issued.');
    });
    on('#reviseBtn', async (b) => {
      busy(b, true, 'Starting…');
      try { const r = await api('POST', `/api/documents/${id}/revise`, {}); location.hash = `#/doc/${r.id}`; } catch (e) { busy(b, false); toast(e.message, true); }
    });
    on('#obsBtn', (b) => act(b, 'Updating…', () => api('POST', `/api/documents/${id}/obsolete`, { comment: $('#obsComment').value }), 'Marked obsolete.'));
  }

  // ---------- My account / change password ----------
  function passwordView(forced) {
    const u = ME.user;
    const roles = u.roles.length ? u.roles.map((r) => `<span class="role ${esc(r)}">${esc(ME.roleNames[r])}</span>`).join('') : '<span class="role staff">Staff</span>';
    view.innerHTML = `<div class="view" style="max-width:640px">
      <h1 class="page-title">${forced ? 'Choose your password' : 'My account'}</h1>
      ${forced ? '<p class="lead">You signed in with a temporary password. Choose your own password to continue.</p>' : ''}
      ${forced ? '' : `<section class="card"><h3>Your details</h3><dl class="profile" style="margin-bottom:16px">
        <dt>Name</dt><dd>${esc(u.name)}</dd><dt>E-mail</dt><dd>${esc(u.email)}</dd><dt>Designation</dt><dd>${esc(u.designation || '—')}</dd>
        <dt>Department</dt><dd>${esc(ME.userDeptName || '—')}</dd><dt>Roles</dt><dd>${roles}</dd></dl>
        <p class="small muted">Only the Super Admin can change these details.</p></section>`}
      <section class="card"><h3>${forced ? 'New password' : 'Change password'}</h3>
        <form id="pwForm" novalidate>
          ${u.method === 'microsoft' && !forced ? '<p class="small muted">You signed in with Microsoft 365. If you have never set a portal password, leave "Current password" blank.</p>' : ''}
          <label>Current ${forced ? 'temporary ' : ''}password<input type="password" name="current" autocomplete="current-password"></label>
          <label>New password<input type="password" name="password" autocomplete="new-password"><span class="sec-hint">At least 10 characters, with letters and numbers.</span></label>
          <label>Repeat new password<input type="password" name="confirm" autocomplete="new-password"></label>
          <div id="pwMsg"></div>
          <p><button id="pwBtn">Save new password</button></p>
        </form></section></div>`;
    $('#pwForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const msg = (t) => { $('#pwMsg').innerHTML = t ? `<p class="problems" style="padding-left:14px">${esc(t)}</p>` : ''; };
      if (f.password.value !== f.confirm.value) { msg('The new passwords do not match.'); return; }
      busy($('#pwBtn'), true, 'Saving…');
      try {
        await api('POST', '/api/account/password', { current: f.current.value, password: f.password.value });
        toast('Your password has been changed.');
        if (forced) { location.hash = '#/'; location.reload(); } else { f.reset(); busy($('#pwBtn'), false); msg(''); }
      } catch (e) { busy($('#pwBtn'), false); msg(e.message); }
    });
  }

  // ---------- Register ----------
  async function registerView() {
    const rows = await api('GET', '/api/register');
    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    view.innerHTML = `<div class="view"><h1 class="page-title">Document register</h1>
      <p class="lead">${ME.user.isHR ? 'All controlled documents, and those in progress. Only the current issued version of a document is valid.' : 'Issued controlled documents. Only the current issued version of a document is valid.'}</p>
      <div class="filters">
        <label>Search<input id="fq" placeholder="Title or document ID"></label>
        <label>Department<select id="fd"><option value="">All departments</option>${ME.departments.map((x) => `<option value="${esc(x.code)}">${esc(x.name)} (${esc(x.code)})</option>`).join('')}</select></label>
        <label>Status<select id="fs"><option value="">All statuses</option>${Object.entries(ME.statusNames).map(([k, v]) => `<option value="${k}"${k === 'issued' ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        ${ME.user.isHR ? '<a class="button ghost small" href="/api/register.csv">Export to Excel (CSV)</a>' : ''}
      </div>
      <div class="table-wrap"><table class="reg"><thead><tr><th>Document ID</th><th>Title</th><th>Level / type</th><th>Department</th><th>Status</th><th>Effective</th><th>Review due</th></tr></thead><tbody id="regBody"></tbody></table></div>
      <p class="small muted" id="regCount"></p></div>`;
    const draw = () => {
      const qv = $('#fq').value.toLowerCase(); const dv = $('#fd').value; const sv = $('#fs').value;
      const list = rows.filter((r) => (!qv || `${r.title} ${r.docId || r.pendingId}`.toLowerCase().includes(qv)) && (!dv || r.dept === dv) && (!sv || r.status === sv));
      $('#regBody').innerHTML = list.map((r) => {
        const cls = r.status === 'issued' && r.reviewDate ? (r.reviewDate < today ? 'overdue' : r.reviewDate <= soon ? 'due' : '') : '';
        return `<tr data-id="${r.id}"><td><strong>${esc(r.docId || '—')}</strong></td><td>${esc(r.title)}</td><td><span class="pill" style="background:#${esc(r.colour)};color:#102256">L${r.level}</span> ${esc(r.type)}</td><td>${esc(r.dept)}</td><td>${pill(r.status, r.statusName)}</td><td>${esc(fmtDate(r.effectiveDate))}</td><td class="${cls}">${esc(fmtDate(r.reviewDate))}</td></tr>`;
      }).join('') || '<tr><td colspan="7" class="muted">No documents match.</td></tr>';
      $('#regCount').textContent = `${list.length} of ${rows.length} documents`;
    };
    ['#fq', '#fd', '#fs'].forEach((x) => $(x).addEventListener('input', draw));
    $('#regBody').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) location.hash = `#/doc/${tr.dataset.id}`; });
    draw();
  }

  // ---------- Start ----------
  (async () => {
    try { ME = await api('GET', '/api/me'); } catch (e) { view.innerHTML = '<p class="loading">Could not load the portal. Refresh the page.</p>'; return; }
    $('#userName').textContent = ME.user.name;
    const badge = ME.user.isAdmin ? 'Super Admin' : ME.user.isHR ? 'HR' : '';
    $('#roleBadge').textContent = badge; $('#roleBadge').hidden = !badge;
    $('#navNew').hidden = !ME.user.isAuthor;
    $('#navAdmin').hidden = !ME.user.isAdmin;
    if (ME.user.mustChange) $('#nav').hidden = true;
    Object.assign(window.ADK, { api, toast, esc, $, $$, busy, fmtDate, fmtStamp, ME });
    window.addEventListener('hashchange', route);
    route();
  })();
})();
