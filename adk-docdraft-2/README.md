# ADK Hospital Document Portal

A password-protected web portal that runs the hospital's document governance process (COR-POL-001 and COR-SOP-001) from first draft to issued controlled copy. Staff sign in with their ADK Microsoft 365 account.

## How a document moves through the portal

```
 Department (author)        Reviewers and approvers         HR (document custodian)
 ───────────────────        ───────────────────────         ───────────────────────
 1. Intake form → AI draft
 2. Edit in the portal,
    resolve highlighted items
 3. Name each reviewer and
    approver (name, designation,
    e-mail); choose signing method
 4. Submit  ───────────────▶ 5. Each signatory, in order,
                               checks their own details,
       ◀── return with ─────   reads the preview, and
           comments            approves or returns
                                          │ all approved
                                          ▼
                                                        6. Verify approvals, assign
                                                           number, effective and review dates
                                                           ├─ Electronic: issued at once
                                                           └─ Signed by hand: FINAL copy
                                                              printed with every name and
                                                              designation already filled;
                                                              signatures collected; HR uploads
                                                              the signed scan → issued
 7. Issued copy in the register. A revision creates version 2 with the same number;
    when version 2 is issued, version 1 becomes OBSOLETE automatically.
```

| Role | Who | Can do |
| --- | --- | --- |
| Author | Any signed-in staff member | Create, edit while in draft, name signatories, submit, withdraw, start a revision |
| Signatory | The people the author names | Correct their own name and designation, approve, or return with comments |
| HR | Members of the HR security group or `HR_EMAILS` | Assign numbers, issue, upload signed copies, make documents obsolete, see all documents, export the register |
| All staff | Any signed-in staff member | View and download issued documents (Confidential and Highly Confidential only by those involved and HR) |

### Rules the portal enforces

- A draft cannot be submitted while any highlighted `[Author to confirm]` item or drafting note remains.
- Every page 1 carries all 13 cover-page fields (clause 10), and every file follows the clause 28 format.
- At least two approval signatories, who must be different people. The author cannot give final approval (clause 14.1).
- Every signatory needs a name, designation and ADK e-mail before submission, so nothing is handwritten except the signature.
- Approval stages default to the approval matrix (clause 14.2), with a CMO review added for clinical impact (clause 14.3.1).
- Only HR assigns numbers. Numbers are unique per department and prefix. A new version keeps its number (clause 15).
- A revision needs a summary of changes (clause 23.1). Issuing it makes the old version obsolete (clause 25).
- A management directive needs an expiry or review date (clause 24.4).
- The issued Word file is frozen at issue, so the controlled copy never changes afterwards.
- Every action is recorded with who did it and when (History on each document).

### What is stored

The database, the frozen issued Word files and the signed scans are kept in `DATA_DIR`. On Azure App Service, put this under `/home`, which persists across restarts and is included in App Service backups. Back up this folder: it is the master document register.

---

## Go-live (about 2 hours for your IT administrator)

The example address is **policies.adkhospital.com**.

### 1. Register the app in Microsoft Entra ID

1. Go to <https://entra.microsoft.com> → **App registrations → New registration**.
   - Name: `ADK Document Portal`
   - Accounts in this organizational directory only
   - Redirect URI (Web): `https://policies.adkhospital.com/auth/redirect`
2. Copy the **Application (client) ID** and **Directory (tenant) ID**.
3. Go to **Certificates & secrets → New client secret**, copy the value, and put its expiry date in the IT calendar.
4. **HR role:** create a security group (for example *Document Portal – HR*) with the HR staff in it. Under **Token configuration → Add groups claim**, tick **Security groups**. Copy the group's Object ID into `HR_GROUP_ID`. Alternatively, list HR staff in `HR_EMAILS`.
5. **E-mail notifications (recommended):** under **API permissions → Add → Microsoft Graph → Application permissions → Mail.Send**, then **Grant admin consent**. Create or choose a mailbox such as `documents@adkhospital.com` and set `NOTIFY_SENDER`. To stop the app sending from other mailboxes, limit it with an Exchange application access policy. Without this, people see their tasks under **My work** in the portal.

### 2. Claude API key (optional at first)

