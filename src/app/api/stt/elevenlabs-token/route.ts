import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const provided = req.headers.get('x-api-password') || '';
  const expected = process.env.API_PASSWORD_HASH;
  if (!expected) {
    return new Response(JSON.stringify({ error: 'Missing API_PASSWORD_HASH on server' }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
  if (provided !== expected) {
    return new Response(JSON.stringify({ error: 'Invalid API password' }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const elevenKey = process.env.ELEVENLABS_API_KEY;
  if (!elevenKey) {
    return new Response(JSON.stringify({ error: "Missing ELEVENLABS_API_KEY" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  try {
    const resp = await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", {
      method: "POST",
      headers: {
        "xi-api-key": elevenKey,
        "Content-Type": "application/json",
      },
    });
    const body = await resp.json();
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: body }), { status: resp.status, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ token: body.token }), { headers: { "Content-Type": "application/json" } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
