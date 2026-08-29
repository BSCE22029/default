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

// ---------- Suppliers ----------
app.get('/api/suppliers', requireAuth, (req, res) => {
  res.json(db.prepare(`SELECT * FROM suppliers WHERE active = 1 ORDER BY name`).all());
});

app.get('/api/suppliers/:id', requireAuth, (req, res) => {
  const supplier = db.prepare(`SELECT * FROM suppliers WHERE id = ?`).get(+req.params.id);
  if (!supplier) return res.status(404).json({ error: 'Not found' });
  const purchaseOrders = db.prepare(`
    SELECT id, po_number, status, grand_total, created_at FROM purchase_orders
    WHERE supplier_id = ? ORDER BY id DESC
  `).all(supplier.id);
  const payments = db.prepare(`
    SELECT p.*, u.name AS user_name FROM purchase_payments p LEFT JOIN users u ON u.id = p.user_id
    WHERE p.supplier_id = ? ORDER BY p.id DESC
  `).all(supplier.id);
  res.json({ ...supplier, purchase_orders: purchaseOrders, payments });
});

app.post('/api/suppliers', requireAuth, requireRole('admin', 'manager'), (req, res) => {
  const { name, company, phone, email, address, tax_id, payment_terms } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db.prepare(`
    INSERT INTO suppliers (name, company, phone, email, address, tax_id, payment_terms)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name, company || null, phone || null, email || null, address || null, tax_id || null, payment_terms || null);
  audit(req.session.userId, 'supplier_create', 'supplier', info.lastInsertRowid, req.body);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.patch('/api/suppliers/:id', requireAuth, requireRole('admin', 'manager'), (req, res) => {
  const id = +req.params.id;
  const existing = db.prepare(`SELECT * FROM suppliers WHERE id = ?`).get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const fields = ['name', 'company', 'phone', 'email', 'address', 'tax_id', 'payment_terms', 'active'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  values.push(id);
  db.prepare(`UPDATE suppliers SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  audit(req.session.userId, 'supplier_update', 'supplier', id, req.body);
  res.json({ ok: true });
});

// ---------- Purchase Orders (transactional) ----------
app.get('/api/purchase-orders', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT po.*, s.name AS supplier_name, s.company AS supplier_company
    FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
    ORDER BY po.id DESC
  `).all();
  res.json(rows);
});

app.get('/api/purchase-orders/:id', requireAuth, (req, res) => {
  const po = db.prepare(`
    SELECT po.*, s.name AS supplier_name, s.company AS supplier_company
    FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?
  `).get(+req.params.id);
  if (!po) return res.status(404).json({ error: 'Not found' });
  const items = db.prepare(`SELECT * FROM purchase_order_items WHERE po_id = ?`).all(po.id);
  res.json({ ...po, items });
});

app.post('/api/purchase-orders', requireAuth, requireRole('admin', 'manager'), (req, res) => {
  const { supplier_id, expected_date, items } = req.body || {};
  if (!supplier_id) return res.status(400).json({ error: 'supplier_id required' });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items required' });

  const runCreate = db.transaction(() => {
    const supplier = db.prepare(`SELECT * FROM suppliers WHERE id = ? AND active = 1`).get(supplier_id);
    if (!supplier) throw new Error('Supplier not found');

    let subtotal = 0, taxTotal = 0;
    const lineData = [];
    for (const it of items) {
      const product = db.prepare(`SELECT * FROM products WHERE id = ? AND active = 1`).get(it.product_id);
      if (!product) throw new Error(`Product ${it.product_id} not found`);
      const qty = Number(it.qty);
      const unitCost = Number(it.unit_cost);
      if (!Number.isInteger(qty) || qty <= 0) throw new Error(`Invalid quantity for ${product.name}`);
      if (!(unitCost >= 0)) throw new Error(`Invalid unit cost for ${product.name}`);
      const lineSubtotal = unitCost * qty;
      const lineTax = lineSubtotal * (product.tax_rate || 0);
      subtotal += lineSubtotal;
      taxTotal += lineTax;
      lineData.push({ product, qty, unitCost, taxRate: product.tax_rate || 0, lineTotal: lineSubtotal + lineTax });
    }
    const grandTotal = subtotal + taxTotal;

    const poNumber = 'PO-' + Date.now().toString(36).toUpperCase();
    const poInfo = db.prepare(`
      INSERT INTO purchase_orders (po_number, supplier_id, status, expected_date, subtotal, tax_total, grand_total, user_id)
      VALUES (?, ?, 'ordered', ?, ?, ?, ?, ?)
    `).run(poNumber, supplier_id, expected_date || null, subtotal, taxTotal, grandTotal, req.session.userId);
    const poId = poInfo.lastInsertRowid;

    for (const { product, qty, unitCost, taxRate, lineTotal } of lineData) {
      db.prepare(`
        INSERT INTO purchase_order_items (po_id, product_id, product_name, qty, unit_cost, tax_rate, line_total)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(poId, product.id, product.name, qty, unitCost, taxRate, lineTotal);
    }

    audit(req.session.userId, 'po_create', 'purchase_order', poId, { poNumber, grandTotal });
    return { id: poId, poNumber, grandTotal };
  });

  try {
    res.status(201).json(runCreate());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/purchase-orders/:id/receive', requireAuth, requireRole('admin', 'manager'), (req, res) => {
  const poId = +req.params.id;
  const { items } = req.body || {}; // [{ po_item_id, qty }]
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items required' });

  const runReceive = db.transaction(() => {
    const po = db.prepare(`SELECT * FROM purchase_orders WHERE id = ?`).get(poId);
    if (!po) throw new Error('Purchase order not found');
    if (po.status === 'cancelled') throw new Error('Cannot receive a cancelled purchase order');
    if (po.status === 'received') throw new Error('Purchase order already fully received');

    let amountReceived = 0;
    for (const it of items) {
      const poItem = db.prepare(`SELECT * FROM purchase_order_items WHERE id = ? AND po_id = ?`).get(it.po_item_id, poId);
      if (!poItem) throw new Error(`Line item ${it.po_item_id} not found on this order`);
      const qty = Number(it.qty);
      if (!Number.isInteger(qty) || qty <= 0) throw new Error('Invalid receive quantity');
      const remaining = poItem.qty - poItem.received_qty;
      if (qty > remaining) throw new Error(`Cannot receive ${qty} of ${poItem.product_name} -- only ${remaining} outstanding`);

      db.prepare(`UPDATE purchase_order_items SET received_qty = received_qty + ? WHERE id = ?`).run(qty, poItem.id);
      db.prepare(`UPDATE products SET stock = stock + ? WHERE id = ?`).run(qty, poItem.product_id);
      db.prepare(`
        INSERT INTO inventory_transactions (product_id, change_qty, reason, ref_po_id, user_id)
        VALUES (?, ?, 'purchase_receive', ?, ?)
      `).run(poItem.product_id, qty, poId, req.session.userId);

      amountReceived += qty * poItem.unit_cost * (1 + poItem.tax_rate);
    }

    db.prepare(`UPDATE suppliers SET balance = balance + ? WHERE id = ?`).run(amountReceived, po.supplier_id);

    const allItems = db.prepare(`SELECT * FROM purchase_order_items WHERE po_id = ?`).all(poId);
    const fullyReceived = allItems.every(i => i.received_qty >= i.qty);
    const anyReceived = allItems.some(i => i.received_qty > 0);
    const newStatus = fullyReceived ? 'received' : anyReceived ? 'partially_received' : po.status;
    db.prepare(`UPDATE purchase_orders SET status = ? WHERE id = ?`).run(newStatus, poId);

    audit(req.session.userId, 'po_receive', 'purchase_order', poId, { items, amountReceived, newStatus });
    return { status: newStatus, amountReceived };
  });

  try {
    res.json(runReceive());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/purchase-orders/:id/cancel', requireAuth, requireRole('admin', 'manager'), (req, res) => {
  const poId = +req.params.id;
  const po = db.prepare(`SELECT * FROM purchase_orders WHERE id = ?`).get(poId);
  if (!po) return res.status(404).json({ error: 'Not found' });
  const anyReceived = db.prepare(`SELECT COUNT(*) AS n FROM purchase_order_items WHERE po_id = ? AND received_qty > 0`).get(poId).n;
  if (anyReceived > 0) return res.status(400).json({ error: 'Cannot cancel a purchase order with received items' });
  db.prepare(`UPDATE purchase_orders SET status = 'cancelled' WHERE id = ?`).run(poId);
  audit(req.session.userId, 'po_cancel', 'purchase_order', poId);
  res.json({ ok: true });
});

