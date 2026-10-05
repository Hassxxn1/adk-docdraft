// Builds the Word document in the ADK master template structure.
// Browser port of lib/docgen.js: the docx library and the letterhead image are passed in,
// and buildDocument() returns a docx Document that the caller packs (Packer.toBlob in the browser).
export function createDocgen(docx, LETTERHEAD) {
const {
  Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, Header, Footer, Document,
  WidthType, ShadingType, BorderStyle, PageNumber, PageBreak, TabStopType,
  TableLayoutType, VerticalAlign,
} = docx;

const BLUE = '245BCE';
const NAVY = '102256';
const GREY = '6B7785';
const RULE = 'C9D3DF';
const FONT = 'Arial';

// A4, 2 cm margins.
const PAGE_W = 11906;
const MARGIN = 1134;
const CONTENT_W = PAGE_W - MARGIN * 2; // 9638

const border = { style: BorderStyle.SINGLE, size: 4, color: RULE };
const borders = { top: border, bottom: border, left: border, right: border };
const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

const t = (text, o = {}) => new TextRun({ text: String(text ?? ''), font: FONT, size: o.size || 20, bold: o.bold, italics: o.italics, color: o.color });

function p(children, o = {}) {
  return new Paragraph({
    children: Array.isArray(children) ? children : [typeof children === 'string' ? t(children) : children],
    spacing: { before: o.before ?? 0, after: o.after ?? 100, line: 276 },
    indent: o.indent,
    alignment: o.align,
    keepNext: o.keepNext,
    tabStops: o.tabStops,
  });
}

// Renders "[Author to confirm: ...]" placeholders highlighted so they are easy to find.
function rich(text, o = {}) {
  const parts = String(text ?? '').split(/(\[Author to confirm[^\]]*\])/g).filter(Boolean);
  return parts.map((s) =>
    s.startsWith('[Author to confirm')
      ? new TextRun({ text: s, font: FONT, size: o.size || 20, bold: true, color: 'B4561A', highlight: 'yellow' })
      : t(s, o),
  );
}

function cell(content, width, o = {}) {
  const paras = (Array.isArray(content) ? content : [content]).map((c) =>
    c instanceof Paragraph ? c : p(typeof c === 'string' ? rich(c, o) : c, { after: 0 }),
  );
  return new TableCell({
    children: paras,
    width: { size: width, type: WidthType.DXA },
    borders: o.borders || borders,
    shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
    margins: { top: o.pad ?? 80, bottom: o.pad ?? 80, left: 120, right: 120 },
    verticalAlign: o.vAlign || VerticalAlign.CENTER,
    columnSpan: o.span,
  });
}

function table(widths, rows, headerRow) {
  const out = [];
  if (headerRow) {
    out.push(new TableRow({
      tableHeader: true,
      children: headerRow.map((h, i) => cell(p(t(h, { bold: true, color: 'FFFFFF', size: 18 }), { after: 0 }), widths[i], { fill: NAVY })),
    }));
  }
  rows.forEach((r, ri) => {
    out.push(new TableRow({
      cantSplit: true,
      children: r.map((c, i) => cell(c, widths[i], { fill: ri % 2 ? 'F3F6F9' : undefined, size: 19 })),
    }));
  });
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    rows: out,
  });
}

const subhead = (text) =>
  p(t(text.toUpperCase(), { bold: true, size: 18, color: BLUE }), { before: 280, after: 100, keepNext: true });

function heading(num, text) {
  return new Paragraph({
    children: [t(`${num}`, { bold: true, size: 24, color: NAVY }), t(`\t${text}`, { bold: true, size: 24, color: NAVY })],
    tabStops: [{ type: TabStopType.LEFT, position: 720 }],
    spacing: { before: 320, after: 120 },
    keepNext: true,
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 4 } },
  });
}

