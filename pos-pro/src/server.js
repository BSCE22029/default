const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const { pool, query, one, all, insertId, withTransaction, ensureSchema } = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(require('path').join(__dirname, '..', 'public')));
app.use(cookieSession({
  name: 'pos_session',
  keys: [process.env.SESSION_SECRET || 'dev-secret-change-in-production'],
  maxAge: 8 * 60 * 60 * 1000, // 8h shift
}));

// Every request waits for the (idempotent, cached-after-first-run) schema check.
app.use((req, res, next) => { ensureSchema().then(() => next()).catch(next); });

async function audit(executor, userId, action, entity, entityId, metadata) {
  await insertId(executor, `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata) VALUES (?, ?, ?, ?, ?)`,
    [userId || null, action, entity || null, entityId || null, metadata ? JSON.stringify(metadata) : null]);
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

async function requireAuth(req, res, next) {
  try {
    if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
    const user = await one(pool, `SELECT id, role, active FROM users WHERE id = ?`, [req.session.userId]);
    if (!user || !user.active) {
      req.session = null;
      return res.status(401).json({ error: 'Not authenticated' });
    }
    req.session.role = user.role;
    next();
  } catch (e) { next(e); }
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
app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = await one(pool, `SELECT * FROM users WHERE email = ? AND active = 1`, [email]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    await audit(pool, null, 'login_failed', 'user', null, { email });
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  req.session.userId = user.id;
  req.session.role = user.role;
  await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);
  await audit(pool, user.id, 'login', 'user', user.id);
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
}));

app.post('/api/auth/logout', requireAuth, asyncHandler(async (req, res) => {
  await audit(pool, req.session.userId, 'logout', 'user', req.session.userId);
  req.session = null;
  res.json({ ok: true });
}));

app.get('/api/auth/me', requireAuth, asyncHandler(async (req, res) => {
  const user = await one(pool, `SELECT id, name, email, role FROM users WHERE id = ?`, [req.session.userId]);
  res.json(user);
}));

// ---------- Categories ----------
app.get('/api/categories', requireAuth, asyncHandler(async (req, res) => {
  res.json(await all(pool, `SELECT * FROM categories ORDER BY name`));
}));

// ---------- Products ----------
app.get('/api/products', requireAuth, asyncHandler(async (req, res) => {
  const rows = await all(pool, `
    SELECT p.*, c.name AS category_name FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.active = 1 ORDER BY p.name
  `);
  res.json(rows);
}));

app.post('/api/products', requireAuth, requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const { sku, name, category_id, cost_price, sell_price, tax_rate, stock, min_stock, icon } = req.body || {};
  if (!sku || !name || sell_price == null) return res.status(400).json({ error: 'sku, name, sell_price required' });
  try {
    const id = await insertId(pool, `
      INSERT INTO products (sku, name, category_id, cost_price, sell_price, tax_rate, stock, min_stock, icon)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [sku, name, category_id || null, cost_price || 0, sell_price, tax_rate ?? 0.08, stock || 0, min_stock ?? 5, icon || '📦']);
    await audit(pool, req.session.userId, 'product_create', 'product', id, req.body);
    res.status(201).json({ id });
  } catch (e) {
    res.status(400).json({ error: e.code === '23505' ? 'SKU already exists' : 'Invalid product data' });
  }
}));

app.patch('/api/products/:id', requireAuth, requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const id = +req.params.id;
  const existing = await one(pool, `SELECT * FROM products WHERE id = ?`, [id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const fields = ['name', 'category_id', 'cost_price', 'sell_price', 'tax_rate', 'stock', 'min_stock', 'icon', 'active'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  values.push(id);
  await query(pool, `UPDATE products SET ${updates.join(', ')} WHERE id = ?`, values);
  await audit(pool, req.session.userId, 'product_update', 'product', id, req.body);
  res.json({ ok: true });
}));

app.delete('/api/products/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  await query(pool, `UPDATE products SET active = 0 WHERE id = ?`, [+req.params.id]);
  await audit(pool, req.session.userId, 'product_deactivate', 'product', +req.params.id);
  res.json({ ok: true });
}));

// ---------- Customers ----------
app.get('/api/customers', requireAuth, asyncHandler(async (req, res) => {
  res.json(await all(pool, `SELECT * FROM customers ORDER BY name`));
}));

app.post('/api/customers', requireAuth, asyncHandler(async (req, res) => {
  const { name, phone, email, customer_type, credit_limit } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = await insertId(pool, `
    INSERT INTO customers (name, phone, email, customer_type, credit_limit) VALUES (?, ?, ?, ?, ?)
  `, [name, phone || null, email || null, customer_type || 'retail', credit_limit || 0]);
  await audit(pool, req.session.userId, 'customer_create', 'customer', id, req.body);
  res.status(201).json({ id });
}));

// ---------- Suppliers ----------
app.get('/api/suppliers', requireAuth, asyncHandler(async (req, res) => {
  res.json(await all(pool, `SELECT * FROM suppliers WHERE active = 1 ORDER BY name`));
}));

app.get('/api/suppliers/:id', requireAuth, asyncHandler(async (req, res) => {
  const supplier = await one(pool, `SELECT * FROM suppliers WHERE id = ?`, [+req.params.id]);
  if (!supplier) return res.status(404).json({ error: 'Not found' });
  const purchaseOrders = await all(pool, `
    SELECT id, po_number, status, grand_total, created_at FROM purchase_orders
    WHERE supplier_id = ? ORDER BY id DESC
  `, [supplier.id]);
  const payments = await all(pool, `
    SELECT p.*, u.name AS user_name FROM purchase_payments p LEFT JOIN users u ON u.id = p.user_id
    WHERE p.supplier_id = ? ORDER BY p.id DESC
  `, [supplier.id]);
  res.json({ ...supplier, purchase_orders: purchaseOrders, payments });
}));

app.post('/api/suppliers', requireAuth, requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const { name, company, phone, email, address, tax_id, payment_terms } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = await insertId(pool, `
    INSERT INTO suppliers (name, company, phone, email, address, tax_id, payment_terms)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [name, company || null, phone || null, email || null, address || null, tax_id || null, payment_terms || null]);
  await audit(pool, req.session.userId, 'supplier_create', 'supplier', id, req.body);
  res.status(201).json({ id });
}));

