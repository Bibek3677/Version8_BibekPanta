-- Sample data. Run after schema.sql (Supabase > SQL Editor > Run).
-- Due dates are relative to today so there's always a mix of overdue,
-- upcoming and undated tasks.

delete from public.tasks;
delete from public.courses;

insert into public.courses (code, name) values
  ('ITC6250',  'Web and LCNC application development'),
  ('STAT5000', 'Applied statistics'),
  ('PERSONAL', 'Personal and admin');

insert into public.tasks (course_id, title, notes, due_date, priority, done)
select c.id, v.title, v.notes, current_date + v.offset_days, v.priority, v.done
from (values
  ('ITC6250',  'Design the database schema',               '',                              -2,   'high',   true),
  ('ITC6250',  'Connect the front end to the API',         '',                               1,   'high',   false),
  ('ITC6250',  'Take schema screenshot for documentation', '',                               1,   'medium', false),
  ('ITC6250',  'Write Lab 4 reflection',                   'Mention which AI tools I used.', 2,   'high',   false),
  ('STAT5000', 'Problem set 3',                            '',                              -1,   'medium', false),
  ('STAT5000', 'Read chapter 6 on regression',             '',                               5,   'low',    false),
  ('PERSONAL', 'Renew library card',                       '',                               null, 'low',   false),
  (null,       'Back up laptop',                           '',                               7,   'medium', false)
) as v(code, title, notes, offset_days, priority, done)
left join public.courses c on c.code = v.code;
