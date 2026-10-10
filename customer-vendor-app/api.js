'use strict';

/* ==================== api.js — THE ONLY FILE THAT KNOWS WHERE DATA COMES FROM ====================
   vendor.js calls only the functions returned at the bottom (login, getOrders, setStatus, ...).
   Today they read and write MOCK data in memory. When the backend exists, rewrite the bodies of
   these functions as fetch() calls (see the "BACKEND:" comments) and leave vendor.js unchanged.
   Every function returns a Promise on purpose, so switching to fetch() needs no changes elsewhere.

   ORDER SHAPE (field names are meant to map 1:1 to a future `orders` table):
   { order_no, queue_no, stall_id, source: 'kiosk' | 'mobile', customer_name | null, payment_method: 'cash' | 'ewallet' | null,
     status, total (pesos), created_at (ISO 8601 string), items: [{ name, qty, price, addons: [names], note }] }
   payment_method is null until the customer pays. E-wallet customers upload a screenshot of their transaction
   (receipt_image, receipt_uploaded_at; both null otherwise) and the vendor checks it against the total before accepting.       */

const STATUS = ['pending', 'accepted', 'preparing', 'ready', 'claimed'];   // same strings as the future DB column
const NEXT = { pending: 'accepted', accepted: 'preparing', preparing: 'ready', ready: 'claimed' };
const POLL_MS = 3000;                                                      // how often the dashboard asks for new orders

