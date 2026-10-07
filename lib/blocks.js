// Turns structured document content into a list of layout blocks.
// The same blocks are rendered to Word (docgen.js) and to the in-portal HTML preview (preview.js),
// so what reviewers see in the browser matches the Word file.
//
// Block vocabulary:
//   { h, text }                        section heading "1. Purpose"
//   { n, text, label?, keepNext? }      numbered clause; label is shown in bold before the text
//   { p, muted?, bold?, indent?, under? } plain paragraph (muted = grey italic placeholder)
//   { table: { widths, header?, rows, fills?, boldFirst?, zebra? }, under? }
//   { bullets: [...], under?, indent? }
//   { appendix }                       new page with an appendix title
//   { form: { title, idText, colour, sections } }  the printable form layout (Level 5)

const muted = (text) => ({ p: text, muted: true, indent: 1440 });

function listSection(num, title, items, emptyText) {
  const out = [{ h: num, text: title }];
  if (!items || !items.length) out.push(muted(emptyText));
  else items.forEach((it, i) => out.push({ n: `${num}.${i + 1}`, text: it }));
  return out;
}

const proseSection = (num, title, text) => [{ h: num, text: title }, { n: `${num}.1`, text: text || '[Author to confirm]' }];

function definitionsSection(num, defs) {
  const out = [{ h: num, text: 'Definitions' }];
  if (!defs || !defs.length) out.push(muted('No specific definitions. Terms carry their ordinary meaning.'));
  else out.push({ under: `${num}.1`, table: { widths: [1, 2.4], header: ['Term', 'Definition'], rows: defs.map((d) => [d.term, d.definition]), boldFirst: true } });
  return out;
}

function nestedSection(num, title, groups, groupKey, itemsKey, emptyText, itemFn) {
  const out = [{ h: num, text: title }];
  if (!groups || !groups.length) out.push(muted(emptyText));
  (groups || []).forEach((g, i) => {
    out.push({ n: `${num}.${i + 1}`, label: g[groupKey], text: '', keepNext: true });
    (g[itemsKey] || []).forEach((x, j) => out.push({ n: `${num}.${i + 1}.${j + 1}`, ...(itemFn ? itemFn(x) : { text: x }) }));
  });
  return out;
}

const rolesSection = (num, roles) => nestedSection(num, 'Roles and responsibilities', roles, 'role', 'responsibilities', '[Author to confirm: roles]');
const guidanceSection = (num, topics) => nestedSection(num, 'Recommended practice', topics, 'topic', 'recommendations', '[Author to confirm: recommended practice]');
const procedureSection = (num, stages) => nestedSection(num, 'Procedure', stages, 'stage', 'steps', '[Author to confirm: procedure steps]',
  (st) => (st.actor ? { label: `${st.actor}:`, text: st.action } : { text: st.action }));

function recordsSection(num, records, emptyText = 'No controlled records are generated.') {
  const out = [{ h: num, text: 'Records' }];
  if (!records || !records.length) out.push(muted(emptyText));
  else out.push({ under: `${num}.1`, table: { widths: [1.6, 1.1, 1], header: ['Record', 'Kept by', 'Retention'], rows: records.map((r) => [r.record, r.keptBy, r.retention]) } });
  return out;
}

function fieldGuideSection(num, sections) {
  const out = [{ h: num, text: 'Field guide' }];
  const rows = [];
  (sections || []).forEach((sec) => (sec.fields || []).forEach((f) => rows.push([sec.section, f.field, f.guidance, f.mandatory ? 'Yes' : 'No'])));
  if (!rows.length) out.push(muted('[Author to confirm: form fields]'));
  else out.push({ under: `${num}.1`, table: { widths: [1.1, 1.4, 2.2, 0.7], header: ['Section', 'Field', 'Completion guidance', 'Mandatory'], rows } });
  return out;
}

function contentToBlocks(type, c, meta) {
  if (c.blocks) return c.blocks; // an existing document laid in verbatim
  const refs = (n) => listSection(n, 'References', c.references, '[Author to confirm: regulations or standards relied on, or None]');
  const related = (n) => listSection(n, 'Related documents', c.related, 'None.');
  switch (type.template) {
    case 'policy':
      return [
        ...proseSection(1, 'Purpose', c.purpose),
        ...proseSection(2, 'Scope', c.scope),
        ...definitionsSection(3, c.definitions),
        ...listSection(4, 'Policy statements', c.policyStatements, '[Author to confirm: policy requirements]'),
        ...rolesSection(5, c.roles),
        ...listSection(6, 'Compliance and monitoring', c.monitoring, '[Author to confirm: how compliance is monitored]'),
        ...listSection(7, 'Implementation and training', c.training, type.rollout),
        ...related(8),
        ...refs(9),
      ];
    case 'guideline':
      return [
        ...proseSection(1, 'Purpose', c.purpose),
        ...proseSection(2, 'Scope', c.scope),
        ...definitionsSection(3, c.definitions),
        ...guidanceSection(4, c.guidance),
        ...rolesSection(5, c.roles),
        ...listSection(6, 'Implementation', c.training, type.rollout),
        ...related(7),
        ...refs(8),
      ];
    case 'form':
      return [
        ...proseSection(1, 'Purpose', c.purpose),
        ...proseSection(2, 'When to use', c.scope),
        ...definitionsSection(3, c.definitions),
        ...listSection(4, 'Completion instructions', c.completionInstructions, '[Author to confirm: how to complete and submit the form]'),
        ...fieldGuideSection(5, c.formSections),
        ...recordsSection(6, c.records),
        ...related(7),
        { form: { title: meta.title, idText: meta.docId || `${meta.deptCode}-${type.prefix}-NNN-V1`, colour: type.colour, sections: c.formSections || [] } },
      ];
    case 'directive':
      return [
        ...proseSection(1, 'Purpose', c.purpose),
        ...proseSection(2, 'Background', c.background),
        ...proseSection(3, 'Applies to', c.scope),
        ...listSection(4, 'Directive', c.directiveInstructions, '[Author to confirm: instructions]'),
        ...rolesSection(5, c.roles),
        { h: 6, text: 'Effective period' },
        { n: '6.1', text: `This directive takes effect ${meta.effectiveFrom ? `from ${meta.effectiveFrom}` : 'on issue by HR'}.` },
        { n: '6.2', text: `It expires or is reviewed on ${meta.expiry || '[Author to confirm: expiry or review date]'}.` },
        { n: '6.3', text: c.conversion || '[Author to confirm: whether this directive will be converted into a policy, SOP, protocol or guideline]' },
        ...listSection(7, 'Communication', c.training, type.rollout),
        ...related(8),
        ...refs(9),
      ];
    default: // SOP and clinical protocol
      return [
        ...proseSection(1, 'Purpose', c.purpose),
        ...proseSection(2, 'Scope', c.scope),
        ...definitionsSection(3, c.definitions),
        ...rolesSection(4, c.roles),
        ...listSection(5, 'Prerequisites', c.prerequisites, 'None.'),
        ...procedureSection(6, c.procedure),
        ...recordsSection(7, c.records),
        ...listSection(8, 'Monitoring', c.monitoring, '[Author to confirm: how compliance is monitored]'),
        ...listSection(9, 'Training', c.training, type.rollout),
        ...related(10),
        ...refs(11),
      ];
  }
}

module.exports = { contentToBlocks };
