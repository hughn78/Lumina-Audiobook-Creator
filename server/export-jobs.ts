import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportSpeechToFile, type ExportFormat } from './audio.js';

const EXPORT_JOB_TTL_MS = 1000 * 60 * 30;

export type ExportJobStatus =
  | 'collecting'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ExportJobSnapshot {
  id: string;
  status: ExportJobStatus;
  format: ExportFormat;
  title?: string;
  progress: {
    current: number;
    total: number;
  };
  error?: string;
  createdAt: number;
  updatedAt: number;
  downloadUrl?: string;
}

interface ExportJob {
  id: string;
  title?: string;
  format: ExportFormat;
  voice: string;
  isAdaptive: boolean;
  sections: string[];
  totalSections: number;
  status: ExportJobStatus;
  error?: string;
  tempRoot: string;
  outputPath?: string;
  contentType?: string;
  extension?: string;
  createdAt: number;
  updatedAt: number;
  progressCurrent: number;
  abortController: AbortController;
  cleanupTimer?: NodeJS.Timeout;
}

const jobs = new Map<string, ExportJob>();

function toSnapshot(job: ExportJob): ExportJobSnapshot {
  return {
    id: job.id,
    status: job.status,
    format: job.format,
    title: job.title,
    progress: {
      current: getCompletedSectionCount(job),
      total: job.totalSections,
    },
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    downloadUrl: job.status === 'completed' ? `/api/export-jobs/${job.id}/download` : undefined,
  };
}

function scheduleCleanup(job: ExportJob) {
  if (job.cleanupTimer) {
    clearTimeout(job.cleanupTimer);
  }

  job.cleanupTimer = setTimeout(() => {
    void cleanupJob(job.id);
  }, EXPORT_JOB_TTL_MS);
}

async function cleanupJob(jobId: string) {
  const job = jobs.get(jobId);
  if (!job) return;

  if (job.cleanupTimer) {
    clearTimeout(job.cleanupTimer);
  }

  jobs.delete(jobId);
  await rm(job.tempRoot, { recursive: true, force: true });
}

async function runExport(job: ExportJob) {
  job.status = 'running';
  job.updatedAt = Date.now();

  try {
    const result = await exportSpeechToFile({
      sections: job.sections,
      voice: job.voice,
      format: job.format,
      isAdaptive: job.isAdaptive,
      outputDir: job.tempRoot,
      signal: job.abortController.signal,
      onSectionComplete: (current) => {
        job.updatedAt = Date.now();
        job.progressCurrent = current;
      },
    });

    job.outputPath = result.outputPath;
    job.contentType = result.contentType;
    job.extension = result.extension;
    job.status = 'completed';
    job.updatedAt = Date.now();
    scheduleCleanup(job);
  } catch (error) {
    job.status = job.abortController.signal.aborted ? 'cancelled' : 'failed';
    job.error = error instanceof Error ? error.message : 'Unknown error';
    job.updatedAt = Date.now();
    scheduleCleanup(job);
  }
}

function getCompletedSectionCount(job: ExportJob) {
  return Math.min(job.progressCurrent || (job.status === 'completed' ? job.totalSections : 0), job.totalSections);
}

export async function createExportJob(input: {
  title?: string;
  voice: string;
  isAdaptive: boolean;
  format: ExportFormat;
  totalSections: number;
}) {
  const id = crypto.randomUUID();
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'lumina-export-job-'));
  const now = Date.now();

  const job: ExportJob = {
    id,
    title: input.title,
    voice: input.voice,
    isAdaptive: input.isAdaptive,
    format: input.format,
    totalSections: input.totalSections,
    sections: [],
    status: 'collecting',
    tempRoot,
    createdAt: now,
    updatedAt: now,
    progressCurrent: 0,
    abortController: new AbortController(),
  };

  jobs.set(id, job);
  scheduleCleanup(job);

  return toSnapshot(job);
}

export function getExportJob(jobId: string) {
  const job = jobs.get(jobId);
  if (!job) return null;

  return {
    snapshot: {
      ...toSnapshot(job),
      progress: {
        current: getCompletedSectionCount(job),
        total: job.totalSections,
      },
    },
    job,
  };
}

export async function appendSections(jobId: string, sections: string[], isFinalBatch: boolean) {
  const entry = getExportJob(jobId);
  if (!entry) {
    throw new Error('Export job not found');
  }

  const { job } = entry;
  if (job.status !== 'collecting') {
    throw new Error('Export job is no longer accepting sections');
  }

  if (job.sections.length > job.totalSections) {
    throw new Error('Received more sections than expected');
  }

  if (job.sections.length + sections.length > job.totalSections) {
    throw new Error('Received more sections than expected');
  }

  job.sections.push(...sections);
  job.updatedAt = Date.now();
  scheduleCleanup(job);

  if (isFinalBatch) {
    if (job.sections.length !== job.totalSections) {
      throw new Error('Final batch did not match declared totalSections');
    }

    job.status = 'queued';
    job.updatedAt = Date.now();
    void runExport(job);
  }

  return getExportJob(jobId)?.snapshot ?? null;
}

export function cancelExportJob(jobId: string) {
  const entry = getExportJob(jobId);
  if (!entry) return null;

  const { job } = entry;
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    return entry.snapshot;
  }

  job.abortController.abort();
  job.status = 'cancelled';
  job.updatedAt = Date.now();
  scheduleCleanup(job);
  return getExportJob(jobId)?.snapshot ?? null;
}

export function createExportDownload(jobId: string) {
  const entry = getExportJob(jobId);
  if (!entry) return null;

  const { job } = entry;
  if (job.status !== 'completed' || !job.outputPath || !job.contentType || !job.extension) {
    return null;
  }

  job.updatedAt = Date.now();
  scheduleCleanup(job);

  const baseName = (job.title || 'audiobook').replace(/[^a-z0-9-_]+/gi, '_').replace(/^_+|_+$/g, '') || 'audiobook';
  return {
    stream: createReadStream(job.outputPath),
    contentType: job.contentType,
    fileName: `${baseName}.${job.extension}`,
  };
}
