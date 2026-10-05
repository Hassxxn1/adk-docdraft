// Supabase Edge Function: draft
// Verifies the signed-in user, calls Claude to draft the document content, records the draft
// (audit trail + history) and returns the structured content. The browser builds the Word file.
//
// Secrets (Supabase → Edge Functions → Secrets, or `supabase secrets set`):
//   ANTHROPIC_API_KEY      optional; without it the author's text is laid into the template unchanged
//   CLAUDE_MODEL           optional; default claude-sonnet-5-5
//   DRAFTS_PER_HOUR        optional; default 15
//   ALLOWED_EMAIL_DOMAIN   optional; e.g. adkhospital.com
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
import { createClient } from 'npm:@supabase/supabase-js@2';

const MODEL = Deno.env.get('CLAUDE_MODEL') || 'claude-sonnet-5-5';
const LIMIT_PER_HOUR = Number(Deno.env.get('DRAFTS_PER_HOUR') || 15);
const ALLOWED_DOMAIN = (Deno.env.get('ALLOWED_EMAIL_DOMAIN') || '').toLowerCase().trim();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ---------- Drafting rules (approved as part of the Document Governance Policy V2) ----------
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

Content
- A policy states requirements (what and why). An SOP or protocol states steps (how). Do not mix them.
- Each policy statement is one auditable "shall" requirement.
- Each procedure step is one action, starts with a verb, and names the role that performs it.
  Show decisions as "If ..., then ...".
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

Return your draft only by calling the submit_draft tool.`;


const listOfStrings = { type: 'array', items: { type: 'string' } };

const DRAFT_TOOL = {
  name: 'submit_draft',
  description: 'Submit the drafted document content in the ADK master template structure.',
  input_schema: {
    type: 'object',
    properties: {
      purpose: { type: 'string', description: 'One or two sentences.' },
      scope: { type: 'string', description: 'Who and what is covered, and exclusions.' },
      definitions: {
        type: 'array',
        items: {
          type: 'object',
          properties: { term: { type: 'string' }, definition: { type: 'string' } },
          required: ['term', 'definition'],
        },
        description: 'Alphabetical order.',
      },
      policyStatements: { ...listOfStrings, description: 'Policies only: one "shall" statement each. Empty for SOPs.' },
      roles: {
        type: 'array',
        items: {
          type: 'object',
          properties: { role: { type: 'string' }, responsibilities: listOfStrings },
          required: ['role', 'responsibilities'],
        },
      },
      prerequisites: { ...listOfStrings, description: 'SOPs only. Empty for policies.' },
      procedure: {
        type: 'array',
        description: 'SOPs only, grouped into stages. Empty for policies.',
        items: {
          type: 'object',
          properties: {
            stage: { type: 'string' },
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: { actor: { type: 'string' }, action: { type: 'string' } },
                required: ['actor', 'action'],
              },
            },
          },
          required: ['stage', 'steps'],
        },
      },
      records: {
        type: 'array',
        description: 'SOPs only.',
        items: {
          type: 'object',
          properties: { record: { type: 'string' }, keptBy: { type: 'string' }, retention: { type: 'string' } },
          required: ['record', 'keptBy', 'retention'],
        },
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


// deno-lint-ignore no-explicit-any
type Any = any;

function intakeToPrompt(intake: Any, type: Any) {
  const f = (label: string, v: unknown) => (v && String(v).trim() ? `${label}:\n${String(v).trim()}\n` : `${label}: (not provided)\n`);
  let s = `Draft a ${type.label} (classification Level ${type.level}) using the information below.\n\n`;
  s += f('Title', intake.title);
  s += f('Owning department', intake.deptName);
  s += f('Applies to', intake.appliesTo);
  s += f('Clinical impact', intake.clinicalImpact);
  if (type.template === 'sop') s += f('Parent policy', intake.parentPolicy);
  s += f('Purpose (author notes)', intake.purpose);
  s += f('Scope (author notes)', intake.scope);
  s += f('Definitions (author notes)', intake.definitions);
  if (type.template === 'policy') {
    s += f('Policy requirements (author notes)', intake.statements);
  } else {
    s += f('Prerequisites (author notes)', intake.prerequisites);
    s += f('Procedure steps (author notes)', intake.procedure);
    s += f('Records (author notes)', intake.records);
  }
  s += f('Roles and responsibilities (author notes)', intake.roles);
  s += f('Monitoring and compliance (author notes)', intake.monitoring);
  s += f('Training and implementation (author notes)', intake.training);
  s += f('Related ADK documents', intake.related);
  s += f('References (laws, regulations, standards)', intake.references);
  s += f('Other notes from the author', intake.notes);
  s += `\nStandard rollout for this document type: ${type.rollout}.\n`;
  return s;
}

async function draftWithAI(intake: Any, type: Any) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 12000,
      system: DRAFTING_RULES,
      tools: [DRAFT_TOOL],
      tool_choice: { type: 'tool', name: 'submit_draft' },
      messages: [{ role: 'user', content: intakeToPrompt(intake, type) }],
    }),
    signal: AbortSignal.timeout(140_000),
  });
  if (!r.ok) throw new Error(`AI service error ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const msg = await r.json();
  const block = (msg.content || []).find((b: Any) => b.type === 'tool_use');
  if (!block) throw new Error('The AI service did not return a draft.');
  return normalise(block.input);
}

