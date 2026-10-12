'use strict';

/* ==================== GLOBAL / SHARED ==================== */
/* Everything more than one screen depends on lives here: data, state, utilities, the screen renderer,
   the modal system, the idle timer and event delegation. Screens register themselves in the
   `views`, `hooks` and `ACTIONS` maps below; each SCREEN section owns its markup, rendering and actions. */

/* ---------- Configuration & mock data ---------- */
/* Replace DATA with the real PUP Lagoon stalls, menus and add-ons; DATA.items is generated from DATA.cats. */
const DATA = {
  stalls: [
    { id: 1, name: 'Stall 1', cat: 'Meals',    prep: '5–10',  e: '🍛' },
    { id: 2, name: 'Stall 2', cat: 'Drinks',   prep: '3–5',   e: '🥤' },
    { id: 3, name: 'Stall 3', cat: 'Snacks',   prep: '5–8',   e: '🍢' },
    { id: 4, name: 'Stall 4', cat: 'Desserts', prep: '3–6',   e: '🍨' },
    { id: 5, name: 'Stall 5', cat: 'Meals',    prep: '10–15', e: '🍳' },
    { id: 6, name: 'Stall 6', cat: 'Other',    prep: '5–10',  e: '🥪' }
  ],
  chips: ['All', 'Meals', 'Drinks', 'Snacks', 'Desserts', 'Other'],
  cats: ['Rice Meals', 'Silog Meals', 'Lutong Bahay', 'Merienda & Snacks', 'Drinks', 'Desserts'],
  emoji: {
    'Rice Meals': '🍚', 'Silog Meals': '🍳', 'Lutong Bahay': '🍲',
    'Merienda & Snacks': '🍢', 'Drinks': '🥤', 'Desserts': '🍮'
  },
  label: {
    'Rice Meals': 'Meal', 'Silog Meals': 'Meal', 'Lutong Bahay': 'Food Item',
    'Merienda & Snacks': 'Snack', 'Drinks': 'Drink', 'Desserts': 'Dessert'
  },
  addons: [
    { id: 'egg',  name: 'Extra Egg',  price: 15 },
    { id: 'rice', name: 'Extra Rice', price: 15 },
    { id: 'a1',   name: 'Add-on 1',   price: 20 }
  ]
};

DATA.items = DATA.cats.flatMap((cat, ci) => [1, 2].map(n => ({
  id: `${ci}-${n}`,
  cat,
  name: `${DATA.label[cat]} ${n + (ci % 2 ? 2 : 0)}`,
  desc: 'Short placeholder description.',
  price: 40 + ci * 15 + n * 20,
  e: DATA.emoji[cat]
})));

const IDLE_MS = 60000;      // inactivity before the "still there?" warning
const WARN_S = 10;          // seconds the warning shows before reset
const KIOSK_W = 1080;
const KIOSK_H = 1920;
const MOBILE_MAX = 760;     // must match the max-width breakpoint in styles.css
const FAB_SCREENS = ['menu'];   // screens that show the floating cart pill
const MODAL_FADE_MS = 120;  // must match .overlay.is-closing in styles.css
const SWAP_LOCK_MS = 350;   // taps right after a screen/modal swap are ignored (stops double-tap carry-over)
const TOTAL_STEPS = 4;

/* ---------- Global state ---------- */
const fresh = () => ({
  screen: 'home', stall: null, q: '', chip: 'All', cat: DATA.cats[0], cart: [],
  modal: null, order: null, printStatus: null, slide: 0, ratings: {}, feedback: null,
  lastFocus: null, prevModal: '', prevKind: '', idleFrom: null, confirmFrom: null, rm: null, pendingStall: null
});

let S = fresh();
let timers = {};
let uid = 0;
let orderSeq = 125;
let lastSwap = 0;           // timestamp of the last screen/modal swap; see markSwap()
/* ---------- Icons ---------- */
const ic = {
  back:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 5l-7 7 7 7"/></svg>',
  cart:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 4h3l2.5 11h9L20 7H7"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/></svg>',
  tray:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 15h18M5 15a7 7 0 0114 0M12 6V4"/><path d="M4 19h16"/></svg>',
  cash:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/></svg>',
  slip:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
  check:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><path d="M5 12l5 5 9-10"/></svg>',
  clock:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  warn:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.4v.1"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  close:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 6l12 12M18 6L6 18"/></svg>'
};
/* ---------- Utilities ---------- */
const $ = id => document.getElementById(id);
const peso = n => '₱' + n.toFixed(2);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const stallObj = () => DATA.stalls.find(s => s.id === S.stall);
const addonsTotal = addons => addons.reduce((sum, a) => sum + a.price, 0);

function calculateTotals() {
  const subtotal = S.cart.reduce((sum, l) => sum + (l.price + addonsTotal(l.addons)) * l.qty, 0);
  return { subtotal, total: subtotal, count: S.cart.reduce((sum, l) => sum + l.qty, 0) };
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(timers.toast);
  timers.toast = setTimeout(() => t.classList.remove('show'), 2200);
}

/* Records a screen/modal swap. The click handler ignores taps for SWAP_LOCK_MS afterwards, so the second
   tap of an accidental double-tap can't land on whatever just appeared under the finger. */
const markSwap = () => { lastSwap = performance.now(); };

/* New content in a scroll region starts at its top (instant, although regions scroll smoothly) */
const resetScroll = el => { if (el) el.scrollTo({ top: 0, behavior: 'instant' }); };

/* Switches screen, re-renders, and moves focus/scroll to the top of <main>.
   Transition rule: ONLY go() changes screens, and only a new screen plays the .screen entrance animation.
   Changes inside the current screen (filters, tabs, quantities, status) must update content in place. */
function go(screen) {
  markSwap();
  S.screen = screen;
  renderScreen();
  $('screen').scrollTop = 0;
  $('screen').focus({ preventScroll: true });
}

/* Shared screen header: [Back ... Step n of N] / title / supporting line */
const stepLabel = n => `Step ${n} of ${TOTAL_STEPS}`;

function screenHead({ title, lede = '', back = '', backLabel = '', step = '', center = false, ledeId = '', icon = '' }) {
  return `<header class="screen-head${center ? ' is-center' : ''}">
    <div class="head-nav">
      ${back ? `<button class="btn-quiet back" data-action="${back}"${backLabel ? ` aria-label="${backLabel}"` : ''}>${ic.back} Back</button>` : ''}
      ${step ? `<span class="step-label">${step}</span>` : ''}
    </div>
    ${icon ? `<div class="head-icon" aria-hidden="true">${icon}</div>` : ''}
    <h1>${title}</h1>
    ${lede || ledeId ? `<p class="lede"${ledeId ? ` id="${ledeId}"` : ''}>${lede}</p>` : ''}
  </header>`;
}

