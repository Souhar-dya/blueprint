import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { getSessionAccount, isAdminEmail } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import { jsonError, rejectCrossOrigin } from "../../../../lib/api";

const adminOnly = () => NextResponse.json({ error: "Only admins can manage monitoring access.", code: "ADMIN_REQUIRED" }, { status: 403 });

async function requireAdmin() {
  const account = await getSessionAccount();
  if (!account) return NextResponse.json({ error: "Sign in required.", code: "UNAUTHORIZED" }, { status: 401 });
  if (account.role !== "admin" && !isAdminEmail(account.email)) return adminOnly();
  return account;
}

export async function GET(request: Request) {
  if (rejectCrossOrigin(request)) return jsonError(request, "This API only accepts requests from the configured application origin.", 403, "ORIGIN_NOT_ALLOWED");
  const account = await requireAdmin();
  if (account instanceof NextResponse) return account;
  const sql = getDb();
  const users = await sql`select id, email, role, created_at from app_users order by created_at desc` as unknown as Array<{ id: string; email: string; role: string; created_at: string }>;
  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  if (rejectCrossOrigin(request)) return jsonError(request, "This API only accepts requests from the configured application origin.", 403, "ORIGIN_NOT_ALLOWED");
  const account = await requireAdmin();
  if (account instanceof NextResponse) return account;
  const sql = getDb();
  const body = await request.json() as { action?: "upsert" | "set-role" | "delete"; email?: string; password?: string; role?: string; id?: string };

  if (body.action === "upsert") {
    const email = (body.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) return NextResponse.json({ error: "A valid email is required.", code: "INVALID_INPUT" }, { status: 400 });
    const role = body.role === "admin" || body.role === "monitor" ? body.role : "user";
    const existing = await sql`select id from app_users where email = ${email} limit 1` as unknown as Array<{ id: string }>;
    if (existing[0]) {
      if (body.password && body.password.length < 12) return NextResponse.json({ error: "Passwords must be at least 12 characters.", code: "INVALID_INPUT" }, { status: 400 });
      if (body.password) {
        const passwordHash = await hash(body.password, 12);
        await sql`update app_users set role = ${role}, password_hash = ${passwordHash} where id = ${existing[0].id}`;
      } else {
        await sql`update app_users set role = ${role} where id = ${existing[0].id}`;
      }
      return NextResponse.json({ ok: true });
    }
    if (!body.password || body.password.length < 12) return NextResponse.json({ error: "A password of at least 12 characters is required for a new account.", code: "INVALID_INPUT" }, { status: 400 });
    const passwordHash = await hash(body.password, 12);
    const inserted = await sql`insert into app_users (email, password_hash, role) values (${email}, ${passwordHash}, ${role}) returning id` as unknown as Array<{ id: string }>;
    return NextResponse.json({ ok: true, id: inserted[0]?.id }, { status: 201 });
  }

  if (body.action === "set-role") {
    const role = body.role === "admin" || body.role === "monitor" ? body.role : "user";
    if (body.id === account.id && role !== "admin") return NextResponse.json({ error: "You cannot revoke access from your own account here. Remove your email from MONITORING_ADMIN_EMAILS to step down.", code: "SELF_DEMOTE" }, { status: 400 });
    await sql`update app_users set role = ${role} where id = ${body.id || ""}`;
    return NextResponse.json({ ok: true });
  }

  if (body.action === "delete") {
    if (body.id === account.id) return NextResponse.json({ error: "You cannot delete your own account.", code: "SELF_DELETE" }, { status: 400 });
    await sql`delete from app_users where id = ${body.id || ""}`;
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action.", code: "INVALID_INPUT" }, { status: 400 });
}