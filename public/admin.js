// ADK Document Portal – Super Admin screens: Users, Departments, Settings, Audit log.
(function () {
  'use strict';
  const A = () => window.ADK;
  const esc = (s) => A().esc(s);

  const TABS = [['users', 'Users'], ['departments', 'Departments'], ['settings', 'Settings'], ['audit', 'Audit log']];
  const ROLE_HELP = {
    admin: 'Users, departments and settings',
    hr: 'Numbering, issue, register, obsolete',
    controller: 'Oversees their department\'s documents',
    author: 'Drafts and submits documents',
    signatory: 'Can be chosen to review or approve',
  };

  function shell(tab, inner) {
    return `<div class="view"><h1 class="page-title">Administration</h1>
      <nav class="subnav">${TABS.map(([k, l]) => `<a href="#/admin/${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</nav>${inner}</div>`;
  }
  const roleChips = (roles, names) => (roles.length ? roles.map((r) => `<span class="role ${esc(r)}">${esc(names[r] || r)}</span>`).join('') : '<span class="role staff">Staff</span>');
  const problemsHtml = (e) => `<ul class="problems">${(e.problems || [e.message]).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;

  async function render(sub, view) {
    const tab = sub.split('/')[0];
    if (tab === 'departments') return departments(view);
    if (tab === 'settings') return settingsView(view);
    if (tab === 'audit') return audit(view);
    return users(view);
  }

  // ======================================================================
  // Users
  // ======================================================================
  async function users(view) {
    const { api, toast, ME, $, busy } = A();
    const [list, depts] = await Promise.all([api('GET', '/api/admin/users'), api('GET', '/api/admin/departments')]);
    const activeDepts = depts.filter((d) => d.active);
    const deptOptions = (sel) => `<option value="">No department</option>${activeDepts.map((d) => `<option value="${esc(d.code)}"${d.code === sel ? ' selected' : ''}>${esc(d.name)} (${esc(d.code)})</option>`).join('')}`;
    const roleBoxes = (sel) => `<div class="checks">${Object.entries(ME.roleNames).map(([k, l]) => `<label><input type="checkbox" name="roles" value="${k}"${sel.includes(k) ? ' checked' : ''}><span>${esc(l)}<small>${esc(ROLE_HELP[k])}</small></span></label>`).join('')}</div>`;
    const form = (u) => `
      <div class="grid">
        ${u ? `<label class="full">E-mail<input value="${esc(u.email)}" disabled></label>` : '<label class="full">E-mail (their sign-in name)<input name="email" type="email" placeholder="name@adkhospital.com"></label>'}
        <label>Full name<input name="name" value="${esc(u ? u.name : '')}"></label>
        <label>Designation<input name="designation" value="${esc(u ? u.designation : '')}" placeholder="As it should appear on signature tables"></label>
        <label class="full">Department<select name="dept">${deptOptions(u ? u.dept : '')}</select></label>
      </div>
      <p class="small" style="margin:0"><strong>Roles</strong> <span class="muted">– every user can view and download issued documents</span></p>
      ${roleBoxes(u ? u.roles : ['author'])}`;

    view.innerHTML = shell('users', `
      <div id="tempBox"></div>
      <section class="card" id="editCard" hidden></section>
      <div class="filters">
        <label>Search<input id="uq" placeholder="Name, e-mail or designation"></label>
        <label>Role<select id="ur"><option value="">All roles</option>${Object.entries(ME.roleNames).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
        <label>Status<select id="us"><option value="active">Active</option><option value="inactive">Deactivated</option><option value="">All</option></select></label>
        <button class="small" id="addUser">Add user</button>
      </div>
      <div class="table-wrap"><table class="reg"><thead><tr><th>Name</th><th>E-mail</th><th>Designation</th><th>Department</th><th>Roles</th><th>Last sign-in</th></tr></thead><tbody id="uBody"></tbody></table></div>
      <p class="small muted" id="uCount"></p>`);

    const showTemp = (u, pw, what) => {
      $('#tempBox').innerHTML = `<div class="temp-pw"><strong>${esc(what)} for ${esc(u)}.</strong> Give them this temporary password. It is shown only once; they must choose their own password when they first sign in.<br><code>${esc(pw)}</code></div>`;
      window.scrollTo(0, 0);
    };
    const draw = () => {
      const q = $('#uq').value.toLowerCase(); const role = $('#ur').value; const st = $('#us').value;
      const rows = list.filter((u) => (!q || `${u.name} ${u.email} ${u.designation}`.toLowerCase().includes(q)) && (!role || u.roles.includes(role)) && (!st || (st === 'active' ? u.active : !u.active)));
      $('#uBody').innerHTML = rows.map((u) => `<tr data-id="${u.id}" class="${u.active ? '' : 'inactive'}"><td><strong>${esc(u.name)}</strong>${u.active ? '' : ' <span class="warn-chip">Deactivated</span>'}${u.locked ? ' <span class="warn-chip">Locked</span>' : ''}${u.mustChange && u.active ? ' <span class="role">Temporary password</span>' : ''}</td><td>${esc(u.email)}</td><td>${esc(u.designation)}</td><td>${esc(u.dept || '—')}</td><td>${roleChips(u.roles, ME.roleNames)}</td><td>${esc(u.lastLogin ? A().fmtStamp(u.lastLogin) : 'Never')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No users match.</td></tr>';
      $('#uCount').textContent = `${rows.length} of ${list.length} users`;
    };
    ['#uq', '#ur', '#us'].forEach((s) => $(s).addEventListener('input', draw));
    draw();

    const readForm = (card) => ({
      email: card.querySelector('[name=email]') ? card.querySelector('[name=email]').value : undefined,
      name: card.querySelector('[name=name]').value,
      designation: card.querySelector('[name=designation]').value,
      dept: card.querySelector('[name=dept]').value,
      roles: [...card.querySelectorAll('[name=roles]:checked')].map((c) => c.value),
    });

    $('#addUser').addEventListener('click', () => {
      const card = $('#editCard');
      card.hidden = false;
      card.innerHTML = `<h3>Add user</h3>${form(null)}<div id="uErr"></div><div class="actions" style="margin-bottom:14px"><button id="saveNew">Create account</button><button class="ghost" id="cancel">Cancel</button></div>`;
      card.querySelector('[name=email]').focus();
      $('#cancel').onclick = () => { card.hidden = true; };
      $('#saveNew').onclick = async () => {
        const btn = $('#saveNew'); busy(btn, true, 'Creating…');
        try {
          const body = readForm(card);
          const r = await api('POST', '/api/admin/users', body);
          await users(view);
          showTemp(body.name, r.tempPassword, 'Account created');
          toast('Account created.');
        } catch (e) { busy(btn, false); $('#uErr').innerHTML = problemsHtml(e); }
      };
    });

    $('#uBody').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      const u = list.find((x) => x.id === Number(tr.dataset.id));
      const card = $('#editCard');
      card.hidden = false;
      const work = [u.pendingApprovals ? `${u.pendingApprovals} document(s) waiting for their approval` : '', u.openDrafts ? `${u.openDrafts} draft(s) in progress` : ''].filter(Boolean).join(', ');
      card.innerHTML = `<h3>${esc(u.name)}</h3>
        <p class="meta-line">Created ${esc(A().fmtStamp(u.createdAt))}${u.createdBy ? ` by ${esc(u.createdBy)}` : ''} · Last sign-in ${esc(u.lastLogin ? A().fmtStamp(u.lastLogin) : 'never')}${work ? ` · ${esc(work)}` : ''}</p>
        ${form(u)}<div id="uErr"></div>
        <div class="actions" style="margin-bottom:14px">
          <button id="saveUser"${u.active ? '' : ' disabled'}>Save changes</button>
          <button class="ghost" id="resetPw"${u.active ? '' : ' disabled'}>Reset password</button>
          ${u.active ? '<button class="danger" id="toggle">Deactivate</button>' : '<button class="ok" id="toggle">Reactivate</button>'}
          <button class="ghost" id="cancel">Close</button>
        </div>
        ${u.active ? '<p class="small muted">Deactivated users cannot sign in. Their accounts and document history are kept; nothing is deleted.</p>' : ''}`;
      window.scrollTo(0, 0);
      $('#cancel').onclick = () => { card.hidden = true; };
      $('#saveUser').onclick = async () => {
        const btn = $('#saveUser'); busy(btn, true, 'Saving…');
        try { await api('PUT', `/api/admin/users/${u.id}`, readForm(card)); toast('Saved.'); await users(view); } catch (err) { busy(btn, false); $('#uErr').innerHTML = problemsHtml(err); }
      };
      $('#resetPw').onclick = async () => {
        if (!confirm(`Reset ${u.name}'s password? They will be signed out and must sign in with a new temporary password.`)) return;
        try { const r = await api('POST', `/api/admin/users/${u.id}/reset-password`, {}); await users(view); showTemp(u.name, r.tempPassword, 'Password reset'); } catch (err) { toast(err.message, true); }
      };
      $('#toggle').onclick = async () => {
        let reason = '';
        if (u.active) {
          reason = prompt(`Deactivate ${u.name}? They will be signed out and cannot sign in again. Their history is kept.\n\nReason (for the audit log):`, 'Left the hospital');
          if (reason === null) return;
        }
        try {
          const r = await api('POST', `/api/admin/users/${u.id}/active`, { active: !u.active, reason });
          await users(view);
          toast(r.warning || (u.active ? 'Account deactivated.' : 'Account reactivated.'), !!r.warning);
        } catch (err) { toast(err.message, true); }
      };
    });
  }

  // ======================================================================
  // Departments
  // ======================================================================
  async function departments(view) {
    const { api, toast, $, busy } = A();
    const [list, people] = await Promise.all([api('GET', '/api/admin/departments'), api('GET', '/api/admin/users')]);
    const activePeople = people.filter((u) => u.active);
    const headOptions = (sel) => `<option value="">Not set</option>${activePeople.map((u) => `<option value="${u.id}"${u.id === sel ? ' selected' : ''}>${esc(u.name)} – ${esc(u.designation)}</option>`).join('')}`;

    view.innerHTML = shell('departments', `
      <p class="lead">Department codes form the first part of every document number (COR-SOP-001 clause 8 and Appendix 1). A code cannot be changed once documents or users use it; add a new department and deactivate the old one instead.</p>
      <section class="card" id="deptCard" hidden></section>
      <div class="filters"><label>Search<input id="dq" placeholder="Code or name"></label>
        <label>Status<select id="ds"><option value="active">Active</option><option value="inactive">Deactivated</option><option value="">All</option></select></label>
        <button class="small" id="addDept">Add department</button></div>
      <div class="table-wrap"><table class="reg"><thead><tr><th>Code</th><th>Department</th><th>Head of Department</th><th>Users</th><th>Documents</th><th>Status</th></tr></thead><tbody id="dBody"></tbody></table></div>
      <p class="small muted" id="dCount"></p>`);

    const draw = () => {
      const q = $('#dq').value.toLowerCase(); const st = $('#ds').value;
      const rows = list.filter((d) => (!q || `${d.code} ${d.name}`.toLowerCase().includes(q)) && (!st || (st === 'active' ? d.active : !d.active)));
      $('#dBody').innerHTML = rows.map((d) => `<tr data-id="${d.id}" class="${d.active ? '' : 'inactive'}"><td><strong>${esc(d.code)}</strong></td><td>${esc(d.name)}</td><td>${esc(d.headName || '—')}</td><td>${d.users}</td><td>${d.documents}</td><td>${d.active ? '<span class="pill issued">Active</span>' : '<span class="pill obsolete">Deactivated</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No departments match.</td></tr>';
      $('#dCount').textContent = `${rows.length} of ${list.length} departments`;
    };
    ['#dq', '#ds'].forEach((s) => $(s).addEventListener('input', draw));
    draw();

    const open = (d) => {
      const card = $('#deptCard');
      card.hidden = false;
      const locked = d && (d.documents || d.users);
      card.innerHTML = `<h3>${d ? esc(d.name) : 'Add department'}</h3><div class="grid">
        <label>Code<input name="code" value="${esc(d ? d.code : '')}" maxlength="4" style="text-transform:uppercase"${locked ? ' disabled' : ''}>${locked ? '<span class="sec-hint">In use – cannot be changed</span>' : ''}</label>
        <label>Department name<input name="name" value="${esc(d ? d.name : '')}"></label>
        <label class="full">Head of Department<select name="head">${headOptions(d ? d.headUserId : null)}</select><span class="sec-hint">The Head of Department can see all of the department's documents, including drafts.</span></label>
      </div><div id="dErr"></div>
      <div class="actions" style="margin-bottom:14px"><button id="saveDept">${d ? 'Save changes' : 'Add department'}</button>
      ${d ? (d.active ? '<button class="danger" id="toggleDept">Deactivate</button>' : '<button class="ok" id="toggleDept">Reactivate</button>') : ''}
      <button class="ghost" id="closeDept">Close</button></div>
      ${d && d.active ? '<p class="small muted">A deactivated department cannot be chosen for new users or documents. Existing documents keep their numbers.</p>' : ''}`;
      window.scrollTo(0, 0);
      $('#closeDept').onclick = () => { card.hidden = true; };
      const body = () => ({ code: card.querySelector('[name=code]').value, name: card.querySelector('[name=name]').value, headUserId: Number(card.querySelector('[name=head]').value) || null });
      $('#saveDept').onclick = async () => {
        const btn = $('#saveDept'); busy(btn, true, 'Saving…');
        try {
          if (d) await api('PUT', `/api/admin/departments/${d.id}`, body()); else await api('POST', '/api/admin/departments', body());
          toast('Saved.'); await departments(view);
        } catch (e) { busy(btn, false); $('#dErr').innerHTML = problemsHtml(e); }
      };
      if (d) $('#toggleDept').onclick = async () => {
        if (d.active && !confirm(`Deactivate ${d.name} (${d.code})?`)) return;
        try { await api('PUT', `/api/admin/departments/${d.id}`, { ...body(), active: !d.active }); toast(d.active ? 'Department deactivated.' : 'Department reactivated.'); await departments(view); } catch (e) { toast(e.problems ? e.problems.join(' ') : e.message, true); }
      };
    };
    $('#addDept').addEventListener('click', () => open(null));
    $('#dBody').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) open(list.find((x) => x.id === Number(tr.dataset.id))); });
  }

  // ======================================================================
  // Settings
  // ======================================================================
  async function settingsView(view) {
    const { api, toast, $, busy, fmtStamp } = A();
    const s = await api('GET', '/api/admin/settings');
    const changed = (at, by) => (at ? `Last changed ${esc(fmtStamp(at))}${by ? ` by ${esc(by)}` : ''}` : 'Default settings');
    const ta = (name, val, rows = 3) => `<textarea name="${name}" rows="${rows}">${esc(val)}</textarea>`;

    const typeCard = (key, t) => `
      <section class="card type-card" data-key="${esc(key)}">
        <h3><span class="swatch" style="background:#${esc(t.colour)}"></span>Level ${t.level} · ${esc(t.label)}</h3>
        <div class="grid">
          <label>Name<input name="label" value="${esc(t.label)}"></label>
          <label>Number prefix<input name="prefix" value="${esc(t.prefix)}" maxlength="4"${t.variants ? ' disabled' : ''}>${t.variants ? '<span class="sec-hint">Set per type below</span>' : ''}</label>
          <label>Colour (hex)<input name="colour" value="${esc(t.colour)}" maxlength="7"></label>
          <label>Review cycle (years)<input name="reviewYears" type="number" min="1" max="10" value="${t.reviewYears ?? ''}" placeholder="Blank = as needed"></label>
          <label class="full" style="grid-column: span 2">Review cycle wording<input name="reviewText" value="${esc(t.reviewText)}"></label>
          ${t.variants ? '' : `<label>Review stages (one per line)${ta('reviewers', (t.reviewers || []).join('\n'), 3)}</label>
          <label>Final approval${ta('finalApproval', t.finalApproval, 3)}</label>`}
          <label${t.variants ? ' class="full" style="grid-column: 1 / -1"' : ''}>Rollout (communication, training, acknowledgement)${ta('rollout', t.rollout, 3)}</label>
        </div>
        ${t.variants ? `<p class="small" style="margin:4px 0 8px"><strong>${esc(t.variantLabel)}</strong></p>
          <div class="table-wrap"><table class="sig-table"><thead><tr><th>Type</th><th>Prefix</th><th>Review stages (one per line)</th><th>Final approval</th></tr></thead><tbody>
          ${Object.entries(t.variants).map(([vk, v]) => `<tr data-variant="${esc(vk)}"><td><input name="v_label" value="${esc(v.label)}"></td><td><input name="v_prefix" value="${esc(v.prefix || t.prefix)}" maxlength="4" style="width:80px"></td>
            <td><textarea name="v_reviewers" rows="2">${esc((v.reviewers || t.reviewers || []).join('\n'))}</textarea></td><td><textarea name="v_finalApproval" rows="2">${esc(v.finalApproval || t.finalApproval)}</textarea></td></tr>`).join('')}
          </tbody></table></div>` : ''}
        <div class="err"></div>
        <div class="actions" style="margin-bottom:14px"><button class="small save-type">Save ${esc(t.label)}</button></div>
      </section>`;

    view.innerHTML = shell('settings', `
      <p class="lead">These settings control new documents: their numbering prefixes, colours, review cycles and the approval matrix (COR-SOP-001 clauses 5, 9, 14 and 22). Every change is recorded in the audit log. Documents already created keep their numbers and approval stages.</p>
      <section class="card" id="genCard"><h3>General</h3><p class="meta-line">${changed(s.generalUpdatedAt, s.generalUpdatedBy)}</p>
        <div class="grid"><label>Allowed e-mail domains for user accounts (one per line)${ta('allowedEmailDomains', (s.general.allowedEmailDomains || []).join('\n'), 2)}<span class="sec-hint">Leave blank to allow any domain.</span></label>
        <label>AI drafts per person per hour<input name="draftsPerHour" type="number" min="1" max="200" value="${esc(s.general.draftsPerHour)}"></label></div>
        <div class="err"></div><div class="actions" style="margin-bottom:14px"><button class="small" id="saveGen">Save general settings</button></div></section>
      <h2 style="font-size:17px;color:var(--navy);margin:24px 0 6px">Document types and approval matrix</h2>
      <p class="meta-line">${changed(s.typesUpdatedAt, s.typesUpdatedBy)}</p>
      ${Object.entries(s.types).map(([k, t]) => typeCard(k, t)).join('')}`);

    $('#saveGen').onclick = async () => {
      const card = $('#genCard'); const btn = $('#saveGen'); busy(btn, true, 'Saving…');
      try {
        await api('PUT', '/api/admin/settings/general', { allowedEmailDomains: card.querySelector('[name=allowedEmailDomains]').value, draftsPerHour: Number(card.querySelector('[name=draftsPerHour]').value) });
        toast('General settings saved.'); await settingsView(view);
      } catch (e) { busy(btn, false); card.querySelector('.err').innerHTML = problemsHtml(e); }
    };
    view.querySelectorAll('.save-type').forEach((btn) => btn.addEventListener('click', async () => {
      const card = btn.closest('.type-card');
      const val = (n) => { const el = card.querySelector(`[name=${n}]`); return el && !el.disabled ? el.value : undefined; };
      const body = { label: val('label'), prefix: val('prefix'), colour: val('colour'), reviewYears: val('reviewYears'), reviewText: val('reviewText'), reviewers: val('reviewers'), finalApproval: val('finalApproval'), rollout: val('rollout') };
      Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);
      const vrows = card.querySelectorAll('tr[data-variant]');
      if (vrows.length) {
        body.variants = {};
        vrows.forEach((tr) => { body.variants[tr.dataset.variant] = { label: tr.querySelector('[name=v_label]').value, prefix: tr.querySelector('[name=v_prefix]').value, reviewers: tr.querySelector('[name=v_reviewers]').value, finalApproval: tr.querySelector('[name=v_finalApproval]').value }; });
      }
      busy(btn, true, 'Saving…');
      try { const r = await api('PUT', `/api/admin/settings/types/${card.dataset.key}`, body); toast(r.unchanged ? 'No changes to save.' : 'Saved. New documents will use these settings.'); await settingsView(view); } catch (e) { busy(btn, false); card.querySelector('.err').innerHTML = problemsHtml(e); }
    }));
  }

  // ======================================================================
  // Audit log
  // ======================================================================
  async function audit(view) {
    const { api, $, fmtStamp } = A();
    view.innerHTML = shell('audit', `
      <p class="lead">Every change to users, roles, departments and settings, and every failed or refused sign-in. Document actions are recorded in each document's own history.</p>
      <div class="filters"><label>Search<input id="aq" placeholder="Person, action or detail"></label><a class="button ghost small" id="aCsv" href="/api/admin/audit.csv">Export to Excel (CSV)</a></div>
      <div class="table-wrap"><table class="reg"><thead><tr><th style="width:150px">When</th><th>By</th><th>Action</th><th>Concerning</th></tr></thead><tbody id="aBody"><tr><td colspan="4" class="muted">Loading…</td></tr></tbody></table></div>
      <p class="small muted" id="aCount"></p>`);
    const fmtVal = (v) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
    const details = (d) => {
      if (!d) return '';
      const entries = Object.entries(d);
      if (entries.every(([, v]) => v && typeof v === 'object' && 'from' in v && 'to' in v)) {
        return `<ul class="diff">${entries.map(([k, v]) => `<li><b>${esc(k)}</b>: <del>${esc(fmtVal(v.from))}</del> → <ins>${esc(fmtVal(v.to))}</ins></li>`).join('')}</ul>`;
      }
      return `<ul class="diff">${entries.map(([k, v]) => `<li><b>${esc(k)}</b>: ${esc(fmtVal(v))}</li>`).join('')}</ul>`;
    };
    let timer;
    const load = async () => {
      const q = $('#aq').value;
      $('#aCsv').href = `/api/admin/audit.csv${q ? `?q=${encodeURIComponent(q)}` : ''}`;
      const rows = await api('GET', `/api/admin/audit${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      $('#aBody').innerHTML = rows.map((e) => `<tr style="cursor:default"><td>${esc(fmtStamp(e.at))}</td><td>${esc(e.user || 'System')}</td><td><strong>${esc(e.action)}</strong>${details(e.details)}</td><td>${esc(e.target || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No entries.</td></tr>';
      $('#aCount').textContent = `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}${rows.length === 500 ? ' (latest 500 shown; export for all)' : ''}`;
    };
    $('#aq').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
    await load();
  }

  window.AdminViews = { render };
})();