/* Scales the fixed 1080x1920 canvas to the viewport (downscale only); mobile uses the fluid layout */
function fitKiosk() {
  const fit = Math.min(window.innerWidth / KIOSK_W, window.innerHeight / KIOSK_H);
  const scale = window.innerWidth > MOBILE_MAX && fit < 1 ? +(fit * 0.95).toFixed(4) : 1;
  document.documentElement.style.setProperty('--kiosk-scale', scale);
}

/* ---------- Screen renderer ---------- */
/* renderScreen() writes #screen (each screen's header included) from views[S.screen], then runs
   hooks[S.screen] to fill the screen's dynamic regions. Screens register both in their own section. */
const views = {};
const hooks = {};

function renderScreen() {
  const main = $('screen');
  const fab = $('fab');
  const t = calculateTotals();

  fab.hidden = !FAB_SCREENS.includes(S.screen);
  fab.innerHTML = `${ic.cart} Cart (<b id="cc">${t.count}</b>)`;
  syncFabSafeArea();

  main.innerHTML = views[S.screen]();
  hooks[S.screen]?.();

  /* Home owns the caption carousel: run it only while Home is showing. */
  if (S.screen === 'home') startCarousel();
  else stopCarousel();
}

/* ---------- Cart pill (#fab) ---------- */
/* Rendered by renderScreen() and shown on FAB_SCREENS (the Menu). The Menu screen animates its counter. */
/* Publishes the cart pill's footprint (height + inset from the bottom edge) as --fab-clear; `.pad-fab` in
   styles.css turns it into bottom padding so the last menu row can scroll clear of the pill. Measured from
   the real element, so it follows font, breakpoint and orientation changes. */
function syncFabSafeArea() {
  const fab = $('fab');
  if (fab.hidden) return;
  const inset = parseFloat(getComputedStyle(fab).bottom) || 0;
  document.documentElement.style.setProperty('--fab-clear', `${inset + fab.offsetHeight}px`);
}

/* ---------- Modal system ---------- */
/* One overlay, one shell (#modal), two kinds of content (modal.dataset.kind):
     'dialog'   short, centered alert or confirmation built with showDialog() (idle warning, confirmations)
     'content'  titled panel with a Close button, left-aligned (item picker, queue, help)
   Both share the overlay, width cap, padding, radius, shadow and entrance/exit motion in styles.css. */
const isModalOpen = () => {
  const o = $('overlay');
  return !o.hidden && !o.classList.contains('is-closing');
};

/* While a modal is up, the screen and cart pill cannot be tapped, focused or read by assistive tech */
function setBackgroundInert(on) {
  $('screen').inert = on;
  $('fab').inert = on;
}

/* Only the first modal in a stack records the focus-return target (confirm dialogs reuse the overlay) */
function showModal(html, kind = 'content') {
  markSwap();
  const overlay = $('overlay');
  const modal = $('modal');
  clearTimeout(timers.modalHide);               // reopening during the exit fade cancels the hide
  if (!isModalOpen()) S.lastFocus = document.activeElement;
  overlay.classList.remove('is-closing');
  modal.dataset.kind = kind;
  modal.innerHTML = html;

  const title = modal.querySelector('h2');
  if (title) {
    title.id = 'modalTitle';
    modal.setAttribute('aria-labelledby', 'modalTitle');
  }
  const msg = modal.querySelector('.dialog-msg');
  if (msg) {
    msg.id = 'modalMsg';
    modal.setAttribute('aria-describedby', 'modalMsg');
  } else {
    modal.removeAttribute('aria-describedby');
  }

  overlay.hidden = false;
  setBackgroundInert(true);
  modal.querySelector('button,input')?.focus();
}

/* State is released immediately; the overlay then fades out and is hidden by hideOverlay() */
function closeModal() {
  markSwap();
  S.modal = null;
  S.idleFrom = null;
  setBackgroundInert(false);
  const overlay = $('overlay');
  if (!overlay.hidden) {
    overlay.classList.add('is-closing');
    clearTimeout(timers.modalHide);
    timers.modalHide = setTimeout(hideOverlay, MODAL_FADE_MS);
  }
  S.lastFocus?.focus?.();
}

function hideOverlay() {
  const overlay = $('overlay');
  overlay.hidden = true;
  overlay.classList.remove('is-closing');
  $('modal').innerHTML = '';
}

/* Centered dialog: icon, title, message, optional extra (e.g. countdown bar), actions.
   `tone` picks the icon badge colour ('gold' for notices, 'danger' for destructive confirmations).
   `message` and `extra` are trusted HTML: callers escape any user-provided text. */
function showDialog({ icon, tone = 'gold', title, message, extra = '', actions }) {
  showModal(`<div class="dialog">
    <div class="dialog-icon is-${tone}" aria-hidden="true">${icon}</div>
    <h2 class="dialog-title">${title}</h2>
    <p class="dialog-msg">${message}</p>
    ${extra}
    <div class="dialog-actions">${actions}</div>
  </div>`, 'dialog');
}

const closeBtn = (action = 'close') =>
  `<button class="btn-secondary" data-action="${action}" aria-label="Close">${ic.close} Close</button>`;

/* Swaps the current modal for a yes/no dialog; "confirm-no" restores the previous modal (or closes if none).
   The safe choice is the outlined button on the left; the destructive one is red on the right. */
function confirmDialog(title, msg, yes, yesAction, no = 'Keep Editing') {
  const open = isModalOpen();
  S.prevModal = open ? $('modal').innerHTML : '';
  S.prevKind = open ? $('modal').dataset.kind : '';
  S.confirmFrom = S.modal;
  showDialog({
    icon: ic.warn,
    tone: 'danger',
    title,
    message: msg,
    actions: `<button class="btn-secondary" data-action="confirm-no">${no}</button>
      <button class="btn-danger" data-action="${yesAction}">${yes}</button>`
  });
}

/* ---------- Session & idle timer ---------- */
/* Clears all timers and state, then returns to the home screen */
function resetSession() {
  Object.values(timers).forEach(t => { clearTimeout(t); clearInterval(t); });
  timers = {};
  S = fresh();
  closeModal();
  uid = 0;
  go('home');
}

/* "Still Ordering?" dialog. The countdown text and the progress bar are driven by the same one-second tick
   that decides when to reset, so what the customer sees is exactly what the timer is doing. If another modal
   was open (e.g. the item picker), it is stashed and restored by the "stay" action. */
function showIdleWarning() {
  let n = WARN_S;
  const m = $('modal');
  S.idleFrom = isModalOpen() ? { html: m.innerHTML, kind: m.dataset.kind, modal: S.modal } : null;

  showDialog({
    icon: ic.clock,
    tone: 'gold',
    title: 'Still Ordering?',
    message: `Your order will be cleared in <b class="dialog-count"><span id="wc">${n}</span> <span id="wu">seconds</span></b> due to inactivity.`,
    extra: '<div class="dialog-timer" aria-hidden="true"><i id="wbar"></i></div>',
    actions: '<button class="btn-primary btn-lg" data-action="stay">Continue Ordering</button>'
  });

  /* The bar eases to where it should be one second from now, then each tick sets the next target,
     so it reaches empty exactly when the session resets. */
  const bar = $('wbar');
  const setBar = left => { bar.style.transform = `scaleX(${Math.max(0, left) / WARN_S})`; };
  void bar.offsetWidth;   // commit the full bar before the first transition
  setBar(n - 1);

  timers.warnCd = setInterval(() => {
    n--;
    const count = $('wc');
    const unit = $('wu');
    if (count) count.textContent = n;
    if (unit) unit.textContent = n === 1 ? 'second' : 'seconds';
    if ($('wbar')) setBar(n - 1);
    if (n <= 0) resetSession();
  }, 1000);
}

