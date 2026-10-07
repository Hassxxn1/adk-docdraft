// Builds the Word document in the ADK master template.
// Format follows COR-SOP-001 clause 28 (Format): Host Grotesk 10 pt, headings 10 pt bold,
// single line spacing, 0 pt before and 8 pt after paragraphs, tiered numbering.
// The first page carries every field required by COR-SOP-001 clause 10 (Document Cover Page Requirements).
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, Header, Footer,
  WidthType, ShadingType, BorderStyle, PageNumber, PageBreak, TabStopType,
  TableLayoutType, VerticalAlign, CharacterSet, LevelFormat, AlignmentType,
} = require('docx');
const { frontMatter } = require('./frontmatter');
const { contentToBlocks } = require('./blocks');

const ASSETS = path.join(__dirname, '..', 'assets');
const LETTERHEAD = fs.readFileSync(path.join(ASSETS, 'letterhead.png'));
const LETTERHEAD_W = LETTERHEAD.readUInt32BE(16); // PNG IHDR width
const LETTERHEAD_H = LETTERHEAD.readUInt32BE(20); // PNG IHDR height
const FONT_FILES = { regular: path.join(ASSETS, 'HostGrotesk-Regular.ttf'), bold: path.join(ASSETS, 'HostGrotesk-Bold.ttf') };

const BLUE = '245BCE';
const NAVY = '102256';
const GREY = '6B7785';
const GREEN = '1D7A46';
const RULE = 'C9D3DF';
const ZEBRA = 'F3F6F9';
const FONT = 'Host Grotesk';
const SIZE = 20; // 10 pt
const SMALL = 16; // 8 pt: footer and signature stamps only
const AFTER = 160; // 8 pt after paragraph
const LINE = 240; // single
const SPACING = (after = AFTER, before = 0) => ({ before, after, line: LINE, lineRule: 'auto' });

// A4, 2 cm margins.
const PAGE_W = 11906;
const MARGIN = 1134;
const CONTENT_W = PAGE_W - MARGIN * 2; // 9638

const border = { style: BorderStyle.SINGLE, size: 4, color: RULE };
const borders = { top: border, bottom: border, left: border, right: border };
const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

const t = (text, o = {}) => new TextRun({ text: String(text ?? ''), font: FONT, size: o.size || SIZE, bold: o.bold, italics: o.italics, color: o.color });
const placeholder = (s) => t(s, { italics: true, color: GREY });

function p(children, o = {}) {
  return new Paragraph({
    children: Array.isArray(children) ? children : [typeof children === 'string' ? t(children) : children],
    spacing: SPACING(o.after ?? AFTER, o.before ?? 0),
    indent: o.indent,
    alignment: o.align,
    keepNext: o.keepNext,
  });
}

// Renders "[Author to confirm: ...]" placeholders highlighted so they are easy to find.
function rich(text, o = {}) {
  const parts = String(text ?? '').split(/(\[Author to confirm[^\]]*\])/g).filter(Boolean);
  return parts.map((s) => (s.startsWith('[Author to confirm')
    ? new TextRun({ text: s, font: FONT, size: o.size || SIZE, bold: true, color: 'B4561A', highlight: 'yellow' })
    : t(s, o)));
}

const segRuns = (segs, o = {}) => segs.flatMap((s) => (s.muted ? [placeholder(s.text)] : rich(s.text, o)));

function cell(content, width, o = {}) {
  const paras = (Array.isArray(content) ? content : [content]).map((c) => (c instanceof Paragraph ? c : p(typeof c === 'string' ? rich(c, o) : c, { after: 0 })));
  return new TableCell({
    children: paras,
    width: { size: width, type: WidthType.DXA },
    borders: o.borders || borders,
    shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
    margins: { top: o.pad ?? 70, bottom: o.pad ?? 70, left: 110, right: 110 },
    verticalAlign: o.vAlign || VerticalAlign.CENTER,
    columnSpan: o.span,
  });
}

