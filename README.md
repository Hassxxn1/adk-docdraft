# ADK Hospital Document Portal

A web portal that runs the hospital's document governance process (COR-POL-001 and COR-SOP-001) from first draft to issued controlled copy. Every person signs in with their own account, created by the portal's Super Admin.

## How a document moves through the portal

```
 Department (author)        Reviewers and approvers         HR (document custodian)
 ───────────────────        ───────────────────────         ───────────────────────
 1. Intake form → AI draft
 2. Edit in the portal,
    resolve highlighted items
 3. Choose each reviewer and
    approver from the user list;
    choose the signing method
 4. Submit  ───────────────▶ 5. Each signatory, in order,
       ◀── return with ─────   reads the preview and
           comments            approves or returns it
       ◀── recall ──────────   (author can recall to change
                                signatories)
                                          │ all approved
                                          ▼
                                                        6. Verify approvals, assign number,
                                                           effective and review dates
                                                           ├─ Electronic: issued at once
                                                           └─ Signed by hand: FINAL copy printed
                                                              with every name and designation
                                                              filled; HR uploads the signed scan
 7. Issued copy in the register. A revision creates version 2 with the same number;
    when version 2 is issued, version 1 becomes OBSOLETE automatically.
```

## Roles

Each user has one or more roles, given by the Super Admin. Every signed-in user is also **Staff**.

| Role | Can do |
| --- | --- |
| **Super Admin** | Create, edit, deactivate and reactivate user accounts; assign roles; reset passwords; manage departments (codes, names, Head of Department); change settings (document types, review cycles, approval matrix); read the administration audit log. Has no document powers unless also given other roles. |
| **HR (document custodian)** | Verify approvals, assign document numbers, issue documents, upload signed copies, make documents obsolete, see every document, export the register |
| **Department Head / Document Controller** | See all of their department's documents, including drafts; withdraw a department draft; start a revision of a department document. The Head of Department named on the Departments screen has the same oversight. |
| **Author** | Draft documents for their own department (organisation-wide and clinical types use their fixed department), edit while in draft, choose signatories, submit, recall, withdraw |
| **Signatory** | Can be chosen as a reviewer or approver; approves or returns documents they are named on, in their turn |
| **Staff** (everyone) | View and download issued documents, except Confidential and Highly Confidential ones, which only those involved, the department's overseers and HR can see |

### Rules the portal enforces

- Only people with their own active account can sign in. Leavers are **deactivated**, never deleted, so their history is kept; they are signed out at once.
- Temporary passwords must be changed at first sign-in. Passwords need 10+ characters with letters and numbers. After 5 wrong attempts an account is locked for 15 minutes.
- Signatories are chosen from users with the Signatory role. Names and designations come from their accounts, so nothing is typed or handwritten except the signature.
- At least two approval signatories, all different people. The author cannot approve their own document (clause 14.1).
- A draft cannot be submitted while any highlighted `[Author to confirm]` item or drafting note remains.
- Only HR assigns numbers. Numbers are unique per department and prefix. A new version keeps its number (clause 15).
- Every page 1 carries all 13 cover-page fields (clause 10), and every file follows the clause 28 format.
- The issued Word file is frozen at issue, so the controlled copy never changes afterwards.
- Every document action is recorded in the document's history. Every change to users, roles, departments and settings, and every failed or refused sign-in, is recorded in the administration audit log.

### What is stored

The database (documents, users, departments, settings, audit logs), the frozen issued Word files and the signed scans are kept in `DATA_DIR`. Back up this folder: it is the master document register. Passwords are stored only as secure one-way hashes.

---

## First-time setup

### 1. Create the first Super Admin

Set these in the host's environment settings, then restart:

| Setting | Value |
| --- | --- |
| `ADMIN_EMAIL` | The Super Admin's e-mail, e.g. `it.manager@adkhospital.com` |
| `ADMIN_NAME` | Their full name |
| `ADMIN_DESIGNATION` | Their designation |
| `ADMIN_PASSWORD` | A temporary password; they must change it at first sign-in |

The account is created only when the portal has no active Super Admin. After the first sign-in, **delete `ADMIN_PASSWORD`** from the settings.

Alternatively, from a shell on the server: `npm run create-admin -- it.manager@adkhospital.com "Full Name" "Designation"`. This prints a temporary password. Use the same command to restore access if every Super Admin is locked out.

### 2. Super Admin: set up the portal

1. **Settings → General:** set the allowed e-mail domain, e.g. `adkhospital.com`.
2. **Departments:** the 51 departments from Appendix 1 are loaded. Name each Head of Department; add, rename or deactivate as needed.
3. **Users:** add each person with e-mail, name, designation, department and roles. The portal shows a temporary password once; give it to the person privately.
4. **Settings → Document types:** check review cycles and approval stages against the approved Policy and SOP.

Suggested first accounts: the HR Director and HR officer (HR), each department's document controller (Department Head / Document Controller, plus Author), the MD, CEO/Chairman, CMO and directors (Signatory), and authors in the pilot departments.

### 3. Load the Document Governance Policy and SOP (optional)

From a shell on the server:

```
npm run import-governance -- manal@adkhospital.com afaal@adkhospital.com nashid@adkhospital.com
```

