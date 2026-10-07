// Content editor: each document section is edited as plain text and parsed back into structured content.
// Text conventions (shown to authors as hints):
//   lines   one item per line
//   pairs   "Term: meaning" per line
//   groups  a heading line, then its items on lines starting with "-"
//   steps   as groups; an item may start "Role: action"
//   rows    "Record | Kept by | Retention" per line
//   form    a section heading line, then "- Field: guidance" lines; add "(optional)" to a field name if not mandatory

const S = {
  purpose: { title: 'Purpose', kind: 'text' },
  scope: { title: 'Scope', kind: 'text' },
  definitions: { title: 'Definitions', kind: 'pairs', hint: 'One per line: Term: meaning' },
  policyStatements: { title: 'Policy statements', kind: 'lines', hint: 'One requirement per line, using "shall".' },
  roles: { title: 'Roles and responsibilities', kind: 'groups', hint: 'Role on its own line, then each responsibility on a line starting with "-".' },
  prerequisites: { title: 'Prerequisites', kind: 'lines' },
  procedure: { title: 'Procedure', kind: 'steps', hint: 'Stage on its own line, then each step on a line starting with "-". Start a step with "Role:" to name who does it.' },
  records: { title: 'Records', kind: 'rows', hint: 'One per line: Record | Kept by | Retention' },
  monitoring: { title: 'Monitoring and compliance', kind: 'lines' },
  training: { title: 'Implementation and training', kind: 'lines' },
  related: { title: 'Related documents', kind: 'lines', hint: 'Document ID and title, one per line.' },
  references: { title: 'References', kind: 'lines', hint: 'Cite each law, regulation or standard exactly, one per line.' },
  guidance: { title: 'Recommended practice', kind: 'groups', hint: 'Topic on its own line, then each recommendation on a line starting with "-".' },
  completionInstructions: { title: 'Completion instructions', kind: 'lines' },
  formSections: { title: 'Form fields', kind: 'form', hint: 'Section heading on its own line, then "- Field: guidance". Add "(optional)" after a field name if it is not mandatory.' },
  background: { title: 'Background', kind: 'text', hint: 'Why this directive is needed now.' },
  directiveInstructions: { title: 'Directive', kind: 'lines', hint: 'One instruction per line, using "shall".' },
  conversion: { title: 'Conversion to a formal document', kind: 'text' },
  authorFlags: { title: 'Drafting notes', kind: 'lines', hint: 'Resolve each note, then delete it. A document cannot be submitted while notes remain.' },
};

const ORDER = {
  policy: ['purpose', 'scope', 'definitions', 'policyStatements', 'roles', 'monitoring', 'training', 'related', 'references'],
  sop: ['purpose', 'scope', 'definitions', 'roles', 'prerequisites', 'procedure', 'records', 'monitoring', 'training', 'related', 'references'],
  guideline: ['purpose', 'scope', 'definitions', 'guidance', 'roles', 'training', 'related', 'references'],
  form: ['purpose', 'scope', 'definitions', 'completionInstructions', 'formSections', 'records', 'related'],
  directive: ['purpose', 'background', 'scope', 'directiveInstructions', 'roles', 'conversion', 'training', 'related', 'references'],
};

const TITLE_OVERRIDES = { form: { scope: 'When to use' }, directive: { scope: 'Applies to', training: 'Communication' }, guideline: { training: 'Implementation' } };

function sectionList(template) {
  return [...ORDER[template], 'authorFlags'].map((key) => ({
    key,
    title: (TITLE_OVERRIDES[template] || {})[key] || S[key].title,
    kind: S[key].kind,
    hint: S[key].hint || '',
  }));
}

// ---------- serialise structured content to editable text ----------

