'use strict';

/* vendor.js — everything the dashboard shows or changes goes through `api` (see api.js).
   Nothing in this file knows where the data lives. */

/* ==================== STATE ==================== */
let orders = [];
let sales = 0;
let visible = 3;                   // orders shown before "View More Orders"
const PAGE_SIZE = 3;
let alerts = 0;
let page = 'dashboard';           // which sidebar page is showing
let feedback = [];
let ratings = null;               // stall and menu-item rating summary from api.getRatings()
let settings = null;
let qrData = null;                // a newly chosen QR image that is not saved yet
let seen = new Set();              // order numbers already shown, to detect new arrivals
let primed = false;                // false until the first list has loaded (no alerts for the initial load)
let unsubscribe = null;

/* ==================== HELPERS ==================== */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const peso = n => '₱ ' + Number(n).toLocaleString('en-PH');
const fmtTime = iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const fmtDate = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const PAY_LABEL = { cash: 'Cash', ewallet: 'E-Wallet' };
/* "View receipt" link beside an e-wallet payment, or a warning when no screenshot has been uploaded yet */
const receiptLink = o => o.receipt_image
  ? ` <button class="link-btn" data-receipt="${o.order_no}">View receipt</button>`
  : (o.payment_method === 'ewallet' ? ' <small class="warn">No receipt yet</small>' : '');
const icon = d => `<svg viewBox="0 0 24 24">${d}</svg>`;
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  orders:    '<path d="M9 4h6v3H9zM7 5H5v16h14V5h-2M9 12h6M9 16h6"/>',
  queue:     '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-4 3-6 7-6s7 2 7 6M16 4.5a3.5 3.5 0 010 7M18 14c2.5.6 4 2.4 4 6"/>',
  menu:      '<path d="M7 3v8M4 3v5a3 3 0 006 0V3M7 11v10M17 3c-2 2-3 5-3 8h3v10"/>',
  sales:     '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  feedback:  '<path d="M21 12a8 8 0 01-11.6 7.1L3 21l1.9-6.2A8 8 0 1121 12zM8 12h.01M12 12h.01M16 12h.01"/>',
  settings:  '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.1-1.3l2-1.5-2-3.4-2.3 1a7 7 0 00-2.3-1.3L14 3h-4l-.3 2.5a7 7 0 00-2.3 1.3l-2.3-1-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .9.1 1.3l-2 1.5 2 3.4 2.3-1a7 7 0 002.3 1.3L10 21h4l.3-2.5a7 7 0 002.3-1.3l2.3 1 2-3.4-2-1.5c.1-.4.1-.9.1-1.3z"/>'
};
const NAV = ['Dashboard', 'Orders', 'Queue', 'Menu', 'Sales', 'Feedback', 'Settings'];

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ==================== LOGIN / LOGOUT ==================== */
function showApp(user) {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  $('login').hidden = !!user;
  $('app').hidden = !user;
  if (!user) return;
  orders = []; seen = new Set(); primed = false; alerts = 0; visible = PAGE_SIZE;
  $('vName').textContent = user.name.split(' ')[0];
  $('vName2').textContent = user.name;
  page = 'dashboard'; applyPage(); renderBell();
  unsubscribe = api.onOrders(onOrders);
  loadFeedback(); loadSettings();
}

$('togglePass').addEventListener('click', () => {
  const p = $('pass');
  const show = p.type === 'password';
  p.type = show ? 'text' : 'password';
  $('togglePass').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});

