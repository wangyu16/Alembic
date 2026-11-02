-- 0065: Door C gives up on a push that always fails (foundations audit r2 L6).
--
-- Door C takes the 20 oldest unprocessed pushes each pass. A push that always
-- throws (a tree too large to compare, a truncated listing) used to stay
-- unprocessed forever, and twenty of them stopped Door C for every course.
-- Now each failure is counted: failing pushes go to the back of the line, and
-- after MAX attempts (worker) the event is marked processed with its error.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: before the worker that uses it.

alter table public.github_events
  add column attempts int not null default 0,
  add column last_error text;
