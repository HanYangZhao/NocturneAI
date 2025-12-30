import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const model = (body.model as string) || "gpt-realtime-mini";

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY on server" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({ session: { type: "realtime", model, output_modalities :["text"] } }),
    });

    const txt = await res.text();
    // Log server-side for debugging (won't expose the API key)
    console.log("/api/ephemeral -> OpenAI status:", res.status);
    try {
      console.log("/api/ephemeral -> OpenAI body:", txt);
    } catch (e) {
      console.log("/api/ephemeral -> OpenAI body (unserializable)");
    }

    if (!res.ok) {
      // return status and body to the client for debugging (no secret returned)
      return new Response(JSON.stringify({ status: res.status, body: txt }), { status: res.status, headers: { "Content-Type": "application/json" } });
    }

    const data = JSON.parse(txt);
    // data.value contains ephemeral key starting with ek_
    return new Response(JSON.stringify({ value: data.value }), { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("/api/ephemeral error:", err);
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