$('forgot').addEventListener('click', e => { e.preventDefault(); toast('Please ask the PUP admin to reset your password.'); });

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('loginError');
  const u = $('user').value.trim(), p = $('pass').value;
  if (!u || !p) { err.textContent = 'Enter your username and password.'; err.hidden = false; return; }
  try {
    const user = await api.login(u, p, $('remember').checked);
    err.hidden = true;
    showApp(user);
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

$('logout').addEventListener('click', () => {
  api.logout();
  $('pass').value = '';
  showApp(null);
});

/* ==================== RENDER ==================== */
function renderNav() {
  $('nav').innerHTML = NAV.map(n =>
    `<button class="nav-item" data-nav="${n}"${n.toLowerCase() === page ? ' aria-current="page"' : ''}>${icon(ICONS[n.toLowerCase()])}${n}</button>`).join('');
}

const statCard = c => `<div class="stat ${c.cls}">
    <span class="stat-icon" aria-hidden="true">${c.ic}</span>
    <span class="stat-num">${c.num}</span><span class="stat-label">${c.label}</span><span class="stat-bar"></span></div>`;

function renderStats() {
  const count = (...s) => orders.filter(o => s.includes(o.status)).length;
  const cards = [
    { cls: 'pending',   label: 'Pending Orders',   num: count('pending', 'accepted'), ic: icon('<path d="M9 4h6v3H9zM7 5H5v16h14V5h-2M9 13l2 2 4-4"/>') },
    { cls: 'preparing', label: 'Preparing Orders', num: count('preparing'),            ic: icon('<path d="M3 14h18M5 14a7 7 0 0114 0M12 6V4M4 18h16"/>') },
    { cls: 'ready',     label: 'Ready Orders',     num: count('ready'),                ic: icon('<path d="M5 12l5 5 9-10"/>') },
    { cls: 'sales',     label: "Today's Sales",    num: peso(sales),                   ic: '₱' }
  ];
  $('stats').innerHTML = cards.map(statCard).join('');
}

function visibleOrders() {
  const q = $('search').value.trim().toLowerCase();
  const st = $('status').value;
  const list = orders.filter(o =>
    (st === 'all' || o.status === st) &&
    (!q || [o.order_no, o.queue_no, o.customer_name || '', PAY_LABEL[o.payment_method], ...o.items.map(i => i.name)].join(' ').toLowerCase().includes(q)));
  return list.sort($('sort').value === 'queue'
    ? (a, b) => b.queue_no - a.queue_no
    : (a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function orderCard(o) {
  const items = o.items.length
    ? o.items.map(i => {
      const extra = [...(i.addons || []), i.note ? `“${i.note}”` : ''].filter(Boolean).join(', ');
      return `<li>${i.qty > 1 ? i.qty + '× ' : ''}${esc(i.name)}${extra ? ` <small>(${esc(extra)})</small>` : ''}</li>`;
    }).join('')
    : '<li>Item list not sent by kiosk</li>';
  const btn = (act, label, on) => `<button data-act="${act}" data-no="${o.order_no}"${on ? '' : ' disabled'}>${label}</button>`;
  const actions = o.status === 'claimed' ? '' : o.status === 'ready'
    ? btn('claimed', 'Claimed', true)
    : btn('accepted', 'Accept', o.status === 'pending') + btn('preparing', 'Preparing', o.status === 'accepted') + btn('ready', 'Ready', o.status === 'preparing');
  return `<article class="order">
    <div class="order-no"><b>Order #${o.order_no}</b><span>Queue #${o.queue_no}</span></div>
    <div class="cust"><b>${icon('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>')}${esc(o.customer_name || 'Guest')}</b><ul>${items}</ul></div>
    <div class="meta">
      <p>${icon('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>')}${PAY_LABEL[o.payment_method] || 'Pay at stall'}${receiptLink(o)}</p>
      <p>${icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')}${fmtTime(o.created_at)}</p>
      <p>${fmtDate(o.created_at)} · ${peso(o.total)}</p>
    </div>
    <div class="right"><span class="pill ${o.status}">${o.status.toUpperCase()}</span><div class="acts">${actions}</div></div>
  </article>`;
}

function renderList() {
  const all = visibleOrders();
  $('list').innerHTML = all.length ? all.slice(0, visible).map(orderCard).join('') : '<div class="empty">No orders match your search or filter.</div>';
  $('more').hidden = all.length <= visible;
}

/* Queue board: orders being cooked (accepted, preparing) and orders waiting to be picked up (ready), oldest first */
function renderQueue() {
  const mins = o => Math.max(0, Math.round((Date.now() - new Date(o.created_at)) / 60000));
  const tile = (o, cls) => `<div class="tile ${cls}"><b>#${o.queue_no}</b><span>Order #${o.order_no}</span><small>${mins(o)} min ago</small></div>`;
  const byAge = (a, b) => new Date(a.created_at) - new Date(b.created_at);
  const kitchen = orders.filter(o => ['accepted', 'preparing'].includes(o.status)).sort(byAge);
  const ready = orders.filter(o => o.status === 'ready').sort(byAge);
  const none = '<div class="empty">No orders here right now.</div>';
  $('kitchen').innerHTML = kitchen.length ? kitchen.map(o => tile(o, 'cook')).join('') : none;
  $('readyBoard').innerHTML = ready.length ? ready.map(o => tile(o, 'ready')).join('') : none;
  $('kitchenCount').textContent = kitchen.length;
  $('readyCount').textContent = ready.length;
}

/* Sales page: totals, sales per hour and best sellers, counted from paid orders (ready or claimed) */
function renderSales() {
  const done = orders.filter(o => ['ready', 'claimed'].includes(o.status));
  const by = m => done.filter(o => o.payment_method === m).reduce((s, o) => s + o.total, 0);
  $('salesStats').innerHTML = [
    { cls: 'sales',     label: "Today's Sales", num: peso(sales),         ic: '₱' },
    { cls: 'ready',     label: 'Paid Orders',   num: done.length,         ic: icon('<path d="M5 12l5 5 9-10"/>') },
    { cls: 'preparing', label: 'Cash',          num: peso(by('cash')),    ic: icon('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>') },
    { cls: 'pending',   label: 'E-Wallet',      num: peso(by('ewallet')), ic: icon('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>') }
  ].map(statCard).join('');

  const hours = {};
  done.forEach(o => { const h = new Date(o.created_at).getHours(); hours[h] = (hours[h] || 0) + o.total; });
  const hs = Object.keys(hours).map(Number);
  if (hs.length) {
    const lo = Math.min(...hs), hi = Math.max(...hs), max = Math.max(...Object.values(hours));
    let html = '';
    for (let h = lo; h <= hi; h++) {
      const val = hours[h] || 0;
      html += `<div class="bar"><span>${val ? peso(val) : ''}</span><i style="height:${Math.round(val / max * 70)}%"></i><small>${new Date(2000, 0, 1, h).toLocaleTimeString('en-US', { hour: 'numeric' })}</small></div>`;
    }
    $('hourBars').innerHTML = html;
  } else $('hourBars').innerHTML = '<div class="empty">No sales yet today.</div>';

  const tally = {};
  done.forEach(o => o.items.forEach(i => { tally[i.name] = (tally[i.name] || 0) + i.qty; }));
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $('topItems').innerHTML = top.length ? top.map(([n, q]) => `<li><span>${esc(n)}</span><b>${q} sold</b></li>`).join('') : '<li class="none">No items yet.</li>';
}

/* Feedback page: average rating and the customer reviews, newest first */
const stars = n => `<span class="stars" role="img" aria-label="${n} out of 5">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>`;
function renderFeedback() {
  const r = ratings, n = r ? r.count : 0;
  const cat = (label, val) => `<li><span>${label}</span><b>${stars(Math.round(val))} ${val.toFixed(1)}</b></li>`;
  $('rateChip').innerHTML = n ? `<span class="stars">★</span> ${r.average.toFixed(1)} <small>(${n})</small>` : '★ No ratings yet';
  $('fbSummary').innerHTML = n ? `<b class="avg">${r.average.toFixed(1)}</b>${stars(Math.round(r.average))}<span>${n} review${n > 1 ? 's' : ''}</span>` : 'No ratings yet.';
  $('fbDist').innerHTML = [5, 4, 3, 2, 1].map(k => `<div class="drow"><span>${k}★</span><span class="dbar"><i style="width:${n ? Math.round(r.distribution[k] / n * 100) : 0}%"></i></span><span>${n ? r.distribution[k] : 0}</span></div>`).join('');
  $('fbCats').innerHTML = n ? cat('Food Quality', r.categories.food_quality) + cat('Service', r.categories.service) + cat('Overall Experience', r.average) : '<li class="none">No ratings yet.</li>';
  $('fbItems').innerHTML = r && r.items.length
    ? r.items.map(i => `<li><span>${esc(i.name)}</span><b>${stars(Math.round(i.average))} ${i.average.toFixed(1)} <small>(${i.count})</small></b></li>`).join('')
    : '<li class="none">No item ratings yet.</li>';
  $('fbList').innerHTML = feedback.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(f => `<article class="review">
    <div>${stars(f.rating)} <b>${esc(f.customer_name || 'Guest')}</b><small>Order #${f.order_no} · ${fmtDate(f.created_at)} ${fmtTime(f.created_at)}</small></div>
    <span class="scores">Food Quality ${f.food_quality}/5 · Service ${f.service}/5</span>
    ${f.comment ? `<p>${esc(f.comment)}</p>` : ''}</article>`).join('');
}
async function loadFeedback() {
  try { [feedback, ratings] = await Promise.all([api.getFeedback(), api.getRatings()]); renderFeedback(); } catch (err) { console.warn(err.message); }
}

/* Settings page: stall details and the payment QR code */
function showQr(src) { $('qrPreview').hidden = !src; if (src) $('qrPreview').src = src; }
function fillSettings() {
  if (!settings) return;
  $('sName').value = settings.stall_name; $('sDesc').value = settings.description || '';
  $('sPrep').value = settings.prep_time_min; $('sStatus').value = settings.status;
  qrData = null; showQr(settings.qr_image);
}
async function loadSettings() {
  try { settings = await api.getSettings(); fillSettings(); } catch (err) { console.warn(err.message); }
}

/* Orders page: every order for this stall, filtered by search, status and source, newest first */
function renderOrdersPage() {
  const q = $('oSearch').value.trim().toLowerCase();
  const st = $('oStatus').value, src = $('oSource').value;
  const list = orders.filter(o =>
    (st === 'all' || o.status === st) && (src === 'all' || o.source === src) &&
    (!q || [o.order_no, o.queue_no, o.customer_name || '', ...o.items.map(i => i.name)].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  $('oBody').innerHTML = list.length ? list.map(o => `<tr>
    <td class="no">#${o.order_no}</td><td class="q">#${o.queue_no}</td>
    <td>${esc(o.customer_name || 'Guest')}</td>
    <td class="items">${o.items.length ? esc(o.items.map(i => (i.qty > 1 ? i.qty + '× ' : '') + i.name).join(', ')) : '—'}</td>
    <td>${PAY_LABEL[o.payment_method] || 'Pay at stall'}${receiptLink(o)}</td>
    <td><span class="src">${o.source === 'mobile' ? 'Mobile' : 'Kiosk'}</span></td>
    <td>${fmtTime(o.created_at)}</td><td>${peso(o.total)}</td>
    <td><span class="pill ${o.status}">${o.status.toUpperCase()}</span></td></tr>`).join('')
    : '<tr><td class="nothing" colspan="9">No orders match your search or filters.</td></tr>';
  $('oNote').textContent = `${list.length} order${list.length === 1 ? '' : 's'} · ${peso(list.reduce((s, o) => s + o.total, 0))}`;
}

/* Shows the page named in `page` and highlights its sidebar button */
function applyPage() {
  ['dashboard', 'queue', 'orders', 'menu', 'sales', 'feedback', 'settings'].forEach(p => { $('page-' + p).hidden = page !== p; });
  renderNav();
  if (page === 'queue') renderQueue();
  if (page === 'orders') renderOrdersPage();
  if (page === 'sales') renderSales();
  if (page === 'feedback') loadFeedback();
  if (page === 'settings') fillSettings();
  if (page === 'menu') loadMenu();
}

function renderBell() { $('bellCount').textContent = alerts; $('bellCount').hidden = !alerts; }

/* ==================== DATA IN ==================== */
/* api.onOrders calls this on load and whenever the order list changes (polling) */
async function onOrders(list) {
  const fresh = list.filter(o => !seen.has(o.order_no));
  if (primed && fresh.length) {
    alerts += fresh.length;
    toast(`New order #${fresh[0].order_no} is waiting for payment at the stall`);
  }
  list.forEach(o => seen.add(o.order_no));
  primed = true;
  orders = list;
  try { sales = (await api.getSummary()).sales_today; } catch (err) { console.warn(err.message); }
  renderStats(); renderList(); renderBell(); renderQueue(); renderOrdersPage(); renderSales();
}

/* ==================== ACTIONS OUT ==================== */
$('list').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  b.disabled = true;
  try {
    await api.setStatus(+b.dataset.no, b.dataset.act);
    await api.refresh(true);
    toast(`Order #${b.dataset.no} marked ${b.dataset.act}`);
  } catch (err) {
    toast(err.message);
    b.disabled = false;
  }
});

$('nav').addEventListener('click', e => {
  const b = e.target.closest('[data-nav]');
  if (!b) return;
  page = b.dataset.nav.toLowerCase();
  applyPage();
});

['oSearch', 'oStatus', 'oSource'].forEach(id => $(id).addEventListener('input', renderOrdersPage));
['search', 'status', 'sort'].forEach(id => $(id).addEventListener('input', () => { visible = PAGE_SIZE; renderList(); }));
$('more').addEventListener('click', () => { visible += PAGE_SIZE; renderList(); });
$('refresh').addEventListener('click', () => {
  const b = $('refresh');
  b.classList.remove('spin'); void b.offsetWidth; b.classList.add('spin');
  api.refresh(true);
});
$('rateChip').addEventListener('click', () => { page = 'feedback'; applyPage(); });
$('bell').addEventListener('click', () => { alerts = 0; renderBell(); });

$('sQr').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > 2 * 1024 * 1024) { toast('Image must be under 2 MB'); e.target.value = ''; return; }
  const r = new FileReader();
  r.onload = () => { qrData = r.result; showQr(qrData); };
  r.readAsDataURL(f);
});

$('setForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('sName').value.trim(), prep = +$('sPrep').value;
  if (!name || !(prep >= 1 && prep <= 120)) { toast('Enter a stall name and a prep time of 1 to 120 minutes'); return; }
  try {
    settings = await api.saveSettings({ stall_name: name, description: $('sDesc').value.trim(), prep_time_min: prep, status: $('sStatus').value, qr_image: qrData || settings.qr_image });
    qrData = null;
    toast('Settings saved');
  } catch (err) { toast(err.message); }
});