Create an organisation account at <https://console.anthropic.com>, set a monthly spend limit, and create an API key. Without a key, the portal lays the author's text into the template unchanged.

### 3. Azure App Service

1. Create a **Web App**: Code, **Node 22 LTS**, Linux, Basic B1 or above.
2. **Configuration → General settings:** Startup command `npm start`, **HTTPS Only** on.
3. **Environment variables:** enter each value from `.env.example`, including `SCM_DO_BUILD_DURING_DEPLOYMENT=true` and `DATA_DIR=/home/data/docportal`.
4. Keep the app on **one instance**. The database is a single file; scale up rather than out.
5. Turn on **Backups** for the app (they include `/home`).

### 4. Deploy and connect the subdomain

1. `az webapp deploy --resource-group <group> --name <app> --src-path adk-docdraft.zip --type zip`
2. **Custom domains → Add**, then at the DNS provider add **CNAME** `policies` → `<app>.azurewebsites.net` and the **TXT** `asuid.policies` record Azure shows. Add a free managed certificate and bind it.

### 5. Load the Document Governance Policy and SOP

From the App Service **SSH** console:

```
cd /home/site/wwwroot
npm run import-governance -- manal@adkhospital.com afaal@adkhospital.com nashid@adkhospital.com
```

This loads COR-POL-001-V1 and COR-SOP-001-V1 as **Awaiting signatures**, exactly as printed. When the signed copies are back, HR opens each one, uploads the scan, and the portal issues them into the register.

### 6. Test before announcing

1. Sign in as an author, create an SOP, edit it, name two colleagues as signatories, and submit.
2. Each colleague approves; return one once to see the comment loop.
3. Sign in as HR, assign the number, and download the issued copy.
4. Repeat with **Printed and signed by hand**, and upload a scanned PDF.
5. Check that a personal Microsoft account is refused.

---

## Configuration reference

| Setting | Purpose |
| --- | --- |
| `TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI` | Microsoft 365 sign-in |
| `HR_GROUP_ID` or `HR_EMAILS` | Who has the HR role |
| `HR_NOTIFY_EMAIL` | Shared HR mailbox told when documents are ready for numbering |
| `ALLOWED_EMAIL_DOMAINS` | E-mail domains allowed for signatories, e.g. `adkhospital.com` |
| `ALLOWED_GROUP_ID` | Optional: limit the whole portal to one security group |
| `NOTIFY_SENDER` | Mailbox that sends notification e-mails (needs Mail.Send) |
| `PUBLIC_URL` | Address used in e-mail links |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `DRAFTS_PER_HOUR` | AI drafting |
| `DATA_DIR` | Database, issued files and signed scans |
| `SESSION_SECRET` | Long random string; keep it the same across restarts |

| To change | Edit |
| --- | --- |
| Departments, document types, colours, review cycles, approval stages | `lib/config.js` |
| AI drafting rules | `lib/ai.js` (`DRAFTING_RULES`) |
| Word layout, letterhead, fonts | `lib/docgen.js`, `assets/` |
| Workflow rules and permissions | `lib/workflow.js`, `server.js` |

Treat changes to `lib/config.js` and the drafting rules as amendments to a controlled template, and record them.

## Data protection

- The intake form tells staff never to enter patient-identifiable information, and the AI is instructed not to include it.
- Intake text is sent to the Claude API only when a draft is created. Review Anthropic's commercial terms and data-retention settings with IT and legal advisers before go-live.
- Sessions expire after 8 hours. Only ADK tenant accounts can sign in.

## Local testing

```
npm install
npm run dev                  # http://localhost:3000 – sign-in bypassed (refused in production)
# Sign in as anyone: /login?as=name@example.com&name=Name   (add &hr=1 for the HR role)
npm run sample -- .          # one sample draft for each of the seven levels
npm run governance -- .      # rebuild COR-POL-001 and COR-SOP-001 as Word files
```

## Possible next steps

1. Copy each issued document to a SharePoint library automatically, for staff who browse there.
2. Staff acknowledgement in the portal for documents that require it (clause 20).
3. Automatic e-mail reminders 60 and 30 days before review dates.
4. Replace `assets/letterhead.png` with the original high-resolution artwork.
