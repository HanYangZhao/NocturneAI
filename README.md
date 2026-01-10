# Nocturne AI

A real-time audio chat interface powered by OpenAI's Realtime API and ElevenLabs text-to-speech. Nocturne AI provides low-latency conversational AI with audio processing, mixing, visual effects, and MIDI control capabilities.

## Features

- **Real-time Voice Chat**: Low-latency conversational AI using OpenAI's GPT-4o Realtime model
- **Professional Audio Processing**: Audio effects (reverb, delay, compression, EQ, distortion) powered by Tuna.js
- **Audio Mixing**: Multi-channel audio mixer with voice control and panoramic effects
- **Text-to-Speech**: High-quality synthesis via ElevenLabs with multiple voice options
- **Speech-to-Text**: Real-time transcription using ElevenLabs STT
- **3D Visualization**: Interactive particle system and audio visualizers built with Three.js and React Three Fiber
- **MIDI Support**: Full MIDI controller integration for parameter control
- **Transcript Display**: Real-time conversation transcript with visual effects
- **Export/Import**: Save and load audio config, midi parameters

## Tech Stack

**Frontend:**
- [Next.js 16](https://nextjs.org) - React framework
- [React 19](https://react.dev) - UI library
- [Three.js](https://threejs.org) & [React Three Fiber](https://docs.pmnd.rs/react-three-fiber/) - 3D graphics
- [TailwindCSS](https://tailwindcss.com) - Styling
- [TypeScript](https://www.typescriptlang.org) - Type safety
- [Tuna.js](https://github.com/Theodeus/tuna) - Web Audio API effects

**Backend/APIs:**
- [OpenAI Agents SDK](https://platform.openai.com/docs/guides/realtime) - Realtime API
- [ElevenLabs](https://elevenlabs.io) - TTS & STT

**Python Backend (Optional):**
- OpenAI Whisper - Speech recognition
- PyTorch - ML framework
- PySimpleGUI - Desktop UI

## Getting Started

### Prerequisites

- Node.js 20+ 
- npm or yarn package manager
- OpenAI API key (for Realtime API access)
- ElevenLabs API key (for TTS/STT services)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/NocturneAI.git
cd NocturneAI
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp env.example .env.local
```

4. Add your API keys to `.env.local`:
```
OPENAI_API_KEY=your_openai_api_key
ELEVENLABS_API_KEY=your_elevenlabs_api_key
```

### Running the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to access the application.

The app will hot-reload as you make changes to the code.

### Building for Production

```bash
npm run build
npm start
```

## Configuration

- **Voices**: Edit [src/app/voices.json](src/app/voices.json) to customize available voice options
- **Effects**: Configure audio effects in the UI or via MIDI controller
- **Visual Settings**: Adjust particle brightness and text display speed in the transcript panel

## API Routes

- `POST /api/tts` - Text-to-speech synthesis
- `POST /api/stt/elevenlabs-token` - Get ElevenLabs STT token
- `POST /api/ephemeral` - Get OpenAI Realtime ephemeral token

## Project Structure

```
src/
├── app/
│   ├── AudioChatClean.tsx       # Main chat component
│   ├── audiofx.ts               # Audio effects chain
│   ├── audioMixer.ts            # Multi-channel mixer
│   ├── midi.tsx                 # MIDI controller support
│   ├── voices.json              # Voice configurations
│   ├── api/                     # Backend API routes
│   └── scribe/                  # Real-time transcription
├── docs/                        # Documentation
└── python/                      # Optional Python backend
```

## Documentation

- [OpenAI Realtime API Setup](docs/openai_realtime.md)
- [ElevenLabs Integration](docs/elevenlab.md)
- [Multi-Voice TTS](docs/multi-voice-tts.md)
- [Deployment](docs/deploy.md)

## Development

### Linting

```bash
npm run lint
```

### Type Checking

```bash
npx tsc --noEmit
```

## License

See [LICENSE](LICENSE) file for details.

## Support

For issues and feature requests, please open an issue on the GitHub repository.
