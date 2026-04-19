import type { ExportFormat } from './audio.js';

export interface SpeakPayload {
  text: string;
  voice: string;
  isAdaptive: boolean;
}

export interface CreateExportJobPayload {
  voice: string;
  isAdaptive: boolean;
  format: ExportFormat;
  title?: string;
  totalSections: number;
}

export interface AppendSectionsPayload {
  sections: string[];
  isFinalBatch: boolean;
}

function requireNonEmptyString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`);
  }

  return value.trim();
}

export function validateSpeakPayload(body: unknown): SpeakPayload {
  const payload = (body ?? {}) as Record<string, unknown>;

  return {
    text: requireNonEmptyString(payload.text, 'text'),
    voice: requireNonEmptyString(payload.voice, 'voice'),
    isAdaptive: payload.isAdaptive !== false,
  };
}

export function validateCreateExportJobPayload(body: unknown): CreateExportJobPayload {
  const payload = (body ?? {}) as Record<string, unknown>;
  const totalSections = Number(payload.totalSections);

  if (!Number.isInteger(totalSections) || totalSections <= 0) {
    throw new Error('totalSections must be a positive integer');
  }

  return {
    voice: requireNonEmptyString(payload.voice, 'voice'),
    isAdaptive: payload.isAdaptive !== false,
    format: payload.format === 'm4a' ? 'm4a' : 'mp3',
    title: typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : undefined,
    totalSections,
  };
}

export function validateAppendSectionsPayload(body: unknown): AppendSectionsPayload {
  const payload = (body ?? {}) as Record<string, unknown>;
  const sections = Array.isArray(payload.sections)
    ? payload.sections.filter((section): section is string => typeof section === 'string' && section.trim().length > 0)
    : [];

  if (sections.length === 0) {
    throw new Error('sections must contain at least one non-empty string');
  }

  return {
    sections,
    isFinalBatch: payload.isFinalBatch === true,
  };
}
