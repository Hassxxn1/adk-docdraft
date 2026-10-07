// Lays the approved-for-signature Document Governance Policy and SOP into the ADK master template.
// Wording is the authors' own. Only numbering, ID, prefix and spelling corrections have been applied.
// Usage: node scripts/governance-docs.js <output-dir>
const fs = require('fs');
const path = require('path');
const { resolveType, DEPARTMENTS } = require('../lib/config');
const { buildDocx } = require('../lib/docgen');

const out = process.argv[2] || '.';

// Helpers: a numbered list of clauses under a parent number.
const list = (parent, items) => items.map((text, i) => ({ n: `${parent}.${i + 1}`, text }));
const LEVEL_FILL = { 1: 'B9D3DC', 2: '71B2C9', '3s': 'FEAD77', '3c': 'FDD263', 4: 'B7CDC2', 5: 'B5B09A', 6: 'EAA794' };

// ======================================================================
// COR-POL-001-V1 Document Governance Policy
// ======================================================================
const policyBlocks = [
  { h: 1, text: 'Purpose' },
  { n: '1.1', text: 'The purpose of this Policy is to establish a standardized and controlled document governance system for the Hospital to ensure all organizational documents are developed, approved, communicated, implemented, maintained, and reviewed in a consistent manner.' },
  { n: '1.2', text: 'This Policy aims to:' },
  ...list('1.2', [
    'Promote consistency across all departments',
    'Ensure accountability and proper governance',
    'Support compliance with legal, regulatory, accreditation, and operational requirements',
    'Maintain controlled and up-to-date documentation',
    'Ensure proper communication and implementation of hospital requirements',
    'Establish clear ownership, approval, and document control responsibilities',
  ]),

  { h: 2, text: 'Scope' },
  { n: '2.1', text: 'This Policy applies to:' },
  { n: '2.1.1', text: 'All hospital departments' },
  { n: '2.1.2', text: 'All employees, consultants, contractors, interns, and outsourced personnel' },
  { n: '2.1.3', text: 'All controlled organizational documents issued by the Hospital, including but not limited to:' },
  ...list('2.1.3', [
    'Organization-Wide Policies',
    'Department Policies',
    'Standard Operating Procedures (SOPs)',
    'Clinical Protocols',
    'Guidelines',
    'Controlled Forms and Templates',
    'Management Directives',
  ]),
  { n: '2.2', text: 'This Policy applies across all departments and functions of the Hospital.' },

  { h: 3, text: 'Policy Statement' },
  ...list('3', [
    'The Hospital shall maintain a standardized document governance system to ensure all organizational documents are properly developed, approved, implemented, communicated, reviewed, and controlled.',
    'No controlled document shall be considered valid unless approved and issued in accordance with the Hospital’s approved document governance requirements.',
    'All departments shall comply with this Policy and the supporting Document Governance SOP.',
  ]),

  { h: 4, text: 'Governance Principles' },
  { n: '4.1', text: 'The Hospital adopts the following document governance principles:' },
  { n: '4.1.1', label: 'Standardization:', text: 'All documents shall follow approved templates, numbering systems, and governance requirements to ensure consistency across the organization.' },
  { n: '4.1.2', label: 'Accountability:', text: 'Departments shall be responsible for the operational and technical accuracy of documents relating to their function.' },
  { n: '4.1.3', label: 'Controlled Approval:', text: 'All controlled documents shall undergo an approved review and authorization process prior to implementation.' },
  { n: '4.1.4', label: 'Controlled Communication and Implementation:', text: 'Documents shall be appropriately communicated, implemented, and where required, supported by training and employee acknowledgement.' },
  { n: '4.1.5', label: 'Version Control:', text: 'Only approved and current versions of documents shall be used.' },
  { n: '4.1.6', label: 'Periodic Review:', text: 'Documents shall be periodically reviewed to ensure continued relevance, compliance, and operational effectiveness.' },
  { n: '4.1.7', label: 'Traceability:', text: 'The Hospital shall maintain appropriate document control systems to ensure traceability of approvals, revisions, communication, and implementation.' },

  { h: 5, text: 'Document Hierarchy' },
  { n: '5.1', text: 'The Hospital shall maintain a standardized document hierarchy.' },
  {
    under: '5.1',
    table: {
      widths: [1, 3],
      header: ['Level', 'Document Type'],
      rows: [
        ['Level 1', 'Organization-Wide Policies'],
        ['Level 2', 'Department Policies'],
        ['Level 3', 'SOPs and Clinical Protocols'],
        ['Level 4', 'Guidelines'],
        ['Level 5', 'Controlled Forms and Templates'],
        ['Level 6', 'Management Directives'],
      ],
      fills: [LEVEL_FILL[1], LEVEL_FILL[2], LEVEL_FILL['3s'], LEVEL_FILL[4], LEVEL_FILL[5], LEVEL_FILL[6]],
    },
  },
  { n: '5.2', text: 'In the event of conflict between documents, higher-level documents shall prevail unless otherwise approved.' },

  { h: 6, text: 'Document Classification' },
  { n: '6.1', text: 'All hospital-controlled documents shall be assigned an approved classification.' },
  { n: '6.2', text: 'The Hospital shall maintain the following classifications:' },
  ...list('6.2', [
    'Organization-Wide Policy',
    'Department Policy',
    'Standard Operating Procedure (SOP)',
    'Clinical Protocol',
    'Guideline',
    'Controlled Form',
    'Management Directive',
  ]),
  { n: '6.3', text: 'Each classification shall follow defined governance, approval, implementation, and review requirements as detailed within the Document Governance SOP.' },

  { h: 7, text: 'Roles and Responsibilities' },
  { n: '7.1', label: 'Department Ownership', text: [], keepNext: true },
  { n: '7.1.1', text: 'Departments shall own and maintain documents relating to their operational area.' },
  { n: '7.2', text: 'Departments shall be responsible for:' },
  ...list('7.2', [
    'Drafting documents',
    'Maintaining technical and operational accuracy',
    'Reviewing documents periodically',
    'Supporting implementation within their department',
    'Ensuring operational compliance',
  ]),
  { n: '7.3', label: 'Human Resources Department (Document Custodian)', text: [], keepNext: true },
  { n: '7.3.1', text: 'The Human Resources Department shall serve as the central document custodian for the Hospital.' },
  { n: '7.3.2', text: 'HR shall be responsible for:' },
  ...list('7.3.2', [
    'Maintaining document governance templates',
    'Managing document numbering standards',
    'Maintaining the master document register',
    'Tracking approvals and document issuance',
    'Supporting rollout and communication tracking',
    'Maintaining acknowledgement records where applicable',
    'Monitoring review timelines',
    'Maintaining version control',
    'Archiving obsolete documents',
  ]),
  { n: '7.3.3', text: 'HR shall serve as custodian and governance administrator and shall not assume technical ownership of departmental content unless the document belongs to HR.' },
  { n: '7.4', label: 'Leadership and Management', text: [], keepNext: true },
  { n: '7.4.1', text: 'Hospital leadership shall support effective implementation and compliance with document governance requirements.' },
  { n: '7.4.2', text: 'Relevant leadership shall ensure:' },
  ...list('7.4.2', [
    'Timely review and approvals',
    'Departmental implementation',
    'Appropriate communication and awareness',
    'Operational compliance',
  ]),

  { h: 8, text: 'Approval Requirements' },
  { n: '8.1', text: 'All controlled documents shall undergo an approved review and approval process.' },
  { n: '8.2', text: 'A minimum of two approval signatures shall be required for all controlled documents.' },
  { n: '8.3', text: 'Approval authority shall be based on:' },
  ...list('8.3', ['Document classification', 'Operational impact', 'Clinical impact', 'Organizational significance']),
  { n: '8.4', text: 'Detailed approval requirements and matrices shall be governed under the Document Governance SOP.' },

  { h: 9, text: 'Rollout, Communication and Training Principles' },
  { n: '9.1', text: 'The Hospital recognizes that effective implementation requires structured communication and awareness.' },
  { n: '9.2', text: 'All applicable documents shall be appropriately:' },
  ...list('9.2', [
    'Communicated',
    'Rolled out',
    'Explained to affected employees',
    'Supported by training where required',
    'Supported by employee acknowledgement where applicable',
  ]),
  { n: '9.3', text: 'New employees shall receive appropriate policy and SOP orientation relevant to their role.' },
  { n: '9.4', text: 'Refresher training may be conducted periodically or when significant changes occur.' },
  { n: '9.5', text: 'Detailed rollout and training requirements shall be governed under the Document Governance SOP.' },

  { h: 10, text: 'Document Control and Review' },
  { n: '10.1', text: 'The Hospital shall maintain a controlled document management system.' },
  { n: '10.2', text: 'All controlled documents shall:' },
  ...list('10.2', [
    'Be uniquely identified',
    'Follow approved numbering conventions',
    'Be version controlled',
    'Be periodically reviewed',
    'Be maintained in approved locations',
    'Be removed from use when obsolete',
  ]),
  { n: '10.3', text: 'Only approved current versions shall be considered valid.' },
  { n: '10.4', text: 'Detailed operational processes shall be governed through the Document Governance SOP.' },

  { h: 11, text: 'Compliance and Exceptions' },
  { n: '11.1', text: 'All employees and departments shall comply with this Policy.' },
  { n: '11.2', text: 'Failure to comply with document governance requirements may result in:' },
  ...list('11.2', ['Operational corrective action', 'Process review', 'Management intervention', 'Disciplinary action where applicable']),
  { n: '11.3', text: 'Any exception to this Policy shall require approval by Hospital Management.' },

  { h: 12, text: 'Supporting Documents' },
  { n: '12.1', text: 'This Policy shall be supported by:' },
  ...list('12.1', [
    'Document Governance SOP (Policy Development, Approval, Implementation & Control)',
    'Document Templates',
    'Controlled Forms',
    'Approval Forms',
    'Rollout Checklists',
    'Version Control Register',
    'Employee Acknowledgement Forms',
  ]),

  { h: 13, text: 'Review and Amendment' },
  { n: '13.1', text: 'This Policy shall be reviewed every two (2) years or earlier where required due to:' },
  ...list('13.1', ['Regulatory changes', 'Accreditation requirements', 'Organizational restructuring', 'Operational changes', 'Governance improvements']),
  { n: '13.2', text: 'All amendments shall follow the approved document governance process.' },
];

