export interface Book {
  id: string;
  title: string;
  author: string;
  format: 'epub' | 'pdf' | 'txt' | 'md';
  cover?: string;
  addedAt: number;
  status?: 'ready' | 'converting' | 'error';
  progressPercent?: number;
}

export interface BookProgress {
  bookId: string;
  chapterIndex: number;
  sectionIndex: number;
  currentTime: number;
  lastPlayedAt: number;
}

export interface Chapter {
  title: string;
  href: string;
  sections: string[];
}

export type ExportFormat = 'mp3' | 'm4a';

export interface AudioSettings {
  playbackRate: number;
  voice: string;
  isAdaptive: boolean;
  exportFormat: ExportFormat;
}

export type ExportJobStatus =
  | 'collecting'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ExportJobProgress {
  current: number;
  total: number;
}

export interface ExportJobSnapshot {
  id: string;
  status: ExportJobStatus;
  format: ExportFormat;
  title?: string;
  progress: ExportJobProgress;
  error?: string;
  createdAt: number;
  updatedAt: number;
  downloadUrl?: string;
}
