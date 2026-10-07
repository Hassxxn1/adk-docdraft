// Optional e-mail notifications through Microsoft Graph (Mail.Send application permission).
// Switched on by setting NOTIFY_SENDER to the mailbox that sends portal e-mails, e.g. documents@adkhospital.com.
// Without it, people see their tasks under "My work" in the portal.
const msal = require('@azure/msal-node');

let client;
function graphClient() {
  if (!client) {
    client = new msal.ConfidentialClientApplication({
      auth: {
        clientId: process.env.CLIENT_ID,
        authority: `https://login.microsoftonline.com/${process.env.TENANT_ID}`,
        clientSecret: process.env.CLIENT_SECRET,
      },
    });
  }
  return client;
}

const enabled = () => !!(process.env.NOTIFY_SENDER && process.env.CLIENT_ID && process.env.AUTH_MODE !== 'none');
const portalUrl = () => process.env.PUBLIC_URL || (process.env.REDIRECT_URI ? new URL(process.env.REDIRECT_URI).origin : '');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function send(to, subject, lines, docId) {
  const recipients = [...new Set((Array.isArray(to) ? to : [to]).filter(Boolean))];
  if (!enabled() || !recipients.length) return;
  try {
    const token = await graphClient().acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'] });
    const link = docId ? `${portalUrl()}/#/doc/${docId}` : portalUrl();
    const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#26324a">
      ${lines.map((l) => `<p>${esc(l)}</p>`).join('')}
      <p><a href="${esc(link)}" style="background:#245BCE;color:#fff;padding:9px 16px;border-radius:5px;text-decoration:none">Open in the Document Portal</a></p>
      <p style="color:#6b7785;font-size:12px">ADK Hospital Document Portal · Document Governance (COR-POL-001)</p></div>`;
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(process.env.NOTIFY_SENDER)}/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: { subject: `[Document Portal] ${subject}`, body: { contentType: 'HTML', content: html }, toRecipients: recipients.map((a) => ({ emailAddress: { address: a } })) },
        saveToSentItems: false,
      }),
    });
    if (!res.ok) console.error('Notification failed', res.status, await res.text());
  } catch (e) {
    console.error('Notification failed', e.message);
  }
}

module.exports = { send, enabled };