const api = (() => {
  /* ---------- MOCK DATA (delete this block when the backend exists) ---------- */
  const DEMO_VENDORS = [{ username: 'vendor', password: 'vendor123', name: 'Vendor Name', stall_id: 1 }];
  const MOCK_SALES_BASE = 12450;                                           // pretend earlier sales today
  const ago = min => new Date(Date.now() - min * 60000).toISOString();
  /* Fake e-wallet screenshot for the demo. BACKEND: receipt_image becomes the URL of the file the customer uploaded
     (payments.receipt_image), served by PHP, and is used as the <img> source as-is. */
  const receipt = (amount, ref) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 560"><rect width="360" height="560" fill="#f3f6fb"/>
     <rect width="360" height="110" fill="#1c6fd1"/><text x="180" y="62" font-family="Arial" font-size="22" font-weight="700" fill="#fff" text-anchor="middle">Payment Successful</text>
     <circle cx="180" cy="150" r="30" fill="#2e9b57"/><path d="M165 150l11 11 20-22" stroke="#fff" stroke-width="6" fill="none"/>
     <text x="180" y="225" font-family="Arial" font-size="38" font-weight="700" fill="#16202c" text-anchor="middle">₱${amount}.00</text>
     <text x="180" y="262" font-family="Arial" font-size="15" fill="#5c636a" text-anchor="middle">Sent to PUPick Stall 1</text>
     <line x1="30" y1="300" x2="330" y2="300" stroke="#d6dde8"/>
     <text x="30" y="335" font-family="Arial" font-size="14" fill="#5c636a">Reference No.</text><text x="330" y="335" font-family="Arial" font-size="14" font-weight="700" fill="#16202c" text-anchor="end">${ref}</text>
     <text x="30" y="370" font-family="Arial" font-size="14" fill="#5c636a">Date</text><text x="330" y="370" font-family="Arial" font-size="14" font-weight="700" fill="#16202c" text-anchor="end">${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</text>
     <text x="30" y="405" font-family="Arial" font-size="14" fill="#5c636a">Amount</text><text x="330" y="405" font-family="Arial" font-size="14" font-weight="700" fill="#16202c" text-anchor="end">₱${amount}.00</text></svg>`);
  const item = (name, qty = 1, price = 0) => ({ name, qty, price, addons: [], note: '' });

  let orders = [
    { order_no: 1025, queue_no: 120, stall_id: 1, source: 'mobile', customer_name: 'Juan Dela Cruz', payment_method: 'ewallet', status: 'pending',   total: 185, created_at: ago(5),  receipt_image: receipt(185, '7041 982 335'), receipt_uploaded_at: ago(4), items: [item('Burger'), item('Fries'), item('Iced Tea')] },
    { order_no: 1024, queue_no: 119, stall_id: 1, source: 'mobile', customer_name: 'Maria Santos',   payment_method: 'cash',    status: 'preparing', total: 145, created_at: ago(9),  items: [item('Chicken Rice'), item('Lemonade')] },
    { order_no: 1023, queue_no: 118, stall_id: 1, source: 'mobile', customer_name: 'Mark Reyes',     payment_method: 'ewallet', status: 'ready',     total: 130, created_at: ago(12), receipt_image: receipt(130, '7041 981 207'), receipt_uploaded_at: ago(11), items: [item('Nachos'), item('Iced Coffee')] },
    { order_no: 1022, queue_no: 117, stall_id: 1, source: 'kiosk', customer_name: null, payment_method: 'cash',    status: 'claimed',   total: 95,  created_at: ago(25), items: [item('Silog Meal')] }
  ];

  /* The latest kiosk (script.js) sends nothing to the vendor yet: placeOrder() only shows the order number and the
     customer pays at the stall. For the frontend demo, JD can add one call after placeOrder() builds S.order:
       new BroadcastChannel('pupick-vendor').postMessage({ type: 'order-placed', orderNo: S.order.no, stallId: S.stall,
         total: S.order.total, items: S.cart.map(l => ({ name: l.name, qty: l.qty, price: l.price,
         addons: l.addons.map(a => a.name), note: l.note })) });
     BACKEND: that call becomes a POST to the PHP endpoint, and the server (not this file) assigns order_no and queue_no. */
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('pupick-vendor') : null;
  if (channel) {
    channel.onmessage = e => {
      const m = e.data;
      if (!m || m.type !== 'order-placed' || orders.some(o => o.order_no === m.orderNo)) return;
      orders.push({
        order_no: m.orderNo, queue_no: m.orderNo, stall_id: m.stallId, source: 'kiosk', customer_name: null,
        payment_method: null, status: 'pending', total: m.total, created_at: new Date().toISOString(),
        items: m.items || []
      });
      refresh();
    };
  }

  /* ---------- SESSION ---------- */
  const KEY = 'pupick-vendor';
  // BACKEND: the server sets a session cookie or returns a token; keep the token here instead of the user object.
  const currentUser = () => {
    try { return JSON.parse(sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || 'null'); }
    catch { return null; }
  };

  async function login(username, password, remember) {
    // BACKEND: POST /api/login { username, password } -> { name, stall_id, token }
    const v = DEMO_VENDORS.find(x => x.username === username && x.password === password);
    if (!v) throw new Error('Incorrect username or password.');
    const user = { username: v.username, name: v.name, stall_id: v.stall_id };
    (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(user));
    return user;
  }

  function logout() {
    sessionStorage.removeItem(KEY);
    localStorage.removeItem(KEY);
    // BACKEND: POST /api/logout
  }

  /* ---------- ORDERS ---------- */
  async function getOrders() {
    // BACKEND: GET /api/orders  -> today's orders for the logged-in vendor's stall (the server knows the stall)
    const u = currentUser();
    return orders.filter(o => o.stall_id === u.stall_id).map(o => ({ ...o, items: o.items.map(i => ({ ...i })) }));
  }

  async function setStatus(orderNo, status) {
    // BACKEND: PATCH /api/orders/:orderNo { status } — the server validates the change.
    //          Accepting an order means the vendor received the payment at the stall.
    const o = orders.find(x => x.order_no === orderNo);
    if (!o) throw new Error('Order not found.');
    if (NEXT[o.status] !== status) throw new Error(`An order cannot go from ${o.status} to ${status}.`);
    o.status = status;
    return { ...o };
  }

  async function getSummary() {
    // BACKEND: GET /api/summary -> { sales_today }, summed from the transactions table
    const u = currentUser();
    const done = orders.filter(o => o.stall_id === u.stall_id && ['ready', 'claimed'].includes(o.status));
    return { sales_today: MOCK_SALES_BASE + done.reduce((sum, o) => sum + o.total, 0) };
  }

  /* ---------- MENU ----------
     Item shape matches `menu_items`: { menu_item_id, stall_id, category, item_name, description, price, is_available }.
     The demo keeps the menu in localStorage ('pupick-menu') so it survives a refresh and the kiosk, opened in the same
     browser, can read it: JSON.parse(localStorage.getItem('pupick-menu')) and show items where is_available is true.
     BACKEND: the kiosk will read the same GET /api/menu endpoint instead of its hard-coded DATA.items. */
  const DEFAULT_CATEGORIES = ['Rice Meals', 'Silog Meals', 'Lutong Bahay', 'Merienda & Snacks', 'Drinks', 'Desserts'];
  const CAT_KEY = 'pupick-categories';
  const readCats = () => { try { const s = JSON.parse(localStorage.getItem(CAT_KEY)); if (Array.isArray(s) && s.length) return s; } catch { /* use the defaults */ } return [...DEFAULT_CATEGORIES]; };
  let cats = readCats();
  const MENU_KEY = 'pupick-menu';
  const seedMenu = () => [
    ['Merienda & Snacks', 'Burger', 'Beef patty with lettuce and sauce', 90, 1], ['Merienda & Snacks', 'Fries', 'Crispy potato fries', 45, 1],
    ['Merienda & Snacks', 'Nachos', 'Tortilla chips with cheese sauce', 75, 1], ['Drinks', 'Iced Tea', 'House-blend iced tea', 50, 1],
    ['Drinks', 'Lemonade', 'Fresh lemonade', 50, 1], ['Drinks', 'Iced Coffee', 'Sweet iced coffee', 55, 1],
    ['Rice Meals', 'Chicken Rice', 'Fried chicken with garlic rice', 95, 1], ['Rice Meals', 'Pork Sisig', 'Sizzling pork sisig with rice', 110, 0],
    ['Silog Meals', 'Silog Meal', 'Egg, garlic rice and your choice of meat', 95, 1], ['Desserts', 'Leche Flan', 'Creamy caramel custard', 40, 1]
  ].map(([category, item_name, description, price, on], i) => ({ menu_item_id: i + 1, stall_id: 1, category, item_name, description, price, is_available: !!on }));
  const readMenu = () => { try { const s = JSON.parse(localStorage.getItem(MENU_KEY)); if (Array.isArray(s)) return s; } catch { /* use the seed */ } return seedMenu(); };
  const writeMenu = () => { try { localStorage.setItem(MENU_KEY, JSON.stringify(menu)); } catch { /* storage full or blocked */ } };
  let menu = readMenu();

  async function getCategories() { return [...cats]; }   // BACKEND: GET /api/categories (the `categories` table)

  async function addCategory(name) {
    // BACKEND: POST /api/categories { category_name }. In the database today `categories` is shared by all stalls and
    //          category_name is UNIQUE, so a category added by one vendor shows up for every vendor.
    const n = String(name || '').replace(/\s+/g, ' ').trim();
    if (!n) throw new Error('Enter a category name.');
    if (n.length > 100) throw new Error('The category name must be 100 characters or fewer.');
    if (cats.some(c => c.toLowerCase() === n.toLowerCase())) throw new Error('That category already exists.');
    cats.push(n);
    try { localStorage.setItem(CAT_KEY, JSON.stringify(cats)); } catch { /* storage full or blocked */ }
    return n;
  }

  async function getMenu() {
    // BACKEND: GET /api/menu -> this stall's rows from `menu_items`
    const u = currentUser();
    return menu.filter(i => i.stall_id === u.stall_id).map(i => ({ ...i }));
  }

  async function saveMenuItem(item) {
    // BACKEND: POST /api/menu (new item) or PUT /api/menu/:id (edit). The server must repeat these checks.
    const u = currentUser();
    const name = String(item.item_name || '').trim(), desc = String(item.description || '').trim(), price = Number(item.price);
    if (!name || name.length > 100) throw new Error('Enter an item name (up to 100 characters).');
    if (!cats.includes(item.category)) throw new Error('Choose a category.');
    if (!(price >= 1 && price <= 9999.99) || Math.abs(price * 100 - Math.round(price * 100)) > 1e-6) throw new Error('Enter a price from 1 to 9,999.99 with at most 2 decimals.');
    if (desc.length > 255) throw new Error('The description must be 255 characters or fewer.');
    if (menu.some(i => i.stall_id === u.stall_id && i.menu_item_id !== item.menu_item_id && i.item_name.toLowerCase() === name.toLowerCase())) throw new Error('An item with that name already exists.');
    const row = { category: item.category, item_name: name, description: desc, price: Math.round(price * 100) / 100, is_available: !!item.is_available };
    if (item.menu_item_id) {
      const cur = menu.find(i => i.menu_item_id === item.menu_item_id && i.stall_id === u.stall_id);
      if (!cur) throw new Error('Item not found.');
      Object.assign(cur, row); writeMenu();
      return { ...cur };
    }
    const created = { menu_item_id: Math.max(0, ...menu.map(i => i.menu_item_id)) + 1, stall_id: u.stall_id, ...row };
    menu.push(created); writeMenu();
    return { ...created };
  }

  async function setAvailability(id, on) {
    // BACKEND: PATCH /api/menu/:id { is_available }
    const cur = menu.find(i => i.menu_item_id === id && i.stall_id === currentUser().stall_id);
    if (!cur) throw new Error('Item not found.');
    cur.is_available = !!on; writeMenu();
    return { ...cur };
  }

  async function deleteMenuItem(id) {
    // BACKEND: DELETE /api/menu/:id. `order_items` points at `menu_items`, so the server should hide (soft-delete) any
    //          item that was ever ordered instead of removing its row.
    const u = currentUser();
    menu = menu.filter(i => !(i.menu_item_id === id && i.stall_id === u.stall_id));
    writeMenu();
  }

  /* ---------- FEEDBACK & SETTINGS ---------- */
  /* rating = overall experience; food_quality and service match the customer review screen (Figure 9 in the manuscript).
     BACKEND: the `feedback` table only has one `rating` column today, so Sandrew needs to add food_quality and service. */
  let feedback = [
    { feedback_id: 1, order_no: 1023, customer_name: 'Mark Reyes',   rating: 5, food_quality: 5, service: 5, comment: 'Fast and tasty!',        created_at: ago(8) },
    { feedback_id: 2, order_no: 1024, customer_name: 'Maria Santos', rating: 4, food_quality: 4, service: 3, comment: 'Good, a bit of a wait.', created_at: ago(30) },
    { feedback_id: 3, order_no: 1022, customer_name: null,           rating: 3, food_quality: 3, service: 4, comment: '',                       created_at: ago(120) }
  ];
  let settings = { stall_name: 'Stall 1', description: 'Rice meals, snacks, and beverages', prep_time_min: 15, status: 'open', qr_image: null };

  async function getFeedback() {
    // BACKEND: GET /api/feedback -> this stall's rows from `feedback`, joined with orders.order_number and users.full_name
    return feedback.map(f => ({ ...f }));
  }
  async function getRatings() {
    // BACKEND: GET /api/ratings -> averages computed in SQL from `feedback` (stall level), and per menu item by joining
    //          feedback -> orders -> order_items -> menu_items. The shape below is what the dashboard expects.
    const n = feedback.length;
    const avg = k => n ? feedback.reduce((s, f) => s + f[k], 0) / n : 0;
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    feedback.forEach(f => { distribution[f.rating]++; });
    const byItem = {};
    feedback.forEach(f => {
      const o = orders.find(x => x.order_no === f.order_no);
      if (o) o.items.forEach(i => { (byItem[i.name] = byItem[i.name] || []).push(f.rating); });
    });
    const items = Object.entries(byItem)
      .map(([name, r]) => ({ name, average: r.reduce((s, x) => s + x, 0) / r.length, count: r.length }))
      .sort((x, y) => y.average - x.average || y.count - x.count);
    return { average: avg('rating'), count: n, distribution, categories: { food_quality: avg('food_quality'), service: avg('service') }, items };
  }
  async function getSettings() {
    // BACKEND: GET /api/stall -> the `stalls` row for the logged-in owner (stall_name, description, prep_time_min, status)
    return { ...settings };
  }
  async function saveSettings(next) {
    // BACKEND: PUT /api/stall { stall_name, description, prep_time_min, status } and upload the QR image as a file
    settings = { ...settings, ...next };
    return { ...settings };
  }

  /* ---------- LIVE UPDATES: polling ----------
     Works across devices on the kiosk's local Wi-Fi with a plain PHP endpoint (no WebSockets needed). */
  const listeners = new Set();
  let timer = null;
  let lastSig = '';

  async function refresh(force = false) {
    if (!currentUser() || !listeners.size) return;
    try {
      const list = await getOrders();
      const sig = JSON.stringify(list);
      if (!force && sig === lastSig) return;
      lastSig = sig;
      listeners.forEach(fn => fn(list));
    } catch (err) {
      console.warn('Could not load orders:', err.message);   // later: show an "offline" banner (the LAN can drop)
    }
  }

  function onOrders(cb) {
    listeners.add(cb);
    lastSig = '';
    refresh(true);
    if (!timer) timer = setInterval(refresh, POLL_MS);
    return () => {
      listeners.delete(cb);
      if (!listeners.size) { clearInterval(timer); timer = null; }
    };
  }

  return { login, logout, currentUser, getOrders, setStatus, getSummary, getCategories, addCategory, getMenu, saveMenuItem, setAvailability, deleteMenuItem, getFeedback, getRatings, getSettings, saveSettings, onOrders, refresh };
})();
