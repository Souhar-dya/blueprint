import { NextResponse } from "next/server";

export function allowedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const configured = (process.env.ALLOWED_ORIGINS || process.env.NEXT_PUBLIC_SITE_URL || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.includes(origin) ? origin : null;
}

export function corsHeaders(request: Request): HeadersInit {
  const origin = allowedOrigin(request);
  return origin ? {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  } : new Headers();
}

export function jsonError(request: Request, message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status, headers: corsHeaders(request) });
}

export function rejectCrossOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return Boolean(origin && !allowedOrigin(request));
}
