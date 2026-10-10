import { NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { getDb } from "../../../../lib/db";
import { isAdminEmail, sessionCookie, signSession } from "../../../../lib/auth";
import { jsonError, rejectCrossOrigin } from "../../../../lib/api";

export async function POST(request: Request) {
  try {
    if (rejectCrossOrigin(request)) return jsonError(request, "This API only accepts requests from the configured application origin.", 403, "ORIGIN_NOT_ALLOWED");
    const body = await request.json() as { email?: string; password?: string };
    const sql = getDb();
    const rows = await sql`select id, email, password_hash, role from app_users where email = ${body.email?.trim().toLowerCase() || ""} limit 1` as unknown as Array<{ id: string; email: string; password_hash: string; role: string }>;
    if (!rows[0] || !body.password || !(await compare(body.password, String(rows[0].password_hash)))) return NextResponse.json({ error: "Email or password is incorrect.", code: "INVALID_CREDENTIALS" }, { status: 401 });
    // Accounts listed in MONITORING_ADMIN_EMAILS are always admins — keep the
    // stored role in sync so admins can manage monitoring access from the UI.
    const account = rows[0];
    if (isAdminEmail(account.email)) {
      await sql`update app_users set role = 'admin' where id = ${account.id}`;
    }
    const response = NextResponse.json({ user: { id: account.id, email: account.email, role: isAdminEmail(account.email) ? "admin" : account.role } });
    response.cookies.set(sessionCookie(signSession(String(account.id))));
    return response;
  } catch {
    return NextResponse.json({ error: "Authentication service unavailable.", code: "AUTH_UNAVAILABLE" }, { status: 503 });
  }
}