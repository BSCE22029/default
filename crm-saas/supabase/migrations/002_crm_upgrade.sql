-- ============================================================================
-- LeadFlow CRM upgrade — Phase 1/2 schema (tasks, sequences, messages,
-- activities, contacts, tags) + app_leads columns needed for real
-- follow-up automation, reply-intent tracking, and lost-reason capture.
--
-- HOW TO RUN: paste this whole file into the Supabase SQL Editor
-- (https://supabase.com/dashboard/project/idxtbwzpodlvwjcslrfw/sql/new)
-- and click Run. Safe to re-run — every statement is idempotent.
-- ============================================================================

-- ── app_leads: new columns ──────────────────────────────────────────────────
alter table public.app_leads add column if not exists assigned_to  uuid references auth.users(id) on delete set null;
alter table public.app_leads add column if not exists lost_reason  text;
alter table public.app_leads add column if not exists icp_score    integer;
alter table public.app_leads add column if not exists replied_at   timestamptz;
alter table public.app_leads add column if not exists reply_intent text check (reply_intent in ('positive','neutral','negative','wrong_person','ooo'));
alter table public.app_leads add column if not exists source       text;

create index if not exists idx_app_leads_assigned_to on public.app_leads(assigned_to);
create index if not exists idx_app_leads_org_status   on public.app_leads(org_id, status);

-- ── app_contacts: real named people at a lead's company ────────────────────
create table if not exists public.app_contacts (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  lead_id      uuid not null references public.app_leads(id) on delete cascade,
  name         text not null,
  title        text,
  email        text,
  phone        text,
  linkedin_url text,
  source       text default 'manual',  -- manual | scraped | pattern-matched | pattern-guess
  is_primary   boolean default false,
  created_at   timestamptz default now()
);
create index if not exists idx_app_contacts_lead on public.app_contacts(lead_id);

-- ── app_tasks: real follow-up objects with due dates ────────────────────────
create table if not exists public.app_tasks (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  lead_id      uuid not null references public.app_leads(id) on delete cascade,
  title        text not null,
  due_at       timestamptz not null,
  completed_at timestamptz,
  assigned_to  uuid references auth.users(id) on delete set null,
  created_at   timestamptz default now()
);
create index if not exists idx_app_tasks_open on public.app_tasks(org_id, due_at) where completed_at is null;
create index if not exists idx_app_tasks_lead on public.app_tasks(lead_id);

-- ── app_sequences: reusable multi-step follow-up cadences ──────────────────
create table if not exists public.app_sequences (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  name       text not null,
  steps      jsonb not null default '[]',  -- [{ "delay_days": 0, "angle": "website" }, ...]
  is_active  boolean default true,
  created_at timestamptz default now()
);

-- ── app_lead_sequences: a lead's live progress through a sequence ──────────
create table if not exists public.app_lead_sequences (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  lead_id       uuid not null references public.app_leads(id) on delete cascade,
  sequence_id   uuid not null references public.app_sequences(id) on delete cascade,
  current_step  integer not null default 0,
  next_send_at  timestamptz,
  status        text not null default 'active' check (status in ('active','paused','completed','stopped')),
  created_at    timestamptz default now()
);
create index if not exists idx_lead_seq_due on public.app_lead_sequences(next_send_at) where status = 'active';
create unique index if not exists uq_lead_seq_active on public.app_lead_sequences(lead_id) where status = 'active';

-- ── app_messages: every email actually sent or received ─────────────────────
create table if not exists public.app_messages (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  lead_id        uuid not null references public.app_leads(id) on delete cascade,
  direction      text not null check (direction in ('out','in')),
  subject        text,
  body           text,
  angle          text,      -- which template/pitch-angle was used
  sequence_step  integer,   -- which step number in the sequence this was
  sent_at        timestamptz default now(),
  created_at     timestamptz default now()
);
create index if not exists idx_app_messages_lead on public.app_messages(lead_id, sent_at);
create index if not exists idx_app_messages_angle on public.app_messages(org_id, angle);

-- ── app_activities: immutable event log (backs the timeline UI) ────────────
create table if not exists public.app_activities (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  lead_id    uuid not null references public.app_leads(id) on delete cascade,
  type       text not null,  -- email_sent | reply_logged | stage_changed | note_added | task_completed | task_created | lead_created
  payload    jsonb default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists idx_app_activities_lead on public.app_activities(lead_id, created_at);

-- ── app_tags / app_lead_tags: free-form segmentation ────────────────────────
create table if not exists public.app_tags (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  name       text not null,
  color      text default '#6366f1',
  created_at timestamptz default now(),
  unique (org_id, name)
);
create table if not exists public.app_lead_tags (
  lead_id uuid not null references public.app_leads(id) on delete cascade,
  tag_id  uuid not null references public.app_tags(id) on delete cascade,
  primary key (lead_id, tag_id)
);

-- ============================================================================
-- Row Level Security — mirrors the existing app_leads org-scoping pattern:
-- a user may only touch rows whose org_id matches one they belong to via
-- app_members.
-- ============================================================================
alter table public.app_contacts     enable row level security;
alter table public.app_tasks        enable row level security;
alter table public.app_sequences    enable row level security;
alter table public.app_lead_sequences enable row level security;
alter table public.app_messages     enable row level security;
alter table public.app_activities   enable row level security;
alter table public.app_tags         enable row level security;
alter table public.app_lead_tags    enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['app_contacts','app_tasks','app_sequences','app_lead_sequences','app_messages','app_activities','app_tags']
  loop
    execute format('drop policy if exists "org members full access" on public.%I', t);
    execute format(
      'create policy "org members full access" on public.%I for all using (org_id in (select org_id from public.app_members where user_id = auth.uid())) with check (org_id in (select org_id from public.app_members where user_id = auth.uid()))',
      t
    );
  end loop;
end $$;

-- app_lead_tags has no org_id of its own — scope through the parent lead.
drop policy if exists "org members full access" on public.app_lead_tags;
create policy "org members full access" on public.app_lead_tags for all using (
  lead_id in (select id from public.app_leads where org_id in (select org_id from public.app_members where user_id = auth.uid()))
) with check (
  lead_id in (select id from public.app_leads where org_id in (select org_id from public.app_members where user_id = auth.uid()))
);

-- ── app_suppressed_emails: never re-email an address once it opts out ──────
create table if not exists public.app_suppressed_emails (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  email      text not null,
  reason     text default 'unsubscribed',
  created_at timestamptz default now(),
  unique (org_id, email)
);
alter table public.app_suppressed_emails enable row level security;
drop policy if exists "org members full access" on public.app_suppressed_emails;
create policy "org members full access" on public.app_suppressed_emails for all using (
  org_id in (select org_id from public.app_members where user_id = auth.uid())
) with check (
  org_id in (select org_id from public.app_members where user_id = auth.uid())
);

-- ============================================================================
-- Seed a sensible default 4-step sequence per existing org so the sequence
-- engine has something to enroll leads into immediately.
-- ============================================================================
insert into public.app_sequences (org_id, name, steps)
select id, 'Standard 4-touch outreach',
  '[
    {"delay_days": 0, "angle": "auto"},
    {"delay_days": 3, "angle": "tech"},
    {"delay_days": 7, "angle": "ai"},
    {"delay_days": 14, "angle": "app"}
  ]'::jsonb
from public.app_orgs o
where not exists (select 1 from public.app_sequences s where s.org_id = o.id);