/* ==================== RECEIPT VIEWER ==================== */
let receiptNo = null, receiptOpener = null;

function openReceipt(no, opener) {
  const o = orders.find(x => x.order_no === no);
  if (!o || !o.receipt_image) return;
  const row = (k, val, cls = '') => `<div class="${cls}"><dt>${k}</dt><dd>${val}</dd></div>`;
  receiptNo = no; receiptOpener = opener;
  $('rImg').src = o.receipt_image;
  $('rBox').classList.remove('zoom');
  $('rInfo').innerHTML =
    row('Customer', esc(o.customer_name || 'Guest')) + row('Order', `#${o.order_no}`) +
    row('Amount to verify', peso(o.total), 'big') + row('Payment', PAY_LABEL[o.payment_method] || 'E-Wallet') +
    row('Uploaded', o.receipt_uploaded_at ? `${fmtTime(o.receipt_uploaded_at)} · ${fmtDate(o.receipt_uploaded_at)}` : '—');
  $('rAccept').hidden = o.status !== 'pending';
  $('receipt').hidden = false;
  $('rClose').focus();
}

function closeReceipt() {
  $('receipt').hidden = true;
  $('rImg').removeAttribute('src');
  if (receiptOpener && document.contains(receiptOpener)) receiptOpener.focus();
  receiptNo = null; receiptOpener = null;
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-receipt]');
  if (b) openReceipt(+b.dataset.receipt, b);
});
$('rClose').addEventListener('click', closeReceipt);
$('rCancel').addEventListener('click', closeReceipt);
$('receipt').addEventListener('click', e => { if (e.target === $('receipt')) closeReceipt(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('receipt').hidden) closeReceipt();
  else if (!$('menuModal').hidden) closeMenuForm();
  else if (!$('catModal').hidden) closeCatForm();
  else if (!$('delModal').hidden) closeDel();
});
$('rImg').addEventListener('click', () => $('rBox').classList.toggle('zoom'));
$('rImg').addEventListener('error', () => { if ($('rImg').getAttribute('src')) toast('The receipt image could not be loaded'); });
$('rAccept').addEventListener('click', async () => {
  const no = receiptNo;
  closeReceipt();
  try {
    await api.setStatus(no, 'accepted');
    await api.refresh(true);
    toast(`Order #${no} marked accepted`);
  } catch (err) { toast(err.message); }
});

