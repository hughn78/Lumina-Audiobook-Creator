import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env as hfEnv } from '@huggingface/transformers';

const REMOTE_MODEL_ID = process.env.KOKORO_MODEL_ID || 'onnx-community/Kokoro-82M-v1.0-ONNX';
const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);

async function pathExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function getCandidateModelDirs() {
  const explicitDir = process.env.LUMINA_KOKORO_MODEL_DIR;
  const candidates = [
    explicitDir,
    path.resolve(process.cwd(), 'vendor/kokoro-model'),
    path.resolve(currentDir, '../vendor/kokoro-model'),
    path.resolve(process.resourcesPath || '', 'kokoro-model'),
    path.resolve(process.resourcesPath || '', 'vendor/kokoro-model'),
    path.resolve(process.resourcesPath || '', 'app/vendor/kokoro-model'),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  return Array.from(new Set(candidates));
}

export async function resolveKokoroModelSource() {
  for (const candidate of getCandidateModelDirs()) {
    const configPath = path.join(candidate, 'config.json');
    const tokenizerPath = path.join(candidate, 'tokenizer.json');
    const onnxPath = path.join(candidate, 'onnx', 'model_quantized.onnx');

    if (await pathExists(configPath) && await pathExists(tokenizerPath) && await pathExists(onnxPath)) {
      hfEnv.allowRemoteModels = false;
      hfEnv.allowLocalModels = true;
      hfEnv.localModelPath = path.dirname(candidate);
      return {
        modelId: candidate,
        local: true,
        baseDir: candidate,
      };
    }
  }

  hfEnv.allowRemoteModels = true;
  hfEnv.allowLocalModels = true;
  return {
    modelId: REMOTE_MODEL_ID,
    local: false,
    baseDir: null,
  };
}