function table(widths, rows, header, o = {}) {
  const out = [];
  if (header) {
    out.push(new TableRow({
      tableHeader: true,
      cantSplit: true,
      children: header.map((h, i) => cell(p(t(h, { bold: true, color: 'FFFFFF' }), { after: 0 }), widths[i], { fill: NAVY })),
    }));
  }
  rows.forEach((r, ri) => {
    const fill = o.fills ? o.fills[ri] : (o.zebra === false ? undefined : (ri % 2 ? ZEBRA : undefined));
    out.push(new TableRow({
      cantSplit: true,
      children: r.map((c, i) => {
        const content = o.boldFirst && i === 0 && typeof c === 'string' ? p(t(c, { bold: true }), { after: 0 }) : c;
        return cell(content, widths[i], { fill });
      }),
    }));
  });
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    indent: o.indent ? { size: o.indent, type: WidthType.DXA } : undefined,
    rows: out,
  });
}

const subhead = (text) => p(t(text.toUpperCase(), { bold: true, color: BLUE }), { before: 200, after: 100, keepNext: true });

function heading(num, text) {
  return new Paragraph({
    children: [t(`${num}.`, { bold: true, color: NAVY }), t(`\t${text}`, { bold: true, color: NAVY })],
    tabStops: [{ type: TabStopType.LEFT, position: 720 }],
    indent: { left: 720, hanging: 720 },
    spacing: SPACING(AFTER, 120),
    keepNext: true,
  });
}

// Tiered clause indentation: number column and text column by depth (1.1 → depth 2).
function clauseGeometry(num) {
  const depth = String(num).split('.').length;
  if (depth <= 2) return { start: 720, hang: 720 };
  if (depth === 3) return { start: 1440, hang: 900 };
  return { start: 2340, hang: 1080 };
}
const textIndent = (num) => { const g = clauseGeometry(num); return g.start + g.hang; };

function clause(num, text, o = {}) {
  const g = clauseGeometry(num);
  const left = g.start + g.hang;
  const body = Array.isArray(text) ? text : rich(text);
  const label = o.label ? [t(o.label, { bold: true }), t(body.length ? ' ' : '')] : [];
  return new Paragraph({
    children: [t(`${num}.`), t('\t'), ...label, ...body],
    tabStops: [{ type: TabStopType.LEFT, position: left }],
    indent: { left, hanging: g.hang },
    spacing: SPACING(),
    keepNext: o.keepNext,
  });
}

// ---------- Front matter ----------

function band(fm) {
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [CONTENT_W],
    layout: TableLayoutType.FIXED,
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: CONTENT_W, type: WidthType.DXA },
        borders: noBorders,
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: fm.colour },
        margins: { top: 200, bottom: 200, left: 280, right: 280 },
        children: [
          p(t(`LEVEL ${fm.level}  ·  ${fm.typeLabel.toUpperCase()}`, { bold: true, color: NAVY }), { after: 80 }),
          p(t(fm.title, { bold: true, size: 32, color: NAVY }), { after: 80 }),
          p([t(`${fm.deptName}  ·  `, { color: NAVY }), t(fm.statusLabel, { bold: true, color: NAVY })], { after: 0 }),
        ],
      })],
    })],
  });
}

function controlTable(fm) {
  const w = [2800, CONTENT_W - 2800];
  return table(w, fm.control.map(([k, segs]) => [p(t(k, { bold: true }), { after: 0 }), p(segRuns(segs), { after: 0 })]));
}

function signatureTable(fm) {
  const w = [2800, 2050, 1950, 1738, 1100];
  const rows = fm.signatures.map((r) => [
    p(t(r.stage, { bold: true }), { after: 0 }),
    r.name || '',
    r.designation || '',
    r.signature ? p(t(r.signature, { size: SMALL, color: GREEN, bold: true }), { after: 0 }) : '',
    r.date ? p(t(r.date, { size: SMALL }), { after: 0 }) : '',
  ]);
  return table(w, rows, ['Stage', 'Name', 'Designation', 'Signature', 'Date'], { zebra: false });
}

function revisionTable(fm) {
  const w = [1050, 1400, 1250, 4238, 1700];
  return table(w, fm.revisions.map((r) => [`${r.version}`, r.date || '', r.clauses || '', r.summary || '', r.approvedBy || '']), ['Version', 'Date', 'Clause(s)', 'Summary of change', 'Approved by']);
}

