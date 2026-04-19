import type { Book } from '../types.ts';

const BOOKS_STORAGE_KEY = 'lumina-books-metadata';
const EXPORT_JOB_STORAGE_KEY = 'lumina-export-jobs';
const BOOKS_STORAGE_VERSION = 1;
const EXPORT_JOB_STORAGE_VERSION = 1;

interface BooksEnvelope {
  version: number;
  books: Book[];
}

interface ExportJobReference {
  bookId: string;
  jobId: string;
  createdAt: number;
}

interface ExportJobsEnvelope {
  version: number;
  jobs: Record<string, ExportJobReference>;
}

function safeParseJson<T>(value: string | null): T | null {
  if (!value) return null;

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function parseStoredBooks(rawValue: string | null): Book[] {
  const parsed = safeParseJson<BooksEnvelope | Book[]>(rawValue);
  if (!parsed) return [];

  if (Array.isArray(parsed)) {
    return parsed.filter(isBookLike);
  }

  if (parsed.version === BOOKS_STORAGE_VERSION && Array.isArray(parsed.books)) {
    return parsed.books.filter(isBookLike);
  }

  return [];
}

function isBookLike(value: unknown): value is Book {
  if (!value || typeof value !== 'object') return false;

  const book = value as Partial<Book>;
  return typeof book.id === 'string'
    && typeof book.title === 'string'
    && typeof book.author === 'string'
    && typeof book.addedAt === 'number'
    && typeof book.format === 'string';
}

export function loadBooksMetadata(): Book[] {
  return parseStoredBooks(localStorage.getItem(BOOKS_STORAGE_KEY));
}

export function saveBooksMetadata(books: Book[]) {
  const envelope: BooksEnvelope = {
    version: BOOKS_STORAGE_VERSION,
    books,
  };

  localStorage.setItem(BOOKS_STORAGE_KEY, JSON.stringify(envelope));
}

function parseExportJobs(rawValue: string | null): ExportJobsEnvelope {
  const parsed = safeParseJson<ExportJobsEnvelope>(rawValue);
  if (!parsed || parsed.version !== EXPORT_JOB_STORAGE_VERSION || typeof parsed.jobs !== 'object' || !parsed.jobs) {
    return {
      version: EXPORT_JOB_STORAGE_VERSION,
      jobs: {},
    };
  }

  return parsed;
}

function saveExportJobs(envelope: ExportJobsEnvelope) {
  localStorage.setItem(EXPORT_JOB_STORAGE_KEY, JSON.stringify(envelope));
}

export function getExportJobReference(bookId: string): ExportJobReference | null {
  const envelope = parseExportJobs(localStorage.getItem(EXPORT_JOB_STORAGE_KEY));
  return envelope.jobs[bookId] ?? null;
}

export function setExportJobReference(bookId: string, jobId: string) {
  const envelope = parseExportJobs(localStorage.getItem(EXPORT_JOB_STORAGE_KEY));
  envelope.jobs[bookId] = {
    bookId,
    jobId,
    createdAt: Date.now(),
  };
  saveExportJobs(envelope);
}

export function clearExportJobReference(bookId: string) {
  const envelope = parseExportJobs(localStorage.getItem(EXPORT_JOB_STORAGE_KEY));
  if (envelope.jobs[bookId]) {
    delete envelope.jobs[bookId];
    saveExportJobs(envelope);
  }
}

export const storageKeys = {
  books: BOOKS_STORAGE_KEY,
  exportJobs: EXPORT_JOB_STORAGE_KEY,
};
