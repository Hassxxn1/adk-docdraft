// First-run defaults for departments and document types.
// Source: Document Governance Policy COR-POL-001 (clause 5, document hierarchy) and
// COR-SOP-001 Appendix 1 (department prefixes). After the first start these are held in the
// database and managed by the Super Admin (Admin → Departments and Admin → Settings).

// Appendix 1: Department prefixes (clause 8). Spelling corrections applied:
// Administation → Administration, Leagal → Legal, Cardiothoracis → Cardiothoracic, Orthopeadics → Orthopaedics.
const DEPARTMENTS = [
  { code: 'ADM', name: 'Administration' },
  { code: 'ANE', name: 'Anesthesia' },
  { code: 'BBK', name: 'Blood Bank' },
  { code: 'BME', name: 'Biomedical Engineering' },
  { code: 'CAD', name: 'Cardiology' },
  { code: 'CLN', name: 'Clinical' },
  { code: 'COR', name: 'Hospital Management' },
  { code: 'CRE', name: 'Customer Experience' },
  { code: 'CSD', name: 'Sterile Supplies' },
  { code: 'CSS', name: 'Clinical Support' },
  { code: 'CTV', name: 'Cardiothoracic and Vascular Surgery' },
  { code: 'DEN', name: 'Dental' },
  { code: 'DER', name: 'Dermatology' },
  { code: 'DIE', name: 'Dietetics' },
  { code: 'EMY', name: 'Emergency' },
  { code: 'END', name: 'Endocrinology' },
  { code: 'ENT', name: 'ENT' },
  { code: 'FCR', name: 'Food Corner' },
  { code: 'FIN', name: 'Accounts and Finance' },
  { code: 'GAS', name: 'Gastroenterology' },
  { code: 'GES', name: 'General Surgery' },
  { code: 'HRM', name: 'Human Resources' },
  { code: 'HSK', name: 'Housekeeping' },
  { code: 'HTU', name: 'Hyperbaric Treatment' },
  { code: 'ICT', name: 'Information Technology' },
  { code: 'INT', name: 'Internal Medicine' },
  { code: 'LAB', name: 'Laboratory' },
  { code: 'LEG', name: 'Legal' },
  { code: 'MED', name: 'Medical Services' },
  { code: 'MKT', name: 'Marketing' },
  { code: 'MNT', name: 'Maintenance' },
  { code: 'NEC', name: 'Nuclear Medicine' },
  { code: 'NEP', name: 'Nephrology' },
  { code: 'NEU', name: 'Neurology' },
  { code: 'NUR', name: 'Nursing Services' },
  { code: 'NUS', name: 'Neuro Surgery' },
  { code: 'OBG', name: 'Obstetrics and Gynecology' },
  { code: 'ONC', name: 'Oncology' },
  { code: 'OPS', name: 'Operations' },
  { code: 'ORT', name: 'Orthopaedics' },
  { code: 'PED', name: 'Pediatrics' },
  { code: 'PHY', name: 'Physiotherapy and Rehabilitation' },
  { code: 'PLS', name: 'Plastic Surgery' },
  { code: 'PSD', name: 'Procurement' },
  { code: 'PUL', name: 'Pulmonology' },
  { code: 'PWR', name: 'Powerhouse' },
  { code: 'QSD', name: 'Quality and Safety' },
  { code: 'RAD', name: 'Radiology' },
  { code: 'RHU', name: 'Rheumatology' },
  { code: 'SEC', name: 'Security' },
  { code: 'URO', name: 'Urology' },
];