/* Re-arms the idle timer on activity: warning first, then reset (inactive on home/done/thanks; the rating screen has its own timeout) */
function idleReset() {
  clearTimeout(timers.idle);
  clearInterval(timers.warnCd);
  clearTimeout(timers.rateIdle);
  /* Rating screen: the "Still Ordering?" warning does not apply; an unattended form is treated as skipped */
  if (S.screen === 'rate') {
    timers.rateIdle = setTimeout(() => finishRating('skipped'), RATE_IDLE_S * 1000);
    return;
  }
  if (S.screen === 'home' || S.screen === 'done' || S.screen === 'thanks') return;

  timers.idle = setTimeout(showIdleWarning, IDLE_MS);
}

/* ---------- Event delegation ---------- */
/* All [data-action] clicks are delegated; each handler receives the element's data-v value.
   Shared navigation and modal actions are defined here; every screen adds its own with Object.assign. */
const ACTIONS = {
  /* navigation (back buttons, cart pill, back to start) */
  'to-home': () => go('home'),
  'to-stalls': () => go('stalls'),
  'to-menu': () => go(S.stall ? 'menu' : 'stalls'),
  'to-cart': () => go('cart'),
  'open-cart': () => go('cart'),
  home: resetSession,

  /* modals (restoreModal() is the Menu's item-picker restore, used when a confirm dialog is cancelled) */
  close: closeModal,
  stay: () => {
    const from = S.idleFrom;
    if (!from) return closeModal();
    S.idleFrom = null;
    showModal(from.html, from.kind);          // put back whatever the warning interrupted
    S.modal = from.modal;
    if (from.kind !== 'dialog') restoreModal();
  },
  'confirm-no': () => {
    const from = S.confirmFrom;
    if (!S.prevModal) return closeModal();
    showModal(S.prevModal, S.prevKind || 'content');
    if (from) {
      S.modal = from;
      from.busy = false;
      restoreModal();
    }
  }
};

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.disabled) return;
  if (performance.now() - lastSwap < SWAP_LOCK_MS) return;
  const action = btn.dataset.action;
  if (!Object.hasOwn(ACTIONS, action)) return;
  ACTIONS[action](btn.dataset.v);
  idleReset();
});

/* Escape closes dismissible modals; Tab is trapped inside the open modal */
document.addEventListener('keydown', e => {
  if (!isModalOpen()) return;
  const modal = $('modal');

  if (e.key === 'Escape') {
    modal.querySelector('[data-action="modal-close"],[data-action="close"]')?.click();
  }

  if (e.key === 'Tab') {
    const focusable = [...modal.querySelectorAll('button:not(:disabled),input,textarea')];
    if (!focusable.length) return;
    const i = focusable.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) {
      e.preventDefault();
      focusable.at(-1).focus();
    } else if (!e.shiftKey && i === focusable.length - 1) {
      e.preventDefault();
      focusable[0].focus();
    }
  }
});

/* Any user activity restarts the idle timer, except while the idle warning is showing */
['pointerdown', 'keydown', 'input'].forEach(type =>
  document.addEventListener(type, () => {
    if (!isModalOpen() || !$('wc')) idleReset();
  }, true));

document.addEventListener('contextmenu', e => e.preventDefault());

let fitFrame = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => { fitKiosk(); syncFabSafeArea(); });
});

/* ==================== SCREEN: HOME ==================== */
/* Welcome screen: intro, obelisk illustration, caption carousel, Start Ordering / View Queue / How It Works.
   Owns the carousel timers (timers.car, timers.carSwap) and the queue and help modals it opens. */

const CAROUSEL_MS = 3500;
const CAROUSEL_FADE_MS = 250;

/* Home-screen illustration: a symmetrical PUP Obelisk (star, collar, shaft, pedestal, stepped base) */
const obelisk = `<svg viewBox="0 0 240 360" role="img" aria-label="PUP Obelisk illustration">
  <g fill="none" stroke="#7A0000" stroke-linejoin="round">
    <polygon points="120,14 131,46 164,46 137,66 147,99 120,79 93,99 103,66 76,46 109,46" fill="#F1B434" stroke-width="3"/>
    <polygon points="120,27 126,50 149,50 131,63 138,86 120,72 102,86 109,63 91,50 114,50" fill="#FFFDF7" stroke-width="1.5"/>
    <path d="M120 27 L120 72 M91 50 L120 72 M149 50 L120 72" stroke="#C98A16" stroke-width="1.25"/>
  </g>
  <g fill="#7A0000" stroke="#7A0000" stroke-linejoin="round">
    <path d="M107 82 L120 93 L133 82 L133 106 L120 116 L107 106 Z" stroke-width="2.5"/>
    <path d="M113 91 L120 97 L127 91 L127 105 L120 111 L113 105 Z" fill="#F1B434" stroke-width="1.5"/>
  </g>
  <g fill="#7A0000" stroke="#7A0000" stroke-linejoin="round">
    <path d="M107 105 L120 96 L133 105 L157 267 L83 267 Z" stroke-width="3"/>
    <path d="M113 115 L120 110 L127 115 L144 255 L96 255 Z" fill="#FFFDF7" stroke-width="2"/>
    <path d="M112 128 L116 125 L116 246 L101 246 Z" fill="#FFFDF7" stroke-width="1.5"/>
    <path d="M124 125 L128 128 L139 246 L124 246 Z" fill="#FFFDF7" stroke-width="1.5"/>
    <line x1="120" y1="111" x2="120" y2="255" stroke="#F1B434" stroke-width="1.5"/>
    <path d="M108 120 H132" fill="none" stroke="#F1B434" stroke-width="1.25"/>
  </g>
  <g stroke="#7A0000" stroke-linejoin="round">
    <path d="M83 256 H157 L164 269 H76 Z" fill="#F1B434" stroke-width="2.5"/>
    <rect x="76" y="269" width="88" height="23" fill="#FFFDF7" stroke-width="3"/>
    <rect x="85" y="275" width="28" height="11" fill="#FFFDF7" stroke="#F1B434" stroke-width="1.5"/>
    <rect x="127" y="275" width="28" height="11" fill="#FFFDF7" stroke="#F1B434" stroke-width="1.5"/>
    <path d="M70 292 H170 L176 303 H64 Z" fill="#7A0000" stroke-width="2.5"/>
  </g>
  <g stroke="#7A0000" stroke-linejoin="round">
    <path d="M58 303 H182 L188 317 H52 Z" fill="#7A0000" stroke-width="2.5"/>
    <line x1="52" y1="317" x2="188" y2="317" stroke="#F1B434" stroke-width="2"/>
    <path d="M47 317 H193 L198 332 H42 Z" fill="#7A0000" stroke-width="2.5"/>
    <rect x="38" y="332" width="164" height="16" rx="1" fill="#7A0000" stroke-width="3"/>
  </g>
</svg>`;