function toText(kind, v) {
  switch (kind) {
    case 'text': return v || '';
    case 'lines': return (v || []).join('\n');
    case 'pairs': return (v || []).map((d) => `${d.term}: ${d.definition}`).join('\n');
    case 'groups': {
      const [g, items] = v && v.length && 'topic' in (v[0] || {}) ? ['topic', 'recommendations'] : ['role', 'responsibilities'];
      return (v || []).map((x) => [x[g], ...(x[items] || []).map((i) => `- ${i}`)].join('\n')).join('\n\n');
    }
    case 'steps': return (v || []).map((s) => [s.stage, ...(s.steps || []).map((st) => `- ${st.actor ? `${st.actor}: ` : ''}${st.action}`)].join('\n')).join('\n\n');
    case 'rows': return (v || []).map((r) => [r.record, r.keptBy, r.retention].join(' | ')).join('\n');
    case 'form': return (v || []).map((s) => [s.section, ...(s.fields || []).map((f) => `- ${f.field}${f.mandatory ? '' : ' (optional)'}: ${f.guidance}`)].join('\n')).join('\n\n');
    default: return '';
  }
}

function serialise(template, content) {
  const out = {};
  for (const s of sectionList(template)) out[s.key] = toText(s.kind, content[s.key]);
  return out;
}

// ---------- parse editable text back to structured content ----------

const cleanLines = (t) => String(t || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const stripBullet = (l) => l.replace(/^([-*•]|\d+[.)])\s*/, '').trim();
const isItem = (l) => /^[-*•]\s*/.test(l);

function splitLead(s, maxLead = 60) {
  const i = s.indexOf(':');
  if (i > 0 && i <= maxLead) return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
  return [null, s];
}

function parseGroups(text, mapItem) {
  const groups = [];
  for (const l of cleanLines(text)) {
    if (isItem(l)) {
      if (!groups.length) groups.push({ head: 'General', items: [] });
      groups[groups.length - 1].items.push(mapItem(stripBullet(l)));
    } else {
      groups.push({ head: l.replace(/:$/, ''), items: [] });
    }
  }
  return groups;
}

function fromText(kind, key, text) {
  switch (kind) {
    case 'text': return String(text || '').trim();
    case 'lines': return cleanLines(text).map(stripBullet).filter(Boolean);
    case 'pairs': return cleanLines(text).map((l) => {
      const [term, def] = splitLead(stripBullet(l), 80);
      return term ? { term, definition: def } : { term: l, definition: '' };
    }).sort((a, b) => a.term.localeCompare(b.term));
    case 'groups': {
      const g = parseGroups(text, (x) => x);
      return key === 'guidance'
        ? g.map((x) => ({ topic: x.head, recommendations: x.items }))
        : g.map((x) => ({ role: x.head, responsibilities: x.items }));
    }
    case 'steps': return parseGroups(text, (x) => {
      const [actor, action] = splitLead(x, 50);
      return actor && !/[.]/.test(actor) ? { actor, action } : { actor: '', action: x };
    }).map((x) => ({ stage: x.head, steps: x.items }));
    case 'rows': return cleanLines(text).map((l) => {
      const [record, keptBy, retention] = stripBullet(l).split('|').map((c) => (c || '').trim());
      return { record, keptBy: keptBy || '', retention: retention || '' };
    });
    case 'form': return parseGroups(text, (x) => {
      const [lead, guidance] = splitLead(x, 80);
      const field = (lead || x).trim();
      const optional = /\(optional\)/i.test(field);
      return { field: field.replace(/\s*\(optional\)\s*/i, '').trim(), guidance: lead ? guidance : '', mandatory: !optional };
    }).map((x) => ({ section: x.head, fields: x.items })).filter((s) => s.fields.length);
    default: return null;
  }
}

function parse(template, sections, previous = {}) {
  const content = { ...previous };
  for (const s of sectionList(template)) {
    if (sections[s.key] !== undefined) content[s.key] = fromText(s.kind, s.key, String(sections[s.key]).slice(0, 30000));
  }
  return content;
}

// Text still waiting for the author: highlighted placeholders and unresolved drafting notes.
function outstanding(content) {
  const placeholders = (JSON.stringify(content).match(/\[Author to confirm/g) || []).length;
  const notes = (content.authorFlags || []).length;
  return { placeholders, notes };
}

module.exports = { sectionList, serialise, parse, outstanding };
