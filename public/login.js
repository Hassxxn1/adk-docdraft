(function () {
  'use strict';
  const form = document.getElementById('loginForm');
  const msg = document.getElementById('msg');
  const show = (text) => { msg.textContent = text; msg.hidden = !text; };
  const ERR = {
    noaccount: 'Your Microsoft account does not have a portal account. Ask the Super Admin to create one.',
    tenant: 'Only ADK Hospital Microsoft accounts can sign in.',
    verify: 'Sign-in could not be verified. Please try again.',
  };
  const e = new URLSearchParams(location.search).get('e');
  if (ERR[e]) show(ERR[e]);

  fetch('/auth/options').then((r) => r.json()).then((o) => {
    document.getElementById('msWrap').hidden = !o.microsoft;
    document.getElementById('setup').hidden = !o.setupNeeded;
  }).catch(() => {});

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = document.getElementById('loginBtn');
    const email = form.email.value.trim();
    const password = form.password.value;
    if (!email || !password) { show('Enter your e-mail and password.'); return; }
    btn.disabled = true; btn.textContent = 'Signing in…'; show('');
    try {
      const r = await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Sign-in failed.');
      location.href = '/';
    } catch (err) {
      show(err.message);
      form.password.value = '';
      form.password.focus();
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  });
})();
