import { ExportFormat, ExportJobSnapshot } from '../types';

function resolveApiPrefix() {
  const explicitBase = import.meta.env.VITE_LUMINA_API_URL?.trim();
  if (explicitBase) {
    return `${explicitBase.replace(/\/+$/, '')}/api`;
  }

  if (typeof window !== 'undefined' && /^https?:/i.test(window.location.origin)) {
    return new URL('/api', window.location.origin).toString().replace(/\/+$/, '');
  }

  return '/api';
}

const API_PREFIX = resolveApiPrefix();
const EXPORT_BATCH_SIZE = 10;

async function handleResponse(response: Response) {
  if (!response.ok) {
    let message = 'Request failed';
    try {
      const data = await response.json();
      message = data.error || message;
    } catch {
      message = await response.text() || message;
    }
    throw new Error(message);
  }
  return response;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const preview = text.slice(0, 120).trim();
    throw new Error(`Expected JSON from local audio API but received: ${preview || '<empty response>'}`);
  }
}

export async function fetchVoices(): Promise<string[]> {
  const response = await handleResponse(await fetch(`${API_PREFIX}/voices`));
  const data = await parseJsonResponse<{ voices?: string[] }>(response);
  return data.voices || [];
}

export async function fetchReadiness(): Promise<{ ready: boolean; status: string; error?: string | null }> {
  const response = await fetch(`${API_PREFIX}/readiness`);
  const data = await parseJsonResponse<{ ready?: boolean; status?: string; error?: string | null }>(response);
  return {
    ready: !!data.ready,
    status: data.status || 'unknown',
    error: data.error || null,
  };
}

export async function synthesizeSection(input: { text: string; voice: string; isAdaptive: boolean }): Promise<Blob> {
  const response = await handleResponse(await fetch(`${API_PREFIX}/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }));

  return response.blob();
}

export async function createExportJob(input: {
  sections: string[];
  voice: string;
  isAdaptive: boolean;
  format: ExportFormat;
  title?: string;
  onUploadProgress?: (current: number, total: number) => void;
}): Promise<ExportJobSnapshot> {
  const createResponse = await handleResponse(await fetch(`${API_PREFIX}/export-jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      voice: input.voice,
      isAdaptive: input.isAdaptive,
      format: input.format,
      title: input.title,
      totalSections: input.sections.length,
    }),
  }));

  let job = await parseJsonResponse<ExportJobSnapshot>(createResponse);

  for (let index = 0; index < input.sections.length; index += EXPORT_BATCH_SIZE) {
    const batch = input.sections.slice(index, index + EXPORT_BATCH_SIZE);
    const isFinalBatch = index + EXPORT_BATCH_SIZE >= input.sections.length;
    const appendResponse = await handleResponse(await fetch(`${API_PREFIX}/export-jobs/${job.id}/sections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sections: batch,
        isFinalBatch,
      }),
    }));

    job = await parseJsonResponse<ExportJobSnapshot>(appendResponse);
    input.onUploadProgress?.(Math.min(index + batch.length, input.sections.length), input.sections.length);
  }

  return job;
}

export async function getExportJob(jobId: string): Promise<ExportJobSnapshot> {
  const response = await handleResponse(await fetch(`${API_PREFIX}/export-jobs/${jobId}`));
  return parseJsonResponse<ExportJobSnapshot>(response);
}

export async function cancelExportJob(jobId: string): Promise<ExportJobSnapshot> {
  const response = await handleResponse(await fetch(`${API_PREFIX}/export-jobs/${jobId}/cancel`, {
    method: 'POST',
  }));
  return parseJsonResponse<ExportJobSnapshot>(response);
}

export function getExportJobDownloadUrl(jobId: string) {
  return `${API_PREFIX}/export-jobs/${jobId}/download`;
}
