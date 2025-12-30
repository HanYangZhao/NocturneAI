import { NextRequest } from "next/server";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const text = body.text as string | undefined;
  if (!text) {
    return new Response(JSON.stringify({ error: "Missing text" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const elevenKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!elevenKey || !voiceId) {
    return new Response(JSON.stringify({ error: "Missing ElevenLabs config" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const client = new ElevenLabsClient({ apiKey: elevenKey });

  // Use the SDK to stream and collect audio chunks
  try {
    const audioStream = await client.textToSpeech.stream(voiceId, {
      modelId: "eleven_multilingual_v2",
      text,
      outputFormat: "mp3_44100_128",
    });

    const chunks: Uint8Array[] = [];

    // Support both async-iterable node streams and web ReadableStream
    if (typeof (audioStream as any)[Symbol.asyncIterator] === "function") {
      for await (const chunk of audioStream as any) {
        if (chunk instanceof Uint8Array) chunks.push(chunk);
        else if (typeof Buffer !== "undefined" && Buffer.isBuffer(chunk)) chunks.push(new Uint8Array(chunk));
        else chunks.push(new Uint8Array(chunk as any));
      }
    } else if (typeof (audioStream as any).getReader === "function") {
      const reader = (audioStream as any).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value as Uint8Array | ArrayBuffer;
        if (chunk instanceof Uint8Array) chunks.push(chunk);
        else if (chunk instanceof ArrayBuffer) chunks.push(new Uint8Array(chunk));
        else chunks.push(new Uint8Array(chunk as any));
      }
    } else {
      // Fallback: try to treat as async iterable anyway
      for await (const chunk of audioStream as any) {
        if (chunk instanceof Uint8Array) chunks.push(chunk);
        else if (typeof Buffer !== "undefined" && Buffer.isBuffer(chunk)) chunks.push(new Uint8Array(chunk));
        else chunks.push(new Uint8Array(chunk as any));
      }
    }

    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }

    return new Response(out, { headers: { "Content-Type": "audio/mpeg", "Content-Length": String(out.length) } });
  } catch (err: any) {
    const message = err?.message ?? String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
