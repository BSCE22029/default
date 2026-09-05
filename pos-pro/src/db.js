const { Pool } = require('pg');

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('POSTGRES_URL or DATABASE_URL environment variable is required');
}

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
});

// Converts our SQLite-style '?' placeholders to Postgres '$1, $2, ...' in order.
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function query(executor, sql, params = []) {
  return executor.query(toPg(sql), params);
}

async function one(executor, sql, params = []) {
  const res = await query(executor, sql, params);
  return res.rows[0] || null;
}

async function all(executor, sql, params = []) {
  const res = await query(executor, sql, params);
  return res.rows;
}

// Runs an INSERT and returns the new row's id. Appends RETURNING id if the caller didn't.
async function insertId(executor, sql, params = []) {
  const withReturning = /returning/i.test(sql) ? sql : sql + ' RETURNING id';
  const res = await query(executor, withReturning, params);
  return res.rows[0].id;
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = pool.query(`
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','manager','cashier')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  cost_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  sell_price DOUBLE PRECISION NOT NULL,
  tax_rate DOUBLE PRECISION NOT NULL DEFAULT 0.08,
  stock INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 5,
  icon TEXT DEFAULT '📦',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  customer_type TEXT NOT NULL DEFAULT 'retail' CHECK(customer_type IN ('walk-in','retail','wholesale','vip')),
  credit_limit DOUBLE PRECISION NOT NULL DEFAULT 0,
  balance DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  tax_id TEXT,
  payment_terms TEXT,
  balance DOUBLE PRECISION NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  po_number TEXT NOT NULL UNIQUE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'ordered' CHECK(status IN ('draft','ordered','partially_received','received','cancelled')),
  expected_date TEXT,
  subtotal DOUBLE PRECISION NOT NULL DEFAULT 0,
  tax_total DOUBLE PRECISION NOT NULL DEFAULT 0,
  grand_total DOUBLE PRECISION NOT NULL DEFAULT 0,
  user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id SERIAL PRIMARY KEY,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_cost DOUBLE PRECISION NOT NULL,
  tax_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  line_total DOUBLE PRECISION NOT NULL,
  received_qty INTEGER NOT NULL DEFAULT 0,
  returned_qty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sales (
  id SERIAL PRIMARY KEY,
  invoice_no TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  customer_id INTEGER REFERENCES customers(id),
  subtotal DOUBLE PRECISION NOT NULL,
  tax_total DOUBLE PRECISION NOT NULL,
  discount_total DOUBLE PRECISION NOT NULL DEFAULT 0,
  grand_total DOUBLE PRECISION NOT NULL,
  payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','card','credit')),
  amount_tendered DOUBLE PRECISION,
  change_due DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'paid' CHECK(status IN ('paid','partially_paid','credit','refunded','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sale_items (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_price DOUBLE PRECISION NOT NULL,
  tax_rate DOUBLE PRECISION NOT NULL,
  line_total DOUBLE PRECISION NOT NULL,
  refunded_qty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  change_qty INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN ('sale','refund','adjustment','opening_stock','restock','purchase_receive','purchase_return')),
  ref_sale_id INTEGER REFERENCES sales(id),
  ref_po_id INTEGER REFERENCES purchase_orders(id),
  user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refunds (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),
  qty INTEGER NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  reason TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_payments (
  id SERIAL PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  po_id INTEGER REFERENCES purchase_orders(id),
  amount DOUBLE PRECISION NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_returns (
  id SERIAL PRIMARY KEY,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  po_item_id INTEGER NOT NULL REFERENCES purchase_order_items(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  qty INTEGER NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  reason TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  metadata TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
    `).catch(e => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

module.exports = { pool, query, one, all, insertId, withTransaction, ensureSchema };
