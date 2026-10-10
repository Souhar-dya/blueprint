import { NextResponse } from "next/server";
import { recordAnalytics } from "../../../lib/db";
import { jsonError, rejectCrossOrigin } from "../../../lib/api";

export async function POST(request: Request) {
  try {
    if (rejectCrossOrigin(request)) return jsonError(request, "This API only accepts requests from the configured application origin.", 403, "ORIGIN_NOT_ALLOWED");
    const body = await request.json() as { event?: string; metadata?: Record<string, unknown> };
    if (!body.event || !/^[a-z0-9_.-]{2,80}$/.test(body.event)) return NextResponse.json({ error: "Invalid event." }, { status: 400 });
    await recordAnalytics(body.event, body.metadata || {});
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Analytics unavailable." }, { status: 503 });
  }
}
