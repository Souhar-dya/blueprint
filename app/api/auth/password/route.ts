import { NextResponse } from "next/server";
import { compare, hash } from "bcryptjs";
import { getSessionAccount } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import { jsonError, rejectCrossOrigin } from "../../../../lib/api";

export async function POST(request: Request) {
  if (rejectCrossOrigin(request)) return jsonError(request, "This API only accepts requests from the configured application origin.", 403, "ORIGIN_NOT_ALLOWED");
  try {
    const account = await getSessionAccount();
    if (!account) return NextResponse.json({ error: "Sign in required.", code: "UNAUTHORIZED" }, { status: 401 });

    const body = await request.json() as { currentPassword?: string; newPassword?: string };
    const currentPassword = body.currentPassword || "";
    const newPassword = body.newPassword || "";
    if (!currentPassword || newPassword.length < 12) {
      return NextResponse.json({ error: "Enter your current password and a new password of at least 12 characters.", code: "INVALID_INPUT" }, { status: 400 });
    }

    const sql = getDb();
    const rows = await sql`select password_hash from app_users where id = ${account.id} limit 1` as unknown as Array<{ password_hash: string }>;
    if (!rows[0] || !(await compare(currentPassword, rows[0].password_hash))) {
      return NextResponse.json({ error: "Current password is incorrect.", code: "BAD_PASSWORD" }, { status: 400 });
    }

    const passwordHash = await hash(newPassword, 12);
    await sql`update app_users set password_hash = ${passwordHash} where id = ${account.id}`;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to change the password.", code: "AUTH_UNAVAILABLE" }, { status: 503 });
  }
}