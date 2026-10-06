// Document workflow: who may do what at each stage, and how a database record becomes a printable document.
//
//   draft ──submit──▶ review ──(each signatory approves in order)──▶ hr ──HR assigns number──┬─▶ issued   (electronic approval)
//     ▲                 │                                              │                     └─▶ signing ──signed scan uploaded──▶ issued (wet ink)
//     └────return───────┴──────────────────────return────────────────┘
//   issued ──revise──▶ new draft (version + 1); when the new version is issued the old one becomes obsolete.

const { DEPARTMENTS, resolveType } = require('./config');
const { fmtDate, addYears } = require('./frontmatter');
const { q } = require('./db');

const STATUS_NAMES = {
  draft: 'Draft',
  review: 'Under review',
  hr: 'With HR for numbering',
  signing: 'Awaiting signatures',
  issued: 'Issued',
  obsolete: 'Obsolete',
  withdrawn: 'Withdrawn',
};

const deptName = (code) => (DEPARTMENTS.find((d) => d.code === code) || { name: code }).name;
const typeOf = (doc) => resolveType(doc.type_key, doc.variant);
const fmtStamp = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Indian/Maldives' }) : '');
const fmtInputDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? fmtDate(`${v}T00:00:00+05:00`) : (v || ''));

// Default approval stages for a document type, from the approval matrix (COR-SOP-001 clause 14).
function defaultStages(type, clinicalImpact) {
  const stages = type.reviewers.map((r) => `Reviewed by (${r})`);
  if (clinicalImpact === 'Yes' && ![...type.reviewers, type.finalApproval].some((r) => /CMO/.test(r))) stages.push('Reviewed by (CMO – clinical impact)');
  stages.push(`Final approval (${type.finalApproval})`);
  return stages;
}

const currentSignatory = (doc, sigs) => (doc.status === 'review' ? sigs.find((s) => s.status === 'pending') : null);

function permissions(doc, sigs, user) {
  const email = user.email;
  const isAuthor = doc.author_email === email;
  const isSignatory = sigs.some((s) => s.email === email);
  const current = currentSignatory(doc, sigs);
  const restricted = ['Confidential', 'Highly Confidential'].includes(doc.confidentiality);
  const publicStatus = ['issued', 'obsolete'].includes(doc.status);
  return {
    view: isAuthor || isSignatory || user.isHR || (publicStatus && !restricted),
    edit: isAuthor && doc.status === 'draft',
    submit: isAuthor && doc.status === 'draft',
    withdraw: isAuthor && ['draft', 'review'].includes(doc.status),
    approve: !!current && current.email === email,
    updateOwnDetails: doc.status === 'review' && sigs.some((s) => s.email === email && s.status === 'pending'),
    returnToAuthor: (!!current && current.email === email) || (user.isHR && doc.status === 'hr'),
    assignNumber: user.isHR && doc.status === 'hr',
    uploadSigned: user.isHR && doc.status === 'signing',
    revise: (isAuthor || user.isHR) && doc.status === 'issued',
    makeObsolete: user.isHR && doc.status === 'issued',
    isAuthor,
    isHR: user.isHR,
  };
}

// Revision history rows: one per version up to and including this one.
function revisionRows(doc) {
  const chain = q.versions.all(doc.base_id).filter((v) => v.version <= doc.version && v.status !== 'withdrawn');
  return chain.map((v) => {
    const sigs = q.sigs.all(v.id);
    const finalSig = sigs[sigs.length - 1];
    return {
      version: `V${v.version}`,
      date: v.issued_at ? fmtDate(v.issued_at) : '',
      clauses: v.version === 1 ? 'All' : (v.change_clauses || ''),
      summary: v.version === 1 ? (v.change_summary || `New document.${v.ai ? ' Drafted with AI assistance.' : ''}`) : (v.change_summary || '[Author to confirm: summary of changes]'),
      approvedBy: finalSig && finalSig.status === 'approved' ? finalSig.name || '' : '',
    };
  });
}

// Rows for the approval signatures table. Electronic approvals are stamped; wet-ink rows stay blank for signing.
function signatureRows(doc, sigs) {
  const electronic = doc.sign_method === 'electronic';
  const rows = [{
    stage: 'Prepared by',
    name: doc.author_name,
    designation: doc.author_designation || '',
    signature: electronic && doc.submitted_at ? 'Submitted electronically' : (!electronic && doc.issued_at ? 'Signed – original held by HR' : ''),
    date: electronic && doc.submitted_at ? fmtStamp(doc.submitted_at) : '',
  }];
  const handSigned = !electronic && !!doc.issued_at; // issued copy of a hand-signed document
  for (const s of sigs) {
    const done = electronic && s.status === 'approved';
    rows.push({
      stage: s.stage, name: s.name || '', designation: s.designation || '',
      signature: done ? 'Approved electronically' : handSigned ? 'Signed – original held by HR' : '',
      date: done ? fmtStamp(s.acted_at) : '',
    });
  }
  rows.push({
    stage: 'Issued by (HR – document custodian)',
    name: doc.issued_by_name || doc.numbered_by || '',
    designation: 'Human Resources',
    signature: doc.issued_at ? (electronic ? 'Issued electronically' : 'Issued – signed copy on file') : '',
    date: doc.issued_at ? fmtStamp(doc.issued_at) : '',
  });
  return rows;
}

// Everything the Word generator and the preview need, from a database record.
function buildMeta(doc, statusOverride) {
  const type = typeOf(doc);
  const sigs = q.sigs.all(doc.id);
  const prev = doc.supersedes_id ? q.getDoc.get(doc.supersedes_id) : null;
  return {
    type,
    meta: {
      status: statusOverride || doc.status,
      title: doc.title,
      deptCode: doc.dept_code,
      deptName: deptName(doc.dept_code),
      docId: doc.doc_id,
      version: doc.version,
      supersedes: prev ? prev.doc_id : 'Nil',
      effectiveDate: doc.effective_date ? fmtDate(`${doc.effective_date}T00:00:00+05:00`) : null,
      reviewDate: doc.review_date ? fmtDate(`${doc.review_date}T00:00:00+05:00`) : null,
      parentPolicy: doc.parent_policy,
      preparedBy: `${doc.author_name}${doc.author_designation ? ` (${doc.author_designation})` : ''}`,
      appliesTo: doc.applies_to,
      owner: doc.owner,
      confidentiality: doc.confidentiality,
      clinicalImpact: doc.clinical_impact,
      effectiveFrom: fmtInputDate(doc.effective_from),
      expiry: fmtInputDate(doc.expiry),
      flags: (JSON.parse(doc.content_json).authorFlags || []),
      signatures: signatureRows(doc, sigs),
      revisions: revisionRows(doc),
    },
  };
}

// Review date at issue: effective date plus the review cycle; directives use their expiry date.
function reviewDateFor(type, effectiveIso, doc) {
  if (type.template === 'directive') return /^\d{4}-\d{2}-\d{2}$/.test(doc.expiry || '') ? doc.expiry : null;
  if (!type.reviewYears) return null;
  return addYears(`${effectiveIso}T00:00:00Z`, type.reviewYears).toISOString().slice(0, 10);
}

module.exports = { STATUS_NAMES, deptName, typeOf, defaultStages, currentSignatory, permissions, buildMeta, reviewDateFor, fmtStamp };
