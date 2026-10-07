# ADK Policy and SOP Drafting Portal — Prototype (Supabase + GitHub + Netlify)

Demo version of the drafting portal. Staff sign in, complete the structured form, and download a draft
policy or SOP as a Word document in the ADK Master Template (letterhead, level colour band, document control,
endorsement and revision history tables, tiered clause numbering, drafting-notes box, highlighted
`[Author to confirm]` items).

| Part | Where it runs |
| --- | --- |
| Web pages (form, My drafts, All drafts) | Netlify — static site, no build step |
| Sign-in | Supabase Auth (email + password; accounts created by the admin) |
| Departments and document types | Supabase tables `departments`, `doc_types` (replaces `lib/config.js`) |
| AI drafting | Supabase Edge Function `draft` → Claude API (same `DRAFTING_RULES` as the Azure version) |
| Word file | Built in the browser with the same layout code (`docgen.js`) |
| Audit trail + history | Supabase table `drafts` (who, when, type, department, title, AI on/off, flags) |

Why the Edge Function and not a Netlify Function: a Claude draft can take 30–60 seconds, which is longer than
a standard Netlify Function is allowed to run. Supabase Edge Functions allow 150 seconds.

## Template editor

Every draft opens in a template editor that looks like the Word file: letterhead, level colour band,
document control, endorsement and revision tables, drafting-notes box and numbered clauses.

- **Draft with AI** sends the form to Claude, then opens the result in the editor.
- **Open in template editor** opens the template straight away (no AI). Anything typed in the form is placed in it.
- Click any text to edit. **Enter** adds the next clause, **Backspace** on an empty clause removes it,
  ↑ ↓ × buttons appear on hover. Numbering, fonts and tables are fixed, so the template cannot be broken.
- Yellow `[Author to confirm]` items: click to replace; **Next item** jumps through them.
- Changes save automatically (also Ctrl/Cmd+S). **My drafts → Open** reopens a draft; admins can open anyone's draft read-only.
- **Download Word** builds the .docx from the edited content. On screen the layout is very close to Word,
  but page breaks are decided by Word.

## Files

```
index.html  app.js  editor.js  docgen.js  config.js  styles.css  netlify.toml
assets/logo.png  assets/letterhead.png
vendor/supabase-js-2.117.2.js  vendor/docx-9.8.1.js      (libraries bundled, no CDN)
supabase/schema.sql                                      (tables, seed data, RLS)
supabase/upgrades/002_template_editor.sql                (only if you ran the first schema.sql already)
supabase/functions/draft/index.ts                        (AI drafting + audit)
```

## Set-up (about 30 minutes)

### 1. Supabase
1. Create a new project (or reuse one), e.g. `adk-docdraft`.
2. **SQL Editor** → paste `supabase/schema.sql` → Run. (Already ran the earlier version? Run `supabase/upgrades/002_template_editor.sql` instead.)
3. **Authentication → Sign In / Providers → Email**: turn **off** "Allow new users to sign up".
4. **Authentication → Users → Add user** for each demo user (tick *Auto confirm*).
5. Set names and your admin role (SQL Editor, change the emails):
   ```sql
   update auth.users set raw_user_meta_data = raw_user_meta_data || '{"full_name":"Ahmed Hassaan"}' where email = 'hassaan@adkhospital.com';
   update auth.users set raw_app_meta_data  = raw_app_meta_data  || '{"role":"admin"}'           where email = 'hassaan@adkhospital.com';
   ```
6. **Project Settings → API**: copy the Project URL and the `anon` public key into `config.js`.

### 2. Edge Function
With the Supabase CLI, in the project folder:
```
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy draft
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... ALLOWED_EMAIL_DOMAIN=adkhospital.com
```
Optional secrets: `CLAUDE_MODEL` (default `claude-sonnet-5-5`), `DRAFTS_PER_HOUR` (default 15).

Without `ANTHROPIC_API_KEY` the portal still works: it lays the author's text into the template unchanged.
That is a good way to demo the template before the API key is approved.

### 3. GitHub
```
git init && git add . && git commit -m "Drafting portal prototype"
git branch -M main
git remote add origin https://github.com/Hassxxn1/adk-docdraft.git
git push -u origin main
```
Make the repository **private**.

### 4. Netlify
**Add new site → Import from GitHub** → choose the repo. Build command: *empty*. Publish directory: `.`
Every `git push` redeploys.

### 5. Test
1. Open the Netlify URL, sign in, generate one Policy and one SOP, open both in Word.
2. **My drafts**: download an earlier draft again (rebuilt from the saved content, no second AI call).
3. As admin, **All drafts (audit)** shows everyone's drafts. A non-admin user sees only their own.

## Changing things

| To change | Where |
| --- | --- |
| Departments, codes, colours, review cycles, approvers, rollout | Supabase tables `departments`, `doc_types` (no redeploy) |
| AI drafting rules | `supabase/functions/draft/index.ts` → `DRAFTING_RULES`, then `supabase functions deploy draft` |
| Word layout, letterhead | `docgen.js`, `assets/letterhead.png`, then `git push` |
| Form fields and help text | `index.html` (+ `app.js` and the Edge Function if a new field is sent to the AI) |

## Differences from the Azure version (decide before production)

- **Sign-in** is Supabase email/password, not Microsoft 365. Supabase also supports Microsoft (Azure) sign-in,
  so the production version can switch to ADK M365 accounts without changing the rest of the app.
- **Draft content is saved** in Supabase (`drafts.content`) so drafts can be reopened and edited. The Azure
  README says draft text is not kept; confirm the saved-drafts approach with IT/legal before real use.
- Authors can edit their own drafts. A database trigger stops the browser from changing the audit fields
  (who drafted it, when, type, department, AI or not).
- The **8-hour session limit** is checked in the browser, based on the time of sign-in.
- Data protection: the form still warns against patient-identifiable information, and the AI rules forbid it.
  Review Anthropic's commercial terms and Supabase data location with IT/legal before real use.

## Run locally
Any static server works, e.g. `npx serve .` → http://localhost:3000 (uses the live Supabase project in `config.js`).