function flagsBox(flags) {
  if (!flags.length) return [];
  const edge = { style: BorderStyle.SINGLE, size: 12, color: 'E8A15C' };
  const children = [
    p(t('DRAFTING NOTES – RESOLVE AND DELETE BEFORE SUBMITTING FOR REVIEW', { bold: true, color: '8A3B0E' }), { after: 100 }),
    ...flags.map((f, i) => new Paragraph({
      children: [t(`${i + 1}.`, { bold: true, color: '8A3B0E' }), t('\t'), ...rich(f)],
      tabStops: [{ type: TabStopType.LEFT, position: 400 }],
      indent: { left: 400, hanging: 400 },
      spacing: SPACING(80),
    })),
  ];
  return [
    p('', { after: 120 }),
    new Table({
      width: { size: CONTENT_W, type: WidthType.DXA },
      columnWidths: [CONTENT_W],
      layout: TableLayoutType.FIXED,
      rows: [new TableRow({ children: [new TableCell({
        width: { size: CONTENT_W, type: WidthType.DXA },
        borders: { top: edge, bottom: edge, left: edge, right: edge },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FFF4E8' },
        margins: { top: 180, bottom: 140, left: 220, right: 220 },
        children,
      })] })],
    }),
  ];
}

// ---------- Body ----------

function formLayout(f) {
  const out = [
    new Paragraph({ children: [new PageBreak()] }),
    p(t(f.title.toUpperCase(), { bold: true, size: 28, color: NAVY }), { after: 60 }),
    p(t(f.idText, { color: GREY }), { after: 120 }),
    p(t('Fields marked * are mandatory.', { color: GREY }), { after: 120 }),
  ];
  const w = [3400, CONTENT_W - 3400];
  f.sections.forEach((sec) => {
    out.push(new Table({
      width: { size: CONTENT_W, type: WidthType.DXA },
      columnWidths: w,
      layout: TableLayoutType.FIXED,
      rows: [
        new TableRow({ cantSplit: true, children: [cell(p(t(sec.section.toUpperCase(), { bold: true, color: NAVY }), { after: 0 }), CONTENT_W, { fill: f.colour, span: 2 })] }),
        ...(sec.fields || []).map((fl) => new TableRow({
          cantSplit: true,
          height: { value: 520, rule: 'atLeast' },
          children: [cell(p(t(`${fl.field}${fl.mandatory ? ' *' : ''}`, { bold: true }), { after: 0 }), w[0], { fill: ZEBRA }), cell('', w[1])],
        })),
      ],
    }));
    out.push(p('', { after: 120 }));
  });
  out.push(table([3200, 3200, CONTENT_W - 6400], [['', '', '']], ['Completed by (name and designation)', 'Signature', 'Date']));
  return out;
}

function renderBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.h !== undefined) out.push(heading(b.h, b.text));
    else if (b.n) out.push(clause(b.n, b.text || [], { label: b.label, keepNext: b.keepNext }));
    else if (b.table) {
      const indent = b.under ? textIndent(b.under) : 0;
      const avail = CONTENT_W - indent;
      const total = b.table.widths.reduce((a, c) => a + c, 0);
      const widths = b.table.widths.map((w) => Math.floor((w / total) * avail));
      widths[widths.length - 1] += avail - widths.reduce((a, c) => a + c, 0);
      out.push(table(widths, b.table.rows, b.table.header, { indent, fills: b.table.fills, zebra: b.table.zebra, boldFirst: b.table.boldFirst }));
      out.push(p('', { after: 80 }));
    } else if (b.bullets) {
      const indent = b.under ? textIndent(b.under) : (b.indent ?? 720);
      b.bullets.forEach((x) => out.push(new Paragraph({
        children: rich(x),
        numbering: { reference: 'adk-bullets', level: 0 },
        indent: { left: indent + 360, hanging: 300 },
        spacing: SPACING(80),
      })));
      out.push(p('', { after: 40 }));
    } else if (b.p !== undefined) {
      const indent = b.under ? { left: textIndent(b.under) } : (b.indent ? { left: b.indent } : undefined);
      out.push(p(b.muted ? [placeholder(b.p)] : rich(b.p, { bold: b.bold }), { indent, after: b.after }));
    } else if (b.appendix) {
      out.push(new Paragraph({ children: [new PageBreak()] }));
      out.push(p(t(b.appendix, { bold: true, color: NAVY })));
    } else if (b.form) {
      out.push(...formLayout(b.form));
    }
  }
  return out;
}

// ---------- Assemble ----------

