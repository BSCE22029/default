const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(require('path').join(__dirname, '..', 'public')));
app.use(cookieSession({
  name: 'pos_session',
  keys: [process.env.SESSION_SECRET || 'dev-secret-change-in-production'],
  maxAge: 8 * 60 * 60 * 1000, // 8h shift
}));

function audit(userId, action, entity, entityId, metadata) {
  db.prepare(`INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata) VALUES (?, ?, ?, ?, ?)`)
    .run(userId || null, action, entity || null, entityId || null, metadata ? JSON.stringify(metadata) : null);
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  const user = db.prepare(`SELECT id, role, active FROM users WHERE id = ?`).get(req.session.userId);
  if (!user || !user.active) {
    req.session = null;
    return res.status(401).json({ error: 'Not authenticated' });
  }
  req.session.role = user.role; // keep role in sync if it changed since login
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.session.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// ---------- Health ----------
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ---------- Auth ----------
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = db.prepare(`SELECT * FROM users WHERE email = ? AND active = 1`).get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    audit(null, 'login_failed', 'user', null, { email });
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  req.session.userId = user.id;
  req.session.role = user.role;
  db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(user.id);
  audit(user.id, 'login', 'user', user.id);
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  audit(req.session.userId, 'logout', 'user', req.session.userId);
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = db.prepare(`SELECT id, name, email, role FROM users WHERE id = ?`).get(req.session.userId);
  res.json(user);
});

// ---------- Categories ----------
app.get('/api/categories', requireAuth, (req, res) => {
  res.json(db.prepare(`SELECT * FROM categories ORDER BY name`).all());
});

// ---------- Products ----------
app.get('/api/products', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, c.name AS category_name FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.active = 1 ORDER BY p.name
  `).all();
  res.json(rows);
});

app.post('/api/products', requireAuth, requireRole('admin', 'manager'), (req, res) => {
  const { sku, name, category_id, cost_price, sell_price, tax_rate, stock, min_stock, icon } = req.body || {};
  if (!sku || !name || sell_price == null) return res.status(400).json({ error: 'sku, name, sell_price required' });
  try {
    const info = db.prepare(`
      INSERT INTO products (sku, name, category_id, cost_price, sell_price, tax_rate, stock, min_stock, icon)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sku, name, category_id || null, cost_price || 0, sell_price, tax_rate ?? 0.08, stock || 0, min_stock ?? 5, icon || '📦');
    audit(req.session.userId, 'product_create', 'product', info.lastInsertRowid, req.body);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: e.message.includes('UNIQUE') ? 'SKU already exists' : 'Invalid product data' });
  }
});

