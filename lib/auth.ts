import { cookies } from "next/headers";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getDb } from "./db";

const cookieName = "blueprint_session";

function secret() {
  if (!process.env.AUTH_SECRET) throw new Error("AUTH_SECRET is required.");
  return process.env.AUTH_SECRET;
}

export function signSession(userId: string) {
  const payload = `${userId}.${Date.now()}`;
  const signature = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySession(value: string | undefined) {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = createHmac("sha256", secret()).update(payload).digest();
  const actual = Buffer.from(parts[2], "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const timestamp = Number(parts[1]);
  if (!Number.isFinite(timestamp) || Date.now() - timestamp > 1000 * 60 * 60 * 24 * 30) return null;
  return parts[0];
}

export async function currentUserId() {
  const store = await cookies();
  return verifySession(store.get(cookieName)?.value);
}

export function sessionCookie(value: string) {
  return { name: cookieName, value, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 24 * 30 };
}

export function clearSessionCookie() {
  return { ...sessionCookie(randomUUID()), value: "", maxAge: 0 };
}

/**
 * Admins are defined by the MONITORING_ADMIN_EMAILS environment allowlist.
 * Only those accounts can manage who else gets monitoring access.
 */
export function isAdminEmail(email: string | undefined): boolean {
  if (!email) return false;
  const lower = email.trim().toLowerCase();
  return (process.env.MONITORING_ADMIN_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(lower);
}

/** The signed-in account with its monitoring role, or null when anonymous. */
export async function getSessionAccount() {
  const id = await currentUserId();
  if (!id || !process.env.DATABASE_URL) return null;
  try {
    const sql = getDb();
    const rows = await sql`select id, email, role from app_users where id = ${id} limit 1` as unknown as Array<{ id: string; email: string; role: string }>;
    return rows[0] || null;
  } catch {
    return null;
  }
}
