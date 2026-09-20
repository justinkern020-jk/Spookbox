create table if not exists box_sessions (
  id integer primary key,
  count integer not null default 0
);

insert into box_sessions (id, count)
values (1, 0)
on conflict (id) do nothing;
