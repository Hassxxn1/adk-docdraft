// AI drafting: turns the intake form into structured document content using Claude.
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';

const DRAFTING_RULES = `You draft controlled documents for ADK Hospital, Malé, Maldives, under the hospital's
Document Governance Policy (COR-POL-001) and SOP (COR-SOP-001). The owning department is the author and is
accountable for content. You are a drafting assistant only.

Language and style
- British English, plain language, sentences under 25 words.
- "shall" for mandatory requirements, "should" for recommended practice, "may" for permitted options.
  Never use "must" or "will" in requirements.
- Refer to roles, never to named individuals, in the body.
- Dates as DD Month YYYY; times in 24-hour format.
- Do not number items yourself; the document generator applies tiered numbering.

Content by document type
- Policy (Levels 1–2): requirements (what and why). Each policy statement is one auditable "shall" requirement.
- SOP and Clinical Protocol (Level 3): steps (how). Each step is one action, starts with a verb, and names the
  role that performs it. Show decisions as "If ..., then ...".
- Guideline (Level 4): recommended good practice using "should" and "may". Guidelines do not create mandatory
  requirements; if the author's notes contain a mandatory rule, keep the wording advisory and add an authorFlags
  entry suggesting it belongs in a policy or SOP.
- Controlled Form, Template, Checklist or Register (Level 5): when the form is used, how to complete it, and the
  fields it contains, grouped into sections, each with clear completion guidance.
- Management Directive (Level 6): a temporary, urgent instruction. State the reason, then the instructions as
  "shall" statements effective from the stated date. A directive must carry an expiry or review date and say
  whether it will be converted into a policy, SOP, protocol or guideline.
- Do not mix types.
- Keep roles separate: the owning department authors and endorses; HR is custodian only
  (numbering, issue, register, archive) and never owns technical content unless the document is an HR document.
- Never include patient-identifiable information.

Accuracy (critical)
- Use only the facts the author supplied. Improve wording, structure and completeness of expression,
  but do not add new requirements, numbers, time limits, dosages, clinical values or obligations.
- Where a necessary detail is missing, write "[Author to confirm: <what is needed>]" in place and add an authorFlags entry.
- Cite only references the author supplied. Never invent laws, regulation numbers, standards or document IDs.
  If a likely reference is missing, add an authorFlags entry suggesting the author check it.
- Flag anything that looks inconsistent, unsafe, or that may conflict with a higher-level document.
- Fill only the fields that apply to the document type; leave the others as empty arrays or empty strings.

Return your draft only by calling the submit_draft tool.`;

const listOfStrings = { type: 'array', items: { type: 'string' } };

