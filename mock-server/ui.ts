/**
 * Minimal admin / buyer pages for the mock. They use the same data-testid contract as src/ui/selectors.ts,
 * which is what the real marketplace pages must expose (or what selectors.ts must be re-mapped to).
 */
const shell = (title: string, body: string, script: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title} | Uvation Marketplace</title>
<style>body{font-family:sans-serif;max-width:760px;margin:24px auto}label{display:block;margin-top:8px}
.err{color:#b00020;font-size:12px}.ok{color:#0a7d32}</style></head>
<body><h1>${title}</h1>${body}<script>
const token = localStorage.getItem('uv_token');
const api = (path, opts = {}) => fetch(path, { ...opts, headers: { 'Content-Type': 'application/json',
  ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) } });
${script}</script></body></html>`;

const requireLogin = `if (!token) location.href = '/login?next=' + encodeURIComponent(location.pathname);`;

const quoteForm = (guest: boolean) => `
${
  guest
    ? ''
    : `<section><h2>Customer lookup</h2>
<input data-testid="lookup-email" placeholder="Customer email">
<button data-testid="lookup-btn" type="button">Validate customer</button>
<div data-testid="lookup-result"></div></section>`
}
<form data-testid="quote-form" novalidate>
<label>Company name <input data-testid="company-name" name="companyName"></label>
<label>Contact name <input data-testid="contact-name" name="contactName"></label><div class="err" data-testid="error-contactName"></div>
<label>Business email <input data-testid="email" name="email"></label><div class="err" data-testid="error-email"></div>
<label>Contact number <input data-testid="phone" name="phone"></label><div class="err" data-testid="error-phone"></div>
<label>Product <select data-testid="product-select" name="sku"><option value="">-- select a product --</option>
<option value="UV-AI-8X">Uvation AI Server 8X</option><option value="NET-SW-400G">400G Spine Switch</option></select></label>
<label>Quantity <input data-testid="quantity" name="quantity" type="number" value="1"></label>
<label><input data-testid="general-inquiry" type="checkbox" name="general"> General inquiry (no product yet)</label>
<label>Notes <textarea data-testid="notes" name="notes"></textarea></label>
<div class="err" data-testid="error-items"></div>
<button data-testid="submit-quote" type="submit">Submit quote request</button>
</form>
<div class="ok" data-testid="quote-success" hidden>Quote request created: <span data-testid="quote-number"></span>
<span data-testid="guest-reference"></span></div>`;

const quoteFormScript = `
const idemKey = crypto.randomUUID();
const lookupBtn = document.querySelector('[data-testid=lookup-btn]');
if (lookupBtn) lookupBtn.onclick = async () => {
  const email = document.querySelector('[data-testid=lookup-email]').value;
  const res = await api('/api/customers/lookup?email=' + encodeURIComponent(email));
  const out = document.querySelector('[data-testid=lookup-result]');
  if (res.status === 404) { out.textContent = 'No data found'; return; }
  const c = await res.json();
  out.textContent = c.companyName + ' | ' + c.contactName + ' | ' + c.email + ' | ' + c.phone;
  for (const [k, id] of [['companyName','company-name'],['contactName','contact-name'],['email','email'],['phone','phone']])
    document.querySelector('[data-testid=' + id + ']').value = c[k] || '';
};
const form = document.querySelector('[data-testid=quote-form]');
form.onsubmit = async (e) => {
  e.preventDefault();
  const btn = document.querySelector('[data-testid=submit-quote]');
  if (btn.disabled) return;
  btn.disabled = true;
  document.querySelectorAll('.err').forEach((el) => (el.textContent = ''));
  const f = new FormData(form);
  const general = f.get('general') === 'on';
  const body = { customer: { companyName: f.get('companyName') || undefined, contactName: f.get('contactName') || undefined,
      email: f.get('email') || undefined, phone: f.get('phone') || undefined },
    inquiryType: general ? 'general' : 'product', notes: f.get('notes') || undefined,
    items: f.get('sku') ? [{ sku: f.get('sku'), quantity: Number(f.get('quantity')) }] : [],
    shipping: { destination: 'US-CA', method: 'freight' } };
  try {
    const res = await api('/api/quotes', { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': idemKey } });
    const data = await res.json();
    if (res.status === 201) {
      document.querySelector('[data-testid=quote-success]').hidden = false;
      document.querySelector('[data-testid=quote-number]').textContent = data.number;
      document.querySelector('[data-testid=guest-reference]').textContent = data.customer.guestReference || '';
      return;
    }
    for (const [k, msg] of Object.entries(data.errors || {})) {
      const el = document.querySelector('[data-testid=error-' + k + ']') || document.querySelector('[data-testid=error-items]');
      el.textContent = msg;
    }
  } finally { btn.disabled = false; }
};`;

export function renderPage(path: string): string | undefined {
  if (path === '/login')
    return shell(
      'Sign in',
      `<form data-testid="login-form"><input data-testid="login-email" name="email"><input data-testid="login-password" name="password" type="password">
<button data-testid="login-submit">Sign in</button><div class="err" data-testid="login-error"></div></form>`,
      `document.querySelector('form').onsubmit = async (e) => { e.preventDefault(); const f = new FormData(e.target);
  const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: f.get('email'), password: f.get('password') }) });
  if (!res.ok) { document.querySelector('[data-testid=login-error]').textContent = 'Invalid credentials'; return; }
  localStorage.setItem('uv_token', (await res.json()).token);
  location.href = new URLSearchParams(location.search).get('next') || '/admin'; };`,
    );
  if (path === '/admin')
    return shell(
      'Admin',
      `<nav><a data-testid="nav-send-quote" href="/admin/quotes/new">Send Quote</a></nav>`,
      requireLogin,
    );
  if (path === '/admin/quotes/new')
    return shell('Send Quote', quoteForm(false), requireLogin + quoteFormScript);
  if (path === '/request-quote') return shell('Request a Quote', quoteForm(true), quoteFormScript);
  const m = path.match(/^\/admin\/quotes\/([\w-]+)$/);
  if (m)
    return shell(
      'Quote',
      `<div data-testid="quote-view"><h2 data-testid="quote-view-number"></h2><p data-testid="quote-view-status"></p>
