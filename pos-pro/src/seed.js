const bcrypt = require('bcryptjs');
const { pool, insertId, ensureSchema } = require('./db');

async function reset() {
  await pool.query(`
    DELETE FROM purchase_returns;
    DELETE FROM purchase_payments;
    DELETE FROM refunds;
    DELETE FROM inventory_transactions;
    DELETE FROM audit_logs;
    DELETE FROM sale_items;
    DELETE FROM sales;
    DELETE FROM purchase_order_items;
    DELETE FROM purchase_orders;
    DELETE FROM products;
    DELETE FROM categories;
    DELETE FROM customers;
    DELETE FROM suppliers;
    DELETE FROM users;
  `);
}

async function seed() {
  await ensureSchema();
  await reset();

  const users = [
    ['Admin User', 'admin@pos.local', 'Admin123!', 'admin'],
    ['Store Manager', 'manager@pos.local', 'Manager123!', 'manager'],
    ['Cashier One', 'cashier@pos.local', 'Cashier123!', 'cashier'],
  ];
  for (const [name, email, pw, role] of users) {
    await insertId(pool, `INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)`,
      [name, email, bcrypt.hashSync(pw, 10), role]);
  }

  const cats = ['Drinks', 'Bakery', 'Food', 'Snacks'];
  const catIds = {};
  for (const c of cats) catIds[c] = await insertId(pool, `INSERT INTO categories (name) VALUES (?)`, [c]);

  const products = [
    { sku: 'SKU001', name: 'Espresso', category_id: catIds.Drinks, cost_price: 1.20, sell_price: 3.50, tax_rate: 0.08, stock: 40, min_stock: 10, icon: '☕' },
    { sku: 'SKU002', name: 'Cappuccino', category_id: catIds.Drinks, cost_price: 1.50, sell_price: 4.25, tax_rate: 0.08, stock: 32, min_stock: 10, icon: '☕' },
    { sku: 'SKU003', name: 'Iced Latte', category_id: catIds.Drinks, cost_price: 1.75, sell_price: 4.75, tax_rate: 0.08, stock: 5, min_stock: 8, icon: '🥤' },
    { sku: 'SKU004', name: 'Orange Juice', category_id: catIds.Drinks, cost_price: 1.00, sell_price: 3.00, tax_rate: 0.08, stock: 18, min_stock: 8, icon: '🧃' },
    { sku: 'SKU005', name: 'Croissant', category_id: catIds.Bakery, cost_price: 1.10, sell_price: 3.25, tax_rate: 0.08, stock: 14, min_stock: 6, icon: '🥐' },
    { sku: 'SKU006', name: 'Bagel', category_id: catIds.Bakery, cost_price: 0.90, sell_price: 2.75, tax_rate: 0.08, stock: 20, min_stock: 6, icon: '🥯' },
    { sku: 'SKU007', name: 'Chocolate Muffin', category_id: catIds.Bakery, cost_price: 1.20, sell_price: 3.50, tax_rate: 0.08, stock: 0, min_stock: 6, icon: '🧁' },
    { sku: 'SKU008', name: 'Cinnamon Roll', category_id: catIds.Bakery, cost_price: 1.30, sell_price: 4.00, tax_rate: 0.08, stock: 9, min_stock: 6, icon: '🌀' },
    { sku: 'SKU009', name: 'Club Sandwich', category_id: catIds.Food, cost_price: 3.00, sell_price: 7.50, tax_rate: 0.08, stock: 12, min_stock: 5, icon: '🥪' },
    { sku: 'SKU010', name: 'Caesar Salad', category_id: catIds.Food, cost_price: 3.20, sell_price: 8.25, tax_rate: 0.08, stock: 7, min_stock: 5, icon: '🥗' },
    { sku: 'SKU011', name: 'Margherita Pizza Slice', category_id: catIds.Food, cost_price: 2.10, sell_price: 5.50, tax_rate: 0.08, stock: 10, min_stock: 5, icon: '🍕' },
    { sku: 'SKU012', name: 'Chips', category_id: catIds.Snacks, cost_price: 0.60, sell_price: 2.00, tax_rate: 0.08, stock: 25, min_stock: 10, icon: '🍟' },
    { sku: 'SKU013', name: 'Cookie', category_id: catIds.Snacks, cost_price: 0.50, sell_price: 1.75, tax_rate: 0.08, stock: 30, min_stock: 10, icon: '🍪' },
    { sku: 'SKU014', name: 'Granola Bar', category_id: catIds.Snacks, cost_price: 0.70, sell_price: 2.25, tax_rate: 0.08, stock: 3, min_stock: 10, icon: '🍫' },
  ];
  for (const p of products) {
    await insertId(pool, `
      INSERT INTO products (sku, name, category_id, cost_price, sell_price, tax_rate, stock, min_stock, icon)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [p.sku, p.name, p.category_id, p.cost_price, p.sell_price, p.tax_rate, p.stock, p.min_stock, p.icon]);
  }

  await insertId(pool, `INSERT INTO customers (name, phone, email, customer_type, credit_limit, balance) VALUES (?, ?, ?, ?, ?, ?)`,
    ['Walk-in Customer', null, null, 'walk-in', 0, 0]);
  await insertId(pool, `INSERT INTO customers (name, phone, email, customer_type, credit_limit, balance) VALUES (?, ?, ?, ?, ?, ?)`,
    ['Sarah Khan', '+92 300 1234567', 'sarah@example.com', 'retail', 0, 0]);
  await insertId(pool, `INSERT INTO customers (name, phone, email, customer_type, credit_limit, balance) VALUES (?, ?, ?, ?, ?, ?)`,
    ['Bilal Traders', '+92 321 9876543', 'bilal@traders.com', 'wholesale', 500, 120.50]);

  await insertId(pool, `
    INSERT INTO suppliers (name, company, phone, email, address, tax_id, payment_terms, balance) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, ['Ahsan Malik', 'Roastworks Coffee Co.', '+92 300 5551234', 'orders@roastworks.pk', 'Plot 22, Industrial Area, Lahore', 'NTN-4471123', 'Net 30', 0]);
  await insertId(pool, `
    INSERT INTO suppliers (name, company, phone, email, address, tax_id, payment_terms, balance) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, ['Nadia Farooq', 'FreshBake Wholesale', '+92 321 5559876', 'sales@freshbake.pk', 'Shop 8, Bakers Market, Karachi', 'NTN-8832214', 'Net 15', 0]);
  await insertId(pool, `
    INSERT INTO suppliers (name, company, phone, email, address, tax_id, payment_terms, balance) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, ['Imran Sheikh', 'SnackHub Distributors', '+92 333 5552211', 'imran@snackhub.pk', 'Warehouse 3, Gulberg, Lahore', 'NTN-1195567', 'Due on receipt', 0]);

  console.log('Seed complete.');
  console.log('Dev logins:');
  for (const [name, email, pw, role] of users) console.log(`  ${role.padEnd(8)} ${email}  /  ${pw}`);
  await pool.end();
}

seed().catch(e => { console.error(e); process.exit(1); });
