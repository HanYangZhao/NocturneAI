# Multi-Voice TTS Setup Guide

## Overview

NocturneAI now supports playing multiple TTS voices simultaneously with independent volume control for each voice. This is achieved through:

1. **Voice Configuration** - Define multiple voices in `voices.json`
2. **Concurrent Requests** - Make parallel TTS API requests for all enabled voices
3. **Audio Mixer** - Independent volume control and mixing for each voice channel

## Configuration

### 1. Configure Voices

Edit [src/app/voices.json](src/app/voices.json) to set up your voices:

```json
{
  "voices": [
    {
      "id": "voice1",
      "name": "Primary Voice",
      "elevenLabsVoiceId": "YOUR_ELEVENLABS_VOICE_ID_1",
      "defaultVolume": 1.0,
      "enabled": true
    },
    {
      "id": "voice2",
      "name": "Secondary Voice",
      "elevenLabsVoiceId": "YOUR_ELEVENLABS_VOICE_ID_2",
      "defaultVolume": 0.8,
      "enabled": true
    },
    {
      "id": "voice3",
      "name": "Tertiary Voice",
      "elevenLabsVoiceId": "YOUR_ELEVENLABS_VOICE_ID_3",
      "defaultVolume": 0.6,
      "enabled": false
    }
  ]
}
```

**Parameters:**
- `id` - Unique identifier for the voice channel
- `name` - Display name shown in the UI
- `elevenLabsVoiceId` - ElevenLabs Voice ID (find in your ElevenLabs console)
- `defaultVolume` - Initial volume level (0.0 to 1.0)
- `enabled` - Set to `true` to include this voice in playback

### 2. Environment Variables

The `ELEVENLABS_VOICE_ID` in your `.env` file now serves as a fallback if no voices are configured:

```bash
ELEVENLABS_API_KEY=your_api_key_here
ELEVENLABS_VOICE_ID=your_default_voice_id_here
```

## How It Works

### Concurrent Playback

When the assistant generates a response:

1. The same text is sent to ElevenLabs for each enabled voice **simultaneously**
2. All audio streams are fetched in parallel (non-blocking)
3. Each voice is decoded and played through its own audio channel
4. The mixer combines all channels and routes through the audio effects chain

### Audio Mixer

The [audioMixer.ts](src/app/audioMixer.ts) module provides:

- **Independent Gain Nodes** - Each voice has its own gain node for volume control
- **Master Gain** - Global volume control affecting all voices
- **Mute/Unmute** - Toggle individual voices on/off
- **Channel Management** - Dynamic creation and cleanup of voice channels

### Voice Mixer UI

The Voice Mixer features a **circular 2D control** for intuitive mixing of 3 voices:

- **Circle divided into 3 sections** - Each section represents one voice
- **Draggable dot** - Place the dot anywhere in the circle to control the mix
- **Center position** - Equal mix (33% each voice)
- **Edge positions** - Favor individual voices (up to 100% for one voice)
- **Real-time percentages** - See the current mix displayed below the control
- **Color-coded** - Each voice has its own color in the visualization

The mixer uses angular proximity to determine how much each voice contributes to the mix based on where you place the dot.

## Usage

1. **Configure Your Voices** - Add ElevenLabs Voice IDs to `voices.json`
2. **Enable Voices** - Set `enabled: true` for voices you want to use
3. **Start the App** - Run your development server
4. **Test Playback** - When the assistant speaks, all enabled voices play simultaneously
5. **Adjust Volumes** - Use the Voice Mixer sliders to balance each voice
6. **Mute Voices** - Click the speaker icons to toggle individual voices

## Technical Details

### API Route Updates

[src/app/api/tts/route.ts](src/app/api/tts/route.ts) now accepts an optional `voiceId` parameter:

```typescript
// Request body
{
  text: "Hello world",
  voiceId: "optional_voice_id"  // Overrides env variable
}
```

### AudioChatClean Updates

The `playAssistantTTS` function in [src/app/AudioChatClean.tsx](src/app/AudioChatClean.tsx):

- Filters enabled voices from configuration
- Makes concurrent fetch requests using `Promise.allSettled`
- Initializes the AudioMixer on first use
- Routes each voice through the effects chain to its channel
- Tracks active playback count to know when all voices finish

### Effects Integration

All voices are mixed together first, then the combined output is routed through the audio effects chain:

```
Voice 1 → Channel 1 Gain ↘
Voice 2 → Channel 2 Gain → Mixer Master Gain → Effects Chain → Output Device
Voice 3 → Channel 3 Gain ↗
```

This means effects like reverb, distortion, delay, etc. are applied to the **mixed audio** of all voices together, creating a cohesive sound. Each voice maintains independent volume control via its channel gain, but all voices share the same effects processing.

## Troubleshooting

**No voices playing:**
- Check that at least one voice has `enabled: true`
- Verify `elevenLabsVoiceId` is set correctly
- Check browser console for error messages

**Voices out of sync:**
- Network latency can cause slight variations in start times
- All requests are made concurrently but network conditions may vary

**Volume too loud/soft:**
- Adjust individual voice `defaultVolume` in `voices.json`
- Use the Voice Mixer sliders in the UI
- Check master output device volume

**Performance issues:**
- Limit to 2-3 concurrent voices for best performance
- More voices = more API requests and processing

## Examples

### Example 1: Dual Voice Setup
Two voices playing together - useful for stereo effects or character dialogue:

```json
{
  "voices": [
    {
      "id": "left",
      "name": "Left Character",
      "elevenLabsVoiceId": "voice_id_1",
      "defaultVolume": 1.0,
      "enabled": true
    },
    {
      "id": "right",
      "name": "Right Character",
      "elevenLabsVoiceId": "voice_id_2",
      "defaultVolume": 1.0,
      "enabled": true
    }
  ]
}
```

### Example 2: Triple Voice with Background
Main voice + two background voices at lower volumes:

```json
{
  "voices": [
    {
      "id": "main",
      "name": "Main Voice",
      "elevenLabsVoiceId": "voice_id_1",
      "defaultVolume": 1.0,
      "enabled": true
    },
    {
      "id": "bg1",
      "name": "Background 1",
      "elevenLabsVoiceId": "voice_id_2",
      "defaultVolume": 0.3,
      "enabled": true
    },
    {
      "id": "bg2",
      "name": "Background 2",
      "elevenLabsVoiceId": "voice_id_3",
      "defaultVolume": 0.2,
      "enabled": true
    }
  ]
}
```

## Future Enhancements

Potential improvements for the multi-voice system:

- Per-voice effects chains (different effects for each voice)
- Spatial audio positioning (pan each voice left/right)
- Voice-specific text splitting (different text to different voices)
- Preset voice configurations
- Save/load mixer settings
