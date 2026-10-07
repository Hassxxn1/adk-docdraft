// Generates sample drafts without calling the AI service, to check the Word layout.
// Usage: node scripts/sample.js <output-dir>
const fs = require('fs');
const path = require('path');
const { resolveType } = require('../lib/config');
const { buildDocx } = require('../lib/docgen');

const out = process.argv[2] || '.';

const sop = {
  purpose: 'This procedure sets out how wards audit hand hygiene compliance each month, so that the hospital can measure practice against the WHO Five Moments and act on low compliance.',
  scope: 'This procedure applies to all inpatient wards and the Emergency Department. It does not cover outpatient clinics, which follow a separate quarterly audit.',
  definitions: [
    { term: 'Opportunity', definition: 'A moment during care when hand hygiene is required under the WHO Five Moments.' },
    { term: 'Compliance rate', definition: 'Hand hygiene actions performed divided by opportunities observed, expressed as a percentage.' },
  ],
  roles: [
    { role: 'Ward Manager', responsibilities: ['Ensures the audit is completed by the 5th working day of each month.', 'Starts an action plan when compliance falls below the target.'] },
    { role: 'Infection Control Nurse', responsibilities: ['Validates audit results and reports them to the Infection Control Committee.'] },
    { role: 'HR (custodian)', responsibilities: ['Maintains the controlled copy and review reminders. HR does not own the technical content.'] },
  ],
  prerequisites: ['Hand Hygiene Audit Form [Author to confirm: form ID].', 'Auditor has completed hand hygiene observer training.'],
  procedure: [
    { stage: 'Prepare the audit', steps: [
      { actor: 'Ward Manager', action: 'Assign a trained auditor for the month.' },
      { actor: 'Auditor', action: 'Select ten observation periods across day and night shifts.' },
    ] },
    { stage: 'Conduct and report', steps: [
      { actor: 'Auditor', action: 'Record each opportunity and action on the Hand Hygiene Audit Form.' },
      { actor: 'Auditor', action: 'Calculate the compliance rate and submit the form to the Ward Manager.' },
      { actor: 'Ward Manager', action: 'If compliance is below 80%, then start an improvement action plan within 7 days.' },
      { actor: 'Infection Control Nurse', action: 'Compile ward results and present them at the monthly Infection Control Committee.' },
    ] },
  ],
  records: [
    { record: 'Hand Hygiene Audit Form', keptBy: 'Ward Manager', retention: '[Author to confirm: retention period]' },
    { record: 'Monthly compliance summary', keptBy: 'Infection Control Nurse', retention: '3 years' },
  ],
  monitoring: ['Monthly ward compliance rate, target 80% or above.', 'Quarterly validation audit by the Infection Control Nurse.'],
  training: ['Department briefing for all ward staff before go-live.', 'Observer training for all auditors.'],
  related: ['QSD-POL-002-V1 Infection Prevention and Control Policy'],
  references: ['WHO Guidelines on Hand Hygiene in Health Care (2009).'],
  authorFlags: [
    'The Hand Hygiene Audit Form has no document ID. Confirm whether it exists as a controlled form, or create it under QSD-FRM.',
    'Retention period for completed audit forms was not given. Confirm against the hospital records retention schedule.',
    'The 80% target was taken from your notes. Confirm it matches the Infection Control Committee target.',
  ],
};

const policy = {
  purpose: 'This policy sets the hospital’s requirements for hand hygiene, to reduce healthcare-associated infections.',
  scope: 'All staff, contractors and students working in clinical areas.',
  definitions: [],
  policyStatements: [
    'All staff shall perform hand hygiene at each of the WHO Five Moments.',
    'Each inpatient ward shall complete a monthly hand hygiene audit.',
    'Compliance below 80% shall trigger an improvement action plan within 7 days.',
  ],
  roles: [{ role: 'Director of Quality and Safety', responsibilities: ['Owns this policy and reports compliance to senior management.'] }],
  prerequisites: [], procedure: [], records: [],
  monitoring: ['Quarterly compliance report to the Patient Safety Committee.'],
  training: ['Hospital memo and briefing; training mandatory; acknowledgement mandatory.'],
  related: [], references: [],
  authorFlags: [],
};

const empty = { definitions: [], policyStatements: [], guidance: [], background: '', directiveInstructions: [], conversion: '', completionInstructions: [], formSections: [], roles: [], prerequisites: [], procedure: [], records: [], monitoring: [], training: [], related: [], references: [], authorFlags: [] };

const guideline = { ...empty,
  purpose: 'This guideline describes good practice for nursing shift handover, so that information is passed on completely and consistently.',
  scope: 'Registered nurses handing over inpatients at each change of shift. It does not cover transfers between departments.',
  guidance: [
    { topic: 'Structure', recommendations: ['Nurses should use the SBAR structure for verbal handover.', 'Handover should take place at the bedside where the patient’s condition allows.'] },
    { topic: 'Content', recommendations: ['The outgoing nurse should highlight pending results and outstanding tasks.', 'Nurses may use the electronic handover summary as a prompt.'] },
  ],
  roles: [{ role: 'Nurse in Charge', responsibilities: ['Should ensure handover starts on time and is not interrupted.'] }],
  training: ['Communication to all nursing staff through the ward briefing.'],
  related: ['NUR-SOP-003-V1 Patient Transfer Between Wards'],
};

