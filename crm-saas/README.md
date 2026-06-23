# LeadFlow — Multi-Tenant CRM SaaS

A production-style, multi-tenant CRM built with **React + Vite + Supabase**.
Every business that signs up gets its own isolated workspace (leads, pipeline,
team). A **super-admin** oversees the whole platform.

This lives alongside the original single-file `crm.html` (which is untouched).

---

## Two panels

| Panel | Who | What they can do |
|-------|-----|------------------|
| **Tenant app** (`/app`) | Business admins & members | Manage their own leads, pipeline, analytics, send emails, invite teammates |
| **Super-admin console** (`/admin`) | Platform owner | See every organization, user counts, lead totals; suspend or delete tenants |

**Data isolation is enforced in the database** (Postgres Row-Level Security),
not just the UI — a tenant physically cannot read another tenant's rows.

---

## Roles

| Role | Assigned when | Scope |
|------|---------------|-------|
| `super_admin` | **First account ever** created on the platform | Everything, all tenants |
| `admin` | Any later signup (creates a new organization) | Their own org |
| `member` | Invited by an org admin from **Team & Settings** | Their own org |

> The very first person to sign up becomes the platform super-admin. So **you
> should sign up first**, then your customers sign up after.

---

## Run it locally

```bash
cd crm-saas
npm install
npm run dev
```
Open the printed URL (default http://localhost:5180).

### First-time setup
1. Click **Create a workspace** and sign up → you become the **super-admin**
   and land on the platform console.
2. Open an incognito window, sign up again → that account becomes a **tenant
   admin** with its own CRM.

---

## Build & deploy (Vercel — free)

```bash
npm run build      # outputs to dist/
```

**Deploy on Vercel:**
1. Push this repo to GitHub (already done).
2. On vercel.com → New Project → import the repo.
3. Set **Root Directory** to `crm-saas`.
4. Framework preset: **Vite**. Build command `npm run build`, output `dist`.
5. Add the environment variables below.
6. Deploy. (Add a `vercel.json` rewrite so client-side routes work — see below.)

For SPA routing on Vercel, add `crm-saas/vercel.json`:
```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

### Environment variables
| Var | Value |
|-----|-------|
| `VITE_SUPABASE_URL` | `https://idxtbwzpodlvwjcslrfw.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the anon key (already in `.env`; safe to expose — RLS protects data) |
| `VITE_SEND_FN` | `https://idxtbwzpodlvwjcslrfw.supabase.co/functions/v1/send-email` |

---

## Architecture

```
React (Vite) ──┬─► Supabase Auth            (login / signup sessions)
               ├─► Postgres + RLS           (app_orgs, app_members, app_leads, app_activities)
               └─► Edge Functions
                     • signup         → creates a confirmed user (no email step)
                     • invite-member  → admin adds a teammate to their org
                     • send-email      → Gmail SMTP (shared with crm.html)
```

### Why server-side signup?
The Supabase project has email-confirmation on but no auth SMTP, so the normal
`auth.signUp` would fail to send a confirmation mail. The `signup` Edge Function
creates an already-confirmed user with the service-role key, then the client
signs in — so signup is instant and reliable.

### Database tables
| Table | Purpose |
|-------|---------|
| `app_orgs` | One row per tenant (name, plan, status) |
| `app_members` | Links an auth user → org + role |
| `app_leads` | Leads, **scoped by `org_id`** |
| `app_activities` | Per-lead activity log |

RLS uses `security definer` helper functions (`app_my_org()`, `app_my_role()`,
`app_is_super()`) so policies are simple and non-recursive. The `app_bootstrap`
RPC atomically creates the org + member on first login.

---

## Project structure
```
crm-saas/
├── index.html
├── vite.config.js
├── .env                      # Supabase URL + anon key
└── src/
    ├── main.jsx              # app entry + providers
    ├── App.jsx              # routes + role-based guards
    ├── index.css            # full design system
    ├── lib/
    │   ├── supabase.js       # client + sendEmail() helper
    │   └── AuthContext.jsx   # session, profile, signIn/signUp/signOut
    ├── components/
    │   ├── Layout.jsx        # sidebar shell (tenant + admin variants)
    │   └── Page.jsx          # page wrapper, Modal, status pills
    └── pages/
        ├── Login.jsx
        ├── Signup.jsx
        ├── tenant/  Dashboard · Leads · Pipeline · Analytics · Team
        └── admin/   AdminHome · AdminOrgs
```

---

## Feature checklist
- [x] Email/password auth with sessions
- [x] Multi-tenant orgs with DB-enforced isolation (RLS)
- [x] Super-admin console (all orgs, suspend/delete, platform stats)
- [x] Tenant dashboard with live KPIs
- [x] Leads: search, filter, add/edit/delete, demo-data seeding
- [x] Send real emails per lead (Gmail SMTP via Edge Function)
- [x] Drag-and-drop pipeline (7 stages)
- [x] Analytics (funnel + breakdowns by category/country/industry)
- [x] Team management + invite teammates (server-side)
- [x] Role-based routing & guards