/* Home-screen caption carousel */
const SLIDES = [
  'Order in just a few taps',
  'Browse stalls and menus',
  'Pay at the stall',
  'Spend less time waiting',
  'Pick up when your order is ready'
];

const dotsMarkup = () => SLIDES.map((_, i) => `<i class="${i === S.slide ? 'on' : ''}"></i>`).join('');

views.home = () => `<section class="screen welcome">
    <div class="welcome-intro">
      <h2>Welcome to <em>PUPick</em></h2>
      <p>Choose a stall, select your items, and place your order.</p>
    </div>
    <div class="hero">${obelisk}<p class="slide" id="slide">${SLIDES[S.slide]}</p><div class="dots" id="dots">${dotsMarkup()}</div></div>
    <div class="welcome-actions">
      <button class="btn-primary btn-lg" data-action="start">${ic.tray} Start Ordering</button>
      <div class="row">
        <button class="btn-secondary" data-action="queue">View Queue</button>
        <button class="btn-secondary" data-action="help">How It Works</button>
      </div>
    </div>
  </section>`;

/* Caption fades out (.swap), text and dots update at the low point, then it fades back in */
function startCarousel() {
  clearInterval(timers.car);
  timers.car = setInterval(() => {
    const slide = $('slide');
    if (!slide) return;
    S.slide = (S.slide + 1) % SLIDES.length;
    slide.classList.add('swap');
    clearTimeout(timers.carSwap);
    timers.carSwap = setTimeout(() => {
      const el = $('slide');
      const dots = $('dots');
      if (!el || !dots) return;
      el.textContent = SLIDES[S.slide];
      dots.innerHTML = dotsMarkup();
      el.classList.remove('swap');
    }, CAROUSEL_FADE_MS);
  }, CAROUSEL_MS);
}

function stopCarousel() {
  clearInterval(timers.car);
  clearTimeout(timers.carSwap);
}

/* ---------- Order tracking (QR view) ---------- */
/* One shared tracking view: opened by Home's View Queue and by the Complete screen's Track Your Order.
   Replace TRACKING_URL with the final order-tracking website; nothing else needs to change. */
const TRACKING_URL = 'https://pupick.example.com/track';
const QR_IDLE_S = 30;   // seconds without a tap before an unattended QR view closes itself

/* Minimal QR Code encoder (byte mode, error correction M, versions 1-40, auto mask). Returns a boolean grid. */
function qrEncode(text) {
  const ECC = [-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28];
  const BLK = [-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49];
  const bytes = [...new TextEncoder().encode(text)];
  const rawModules = v => {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
    return r;
  };
  const dataWords = v => Math.floor(rawModules(v) / 8) - ECC[v] * BLK[v];

  let ver = 1;
  for (; ver <= 40; ver++) if (4 + (ver < 10 ? 8 : 16) + bytes.length * 8 <= dataWords(ver) * 8) break;
  if (ver > 40) throw new RangeError('Tracking URL is too long for a QR code');

  /* Data bits: mode, length, payload, terminator, padding */
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
  put(0, Math.min(4, dataWords(ver) * 8 - bits.length));
  put(0, (8 - bits.length % 8) % 8);
  for (let pad = 0xEC; bits.length < dataWords(ver) * 8; pad ^= 0xEC ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));

  /* Reed-Solomon error correction over GF(256) */
  const mul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z; };
  const eccLen = ECC[ver];
  const div = new Array(eccLen).fill(0); div[eccLen - 1] = 1;
  for (let i = 0, root = 1; i < eccLen; i++) {
    for (let j = 0; j < eccLen; j++) { div[j] = mul(div[j], root); if (j + 1 < eccLen) div[j] ^= div[j + 1]; }
    root = mul(root, 2);
  }
  const rs = block => {
    const out = new Array(eccLen).fill(0);
    for (const b of block) { const f = b ^ out.shift(); out.push(0); div.forEach((c, i) => { out[i] ^= mul(c, f); }); }
    return out;
  };

  const nBlocks = BLK[ver], raw = Math.floor(rawModules(ver) / 8);
  const nShort = nBlocks - raw % nBlocks, shortLen = Math.floor(raw / nBlocks);
  const blocks = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const d = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
    k += d.length;
    const e = rs(d);
    if (i < nShort) d.push(0);
    blocks.push(d.concat(e));
  }
  const codewords = [];
  for (let i = 0; i < blocks[0].length; i++)
    blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) codewords.push(b[i]); });

  /* Function patterns */
  const size = ver * 4 + 17;
  const grid = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFn = (x, y, v) => { grid[y][x] = v; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
  [[3, 3], [size - 4, 3], [3, size - 4]].forEach(([cx, cy]) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4);
    }
  });
  const nAlign = ver === 1 ? 0 : Math.floor(ver / 7) + 2;
  const pos = [];
  if (nAlign) {
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (nAlign * 2 - 2)) * 2;
    pos.push(6);
    for (let p = size - 7; pos.length < nAlign; p -= step) pos.splice(1, 0, p);
  }
  pos.forEach((cy, i) => pos.forEach((cx, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === nAlign - 1) || (i === nAlign - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
      setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const drawFormat = mask => {
    const d = mask;                                   // error correction M = 00
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const f = ((d << 10) | r) ^ 0x5412, bit = i => ((f >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(i));
    setFn(8, 7, bit(6)); setFn(8, 8, bit(7)); setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i));
    setFn(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let r = ver;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
    const v = (ver << 12) | r;
    for (let i = 0; i < 18; i++) {
      const on = ((v >>> i) & 1) !== 0, a = size - 11 + i % 3, b = Math.floor(i / 3);
      setFn(a, b, on); setFn(b, a, on);
    }
  }

  /* Data modules, zigzag */
  for (let i = 0, right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if (!fn[y][x] && i < codewords.length * 8) { grid[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
    }
  }

  /* Mask: apply each of the 8, keep the lowest penalty */
  const maskFns = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
    (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0
  ];
  const applyMask = m => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && maskFns[m](x, y)) grid[y][x] = !grid[y][x]; };
  const penalty = () => {
    let p = 0, dark = 0;
    const line = get => {
      let run = 1;
      for (let i = 1; i < size; i++) { if (get(i) === get(i - 1)) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; }
      const s = Array.from({ length: size }, (_, i) => (get(i) ? 1 : 0)).join('');
      for (const pat of ['10111010000', '00001011101']) for (let i = s.indexOf(pat); i >= 0; i = s.indexOf(pat, i + 1)) p += 40;
    };
    for (let k = 0; k < size; k++) { line(i => grid[k][i]); line(i => grid[i][k]); }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++)
      if (grid[y][x] === grid[y][x + 1] && grid[y][x] === grid[y + 1][x] && grid[y][x] === grid[y + 1][x + 1]) p += 3;
    grid.forEach(row => row.forEach(c => { if (c) dark++; }));
    return p + (Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size * 10)) - 1) * 10;
  };
  let best = 0, bestPenalty = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m); drawFormat(m);
    const p = penalty();
    if (p < bestPenalty) { best = m; bestPenalty = p; }
    applyMask(m);                                      // undo
  }
  applyMask(best); drawFormat(best);
  return grid;
}

