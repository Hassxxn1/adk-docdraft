// Loads COR-POL-001-V1 and COR-SOP-001-V1 into the portal as "Awaiting signatures", exactly as printed.
// HR then uploads each signed scan in the portal to issue it.
// Usage: node scripts/import-governance.js <preparer e-mail> [MD e-mail] [CEO/Chairman e-mail]
require('dotenv').config();
const { DOCS } = require('./governance-docs');
const { db, tx, insertDoc, replaceSignatories, addEvent, now } = require('../lib/db');

const [authorEmail, mdEmail = '', ceoEmail = ''] = process.argv.slice(2).map((s) => s.toLowerCase());
if (!authorEmail) { console.error('Usage: node scripts/import-governance.js <preparer e-mail> [MD e-mail] [CEO/Chairman e-mail]'); process.exit(1); }

const importer = { email: null, name: 'Import (HR)' };
for (const d of DOCS) {
  if (db.prepare('SELECT id FROM documents WHERE doc_id = ?').get(d.meta.docId)) { console.log(`${d.meta.docId} is already in the portal – skipped.`); continue; }
  const [prep, md, ceo] = d.meta.endorsements;
  const id = tx(() => {
    const newId = insertDoc({
      type_key: d.type.key, variant: null, prefix: d.type.prefix, dept_code: d.meta.deptCode, title: d.meta.title,
      status: 'signing', sign_method: 'wet', confidentiality: d.meta.confidentiality, applies_to: d.meta.appliesTo,
      parent_policy: d.meta.parentPolicy || null, clinical_impact: 'No', content_json: JSON.stringify({ blocks: d.blocks }), ai: 0,
      author_email: authorEmail, author_name: prep.name, author_designation: prep.designation, submitted_at: now(),
      change_summary: d.meta.revisions[0].summary, version: 1, seq: 1, doc_id: d.meta.docId,
      effective_date: '2026-06-01', review_date: d.meta.docId.includes('-POL-') ? '2028-06-01' : '2027-06-01',
      numbered_at: now(), numbered_by: '',
    });
    replaceSignatories(newId, [
      { stage: md.stage, email: mdEmail, name: md.name, designation: md.designation },
      { stage: ceo.stage, email: ceoEmail, name: ceo.name, designation: ceo.designation },
    ]);
    db.prepare("UPDATE signatories SET status = 'approved', acted_at = NULL WHERE document_id = ?").run(newId); // approved on paper
    addEvent(newId, importer, 'Imported', 'Approved for signature outside the portal; printed as FINAL for handwritten signatures.');
    return newId;
  });
  console.log(`Imported ${d.meta.docId} as document ${id} – awaiting the signed copy.`);
}