async function buildDocx(type, meta, content) {
  const fm = frontMatter(type, { ...meta, signatures: meta.signatures || meta.endorsements });
  const blocks = contentToBlocks(type, content, meta);

  // Letterhead spans the text area exactly: logo at the left margin, thick bar at the right margin.
  const imgW = CONTENT_W / 15; // twips → px at 96 dpi
  const imgH = (imgW * LETTERHEAD_H) / LETTERHEAD_W;
  const header = new Header({
    children: [
      new Paragraph({ children: [new ImageRun({ type: 'png', data: LETTERHEAD, transformation: { width: imgW, height: imgH } })], spacing: SPACING(0) }),
      new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: type.colour, space: 1 } }, spacing: SPACING(120) }),
    ],
  });

  const footer = new Footer({
    children: [new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 6 } },
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
      children: [
        t(fm.footer, { size: SMALL, color: GREY }),
        t('\tPage ', { size: SMALL, color: GREY }),
        new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: SMALL, color: GREY }),
        t(' of ', { size: SMALL, color: GREY }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: SMALL, color: GREY }),
      ],
    })],
  });

  const front = [
    band(fm),
    subhead('Document control'),
    controlTable(fm),
    subhead('Approval signatures'),
    p(t('A minimum of two approval signatures is required. The owning department collects all approvals before submitting to HR.', { color: GREY }), { after: 100 }),
    signatureTable(fm),
    subhead('Revision history'),
    revisionTable(fm),
    ...flagsBox(fm.flags),
    p('', { after: 120 }),
  ];

  // Embed Host Grotesk (regular and bold) so documents render correctly on computers without the font.
  const fonts = [];
  const embed = fs.existsSync(FONT_FILES.regular) && fs.existsSync(FONT_FILES.bold);
  if (embed) {
    fonts.push({ name: FONT, data: fs.readFileSync(FONT_FILES.regular), characterSet: CharacterSet.ANSI });
    fonts.push({ name: FONT, data: fs.readFileSync(FONT_FILES.bold), characterSet: CharacterSet.ANSI });
  }

  const doc = new Document({
    creator: meta.preparedBy || 'ADK Hospital',
    title: meta.title,
    description: `${fm.typeLabel} – ADK Hospital Document Portal`,
    fonts,
    styles: { default: { document: { run: { font: FONT, size: SIZE }, paragraph: { spacing: SPACING() } } } },
    numbering: { config: [{ reference: 'adk-bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT }] }] },
    sections: [{
      properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: 2100, bottom: 1300, left: MARGIN, right: MARGIN, header: 500, footer: 500 } } },
      headers: { default: header },
      footers: { default: footer },
      children: [...front, ...renderBlocks(blocks)],
    }],
  });
  const buf = await Packer.toBuffer(doc);
  return embed ? mergeEmbeddedBold(buf) : buf;
}

// docx writes each embedded font file as its own <w:font> entry. Word expects one entry per family
// with embedRegular and embedBold, so the second (bold) entry is folded into the first.
async function mergeEmbeddedBold(buf) {
  const zip = await JSZip.loadAsync(buf);
  const ftPath = 'word/fontTable.xml';
  let xml = await zip.file(ftPath).async('string');
  const entries = [...xml.matchAll(new RegExp(`<w:font w:name="${FONT}">([\\s\\S]*?)</w:font>`, 'g'))];
  if (entries.length >= 2) {
    const boldRel = entries[1][1].match(/<w:embedRegular([^>]*)\/>/);
    if (boldRel) {
      const first = entries[0][0].replace('</w:font>', `<w:embedBold${boldRel[1]}/></w:font>`);
      xml = xml.replace(entries[1][0], '').replace(entries[0][0], first);
      zip.file(ftPath, xml);
    }
  }
  const setPath = 'word/settings.xml';
  let settings = await zip.file(setPath).async('string');
  if (!settings.includes('embedTrueTypeFonts')) {
    // Schema order: embedTrueTypeFonts follows displayBackgroundShape when that element is present.
    settings = settings.includes('<w:displayBackgroundShape/>')
      ? settings.replace('<w:displayBackgroundShape/>', '<w:displayBackgroundShape/><w:embedTrueTypeFonts/>')
      : settings.replace(/(<w:settings[^>]*>)/, '$1<w:embedTrueTypeFonts/>');
    zip.file(setPath, settings);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { buildDocx, CONTENT_W };