// ======================================================================
// COR-SOP-001-V1 Document Governance SOP
// ======================================================================
const sopBlocks = [
  { h: 1, text: 'Purpose' },
  { n: '1.1', text: 'The purpose of this SOP is to establish a standardized process for the development, review, approval, communication, implementation, monitoring, revision, and archiving of all hospital policies, procedures, protocols, guidelines, forms, and directives.' },
  { n: '1.2', text: 'This SOP ensures:' },
  ...list('1.2', [
    'Consistency across all departments',
    'Proper governance and accountability',
    'Compliance with hospital standards and regulatory requirements',
    'Effective communication and implementation',
    'Proper document control and version management',
    'Clear ownership and approval responsibilities',
  ]),

  { h: 2, text: 'Scope' },
  { n: '2.1', text: 'This SOP applies to:' },
  { n: '2.1.1', text: 'All departments of the hospital' },
  { n: '2.1.2', text: 'All employees, contractors, interns, and consultants' },
  { n: '2.1.3', text: 'All controlled documents issued by the hospital, including:' },
  ...list('2.1.3', [
    'Organization-wide Policies',
    'Department Policies',
    'Standard Operating Procedures (SOPs)',
    'Clinical Protocols',
    'Guidelines',
    'Controlled Forms',
    'Management Directives',
  ]),

  { h: 3, text: 'Governance Principles' },
  { n: '3.1', text: 'The hospital adopts a controlled document governance approach based on:' },
  ...list('3.1', [
    'Department Ownership',
    'Central Governance Oversight',
    'Controlled Approval Process',
    'Standardized Rollout',
    'Version Control',
    'Accountability and Traceability',
  ]),
  { n: '3.2', text: 'All controlled documents must follow this SOP.' },
  { n: '3.3', text: 'No policy, SOP, or controlled document shall be considered valid unless approved and issued in accordance with this SOP.' },

  { h: 4, text: 'Governance Model' },
  { n: '4.1', text: 'Each department shall own the content of documents related to its operations.' },
  { n: '4.2', text: 'Departments are responsible for:' },
  ...list('4.2', [
    'Drafting documents',
    'Technical and operational accuracy',
    'Periodic review',
    'Department implementation',
    'Ensuring operational compliance',
  ]),
  { n: '4.3', text: 'Example ownership includes:' },
  {
    under: '4.3',
    table: {
      widths: [1, 3],
      header: ['Department', 'Examples'],
      rows: [
        ['HR', 'Leave Policy, Recruitment Policy'],
        ['IT', 'Cybersecurity Policy, Access Control SOP'],
        ['Clinical', 'Clinical Protocols'],
        ['Finance', 'Payroll Policy, Budget SOP'],
        ['Operations', 'Transport SOP, Facilities SOP'],
      ],
    },
  },
  { n: '4.4', text: 'The Human Resources Department shall serve as the central document custodian for the hospital.' },
  { n: '4.5', text: 'HR shall be responsible for:' },
  ...list('4.5', [
    'Maintaining document templates',
    'Document numbering control',
    'Maintaining the master document register',
    'Approval tracking',
    'Rollout tracking',
    'Employee acknowledgement tracking',
    'Version control',
    'Review reminders',
    'Archiving obsolete documents',
    'Ensuring compliance with this SOP',
  ]),
  { n: '4.6', text: 'HR shall serve as custodian and governance administrator and shall not assume technical ownership of departmental content unless the document belongs to HR.' },

  { h: 5, text: 'Document Hierarchy' },
  { n: '5.1', text: 'The hospital shall maintain the following document hierarchy:' },
  {
    under: '5.1',
    table: {
      widths: [1, 2.6, 1.4],
      header: ['Level', 'Document Type', 'Color Code'],
      rows: [
        ['Level 1', 'Organization-wide Policies', 'Hex: B9D3DC'],
        ['Level 2', 'Department Policies', 'Hex: 71B2C9'],
        ['Level 3', 'SOPs', 'Hex: FEAD77'],
        ['Level 3', 'Clinical Protocols', 'Hex: FDD263'],
        ['Level 4', 'Guidelines', 'Hex: B7CDC2'],
        ['Level 5', 'Controlled Forms & Templates', 'Hex: B5B09A'],
        ['Level 6', 'Management Directives', 'Hex: EAA794'],
      ],
      fills: [LEVEL_FILL[1], LEVEL_FILL[2], LEVEL_FILL['3s'], LEVEL_FILL['3c'], LEVEL_FILL[4], LEVEL_FILL[5], LEVEL_FILL[6]],
    },
  },
  { n: '5.2', text: 'In case of conflict, higher-level documents shall prevail.' },

  { h: 6, text: 'Document Classification Framework' },
  { n: '6.1', text: 'All documents shall be assigned a classification.' },
  {
    under: '6.1',
    table: {
      widths: [1.3, 1.9, 1.6],
      header: ['Classification', 'Definition', 'Examples'],
      rows: [
        ['Organization-wide Policy', 'Organization-wide policies applicable to all departments', 'Whistleblower Policy'],
        ['Department Policy', 'Policies owned by a department', 'Leave Policy'],
        ['SOP', 'Step-by-step operational instructions', 'Exit Clearance SOP'],
        ['Clinical Protocol', 'Clinical standards and patient-care instructions', 'Infection Control Protocol'],
        ['Guideline', 'Recommended best-practice guidance', 'Workplace Etiquette Guideline'],
        ['Controlled Form', 'Standardized forms and templates', 'Leave Form'],
        ['Management Directive', 'Temporary instructions', 'Emergency staffing memo'],
      ],
    },
  },
  { n: '6.2', text: 'No document shall be issued without classification.' },

  { h: 7, text: 'Document and Text Numbering System' },
  { n: '7.1', text: 'HR shall maintain a standardized numbering structure for all documents.' },
  { n: '7.1.1', text: 'Format: [Department Prefix]-[Document Type]-[Number]-[Version]' },
  { n: '7.1.2', text: 'Examples:' },
  { under: '7.1.2', bullets: ['HRM-POL-001-V1', 'ICT-SOP-004-V2', 'CLN-PRT-002-V1', 'OPS-GLN-001-V1', 'HRM-FRM-003-V1'] },

  { h: 8, text: 'Department Prefixes' },
  { n: '8.1', text: 'A list of acronyms that will be used throughout the hospital for the numbering system of all SOPs are attached in Appendix 1. This list is derived based on the requirements rather than each separate department and also to align the nomenclature to future accreditation needs. This list can be reviewed and revised as and when required.' },

  { h: 9, text: 'Document Prefixes' },
  { n: '9.1', text: 'The following prefixes are assigned to the different documents.' },
  {
    under: '9.1',
    table: {
      widths: [3, 1],
      header: ['Document', 'Prefix'],
      rows: [
        ['Policy', 'POL'],
        ['Standard Operating Procedure', 'SOP'],
        ['Clinical Protocol', 'PRT'],
        ['Guideline', 'GLN'],
        ['Controlled Form', 'FRM'],
        ['Template', 'TMP'],
        ['Checklist', 'CHK'],
        ['Register/ Tracker', 'REG'],
        ['Management Directive/ Circular', 'DIR'],
        ['Manual', 'MAN'],
      ],
    },
  },

  { h: 10, text: 'Document Cover Page Requirements' },
  { n: '10.1', text: 'All controlled documents must include the following on the first page:' },
  ...list('10.1', [
    'Document Title',
    'Document ID',
    'Document Classification',
    'Version Number',
    'Previous Version Reference',
    'Effective Date',
    'Review Date',
    'Prepared By',
    'Applicable To',
    'Document Owner',
    'Document Custodian',
    'Confidentiality Level',
    'Approval Signatures',
  ]),

  { h: 11, text: 'Confidentiality Levels' },
  { n: '11.1', text: 'The following levels are applied to ensure that the security of documents are maintained at all times.' },
  {
    under: '11.1',
    table: {
      widths: [1, 2],
      header: ['Level', 'Description'],
      rows: [
        ['Public', 'Approved for external use'],
        ['Internal Use', 'Employee operational use only'],
        ['Confidential', 'Restricted to authorized staff'],
        ['Highly Confidential', 'Executive/legal/sensitive'],
      ],
    },
  },

  { h: 12, text: 'Policy Lifecycle Process' },
  { n: '12.1', text: 'All documents must follow the lifecycle below:' },
  ...list('12.1', [
    'Need Identification',
    'Drafting',
    'Review',
    'Approval',
    'Registration & Numbering',
    'Rollout & Communication',
    'Training (if required)',
    'Employee Acknowledgement (if required)',
    'Monitoring',
    'Periodic Review',
    'Amendment or Archiving',
  ]),

  { h: 13, text: 'Drafting Requirements' },
  { n: '13.1', text: 'All documents must:' },
  ...list('13.1', [
    'Use approved hospital template',
    'Be written in simple and clear language',
    'State responsibilities clearly',
    'Include implementation requirements',
    'Include definitions where required',
    'Avoid ambiguity',
  ]),
  { n: '13.2', text: 'Where necessary, supporting SOPs or forms shall also be developed.' },

  { h: 14, text: 'Review & Approval Matrix' },
  { n: '14.1', text: 'A minimum of two approval signatures shall be required for all controlled documents.' },
  { n: '14.2', text: 'Approval authority shall reflect the hospital’s current governance structure and operational impact of the document.' },
  {
    under: '14.2',
    table: {
      widths: [1.3, 1.1, 1.6, 1.8],
      header: ['Classification', 'Drafted By', 'Reviewed By', 'Final Approval'],
      rows: [
        ['Organization-wide Policy', 'Relevant Department', 'Managing Director (MD) + Relevant Leadership', 'Board of Directors and/or CEO / Chairman'],
        ['Department Policy', 'Department Owner', 'Relevant Director / HOD + HR', 'Managing Director (MD) and/or Board of Directors'],
        ['SOP', 'Department', 'Department Head / Director', 'Relevant Director and/or Managing Director (MD)'],
        ['Clinical Protocol', 'Clinical Department', 'Clinical Leadership', 'Chief Medical Officer (CMO)'],
        ['Guideline', 'Department', 'HOD', 'Director / HOD'],
        ['Controlled Form', 'Department', 'HOD', 'HOD / Director'],
        ['Management Directive', 'Relevant Department', 'Managing Director (MD) / CMO (where applicable)', 'CEO / Chairman or Managing Director (MD), depending on urgency and impact'],
      ],
    },
  },
  { n: '14.3', label: 'Additional Approval Requirements', text: [], keepNext: true },
  ...list('14.3', [
    'Documents with clinical impact must include review or approval by the Chief Medical Officer (CMO).',
    'Enterprise-wide governance documents shall require approval by the Board of Directors and/or CEO / Chairman, depending on significance.',
    'Documents affecting multiple departments may require cross-functional review.',
    'HR shall verify completion of required approvals before issuing any controlled document.',
    'No document shall be considered active without the required approvals and signatures.',
  ]),

  { h: 15, text: 'Registration & Numbering' },
  { n: '15.1', text: 'After approval, HR shall:' },
  ...list('15.1', ['Assign document number', 'Update version number', 'Register in master index', 'Upload controlled copy', 'Archive prior versions']),
  { n: '15.2', text: 'Only HR may issue final controlled copies.' },

  { h: 16, text: 'Rollout & Communication Matrix' },
  { n: '16.1', text: 'Rollout requirements differ based on document classification.' },
  {
    under: '16.1',
    table: {
      widths: [1.3, 1.5, 1.3, 1.6],
      header: ['Classification', 'Communication', 'Training', 'Acknowledgement'],
      rows: [
        ['Organization-wide Policy', 'Hospital-wide memo + briefing', 'Mandatory', 'Mandatory'],
        ['Department Policy', 'Relevant department', 'Required if operational impact', 'HR required/ other departments required where applicable'],
        ['SOP', 'Department briefing', 'Competency-based if needed', 'Optional'],
        ['Clinical Protocol', 'Clinical training', 'Mandatory', 'Mandatory'],
        ['Guideline', 'Communication only', 'Optional', 'Not required'],
        ['Controlled Form', 'Implementation notice', 'Not required', 'Not required'],
        ['Management Directive', 'Immediate communication', 'Case dependent', 'Optional'],
      ],
    },
  },

  { h: 17, text: 'Standard Rollout Process' },
  { n: '17.1', text: 'The standard rollout process for documents must include, unless otherwise approved:' },
  ...list('17.1', [
    'Approval completed',
    'HR assigns document number',
    'Memo / communication issued',
    'Department briefing conducted',
    'Training conducted if required',
    'Employee acknowledgement collected',
    'Effective date activated',
    'Monitoring period begins',
  ]),

  { h: 18, text: 'Training Requirements' },
  { n: '18.1', text: 'Training requirements shall depend on the operational risk, complexity, and document classification.' },
  { n: '18.2', text: 'Training methods may include:' },
  ...list('18.2', [
    'Department briefing',
    'Classroom training',
    'Competency-based training',
    'Scenario-based training',
    'E-learning / self-learning modules',
    'Demonstration or practical sessions',
  ]),
  { n: '18.3', text: 'Attendance for all required training shall be documented and maintained by the relevant department and HR.' },
  { n: '18.4', text: 'Where training is required, the relevant department shall ensure all affected employees are trained before or within a reasonable period following the effective date of the document.' },
  { n: '18.5', text: 'High-risk or operationally critical documents shall require mandatory training before implementation. Examples include:' },
  ...list('18.5', ['Clinical protocols', 'Patient safety procedures', 'Workplace health & safety requirements', 'High-impact HR policies']),

  { h: 19, text: 'Compliance-related procedures' },
  { n: '19.1', text: 'All newly joined employees shall receive training or orientation on relevant policies, SOPs, protocols, and workplace requirements applicable to their role during onboarding and induction.' },
  { n: '19.2', text: 'At minimum, new employees shall be briefed on:' },
  ...list('19.2', [
    'Code of Conduct / Professional Ethics',
    'Leave and attendance requirements',
    'Workplace safety requirements',
    'Harassment and grievance mechanisms',
    'Confidentiality and data privacy expectations',
    'Department-specific SOPs and operational requirements',
  ]),
  { n: '19.3', text: 'Departments shall ensure role-specific operational training is completed within the probation period.' },
  { n: '19.4', text: 'HR shall maintain evidence of onboarding-related policy orientation.' },
  { n: '19.5', label: 'Refresher Training', text: [], keepNext: true },
  { n: '19.5.1', text: 'Refresher training shall be conducted periodically to reinforce compliance, operational consistency, and awareness.' },
  { n: '19.5.2', text: 'Refresher training may be required under the following circumstances:' },
  ...list('19.5.2', [
    'Annual policy refreshers',
    'Significant amendments or revisions to documents',
    'Audit findings or compliance gaps',
    'Incident trends or repeated non-compliance',
    'Regulatory or accreditation requirements',
    'Introduction of new systems or workflows',
  ]),
  { n: '19.5.3', text: 'Departments may conduct refresher sessions through:' },
  ...list('19.5.3', ['Toolbox talks', 'Department meetings', 'Refresher workshops', 'E-learning modules', 'Competency reassessments']),
  { n: '19.6', text: 'All policy and SOP-related training shall be documented.' },
  { n: '19.6.1', text: 'Departments shall maintain records of:' },
  ...list('19.6.1', ['Training topic', 'Date conducted', 'Trainer/facilitator', 'Attendance', 'Competency verification (where applicable)']),
  { n: '19.7', text: 'HR shall maintain centralized training records for governance and audit purposes.' },

  { h: 20, text: 'Employee Acknowledgement Requirements' },
  { n: '20.1', text: 'Acknowledgement shall be required for:' },
  ...list('20.1', ['Organization-wide Policies', 'Department Policies with employee obligations', 'Clinical Protocols affecting practice']),
  { n: '20.2', text: 'Methods may include:' },
  ...list('20.2', ['Physical signature', 'Digital acknowledgement', 'HRMS confirmation']),
  { n: '20.3', text: 'Failure to sign shall not exempt compliance once communicated.' },

  { h: 21, text: 'Monitoring & Compliance' },
  { n: '21.1', text: 'Department owners shall monitor operational compliance.' },
  { n: '21.2', text: 'HR shall monitor governance compliance.' },
  { n: '21.3', text: 'Monitoring may include:' },
  ...list('21.3', ['Audits', 'Spot checks', 'Incident reviews', 'Department reviews', 'Performance reviews']),
  { n: '21.4', text: 'Non-compliance may result in corrective or disciplinary action.' },

  { h: 22, text: 'Review Frequency' },
  { n: '22.1', text: 'Document types should follow a review frequency of the following:' },
  {
    under: '22.1',
    table: {
      widths: [1.5, 1.5],
      header: ['Document Type', 'Review Frequency'],
      rows: [
        ['Organization-wide Policy', 'Every 2 years'],
        ['Department Policy', 'Every 2 years'],
        ['SOP', 'Annual'],
        ['Clinical Protocol', 'Annual or regulatory requirement'],
        ['Guideline', 'As needed'],
        ['Controlled Form', 'As needed'],
      ],
    },
  },
  { n: '22.2', text: 'HR shall issue review reminders.' },

  { h: 23, text: 'Amendment Process' },
  { n: '23.1', text: 'All amendments shall:' },
  ...list('23.1', ['Follow same approval process', 'Receive new version number', 'Include summary of changes', 'Replace prior version']),
  { n: '23.2', text: 'Major changes may require new rollout and training.' },

  { h: 24, text: 'Emergency / Temporary Directives' },
  { n: '24.1', text: 'Management may issue immediate directives during:' },
  ...list('24.1', ['Patient safety concerns', 'Regulatory changes', 'Emergencies', 'Public health risks', 'Operational crises']),
  { n: '24.2', text: 'Management Directives are temporary controlled documents issued to address urgent matters that may require immediate implementation before formal policy amendment or SOP revision.' },
  { n: '24.3', text: 'The hospital shall maintain three levels of management directives:' },
  {
    under: '24.3',
    table: {
      widths: [1.1, 1.0, 1.6, 1.6],
      header: ['Directive Type', 'Prefix', 'Purpose', 'Example'],
      rows: [
        ['Corporate Directive', 'COR-DIR', 'Organization-wide instructions affecting multiple departments or the entire hospital', 'Emergency operational changes, governance requirements'],
        ['Department Directive', '[Department Prefix]-DIR', 'Department-specific temporary operational instruction', 'HR attendance directive, IT system downtime instruction'],
        ['Clinical Directive', 'CLN-DIR', 'Urgent clinical or patient-care instruction', 'Temporary infection control measure'],
      ],
    },
  },
  { n: '24.4', text: 'All directives shall include:' },
  ...list('24.4', [
    'Directive Title',
    'Document ID',
    'Effective Date',
    'Review or Expiry Date (or Until Further Notice)',
    'Issued By',
    'Applicable Department(s)',
    'Purpose of Directive',
    'Details of Instruction',
    'Existing Policies / SOPs Impacted (if applicable)',
    'Required Approval Signatures',
  ]),
  { n: '24.5', label: 'Approval of Directives', text: [], keepNext: true },
  {
    under: '24.5',
    table: {
      widths: [1.2, 2.4],
      header: ['Directive Type', 'Approval Authority'],
      rows: [
        ['Corporate Directive', 'Managing Director (MD) and/or CEO / Chairman'],
        ['Department Directive', 'Relevant Director / HOD and Managing Director (MD), where required'],
        ['Clinical Directive', 'Chief Medical Officer (CMO)'],
      ],
    },
  },
  { n: '24.6', text: 'Directives may be implemented immediately where urgency exists.' },
  { n: '24.7', text: 'Where a directive remains operational for an extended period, Management may require formal conversion into a Policy, SOP, Clinical Protocol, or Guideline.' },

  { h: 25, text: 'Archiving & Obsolete Documents' },
  { n: '25.1', text: 'HR shall archive outdated documents.' },
  { n: '25.2', text: 'Archived documents shall:' },
  ...list('25.2', ['Be marked “OBSOLETE”', 'Be removed from circulation', 'Remain retained for audit purposes']),
  { n: '25.3', text: 'Only latest approved versions are valid.' },

  { h: 26, text: 'Supporting Forms & Templates' },
  { n: '26.1', text: 'The following forms shall support this SOP:' },
  ...list('26.1', [
    'Policy Approval Form',
    'Amendment Request Form',
    'Rollout Checklist',
    'Employee Acknowledgement Form',
    'Training Attendance Sheet',
    'Policy Register',
    'Version Control Tracker',
  ]),

  { h: 27, text: 'Governance Exceptions' },
  { n: '27.1', text: 'Exceptions to this SOP require written approval from Executive Management.' },

  { h: 28, text: 'Format' },
  ...list('28', [
    'Headings: Host Grotesk, 10 pt, bold',
    'Body text font and size: Host Grotesk, 10 pt',
    'Line spacing: single (1.0)',
    'Paragraph spacing: 0 pt before paragraph, 8 pt after paragraph',
    'Numbering: All documents should follow a tiered numbering protocol.',
  ]),

  { h: 29, text: 'Referencing' },
  { n: '29.1', text: 'List external documents, guidelines, or standards referenced in the document if any. Refer to Appendix 2 for guidance on referencing.' },

  { h: 30, text: 'Appendices' },
  { n: '30.1', text: 'Include any additional information including forms, diagrams, flow charts etc, that are deemed necessary and required a part of the document as appendices.' },

  // Appendix 1: department prefixes, two code/department pairs per row as in the original.
  { appendix: 'APPENDIX 1: DEPARTMENT PREFIXES (CLAUSE 8)' },
  (() => {
    const half = Math.ceil(DEPARTMENTS.length / 2);
    const rows = [];
    for (let i = 0; i < half; i++) {
      const a = DEPARTMENTS[i];
      const b = DEPARTMENTS[i + half];
      rows.push([a.code, a.name, b ? b.code : '', b ? b.name : '']);
    }
    return { table: { widths: [0.6, 2.4, 0.6, 2.4], header: ['Code', 'Department', 'Code', 'Department'], rows } };
  })(),

  // Appendix 2: APA referencing guide.
  { appendix: 'APPENDIX 2: REFERENCES (CLAUSE 29)' },
  { p: 'APA Referencing System Guide', bold: true },
  { p: '1.  Introduction to APA Style:', bold: true, after: 60 },
  { bullets: ['The American Psychological Association (APA) style is commonly used in the social sciences, education, and other fields to cite sources and format academic papers.'] },
  { p: '2.  Basic APA Format:', bold: true, after: 60 },
  { bullets: [
    'In-text citations: Include the author’s last name and the publication year in parentheses when referring to a source in the text (e.g., Smith, 2020).',
    'Reference list: Alphabetically list all sources cited in the paper at the end under the heading “References.”',
  ] },
  { p: '3.  Examples of APA Referencing:', bold: true, after: 60 },
  { p: 'Book:', bold: true, indent: 720, after: 60 },
  { bullets: ['Last name, Initial(s). (Year). Title of book. Publisher.', 'Example: Smith, J. D. (2020). The Art of Writing. Penguin Books.'], indent: 1080 },
  { p: 'Journal Article:', bold: true, indent: 720, after: 60 },
  { bullets: ['Last name, Initial(s). (Year). Title of article. Title of Journal, Volume(Issue), Page range.', 'Example: Johnson, R. L. (2019). The Impact of Technology on Education. Journal of Educational Technology, 15(2), 120-135.'], indent: 1080 },
  { p: 'Website:', bold: true, indent: 720, after: 60 },
  { bullets: ['Author or Organization. (Year). Title of webpage. Website Name. URL', 'Example: World Health Organization. (2021). COVID-19 Dashboard. World Health Organization. https://www.who.int/covid19/dashboard'], indent: 1080 },
  { p: 'Newspaper Article:', bold: true, indent: 720, after: 60 },
  { bullets: ['Author. (Year, Month Day). Title of article. Name of Newspaper, Page number(s).', 'Example: Brown, M. (2023, January 15). Climate Change and Global Policy. New York Times, A1.'], indent: 1080 },
  { p: 'In-Text Citation:', bold: true, indent: 720, after: 60 },
  { bullets: ['When citing a source within the text, use the author-date format (e.g., Johnson, 2019).'], indent: 1080 },
  { p: 'Reference List:', bold: true, indent: 720, after: 60 },
  { bullets: ['Arrange entries in alphabetical order by the author’s last name.', 'Include all necessary information for each source, following the appropriate format.'], indent: 1080 },
];

