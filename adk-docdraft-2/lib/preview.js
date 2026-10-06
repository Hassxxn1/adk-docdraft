// HTML preview of a document, built from the same cover-page model and blocks as the Word file.
const { frontMatter } = require('./frontmatter');
const { contentToBlocks } = require('./blocks');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Highlights "[Author to confirm ...]" placeholders.
const rich = (s) => esc(s).replace(/(\[Author to confirm[^\]]*\])/g, '<mark class="atc">$1</mark>');
const segs = (list) => list.map((x) => (x.muted ? `<span class="muted">${esc(x.text)}</span>` : rich(x.text))).join('');
const depth = (num) => String(num).split('.').length;

function tableHtml(t, under) {
  const head = t.header ? `<thead><tr>${t.header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>` : '';
  const body = t.rows.map((r, ri) => {
    const fill = t.fills && t.fills[ri] ? ` style="background:#${esc(t.fills[ri])}"` : '';
    return `<tr${fill}>${r.map((c, i) => `<td${t.boldFirst && i === 0 ? ' class="b"' : ''}>${rich(c)}</td>`).join('')}</tr>`;
  }).join('');
  return `<table class="dt${under ? ` u${Math.min(depth(under), 4)}` : ''}">${head}<tbody>${body}</tbody></table>`;
}

function blocksHtml(blocks) {
  return blocks.map((b) => {
    if (b.h !== undefined) return `<h3 class="dh"><span>${esc(b.h)}.</span>${esc(b.text)}</h3>`;
    if (b.n) {
      const label = b.label ? `<strong>${esc(b.label)}</strong> ` : '';
      return `<p class="cl d${Math.min(depth(b.n), 4)}"><span class="num">${esc(b.n)}.</span><span>${label}${rich(b.text || '')}</span></p>`;
    }
    if (b.table) return tableHtml(b.table, b.under);
    if (b.bullets) return `<ul class="bl">${b.bullets.map((x) => `<li>${rich(x)}</li>`).join('')}</ul>`;
    if (b.p !== undefined) return `<p class="${b.muted ? 'muted ind' : ''}${b.bold ? ' b' : ''}">${b.muted ? esc(b.p) : rich(b.p)}</p>`;
    if (b.appendix) return `<hr class="pb"><h3 class="dh app">${esc(b.appendix)}</h3>`;
    if (b.form) {
      const f = b.form;
      return `<hr class="pb"><h3 class="dh app">${esc(f.title.toUpperCase())}</h3><p class="muted">${esc(f.idText)} · Fields marked * are mandatory.</p>${f.sections.map((s) => `<table class="dt form"><thead><tr><th colspan="2" style="background:#${esc(f.colour)};color:#102256">${esc(s.section)}</th></tr></thead><tbody>${(s.fields || []).map((fl) => `<tr><td class="b">${esc(fl.field)}${fl.mandatory ? ' *' : ''}</td><td></td></tr>`).join('')}</tbody></table>`).join('')}`;
    }
    return '';
  }).join('\n');
}

function renderHtml(type, meta, content) {
  const fm = frontMatter(type, meta);
  const blocks = contentToBlocks(type, content, meta);
  const sig = fm.signatures.map((r) => `<tr><td class="b">${esc(r.stage)}</td><td>${esc(r.name)}</td><td>${esc(r.designation)}</td><td class="sig">${esc(r.signature || '')}</td><td>${esc(r.date || '')}</td></tr>`).join('');
  const rev = fm.revisions.map((r) => `<tr><td>${esc(r.version)}</td><td>${esc(r.date)}</td><td>${esc(r.clauses)}</td><td>${esc(r.summary)}</td><td>${esc(r.approvedBy)}</td></tr>`).join('');
  const flags = fm.flags.length ? `<div class="flags"><strong>Drafting notes – resolve and delete before submitting for review</strong><ol>${fm.flags.map((f) => `<li>${rich(f)}</li>`).join('')}</ol></div>` : '';
  return `<div class="page" style="--lvl:#${esc(fm.colour)}">
  <div class="lh"><img src="/assets/letterhead.png" alt="ADK Hospital letterhead"></div>
  <div class="band"><div class="lv">LEVEL ${fm.level} · ${esc(fm.typeLabel.toUpperCase())}</div><div class="ttl">${esc(fm.title)}</div><div>${esc(fm.deptName)} · <strong>${esc(fm.statusLabel)}</strong></div></div>
  <h4>Document control</h4>
  <table class="dt ctl"><tbody>${fm.control.map(([k, v]) => `<tr><td class="b">${esc(k)}</td><td>${segs(v)}</td></tr>`).join('')}</tbody></table>
  <h4>Approval signatures</h4>
  <table class="dt"><thead><tr><th>Stage</th><th>Name</th><th>Designation</th><th>Signature</th><th>Date</th></tr></thead><tbody>${sig}</tbody></table>
  <h4>Revision history</h4>
  <table class="dt"><thead><tr><th>Version</th><th>Date</th><th>Clause(s)</th><th>Summary of change</th><th>Approved by</th></tr></thead><tbody>${rev}</tbody></table>
  ${flags}
  <div class="body">${blocksHtml(blocks)}</div>
  <div class="ft">${esc(fm.footer)}</div>
</div>`;
}

module.exports = { renderHtml };