<p data-testid="quote-view-company"></p><p data-testid="quote-view-notes"></p><ul data-testid="quote-view-lines"></ul>
<p>Total: <span data-testid="quote-view-total"></span></p>
<input data-testid="send-recipients" placeholder="recipient@company.com, other@company.com">
<button data-testid="send-quote-btn">Send Quote</button><div data-testid="send-result"></div></div>`,
      requireLogin +
        `const id = ${JSON.stringify(m[1])};
const load = async () => { const q = await (await api('/api/quotes/' + id)).json();
  document.querySelector('[data-testid=quote-view-number]').textContent = q.number;
  document.querySelector('[data-testid=quote-view-status]').textContent = q.status;
  document.querySelector('[data-testid=quote-view-company]').textContent = q.customer.companyName || '';
  document.querySelector('[data-testid=quote-view-notes]').textContent = q.notes || '';
  const ul = document.querySelector('[data-testid=quote-view-lines]'); ul.innerHTML = '';
  for (const l of q.items) { const li = document.createElement('li'); li.textContent = l.sku + ' x' + l.quantity + ' ' + l.lineTotal; ul.append(li); }
  document.querySelector('[data-testid=quote-view-total]').textContent = q.grandTotal.toFixed(2); };
load();
document.querySelector('[data-testid=send-quote-btn]').onclick = async () => {
  const recipients = document.querySelector('[data-testid=send-recipients]').value.split(',').map((s) => s.trim()).filter(Boolean);
  const res = await api('/api/quotes/' + id + '/send', { method: 'POST', body: JSON.stringify({ recipients }) });
  const data = await res.json();
  document.querySelector('[data-testid=send-result]').textContent = res.ok ? 'Quote sent' : (data.errors ? Object.values(data.errors).join('; ') : data.error);
  load(); };`,
    );
  return undefined;
}