// Fallback when no API key is configured: lays the author's own text into the template unchanged.
function lines(v: unknown) {
  return String(v || '')
    .split(/\r?\n/)
    .map((x) => x.replace(/^\s*([-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
}

function draftWithoutAI(intake: Any) {
  const pair = (l: string, key: string, val: string) => {
    const i = l.indexOf(':');
    return i > 0 ? { [key]: l.slice(0, i).trim(), [val]: l.slice(i + 1).trim() } : { [key]: l, [val]: '[Author to confirm]' };
  };
  return normalise({
    purpose: intake.purpose || '[Author to confirm]',
    scope: intake.scope || '[Author to confirm]',
    definitions: lines(intake.definitions).map((l) => pair(l, 'term', 'definition')),
    policyStatements: lines(intake.statements),
    roles: lines(intake.roles).map((l) => {
      const x = pair(l, 'role', 'r');
      return { role: x.role, responsibilities: [x.r] };
    }),
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

function normalise(d: Any) {
  const arr = (x: unknown) => (Array.isArray(x) ? x : []);
  return {
    purpose: d.purpose || '',
    scope: d.scope || '',
    definitions: arr(d.definitions).sort((a: Any, b: Any) => String(a.term).localeCompare(String(b.term))),
    policyStatements: arr(d.policyStatements),
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

const clean = (v: unknown, max = 8000) => String(v ?? '').slice(0, max).trim();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  // ---- Who is calling? ----
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SERVICE_KEY) return json({ error: 'Server set-up incomplete: SUPABASE_SERVICE_ROLE_KEY is not available.' }, 500);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY, { auth: { persistSession: false } });
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: { user } } = token ? await db.auth.getUser(token) : { data: { user: null } };
  if (!user) return json({ error: 'Your session has ended. Please sign in again.' }, 401);
  const email = (user.email || '').toLowerCase();
  if (ALLOWED_DOMAIN && !email.endsWith('@' + ALLOWED_DOMAIN)) return json({ error: 'Access is limited to ADK Hospital staff accounts.' }, 403);
  const userName = user.user_metadata?.full_name || email.split('@')[0];

  // ---- Validate the form ----
  const b = await req.json().catch(() => ({}));
  const { data: t } = await db.from('doc_types').select('*').eq('key', b.docType).eq('active', true).maybeSingle();
  if (!t) return json({ error: 'Choose a document type.' }, 400);
  const type = {
    label: t.label, level: t.level, prefix: t.prefix, colour: t.colour, template: t.template,
    reviewYears: t.review_years, reviewText: t.review_text, reviewers: t.reviewers,
    finalApproval: t.final_approval, rollout: t.rollout, forceDept: t.force_dept, clinical: t.clinical,
  };
  const deptCode = type.forceDept || clean(b.deptCode, 10);
  const { data: dept } = await db.from('departments').select('*').eq('code', deptCode).eq('active', true).maybeSingle();
  if (!dept) return json({ error: 'Choose the owning department.' }, 400);
  const title = clean(b.title, 200);
  if (!title) return json({ error: 'Enter a document title.' }, 400);
  const required = type.template === 'policy' ? ['purpose', 'statements'] : ['purpose', 'procedure'];
  for (const k of required) if (!clean(b[k])) return json({ error: `Complete the ${k === 'statements' ? 'policy requirements' : k} field.` }, 400);

  // ---- Per-user hourly limit (cost control) ----
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from('drafts').select('id', { count: 'exact', head: true }).eq('user_id', user.id).neq('source', 'blank').gte('created_at', since);
  if ((count || 0) >= LIMIT_PER_HOUR) return json({ error: `Limit of ${LIMIT_PER_HOUR} drafts per hour reached. Please try again later.` }, 429);

  const clinicalImpact = type.clinical ? 'Yes' : (b.clinicalImpact === 'Yes' ? 'Yes' : 'No');
  const intake = {
    title, deptName: dept.name, appliesTo: clean(b.appliesTo, 500), clinicalImpact,
    parentPolicy: clean(b.parentPolicy, 200),
    purpose: clean(b.purpose), scope: clean(b.scope), definitions: clean(b.definitions),
    statements: clean(b.statements, 15000), prerequisites: clean(b.prerequisites),
    procedure: clean(b.procedure, 15000), records: clean(b.records),
    roles: clean(b.roles), monitoring: clean(b.monitoring), training: clean(b.training),
    related: clean(b.related), references: clean(b.references), notes: clean(b.notes),
  };
  const ai = !!Deno.env.get('ANTHROPIC_API_KEY');
  const meta = {
    title, deptCode, deptName: dept.name, owner: clean(b.owner, 200), appliesTo: intake.appliesTo,
    supersedes: clean(b.supersedes, 200), parentPolicy: intake.parentPolicy, clinicalImpact,
    draftedBy: userName, ai,
  };
  const base = { source: ai ? 'ai' : 'template', user_id: user.id, user_email: email, user_name: userName, doc_type: b.docType, dept_code: deptCode, title, ai, meta };

  try {
    const content = ai ? await draftWithAI(intake, type) : draftWithoutAI(intake);
    const { data: row, error } = await db.from('drafts')
      .insert({ ...base, status: 'ok', flags: content.authorFlags.length, content })
      .select('id, created_at').single();
    if (error) throw error;
    return json({ id: row.id, type, meta: { ...meta, draftedAt: row.created_at }, content });
  } catch (e) {
    console.error(e);
    await db.from('drafts').insert({ ...base, status: 'failed', error: String((e as Error).message).slice(0, 300) });
    return json({ error: 'The draft could not be generated. Please try again in a minute.' }, 502);
  }
});