// Numbered clause with hanging indent: "4.1  text"
function clause(num, text, o = {}) {
  const indent = o.indent ?? 720;
  const hang = num.split('.').length > 2 ? 900 : 720;
  return new Paragraph({
    children: [t(num, { bold: !!o.boldNum, color: o.numColor }), t('\t'), ...(Array.isArray(text) ? text : rich(text))],
    tabStops: [{ type: TabStopType.LEFT, position: indent + hang }],
    indent: { left: indent + hang, hanging: hang },
    spacing: { after: 100, line: 276 },
    keepNext: o.keepNext,
  });
}

const placeholder = (s) => t(s, { italics: true, color: GREY });

function addDate(years, from) {
  const d = new Date(from || Date.now());
  d.setFullYear(d.getFullYear() + years);
  return d;
}

const fmtDate = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

// ---------- Front matter ----------

function band(type, meta) {
  const textColour = NAVY;
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [CONTENT_W],
    layout: TableLayoutType.FIXED,
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: CONTENT_W, type: WidthType.DXA },
        borders: noBorders,
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: type.colour },
        margins: { top: 260, bottom: 260, left: 300, right: 300 },
        children: [
          p(t(`LEVEL ${type.level}  ·  ${type.label.toUpperCase()}`, { bold: true, size: 18, color: textColour }), { after: 120 }),
          p(t(meta.title, { bold: true, size: 36, color: textColour }), { after: 120 }),
          p([
            t(`${meta.deptName}  ·  `, { size: 20, color: textColour }),
            t('DRAFT FOR DEPARTMENTAL REVIEW', { bold: true, size: 20, color: textColour }),
          ], { after: 0 }),
        ],
      })],
    })],
  });
}

function controlTable(type, meta) {
  const drafted = meta.draftedAt ? new Date(meta.draftedAt) : new Date();
  const HR = '[Assigned by HR on issue]';
  const rows = [
    ['Document title', meta.title],
    ['Document ID', [t(`${meta.deptCode}-${type.prefix}-`), placeholder('NNN'), t('-V1  '), placeholder(HR)]],
    ['Classification', `Level ${type.level} – ${type.label}`],
  ];
  if (type.template === 'sop') rows.push(['Parent policy', meta.parentPolicy || '[Author to confirm: parent policy ID]']);
  rows.push(
    ['Owning department', `${meta.deptName} (${meta.deptCode})`],
    ['Document owner', meta.owner || '[Author to confirm: owner name and designation]'],
    ['Applies to', meta.appliesTo || '[Author to confirm: who this applies to]'],
    ['Version', [t('V1  '), placeholder('[Confirmed by HR on issue]')]],
    ['Supersedes', meta.supersedes || 'None'],
    ['Effective date', [placeholder(HR)]],
    ['Next review date', [t(`${type.reviewText} from effective date  `), placeholder(`(indicative: ${fmtDate(addDate(type.reviewYears, drafted))})`)]],
    ['Clinical impact', meta.clinicalImpact === 'Yes' ? 'Yes – CMO review required' : 'No'],
    ['Drafted', `${fmtDate(drafted)} by ${meta.draftedBy}${meta.ai ? ', with AI assistance' : ''}`],
  );
  const w = [2900, CONTENT_W - 2900];
  return table(w, rows.map(([k, v]) => [p(t(k, { bold: true, size: 19 }), { after: 0 }), Array.isArray(v) ? p(v, { after: 0 }) : v]));
}

function endorsementTable(type, meta) {
  const stages = [['Drafted by', meta.draftedBy, '']];
  type.reviewers.forEach((r) => stages.push([`Reviewed by (${r})`, '', '']));
  if (meta.clinicalImpact === 'Yes' && !type.reviewers.some((r) => /CMO/.test(r))) stages.push(['Reviewed by (CMO – clinical impact)', '', '']);
  stages.push([`Approved by (${type.finalApproval})`, '', '']);
  stages.push(['Issued by (HR – custodian)', '', '']);
  const w = [3000, 2000, 1900, 1638, 1100];
  return table(w, stages.map(([s, n]) => [p(t(s, { bold: true, size: 18 }), { after: 0 }), n, '', '', '']), ['Stage', 'Name', 'Designation', 'Signature', 'Date']);
}

