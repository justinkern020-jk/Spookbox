import { createServerFn } from "@tanstack/react-start";

async function sessionsTable() {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  await sql.query(`
    create table if not exists box_sessions (
      id integer primary key,
      count integer not null default 0
    )
  `);
  return sql;
}

export const getSessionCount = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ count: number }> => {
    const sql = await sessionsTable();
    const rows = await sql<{ count: number }>`select count from box_sessions where id = 1`;
    return { count: Number(rows[0]?.count ?? 0) };
  },
);

export const bumpSessionCount = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ count: number }> => {
    const sql = await sessionsTable();
    const rows = await sql<{ count: number }>`
      insert into box_sessions (id, count) values (1, 1)
      on conflict (id) do update set count = box_sessions.count + 1
      returning count
    `;
    return { count: Number(rows[0]?.count ?? 0) };
  },
);
