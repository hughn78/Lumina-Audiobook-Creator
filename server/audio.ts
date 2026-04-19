import { KokoroTTS } from 'kokoro-js';
import type { RawAudio } from '@huggingface/transformers';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveKokoroModelSource } from './runtime.js';

const KOKORO_DEVICE = process.env.KOKORO_DEVICE || 'cpu';
const KOKORO_DTYPE = process.env.KOKORO_DTYPE || 'q8';
const TTS_MAX_INIT_RETRIES = Number(process.env.KOKORO_INIT_RETRIES || 3);
const TTS_RETRY_DELAY_MS = Number(process.env.KOKORO_INIT_RETRY_DELAY_MS || 1000);

export type ExportFormat = 'mp3' | 'm4a';
export type KokoroVoice = keyof Awaited<ReturnType<typeof getTts>>['voices'];

export interface SpeechRequest {
  text: string;
  voice: string;
  isAdaptive?: boolean;
}

let ttsPromise: Promise<KokoroTTS> | null = null;
let ttsStatus: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
let ttsLastError: string | null = null;
let resolvedModelSource: Awaited<ReturnType<typeof resolveKokoroModelSource>> | null = null;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadTtsWithRetry() {
  let lastError: unknown;

  for (let attempt = 1; attempt <= TTS_MAX_INIT_RETRIES; attempt += 1) {
    try {
      resolvedModelSource = await resolveKokoroModelSource();
      return await KokoroTTS.from_pretrained(resolvedModelSource.modelId, {
        device: KOKORO_DEVICE as 'cpu' | 'wasm' | 'webgpu' | null,
        dtype: KOKORO_DTYPE as 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16',
      });
    } catch (error) {
      lastError = error;
      if (attempt < TTS_MAX_INIT_RETRIES) {
        await wait(TTS_RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to initialize Kokoro TTS');
}

async function getTts() {
  if (!ttsPromise) {
    ttsStatus = 'loading';
    ttsLastError = null;
    ttsPromise = loadTtsWithRetry()
      .then((tts) => {
        ttsStatus = 'ready';
        return tts;
      })
      .catch((error) => {
        ttsStatus = 'error';
        ttsLastError = error instanceof Error ? error.message : 'Unknown error';
        ttsPromise = null;
        throw error;
      });
  }

  return ttsPromise;
}

export function getTtsReadiness() {
  return {
    status: ttsStatus,
    ready: ttsStatus === 'ready',
    modelId: resolvedModelSource?.modelId || null,
    usingBundledModel: resolvedModelSource?.local || false,
    device: KOKORO_DEVICE,
    dtype: KOKORO_DTYPE,
    error: ttsLastError,
  };
}

export async function listVoices(): Promise<string[]> {
  const tts = await getTts();
  return Object.keys(tts.voices);
}

function normalizeText(text: string, isAdaptive = true) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) throw new Error('No text provided for speech generation.');
  return isAdaptive
    ? `Narrate the following text naturally, with expressive pacing and gentle audiobook-style inflection: ${cleaned}`
    : cleaned;
}

function rawAudioToWavBuffer(audio: RawAudio) {
  return Buffer.from(audio.toWav());
}

export async function synthesizeSpeech({ text, voice, isAdaptive = true }: SpeechRequest) {
  const tts = await getTts();
  const finalText = normalizeText(text, isAdaptive);
  const audio = await tts.generate(finalText, { voice: voice as KokoroVoice });
  const wavBuffer = rawAudioToWavBuffer(audio);

  return {
    wavBuffer,
    sampleRate: audio.sampling_rate ?? 24000,
    contentType: 'audio/wav',
  };
}

async function runFfmpeg(args: string[], signal?: AbortSignal) {
  if (!ffmpegPath) throw new Error('ffmpeg-static is unavailable.');

  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath as unknown as string, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const ffmpegStderr = ffmpeg.stderr;

    const abortHandler = () => {
      ffmpeg.kill('SIGTERM');
      reject(new Error('Export cancelled'));
    };

    if (signal) {
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    if (!ffmpegStderr) {
      reject(new Error('ffmpeg stderr is unavailable'));
      return;
    }

    ffmpegStderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    ffmpeg.on('error', (error) => {
      if (signal) {
        signal.removeEventListener('abort', abortHandler);
      }
      reject(error);
    });

    ffmpeg.on('close', (code) => {
      if (signal) {
        signal.removeEventListener('abort', abortHandler);
      }

      if (code === 0) resolve();
      else reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error('Export cancelled');
  }
}

export async function exportSpeechToFile(input: {
  sections: string[];
  voice: string;
  format: ExportFormat;
  isAdaptive?: boolean;
  outputDir?: string;
  signal?: AbortSignal;
  onSectionComplete?: (current: number, total: number) => void;
}) {
  const { sections, voice, format, isAdaptive = true, signal, onSectionComplete } = input;
  if (!sections.length) throw new Error('No sections provided for export.');

  const tempRoot = input.outputDir || await mkdtemp(path.join(tmpdir(), 'lumina-kokoro-'));
  const shouldCleanup = !input.outputDir;

  try {
    const wavPaths: string[] = [];

    for (let i = 0; i < sections.length; i += 1) {
      throwIfAborted(signal);
      const { wavBuffer } = await synthesizeSpeech({ text: sections[i], voice, isAdaptive });
      const wavPath = path.join(tempRoot, `segment-${String(i).padStart(4, '0')}.wav`);
      await writeFile(wavPath, wavBuffer);
      wavPaths.push(wavPath);
      onSectionComplete?.(i + 1, sections.length);
    }

    throwIfAborted(signal);
    const listFile = path.join(tempRoot, 'inputs.txt');
    await writeFile(listFile, wavPaths.map((wavPath) => `file '${wavPath.replace(/'/g, "'\\''")}'`).join('\n'));

    const extension = format === 'm4a' ? 'm4a' : 'mp3';
    const outputPath = path.join(tempRoot, `audiobook.${extension}`);
    const ffmpegArgs = format === 'm4a'
      ? ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:a', 'aac', '-b:a', '192k', outputPath]
      : ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:a', 'libmp3lame', '-b:a', '192k', outputPath];

    await runFfmpeg(ffmpegArgs, signal);
    return {
      outputPath,
      contentType: format === 'm4a' ? 'audio/mp4' : 'audio/mpeg',
      extension,
    };
  } finally {
    if (shouldCleanup) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

export async function exportSpeech(sections: string[], voice: string, format: ExportFormat, isAdaptive = true) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'lumina-kokoro-'));
  try {
    const result = await exportSpeechToFile({
      sections,
      voice,
      format,
      isAdaptive,
      outputDir: tempRoot,
    });
    const buffer = await readFile(result.outputPath);

    return {
      buffer,
      contentType: result.contentType,
      extension: result.extension,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