const DRAFT_TOOL = {
  name: 'submit_draft',
  description: 'Submit the drafted document content in the ADK master template structure.',
  input_schema: {
    type: 'object',
    properties: {
      purpose: { type: 'string', description: 'One or two sentences.' },
      scope: { type: 'string', description: 'Who and what is covered, and exclusions. For forms: when the form is used.' },
      definitions: {
        type: 'array',
        items: { type: 'object', properties: { term: { type: 'string' }, definition: { type: 'string' } }, required: ['term', 'definition'] },
        description: 'Alphabetical order.',
      },
      policyStatements: { ...listOfStrings, description: 'Policies only: one "shall" statement each.' },
      guidance: {
        type: 'array',
        description: 'Guidelines only: recommendations grouped by topic.',
        items: { type: 'object', properties: { topic: { type: 'string' }, recommendations: listOfStrings }, required: ['topic', 'recommendations'] },
      },
      background: { type: 'string', description: 'Directives only: the reason the directive is needed now.' },
      directiveInstructions: { ...listOfStrings, description: 'Directives only: one "shall" instruction each.' },
      conversion: { type: 'string', description: 'Directives only: whether and how the directive will become a formal document.' },
      completionInstructions: { ...listOfStrings, description: 'Forms only: how to complete, sign and submit the form.' },
      formSections: {
        type: 'array',
        description: 'Forms only: the fields of the form grouped into sections.',
        items: {
          type: 'object',
          properties: {
            section: { type: 'string' },
            fields: {
              type: 'array',
              items: {
                type: 'object',
                properties: { field: { type: 'string' }, guidance: { type: 'string' }, mandatory: { type: 'boolean' } },
                required: ['field', 'guidance', 'mandatory'],
              },
            },
          },
          required: ['section', 'fields'],
        },
      },
      roles: {
        type: 'array',
        items: { type: 'object', properties: { role: { type: 'string' }, responsibilities: listOfStrings }, required: ['role', 'responsibilities'] },
      },
      prerequisites: { ...listOfStrings, description: 'SOPs and protocols only.' },
      procedure: {
        type: 'array',
        description: 'SOPs and protocols only, grouped into stages.',
        items: {
          type: 'object',
          properties: {
            stage: { type: 'string' },
            steps: { type: 'array', items: { type: 'object', properties: { actor: { type: 'string' }, action: { type: 'string' } }, required: ['actor', 'action'] } },
          },
          required: ['stage', 'steps'],
        },
      },
      records: {
        type: 'array',
        description: 'SOPs, protocols and forms.',
        items: { type: 'object', properties: { record: { type: 'string' }, keptBy: { type: 'string' }, retention: { type: 'string' } }, required: ['record', 'keptBy', 'retention'] },
      },
      monitoring: listOfStrings,
      training: { ...listOfStrings, description: 'Implementation, communication and training requirements.' },
      related: listOfStrings,
      references: listOfStrings,
      authorFlags: { ...listOfStrings, description: 'Gaps, assumptions, conflicts and items the author must verify.' },
    },
    required: ['purpose', 'scope', 'definitions', 'roles', 'monitoring', 'training', 'related', 'references', 'authorFlags'],
  },
};

const FIELDS_BY_TEMPLATE = {
  policy: [['statements', 'Policy requirements']],
  sop: [['prerequisites', 'Prerequisites'], ['procedure', 'Procedure steps'], ['records', 'Records']],
  guideline: [['guidance', 'Recommended practice']],
  form: [['formFields', 'Form fields'], ['completion', 'How to complete and submit'], ['records', 'Where completed forms are kept and for how long']],
  directive: [['background', 'Reason for the directive'], ['instructions', 'Instructions'], ['effectiveFrom', 'Effective from'], ['expiry', 'Expiry or review date'], ['conversion', 'Conversion to a formal document']],
};

function intakeToPrompt(intake, type) {
  const f = (label, v) => (v && String(v).trim() ? `${label}:\n${String(v).trim()}\n` : `${label}: (not provided)\n`);
  let s = `Draft a ${type.variantName ? `${type.label} – ${type.variantName}` : type.label} (classification Level ${type.level}) using the information below.\n\n`;
  s += f('Title', intake.title);
  s += f('Owning department', intake.deptName);
  s += f('Applies to', intake.appliesTo);
  s += f('Clinical impact', intake.clinicalImpact);
  if (type.template === 'sop') s += f('Parent policy', intake.parentPolicy);
  s += f('Purpose (author notes)', intake.purpose);
  s += f(type.template === 'form' ? 'When the form is used (author notes)' : 'Scope (author notes)', intake.scope);
  s += f('Definitions (author notes)', intake.definitions);
  for (const [k, label] of FIELDS_BY_TEMPLATE[type.template]) s += f(`${label} (author notes)`, intake[k]);
  s += f('Roles and responsibilities (author notes)', intake.roles);
  s += f('Monitoring and compliance (author notes)', intake.monitoring);
  s += f('Training and implementation (author notes)', intake.training);
  s += f('Related ADK documents', intake.related);
  s += f('References (laws, regulations, standards)', intake.references);
  s += f('Other notes from the author', intake.notes);
  s += `\nStandard rollout for this document type: ${type.rollout}.\n`;
  return s;
}