function revisionTable(meta) {
  const w = [1000, 1500, 1500, 3938, 1700];
  return table(w, [['V1', '', 'All', `New document${meta.ai ? '. Drafted with AI assistance.' : '.'}`, '']], ['Version', 'Date', 'Clause(s)', 'Summary of change', 'Approved by']);
}

function flagsBox(flags) {
  if (!flags.length) return [];
  const children = [
    p(t('DRAFTING NOTES – RESOLVE AND DELETE THIS BOX BEFORE ENDORSEMENT', { bold: true, size: 18, color: '8A3B0E' }), { after: 120 }),
    p(t('Highlighted [Author to confirm] items in the text must also be completed. Verify every reference, number and clinical value against its source.', { size: 18, color: '5A3A20' }), { after: 120 }),
    ...flags.map((f, i) => new Paragraph({
      children: [t(`${i + 1}.`, { size: 19, bold: true, color: '8A3B0E' }), t('\t'), ...rich(f, { size: 19 })],
      tabStops: [{ type: TabStopType.LEFT, position: 400 }],
      indent: { left: 400, hanging: 400 },
      spacing: { after: 80 },
    })),
  ];
  return [
    p('', { after: 200 }),
    new Table({
      width: { size: CONTENT_W, type: WidthType.DXA },
      columnWidths: [CONTENT_W],
      layout: TableLayoutType.FIXED,
      rows: [new TableRow({ children: [new TableCell({
        width: { size: CONTENT_W, type: WidthType.DXA },
        borders: { top: { style: BorderStyle.SINGLE, size: 12, color: 'E8A15C' }, bottom: { style: BorderStyle.SINGLE, size: 12, color: 'E8A15C' }, left: { style: BorderStyle.SINGLE, size: 12, color: 'E8A15C' }, right: { style: BorderStyle.SINGLE, size: 12, color: 'E8A15C' } },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FFF4E8' },
        margins: { top: 200, bottom: 160, left: 240, right: 240 },
        children,
      })] })],
    }),
  ];
}

// ---------- Body ----------

function listSection(num, title, items, emptyText) {
  const out = [heading(num, title)];
  if (!items.length) out.push(p([placeholder(emptyText)], { indent: { left: 720 } }));
  else items.forEach((it, i) => out.push(clause(`${num}.${i + 1}`, it)));
  return out;
}

function proseSection(num, title, text) {
  return [heading(num, title), clause(`${num}.1`, text || '[Author to confirm]')];
}

function definitionsSection(num, defs) {
  const out = [heading(num, 'Definitions')];
  if (!defs.length) out.push(p([placeholder('No specific definitions. Terms carry their ordinary meaning.')], { indent: { left: 720 } }));
  else {
    out.push(table([2600, CONTENT_W - 2600], defs.map((d) => [p(t(d.term, { bold: true, size: 19 }), { after: 0 }), d.definition]), ['Term', 'Definition']));
  }
  return out;
}

function rolesSection(num, roles) {
  const out = [heading(num, 'Roles and responsibilities')];
  if (!roles.length) out.push(p([placeholder('[Author to confirm: roles]')], { indent: { left: 720 } }));
  roles.forEach((r, i) => {
    out.push(clause(`${num}.${i + 1}`, [t(r.role, { bold: true })], { keepNext: true }));
    (r.responsibilities || []).forEach((x, j) => out.push(clause(`${num}.${i + 1}.${j + 1}`, x, { indent: 720 })));
  });
  return out;
}

