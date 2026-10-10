import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { getDb } from "../../../../lib/db";
import { isAdminEmail, sessionCookie, signSession } from "../../../../lib/auth";
import { jsonError, rejectCrossOrigin } from "../../../../lib/api";

export async function POST(request: Request) {
  try {
    if (rejectCrossOrigin(request)) return jsonError(request, "This API only accepts requests from the configured application origin.", 403, "ORIGIN_NOT_ALLOWED");
    const body = await request.json() as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase();
    if (!email || !email.includes("@") || !body.password || body.password.length < 12) return NextResponse.json({ error: "Use a valid email and a password of at least 12 characters.", code: "INVALID_INPUT" }, { status: 400 });
    const sql = getDb();
    const passwordHash = await hash(body.password, 12);
    const role = isAdminEmail(email) ? "admin" : "user";
    const rows = await sql`insert into app_users (email, password_hash, role) values (${email}, ${passwordHash}, ${role}) returning id, email, role` as unknown as Array<{ id: string; email: string; role: string }>;
    const response = NextResponse.json({ user: rows[0] }, { status: 201 });
    response.cookies.set(sessionCookie(signSession(String(rows[0].id))));
    return response;
  } catch (error) {
    if (error instanceof Error && error.message.includes("unique")) return NextResponse.json({ error: "An account with that email already exists.", code: "EMAIL_EXISTS" }, { status: 409 });
    return NextResponse.json({ error: "Unable to create the account.", code: "AUTH_UNAVAILABLE" }, { status: 503 });
  }
}