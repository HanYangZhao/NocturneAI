

  "use client";

  import React, { useEffect, useRef, useState } from "react";
  import logger from "./logger";
  import * as AudioFX from "./audiofx";
  import { RealtimeEvents, CommitStrategy } from "@elevenlabs/client";
  import { ScribeRealtime as Scribe } from "./scribe/scribe";
  import type { RealtimeConnection } from "./scribe/connection";

export default function AudioChatClean() {
      // Stop TTS audio playback
      function stopTTSPlayback() {
        // Stop element-based playback
        if (audioRef.current) {
          try { audioRef.current.pause(); } catch (e) {}
          try { audioRef.current.currentTime = 0; } catch (e) {}
          try { audioRef.current.src = ""; } catch (e) {}
        }
        // Stop any active AudioBufferSourceNode (AudioContext playback)
        try {
            // disconnect audiofx chain first to ensure effect nodes stop producing audio
            try { AudioFX.disconnectActiveChain(); } catch (e) {}
            if (activeBufferSrcRef.current) {
            try {
              activeBufferSrcRef.current.onended = null;
            } catch (e) {}
            try { activeBufferSrcRef.current.stop(); } catch (e) {}
            try { activeBufferSrcRef.current.disconnect(); } catch (e) {}
            activeBufferSrcRef.current = null;
          }
        } catch (e) {
          // ignore
        }
          try { isPlayingTTSRef.current = false; } catch (e) {}
        logger.info('[TTS] Audio playback stopped by user');
        unmuteMic();
      }
    const [micMuted, setMicMuted] = useState(false);
  // --- TTS and mic helpers (must be inside component for refs) ---
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Active AudioBufferSourceNode when using AudioContext playback
  const activeBufferSrcRef = useRef<AudioBufferSourceNode | null>(null);
  // Track when we're playing assistant TTS so we can ignore mic transcripts
  const isPlayingTTSRef = useRef<boolean>(false);
  // Additional audio routing refs / state
  const graphAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const outDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const [audioOutputs, setAudioOutputs] = useState<{ deviceId: string; label: string }[]>([]);
  const [selectedOutputId, setSelectedOutputId] = useState<string>("default");
  const [supportsSetSinkId, setSupportsSetSinkId] = useState<boolean>(false);
  
  // Effects manager (UI state mirrored to audiofx)
  const [effectsList, setEffectsList] = useState<Array<{ id: string; type: string; params: any; bypass?: boolean }>>([]);
  const [chainList, setChainList] = useState<string[]>([]);
  const defaultChainRef = useRef<string[] | null>(null);

  function computeChainFromConnections(conns: Array<{ from: string; to: string }>) {
    // build successor map (keep first successor if multiple)
    const succ: Record<string,string> = {};
    const indegree: Record<string, number> = {};
    for (const e of effectsList) indegree[e.id]=0;
    for (const c of conns) {
      if (!succ[c.from]) succ[c.from]=c.to;
      indegree[c.to] = (indegree[c.to]||0)+1;
    }
    // find start nodes (indegree 0)
    const starts = Object.keys(indegree).filter(k=>indegree[k]===0);
    const order: string[] = [];
    if (starts.length>0) {
      let cur = starts[0];
      const visited = new Set<string>();
      while (cur && !visited.has(cur)) {
        visited.add(cur);
        order.push(cur);
        const n = succ[cur];
        if (!n) break;
        cur = n;
      }
      // append any remaining not in order
      for (const e of effectsList.map(x=>x.id)) if (!order.includes(e)) order.push(e);
    } else {
      // fallback to effectsList order
      for (const e of effectsList) order.push(e.id);
    }
    setChainList(order);
    AudioFX.setChain(order);
  }

  const paramRanges: Record<string, { min: number; max: number; step?: number }> = {
    feedback: { min: 0, max: 1, step: 0.01 },
    delayTime: { min: 1, max: 10000, step: 1 },
    wetLevel: { min: 0, max: 2, step: 0.01 },
    dryLevel: { min: 0, max: 2, step: 0.01 },
    cutoff: { min: 20, max: 22050, step: 1 },
    rate: { min: 0.01, max: 8, step: 0.01 },
    depth: { min: 0, max: 1, step: 0.01 },
    feedback: { min: 0, max: 1, step: 0.01 },
    delay: { min: 0, max: 1, step: 0.0001 },
    outputGain: { min: -42, max: 0, step: 0.1 },
    drive: { min: 0, max: 1, step: 0.01 },
    curveAmount: { min: 0, max: 1, step: 0.01 },
    threshold: { min: -100, max: 0, step: 1 },
    makeupGain: { min: 0, max: 20, step: 0.1 },
    attack: { min: 0, max: 1000, step: 1 },
    release: { min: 0, max: 3000, step: 1 },
    ratio: { min: 1, max: 20, step: 0.1 },
    knee: { min: 0, max: 40, step: 0.1 },
    frequency: { min: 20, max: 22050, step: 1 },
    Q: { min: 0.001, max: 100, step: 0.001 },
    intensity: { min: 0, max: 1, step: 0.01 },
    bits: { min: 1, max: 16, step: 1 },
    normfreq: { min: 0, max: 1, step: 0.01 },
    cutoff: { min: 0, max: 1, step: 0.001 },
    bufferSize: { min: 256, max: 16384, step: 256 },
    resonance: { min: 0, max: 4, step: 0.01 },
  };
  function muteMic() {
    // mute both the local stream obtained via getUserMedia and any stream
    // attached inside the Scribe connection (connectionRef.current._microphoneStream)
    let muted = false;
    try {
      const local = localStreamRef.current;
      if (local && local.getAudioTracks().length > 0) {
        local.getAudioTracks().forEach((t) => (t.enabled = false));
        muted = true;
      }
    } catch (e) {
      logger.warn('Failed to mute localStreamRef', e);
    }
    try {
      const micStream = connectionRef.current?._microphoneStream;
      if (micStream && micStream.getAudioTracks().length > 0) {
        micStream.getAudioTracks().forEach((track: MediaStreamTrack) => {
          track.enabled = false;
        });
        muted = true;
      }
    } catch (e) {
      logger.warn('Failed to mute connection microphone stream', e);
    }
    setMicMuted(muted);
  }
  function unmuteMic() {
    let unmuted = false;
    try {
      const local = localStreamRef.current;
      if (local && local.getAudioTracks().length > 0) {
        local.getAudioTracks().forEach((t) => (t.enabled = true));
        unmuted = true;
      }
    } catch (e) {
      logger.warn('Failed to unmute localStreamRef', e);
    }
    try {
      const micStream = connectionRef.current?._microphoneStream;
      if (micStream && micStream.getAudioTracks().length > 0) {
        micStream.getAudioTracks().forEach((track: MediaStreamTrack) => {
          track.enabled = true;
        });
        unmuted = true;
      }
    } catch (e) {
      logger.warn('Failed to unmute connection microphone stream', e);
    }
    setMicMuted(!unmuted);
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
      // mark that we're playing TTS so STT transcripts can be ignored
      try { isPlayingTTSRef.current = true; } catch (e) {}
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
      // Route TTS through AudioContext -> MediaStreamDestination so it uses the selected output
      try {
        const ac = audioContextRef.current || new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = ac;
        const decoded = await ac.decodeAudioData(audioData.slice(0));
        const src = ac.createBufferSource();
        src.buffer = decoded;
        // track active buffer source so Stop button can stop it
        try { activeBufferSrcRef.current = src; } catch (e) {}
        // ensure destination exists
        const dest = outDestinationRef.current || ac.createMediaStreamDestination();
        outDestinationRef.current = dest;
        // connect source through user-configured effects chain
        try {
          AudioFX.initTuna(ac);
          const inputGain = ac.createGain();
          src.connect(inputGain);
          // connect chain (effects) between inputGain and dest
          AudioFX.asyncConnectChain(inputGain as unknown as AudioNode, dest as unknown as AudioNode);
        } catch (e) {
          src.connect(dest);
        }
        // Do not connect to AudioContext destination to avoid duplicate playback.
        // The buffer is routed to a MediaStreamDestination and played via the
        // hidden audio element (`graphAudioRef`). Connecting to `ac.destination`
        // would play the same audio twice.
        src.start();
        logger.debug('[TTS] Playing decoded buffer via AudioContext');
        // When finished, unmute mic
        src.onended = () => {
          logger.debug('[TTS] AudioContext buffer ended, unmuting mic');
          // clear active ref
          try { if (activeBufferSrcRef.current === src) activeBufferSrcRef.current = null; } catch (e) {}
          try { isPlayingTTSRef.current = false; } catch (e) {}
          unmuteMic();
        };
        // Ensure graphAudioRef is attached and sink applied
        ensureGraphRouting();
        if (supportsSetSinkId && graphAudioRef.current && (graphAudioRef.current as any).setSinkId) {
          try {
            // @ts-ignore
            await (graphAudioRef.current as any).setSinkId(selectedOutputId);
            logger.debug('[TTS] setSinkId applied to graph audio element', selectedOutputId);
          } catch (err) {
            logger.warn('[TTS] graph setSinkId failed', err);
          }
        }
      } catch (e) {
        logger.warn('[TTS] AudioContext decode/play failed, falling back to element playback', e);
        const blob = new Blob([audioData], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        if (audioRef.current) {
          audioRef.current.src = url;
          audioRef.current.onended = () => {
            URL.revokeObjectURL(url);
            try { isPlayingTTSRef.current = false; } catch (e) {}
            unmuteMic();
          };
          try { await audioRef.current.play(); } catch (err) { logger.warn('Fallback element play failed', err); try { isPlayingTTSRef.current = false; } catch (e) {} unmuteMic(); }
        } else {
          const audio = new Audio(url);
          audio.onended = () => { URL.revokeObjectURL(url); try { isPlayingTTSRef.current = false; } catch (e) {} unmuteMic(); };
          try { await audio.play(); } catch (err) { logger.warn('Fallback Audio() play failed', err); try { isPlayingTTSRef.current = false; } catch (e) {} unmuteMic(); }
        }
      }
    } catch (err) {
      logger.error('[TTS] playback error', err);
      unmuteMic();
    }
  }

  // Setup graph routing element and audio context on mount
  useEffect(() => {
    (async () => {
      await refreshAudioOutputs();
      ensureGraphRouting();
    })();

    // initialize default effects once audioContext available
    (async () => {
      try {
        const ac = audioContextRef.current || new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = ac;
        AudioFX.initTuna(ac);
        // create default effects (start bypassed)
        const types = ['Delay','Phaser','Overdrive','Compressor','Filter','Tremolo','Bitcrusher','Chorus'];
        const initial = types.map((t, i) => ({ id: `fx-${i}-${t}`, type: t }));
        for (const it of initial) {
          // pass bypass: true so effects load in bypassed state
          AudioFX.createEffect(it.id, it.type, { bypass: true });
        }
        const initialEffects = initial.map((it) => ({ id: it.id, type: it.type, params: AudioFX.getEffects().find((e:any)=>e.id===it.id)?.params ?? {}, bypass: true }));
        setEffectsList(initialEffects);
        const ids = initial.map((it) => it.id);
        setChainList(ids);
        defaultChainRef.current = ids.slice();
        // initialize default node positions in a 2 rows x 4 columns grid
        // no node-graph positions required when using only the linear signal chain
        AudioFX.setChain(initial.map((it) => it.id));
      } catch (e) {
        // ignore
      }
    })();

    return () => {
      try {
        if (graphAudioRef.current) {
          // remove injected audio element
          try { document.body.removeChild(graphAudioRef.current); } catch (e) {}
          graphAudioRef.current = null;
        }
        if (audioContextRef.current) {
          try { audioContextRef.current.close(); } catch (e) {}
          audioContextRef.current = null;
        }
      } catch (e) {
        logger.warn('Cleanup error', e);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        vadThreshold: 0.7,
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

      // refresh available audio outputs when session starts
      try {
        await refreshAudioOutputs();
      } catch (e) {
        logger.warn('Failed to refresh audio outputs', e);
      }

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
        // If we're currently playing assistant TTS, ignore transcripts produced
        // by the microphone (these are likely the assistant audio being picked up)
        if (isPlayingTTSRef.current) {
          logger.debug('Ignoring committed transcript while TTS is playing:', text);
          return;
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

  // Enumerate audio output devices and detect setSinkId support
  async function refreshAudioOutputs() {
    try {
      // Ensure permissions so labels are available
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        logger.debug('No mic permission when enumerating outputs — labels may be blank');
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter((d) => d.kind === 'audiooutput').map((d) => ({ deviceId: d.deviceId, label: d.label || 'Unknown output' }));
      setAudioOutputs(outputs);
      setSupportsSetSinkId(typeof (HTMLAudioElement.prototype as any).setSinkId === 'function');
      if (outputs.length > 0 && selectedOutputId === 'default') {
        setSelectedOutputId(outputs[0].deviceId);
      }
    } catch (e) {
      logger.error('Failed to enumerate devices', e);
    }
  }

  // Create/ensure an audio context and a destination that we can route to an <audio> element
  function ensureGraphRouting() {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ac = audioContextRef.current!;
    if (!outDestinationRef.current) {
      outDestinationRef.current = ac.createMediaStreamDestination();
    }
    // Attach destination stream to hidden audio element for sink switching
    if (!graphAudioRef.current) {
      const a = document.createElement('audio');
      a.autoplay = true;
      a.muted = false;
      a.style.display = 'none';
      document.body.appendChild(a);
      graphAudioRef.current = a;
    }
    if (graphAudioRef.current && outDestinationRef.current) {
      try {
        graphAudioRef.current.srcObject = outDestinationRef.current.stream;
      } catch (e) {
        logger.warn('Failed to set srcObject on graph audio element', e);
      }
      // initialize Tuna
      try {
        AudioFX.initTuna(ac);
      } catch (e) {
        logger.debug('Tuna init failed or not available', e);
      }

      // apply sink if supported
      if (supportsSetSinkId && selectedOutputId && (graphAudioRef.current as any).setSinkId) {
        try {
          // @ts-ignore
          (graphAudioRef.current as any).setSinkId(selectedOutputId);
          logger.debug('Applied setSinkId to graph audio element', selectedOutputId);
        } catch (err) {
          logger.warn('setSinkId failed on graph audio element', err);
        }
      }
    }
    return outDestinationRef.current;
  }

  // Call this when user changes selected output
  async function applySelectedOutput(deviceId: string) {
    setSelectedOutputId(deviceId);
    // set sink for TTS audioRef and for graph audio element
    const sinkTargets = [audioRef.current, graphAudioRef.current];
    for (const el of sinkTargets) {
      if (!el) continue;
      // @ts-ignore
      if (typeof el.setSinkId === 'function') {
        try {
          // @ts-ignore
          await el.setSinkId(deviceId);
          logger.info('setSinkId applied to element', deviceId);
        } catch (e) {
          logger.warn('setSinkId failed on element', e);
        }
      }
    }
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
      <div className="w-full max-w-6xl flex flex-col md:flex-row items-start gap-6">
        <div className="flex-1 max-w-xl bg-white p-4 rounded shadow">
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
          <div className="flex flex-col md:flex-row gap-3 md:items-center">
            <div className="flex gap-3 items-center">
              <button onClick={startRealtime} disabled={connected || elStatus === 'connecting' || oaiStatus === 'connecting'} className="px-4 py-2 bg-green-600 text-white rounded">Start Session</button>
              <button onClick={stopRealtime} disabled={!connected} className="px-4 py-2 bg-red-500 text-white rounded">Stop Session</button>
            </div>
            <div className="flex items-center gap-2 md:ml-4">
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
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <label className="block text-sm font-medium mb-1">Output device</label>
                <select
                  value={selectedOutputId}
                  onChange={async (e) => {
                    const id = e.target.value;
                    await applySelectedOutput(id);
                  }}
                  onClick={() => refreshAudioOutputs()}
                  className="p-2 border rounded text-sm mr-2"
                >
                  {audioOutputs.length === 0 ? <option value="default">default</option> : null}
                  {audioOutputs.map((o) => (
                    <option key={o.deviceId} value={o.deviceId}>{o.label || o.deviceId}</option>
                  ))}
                </select>
                <button onClick={() => refreshAudioOutputs()} className="text-xs text-blue-600 ml-2">Refresh</button>
                {!supportsSetSinkId ? (
                  <div className="text-xs text-gray-500 mt-1">Note: Browser may not support per-tab output. Use system output or Chromium.</div>
                ) : null}
              </div>
            </div>
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

          <div className="mt-4 space-y-4">
            <div className="w-full bg-white p-4 rounded shadow">
              <div className="flex items-center justify-between">
                <strong>Live Transcript</strong>
              </div>
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

            <div className="w-full bg-white p-4 rounded shadow">
              <div>
                <strong>Assistant Response</strong>
                <div className="min-h-[48px] mt-2 p-2 border rounded bg-gray-50 whitespace-pre-wrap">{assistantResponse || <span className="text-gray-400">(no response)</span>}</div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <strong>Transcript History</strong>
                <button onClick={() => setTranscriptHistory([])} className="text-sm text-red-600">Clear</button>
              </div>
              <div className="mt-2 max-h-48 overflow-y-auto overflow-x-hidden p-2 border rounded bg-gray-50" role="region" aria-label="Transcript history" tabIndex={0}>
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
        </div>
        <div className="w-full md:w-96">
          <div className="bg-white p-4 rounded shadow">
            <div className="flex items-center justify-between">
              <strong className="text-sm">Effects Palette</strong>
              <div>
                {/** Bypass all / Enable all toggle */}
                <button
                  onClick={() => {
                    const allBypassed = effectsList.length > 0 && effectsList.every((f) => !!f.bypass);
                    const setTo = !allBypassed;
                    const next = effectsList.map((f) => ({ ...f, bypass: setTo }));
                    setEffectsList(next);
                    // apply to audiofx
                    for (const f of next) {
                      try { AudioFX.updateEffectParams(f.id, { bypass: setTo }); } catch (e) {}
                    }
                  }}
                  className="text-xs px-2 py-1 border rounded"
                >
                  {effectsList.length > 0 && effectsList.every((f) => !!f.bypass) ? 'Enable All' : 'Bypass All'}
                </button>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 grid-rows-4 gap-3">
              {effectsList.map((fx, idx) => (
                <div key={fx.id} className="p-2 border rounded bg-gray-50 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{fx.type}</div>
                    <div className="flex items-center gap-2">
                      <label className="text-[11px]">Bypass</label>
                      <input type="checkbox" checked={!!fx.bypass} onChange={(e)=>{ const v=e.target.checked; const nextEffects = effectsList.map(x=> x.id===fx.id?{...x,bypass:v}:x); setEffectsList(nextEffects); AudioFX.updateEffectParams(fx.id, { bypass: v }); }} />
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {Object.keys(fx.params || {}).filter(k=> typeof (fx.params||{})[k] === 'number').slice(0,4).map((k) => {
                      const v = (fx.params || {})[k] as number;
                      const range = paramRanges[k] || { min: 0, max: 1, step: 0.01 };
                      return (
                        <div key={k} className="flex flex-col text-xs">
                          <label className="mb-1">{k}</label>
                          <input type="range" min={range.min} max={range.max} step={range.step || 0.01} value={v}
                            onChange={(e)=>{ const nv = Number(e.target.value); const nextEffects = effectsList.map(x=> x.id===fx.id?{...x, params: {...x.params, [k]: nv}}:x); setEffectsList(nextEffects); AudioFX.updateEffectParams(fx.id, { [k]: nv }); }} />
                          <div className="text-right text-[11px] text-gray-600">{String(v)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {/* Signal Chain moved to its own panel below the main area */}
          </div>
        </div>
      </div>
      {/* New horizontal Signal Chain panel below the main content */}
      <div className="w-full max-w-6xl mt-4">
        <div className="bg-white p-4 rounded shadow">
          <div className="flex items-center justify-between">
            <strong className="text-sm">Signal Chain</strong>
            <div className="flex items-center gap-2">
              <button onClick={() => { if (defaultChainRef.current) { setChainList(defaultChainRef.current); AudioFX.setChain(defaultChainRef.current); } }} className="text-xs px-2 py-1 border rounded">Reset Chain</button>
              <button onClick={() => { setChainList([]); AudioFX.setChain([]); }} className="text-xs px-2 py-1 border rounded">Clear Chain</button>
            </div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <div className="flex items-center gap-3">
              {chainList.map((id, i) => {
                const fx = effectsList.find((f) => f.id === id);
                if (!fx) return null;
                const moveLeft = () => {
                  if (i <= 0) return;
                  const next = chainList.slice();
                  const [item] = next.splice(i, 1);
                  next.splice(i-1, 0, item);
                  setChainList(next);
                  AudioFX.setChain(next);
                };
                const moveRight = () => {
                  if (i >= chainList.length-1) return;
                  const next = chainList.slice();
                  const [item] = next.splice(i, 1);
                  next.splice(i+1, 0, item);
                  setChainList(next);
                  AudioFX.setChain(next);
                };
                const onDragStart = (e: React.DragEvent) => { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; };
                const onDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
                const onDrop = (e: React.DragEvent) => {
                  e.preventDefault();
                  const sid = e.dataTransfer.getData('text/plain');
                  if (!sid) return;
                  const from = chainList.indexOf(sid);
                  const to = chainList.indexOf(id);
                  if (from < 0 || to < 0) return;
                  const next = chainList.slice();
                  const [m] = next.splice(from, 1);
                  next.splice(to, 0, m);
                  setChainList(next);
                  AudioFX.setChain(next);
                };

                return (
                  <div key={id} draggable={true} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} className="min-w-[160px] p-2 border rounded bg-gray-50 flex flex-col items-center">
                    <div className="flex items-center gap-3">
                      <div className="font-medium">{fx.type}</div>
                      <div className="text-xs text-gray-500">({i+1})</div>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button onClick={moveLeft} title="Move left" className="px-2 py-1 border rounded text-xs">◀</button>
                      <button onClick={moveRight} title="Move right" className="px-2 py-1 border rounded text-xs">▶</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      
    </div>
  );
}