function procedureSection(num, stages) {
  const out = [heading(num, 'Procedure')];
  if (!stages.length) out.push(p([placeholder('[Author to confirm: procedure steps]')], { indent: { left: 720 } }));
  stages.forEach((s, i) => {
    out.push(clause(`${num}.${i + 1}`, [t(s.stage, { bold: true, color: NAVY })], { keepNext: true }));
    (s.steps || []).forEach((st, j) => {
      const text = st.actor ? [t(`${st.actor}: `, { bold: true }), ...rich(st.action)] : rich(st.action);
      out.push(clause(`${num}.${i + 1}.${j + 1}`, text, { indent: 720 }));
    });
  });
  return out;
}

function recordsSection(num, records) {
  const out = [heading(num, 'Records')];
  if (!records.length) out.push(p([placeholder('No controlled records are generated by this procedure.')], { indent: { left: 720 } }));
  else out.push(table([4200, 2800, CONTENT_W - 7000], records.map((r) => [r.record, r.keptBy, r.retention]), ['Record', 'Kept by', 'Retention']));
  return out;
}

function body(type, c) {
  if (type.template === 'policy') {
    return [
      ...proseSection(1, 'Purpose', c.purpose),
      ...proseSection(2, 'Scope', c.scope),
      ...definitionsSection(3, c.definitions),
      ...listSection(4, 'Policy statements', c.policyStatements, '[Author to confirm: policy requirements]'),
      ...rolesSection(5, c.roles),
      ...listSection(6, 'Compliance and monitoring', c.monitoring, '[Author to confirm: how compliance is monitored]'),
      ...listSection(7, 'Implementation and training', c.training, type.rollout),
      ...listSection(8, 'Related documents', c.related, 'None.'),
      ...listSection(9, 'References', c.references, '[Author to confirm: regulations or standards relied on, or None]'),
      ...listSection(10, 'Annexes', [], 'None.'),
    ];
  }
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
    ...listSection(10, 'Related documents', c.related, 'None.'),
    ...listSection(11, 'References', c.references, '[Author to confirm: regulations or standards relied on, or None]'),
    ...listSection(12, 'Annexes', [], 'None.'),
  ];
}

// ---------- Assemble ----------

function buildDocument(type, meta, content) {
  const imgW = 642; // px at 96 dpi ≈ content width
  const header = new Header({
    children: [
      new Paragraph({
        children: [new ImageRun({ type: 'png', data: LETTERHEAD, transformation: { width: imgW, height: Math.round((imgW * 118) / 980) } })],
        spacing: { after: 0 },
      }),
      new Paragraph({
        children: [],
        border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: type.colour, space: 1 } },
        spacing: { after: 120 },
      }),
    ],
  });

  const docId = `${meta.deptCode}-${type.prefix}-NNN-V1`;
  const footer = new Footer({
    children: [new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 6 } },
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
      children: [
        t(`${docId}  ·  DRAFT – not valid until approved and issued by HR`, { size: 16, color: GREY }),
        t('\tPage ', { size: 16, color: GREY }),
        new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: GREY }),
        t(' of ', { size: 16, color: GREY }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: GREY }),
      ],
    })],
  });

  const front = [
    band(type, meta),
    subhead('Document control'),
    controlTable(type, meta),
    subhead('Endorsement'),
    p(t('At least two signatures are required. The owning department collects all endorsements before submitting to HR.', { size: 18, color: GREY }), { after: 120 }),
    endorsementTable(type, meta),
    subhead('Revision history'),
    revisionTable(meta),
    ...flagsBox(content.authorFlags),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  const doc = new Document({
    creator: meta.draftedBy,
    title: meta.title,
    description: `${type.label} – draft generated by the ADK Document Drafting Portal`,
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [{
      properties: {
        page: {
          size: { width: PAGE_W, height: 16838 },
          margin: { top: 2200, bottom: 1300, left: MARGIN, right: MARGIN, header: 500, footer: 500 },
        },
      },
      headers: { default: header },
      footers: { default: footer },
      children: [...front, ...body(type, content)],
    }],
  });
  return doc;
}

return { buildDocument };
}
