

  "use client";

  import React, { useEffect, useRef, useState } from "react";
  import logger from "./logger";
  import * as AudioFX from "./audiofx";
  import * as ExportImport from "./exportImport";
  import { RealtimeEvents, CommitStrategy } from "@elevenlabs/client";
  import { ScribeRealtime as Scribe } from "./scribe/scribe";
  import type { RealtimeConnection } from "./scribe/connection";
  import { useParamRanges, formatNumericValue, EFFECT_TYPES, FILTER_TYPES } from "./midi";
  import MidiController from "./midi";
  import { AudioMixer, type VoiceChannel } from "./audioMixer";
  import voicesConfig from "./voices.json";
  import TriangleMixer from "./TriangleMixer";
  import PanControl, { DEFAULT_PAN_PRESETS, type PanPreset } from "./PanControl";

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
        // Stop all mixer channels
        if (audioMixerRef.current) {
          try {
            audioMixerRef.current.stopAll();
          } catch (e) {
            logger.warn('[TTS] Failed to stop mixer channels', e);
          }
        }
          try { isPlayingTTSRef.current = false; } catch (e) {}
        logger.info('[TTS] Audio playback stopped by user');
        unmuteMic();
      }
    const [micMuted, setMicMuted] = useState(false);
    const micMutedRef = useRef(false);
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
  const paramRanges = useParamRanges();
  const [showMidiController, setShowMidiController] = useState(false);
  
  // Audio mixer for multiple voice playback
  const audioMixerRef = useRef<AudioMixer | null>(null);
  const [voiceChannels, setVoiceChannels] = useState<VoiceChannel[]>([]);
  const [voices] = useState(voicesConfig.voices);

  // Pan presets
  const [panPresets, setPanPresets] = useState<PanPreset[]>(() => {
    // Check if we're in the browser before accessing localStorage
    if (typeof window === 'undefined') {
      return DEFAULT_PAN_PRESETS;
    }
    try {
      const stored = localStorage.getItem('nocturne_pan_presets');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to load pan presets from localStorage', e);
    }
    return DEFAULT_PAN_PRESETS;
  });
  const [currentPanPresetId, setCurrentPanPresetId] = useState<string>("preset1");

  // Persist pan presets to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('nocturne_pan_presets', JSON.stringify(panPresets));
    } catch (e) {
      console.warn('Failed to save pan presets to localStorage', e);
    }
  }, [panPresets]);

  // Keep micMutedRef in sync with micMuted state
  useEffect(() => {
    micMutedRef.current = micMuted;
  }, [micMuted]);

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
  // Play TTS audio for assistant response - supports multiple concurrent voices
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
      logger.debug('[TTS] Mic muted, preparing multi-voice TTS requests');
      
      const pwHash = await hashPassword(apiPassword || "");
      const ac = audioContextRef.current || new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ac;
      
      // Ensure destination exists
      const dest = outDestinationRef.current || ac.createMediaStreamDestination();
      outDestinationRef.current = dest;
      
      // Initialize mixer if not already created
      if (!audioMixerRef.current) {
        audioMixerRef.current = new AudioMixer(ac, dest);
        logger.debug('[TTS] Audio mixer initialized');
      }
      
      // Connect mixer master output through effects chain to destination
      try {
        AudioFX.initTuna(ac);
        const masterGain = audioMixerRef.current.getMasterGain();
        // Disconnect any previous connection
        try { masterGain.disconnect(); } catch (e) {}
        // Connect through effects chain
        AudioFX.asyncConnectChain(masterGain as unknown as AudioNode, dest as unknown as AudioNode);
        logger.debug('[TTS] Effects chain connected to mixer output');
      } catch (e) {
        logger.warn('[TTS] Failed to connect effects chain, using direct connection', e);
        const masterGain = audioMixerRef.current.getMasterGain();
        try { masterGain.disconnect(); } catch (e) {}
        masterGain.connect(dest);
      }
      
      // Get all enabled voices
      const enabledVoices = voices.filter(v => v.enabled && v.elevenLabsVoiceId);
      if (enabledVoices.length === 0) {
        logger.warn('[TTS] No enabled voices found, falling back to default');
        enabledVoices.push(voices[0]); // Use first voice as fallback
      }
      
      logger.debug('[TTS] Playing on', enabledVoices.length, 'voice(s) simultaneously');
      
      // Track active playback count
      let activeCount = enabledVoices.length;
      
      // Make concurrent requests for all enabled voices
      const voicePlaybackPromises = enabledVoices.map(async (voice) => {
        try {
          logger.debug('[TTS] Requesting audio for voice:', voice.name, voice.id);
          
          // Fetch audio for this voice
          const res = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-password': pwHash },
            body: JSON.stringify({ 
              text, 
              voiceId: voice.elevenLabsVoiceId 
            }),
          });
          
          if (!res.ok) {
            logger.warn('[TTS] Voice', voice.name, 'request failed:', res.status);
            return;
          }
          
          const audioData = await res.arrayBuffer();
          logger.debug('[TTS] Received audio for', voice.name, 'byteLength:', audioData.byteLength);
          
          // Decode audio
          let decoded = await ac.decodeAudioData(audioData.slice(0));
          
          // Convert mono to stereo if needed
          if (decoded.numberOfChannels === 1) {
            const monoBuffer = decoded;
            const stereoBuffer = ac.createBuffer(2, monoBuffer.length, monoBuffer.sampleRate);
            const monoData = monoBuffer.getChannelData(0);
            stereoBuffer.getChannelData(0).set(monoData);
            stereoBuffer.getChannelData(1).set(monoData);
            decoded = stereoBuffer;
            logger.debug('[TTS]', voice.name, 'converted mono to stereo');
          }
          
          // Get or create channel for this voice
          const channel = audioMixerRef.current!.getOrCreateChannel(
            voice.id,
            voice.name,
            voice.defaultVolume
          );
          
          // Play directly on channel - effects are applied to the mixed output
          audioMixerRef.current!.playOnChannel(voice.id, decoded, () => {
            activeCount--;
            logger.debug('[TTS]', voice.name, 'playback ended. Active:', activeCount);
            if (activeCount === 0) {
              logger.debug('[TTS] All voices finished, unmuting mic');
              try { isPlayingTTSRef.current = false; } catch (e) {}
              unmuteMic();
            }
          });
          
          logger.debug('[TTS]', voice.name, 'playback started on channel');
          
        } catch (err) {
          logger.error('[TTS] Error playing voice', voice.name, err);
          activeCount--;
          if (activeCount === 0) {
            try { isPlayingTTSRef.current = false; } catch (e) {}
            unmuteMic();
          }
        }
      });
      
      // Wait for all voices to be initiated (but not necessarily finished playing)
      await Promise.allSettled(voicePlaybackPromises);
      
      // Update voice channels state for UI
      if (audioMixerRef.current) {
        setVoiceChannels(audioMixerRef.current.getChannels());
      }
      
      // Ensure graph routing and output device selection
      ensureGraphRouting();
      if (supportsSetSinkId && graphAudioRef.current && (graphAudioRef.current as any).setSinkId) {
        try {
          await (graphAudioRef.current as any).setSinkId(selectedOutputId);
          logger.debug('[TTS] setSinkId applied to graph audio element', selectedOutputId);
        } catch (err) {
          logger.warn('[TTS] graph setSinkId failed', err);
        }
      }
      
    } catch (err) {
      logger.error('[TTS] Multi-voice playback error', err);
      try { isPlayingTTSRef.current = false; } catch (e) {}
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
        const initial = EFFECT_TYPES.map((t, i) => ({ id: `fx-${i}-${t}`, type: t }));
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

  // Refresh effectsList when external updates occur (e.g., MIDI mapped CCs)
  useEffect(() => {
    function handler(ev: any) {
      try {
        const ef = AudioFX.getEffects() || [];
        const next = ef.map((e: any) => ({ id: e.id, type: e.type, params: e.params || {}, bypass: !!(e.params && e.params.bypass) }));
        setEffectsList(next);
      } catch (e) {
        // ignore
      }
    }
    window.addEventListener('audiofx:paramsUpdated', handler as EventListener);
    return () => { window.removeEventListener('audiofx:paramsUpdated', handler as EventListener); };
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
      // Check if navigator.mediaDevices is available (not in SSR or unsupported environments)
      if (!navigator?.mediaDevices) {
        logger.debug('mediaDevices not available in this environment');
        return;
      }

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
    
    // Initialize audio mixer early so pan controls work before any audio plays
    if (!audioMixerRef.current) {
      audioMixerRef.current = new AudioMixer(ac, outDestinationRef.current);
      logger.debug('[AudioMixer] Initialized early for pan controls');
      
      // Connect mixer master output through effects chain to destination
      try {
        AudioFX.initTuna(ac);
        const masterGain = audioMixerRef.current.getMasterGain();
        AudioFX.asyncConnectChain(masterGain as unknown as AudioNode, outDestinationRef.current as unknown as AudioNode);
        logger.debug('[AudioMixer] Effects chain connected to mixer output');
      } catch (e) {
        logger.warn('[AudioMixer] Failed to connect effects chain, using direct connection', e);
        const masterGain = audioMixerRef.current.getMasterGain();
        try { masterGain.disconnect(); } catch (e) {}
        masterGain.connect(outDestinationRef.current);
      }
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
      
      // Check if data channel is open before sending
      if (dc.readyState !== "open") {
        logger.error("Data channel is not open, current state:", dc.readyState);
        return;
      }
      
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
          if (dc.readyState === "open") {
            dc.send(JSON.stringify(sysEvent));
            instructionSentRef.current = true;
          } else {
            logger.error("Data channel closed before sending system instruction");
          }
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
        if (dc.readyState === "open") {
          dc.send(JSON.stringify(event));
        } else {
          logger.error("Data channel closed before sending user message");
        }
      } catch (sendErr) {
        logger.error("Data channel send failed (user)", sendErr);
      }
      // After adding the user message, request a response from the model
      const responseCreate = { type: "response.create" };
      logger.debug("Sending response.create to OpenAI data channel", responseCreate);
      try {
        if (dc.readyState === "open") {
          dc.send(JSON.stringify(responseCreate));
        } else {
          logger.error("Data channel closed before sending response.create");
        }
      } catch (sendErr) {
        logger.error("Data channel send failed (response.create)", sendErr);
      }
    } catch (e) {
      logger.error("Failed to send to OpenAI realtime", e);
    }
  }

  useEffect(() => {
    // Initialize audio context and mixer on mount so pan controls work immediately
    try {
      ensureGraphRouting();
    } catch (e) {
      logger.warn('Failed to initialize audio routing on mount', e);
    }
    
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
            {/* Voice Mixer Section */}
            <div className="mt-3">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium">Voice Mixer (2D Control)</label>
              </div>
              <div className="p-3 border rounded bg-gray-50">
                <TriangleMixer
                  voices={voices}
                  onMixChange={(mix) => {
                    // Update mixer volumes based on 2D control
                    if (audioMixerRef.current) {
                      Object.entries(mix).forEach(([voiceId, volume]) => {
                        audioMixerRef.current!.setChannelVolume(voiceId, volume);
                      });
                      setVoiceChannels(audioMixerRef.current.getChannels());
                    }
                  }}
                />
                {voices.filter(v => v.enabled && v.elevenLabsVoiceId).length === 0 && (
                  <div className="text-xs text-gray-500 text-center py-2 mt-2">
                    Configure voices in src/app/voices.json
                  </div>
                )}
              </div>
            </div>
            {/* Voice Panning Section */}
            <div className="mt-3">
              <div className="p-3 border rounded bg-gray-50">
                <PanControl
                  voices={voices}
                  presets={panPresets}
                  currentPresetId={currentPanPresetId}
                  onPanChange={(voiceId, pan) => {
                    // Update mixer panning
                    if (audioMixerRef.current) {
                      audioMixerRef.current.setChannelPan(voiceId, pan);
                      setVoiceChannels(audioMixerRef.current.getChannels());
                    }
                  }}
                  onPresetChange={(preset) => {
                    setCurrentPanPresetId(preset.id);
                  }}
                  onPresetsUpdate={(updatedPresets) => {
                    setPanPresets(updatedPresets);
                  }}
                />
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
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setShowMidiController(!showMidiController)}
                  className="text-xs px-2 py-1 border rounded hover:bg-blue-50"
                >
                  MIDI Mapper
                </button>
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
                {/** Export / Import buttons */}
                <button
                  onClick={async () => {
                    try {
                      // Also load MIDI mappings from localStorage if available
                      let midiMappings = undefined;
                      let midiChannel = undefined;
                      try {
                        const raw = localStorage.getItem("nocturne_midi_mappings_v1");
                        if (raw) {
                          const parsed = JSON.parse(raw);
                          midiMappings = parsed.mappings;
                          midiChannel = parsed.channel;
                        }
                      } catch (e) {}
                      const config = ExportImport.exportConfig(effectsList, midiMappings, midiChannel, panPresets, currentPanPresetId);
                      ExportImport.downloadConfigAsFile(config, `nocturne-effects-${new Date().toISOString().split('T')[0]}.json`);
                    } catch (e) {
                      alert('Failed to export: ' + (e instanceof Error ? e.message : String(e)));
                    }
                  }}
                  className="text-xs px-2 py-1 border rounded bg-purple-50 hover:bg-purple-100"
                >
                  Export Config
                </button>
                <button
                  onClick={async () => {
                    try {
                      const json = await ExportImport.loadConfigFromFile();
                      const config = ExportImport.importConfig(json);
                      const next = config.effects.map((e) => {
                        const existing = effectsList.find((f) => f.id === e.id);
                        if (!existing) return e;
                        return { ...e, id: existing.id };
                      });
                      setEffectsList(next);
                      for (const f of next) {
                        try {
                          AudioFX.updateEffectParams(f.id, f.params);
                          if (f.bypass !== undefined) {
                            AudioFX.updateEffectParams(f.id, { bypass: f.bypass });
                          }
                        } catch (e) {}
                      }
                      // Restore pan preset if present
                      if (config.panPresets && config.panPresets.length > 0) {
                        setPanPresets(config.panPresets);
                      }
                      if (config.currentPanPresetId) {
                        setCurrentPanPresetId(config.currentPanPresetId);
                        const presetToApply = (config.panPresets && config.panPresets.length > 0) 
                          ? config.panPresets.find(p => p.id === config.currentPanPresetId)
                          : panPresets.find(p => p.id === config.currentPanPresetId);
                        if (presetToApply && audioMixerRef.current) {
                          Object.entries(presetToApply.pans).forEach(([voiceId, pan]) => {
                            audioMixerRef.current!.setChannelPan(voiceId, pan);
                          });
                        }
                      }
                      // Also restore MIDI mappings if present
                      if (config.midiMappings && config.midiMappings.length > 0) {
                        try {
                          localStorage.setItem("nocturne_midi_mappings_v1", JSON.stringify({
                            mappings: config.midiMappings,
                            channel: config.midiChannel,
                          }));
                          // Dispatch storage event to notify MIDI controller to reload
                          window.dispatchEvent(new StorageEvent('storage', {
                            key: 'nocturne_midi_mappings_v1',
                            newValue: localStorage.getItem('nocturne_midi_mappings_v1'),
                            storageArea: localStorage
                          }));
                        } catch (e) {}
                      }
                      alert('Effects config loaded from file!' + (config.midiMappings?.length ? ' MIDI mappings also restored. Please reopen MIDI CC Mapper to see changes.' : ''));
                    } catch (e) {
                      alert('Failed to import: ' + (e instanceof Error ? e.message : String(e)));
                    }
                  }}
                  className="text-xs px-2 py-1 border rounded bg-orange-50 hover:bg-orange-100"
                >
                  Import Config
                </button>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 grid-rows-5 gap-3">
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
                    {Object.keys(fx.params || {}).slice(0,6).map((k) => {
                      // Hide internal/bypass param since we expose a dedicated checkbox
                      if (k === 'bypass') return null;
                      const val = (fx.params || {})[k];
                      // numeric params -> slider
                      if (typeof val === 'number') {
                        const v = val as number;
                        const range = paramRanges[k] || { min: 0, max: 1, step: 0.01 };
                        return (
                          <div key={k} className="flex flex-col text-xs">
                            <label className="mb-1">{k}</label>
                            <input type="range" min={range.min} max={range.max} step={range.step || 0.01} value={v}
                              onChange={(e)=>{ const nv = Number(e.target.value); const nextEffects = effectsList.map(x=> x.id===fx.id?{...x, params: {...x.params, [k]: nv}}:x); setEffectsList(nextEffects); AudioFX.updateEffectParams(fx.id, { [k]: nv }); }} />
                            <div className="text-right text-[11px] text-gray-600">{formatNumericValue(v)}</div>
                          </div>
                        );
                      }
                      // filterType select for Filter effect
                      if (fx.type === 'Filter' && k === 'filterType') {
                        const v = String(val || '');
                        return (
                          <div key={k} className="flex flex-col text-xs">
                            <label className="mb-1">{k}</label>
                            <select className="p-1 text-xs border" value={v} onChange={(e) => { const nv = e.target.value; const nextEffects = effectsList.map(x=> x.id===fx.id?{...x, params: {...x.params, [k]: nv}}:x); setEffectsList(nextEffects); AudioFX.updateEffectParams(fx.id, { [k]: nv }); }}>
                              {FILTER_TYPES.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </div>
                        );
                      }
                      // impulse select for Convolver effect
                      if (fx.type === 'Convolver' && k === 'impulse') {
                        const v = String(val || '');
                        const impulses = [
                          "CUSTOM_dream hall.WAV", "CUSTOM_gen concert.WAV", "CUSTOM_gen rhall.WAV", "CUSTOM_museum hall.WAV", "CUSTOM_nonlinear 1.WAV",
                          "CUSTOM_pan hall.WAV", "CUSTOM_pump verb.WAV", "CUSTOM_tidal hall.WAV", "CUSTOM_utility verb.WAV", "INSTR_drum cave.WAV",
                          "INSTR_for the toms.WAV", "INSTR_gated hall.WAV", "INSTR_guitar cave.WAV", "INSTR_horns hall.WAV", "INSTR_saxy hangar.WAV",
                          "INSTR_short reverse.WAV", "INSTR_snare gate.WAV", "INSTR_synth hall.WAV", "VOC_choir hall.WAV", "VOC_deep verb.WAV",
                          "VOC_good ol' verb.WAV", "VOC_rise 'n hall.WAV", "VOC_slap hall.WAV", "VOC_vocal concert.WAV", "VOC_vocal hall.WAV",
                          "VOC_vocal hall2.WAV", "VOC_vocal magic.WAV", "VOC_wide vox.WAV"
                        ];
                        return (
                          <div key={k} className="flex flex-col text-xs col-span-2">
                            <label className="mb-1">{k}</label>
                            <select className="p-1 text-xs border" value={v.replace('/LexiconHalls/', '')} onChange={(e) => { const nv = "/LexiconHalls/" + e.target.value; const nextEffects = effectsList.map(x=> x.id===fx.id?{...x, params: {...x.params, [k]: nv}}:x); setEffectsList(nextEffects); AudioFX.updateEffectParams(fx.id, { [k]: nv }); }}>
                              {impulses.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </div>
                        );
                      }

                      // fallback: show value as text (read-only)
                      return (
                        <div key={k} className="flex flex-col text-xs">
                          <label className="mb-1">{k}</label>
                          <div className="p-1 text-xs text-gray-700 border">{String(val)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {/* MIDI Controller Modal */}
            {showMidiController && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-auto">
                  <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white">
                    <strong className="text-lg">MIDI Mapper (CC & Notes)</strong>
                    <button
                      onClick={() => setShowMidiController(false)}
                      className="text-2xl font-bold text-gray-500 hover:text-gray-700"
                    >
                      ×
                    </button>
                  </div>
                  <div className="p-4">
                    <MidiController 
                      availablePanPresets={panPresets.map(p => ({ id: p.id, name: p.name }))}
                      onPanPreset={(presetId) => {
                        logger.info('[MIDI] onPanPreset called with presetId:', presetId);
                        try {
                          const preset = panPresets.find(p => p.id === presetId);
                          logger.info('[MIDI] Found preset?', !!preset, 'audioMixer exists?', !!audioMixerRef.current);
                          if (preset && audioMixerRef.current) {
                            logger.info('[MIDI] Setting preset ID to:', presetId);
                            setCurrentPanPresetId(presetId);
                            // Apply each voice's pan value through the mixer
                            voices.forEach(v => {
                              const pan = preset.pans[v.id] ?? 0;
                              logger.info('[MIDI] Setting pan for', v.id, ':', pan);
                              audioMixerRef.current!.setChannelPan(v.id, pan);
                            });
                            setVoiceChannels(audioMixerRef.current.getChannels());
                            logger.info('[MIDI] Applied pan preset:', preset.name, preset.pans);
                          } else {
                            logger.warn('[MIDI] Cannot apply preset - preset:', !!preset, 'mixer:', !!audioMixerRef.current);
                          }
                        } catch (e) {
                          logger.error('[MIDI] Failed to apply pan preset', presetId, e);
                        }
                      }}
                      onButtonAction={(action) => {
                        try {
                          if (action === 'stopAudio') {
                            stopTTSPlayback();
                          } else if (action === 'muteMic') {
                            muteMic();
                          } else if (action === 'unmuteMic') {
                            unmuteMic();
                          } else if (action === 'toggleMic') {
                            // Use ref to get current state, avoiding stale closure
                            if (micMutedRef.current) {
                              unmuteMic();
                            } else {
                              muteMic();
                            }
                          }
                        } catch (e) {
                          logger.warn('[MIDI] Failed to execute button action', action, e);
                        }
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
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