/* QR as inline SVG with the standard 4-module quiet zone, drawn in text colour on white for scanner contrast */
function qrMarkup(text) {
  const grid = qrEncode(text), n = grid.length, q = 4;
  let d = '';
  grid.forEach((row, y) => {
    for (let x = 0; x < n; x++) {
      if (!row[x]) continue;
      let w = 1;
      while (x + w < n && row[x + w]) w++;
      d += `M${x + q} ${y + q}h${w}v1h-${w}z`;
      x += w - 1;
    }
  });
  return `<svg viewBox="0 0 ${n + q * 2} ${n + q * 2}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">
    <rect width="100%" height="100%" style="fill:var(--color-surface)"/><path d="${d}" fill="currentColor"/></svg>`;
}

const isTrackingOpen = () => isModalOpen() && !!$('modal').querySelector('.qr-view');

/* The unattended-kiosk safety net: the QR view closes itself after QR_IDLE_S seconds without a tap */
function armTrackingTimeout() {
  clearTimeout(timers.qr);
  timers.qr = setTimeout(() => { if (isTrackingOpen()) closeModal(); }, QR_IDLE_S * 1000);
}

function openTracking() {
  showModal(`<div class="mhead"><h2>Track Your Order</h2>${closeBtn()}</div>
    <div class="modal-body scroll qr-view">
      <div class="qr-code" role="img" aria-label="QR code that opens the PUPick order tracking website">${qrMarkup(TRACKING_URL)}</div>
      <p class="qr-instruction">Scan the QR code with your phone to track your order.</p>
      <p class="muted">No phone? Ask a staff member nearby.</p>
    </div>`);
  armTrackingTimeout();
}

document.addEventListener('pointerdown', () => { if (isTrackingOpen()) armTrackingTimeout(); }, true);

Object.assign(ACTIONS, {
  start: () => go('stalls'),
  queue: openTracking,
  help: () => showModal(`<div class="mhead"><h2>How It Works</h2>${closeBtn()}</div>
    <div class="modal-body scroll">
      <ol class="modal-list"><li>Tap <b>Start Ordering</b>.</li><li>Choose a stall, then add items to your cart.</li><li>Review your order, then confirm it.</li><li>Pay at the stall using your order number.</li></ol>
      <p class="muted">Need more help? Ask a staff member nearby.</p>
    </div>`)
});

/* ==================== SCREEN: STALLS ==================== */
/* Step 1: search field, category chips and the stall grid. Owns S.q / S.chip and the stall-switch confirmation
   (the dialog itself is the shared confirmDialog). */

views.stalls = () => `<section class="screen">
  ${screenHead({ title: 'Choose a Stall', lede: 'Choose a stall to browse its menu, or search for a dish.', back: 'to-home', step: stepLabel(1) })}
  <div class="toolbar">
    <label class="search">${ic.search}<input id="q" type="search" value="${esc(S.q)}" placeholder="Search stalls or dishes..." aria-label="Search stalls or dishes"></label>
    <button class="btn-quiet" data-action="clear-filters">Clear Filters</button>
  </div>
  <div class="chips" role="group" aria-label="Stall Categories">
    ${DATA.chips.map(c => `<button class="chip" data-action="chip" data-v="${c}" aria-pressed="${c === S.chip}">${c}</button>`).join('')}
  </div>
  <div id="stallGrid" class="scroll bleed"></div>
</section>`;

/* Reflects S.chip on the chip buttons in place (no re-render), like the menu's category buttons */
function syncChips() {
  document.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.v === S.chip));
}

function renderStalls() {
  const q = S.q.trim().toLowerCase();
  const matchesQuery = s =>
    !q ||
    s.name.toLowerCase().includes(q) ||
    s.cat.toLowerCase().includes(q) ||
    (q.length > 2 && DATA.items.some(i => i.name.toLowerCase().includes(q)));
  const list = DATA.stalls.filter(s => (S.chip === 'All' || s.cat === S.chip) && matchesQuery(s));

  $('stallGrid').innerHTML = list.length
    ? `<div class="grid">${list.map(s => `<article class="card tile">
        <div class="ph" aria-hidden="true">${s.e}</div>
        <div class="body">
          <h3>${s.name}</h3>
          <span class="muted">${s.cat}</span>
          <span class="badge">${s.prep} min prep</span>
          <div class="row"><button class="btn-primary btn-block" data-action="stall" data-v="${s.id}">View Menu</button></div>
        </div>
      </article>`).join('')}</div>`
    : '<div class="empty"><div class="em">🔍</div><h3>No stalls found</h3><p>Try another search or clear the filters.</p></div>';
  resetScroll($('stallGrid'));
}

hooks.stalls = renderStalls;

Object.assign(ACTIONS, {
  chip: v => { S.chip = v; syncChips(); renderStalls(); },
  'clear-filters': () => {
    S.q = '';
    S.chip = 'All';
    const q = $('q');
    if (q) q.value = '';
    syncChips();
    renderStalls();
  },
  stall: v => {
    const id = +v;
    if (S.cart.length && S.stall && S.stall !== id) {
      S.pendingStall = id;
      return confirmDialog('Switch Stall?', `Your cart contains items from ${esc(stallObj().name)}. Switching stalls will clear your cart.`, 'Switch Stall', 'switch-stall', 'Keep Order');
    }
    S.stall = id;
    go('menu');
  },
  'switch-stall': () => {
    S.cart = [];
    S.order = null;
    S.stall = S.pendingStall;
    closeModal();
    go('menu');
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'q') {
    S.q = e.target.value;
    renderStalls();
  }
});

/* ==================== SCREEN: MENU ==================== */
/* Step 2: category list and item grid for the chosen stall, plus the item picker modal and add-to-cart.
   Writes shared S.cart; the cart pill and toast it updates are shared systems. */

views.menu = () => {
  const s = stallObj();
  return `<section class="screen">
    ${screenHead({ title: esc(s.name), lede: `Estimated prep time: ${s.prep} min. Browse a category and add what you want to your order.`, back: 'to-stalls', step: stepLabel(2) })}
    <div class="menu">
      <nav class="cats" aria-label="Menu categories">
        ${DATA.cats.map(c => `<button class="cat" data-action="cat" data-v="${c}" aria-pressed="${c === S.cat}">${DATA.emoji[c]} ${c}</button>`).join('')}
      </nav>
      <div id="menuGrid" class="grid is-menu scroll bleed pad-fab"></div>
    </div>
  </section>`;
};

