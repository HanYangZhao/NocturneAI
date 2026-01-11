TTS AUDIO PLAYBACK PATH:
========================

Audio Buffers (decoded from API)
    ↓
┌────────────────────────────────┐
│   AudioMixer (Multi-Voice)     │
│  - Channel 1 (Voice 1)         │
│  - Channel 2 (Voice 2)         │
│  - Each has Pan & Volume       │
└────────────────────────────────┘
    ↓
┌────────────────────────────────┐
│      Master Gain Node          │◄─────────┐
│     (gain value = 1.0)         │          │
└────────────────────────────────┘          │
    ↓                                       │
    ├─────────────────────────────┐         │ INPUT ANALYZER
    │                             │         │ (reads pre-effects)
    │   ┌─────────────────────┐   │         │ Detects live speech
    │   │ TransientAnalyzer   │───┘         │
    │   │  (Input Analyzer)   │             │
    │   └─────────────────────┘             │
    ↓                                       │
┌────────────────────────────────┐          │
│     Effects Chain (Tuna.js)    │          │
│  ┌──────────────────────────┐  │          │
│  │ 1. Delay (with feedback) │  │          │
│  │ 2. Phaser               │  │          │
│  │ 3. Tremolo              │  │          │
│  │ 4. RingModulator        │  │          │
│  │ 5. Chorus               │  │          │
│  │ 6. Filter               │  │          │
│  │ 7. Overdrive            │  │          │
│  │ 8. Compressor           │  │          │
│  │ 9. Bitcrusher           │  │          │
│  └──────────────────────────┘  │
│   (only non-bypassed ones)     │
└────────────────────────────────┘
    ↓
┌────────────────────────────────┐
│   Post-Effects Gain Node       │◄─────────┐
│     (gain value = 1.0)         │          │
│   [CRITICAL ROUTING NODE]      │          │ OUTPUT ANALYZER
└────────────────────────────────┘          │ (reads post-effects)
    ↓                                       │ Detects delay echoes
    ├─────────────────────────────┐         │ & all output
    │                             │         │
    │   ┌─────────────────────┐   │         │
    │   │ TransientAnalyzer   │───┘         │
    │   │ (Output Analyzer)   │             │
    │   └─────────────────────┘             │
    ↓                                       │
┌────────────────────────────────┐          │
│  MediaStreamDestination Node   │          │
│  (captures audio as stream)    │          │
└────────────────────────────────┘          │
    ↓                                       │
    stream property                         │
    ↓                                       │
┌────────────────────────────────┐          │
│  HTML Audio Element            │          │
│  (hidden, autoplay)            │          │
│  - setSinkId() for device      │          │
└────────────────────────────────┘          │
    ↓                                       │
┌────────────────────────────────┐          │
│   Selected Output Device       │          │
│   (speakers/headphones)        │          │
└────────────────────────────────┘          │
                                            │
                                            │
BRIGHTNESS ANALYSIS:                        │
===================                         │
                                            │
Input Analyzer Brightness  ─┐               │
                            ├─── Max() ─────┘
Output Analyzer Brightness ─┘       │
                                    ↓
                            Combined Brightness
                                    ↓
                            setParticleBrightness()
                                    ↓
                            TranscriptContext
                                    ↓
                            BroadcastChannel
                                    ↓
                            Particle Visualizer


MICROPHONE PATH (Realtime STT):
================================

Microphone (getUserMedia)
    ↓
┌────────────────────────────────┐
│  Scribe (ElevenLabs STT)       │
│  - Real-time transcription     │
│  - VAD (Voice Activity Detect) │
└────────────────────────────────┘
    ↓
Transcript Text
    ↓
OpenAI Realtime API (via WebRTC)
    ↓
Assistant Response (text)
    ↓
TTS API (ElevenLabs)
    ↓
[loops back to TTS Audio Playback Path above]


KEY INSIGHTS:
=============

1. **Dual Analyzers**: Input analyzer catches live speech immediately,
   output analyzer catches delay echoes after they've been processed.

2. **Post-Effects Gain**: This intermediate gain node is critical because
   MediaStreamDestination has no outputs, so analyzers can't connect to it.
   The gain node sits between effects and destination as a tap point.

3. **Max Brightness**: Both analyzer values are combined using Math.max(),
   so brightness stays high during both live speech AND delay echoes.

4. **Fade Detection**: When TTS ends, brightness analysis continues until
   both analyzers report low values for 500ms (delay echoes faded out).

5. **Signal Flow**: Audio flows THROUGH the post-effects gain node to reach
   the destination, so the output analyzer hears everything including delays.