This loads COR-POL-001-V1 and COR-SOP-001-V1 as **Awaiting signatures**, exactly as printed. When the signed copies are back, HR opens each one, uploads the scan, and they become issued documents.

### Microsoft 365 sign-in (optional)

Staff can also sign in with their Microsoft 365 account if you register the app in Microsoft Entra ID and set `TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET` and `REDIRECT_URI` (see "Entra app registration" below). Microsoft only confirms who the person is: they still need an active portal account with the same e-mail, and the portal account decides their roles.

---

## Where it can be hosted

The portal is a Node.js application with its own database, so it needs a host that **runs a server and keeps files on disk**.

| Host | Suitable | Notes |
| --- | --- | --- |
| Azure App Service | Yes (recommended long term) | Same Microsoft account as ADK's Microsoft 365 |
| Render | Yes | Deploys from the GitHub repository using `render.yaml`. Needs a paid plan for the persistent disk |
| Any server or container platform | Yes | Use the `Dockerfile`; mount a persistent volume at `/data` |
| Netlify, GitHub Pages, static hosting | **No** | These publish static pages only and cannot run the portal |

### Render

1. Push this folder to the GitHub repository (`render.yaml` at the top level).
2. In Render: **New → Blueprint**, choose the repository, and enter the values it asks for, including `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_DESIGNATION` and `ADMIN_PASSWORD`.
3. **Upgrading an existing Render service:** in the service's **Environment**, delete `AUTH_MODE` and `HR_EMAILS` if present, add the four `ADMIN_…` settings and make sure `NODE_ENV` is `production` and `SESSION_SECRET` is set. Then redeploy. Existing documents are kept; when the Super Admin creates accounts with the same e-mail addresses, people see their earlier documents again.
4. Open `https://<your address>/health`. It should show `"version":"2.1.0"`.

### Azure App Service

1. Create a **Web App**: Code, **Node 22 LTS**, Linux, Basic B1 or above. Startup command `npm start`; **HTTPS Only** on.
2. **Environment variables:** enter the values from `.env.example`, including `SCM_DO_BUILD_DURING_DEPLOYMENT=true` and `DATA_DIR=/home/data/docportal`.
3. Keep the app on **one instance** (the database is a single file) and turn on **Backups**.
4. Deploy: `az webapp deploy --resource-group <group> --name <app> --src-path adk-docdraft.zip --type zip`, then **Restart**.
5. **Custom domains → Add**; add the CNAME and TXT records at your DNS provider; add a free managed certificate.

### Entra app registration (only for Microsoft 365 sign-in or e-mail notifications)

1. <https://entra.microsoft.com> → **App registrations → New registration**: single tenant; redirect URI (Web) `https://<your address>/auth/redirect`.
2. Copy the client ID and tenant ID; create a client secret and note its expiry.
3. **E-mail notifications:** add Microsoft Graph application permission **Mail.Send**, grant admin consent, and set `NOTIFY_SENDER` to a mailbox such as `documents@adkhospital.com`. Without it, people see their tasks under **My work**.

---

## Configuration reference

| Setting | Purpose |
| --- | --- |
| `NODE_ENV` | `production` on the server (secure cookies) |
| `SESSION_SECRET` | Long random string; keep it the same across restarts |
| `DATA_DIR` | Database, issued files and signed scans |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_DESIGNATION`, `ADMIN_PASSWORD` | First Super Admin (remove the password after first sign-in) |
| `TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI` | Optional Microsoft 365 sign-in |
| `NOTIFY_SENDER`, `HR_NOTIFY_EMAIL`, `PUBLIC_URL` | Optional e-mail notifications |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` | AI drafting |

Managed in the portal by the Super Admin (no redeployment needed): users and roles, departments and heads, allowed e-mail domains, AI drafts per hour, document type names, prefixes, colours, review cycles, approval stages, final approval authorities and rollout requirements.

| To change in the code | Edit |
| --- | --- |
| First-run defaults for departments and document types | `lib/config.js` |
| AI drafting rules | `lib/ai.js` (`DRAFTING_RULES`) |
| Word layout, letterhead, fonts | `lib/docgen.js`, `assets/` |
| Workflow rules and permissions | `lib/workflow.js`, `server.js` |

## Data protection

- The intake form tells staff never to enter patient-identifiable information, and the AI is instructed not to include it.
- Intake text is sent to the Claude API only when a draft is created. Review Anthropic's commercial terms and data-retention settings with IT and legal advisers before go-live.
- Sessions expire after 8 hours of inactivity.

## Local testing

```
npm install
NODE_ENV=development SESSION_SECRET=dev ADMIN_EMAIL=you@example.com ADMIN_NAME="Your Name" ADMIN_PASSWORD=Temporary123 npm start
# open http://localhost:3000 and sign in with the ADMIN_ values
npm run sample -- .          # one sample draft for each of the seven levels
npm run governance -- .      # rebuild COR-POL-001 and COR-SOP-001 as Word files
```

## Possible next steps

1. Copy each issued document to a SharePoint library automatically.
2. Staff acknowledgement in the portal for documents that require it (clause 20).
3. Automatic e-mail reminders 60 and 30 days before review dates.
4. Replace `assets/letterhead.png` with the original high-resolution artwork.