app.post('/api/purchase-orders/:id/return', requireAuth, requireRole('admin', 'manager'), (req, res) => {
  const poId = +req.params.id;
  const { po_item_id, qty, reason } = req.body || {};

  const runReturn = db.transaction(() => {
    const po = db.prepare(`SELECT * FROM purchase_orders WHERE id = ?`).get(poId);
    if (!po) throw new Error('Purchase order not found');
    const poItem = db.prepare(`SELECT * FROM purchase_order_items WHERE id = ? AND po_id = ?`).get(po_item_id, poId);
    if (!poItem) throw new Error('Line item not found on this order');
    const returnQty = Number(qty);
    if (!Number.isInteger(returnQty) || returnQty <= 0) throw new Error('Invalid return quantity');
    const returnable = poItem.received_qty - poItem.returned_qty;
    if (returnQty > returnable) throw new Error(`Cannot return ${returnQty} -- only ${returnable} available to return`);

    const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(poItem.product_id);
    if (product.stock < returnQty) throw new Error(`Cannot return ${returnQty} of ${poItem.product_name} -- only ${product.stock} in stock`);

    const returnAmount = returnQty * poItem.unit_cost * (1 + poItem.tax_rate);

    db.prepare(`UPDATE purchase_order_items SET returned_qty = returned_qty + ? WHERE id = ?`).run(returnQty, poItem.id);
    db.prepare(`UPDATE products SET stock = stock - ? WHERE id = ?`).run(returnQty, poItem.product_id);
    db.prepare(`
      INSERT INTO inventory_transactions (product_id, change_qty, reason, ref_po_id, user_id)
      VALUES (?, ?, 'purchase_return', ?, ?)
    `).run(poItem.product_id, -returnQty, poId, req.session.userId);
    db.prepare(`UPDATE suppliers SET balance = balance - ? WHERE id = ?`).run(returnAmount, po.supplier_id);

    const info = db.prepare(`
      INSERT INTO purchase_returns (po_id, po_item_id, supplier_id, qty, amount, reason, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(poId, poItem.id, po.supplier_id, returnQty, returnAmount, reason || null, req.session.userId);

    audit(req.session.userId, 'po_return', 'purchase_order', poId, { po_item_id, returnQty, returnAmount });
    return { id: info.lastInsertRowid, returnAmount };
  });

  try {
    res.status(201).json(runReturn());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- Purchase Payments ----------
app.post('/api/purchase-payments', requireAuth, requireRole('admin', 'manager'), (req, res) => {
  const { supplier_id, po_id, amount, method, note } = req.body || {};
  const amt = Number(amount);
  if (!supplier_id || !(amt > 0)) return res.status(400).json({ error: 'supplier_id and a positive amount are required' });

  const runPayment = db.transaction(() => {
    const supplier = db.prepare(`SELECT * FROM suppliers WHERE id = ?`).get(supplier_id);
    if (!supplier) throw new Error('Supplier not found');
    const info = db.prepare(`
      INSERT INTO purchase_payments (supplier_id, po_id, amount, method, note, user_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(supplier_id, po_id || null, amt, method || 'cash', note || null, req.session.userId);
    db.prepare(`UPDATE suppliers SET balance = balance - ? WHERE id = ?`).run(amt, supplier_id);
    audit(req.session.userId, 'supplier_payment', 'supplier', supplier_id, { amount: amt, po_id });
    return { id: info.lastInsertRowid };
  });

  try {
    res.status(201).json(runPayment());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
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
  const payables = db.prepare(`SELECT COALESCE(SUM(balance),0) AS total FROM suppliers WHERE active = 1 AND balance > 0`).get();
  const openPOs = db.prepare(`SELECT COUNT(*) AS n FROM purchase_orders WHERE status IN ('ordered','partially_received')`).get();

  res.json({
    today_revenue: today.revenue,
    today_transactions: today.count,
    today_cogs: cogsRow.cogs,
    today_gross_profit: today.revenue - cogsRow.cogs,
    top_products: topProducts,
    low_stock: lowStock,
    total_payables: payables.total,
    open_purchase_orders: openPOs.n,
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
