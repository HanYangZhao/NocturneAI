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
      modelId: "eleven_flash_v2_5",
      text,
      outputFormat: "mp3_44100_128",
    });

    const chunks: Uint8Array[] = [];

    // Support both async-iterable node streams and web ReadableStream
    const candidate: unknown = audioStream;

    function isAsyncIterable(o: unknown): o is AsyncIterable<unknown> {
      return typeof o === 'object' && o !== null && Symbol.asyncIterator in Object(o);
    }

    function hasGetReader(o: unknown): o is ReadableStream {
      return typeof o === 'object' && o !== null && typeof (o as { getReader?: unknown }).getReader === 'function';
    }

    async function pushChunk(val: unknown) {
      if (val instanceof Uint8Array) chunks.push(val);
      else if (val instanceof ArrayBuffer) chunks.push(new Uint8Array(val));
      else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(val as unknown as Buffer)) chunks.push(new Uint8Array(val as unknown as Buffer));
      else if (ArrayBuffer.isView(val as ArrayBuffer)) chunks.push(new Uint8Array((val as ArrayBuffer).slice(0)));
      else {
        // unknown chunk type — skip
      }
    }

    if (isAsyncIterable(candidate)) {
      for await (const chunk of candidate) {
        await pushChunk(chunk);
      }
    } else if (hasGetReader(candidate)) {
      const reader = (candidate as ReadableStream).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await pushChunk(value);
      }
    } else {
      // Fallback: try to treat as async iterable anyway
      try {
        for await (const chunk of candidate as AsyncIterable<unknown>) {
          await pushChunk(chunk);
        }
      } catch {
        // give up
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
