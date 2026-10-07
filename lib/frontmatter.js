// Cover-page model shared by the Word generator and the HTML preview.
// Values are arrays of segments: { text, muted? } so placeholders render grey in both outputs.

const STATUS_LABEL = {
  draft: 'DRAFT FOR DEPARTMENTAL REVIEW',
  review: 'UNDER REVIEW',
  hr: 'APPROVED – AWAITING ISSUE BY HR',
  signing: 'FINAL',
  final: 'FINAL',
  approval: 'FOR APPROVAL SIGNATURE',
  issued: 'ISSUED – CONTROLLED COPY',
  obsolete: 'OBSOLETE',
  withdrawn: 'WITHDRAWN',
};

const typeLabel = (type) => (type.variantName ? `${type.label} – ${type.variantName.split(' – ')[0]}` : type.label);
const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Indian/Maldives' });
const addYears = (d, y) => { const x = new Date(d); x.setFullYear(x.getFullYear() + y); return x; };

const seg = (text, muted) => ({ text: String(text ?? ''), muted: !!muted });
const val = (v) => (Array.isArray(v) ? v : [seg(v)]);

function frontMatter(type, meta) {
  const numbered = !!meta.docId;
  const HR = '[Assigned by HR on issue]';
  const pendingId = `${meta.deptCode}-${type.prefix}-NNN-V${meta.version || 1}`;

  const reviewDate = () => {
    if (meta.reviewDate) return meta.reviewDate;
    if (!type.reviewYears) return type.reviewText;
    return [seg(`${type.reviewText} from effective date  `), seg(`(indicative: ${fmtDate(addYears(new Date(), type.reviewYears))})`, true)];
  };

  const rows = [
    ['Document title', meta.title],
    ['Document ID', numbered ? meta.docId : [seg(`${meta.deptCode}-${type.prefix}-`), seg('NNN', true), seg(`-V${meta.version || 1}  `), seg(HR, true)]],
    ['Document classification', `Level ${type.level} – ${typeLabel(type)}`],
    ['Version number', `V${meta.version || 1}`],
    ['Previous version reference', meta.supersedes || 'Nil'],
  ];
  if (type.template === 'directive') {
    rows.push(['Effective date', meta.effectiveFrom || 'On issue by HR'], ['Review or expiry date', meta.expiry || '[Author to confirm: expiry or review date]']);
  } else {
    rows.push(['Effective date', meta.effectiveDate || [seg(HR, true)]], ['Review date', reviewDate()]);
  }
  if (type.template === 'sop') rows.push(['Parent policy', meta.parentPolicy || '[Author to confirm: parent policy ID]']);
  rows.push(
    ['Prepared by', meta.preparedBy],
    ['Applicable to', meta.appliesTo || '[Author to confirm: who this applies to]'],
    ['Document owner', meta.owner ? `${meta.deptName} – ${meta.owner}` : meta.deptName],
    ['Document custodian', 'Human Resources'],
    ['Confidentiality level', meta.confidentiality || 'Internal Use'],
  );
  if (!numbered && meta.clinicalImpact === 'Yes') rows.push(['Clinical impact', 'Yes – CMO review required']);

  const idText = meta.docId || pendingId;
  let footer;
  if (meta.status === 'obsolete') footer = `${idText}  ·  OBSOLETE – do not use`;
  else if (meta.status === 'issued') footer = `${idText}  ·  ${meta.confidentiality || 'Internal Use'}  ·  Controlled copy – check the register for the current version`;
  else if (numbered) footer = `${idText}  ·  ${meta.confidentiality || 'Internal Use'}  ·  Valid only when approved and issued by HR`;
  else footer = `${idText}  ·  DRAFT – not valid until approved and issued by HR`;

  return {
    level: type.level,
    typeLabel: typeLabel(type),
    colour: type.colour,
    title: meta.title,
    deptName: meta.deptName,
    statusLabel: STATUS_LABEL[meta.status] || STATUS_LABEL.draft,
    control: rows.map(([k, v]) => [k, val(v)]),
    signatures: meta.signatures || [],
    revisions: meta.revisions || [{ version: 'V1', date: '', clauses: 'All', summary: 'New document.', approvedBy: '' }],
    flags: meta.status === 'draft' ? (meta.flags || []) : [],
    footer,
  };
}

module.exports = { frontMatter, typeLabel, fmtDate, addYears, STATUS_LABEL };