function renderMenu() {
  const list = DATA.items.filter(i => i.cat === S.cat);
  $('menuGrid').innerHTML = list.length
    ? list.map(i => `<article class="card tile">
        <div class="ph" aria-hidden="true">${i.e}</div>
        <div class="body">
          <h3>${i.name}</h3>
          <span class="muted">${i.desc}</span>
          <div class="row"><span class="price">${peso(i.price)}</span><button class="btn-primary" data-action="item" data-v="${i.id}">Add to Cart</button></div>
        </div>
      </article>`).join('')
    : '<div class="empty">No items available in this category.</div>';
  resetScroll($('menuGrid'));
}

hooks.menu = renderMenu;

/* ---------- Item picker modal ---------- */
function openItemModal(id) {
  const i = DATA.items.find(x => x.id === id);
  S.modal = { item: i, qty: 1, addons: new Set(), note: '', busy: false };
  showModal(`<div class="mhead"><h2>${i.name}</h2>${closeBtn('modal-close')}</div>
    <div class="modal-body scroll">
    <div class="ph modal-ph">${i.e}</div>
    <div class="modal-section item-info"><p class="muted">${i.desc}</p><p class="price">${peso(i.price)}</p></div>
    <div class="modal-section qty-row">
      <b>Quantity</b>
      <div class="step">
        <button data-action="mq-" aria-label="Decrease quantity">−</button>
        <output id="mq">1</output>
        <button data-action="mq+" aria-label="Increase quantity">+</button>
      </div>
    </div>
    <section class="modal-section">
      <h3>Optional Add-ons</h3>
      <div class="opts">${DATA.addons.map(a => `<label class="opt"><input type="checkbox" data-addon="${a.id}"><span>${a.name}</span><span>+₱${a.price}</span></label>`).join('')}</div>
    </section>
    <div class="modal-section field">
      <label for="note"><b>Order Notes</b></label>
      <textarea id="note" maxlength="120" placeholder="Add a note (optional)"></textarea>
    </div>
    </div>
    <div class="modal-foot"><button class="btn-primary btn-lg btn-block" id="addBtn" data-action="add-cart"></button></div>`);
  updateModal();
}

function modalTotal() {
  const m = S.modal;
  const extras = addonsTotal(DATA.addons.filter(a => m.addons.has(a.id)));
  return (m.item.price + extras) * m.qty;
}

function updateModal() {
  $('mq').textContent = S.modal.qty;
  $('addBtn').textContent = `Add to Cart · ${peso(modalTotal())}`;
}

/* Re-applies item-modal selections after a confirm dialog replaced the modal markup */
function restoreModal() {
  const m = S.modal;
  if (!m?.item) return;
  m.addons.forEach(id => {
    const box = document.querySelector(`[data-addon="${id}"]`);
    if (box) box.checked = true;
  });
  $('note').value = m.note;
  updateModal();
}

/* Updates the cart pill's counter and replays the .bump animation on it */
function bumpCart() {
  const badge = $('cc');
  badge.textContent = calculateTotals().count;
  badge.classList.remove('bump');
  void badge.offsetWidth; // force reflow so the animation restarts
  badge.classList.add('bump');
}

function addToCart() {
  const m = S.modal;
  if (!m || m.busy) return;
  m.busy = true;
  $('addBtn').disabled = true;

  const addons = DATA.addons.filter(a => m.addons.has(a.id));
  const note = $('note').value.trim();
  const key = m.item.id + addons.map(a => a.id).join() + note;
  const existing = S.cart.find(l => l.key === key);

  if (existing) existing.qty += m.qty;
  else S.cart.push({ uid: ++uid, key, id: m.item.id, name: m.item.name, e: m.item.e, price: m.item.price, qty: m.qty, addons, note });

  closeModal();
  bumpCart();
  toast(`${m.item.name} added to your cart`);
}

Object.assign(ACTIONS, {
  cat: v => {
    S.cat = v;
    document.querySelectorAll('.cat').forEach(c => c.setAttribute('aria-pressed', c.dataset.v === v));
    renderMenu();
  },
  item: openItemModal,
  'mq+': () => { S.modal.qty = Math.min(20, S.modal.qty + 1); updateModal(); },
  'mq-': () => { S.modal.qty = Math.max(1, S.modal.qty - 1); updateModal(); },
  'add-cart': addToCart,
  'modal-close': () => {
    const m = S.modal;
    if (m && (m.qty > 1 || m.addons.size || $('note').value.trim())) {
      confirmDialog('Discard Changes?', 'Your changes to this item will be lost.', 'Discard Changes', 'discard');
    } else {
      closeModal();
    }
  },
  discard: closeModal
});

document.addEventListener('change', e => {
  const addon = e.target.dataset.addon;
  if (!addon || !S.modal) return;
  if (e.target.checked) S.modal.addons.add(addon);
  else S.modal.addons.delete(addon);
  updateModal();
});

document.addEventListener('input', e => {
  if (e.target.id === 'note' && S.modal) S.modal.note = e.target.value;
});

/* ==================== SCREEN: CART ==================== */
/* Step 3: review the order, change quantities, remove items, confirm. Reads and edits shared S.cart. */

views.cart = () => `<section class="screen">
  ${screenHead({ title: 'Your Order', lede: 'Review your order before confirming.', back: S.stall ? 'to-menu' : 'to-stalls', step: stepLabel(3), ledeId: 'cartLede' })}
  <div id="cartView" class="split"></div>
</section>`;

