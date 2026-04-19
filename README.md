# Lumina Audiobook Creator

Lumina is a local-first audiobook creator that turns EPUB, PDF, TXT, and Markdown files into spoken audio using Kokoro TTS running on your own machine.

## Local setup

Prerequisites:
- Node.js 20+
- npm

Install dependencies:

```bash
npm install
```

Create your local env file:

```bash
cp .env.example .env.local
```

Run the Kokoro API server in one terminal:

```bash
npm run dev:server
```

Run the Vite app in another terminal:

```bash
npm run dev
```

Then open `http://localhost:3000`.

## How it works

- `server/index.ts` exposes a local API for voices, playback synthesis, and full-book export.
- `server/audio.ts` loads `kokoro-js`, synthesizes speech on-device, and stitches audiobook exports through `ffmpeg-static`.
- `src/components/PlayerView.tsx` calls the local API for playback and export, loads real Kokoro voices, and lets you choose MP3 or M4A export.

## Notes

- The first Kokoro request may take a bit longer while the model loads locally.
- MP3 and M4A exports are rendered on-device and require the local API server to be running.
- No Gemini API key is required anymore.