const form = { ...empty,
  purpose: 'This checklist confirms that a patient is ready before leaving the ward for theatre.',
  scope: 'Completed by the ward nurse for every elective and emergency surgical patient before transfer to theatre.',
  completionInstructions: ['The ward nurse completes every field before the patient leaves the ward.', 'The theatre reception nurse checks and countersigns the checklist on arrival.', 'File the completed checklist in the patient’s medical record.'],
  formSections: [
    { section: 'Patient identification', fields: [
      { field: 'Patient name and MRN', guidance: 'As shown on the identity band.', mandatory: true },
      { field: 'Identity band checked', guidance: 'Tick when matched against the consent form.', mandatory: true },
    ] },
    { section: 'Pre-operative checks', fields: [
      { field: 'Consent signed', guidance: 'Confirm the consent form is signed and dated.', mandatory: true },
      { field: 'Fasting from (time)', guidance: 'Time of last food and of last clear fluids, in 24-hour format.', mandatory: true },
      { field: 'Allergies', guidance: 'Record known allergies, or write "None known".', mandatory: true },
      { field: 'Site marked', guidance: 'Where applicable, confirm the surgical site is marked.', mandatory: false },
    ] },
  ],
  records: [{ record: 'Completed checklist', keptBy: 'Medical Records', retention: '[Author to confirm: retention period]' }],
  related: ['GES-SOP-001-V1 Pre-operative Preparation'],
  authorFlags: ['Confirm the retention period for completed checklists with Medical Records.'],
};

const directive = { ...empty,
  purpose: 'This directive suspends visiting to the Intensive Care Unit while an outbreak is investigated.',
  background: 'Two patients in the ICU have tested positive for the same infection. Restricting visitors reduces the risk of further spread while the source is investigated.',
  scope: 'All visitors, staff and contractors entering the Intensive Care Unit.',
  directiveInstructions: ['ICU visiting shall be suspended, except for one nominated family member per patient.', 'The nominated family member shall wear the protective equipment issued at the ICU entrance.', 'Security shall keep a log of every person entering the ICU.'],
  roles: [{ role: 'ICU Nurse in Charge', responsibilities: ['Approves the nominated family member for each patient.'] }, { role: 'Security', responsibilities: ['Controls access at the ICU entrance and keeps the entry log.'] }],
  conversion: 'The Infection Control Committee will decide at the end of the period whether visiting rules for outbreaks should be made permanent in an infection control SOP.',
  training: ['Immediate communication to ICU staff, Security and Customer Experience.'],
  related: ['QSD-POL-002-V1 Infection Prevention and Control Policy'],
};

(async () => {
  const base = { owner: '', appliesTo: '', supersedes: '', clinicalImpact: 'No', draftedBy: 'Sample Author', ai: true };
  const jobs = [
    ['1-org-policy', resolveType('ORG_POLICY'), { deptCode: 'COR', deptName: 'Hospital Management', title: 'Hand Hygiene Policy', owner: 'Managing Director', appliesTo: 'All staff, contractors and students' }, policy],
    ['2-dept-policy', resolveType('DEPT_POLICY'), { deptCode: 'QSD', deptName: 'Quality and Safety', title: 'Hand Hygiene Policy', owner: 'Director of Quality and Safety', appliesTo: 'All clinical areas' }, policy],
    ['3-sop', resolveType('SOP'), { deptCode: 'QSD', deptName: 'Quality and Safety', title: 'Monthly Hand Hygiene Compliance Audit', parentPolicy: 'QSD-POL-002-V1', owner: 'Director of Quality and Safety', appliesTo: 'All inpatient wards and the Emergency Department', clinicalImpact: 'Yes' }, sop],
    ['3-clinical-protocol', resolveType('CLINICAL_PROTOCOL'), { deptCode: 'CLN', deptName: 'Clinical', title: 'Hand Hygiene in Aseptic Procedures', parentPolicy: 'QSD-POL-002-V1', clinicalImpact: 'Yes' }, sop],
    ['4-guideline', resolveType('GUIDELINE'), { deptCode: 'NUR', deptName: 'Nursing Services', title: 'Nursing Shift Handover', owner: 'Director of Nursing', appliesTo: 'Registered nurses in inpatient wards' }, guideline],
    ['5-form', resolveType('FORM', 'CHK'), { deptCode: 'GES', deptName: 'General Surgery', title: 'Pre-operative Ward to Theatre Checklist', owner: 'Head of General Surgery', appliesTo: 'Ward and theatre nursing staff', clinicalImpact: 'Yes' }, form],
    ['6-directive', resolveType('DIRECTIVE', 'CLINICAL'), { deptCode: 'CLN', deptName: 'Clinical', title: 'Temporary Suspension of ICU Visiting', appliesTo: 'Intensive Care Unit', clinicalImpact: 'Yes', effectiveFrom: '07 October 2026', expiry: '21 October 2026' }, directive],
  ];
  for (const [name, type, meta, content] of jobs) {
    fs.writeFileSync(path.join(out, `sample-${name}.docx`), await buildDocx(type, { ...base, ...meta }, { ...empty, ...content }));
  }
  console.log('written', jobs.length);
})();
