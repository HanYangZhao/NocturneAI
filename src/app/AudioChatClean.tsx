

  "use client";

  import React, { useEffect, useRef, useState } from "react";
  import logger from "./logger";
  import { RealtimeEvents, CommitStrategy } from "@elevenlabs/client";
  import { ScribeRealtime as Scribe } from "./scribe/scribe";
  import type { RealtimeConnection } from "./scribe/connection";

export default function AudioChatClean() {
      // Stop TTS audio playback
      function stopTTSPlayback() {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
          audioRef.current.src = "";
          logger.info('[TTS] Audio playback stopped by user');
          unmuteMic();
        }
      }
    const [micMuted, setMicMuted] = useState(false);
  // --- TTS and mic helpers (must be inside component for refs) ---
  const audioRef = useRef<HTMLAudioElement | null>(null);
  function muteMic() {
    const micStream = connectionRef.current?._microphoneStream;
    if (micStream && micStream.getAudioTracks().length > 0) {
      micStream.getAudioTracks().forEach((track: MediaStreamTrack) => {
        track.enabled = false;
      });
      setMicMuted(true);
    } else {
      logger.warn('No Scribe microphone stream to mute.');
      setMicMuted(true); // UI feedback only
    }
  }
  function unmuteMic() {
    const micStream = connectionRef.current?._microphoneStream;
    if (micStream && micStream.getAudioTracks().length > 0) {
      micStream.getAudioTracks().forEach((track: MediaStreamTrack) => {
        track.enabled = true;
      });
      setMicMuted(false);
    } else {
      logger.warn('No Scribe microphone stream to unmute.');
      setMicMuted(false); // UI feedback only
    }
  }
  // Play TTS audio for assistant response using <audio> element for reliability
  async function playAssistantTTS(text: string) {
    logger.info('[TTS] playAssistantTTS called with text:', text);
    if (!text || !text.trim()) {
      logger.debug('[TTS] No text provided, skipping playback');
      return;
    }
    try {
      muteMic();
      logger.debug('[TTS] Mic muted, sending request to /api/tts');
      const pwHash = await hashPassword(apiPassword || "");
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-password': pwHash },
        body: JSON.stringify({ text }),
      });
      logger.debug('[TTS] /api/tts response status:', res.status);
      if (!res.ok) throw new Error('TTS request failed');
      const audioData = await res.arrayBuffer();
      logger.debug('[TTS] Received audio data, byteLength:', audioData.byteLength);
      const blob = new Blob([audioData], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      logger.debug('[TTS] Created audio blob and object URL:', url);
      if (audioRef.current) {
        logger.debug('[TTS] Using <audio> element for playback');
        audioRef.current.src = url;
        audioRef.current.onended = () => {
          logger.debug('[TTS] <audio> playback ended, revoking URL and unmuting mic');
          URL.revokeObjectURL(url);
          unmuteMic();
        };
        try {
          await audioRef.current.play();
          logger.debug('[TTS] <audio> playback started');
        } catch (err) {
          logger.error('[TTS] <audio> playback error', err);
          unmuteMic();
        }
      } else {
        logger.debug('[TTS] <audio> ref missing, using fallback Audio()');
        const audio = new Audio(url);
        audio.onended = () => {
          logger.debug('[TTS] fallback Audio() playback ended, revoking URL and unmuting mic');
          URL.revokeObjectURL(url);
          unmuteMic();
        };
        try {
          await audio.play();
          logger.debug('[TTS] fallback Audio() playback started');
        } catch (err) {
          logger.error('[TTS] fallback Audio() playback error', err);
          unmuteMic();
        }
      }
    } catch (err) {
      logger.error('[TTS] playback error', err);
      unmuteMic();
    }
  }

  async function hashPassword(pw: string) {
    try {
      const enc = new TextEncoder().encode(pw);
      const buf = await crypto.subtle.digest('SHA-256', enc);
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      logger.warn('hashPassword failed', e);
      return '';
    }
  }

  const [connected, setConnected] = useState(false);
  const [apiPassword, setApiPassword] = useState<string>("");
  const [elStatus, setElStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [oaiStatus, setOaiStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [transcript, setTranscript] = useState("");
  const [partialTranscript, setPartialTranscript] = useState("");
  // Store transcript history as array of { role, text }
  const [transcriptHistory, setTranscriptHistory] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);
  type RealtimeWithOptionalStream = RealtimeConnection & { _microphoneStream?: MediaStream };
  const connectionRef = useRef<RealtimeWithOptionalStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const instructionSentRef = useRef<boolean>(false);
  const [instruction, setInstruction] = useState<string>("You are a helpful assistant.");
  const [assistantResponse, setAssistantResponse] = useState<string>("");
  const assistantResponseRef = useRef<string>("");
  const openaiModel = "gpt-realtime-mini";

  async function startRealtime() {
    setElStatus('connecting');
    setOaiStatus('connecting');
    try {
      // Get local mic stream for mute/unmute control
      if (!localStreamRef.current) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          localStreamRef.current = stream;
        } catch (err) {
          logger.error("Failed to get user media for mic control", err);
        }
      }
      // Start ElevenLabs connection
      const pwHash = await hashPassword(apiPassword || "");
      const tokenRes = await fetch("/api/stt/elevenlabs-token", { headers: { 'x-api-password': pwHash } });
      const tokenJson = await tokenRes.json();
      const token = tokenJson?.token;
      if (!token) throw new Error("No scribe token");

      const connection = Scribe.connect({
        token,
        modelId: "scribe_v2_realtime",
        languageCode: "en",
        commitStrategy: CommitStrategy.VAD,
        vadSilenceThresholdSecs: 1.5,
        vadThreshold: 0.5,
        minSpeechDurationMs: 250,
        minSilenceDurationMs: 250,
        includeTimestamps: false,
        microphone: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          stream: localStreamRef.current ?? undefined,
        },
      });
      connectionRef.current = connection;

      connection.on(RealtimeEvents.SESSION_STARTED, () => {
        setConnected(true);
        setElStatus('connected');
      });
      connection.on(RealtimeEvents.ERROR, (err: unknown) => {
        setElStatus('error');
        logger.error("Scribe error:", err);
      });
      connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (data: unknown) => {
        if (typeof data === 'object' && data !== null && 'text' in data) {
          const d = data as { text?: unknown };
          if (typeof d.text === 'string') setPartialTranscript(d.text);
        }
      });
      connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, async (data: unknown) => {
        let text = "";
        if (typeof data === 'object' && data !== null && 'text' in data) {
          const d = data as { text?: unknown };
          if (typeof d.text === 'string') text = d.text;
        }
        if (text) {
          setTranscript(text ?? "");
          setPartialTranscript("");
          setTranscriptHistory((h) => [...h, { role: "user", text }]);
          logger.info("Committed transcript:", text);
          if (text) await sendTextToOpenAI(text);
        }
      });
      connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT_WITH_TIMESTAMPS, (data: unknown) => {
        if (typeof data === 'object' && data !== null && 'text' in data) {
          const d = data as { text?: unknown; words?: unknown };
          if (typeof d.text === 'string') setTranscript(d.text);
          setPartialTranscript("");
          logger.debug("Timestamps:", Array.isArray(d.words) ? d.words : []);
        }
      });
      connection.on(RealtimeEvents.OPEN, () => logger.info("Connection opened"));
      connection.on(RealtimeEvents.CLOSE, () => {
        setElStatus('idle');
        setConnected(false);
      });

      // OpenAI connection: open on start
      try {
        await ensureOpenAIConnection();
        setOaiStatus('connected');
      } catch (err) {
        setOaiStatus('error');
        logger.error('OpenAI connection error', err);
      }
    } catch (e) {
      setElStatus('error');
      setOaiStatus('error');
      logger.error(e);
    }
  }

  function stopRealtime() {
    try {
      const conn = connectionRef.current;
      if (conn && typeof conn.close === "function") conn.close();
    } catch (e) {
      logger.error(e);
    }

    if (localStreamRef.current) {
      for (const t of localStreamRef.current.getTracks()) t.stop();
      localStreamRef.current = null;
    }

    connectionRef.current = null;
    setConnected(false);
    setTranscript("");
    setPartialTranscript("");
    try {
      if (dcRef.current && typeof dcRef.current.close === "function") dcRef.current.close();
    } catch (e) {
      logger.error("Failed to close data channel", e);
    }
    try {
      if (pcRef.current && typeof pcRef.current.close === "function") pcRef.current.close();
    } catch (e) {
      logger.error("Failed to close peer connection", e);
    }
    pcRef.current = null;
    dcRef.current = null;
    instructionSentRef.current = false;
  }

  async function ensureOpenAIConnection() {
    if (dcRef.current) return dcRef.current;

    // fetch ephemeral key from server
    const pwHash = await hashPassword(apiPassword || "");
    const res = await fetch("/api/ephemeral", {
      method: "POST",
      headers: { "Content-Type": "application/json", 'x-api-password': pwHash },
      body: JSON.stringify({ model: openaiModel }),
    });
    logger.debug("/api/ephemeral status:", res.status);
    const json = await res.json().catch((e) => {
      logger.error("Failed to parse /api/ephemeral response", e);
      return null;
    });
    logger.debug("/api/ephemeral body:", json);
    const token = json?.value || json?.value?.value || json?.value;
    if (!token) throw new Error("Failed to obtain ephemeral OpenAI key");

    try {
      logger.debug("Ephemeral token obtained (prefix):", typeof token === "string" ? `${token.slice(0, 8)}...` : token);
    } catch {}

    // Create RTCPeerConnection for Realtime API (we're using the data channel).
    // Add an audio transceiver so the SDP offer contains an audio media section
    // (OpenAI /calls requires an audio m-section even if we're only sending text).
    const pc = new RTCPeerConnection();
    try {
      pc.addTransceiver("audio", { direction: "recvonly" });
      logger.debug("Added audio transceiver (recvonly) to include audio m-section in SDP");
    } catch (e) {
      logger.warn("Failed to add audio transceiver", e);
    }
    pcRef.current = pc;

    // Optional: add local microphone track if you wanted audio out/in — we skip it (text-only)

    // Create data channel for events
    const dc = pc.createDataChannel("oai-events");
    dcRef.current = dc;
    setAssistantResponse("");
    assistantResponseRef.current = "";

    dc.addEventListener("open", () => {
      logger.info("OpenAI data channel opened");
    });

    dc.addEventListener("message", (ev: MessageEvent) => {
      const raw = ev.data;
      logger.debug("OpenAI DC raw message:", raw);
      try {
        const msg = JSON.parse(String(raw));
        logger.debug("OpenAI DC parsed message type:", msg.type);
        // handle response deltas
        if (msg.type === "response.delta" || msg.type === "response.output_text.delta") {
          const delta = msg.delta ?? msg.text ?? "";
          appendAssistant(delta);
        }
        if (msg.type === "response.refusal.delta") {
          appendAssistant("\n[refusal] ");
        }
        if (msg.type === "response.done") {
          logger.info("OpenAI response done", msg);
          // On completion, push the full assistant response to transcript history
          appendAssistant("", true);
          const finalResponse = assistantResponseRef.current?.trim();
          if (finalResponse) {
            playAssistantTTS(finalResponse);
          }
          // clear assistant output after a short delay so the UI resets for next response
          setTimeout(() => {
            assistantResponseRef.current = "";
            setAssistantResponse("");
          }, 5000);
        }

        // handle conversation item events (added / done / delta)
        // Optionally, you could also handle conversation.item.done here for more robust assistant turn tracking
        if (msg.type === "conversation.item.done" && msg.item && msg.item.role === "assistant") {
          // extract text from item.content robustly
          const parts: string[] = [];
          try {
            const content = msg.item.content;
            if (Array.isArray(content)) {
              for (const c of content) {
                if (!c) continue;
                const text = c.text ?? c.delta ?? c.content ?? c.value ?? "";
                if (typeof text === "string" && text.length > 0) parts.push(text);
              }
            } else if (typeof content === "string") {
              parts.push(content);
            }
          } catch (e) {
            logger.warn("Failed to extract assistant text", e, msg.item);
          }
          const joined = parts.join("");
          if (joined) setTranscriptHistory((h) => [...h, { role: "assistant", text: joined }]);
        }

        if (msg.type === "error") logger.error("OpenAI realtime error", msg);
      } catch (e: unknown) {
        logger.error("Error parsing OpenAI DC message", e, raw);
      }
    });

    // Create offer and exchange SDP with OpenAI Realtime Calls endpoint
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const callsUrl = "https://api.openai.com/v1/realtime/calls";
    logger.info("Posting offer.sdp to OpenAI Realtime Calls");
    const sdpRes = await fetch(callsUrl, {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/sdp",
      },
    });

    if (!sdpRes.ok) {
      const txt = await sdpRes.text().catch(() => "<no body>");
      logger.error("OpenAI realtime /calls error", sdpRes.status, txt);
      throw new Error("OpenAI realtime /calls failed");
    }

    const answerSdp = await sdpRes.text();
    logger.info("Received SDP answer from OpenAI");
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp } as RTCSessionDescriptionInit);

    // When connection closes, clear refs
    pc.addEventListener("iceconnectionstatechange", () => {
      logger.debug("PC iceConnectionState", pc.iceConnectionState);
      if (pc.iceConnectionState === "closed" || pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
        pcRef.current = null;
        dcRef.current = null;
      }
    });

    // Wait for data channel to open before returning it
    try {
      await new Promise<void>((resolve, reject) => {
        if (dc.readyState === "open") return resolve();
        const onOpen = () => {
          dc.removeEventListener("open", onOpen);
          clearTimeout(timer);
          resolve();
        };
        const onClose = () => {
          dc.removeEventListener("open", onOpen);
          clearTimeout(timer);
          reject(new Error("Data channel closed before open"));
        };
        dc.addEventListener("open", onOpen);
        dc.addEventListener("close", onClose);
        const timer = setTimeout(() => {
          dc.removeEventListener("open", onOpen);
          dc.removeEventListener("close", onClose);
          reject(new Error("Timeout waiting for data channel to open"));
        }, 10000);
      });
      logger.info("Data channel is open and ready");
    } catch (err) {
      logger.error("Data channel failed to open:", err);
      throw err;
    }

    return dc;
  }

  // Helper to append assistant response to UI and (optionally) transcript history
  function appendAssistant(text: string, done: boolean = false) {
    if (!text) return;
    // avoid exact trailing duplicates
    const cur = assistantResponseRef.current || "";
    if (cur.endsWith(text)) return;
    const next = cur + text;
    assistantResponseRef.current = next;
    setAssistantResponse(next);
    // If done, push to transcript history and play TTS
    logger.debug(done)
    logger.debug(next.trim())
    if (done && next.trim()) {
      setTranscriptHistory((h) => [...h, { role: "assistant", text: next.trim() }]);
    }
  }

  async function sendTextToOpenAI(text: string) {
    try {
      const dc = await ensureOpenAIConnection();
      // Clear previous assistant output before sending new user prompt
      assistantResponseRef.current = "";
      setAssistantResponse("");
      // Send the system instruction once per session
      if (!instructionSentRef.current && instruction && instruction.length > 0) {
        const sysEvent = {
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "system",
            content: [
              {
                type: "input_text",
                text: instruction,
              },
            ],
          },
        };
        logger.debug("Sending system instruction to OpenAI data channel", sysEvent);
        try {
          dc.send(JSON.stringify(sysEvent));
          instructionSentRef.current = true;
        } catch (sendErr) {
          logger.error("Data channel send failed (system)", sendErr);
        }
      }

      const event = {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: text,
            },
          ],
        },
      };
      logger.debug("Sending user event to OpenAI data channel", event);
      try {
        dc.send(JSON.stringify(event));
      } catch (sendErr) {
        logger.error("Data channel send failed (user)", sendErr);
      }
      // After adding the user message, request a response from the model
      const responseCreate = { type: "response.create" };
      logger.debug("Sending response.create to OpenAI data channel", responseCreate);
      try {
        dc.send(JSON.stringify(responseCreate));
      } catch (sendErr) {
        logger.error("Data channel send failed (response.create)", sendErr);
      }
    } catch (e) {
      logger.error("Failed to send to OpenAI realtime", e);
    }
  }

  useEffect(() => {
    return () => {
      stopRealtime();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
      {/* Hidden audio element for TTS playback */}
      <audio ref={audioRef} style={{ display: 'none' }} />
      <h1 className="text-2xl font-bold">Nocturne AI</h1>
      <div className="w-full max-w-xl bg-white p-4 rounded shadow">
        <div className="flex gap-2 mb-2">
          <button
            onClick={micMuted ? unmuteMic : muteMic}
            className={`px-3 py-1 rounded ${micMuted ? 'bg-gray-400 text-white' : 'bg-blue-600 text-white'}`}
            disabled={!connected}
          >
            {micMuted ? 'Unmute Mic' : 'Mute Mic'}
          </button>
          <button
            onClick={stopTTSPlayback}
            className="px-3 py-1 rounded bg-red-400 text-white"
            disabled={!connected}
          >
            Stop Audio
          </button>
          <span className={`text-sm ${micMuted ? 'text-red-600' : 'text-green-600'}`}>{micMuted ? 'Mic is muted' : 'Mic is live'}</span>
        </div>
        <div className="flex gap-3 items-center">
          <button onClick={startRealtime} disabled={connected || elStatus === 'connecting' || oaiStatus === 'connecting'} className="px-4 py-2 bg-green-600 text-white rounded">Start Session</button>
          <button onClick={stopRealtime} disabled={!connected} className="px-4 py-2 bg-red-500 text-white rounded">Stop Session</button>
          <span className="ml-4 flex items-center gap-2">
            <span className={
              elStatus === 'connected' ? 'text-green-600' :
              elStatus === 'connecting' ? 'text-yellow-600 animate-pulse' :
              elStatus === 'error' ? 'text-red-600' : 'text-gray-400'
            }>ElevenLabs: {elStatus.charAt(0).toUpperCase() + elStatus.slice(1)}</span>
            <span className={
              oaiStatus === 'connected' ? 'text-green-600' :
              oaiStatus === 'connecting' ? 'text-yellow-600 animate-pulse' :
              oaiStatus === 'error' ? 'text-red-600' : 'text-gray-400'
            }>OpenAI: {oaiStatus.charAt(0).toUpperCase() + oaiStatus.slice(1)}</span>
          </span>
        </div>
        <div className="mt-3">
          <label className="block text-sm font-medium mb-1">API Password</label>
          <input
            type="password"
            value={apiPassword}
            onChange={(e) => setApiPassword(e.target.value)}
            className="w-full p-2 border rounded mb-2"
            placeholder="Enter API password"
          />
          <label className="block text-sm font-medium mb-1">Assistant Instructions</label>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={3}
            className="w-full p-2 border rounded resize-none"
            placeholder="Guidance for the assistant (system prompt)"
          />
        </div>
      </div>
      <div className="w-full max-w-xl bg-white p-4 rounded shadow mt-4">
        <div><strong>Live Transcript</strong></div>
        <div className="mt-2 max-h-40 overflow-auto p-2 border rounded bg-gray-50 text-sm whitespace-pre-wrap">
          {partialTranscript ? (
            <div className="mb-2"><strong>Partial:</strong> <em>{partialTranscript}</em></div>
          ) : null}
          {transcript ? (
            <div><strong>Committed:</strong> <em>{transcript}</em></div>
          ) : (
            <div className="text-gray-400">(no transcript)</div>
          )}
        </div>
      </div>

      <div className="w-full max-w-xl bg-white p-4 rounded shadow mt-4">
        <div><strong>Assistant Response</strong></div>
        <div className="min-h-[48px] p-2 border rounded bg-gray-50 whitespace-pre-wrap">{assistantResponse || <span className="text-gray-400">(no response)</span>}</div>
      </div>
      <div className="w-full max-w-xl bg-white p-4 rounded shadow mt-4">
        <div className="flex items-center justify-between">
          <strong>Transcript History</strong>
          <button onClick={() => setTranscriptHistory([])} className="text-sm text-red-600">Clear</button>
        </div>
        <div
          className="mt-2 max-h-48 overflow-y-auto overflow-x-hidden p-2 border rounded bg-gray-50"
          role="region"
          aria-label="Transcript history"
          tabIndex={0}
        >
          {transcriptHistory.length === 0 ? (
            <div className="text-gray-400">(no transcripts yet)</div>
          ) : (
            transcriptHistory.map((t, i) => (
              <div key={i} className="mb-2">
                <div className="text-xs text-gray-500">{i + 1} <span className={t.role === "user" ? "text-blue-600" : "text-green-600"}>[{t.role}]</span></div>
                <div className="text-sm whitespace-pre-wrap">{t.text}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
