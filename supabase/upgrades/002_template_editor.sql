-- Upgrade for the template editor. Run once in Supabase → SQL Editor
-- (already included in schema.sql for new projects; safe to re-run).

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