function renderCart() {
  const t = calculateTotals();
  const s = stallObj();
  const wait = s ? s.prep : '5–10';

  const lines = S.cart.map(l => `<div class="line">
      <div class="ph" aria-hidden="true">${l.e}</div>
      <div class="line-info">
        <b>${esc(l.name)}</b>
        <div class="muted">${l.addons.map(a => esc(a.name)).join(', ') || 'No add-ons'}${l.note ? ` · “${esc(l.note)}”` : ''}</div>
        <div class="muted">${peso(l.price + addonsTotal(l.addons))} each</div>
      </div>
      <div class="step">
        <button data-action="dec" data-v="${l.uid}" aria-label="Decrease quantity">−</button>
        <output>${l.qty}</output>
        <button data-action="inc" data-v="${l.uid}" aria-label="Increase quantity">+</button>
      </div>
      <button class="btn-secondary btn-icon" data-action="remove" data-v="${l.uid}" aria-label="Remove ${esc(l.name)} from cart">${ic.close}</button>
    </div>`).join('');

  $('cartLede').textContent = S.cart.length
    ? `${t.count} item${t.count > 1 ? 's' : ''}${s ? ` from ${esc(s.name)}` : ''}. Review your order before confirming.`
    : 'Your cart is empty. Add an item from the menu.';

  const empty = '<div class="empty"><div class="em">🛒</div><h3>Your cart is empty</h3><p>Add an item from the menu to get started.</p></div>';

  /* Only the item list scrolls (.cart-lines, once the order outgrows the screen). It is rebuilt on every
     change, so its scroll position is carried over instead of jumping back to the top. */
  const prevTop = $('cartView').querySelector('.cart-lines')?.scrollTop || 0;

  $('cartView').innerHTML = `<div class="card cart-items"><h2>Your Items</h2><div class="cart-lines scroll">${S.cart.length ? lines : empty}</div></div>
    <aside class="card cart-summary">
      <h2>Order Summary</h2>
      <dl>
        <div class="sum"><dt>Subtotal</dt><dd>${peso(t.subtotal)}</dd></div>
        <div class="sum"><dt>Estimated Preparation</dt><dd>${wait} min</dd></div>
      </dl>
      <p class="notice">Review your items and total before confirming.</p>
      <dl>
        <div class="sum tot"><dt>Total</dt><dd>${peso(t.total)}</dd></div>
      </dl>
    </aside>
    <div class="row actions">
      <button class="btn-secondary" data-action="to-menu">Back to Menu</button>
      <button class="btn-primary" data-action="confirm" ${S.cart.length ? '' : 'disabled'}>Confirm Order</button>
    </div>`;

  if (prevTop) $('cartView').querySelector('.cart-lines').scrollTo({ top: prevTop, behavior: 'instant' });
}

hooks.cart = renderCart;

function updateCartItem(id, delta) {
  const line = S.cart.find(l => l.uid === +id);
  if (!line) return;
  line.qty = Math.max(1, Math.min(20, line.qty + delta));
  renderCart();
}

function removeFromCart(id) {
  S.cart = S.cart.filter(l => l.uid !== +id);
  renderCart();
  toast('Item removed from your cart');
}

Object.assign(ACTIONS, {
  inc: v => updateCartItem(v, 1),
  dec: v => updateCartItem(v, -1),
  remove: v => {
    S.rm = v;
    confirmDialog('Remove Item?', 'This item will be removed from your order.', 'Remove Item', 'rm-yes', 'Keep Item');
  },
  'rm-yes': () => { removeFromCart(S.rm); closeModal(); },
  confirm: () => { if (S.cart.length) go('payment'); }
});

/* ==================== SCREEN: PAYMENT ==================== */
/* Step 4: the order total and the single Payment option. Continuing creates the order (S.order). */

views.payment = () => {
  const t = calculateTotals();
  return `<section class="screen">
  ${screenHead({ title: 'Payment', lede: 'Pay at the stall using your order number.', back: 'to-cart', step: stepLabel(4) })}
  <div class="stage">
    <div class="pay-total">
      <span class="fact-label">Total to Pay</span>
      <b class="fact-value is-amount">${peso(t.total)}</b>
    </div>
    <div class="pay">
      <button data-action="place-order">
        <span class="pay-icon" aria-hidden="true">${ic.cash}</span>
        <span class="pay-name">PAYMENT</span>
        <small>Pay at the stall using your order number</small>
      </button>
    </div>
    <div class="notice is-lg">
      <p>Payment is made at the stall.</p>
      <p>Use your order number when paying. You can pay with cash or scan the stall’s e-wallet QR code directly at the stall.</p>
    </div>
  </div>
</section>`;
};

/* Payment happens at the stall, never on the kiosk: the kiosk takes no payment and shows no payment QR code.
   Order number and time are assigned once per order; totals refresh if the cart changed before continuing. */
