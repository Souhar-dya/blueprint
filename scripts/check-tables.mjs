import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

try {
  const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`;
  console.log("Tables:", JSON.stringify(tables));

  const columns = await sql`select column_name, data_type from information_schema.columns where table_name = 'custom_scenarios' order by ordinal_position`;
  console.log("custom_scenarios columns:", JSON.stringify(columns));
} catch (e) {
  console.error("Error:", e.message);
}
