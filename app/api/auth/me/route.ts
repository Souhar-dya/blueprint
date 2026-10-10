import { NextResponse } from "next/server";
import { currentUserId } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ user: null });
  const sql = getDb();
  const rows = await sql`select id, email, role, created_at from app_users where id = ${userId} limit 1` as unknown as Array<{ id: string; email: string; role: string; created_at: string }>;
  return NextResponse.json({ user: rows[0] || null });
}