async function draftWithAI(intake, type) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 12000,
    system: DRAFTING_RULES,
    tools: [DRAFT_TOOL],
    tool_choice: { type: 'tool', name: 'submit_draft' },
    messages: [{ role: 'user', content: intakeToPrompt(intake, type) }],
  });
  const block = msg.content.find((b) => b.type === 'tool_use');
  if (!block) throw new Error('The AI service did not return a draft. Please try again.');
  return normalise(block.input);
}

// Fallback when no API key is configured: lays the author's own text into the template unchanged.
function lines(v) {
  return String(v || '')
    .split(/\r?\n/)
    .map((x) => x.replace(/^\s*([-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
}

function pairs(v, fallback = '[Author to confirm]') {
  return lines(v).map((l) => {
    const i = l.indexOf(':');
    return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : [l, fallback];
  });
}

function draftWithoutAI(intake, type) {
  // Form fields: a line ending in ":" starts a section; "Field: guidance" lines are fields.
  const formSections = [];
  for (const l of lines(intake.formFields)) {
    if (l.endsWith(':')) { formSections.push({ section: l.slice(0, -1).trim(), fields: [] }); continue; }
    if (!formSections.length) formSections.push({ section: 'Details', fields: [] });
    const i = l.indexOf(':');
    formSections[formSections.length - 1].fields.push(i > 0
      ? { field: l.slice(0, i).trim(), guidance: l.slice(i + 1).trim(), mandatory: true }
      : { field: l, guidance: 'Complete as applicable.', mandatory: true });
  }
  return normalise({
    purpose: intake.purpose || '[Author to confirm]',
    scope: intake.scope || '[Author to confirm]',
    definitions: pairs(intake.definitions).map(([term, definition]) => ({ term, definition })),
    policyStatements: lines(intake.statements),
    guidance: lines(intake.guidance).length ? [{ topic: 'Recommended practice', recommendations: lines(intake.guidance) }] : [],
    background: intake.background || '',
    directiveInstructions: lines(intake.instructions),
    conversion: intake.conversion || '',
    completionInstructions: lines(intake.completion),
    formSections: formSections.filter((x) => x.fields.length),
    roles: pairs(intake.roles).map(([role, r]) => ({ role, responsibilities: [r] })),
    prerequisites: lines(intake.prerequisites),
    procedure: lines(intake.procedure).length
      ? [{ stage: 'Procedure', steps: lines(intake.procedure).map((a) => ({ actor: '', action: a })) }]
      : [],
    records: lines(intake.records).map((r) => ({ record: r, keptBy: '[Author to confirm]', retention: '[Author to confirm]' })),
    monitoring: lines(intake.monitoring),
    training: lines(intake.training),
    related: lines(intake.related),
    references: lines(intake.references),
    authorFlags: ['AI drafting is not configured on this server. This draft contains your text as entered, laid into the master template.'],
  });
}

function normalise(d) {
  const arr = (x) => (Array.isArray(x) ? x : []);
  return {
    purpose: d.purpose || '',
    scope: d.scope || '',
    definitions: arr(d.definitions).sort((a, b) => String(a.term).localeCompare(String(b.term))),
    policyStatements: arr(d.policyStatements),
    guidance: arr(d.guidance),
    background: d.background || '',
    directiveInstructions: arr(d.directiveInstructions),
    conversion: d.conversion || '',
    completionInstructions: arr(d.completionInstructions),
    formSections: arr(d.formSections),
    roles: arr(d.roles),
    prerequisites: arr(d.prerequisites),
    procedure: arr(d.procedure),
    records: arr(d.records),
    monitoring: arr(d.monitoring),
    training: arr(d.training),
    related: arr(d.related),
    references: arr(d.references),
    authorFlags: arr(d.authorFlags),
  };
}

async function draft(intake, type) {
  if (process.env.ANTHROPIC_API_KEY) return { content: await draftWithAI(intake, type), ai: true };
  return { content: draftWithoutAI(intake, type), ai: false };
}

module.exports = { draft, intakeToPrompt, DRAFTING_RULES, FIELDS_BY_TEMPLATE };
