import { NextRequest } from "next/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const audio = form.get("audio") as File | null;
  if (!audio) {
    return new Response(JSON.stringify({ error: "No audio file provided" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return new Response(JSON.stringify({ error: "Missing OpenAI API key" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Rebuild a FormData to send to OpenAI
  const fd = new FormData();
  fd.append("file", audio, "audio.webm");
  fd.append("model", "whisper-1");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
    } as any,
    body: fd as any,
  });

  if (!res.ok) {
    const txt = await res.text();
    return new Response(JSON.stringify({ error: txt }), { status: res.status, headers: { "Content-Type": "application/json" } });
  }

  const data = await res.json();
  return new Response(JSON.stringify({ text: data.text }), { headers: { "Content-Type": "application/json" } });
}
