-- ============================================================================
-- Negotiation thread: live, editable, permanent.
--
-- Three changes, all to negotiation_messages:
--
--   1. `edited_at`   — a message can be corrected, and the correction is
--                      visible. Editing silently would be worse than not
--                      allowing it at all, because the other side has already
--                      read the original.
--   2. an UPDATE policy scoped to the author's own message body. There is
--      deliberately no DELETE policy: under RLS, no policy means no deletes,
--      so the thread is append-and-amend and nothing ever leaves it. That is
--      the point — this is the record of what was agreed with a customer.
--   3. the table joins the realtime publication, so both sides see a message
--      land without reloading.
--
-- Reading is untouched and already correct: `negotiation_messages_read` defers
-- to the quotations policy, which gives a rep their own rows, a manager or
-- finance user every row, and a customer only their own. That is exactly the
-- visibility this feature needs, so nothing here widens it.
--
-- Idempotent: safe to re-run.
--
--   Paste into Supabase -> SQL Editor -> Run.
-- ============================================================================

-- ------------------------------------------------------------ 1. edited_at

alter table negotiation_messages
  add column if not exists edited_at timestamptz;

comment on column negotiation_messages.edited_at is
  'When the author last amended the body. Null means never edited.';

-- ------------------------------------------------------------ 2. edit policy

drop policy if exists negotiation_messages_update on negotiation_messages;
create policy negotiation_messages_update on negotiation_messages
  for update
  using (
    -- Only your own message, and only while you can still write to the thread.
    author_id = clerk_user_id()
    and has_capability('customerPortal', 'write')
    and quotation_id in (select id from quotations)
  )
  with check (
    -- The row must still belong to the same author on the same quotation after
    -- the update: without this, an author could rewrite `author_id` and hand
    -- their message to somebody else, or move it onto another quotation.
    author_id = clerk_user_id()
    and quotation_id in (select id from quotations)
  );

-- No delete policy, on purpose. RLS denies by default, so this is what makes
-- the thread permanent. If a message must be withdrawn, the author edits it to
-- say so — which leaves the withdrawal itself on the record.
drop policy if exists negotiation_messages_delete on negotiation_messages;

-- ------------------------------------------------------------ 3. realtime

-- `alter publication ... add table` raises 42710 if the table is already a
-- member, so check the catalog first — same guard the quotations table uses at
-- the end of setup.sql.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'negotiation_messages'
  ) then
    alter publication supabase_realtime add table negotiation_messages;
  end if;
end $$;

-- ------------------------------------------------------------ check

select
  (select count(*) from information_schema.columns
    where table_name = 'negotiation_messages' and column_name = 'edited_at') as has_edited_at,
  (select count(*) from pg_policies
    where tablename = 'negotiation_messages' and cmd = 'UPDATE') as update_policies,
  (select count(*) from pg_policies
    where tablename = 'negotiation_messages' and cmd = 'DELETE') as delete_policies,
  (select count(*) from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'negotiation_messages') as in_realtime;
