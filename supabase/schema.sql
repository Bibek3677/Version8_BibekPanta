-- Lab Task Tracker, Version 4: Supabase (PostgreSQL) schema
-- Paste this whole file into Supabase > SQL Editor and click Run.
-- Safe to re-run: it drops and recreates the app's objects.

drop function if exists public.list_tasks(text, text, text, text, date);
drop function if exists public.task_stats(date);
drop view if exists public.task_details;
drop view if exists public.course_summary;
drop table if exists public.tasks;
drop table if exists public.courses;
drop function if exists public.set_updated_at();

-- ---------- tables ----------

create table public.courses (
  id          bigint generated always as identity primary key,
  code        text not null unique
              check (char_length(code) between 2 and 20 and code = upper(code)),
  name        text not null check (char_length(name) between 1 and 100),
  created_at  timestamptz not null default now()
);

create table public.tasks (
  id          bigint generated always as identity primary key,
  course_id   bigint references public.courses(id) on delete restrict,
  title       text not null check (char_length(title) between 1 and 120),
  notes       text not null default '' check (char_length(notes) <= 1000),
  due_date    date,
  priority    text not null default 'medium'
              check (priority in ('low', 'medium', 'high')),
  done        boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index tasks_course_id_idx on public.tasks (course_id);
create index tasks_due_date_idx  on public.tasks (due_date);
create index tasks_done_idx      on public.tasks (done);

-- Keep updated_at current on every UPDATE.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

-- ---------- security ----------
-- Row Level Security on, with no policies: the public (publishable/anon) key
-- cannot read or write anything. Only the Node server, which holds the
-- secret key, can reach the data.

alter table public.courses enable row level security;
alter table public.tasks   enable row level security;

-- ---------- views ----------

create view public.task_details
with (security_invoker = on) as
select t.id, t.course_id, t.title, t.notes, t.due_date, t.priority, t.done,
       t.created_at, t.updated_at,
       c.code as course_code, c.name as course_name
from public.tasks t
left join public.courses c on c.id = t.course_id;

create view public.course_summary
with (security_invoker = on) as
select c.id, c.code, c.name, c.created_at,
       count(t.id)::int                          as task_count,
       count(t.id) filter (where not t.done)::int as open_count
from public.courses c
left join public.tasks t on t.course_id = c.id
group by c.id;

-- ---------- functions (called through /rest/v1/rpc/...) ----------

-- Filtered, searched and sorted task list in one query.
-- p_today is passed in by the server so "overdue" uses the user's local date.
create function public.list_tasks(
  p_status text default 'all',
  p_course text default '',
  p_q      text default '',
  p_sort   text default 'due',
  p_today  date default current_date
)
returns setof public.task_details
language sql
stable
set search_path = public
as $$
  with pattern as (
    -- escape \ % _ so search text is matched literally
    select '%' || replace(replace(replace(coalesce(p_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%' as like_q
  )
  select t.*
  from public.task_details t, pattern p
  where (
          p_status = 'all'
       or (p_status = 'open'    and not t.done)
       or (p_status = 'done'    and t.done)
       or (p_status = 'overdue' and not t.done and t.due_date < p_today)
        )
    and (
          coalesce(p_course, '') = ''
       or (p_course = 'none' and t.course_id is null)
       or t.course_id::text = p_course
        )
    and (
          coalesce(p_q, '') = ''
       or t.title ilike p.like_q
       or t.notes ilike p.like_q
        )
  order by
    case when p_sort = 'newest' then t.created_at end desc,
    t.done asc,
    case when p_sort = 'due' then t.due_date is null end asc,
    case when p_sort = 'due' then t.due_date end asc,
    case t.priority when 'high' then 0 when 'medium' then 1 else 2 end asc,
    t.due_date is null asc,
    t.due_date asc,
    t.id asc;
$$;

create function public.task_stats(p_today date default current_date)
returns json
language sql
stable
set search_path = public
as $$
  select json_build_object(
    'total',   count(*)::int,
    'open',    count(*) filter (where not done)::int,
    'done',    count(*) filter (where done)::int,
    'overdue', count(*) filter (where not done and due_date < p_today)::int
  )
  from public.tasks;
$$;

-- Only the server (secret key) may call the functions.
revoke execute on function public.list_tasks(text, text, text, text, date) from public, anon, authenticated;
revoke execute on function public.task_stats(date) from public, anon, authenticated;