/* ==================== MENU EDITOR ==================== */
let menu = [], categories = [], editId = null, delId = null, menuOpener = null, catOpener = null;
const money = n => '₱ ' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: Number.isInteger(+n) ? 0 : 2 });

async function loadMenu() {
  try {
    [menu, categories] = await Promise.all([api.getMenu(), api.getCategories()]);
    const keep = $('mFilter').value;
    const opts = categories.map(c => `<option>${esc(c)}</option>`).join('');
    $('mCat').innerHTML = opts;
    $('mFilter').innerHTML = '<option value="all">All Categories</option>' + opts;
    $('mFilter').value = categories.includes(keep) ? keep : 'all';
    renderMenu();
  } catch (err) { toast(err.message); }
}

function renderMenu() {
  const q = $('mSearch').value.trim().toLowerCase(), cf = $('mFilter').value;
  $('mCats').innerHTML = categories.map(c => `<button class="chip" data-cat="${esc(c)}" aria-pressed="${cf === c}">${esc(c)} <small>${menu.filter(i => i.category === c).length}</small></button>`).join('');
  const list = menu.filter(i => (cf === 'all' || i.category === cf) && (!q || (i.item_name + ' ' + i.description).toLowerCase().includes(q)))
    .sort((a, b) => a.category.localeCompare(b.category) || a.item_name.localeCompare(b.item_name));
  $('mBody').innerHTML = list.length ? list.map(i => `<tr>
    <td><b>${esc(i.item_name)}</b><span class="d">${esc(i.description || '')}</span></td>
    <td>${esc(i.category)}</td><td>${money(i.price)}</td>
    <td><button class="switch" role="switch" aria-checked="${i.is_available}" data-avail="${i.menu_item_id}" aria-label="Available: ${esc(i.item_name)}"></button><span class="state">${i.is_available ? 'Available' : 'Hidden'}</span></td>
    <td><button class="link-btn" data-edit="${i.menu_item_id}">Edit</button><button class="link-btn danger-t" data-del="${i.menu_item_id}">Remove</button></td></tr>`).join('')
    : '<tr><td class="nothing" colspan="5">No menu items found. Click “Add Item” to create one.</td></tr>';
  $('mNote').textContent = `${menu.filter(i => i.is_available).length} of ${menu.length} items are available on the kiosk`;
}

