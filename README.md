# IT Leads CRM

A single-file CRM for running a B2B IT-services outreach campaign — 108 pre-loaded
leads across 14 categories and 3 outreach waves, with real Gmail email sending,
cloud sync, a sales pipeline, analytics, and an automation engine.

**Live demo:** https://bsce22029.github.io/default/crm.html

---

## What it does

| Area | Capability |
|------|-----------|
| **Leads** | 108 seeded IT companies (CEO/founder contacts, lead scores, deal sizes) |
| **Email** | Send real emails from `moizahmad1604@gmail.com` — one click per lead |
| **Cloud sync** | Every change auto-saves to Supabase PostgreSQL (survives browser/device switches) |
| **Pipeline** | Drag leads through 8 stages (New → Contacted → Qualified → … → Closed Won/Lost) |
| **Analytics** | Charts for status, category, wave, lead-score distribution |
| **Automation** | 7-rule engine auto-advances lead status based on email events |
| **Backup** | Export/import CSV + JSON |

---

## Running it

It's a **single HTML file** — no build step, no install.

### Option A — just open it
Double-click `crm.html` (or open it in any browser). Works offline; data is saved
in that browser. Email sending and cloud sync still work because they call hosted
services.

### Option B — the live hosted version
Open **https://bsce22029.github.io/default/crm.html**. This is auto-published from
the `main` branch of the GitHub repo on every push.

### Option C — local server (for testing)
```bash
cd "C:\Users\Ahmad\Downloads\leads"
python -m http.server 8099
# then open http://localhost:8099/crm.html
```

---

## How to operate it

### 1. Send an email to a lead
1. Go to **All Leads** (or **Email Tracker**).
2. Click the green **📨 Send** button on any row.
3. A compose window opens — recipient, subject, and a tailored body are
   pre-filled based on the lead's category. Edit anything you like.
4. Click **📨 Send Email**.
5. The email is sent via Gmail. The lead is automatically marked **Contacted**
   and "Email Sent" is recorded.

> No password or login is needed in the browser. The Gmail credential lives
> server-side in a Supabase Edge Function, so it's never exposed.

### 2. Work the pipeline
- **Pipeline** view shows leads grouped by stage. Open a lead → change its
  **Status** to move it forward.
- **Email Tracker** lets you mark Opened / Replied / Bounced (toggles per lead).

### 3. Add / edit / delete leads
- **+ Add Lead** (top right) to create one.
- Click **View** on any lead to open its detail card → edit fields, add notes,
  log activities, or delete.

### 4. Automation engine
**Automation** view → toggle the engine **ON**. It then auto-applies these rules
whenever it runs:

| Rule | Trigger → Action |
|------|------------------|
| 1 | Email sent → move New Lead to *Contacted* |
| 2 | Reply received → move to *Qualified* |
| 3 | Email bounced → move to *Closed Lost* |
| … | (7 rules total — see the Automation view for the full list) |

### 5. Back up your data
**Settings** or **Deploy** view:
- **⬇ Export JSON Backup** — full snapshot (leads + activity log).
- **⬇ Export CSV** — spreadsheet-friendly lead list.
- **⬆ Import JSON** — restore a backup (replaces current data).

> Tip: localStorage is per-browser. Export a JSON backup before switching
> devices, even though Supabase also keeps a cloud copy.

---

## The campaign (108 leads, 3 waves)

- **Wave 1 — 21 leads:** Embedded/FPGA, AI/ML, Cloud priority targets (already
  marked as contacted in the seed data).
- **Wave 2 — 40 leads:** AI/Cloud/Data/Web/Mobile.
- **Wave 3 — 47 leads:** Design/Video/SaaS/Blockchain/Cybersecurity.

Suggested cadence: Wave send → Day-8 follow-up → Day-12 closing note.

---

## Architecture

```
crm.html  ──────────────►  Supabase PostgreSQL   (data: public.crm_leads)
  (vanilla JS + Chart.js)        │
        │                        └─►  Edge Function "send-email"  ──►  Gmail SMTP
        └─►  localStorage (instant local cache + offline)
```

- **No framework / no dependencies** except Chart.js (CDN) for the analytics charts.
- **Data model:** camelCase in JS ↔ snake_case in Postgres (`toDb`/`fromDb`).
- **Sync:** local save is instant; a debounced push to Supabase fires ~1.5s later.
- **Email:** the browser only sends `{to, subject, html}`. The Gmail App Password
  is stored exclusively in the Supabase Edge Function — never in the page.

### Backend pieces (already deployed, no setup needed)
| Service | Detail |
|---------|--------|
| Supabase project | `poise` · region `ap-southeast-1` |
| Table | `public.crm_leads` (RLS on, anon CRUD policy) |
| Edge Function | `send-email` (Deno + denomailer → smtp.gmail.com:465) |
| Sender | `moizahmad1604@gmail.com` |

---

## Deploying updates

The live site auto-updates from GitHub. To push a change:
```bash
cd "C:\Users\Ahmad\Downloads\leads"
git add crm.html
git commit -m "Your change"
git push origin main
```
GitHub Pages rebuilds in ~1–2 minutes.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Email send fails | Check the **Synced** indicator is green; the Edge Function may be cold-starting — retry once. |
| Data didn't sync | Open **Settings → 🔄 Force Sync Now**. |
| Charts blank | Hard-refresh (Ctrl+F5) — Chart.js loads from CDN, needs internet. |
| Lost data after clearing browser | **Import** your last JSON backup, or reload — Supabase holds the cloud copy. |

---

## Files in this repo

| File | Purpose |
|------|---------|
| `crm.html` | The entire application (UI + logic + seed data) |
| `Code.gs` | Legacy Google Apps Script backend (not used — replaced by Supabase) |
| `README.md` | This file |
