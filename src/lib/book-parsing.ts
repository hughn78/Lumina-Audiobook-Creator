import type { BookProgress, Chapter } from '../types.ts';

export const MAX_SECTION_CHARS = 3000;
export const TEXT_SECTIONS_PER_CHAPTER = 5;
export const PDF_PAGES_PER_CHAPTER = 5;

function pushChunk(chunks: string[], chunk: string) {
  const cleaned = chunk.trim();
  if (cleaned) {
    chunks.push(cleaned);
  }
}

export function chunkSegments(segments: string[], maxChars = MAX_SECTION_CHARS, separator = '\n'): string[] {
  const chunks: string[] = [];
  let currentChunk = '';

  for (const rawSegment of segments) {
    const segment = rawSegment.trim();
    if (!segment) continue;

    if (!currentChunk) {
      currentChunk = segment;
      continue;
    }

    const candidate = `${currentChunk}${separator}${segment}`;
    if (candidate.length > maxChars) {
      pushChunk(chunks, currentChunk);
      currentChunk = segment;
    } else {
      currentChunk = candidate;
    }
  }

  pushChunk(chunks, currentChunk);
  return chunks;
}

export function splitTextIntoSections(text: string): string[] {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return chunkSegments(lines);
}

export function splitPdfPageTextIntoSections(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/).map((line) => line.trim()).filter(Boolean);
  return chunkSegments(sentences, MAX_SECTION_CHARS, ' ');
}

export function groupSectionsIntoChapters(sections: string[], sectionsPerChapter = TEXT_SECTIONS_PER_CHAPTER, titlePrefix = 'Part'): Chapter[] {
  const chapters: Chapter[] = [];

  for (let index = 0; index < sections.length; index += sectionsPerChapter) {
    chapters.push({
      title: `${titlePrefix} ${Math.floor(index / sectionsPerChapter) + 1}`,
      href: `${titlePrefix.toLowerCase()}-${index}`,
      sections: sections.slice(index, index + sectionsPerChapter),
    });
  }

  return chapters;
}

export function clampProgress(progress: BookProgress | undefined, chapters: Chapter[]) {
  if (!progress || chapters.length === 0) {
    return {
      chapterIndex: 0,
      sectionIndex: 0,
      currentTime: 0,
    };
  }

  const chapterIndex = Math.min(Math.max(progress.chapterIndex, 0), chapters.length - 1);
  const chapter = chapters[chapterIndex];
  const sectionIndex = Math.min(Math.max(progress.sectionIndex, 0), Math.max(chapter.sections.length - 1, 0));

  return {
    chapterIndex,
    sectionIndex,
    currentTime: Math.max(progress.currentTime || 0, 0),
  };
}