// ======================================================================
// Document control and approvals
// ======================================================================
const common = {
  status: 'final',
  deptCode: 'COR',
  deptName: 'Hospital Management',
  version: 1,
  supersedes: 'Nil',
  effectiveDate: '01 June 2026',
  preparedBy: 'Manal Ahmed Nashid (Director)',
  appliesTo: 'All Departments',
  confidentiality: 'Internal Use',
  // Both documents are enterprise-wide governance documents (COR-SOP-001 clause 14.3.2),
  // so final approval rests with the Board of Directors and/or CEO / Chairman.
  endorsements: [
    { stage: 'Prepared by', name: 'Manal Ahmed Nashid', designation: 'Director' },
    { stage: 'Reviewed by (Managing Director)', name: 'Ahmed Afaal', designation: 'Managing Director' },
    { stage: 'Final approval (Board of Directors and/or CEO / Chairman)', name: 'Ahmed Nashid', designation: 'CEO / Chairman' },
    { stage: 'Issued by (HR – document custodian)', name: '', designation: 'Human Resources' },
  ],
};

const revision = (summary) => [{ version: 'V1', date: '04 May 2026', clauses: 'All', summary, approvedBy: '' }];

const DOCS = [
  {
    file: 'COR-POL-001-V1 Document Governance Policy.docx',
    type: resolveType('ORG_POLICY'),
    meta: {
      ...common,
      title: 'Document Governance Policy',
      docId: 'COR-POL-001-V1',
      reviewDate: '01 June 2028',
      revisions: revision('New document. Formatted to the ADK master template; clause numbering and spelling corrected.'),
    },
    blocks: policyBlocks,
  },
  {
    file: 'COR-SOP-001-V1 Document Governance SOP.docx',
    type: resolveType('SOP'),
    meta: {
      ...common,
      title: 'Document Governance SOP',
      docId: 'COR-SOP-001-V1',
      reviewDate: '01 June 2027',
      parentPolicy: 'COR-POL-001-V1 Document Governance Policy',
      revisions: revision('New document. Formatted to the ADK master template; document ID, prefixes, clause numbering and spelling corrected.'),
    },
    blocks: sopBlocks,
  },
];

if (require.main === module) {
  (async () => {
    for (const d of DOCS) {
      fs.writeFileSync(path.join(out, d.file), await buildDocx(d.type, d.meta, { blocks: d.blocks }));
      console.log('written', d.file);
    }
  })();
}

module.exports = { DOCS };
