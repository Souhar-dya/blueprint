import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

const envContent = readFileSync(".env", "utf8");
const dbUrlMatch = envContent.match(/^DATABASE_URL="?([^"\n]+)"?/m);
if (!dbUrlMatch) {
  console.error("DATABASE_URL not found in .env");
  process.exit(1);
}

const sql = neon(dbUrlMatch[1]);

try {
  await sql`CREATE TABLE IF NOT EXISTS custom_scenarios (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references app_users(id) on delete cascade,
    name text not null,
    prompt text not null,
    scale text not null default '',
    difficulty text not null default 'medium',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`;
  console.log("custom_scenarios table created");

  await sql`CREATE INDEX IF NOT EXISTS custom_scenarios_user_created_idx ON custom_scenarios(user_id, created_at desc)`;
  console.log("Index created");

  const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`;
  console.log("All tables:", tables.map(t => t.table_name).join(", "));
} catch (e) {
  console.error("Error:", e.message);
  process.exit(1);
}