function placeOrder() {
  S.printStatus = null;
  const s = stallObj();
  S.order = {
    no: S.order ? S.order.no : ++orderSeq,
    stall: s.name,
    total: calculateTotals().total,
    wait: s.prep,
    time: S.order ? S.order.time : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
  go('placed');
}

Object.assign(ACTIONS, {
  'place-order': placeOrder
});

/* ==================== SCREEN: ORDER PLACED ==================== */
/* "Payment at the Stall": order number, stall and total, plus Print Reference.
   Printing -> (error: retry) -> success goes straight to the Complete screen. */

views.placed = () => `<section class="screen is-centered">
  ${screenHead({ title: 'Payment at the Stall', lede: 'Use your order number at the stall to pay.', step: stepLabel(4), center: true })}
  <div class="confirm" id="payView"></div>
</section>`;

/* Printing -> (error: retry) -> success goes straight to the complete screen, which says to take the slip */
function simulatePrinting() {
  if (S.printStatus === 'printing') return;
  S.printStatus = 'printing';
  renderPay();
  timers.print = setTimeout(() => {
    if (Math.random() < .1) {
      S.printStatus = 'error';
      renderPay();
    } else {
      S.printStatus = null;
      finishOrder();
    }
  }, 2000);
}

/* Order-placed view: order number, stall, total and the reference slip */
function renderPay() {
  const view = $('payView');
  if (!view) return;
  const o = S.order;
  const p = S.printStatus;

  const info = `<div class="details is-single">
    <div><span>Order Number</span><b>#${o.no}</b></div>
    <div><span>Stall</span><b>${esc(o.stall)}</b></div>
    <div><span>Total</span><b>${peso(o.total)}</b></div>
  </div>`;

  const printStatus =
    p === 'printing' ? '<div class="status s-ver"><span class="spin"></span>Printing... Please wait.</div>' :
    p === 'error'    ? '<div class="status s-bad">We couldn\'t print your reference. Try again or ask a staff member for help.</div>' : '';

  const printButton = `<button class="btn-primary btn-lg" data-action="print" ${p === 'printing' ? 'disabled' : ''}>${p === 'error' ? 'Retry Printing' : 'Print Reference'}</button>`;

  const first = !view.firstElementChild;   // the tick pops once; print-status updates must not replay it
  view.innerHTML = `<div class="tick${first ? '' : ' still'}">${ic.check}</div>
    <h2 class="confirm-title">Order Placed Successfully</h2>
    ${info}
    <div class="notice is-lg">Payment is made at the stall. Use your order number when paying. This kiosk does not take payments or show a payment QR code.</div>
    ${printStatus}${printButton}`;
}

hooks.placed = renderPay;

function finishOrder() {
  S.cart = [];
  go('done');
}

Object.assign(ACTIONS, {
  print: simulatePrinting
});

/* ==================== SCREEN: COMPLETE ==================== */
/* Final order screen: take the reference slip, order number and pickup details. A short countdown then moves the
   customer on to the kiosk rating (below); there are no buttons here. Idle reset is off here (see idleReset()). */

const DONE_RATE_S = 5;    // seconds the confirmation screen shows before the rating screen

/* One message per tier. Primary: the heading tells the customer to take the reference slip (the receipt icon
   says the same thing at a glance). Secondary: the order number, payment status and the facts the customer needs. Supporting: one line saying what to do next.
   The kiosk cannot see the kitchen, so nothing here claims the order is already being prepared. */
views.done = () => {
  const o = S.order;
  const stallName = esc(o.stall);
  const payment = `<div class="status s-wait">${ic.clock}<span>Payment due at the stall</span></div>`;
  const next = `Pay at ${stallName} with your order number, then pick up your order there.`;
  return `<section class="screen is-centered">
    ${screenHead({ title: 'Take Your Reference Slip', lede: 'Order confirmed. Printed successfully.', step: 'Complete', center: true, icon: `<div class="slip-badge">${ic.slip}</div>` })}
    <div class="confirm stage">
      <div class="card order-card">
        <span class="fact-label">Order Number</span>
        <b class="order-no">#${o.no}</b>
      </div>
      ${payment}
      <div class="card pay-facts is-3">
        <div class="pay-fact"><span class="fact-label">Stall</span><b class="fact-value">${stallName}</b></div>
        <div class="pay-fact"><span class="fact-label">Order Time</span><b class="fact-value">${o.time}</b></div>
        <div class="pay-fact"><span class="fact-label">Estimated Wait</span><b class="fact-value">${o.wait} min</b></div>
      </div>
      <div class="notice">${next}</div>
      <div class="confirm-actions">
        <p class="muted">Rate your kiosk experience in <b id="cd">${DONE_RATE_S}</b>s</p>
      </div>
    </div>
  </section>`;
};

function startCountdown() {
  let n = DONE_RATE_S;
  clearInterval(timers.cd);
  timers.cd = setInterval(() => {
    n--;
    const e = $('cd');
    if (e) e.textContent = n;
    if (n <= 0) {
      clearInterval(timers.cd);
      go('rate');
    }
  }, 1000);
}

hooks.done = startCountdown;

/* ==================== SCREEN: KIOSK EXPERIENCE RATING ==================== */
/* Five 1-5 star ratings that judge only the kiosk's usability and interface. Submit needs all five; Skip needs
   none. Either one moves to the Thank You screen (S.feedback = 'submitted' | 'skipped', which also blocks a
   second submission). An unattended form is skipped after RATE_IDLE_S (see idleReset()). */

const RATE_IDLE_S = 30;   // seconds without a tap before the rating form is treated as skipped
const THANKS_S = 30;      // seconds the Thank You screen shows before returning to Home
const RATING_ITEMS = [
  { id: 'ease', label: 'Ease of Use' },
  { id: 'navigation', label: 'Navigation' },
  { id: 'responsiveness', label: 'Responsiveness' },
  { id: 'clarity', label: 'Clarity of Information' },
  { id: 'overall', label: 'Overall Experience' }
];
const STAR_COUNT = 5;
const STAR_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z"/></svg>';

/* Submitted ratings are collected here; replace the push in finishRating() with the real backend call */
const feedbackLog = [];

views.rate = () => `<section class="screen is-centered">
    ${screenHead({ title: 'Rate Your Kiosk Experience', lede: 'How was your experience using the kiosk?', step: 'Feedback', center: true })}
    <div class="confirm stage">
      <div class="card rate-card">
        ${RATING_ITEMS.map(item => `<div class="rate-row" role="radiogroup" aria-labelledby="rl-${item.id}" data-rate="${item.id}">
          <span class="rate-label" id="rl-${item.id}">${item.label}</span>
          <div class="stars">
            ${Array.from({ length: STAR_COUNT }, (_, i) => `<label class="star">
              <input type="radio" name="rate-${item.id}" value="${i + 1}" aria-label="${i + 1} ${i ? 'stars' : 'star'}">${STAR_ICON}
            </label>`).join('')}
          </div>
        </div>`).join('')}
      </div>
      <div class="done-actions">
        <button class="btn-secondary btn-lg" data-action="rate-skip">Skip</button>
        <button class="btn-primary btn-lg" data-action="rate-submit">Submit Rating</button>
      </div>
    </div>
  </section>`;

hooks.rate = () => {
  clearInterval(timers.cd);
  idleReset();
};

/* Stars update in place: every star up to the chosen one fills */
document.addEventListener('change', e => {
  const input = e.target.closest?.('.star input');
  if (!input || S.screen !== 'rate') return;
  const row = input.closest('.rate-row');
  const value = +input.value;
  S.ratings[row.dataset.rate] = value;
  row.classList.remove('is-missing');
  row.querySelectorAll('.star').forEach((star, i) => star.classList.toggle('is-on', i < value));
});

function finishRating(kind) {
  if (S.screen !== 'rate' || S.feedback) return;      // one outcome per rating screen, however often it is tapped
  clearTimeout(timers.rateIdle);
  S.feedback = kind;
  if (kind === 'submitted') feedbackLog.push({ order: S.order?.no ?? null, ratings: { ...S.ratings }, at: new Date().toISOString() });
  go('thanks');
}

function submitRating() {
  const missing = RATING_ITEMS.filter(item => !S.ratings[item.id]);
  if (!missing.length) return finishRating('submitted');
  document.querySelectorAll('.rate-row').forEach(row => row.classList.toggle('is-missing', missing.some(item => item.id === row.dataset.rate)));
  toast('Please rate all five items to submit.');
}

/* ==================== SCREEN: THANK YOU ==================== */
/* Confirmation after Submit or Skip, with the Home / View Queue choice and a short countdown to Home.
   The countdown pauses while the QR tracking view is open and restarts in full when it closes. */

views.thanks = () => {
  const sent = S.feedback === 'submitted';
  return `<section class="screen is-centered">
    ${screenHead({
      title: sent ? 'Thank You for Your Feedback!' : 'Thank You for Using the Kiosk!',
      lede: sent ? 'Your feedback has been recorded. Returning to the home screen shortly.' : 'Rating skipped. Returning to the home screen shortly.',
      step: 'Complete',
      center: true,
      icon: sent ? `<div class="tick">${ic.check}</div>` : ''
    })}
    <div class="confirm">
      <div class="confirm-actions">
        <div class="done-actions">
          <button class="btn-secondary btn-lg" data-action="queue">View Queue</button>
          <button class="btn-primary btn-lg" data-action="home">Back to Home</button>
        </div>
        <p class="muted">Returning to Home in <b id="cd">${THANKS_S}</b>s</p>
      </div>
    </div>
  </section>`;
};

hooks.thanks = () => {
  let n = THANKS_S;
  clearInterval(timers.cd);
  timers.cd = setInterval(() => {
    if (isTrackingOpen()) n = THANKS_S + 1;
    n--;
    const e = $('cd');
    if (e) e.textContent = n;
    if (n <= 0) resetSession();
  }, 1000);
};

Object.assign(ACTIONS, {
  'rate-submit': submitRating,
  'rate-skip': () => finishRating('skipped')
});

/* ==================== INITIALIZATION ==================== */
fitKiosk();
renderScreen();
if ('ResizeObserver' in window) new ResizeObserver(syncFabSafeArea).observe($('fab'));   // pill resized (font/breakpoint)
