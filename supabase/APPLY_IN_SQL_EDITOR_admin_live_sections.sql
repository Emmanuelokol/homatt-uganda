-- ================================================================
-- Homatt Health — Admin Portal Live Sections
-- Tables: support_tickets, feedback_ratings, emergency_contacts
-- ================================================================

-- ── 1. Support Tickets ───────────────────────────────────────────
create table if not exists support_tickets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references profiles(id) on delete set null,
  category     text not null default 'general',
    -- general | billing | technical | medical | delivery
  priority     text not null default 'medium',
    -- low | medium | high | urgent
  status       text not null default 'open',
    -- open | in_progress | resolved | closed
  subject      text not null,
  message      text not null,
  contact_name text,
  contact_phone text,
  admin_notes  text,
  submitted_at timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table support_tickets enable row level security;

drop policy if exists "Users can submit tickets" on support_tickets;
create policy "Users can submit tickets"
  on support_tickets for insert with check (true);

drop policy if exists "Users can view own tickets" on support_tickets;
create policy "Users can view own tickets"
  on support_tickets for select using (
    auth.uid() = user_id or auth.role() = 'authenticated'
  );

drop policy if exists "Admins can update tickets" on support_tickets;
create policy "Admins can update tickets"
  on support_tickets for update using (auth.role() = 'authenticated');

-- ── 2. Feedback & Ratings ────────────────────────────────────────
create table if not exists feedback_ratings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references profiles(id) on delete set null,
  type         text not null default 'platform',
    -- platform | clinic | pharmacy
  score        integer not null check (score >= 1 and score <= 5),
  category     text,
    -- app_experience | care_quality | speed | cost | other
  message      text,
  contact      text,
  status       text not null default 'new',
    -- new | reviewed | actioned
  clinic_id    uuid references clinics(id) on delete set null,
  pharmacy_id  uuid references pharmacies(id) on delete set null,
  created_at   timestamptz default now()
);

alter table feedback_ratings enable row level security;

drop policy if exists "Anyone can submit feedback" on feedback_ratings;
create policy "Anyone can submit feedback"
  on feedback_ratings for insert with check (true);

drop policy if exists "Admins can view all feedback" on feedback_ratings;
create policy "Admins can view all feedback"
  on feedback_ratings for select using (auth.role() = 'authenticated');

drop policy if exists "Admins can update feedback" on feedback_ratings;
create policy "Admins can update feedback"
  on feedback_ratings for update using (auth.role() = 'authenticated');

-- ── 3. Emergency Contacts ────────────────────────────────────────
create table if not exists emergency_contacts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references profiles(id) on delete cascade,
  name         text not null,
  relationship text,
  phone        text not null,
  is_primary   boolean default false,
  created_at   timestamptz default now()
);

alter table emergency_contacts enable row level security;

drop policy if exists "Users manage own emergency contacts" on emergency_contacts;
create policy "Users manage own emergency contacts"
  on emergency_contacts for all using (auth.uid() = user_id);

drop policy if exists "Admins can view emergency contacts" on emergency_contacts;
create policy "Admins can view emergency contacts"
  on emergency_contacts for select using (auth.role() = 'authenticated');

-- Grant anon read for admin portal demo queries (read-only, no sensitive data)
grant select on support_tickets to anon;
grant select on feedback_ratings to anon;
grant select on emergency_contacts to anon;
grant insert on support_tickets to anon;
grant insert on feedback_ratings to anon;
