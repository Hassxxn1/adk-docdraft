-- ADK Policy and SOP Drafting Portal: Supabase schema (prototype)
-- Run once in Supabase → SQL Editor. Safe to re-run: it drops and re-seeds the config tables only.

-- ---------- Configuration (replaces lib/config.js) ----------
-- HR maintains these rows. Treat changes as amendments to the controlled Master Template.

create table if not exists public.departments (
  code text primary key,
  name text not null,
  sort int not null default 0,
  active boolean not null default true
);

create table if not exists public.doc_types (
  key text primary key,
  label text not null,
  level int not null,
  prefix text not null,
  colour text not null,            -- hex, no #
  template text not null check (template in ('policy', 'sop')),
  review_years int not null,
  review_text text not null,
  reviewers text[] not null default '{}',
  final_approval text not null,
  rollout text not null,
  force_dept text references public.departments(code),
  clinical boolean not null default false,
  sort int not null default 0,
  active boolean not null default true
);

-- Department codes. COR and CLN are fixed by the Master Template.
-- HR: confirm every other code against Annex 1 of COR-SOP-001 before go-live.
insert into public.departments (code, name, sort) values
  ('COR', 'Hospital Management (organisation-wide)', 1),
  ('QSD', 'Quality and Safety', 2),
  ('CLN', 'Clinical Services', 3),
  ('NUR', 'Nursing', 4),
  ('HRD', 'Human Resources', 5),
  ('FIN', 'Finance', 6),
  ('ITD', 'Information Technology', 7),
  ('OPS', 'Operations and Infrastructure', 8),
  ('PHA', 'Pharmacy', 9),
  ('LAB', 'Laboratory', 10),
  ('RAD', 'Radiology and Imaging', 11)
on conflict (code) do update set name = excluded.name, sort = excluded.sort;

insert into public.doc_types (key, label, level, prefix, colour, template, review_years, review_text, reviewers, final_approval, rollout, force_dept, clinical, sort) values
  ('ORG_POLICY', 'Organisation-wide Policy', 1, 'POL', 'B9D3DC', 'policy', 2, 'Every 2 years',
    array['MD and relevant leadership'], 'Board and/or CEO/Chairman',
    'Hospital memo and briefing; training mandatory; acknowledgement mandatory', 'COR', false, 1),
  ('DEPT_POLICY', 'Department Policy', 2, 'POL', '71B2C9', 'policy', 2, 'Every 2 years',
    array['Director/HOD', 'HR (governance check)'], 'MD and/or Board',
    'Communicated to the relevant department; training if operational impact; acknowledgement where applicable', null, false, 2),
  ('SOP', 'Standard Operating Procedure (SOP)', 3, 'SOP', 'FEAD77', 'sop', 1, 'Annual',
    array['Department Head/Director'], 'Director and/or MD',
    'Department briefing; competency-based training if needed; acknowledgement optional', null, false, 3),
  ('CLINICAL_PROTOCOL', 'Clinical Protocol', 3, 'PRT', 'FDD263', 'sop', 1, 'Annual, or as regulation requires',
    array['Clinical leadership', 'CMO'], 'CMO',
    'Clinical training; training mandatory; acknowledgement mandatory', null, true, 4)
on conflict (key) do update set
  label = excluded.label, level = excluded.level, prefix = excluded.prefix, colour = excluded.colour,
  template = excluded.template, review_years = excluded.review_years, review_text = excluded.review_text,
  reviewers = excluded.reviewers, final_approval = excluded.final_approval, rollout = excluded.rollout,
  force_dept = excluded.force_dept, clinical = excluded.clinical, sort = excluded.sort;

-- ---------- Drafts (audit trail + "My drafts" history) ----------
-- AI drafts are written by the `draft` Edge Function. Authors save editor changes to their own rows.
-- Users read their own rows; admins read all.

create table if not exists public.drafts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text not null,
  user_name text,
  doc_type text not null,
  dept_code text,
  title text not null,
  status text not null default 'ok' check (status in ('ok', 'failed')),
  ai boolean not null default false,
  flags int not null default 0,
  meta jsonb,        -- document control fields used to rebuild the Word file
  content jsonb,     -- structured draft content (null when failed)
  error text
);

create index if not exists drafts_user_created on public.drafts (user_id, created_at desc);

-- ---------- Admin helper ----------
-- Admin = user whose app_metadata has {"role": "admin"} (set with the SQL at the bottom).
create or replace function public.is_admin() returns boolean
language sql stable as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
$$;

-- ---------- Row Level Security ----------
alter table public.departments enable row level security;
alter table public.doc_types   enable row level security;
alter table public.drafts      enable row level security;

drop policy if exists "read departments" on public.departments;
create policy "read departments" on public.departments for select to authenticated using (true);
drop policy if exists "admin manage departments" on public.departments;
create policy "admin manage departments" on public.departments for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "read doc types" on public.doc_types;
create policy "read doc types" on public.doc_types for select to authenticated using (true);
drop policy if exists "admin manage doc types" on public.doc_types;
create policy "admin manage doc types" on public.doc_types for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "read own drafts" on public.drafts;
create policy "read own drafts" on public.drafts for select to authenticated using (user_id = auth.uid() or public.is_admin());
-- AI drafts are written by the Edge Function (service role). The template editor adds the
-- source/updated_at columns, insert/update policies and the audit-protection trigger:

alter table public.drafts add column if not exists source text not null default 'ai'
  check (source in ('ai', 'template', 'blank'));      -- ai = Claude; template = no API key; blank = started in the editor
alter table public.drafts add column if not exists updated_at timestamptz;

-- Authors can start drafts in the editor and save edits to their own drafts.
drop policy if exists "insert own blank drafts" on public.drafts;
create policy "insert own blank drafts" on public.drafts for insert to authenticated
  with check (user_id = auth.uid() and source = 'blank' and ai = false and status = 'ok');

drop policy if exists "update own drafts" on public.drafts;
create policy "update own drafts" on public.drafts for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Keep the audit fields honest: whoever writes from the browser cannot change who drafted it,
-- when, with what, or claim AI assistance. Only title, meta, content, flags and updated_at change.
create or replace function public.protect_draft_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- service role (Edge Function)
  if tg_op = 'INSERT' then
    new.user_email := coalesce(auth.jwt() ->> 'email', new.user_email);
    new.created_at := now();
    new.meta := jsonb_set(coalesce(new.meta, '{}'), '{ai}', 'false');
  else
    new.id := old.id; new.user_id := old.user_id; new.user_email := old.user_email; new.user_name := old.user_name;
    new.doc_type := old.doc_type; new.dept_code := old.dept_code; new.created_at := old.created_at;
    new.ai := old.ai; new.source := old.source; new.status := old.status; new.error := old.error;
    new.meta := jsonb_set(coalesce(new.meta, '{}'), '{ai}', to_jsonb(old.ai));
  end if;
  return new;
end $$;

drop trigger if exists protect_draft_audit on public.drafts;
create trigger protect_draft_audit before insert or update on public.drafts
  for each row execute function public.protect_draft_audit();


-- ---------- After creating users (Authentication → Users → Add user) ----------
-- Give the display name used in "Drafted by":
--   update auth.users set raw_user_meta_data = raw_user_meta_data || '{"full_name":"Ahmed Hassaan"}' where email = 'hassaan@adkhospital.com';
-- Make someone an admin (sees all drafts = audit log). They must sign out and in again:
--   update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}' where email = 'hassaan@adkhospital.com';