function openMenuForm(id, opener) {
  const i = menu.find(x => x.menu_item_id === id);
  editId = i ? id : null; menuOpener = opener;
  $('mTitle').textContent = i ? 'Edit Menu Item' : 'Add Menu Item';
  $('mName').value = i ? i.item_name : ''; $('mDesc').value = i ? i.description || '' : '';
  $('mCat').value = i ? i.category : categories[0]; $('mPrice').value = i ? i.price : '';
  $('mAvail').checked = i ? i.is_available : true;
  $('mError').hidden = true;
  $('menuModal').hidden = false;
  $('mName').focus();
}
function closeMenuForm() { $('menuModal').hidden = true; if (menuOpener && document.contains(menuOpener)) menuOpener.focus(); }

function openDel(id, opener) {
  const i = menu.find(x => x.menu_item_id === id);
  if (!i) return;
  delId = id; menuOpener = opener;
  $('dText').textContent = `“${i.item_name}” will no longer appear on the kiosk. To hide it temporarily, turn off its Available switch instead.`;
  $('delModal').hidden = false;
  $('dCancel').focus();
}
function closeDel() { $('delModal').hidden = true; if (menuOpener && document.contains(menuOpener)) menuOpener.focus(); }

function openCatForm(opener) {
  catOpener = opener;
  $('cName').value = ''; $('cError').hidden = true;
  $('catModal').hidden = false;
  $('cName').focus();
}
function closeCatForm() { $('catModal').hidden = true; if (catOpener && document.contains(catOpener)) catOpener.focus(); }