app.patch('/api/products/:id', requireAuth, requireRole('admin', 'manager'), (req, res) => {
  const id = +req.params.id;
  const existing = db.prepare(`SELECT * FROM products WHERE id = ?`).get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const fields = ['name', 'category_id', 'cost_price', 'sell_price', 'tax_rate', 'stock', 'min_stock', 'icon', 'active'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  values.push(id);
  db.prepare(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  audit(req.session.userId, 'product_update', 'product', id, req.body);
  res.json({ ok: true });
});

app.delete('/api/products/:id', requireAuth, requireRole('admin'), (req, res) => {
  db.prepare(`UPDATE products SET active = 0 WHERE id = ?`).run(+req.params.id);
  audit(req.session.userId, 'product_deactivate', 'product', +req.params.id);
  res.json({ ok: true });
});

// ---------- Customers ----------
app.get('/api/customers', requireAuth, (req, res) => {
  res.json(db.prepare(`SELECT * FROM customers ORDER BY name`).all());
});

app.post('/api/customers', requireAuth, (req, res) => {
  const { name, phone, email, customer_type, credit_limit } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db.prepare(`
    INSERT INTO customers (name, phone, email, customer_type, credit_limit) VALUES (?, ?, ?, ?, ?)
  `).run(name, phone || null, email || null, customer_type || 'retail', credit_limit || 0);
  audit(req.session.userId, 'customer_create', 'customer', info.lastInsertRowid, req.body);
  res.status(201).json({ id: info.lastInsertRowid });
});

// ---------- Sales (transactional) ----------
app.post('/api/sales', requireAuth, (req, res) => {
  const { items, customer_id, payment_method, amount_tendered, discount_total } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items required' });
  if (!['cash', 'card', 'credit'].includes(payment_method)) return res.status(400).json({ error: 'Invalid payment_method' });

  const runSale = db.transaction(() => {
    let subtotal = 0, taxTotal = 0;
    const lineData = [];

    for (const it of items) {
      const product = db.prepare(`SELECT * FROM products WHERE id = ? AND active = 1`).get(it.product_id);
      if (!product) throw new Error(`Product ${it.product_id} not found`);
      const qty = Number(it.qty);
      if (!Number.isInteger(qty) || qty <= 0) throw new Error(`Invalid quantity for ${product.name}`);
      if (product.stock < qty) throw new Error(`Insufficient stock for ${product.name} (have ${product.stock}, need ${qty})`);

      const lineSubtotal = product.sell_price * qty;
      const lineTax = lineSubtotal * product.tax_rate;
      subtotal += lineSubtotal;
      taxTotal += lineTax;
      lineData.push({ product, qty, lineTotal: lineSubtotal + lineTax });
    }

    const discount = Number(discount_total) || 0;
    const grandTotal = Math.max(0, subtotal + taxTotal - discount);

    if (payment_method === 'cash') {
      if (amount_tendered == null || Number(amount_tendered) < grandTotal) {
        throw new Error('Insufficient cash tendered');
      }
    }
    if (payment_method === 'credit' && !customer_id) {
      throw new Error('Credit sales require a customer');
    }

    const invoiceNo = 'INV-' + Date.now().toString(36).toUpperCase();
    const status = payment_method === 'credit' ? 'credit' : 'paid';
    const changeDue = payment_method === 'cash' ? Number(amount_tendered) - grandTotal : 0;

    const saleInfo = db.prepare(`
      INSERT INTO sales (invoice_no, user_id, customer_id, subtotal, tax_total, discount_total, grand_total, payment_method, amount_tendered, change_due, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(invoiceNo, req.session.userId, customer_id || null, subtotal, taxTotal, discount, grandTotal, payment_method, amount_tendered || null, changeDue, status);
    const saleId = saleInfo.lastInsertRowid;

    for (const { product, qty, lineTotal } of lineData) {
      db.prepare(`
        INSERT INTO sale_items (sale_id, product_id, product_name, qty, unit_price, tax_rate, line_total)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(saleId, product.id, product.name, qty, product.sell_price, product.tax_rate, lineTotal);

      db.prepare(`UPDATE products SET stock = stock - ? WHERE id = ?`).run(qty, product.id);
      db.prepare(`
        INSERT INTO inventory_transactions (product_id, change_qty, reason, ref_sale_id, user_id) VALUES (?, ?, 'sale', ?, ?)
      `).run(product.id, -qty, saleId, req.session.userId);
    }

    if (payment_method === 'credit' && customer_id) {
      db.prepare(`UPDATE customers SET balance = balance + ? WHERE id = ?`).run(grandTotal, customer_id);
    }

    audit(req.session.userId, 'sale_create', 'sale', saleId, { invoiceNo, grandTotal });

    return { id: saleId, invoiceNo, subtotal, taxTotal, discount, grandTotal, changeDue, status };
  });

  try {
    const result = runSale();
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/sales', requireAuth, (req, res) => {
  const sales = db.prepare(`
    SELECT s.*, u.name AS cashier_name, c.name AS customer_name
    FROM sales s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN customers c ON c.id = s.customer_id
    ORDER BY s.id DESC LIMIT 100
  `).all();
  res.json(sales);
});

app.get('/api/sales/:id', requireAuth, (req, res) => {
  const sale = db.prepare(`SELECT * FROM sales WHERE id = ?`).get(+req.params.id);
  if (!sale) return res.status(404).json({ error: 'Not found' });
  const items = db.prepare(`SELECT * FROM sale_items WHERE sale_id = ?`).all(sale.id);
  res.json({ ...sale, items });
});

// ---------- Refunds ----------
app.post('/api/sales/:id/refund', requireAuth, (req, res) => {
  const { sale_item_id, qty, reason } = req.body || {};
  const saleId = +req.params.id;

  const runRefund = db.transaction(() => {
    const item = db.prepare(`SELECT * FROM sale_items WHERE id = ? AND sale_id = ?`).get(sale_item_id, saleId);
    if (!item) throw new Error('Sale item not found');
    const refundQty = Number(qty);
    if (!Number.isInteger(refundQty) || refundQty <= 0) throw new Error('Invalid refund quantity');
    if (item.refunded_qty + refundQty > item.qty) throw new Error('Refund quantity exceeds purchased quantity');

    const unitTotal = item.line_total / item.qty;
    const refundAmount = unitTotal * refundQty;

    db.prepare(`UPDATE sale_items SET refunded_qty = refunded_qty + ? WHERE id = ?`).run(refundQty, item.id);
    db.prepare(`UPDATE products SET stock = stock + ? WHERE id = ?`).run(refundQty, item.product_id);
    db.prepare(`
      INSERT INTO inventory_transactions (product_id, change_qty, reason, ref_sale_id, user_id) VALUES (?, ?, 'refund', ?, ?)
    `).run(item.product_id, refundQty, saleId, req.session.userId);
    const refundInfo = db.prepare(`
      INSERT INTO refunds (sale_id, sale_item_id, qty, amount, reason, user_id) VALUES (?, ?, ?, ?, ?, ?)
    `).run(saleId, item.id, refundQty, refundAmount, reason || null, req.session.userId);

    audit(req.session.userId, 'refund_create', 'sale', saleId, { sale_item_id, refundQty, refundAmount });
    return { id: refundInfo.lastInsertRowid, refundAmount };
  });

  try {
    res.status(201).json(runRefund());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- Reports ----------
app.get('/api/reports/sales-summary', requireAuth, (req, res) => {
  const today = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(grand_total),0) AS revenue
    FROM sales WHERE date(created_at) = date('now') AND status != 'cancelled'
  `).get();
  const cogsRow = db.prepare(`
    SELECT COALESCE(SUM(si.qty * p.cost_price),0) AS cogs
    FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
    WHERE date(s.created_at) = date('now') AND s.status != 'cancelled'
  `).get();
  const topProducts = db.prepare(`
    SELECT si.product_name, SUM(si.qty) AS units_sold, SUM(si.line_total) AS revenue
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.status != 'cancelled'
    GROUP BY si.product_id ORDER BY units_sold DESC LIMIT 5
  `).all();
  const lowStock = db.prepare(`SELECT id, name, stock, min_stock FROM products WHERE active = 1 AND stock <= min_stock`).all();

  res.json({
    today_revenue: today.revenue,
    today_transactions: today.count,
    today_cogs: cogsRow.cogs,
    today_gross_profit: today.revenue - cogsRow.cogs,
    top_products: topProducts,
    low_stock: lowStock,
  });
});

// ---------- Audit (admin only) ----------
app.get('/api/audit-logs', requireAuth, requireRole('admin'), (req, res) => {
  res.json(db.prepare(`
    SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.id DESC LIMIT 200
  `).all());
});

const PORT = process.env.PORT || 4100;
app.listen(PORT, () => console.log(`POS Pro API listening on http://localhost:${PORT}`));