app.patch('/api/suppliers/:id', requireAuth, requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const id = +req.params.id;
  const existing = await one(pool, `SELECT * FROM suppliers WHERE id = ?`, [id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const fields = ['name', 'company', 'phone', 'email', 'address', 'tax_id', 'payment_terms', 'active'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  values.push(id);
  await query(pool, `UPDATE suppliers SET ${updates.join(', ')} WHERE id = ?`, values);
  await audit(pool, req.session.userId, 'supplier_update', 'supplier', id, req.body);
  res.json({ ok: true });
}));

// ---------- Purchase Orders (transactional) ----------
app.get('/api/purchase-orders', requireAuth, asyncHandler(async (req, res) => {
  const rows = await all(pool, `
    SELECT po.*, s.name AS supplier_name, s.company AS supplier_company
    FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
    ORDER BY po.id DESC
  `);
  res.json(rows);
}));

app.get('/api/purchase-orders/:id', requireAuth, asyncHandler(async (req, res) => {
  const po = await one(pool, `
    SELECT po.*, s.name AS supplier_name, s.company AS supplier_company
    FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?
  `, [+req.params.id]);
  if (!po) return res.status(404).json({ error: 'Not found' });
  const items = await all(pool, `SELECT * FROM purchase_order_items WHERE po_id = ?`, [po.id]);
  res.json({ ...po, items });
}));

app.post('/api/purchase-orders', requireAuth, requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const { supplier_id, expected_date, items } = req.body || {};
  if (!supplier_id) return res.status(400).json({ error: 'supplier_id required' });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items required' });

  try {
    const result = await withTransaction(async (client) => {
      const supplier = await one(client, `SELECT * FROM suppliers WHERE id = ? AND active = 1`, [supplier_id]);
      if (!supplier) throw new Error('Supplier not found');

      let subtotal = 0, taxTotal = 0;
      const lineData = [];
      for (const it of items) {
        const product = await one(client, `SELECT * FROM products WHERE id = ? AND active = 1`, [it.product_id]);
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
      const poId = await insertId(client, `
        INSERT INTO purchase_orders (po_number, supplier_id, status, expected_date, subtotal, tax_total, grand_total, user_id)
        VALUES (?, ?, 'ordered', ?, ?, ?, ?, ?)
      `, [poNumber, supplier_id, expected_date || null, subtotal, taxTotal, grandTotal, req.session.userId]);

      for (const { product, qty, unitCost, taxRate, lineTotal } of lineData) {
        await insertId(client, `
          INSERT INTO purchase_order_items (po_id, product_id, product_name, qty, unit_cost, tax_rate, line_total)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [poId, product.id, product.name, qty, unitCost, taxRate, lineTotal]);
      }

      await audit(client, req.session.userId, 'po_create', 'purchase_order', poId, { poNumber, grandTotal });
      return { id: poId, poNumber, grandTotal };
    });
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

app.post('/api/purchase-orders/:id/receive', requireAuth, requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const poId = +req.params.id;
  const { items } = req.body || {}; // [{ po_item_id, qty }]
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items required' });

  try {
    const result = await withTransaction(async (client) => {
      const po = await one(client, `SELECT * FROM purchase_orders WHERE id = ?`, [poId]);
      if (!po) throw new Error('Purchase order not found');
      if (po.status === 'cancelled') throw new Error('Cannot receive a cancelled purchase order');
      if (po.status === 'received') throw new Error('Purchase order already fully received');

      let amountReceived = 0;
      for (const it of items) {
        const poItem = await one(client, `SELECT * FROM purchase_order_items WHERE id = ? AND po_id = ?`, [it.po_item_id, poId]);
        if (!poItem) throw new Error(`Line item ${it.po_item_id} not found on this order`);
        const qty = Number(it.qty);
        if (!Number.isInteger(qty) || qty <= 0) throw new Error('Invalid receive quantity');
        const remaining = poItem.qty - poItem.received_qty;
        if (qty > remaining) throw new Error(`Cannot receive ${qty} of ${poItem.product_name} -- only ${remaining} outstanding`);

        await client.query(toPgLocal(`UPDATE purchase_order_items SET received_qty = received_qty + ? WHERE id = ?`), [qty, poItem.id]);
        await client.query(toPgLocal(`UPDATE products SET stock = stock + ? WHERE id = ?`), [qty, poItem.product_id]);
        await insertId(client, `
          INSERT INTO inventory_transactions (product_id, change_qty, reason, ref_po_id, user_id)
          VALUES (?, ?, 'purchase_receive', ?, ?)
        `, [poItem.product_id, qty, poId, req.session.userId]);

        amountReceived += qty * poItem.unit_cost * (1 + poItem.tax_rate);
      }

      await client.query(toPgLocal(`UPDATE suppliers SET balance = balance + ? WHERE id = ?`), [amountReceived, po.supplier_id]);

      const allItems = await all(client, `SELECT * FROM purchase_order_items WHERE po_id = ?`, [poId]);
      const fullyReceived = allItems.every(i => i.received_qty >= i.qty);
      const anyReceived = allItems.some(i => i.received_qty > 0);
      const newStatus = fullyReceived ? 'received' : anyReceived ? 'partially_received' : po.status;
      await client.query(toPgLocal(`UPDATE purchase_orders SET status = ? WHERE id = ?`), [newStatus, poId]);

      await audit(client, req.session.userId, 'po_receive', 'purchase_order', poId, { items, amountReceived, newStatus });
      return { status: newStatus, amountReceived };
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

app.post('/api/purchase-orders/:id/cancel', requireAuth, requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const poId = +req.params.id;
  const po = await one(pool, `SELECT * FROM purchase_orders WHERE id = ?`, [poId]);
  if (!po) return res.status(404).json({ error: 'Not found' });
  const receivedRow = await one(pool, `SELECT COUNT(*)::int AS n FROM purchase_order_items WHERE po_id = ? AND received_qty > 0`, [poId]);
  if (receivedRow.n > 0) return res.status(400).json({ error: 'Cannot cancel a purchase order with received items' });
  await query(pool, `UPDATE purchase_orders SET status = 'cancelled' WHERE id = ?`, [poId]);
  await audit(pool, req.session.userId, 'po_cancel', 'purchase_order', poId);
  res.json({ ok: true });
}));

app.post('/api/purchase-orders/:id/return', requireAuth, requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const poId = +req.params.id;
  const { po_item_id, qty, reason } = req.body || {};

  try {
    const result = await withTransaction(async (client) => {
      const po = await one(client, `SELECT * FROM purchase_orders WHERE id = ?`, [poId]);
      if (!po) throw new Error('Purchase order not found');
      const poItem = await one(client, `SELECT * FROM purchase_order_items WHERE id = ? AND po_id = ?`, [po_item_id, poId]);
      if (!poItem) throw new Error('Line item not found on this order');
      const returnQty = Number(qty);
      if (!Number.isInteger(returnQty) || returnQty <= 0) throw new Error('Invalid return quantity');
      const returnable = poItem.received_qty - poItem.returned_qty;
      if (returnQty > returnable) throw new Error(`Cannot return ${returnQty} -- only ${returnable} available to return`);

      const product = await one(client, `SELECT * FROM products WHERE id = ?`, [poItem.product_id]);
      if (product.stock < returnQty) throw new Error(`Cannot return ${returnQty} of ${poItem.product_name} -- only ${product.stock} in stock`);

      const returnAmount = returnQty * poItem.unit_cost * (1 + poItem.tax_rate);

      await client.query(toPgLocal(`UPDATE purchase_order_items SET returned_qty = returned_qty + ? WHERE id = ?`), [returnQty, poItem.id]);
      await client.query(toPgLocal(`UPDATE products SET stock = stock - ? WHERE id = ?`), [returnQty, poItem.product_id]);
      await insertId(client, `
        INSERT INTO inventory_transactions (product_id, change_qty, reason, ref_po_id, user_id)
        VALUES (?, ?, 'purchase_return', ?, ?)
      `, [poItem.product_id, -returnQty, poId, req.session.userId]);
      await client.query(toPgLocal(`UPDATE suppliers SET balance = balance - ? WHERE id = ?`), [returnAmount, po.supplier_id]);

      const id = await insertId(client, `
        INSERT INTO purchase_returns (po_id, po_item_id, supplier_id, qty, amount, reason, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [poId, poItem.id, po.supplier_id, returnQty, returnAmount, reason || null, req.session.userId]);

      await audit(client, req.session.userId, 'po_return', 'purchase_order', poId, { po_item_id, returnQty, returnAmount });
      return { id, returnAmount };
    });
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

// ---------- Purchase Payments ----------
app.post('/api/purchase-payments', requireAuth, requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const { supplier_id, po_id, amount, method, note } = req.body || {};
  const amt = Number(amount);
  if (!supplier_id || !(amt > 0)) return res.status(400).json({ error: 'supplier_id and a positive amount are required' });

  try {
    const result = await withTransaction(async (client) => {
      const supplier = await one(client, `SELECT * FROM suppliers WHERE id = ?`, [supplier_id]);
      if (!supplier) throw new Error('Supplier not found');
      const id = await insertId(client, `
        INSERT INTO purchase_payments (supplier_id, po_id, amount, method, note, user_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [supplier_id, po_id || null, amt, method || 'cash', note || null, req.session.userId]);
      await client.query(toPgLocal(`UPDATE suppliers SET balance = balance - ? WHERE id = ?`), [amt, supplier_id]);
      await audit(client, req.session.userId, 'supplier_payment', 'supplier', supplier_id, { amount: amt, po_id });
      return { id };
    });
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

// ---------- Sales (transactional) ----------
app.post('/api/sales', requireAuth, asyncHandler(async (req, res) => {
  const { items, customer_id, payment_method, amount_tendered, discount_total } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items required' });
  if (!['cash', 'card', 'credit'].includes(payment_method)) return res.status(400).json({ error: 'Invalid payment_method' });

  try {
    const result = await withTransaction(async (client) => {
      let subtotal = 0, taxTotal = 0;
      const lineData = [];

      for (const it of items) {
        const product = await one(client, `SELECT * FROM products WHERE id = ? AND active = 1`, [it.product_id]);
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

      const saleId = await insertId(client, `
        INSERT INTO sales (invoice_no, user_id, customer_id, subtotal, tax_total, discount_total, grand_total, payment_method, amount_tendered, change_due, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [invoiceNo, req.session.userId, customer_id || null, subtotal, taxTotal, discount, grandTotal, payment_method, amount_tendered || null, changeDue, status]);

      for (const { product, qty, lineTotal } of lineData) {
        await insertId(client, `
          INSERT INTO sale_items (sale_id, product_id, product_name, qty, unit_price, tax_rate, line_total)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [saleId, product.id, product.name, qty, product.sell_price, product.tax_rate, lineTotal]);

        await client.query(toPgLocal(`UPDATE products SET stock = stock - ? WHERE id = ?`), [qty, product.id]);
        await insertId(client, `
          INSERT INTO inventory_transactions (product_id, change_qty, reason, ref_sale_id, user_id) VALUES (?, ?, 'sale', ?, ?)
        `, [product.id, -qty, saleId, req.session.userId]);
      }

      if (payment_method === 'credit' && customer_id) {
        await client.query(toPgLocal(`UPDATE customers SET balance = balance + ? WHERE id = ?`), [grandTotal, customer_id]);
      }

      await audit(client, req.session.userId, 'sale_create', 'sale', saleId, { invoiceNo, grandTotal });

      return { id: saleId, invoiceNo, subtotal, taxTotal, discount, grandTotal, changeDue, status };
    });
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

app.get('/api/sales', requireAuth, asyncHandler(async (req, res) => {
  const sales = await all(pool, `
    SELECT s.*, u.name AS cashier_name, c.name AS customer_name
    FROM sales s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN customers c ON c.id = s.customer_id
    ORDER BY s.id DESC LIMIT 100
  `);
  res.json(sales);
}));

app.get('/api/sales/:id', requireAuth, asyncHandler(async (req, res) => {
  const sale = await one(pool, `SELECT * FROM sales WHERE id = ?`, [+req.params.id]);
  if (!sale) return res.status(404).json({ error: 'Not found' });
  const items = await all(pool, `SELECT * FROM sale_items WHERE sale_id = ?`, [sale.id]);
  res.json({ ...sale, items });
}));

// ---------- Refunds ----------
app.post('/api/sales/:id/refund', requireAuth, asyncHandler(async (req, res) => {
  const { sale_item_id, qty, reason } = req.body || {};
  const saleId = +req.params.id;

  try {
    const result = await withTransaction(async (client) => {
      const item = await one(client, `SELECT * FROM sale_items WHERE id = ? AND sale_id = ?`, [sale_item_id, saleId]);
      if (!item) throw new Error('Sale item not found');
      const refundQty = Number(qty);
      if (!Number.isInteger(refundQty) || refundQty <= 0) throw new Error('Invalid refund quantity');
      if (item.refunded_qty + refundQty > item.qty) throw new Error('Refund quantity exceeds purchased quantity');

      const unitTotal = item.line_total / item.qty;
      const refundAmount = unitTotal * refundQty;

      await client.query(toPgLocal(`UPDATE sale_items SET refunded_qty = refunded_qty + ? WHERE id = ?`), [refundQty, item.id]);
      await client.query(toPgLocal(`UPDATE products SET stock = stock + ? WHERE id = ?`), [refundQty, item.product_id]);
      await insertId(client, `
        INSERT INTO inventory_transactions (product_id, change_qty, reason, ref_sale_id, user_id) VALUES (?, ?, 'refund', ?, ?)
      `, [item.product_id, refundQty, saleId, req.session.userId]);
      const id = await insertId(client, `
        INSERT INTO refunds (sale_id, sale_item_id, qty, amount, reason, user_id) VALUES (?, ?, ?, ?, ?, ?)
      `, [saleId, item.id, refundQty, refundAmount, reason || null, req.session.userId]);

      await audit(client, req.session.userId, 'refund_create', 'sale', saleId, { sale_item_id, refundQty, refundAmount });
      return { id, refundAmount };
    });
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

// ---------- Reports ----------
app.get('/api/reports/sales-summary', requireAuth, asyncHandler(async (req, res) => {
  const today = await one(pool, `
    SELECT COUNT(*)::int AS count, COALESCE(SUM(grand_total),0) AS revenue
    FROM sales WHERE created_at::date = CURRENT_DATE AND status != 'cancelled'
  `);
  const cogsRow = await one(pool, `
    SELECT COALESCE(SUM(si.qty * p.cost_price),0) AS cogs
    FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
    WHERE s.created_at::date = CURRENT_DATE AND s.status != 'cancelled'
  `);
  const topProducts = await all(pool, `
    SELECT si.product_name, SUM(si.qty)::int AS units_sold, SUM(si.line_total) AS revenue
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.status != 'cancelled'
    GROUP BY si.product_id, si.product_name ORDER BY units_sold DESC LIMIT 5
  `);
  const lowStock = await all(pool, `SELECT id, name, stock, min_stock FROM products WHERE active = 1 AND stock <= min_stock`);
  const payables = await one(pool, `SELECT COALESCE(SUM(balance),0) AS total FROM suppliers WHERE active = 1 AND balance > 0`);
  const openPOs = await one(pool, `SELECT COUNT(*)::int AS n FROM purchase_orders WHERE status IN ('ordered','partially_received')`);

  res.json({
    today_revenue: Number(today.revenue),
    today_transactions: today.count,
    today_cogs: Number(cogsRow.cogs),
    today_gross_profit: Number(today.revenue) - Number(cogsRow.cogs),
    top_products: topProducts.map(p => ({ ...p, revenue: Number(p.revenue) })),
    low_stock: lowStock,
    total_payables: Number(payables.total),
    open_purchase_orders: openPOs.n,
  });
}));

// ---------- Audit (admin only) ----------
app.get('/api/audit-logs', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  res.json(await all(pool, `
    SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.id DESC LIMIT 200
  `));
}));

// Error handler -- last resort, never leak internals.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

function toPgLocal(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

if (require.main === module) {
  const PORT = process.env.PORT || 4100;
  ensureSchema()
    .then(() => app.listen(PORT, () => console.log(`POS Pro API listening on http://localhost:${PORT}`)))
    .catch(e => { console.error('Failed to initialize schema', e); process.exit(1); });
}

module.exports = app;