$('cAdd').addEventListener('click', e => openCatForm(e.currentTarget));
$('cClose').addEventListener('click', closeCatForm);
$('cCancel').addEventListener('click', closeCatForm);
$('mCats').addEventListener('click', e => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  $('mFilter').value = $('mFilter').value === b.dataset.cat ? 'all' : b.dataset.cat;   // click again to clear
  renderMenu();
});
$('catForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const name = await api.addCategory($('cName').value);
    await loadMenu();
    $('catModal').hidden = true;
    if (catOpener && document.contains(catOpener)) catOpener.focus();
    toast(`Category “${name}” added`);
  } catch (err) { $('cError').textContent = err.message; $('cError').hidden = false; }
});

$('mAdd').addEventListener('click', e => openMenuForm(null, e.currentTarget));
['mSearch', 'mFilter'].forEach(id => $(id).addEventListener('input', renderMenu));
$('mClose').addEventListener('click', closeMenuForm);
$('mCancel').addEventListener('click', closeMenuForm);
$('dCancel').addEventListener('click', closeDel);

$('mBody').addEventListener('click', async e => {
  const sw = e.target.closest('[data-avail]'), ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
  if (sw) {
    const id = +sw.dataset.avail, on = sw.getAttribute('aria-checked') !== 'true';
    try { await api.setAvailability(id, on); menu = await api.getMenu(); renderMenu(); toast(on ? 'Item is available on the kiosk' : 'Item hidden from the kiosk'); }
    catch (err) { toast(err.message); }
  } else if (ed) openMenuForm(+ed.dataset.edit, ed);
  else if (del) openDel(+del.dataset.del, del);
});

$('menuForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await api.saveMenuItem({ menu_item_id: editId, item_name: $('mName').value, description: $('mDesc').value, category: $('mCat').value, price: $('mPrice').value, is_available: $('mAvail').checked });
    menu = await api.getMenu(); renderMenu();
    $('menuModal').hidden = true; if (menuOpener && document.contains(menuOpener)) menuOpener.focus();
    toast(editId ? 'Menu item updated' : 'Menu item added');
  } catch (err) { $('mError').textContent = err.message; $('mError').hidden = false; }
});

$('dConfirm').addEventListener('click', async () => {
  try { await api.deleteMenuItem(delId); menu = await api.getMenu(); renderMenu(); toast('Menu item removed'); }
  catch (err) { toast(err.message); }
  closeDel();
});

/* ==================== CLOCK & INIT ==================== */
function tick() {
  const d = new Date();
  const date = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const day = d.toLocaleDateString('en-US', { weekday: 'long' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  $('clock').textContent = `${date}  |  ${day}  •  ${time}`;
  if (page === 'queue') renderQueue();   // keeps the "min ago" labels current
}
tick();
setInterval(tick, 30000);

showApp(api.currentUser());