// Clause 5.1: document hierarchy, with the cover colour for each level (hex, no #).
// template: which body structure the generator uses (policy, sop, guideline, form, directive).
// variants: sub-types chosen in the form; a variant can override prefix, department and approvals.
const DOC_TYPES = {
  ORG_POLICY: {
    label: 'Organization-wide Policy',
    level: 1, prefix: 'POL', colour: 'B9D3DC', template: 'policy',
    reviewYears: 2, reviewText: 'Every 2 years',
    reviewers: ['MD and relevant leadership'],
    finalApproval: 'Board and/or CEO/Chairman',
    rollout: 'Hospital memo and briefing; training mandatory; acknowledgement mandatory',
    forceDept: 'COR',
  },
  DEPT_POLICY: {
    label: 'Department Policy',
    level: 2, prefix: 'POL', colour: '71B2C9', template: 'policy',
    reviewYears: 2, reviewText: 'Every 2 years',
    reviewers: ['Director/HOD', 'HR (governance check)'],
    finalApproval: 'MD and/or Board',
    rollout: 'Communicated to the relevant department; training if operational impact; acknowledgement where applicable',
  },
  SOP: {
    label: 'Standard Operating Procedure (SOP)',
    level: 3, prefix: 'SOP', colour: 'FEAD77', template: 'sop',
    reviewYears: 1, reviewText: 'Annual',
    reviewers: ['Department Head/Director'],
    finalApproval: 'Director and/or MD',
    rollout: 'Department briefing; competency-based training if needed; acknowledgement optional',
  },
  CLINICAL_PROTOCOL: {
    label: 'Clinical Protocol',
    level: 3, prefix: 'PRT', colour: 'FDD263', template: 'sop',
    reviewYears: 1, reviewText: 'Annual, or as regulation requires',
    reviewers: ['Clinical leadership'],
    finalApproval: 'CMO',
    rollout: 'Clinical training; training mandatory; acknowledgement mandatory',
    clinical: true,
  },
  GUIDELINE: {
    label: 'Guideline',
    level: 4, prefix: 'GLN', colour: 'B7CDC2', template: 'guideline',
    reviewYears: null, reviewText: 'As needed',
    reviewers: ['HOD'],
    finalApproval: 'Director/HOD',
    rollout: 'Communication only; training optional; acknowledgement not required',
  },
  FORM: {
    label: 'Controlled Form / Template',
    level: 5, prefix: 'FRM', colour: 'B5B09A', template: 'form',
    reviewYears: null, reviewText: 'As needed',
    reviewers: ['HOD'],
    finalApproval: 'HOD/Director',
    rollout: 'Implementation notice; training not required; acknowledgement not required',
    variantLabel: 'Form type',
    variants: {
      FRM: { label: 'Form', prefix: 'FRM' },
      TMP: { label: 'Template', prefix: 'TMP' },
      CHK: { label: 'Checklist', prefix: 'CHK' },
      REG: { label: 'Register', prefix: 'REG' },
    },
  },
  DIRECTIVE: {
    label: 'Management Directive',
    level: 6, prefix: 'DIR', colour: 'EAA794', template: 'directive',
    reviewYears: null, reviewText: 'By expiry or review date stated in the directive',
    reviewers: ['MD / CMO'],
    finalApproval: 'CEO/Chairman or MD',
    rollout: 'Communicated immediately; training case dependent; acknowledgement optional',
    variantLabel: 'Directive scope',
    variants: {
      CORPORATE: { label: 'Corporate – hospital-wide or multi-department', forceDept: 'COR', reviewers: ['MD'], finalApproval: 'MD and/or CEO/Chairman' },
      DEPARTMENT: { label: 'Department – one department only', reviewers: ['Director/HOD'], finalApproval: 'Director/HOD, and MD where required' },
      CLINICAL: { label: 'Clinical – urgent patient-care instruction', forceDept: 'CLN', reviewers: ['Clinical leadership'], finalApproval: 'CMO', clinical: true },
    },
  },
};

// Resolves a document type plus optional variant into one effective definition.
function resolveType(key, variantKey) {
  const base = DOC_TYPES[key];
  if (!base) return null;
  if (!base.variants) return { key, ...base };
  const vk = base.variants[variantKey] ? variantKey : Object.keys(base.variants)[0];
  const v = base.variants[vk];
  const { label: variantName, ...overrides } = v;
  return { key, ...base, ...overrides, variantKey: vk, variantName };
}

module.exports = { DEPARTMENTS, DOC_TYPES, resolveType };
