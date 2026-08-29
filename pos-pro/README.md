# POS Pro — Retail Point of Sale

A real, single-store point-of-sale system: Express backend, SQLite database (via `better-sqlite3`), session-based auth with bcrypt password hashing, and a vanilla-JS frontend. No mock data in the UI — every number the frontend shows comes from a live API call backed by real database rows.

## What's actually implemented

- **Auth** — email/password login, bcrypt-hashed passwords, cookie sessions, role-gated routes (`admin`, `manager`, `cashier`)
- **Products & categories** — CRUD, stock levels, min-stock thresholds, per-product tax rate
- **POS terminal** — live product grid, cart, tax calculation, cash/card/credit payment, cash tendered → change due, printable receipt
- **Transactional checkout** — a sale is one atomic DB transaction: validate stock → compute totals server-side → insert sale + line items → deduct stock → write an inventory transaction row → (if credit) update customer balance → write an audit log entry. Any failure rolls back the whole thing — no partial sales.
- **Refunds** — partial or full, per line item, restocks inventory, capped at the originally purchased quantity
- **Customers** — walk-in / retail / wholesale / VIP, credit limit, running balance
- **Suppliers** — contact/company/terms, running payable balance
- **Purchasing** — create a purchase order against a supplier with multiple line items; receive stock (partial or full — status auto-flips between `ordered` → `partially_received` → `received`); return received items to a supplier; cancel a PO (only if nothing's been received yet). Receiving is transactional: validate remaining quantity → deduct nothing until receipt → increase stock → write an inventory transaction → increase the supplier's balance. Returns mirror it in reverse — decrease stock, decrease the balance, capped at what was actually received and not already returned.
- **Supplier payments** — record a payment against a supplier's balance, with a running payment history
- **Reports** — today's revenue, transaction count, gross profit (revenue − COGS from actual cost_price), top products, low-stock list, total owed to suppliers, open purchase order count — all computed from the database, not hardcoded
- **Audit log** — login, sale, refund, product/supplier create/update, PO create/receive/cancel/return, and supplier payments all recorded with user + timestamp

## What's intentionally out of scope for this build

This is a genuine single-store system, not the full enterprise spec (multi-branch/multi-tenant hierarchy, granular per-permission RBAC beyond 3 roles, cash-drawer reconciliation, stock transfers between branches, PWA offline sync, SMS/email notifications, full automated test suite, managed cloud Postgres deployment). Those are real, multi-week additions — flagging them honestly rather than faking them.

## Running locally

```bash
npm install
npm run seed     # creates db/pos.sqlite3 and seeds demo data + accounts
npm start         # http://localhost:4100
```

### Demo accounts (seeded, dev only — never use in production)

| Role     | Email               | Password     |
|----------|----------------------|--------------|
| Admin    | admin@pos.local      | Admin123!    |
| Manager  | manager@pos.local    | Manager123!  |
| Cashier  | cashier@pos.local    | Cashier123!  |

## Tech stack

- **Backend**: Node.js, Express
- **Database**: SQLite (`better-sqlite3`) — swap for Postgres by replacing `src/db.js` and re-pointing the connection; the SQL is close to standard
- **Auth**: `bcryptjs` password hashing, `cookie-session` for sessions
- **Frontend**: Vanilla JS, no build step, fetches the real API

## API surface

```
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
GET    /api/categories
GET    /api/products
POST   /api/products            (admin, manager)
PATCH  /api/products/:id        (admin, manager)
DELETE /api/products/:id        (admin)
GET    /api/customers
POST   /api/customers
POST   /api/sales                          — transactional checkout
GET    /api/sales
GET    /api/sales/:id
POST   /api/sales/:id/refund
GET    /api/suppliers
GET    /api/suppliers/:id                  — includes PO + payment history
POST   /api/suppliers                      (admin, manager)
PATCH  /api/suppliers/:id                  (admin, manager)
GET    /api/purchase-orders
GET    /api/purchase-orders/:id
POST   /api/purchase-orders                (admin, manager) — transactional
POST   /api/purchase-orders/:id/receive    (admin, manager) — transactional, updates stock + supplier balance
POST   /api/purchase-orders/:id/return     (admin, manager) — transactional, return to supplier
POST   /api/purchase-orders/:id/cancel     (admin, manager) — only if nothing received yet
POST   /api/purchase-payments              (admin, manager)
GET    /api/reports/sales-summary
GET    /api/audit-logs           (admin)
GET    /api/health
```

## Environment variables

```
PORT=4100
SESSION_SECRET=change-me-in-production
```

Create a `.env` and load it (or export vars) before running in anything beyond local dev — the code falls back to an insecure dev secret if `SESSION_SECRET` isn't set.
