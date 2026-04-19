import React, { useEffect, useRef, useState } from 'react';
import { Book, Chapter, AudioSettings, ExportJobSnapshot } from '../types';
import { getBookFile, getBookProgress, saveBookProgress } from '../lib/db';
import { cancelExportJob, createExportJob, fetchReadiness, fetchVoices, getExportJob, getExportJobDownloadUrl, synthesizeSection } from '../lib/audio-api';
import { clearExportJobReference, getExportJobReference, loadBooksMetadata, setExportJobReference } from '../lib/storage';
import { clampProgress, groupSectionsIntoChapters, PDF_PAGES_PER_CHAPTER, splitPdfPageTextIntoSections, splitTextIntoSections } from '../lib/book-parsing';
import ePub from 'epubjs';
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

import {
  ChevronLeft,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Sparkles,
  List as ListIcon,
  Download,
  RotateCcw,
  RotateCw,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface PlayerViewProps {
  bookId: string;
  onBack: () => void;
}

interface TtsState {
  ready: boolean;
  status: string;
  error?: string | null;
}

const DEFAULT_TTS_STATE: TtsState = {
  ready: false,
  status: 'idle',
  error: null,
};

function revokeQueue(queue: { url: string; text: string }[]) {
  queue.forEach((item) => URL.revokeObjectURL(item.url));
}

function isTerminalJob(job: ExportJobSnapshot | null) {
  return job?.status === 'completed' || job?.status === 'failed' || job?.status === 'cancelled';
}

export const PlayerView: React.FC<PlayerViewProps> = ({ bookId, onBack }) => {
  const [bookMetadata, setBookMetadata] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [narrationQueue, setNarrationQueue] = useState<{ url: string; text: string }[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [voices, setVoices] = useState<string[]>([]);
  const [ttsState, setTtsState] = useState<TtsState>(DEFAULT_TTS_STATE);
  const [exportJob, setExportJob] = useState<ExportJobSnapshot | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);

  const [settings, setSettings] = useState<AudioSettings>({
    playbackRate: 1.0,
    voice: 'af_heart',
    isAdaptive: true,
    exportFormat: 'mp3',
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const exportPollRef = useRef<number | null>(null);

  const replaceNarrationQueue = (nextQueue: { url: string; text: string }[]) => {
    setNarrationQueue((previousQueue) => {
      revokeQueue(previousQueue);
      return nextQueue;
    });
  };

  const stopExportPolling = () => {
    if (exportPollRef.current !== null) {
      window.clearInterval(exportPollRef.current);
      exportPollRef.current = null;
    }
  };

  const pollExportJob = async (jobId: string, preserveCompleted = true) => {
    try {
      const snapshot = await getExportJob(jobId);
      setExportJob(snapshot);

      if (snapshot.status === 'running' || snapshot.status === 'queued' || snapshot.status === 'collecting') {
        return;
      }

      stopExportPolling();

      if (snapshot.status === 'completed' && preserveCompleted) {
        return;
      }

      clearExportJobReference(bookId);
      if (snapshot.status !== 'completed') {
        setExportJob(snapshot);
      }
    } catch (pollError) {
      stopExportPolling();
      clearExportJobReference(bookId);
      setExportJob(null);
      console.error('Failed to poll export job', pollError);
    }
  };

  const startExportPolling = (jobId: string) => {
    stopExportPolling();
    void pollExportJob(jobId);
    exportPollRef.current = window.setInterval(() => {
      void pollExportJob(jobId);
    }, 2000);
  };

  useEffect(() => {
    return () => {
      stopExportPolling();
      revokeQueue(narrationQueue);
    };
  }, [narrationQueue]);

  useEffect(() => {
    const existingJob = getExportJobReference(bookId);
    if (existingJob) {
      startExportPolling(existingJob.jobId);
    } else {
      setExportJob(null);
    }

    return () => {
      stopExportPolling();
    };
  }, [bookId]);

  useEffect(() => {
    void loadBook();
  }, [bookId]);

  useEffect(() => {
    void Promise.all([fetchVoices(), fetchReadiness()])
      .then(([loadedVoices, readiness]) => {
        setVoices(loadedVoices);
        setTtsState(readiness);
        if (loadedVoices.length && !loadedVoices.includes(settings.voice)) {
          setSettings((prev) => ({ ...prev, voice: loadedVoices[0] }));
        }
      })
      .catch((loadError) => {
        console.error('Failed to load TTS state', loadError);
        setTtsState({
          ready: false,
          status: 'error',
          error: loadError instanceof Error ? loadError.message : 'Unknown error',
        });
        setError('Could not load Kokoro voices. Is the local audio service running?');
      });
  }, []);

  const loadBook = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const buffer = await getBookFile(bookId);
      if (!buffer) throw new Error('Book file not found');

      const savedBooks = loadBooksMetadata();
      const meta = savedBooks.find((book) => book.id === bookId) || null;
      setBookMetadata(meta);

      const items: Chapter[] = [];
      const format = meta?.format || 'epub';

      if (format === 'epub') {
        const book = ePub(buffer);
        await book.ready;
        const spine = (book as any).spine;
        const navigation = await book.navigation;
        const toc = (navigation as any).toc || [];

        for (let i = 0; i < spine.length; i += 1) {
          const item = spine.get(i);
          const doc: any = await book.load(item.href);
          const text = doc.body?.innerText?.trim() || '';

          if (text.length > 20) {
            const tocEntry = toc.find((entry: any) => entry.id === item.idref || entry.href.includes(item.href));
            const sections = splitTextIntoSections(text);

            if (sections.length > 0) {
              items.push({
                title: tocEntry?.label?.trim() || `Section ${items.length + 1}`,
                href: item.href,
                sections,
              });
            }
          }
        }
      } else if (format === 'pdf') {
        const loadingTask = pdfjs.getDocument({ data: buffer });
        const pdf = await loadingTask.promise;

        let groupedSections: string[] = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          const content = await page.getTextContent();
          const text = content.items.map((item: any) => item.str).join(' ');
          groupedSections.push(...splitPdfPageTextIntoSections(text));

          if (pageNumber % PDF_PAGES_PER_CHAPTER === 0 || pageNumber === pdf.numPages) {
            if (groupedSections.length > 0) {
              items.push({
                title: `Pages ${Math.max(1, pageNumber - PDF_PAGES_PER_CHAPTER + 1)} - ${pageNumber}`,
                href: `page-${pageNumber}`,
                sections: groupedSections,
              });
            }
            groupedSections = [];
          }
        }
      } else {
        const text = new TextDecoder().decode(buffer);
        items.push(...groupSectionsIntoChapters(splitTextIntoSections(text)));
      }

      setChapters(items);

      const savedProgress = clampProgress(await getBookProgress(bookId), items);
      setCurrentChapterIndex(savedProgress.chapterIndex);
      setCurrentSectionIndex(savedProgress.sectionIndex);
      if (audioRef.current) {
        audioRef.current.currentTime = savedProgress.currentTime;
      }
    } catch (loadError) {
      console.error('Failed to load book:', loadError);
      setError('Failed to load book content. File may be corrupted or unsupported.');
    } finally {
      setIsLoading(false);
    }
  };

  const playChapter = async (index: number, sectionIdx = 0) => {
    if (isGenerating || chapters.length === 0) return;

    const chapter = chapters[index];
    const sectionToPlay = chapter?.sections?.[sectionIdx];
    if (!chapter || !sectionToPlay) {
      setError('Chapter content not found');
      return;
    }

    setCurrentChapterIndex(index);
    setCurrentSectionIndex(sectionIdx);
    setIsPlaying(false);
    setIsGenerating(true);
    replaceNarrationQueue([]);

    try {
      setError(null);
      const blob = await synthesizeSection({
        text: sectionToPlay,
        voice: settings.voice,
        isAdaptive: settings.isAdaptive,
      });

      const audioUrl = URL.createObjectURL(blob);
      replaceNarrationQueue([{ url: audioUrl, text: sectionToPlay }]);

      if (audioRef.current) {
        audioRef.current.src = audioUrl;
        audioRef.current.load();
        audioRef.current.playbackRate = settings.playbackRate;

        const savedProgress = await getBookProgress(bookId);
        const restoredProgress = clampProgress(savedProgress, chapters);
        if (restoredProgress.chapterIndex === index && restoredProgress.sectionIndex === sectionIdx) {
          audioRef.current.currentTime = restoredProgress.currentTime;
        }

        try {
          await audioRef.current.play();
          setIsPlaying(true);
        } catch (playError) {
          console.error('Autoplay failed:', playError);
          setError('Autoplay blocked, tap play to start');
        }
      }

      await saveBookProgress({
        bookId,
        chapterIndex: index,
        sectionIndex: sectionIdx,
        currentTime: audioRef.current?.currentTime || 0,
        lastPlayedAt: Date.now(),
      });
    } catch (playError: unknown) {
      console.error('Narration failed:', playError);
      setError(playError instanceof Error ? playError.message : 'Failed to generate narration');
    } finally {
      setIsGenerating(false);
    }
  };

  const exportFullBook = async () => {
    if (uploadProgress || (exportJob && !isTerminalJob(exportJob))) return;

    const allSections = chapters.flatMap((chapter) => chapter.sections);
    if (allSections.length === 0) {
      setError('No readable sections were found for export.');
      return;
    }

    setError(null);
    setUploadProgress({ current: 0, total: allSections.length });

    try {
      const job = await createExportJob({
        sections: allSections,
        voice: settings.voice,
        isAdaptive: settings.isAdaptive,
        format: settings.exportFormat,
        title: bookMetadata?.title,
        onUploadProgress: (current, total) => {
          setUploadProgress({ current, total });
        },
      });

      setExportJobReference(bookId, job.id);
      setExportJob(job);
      startExportPolling(job.id);
    } catch (exportError) {
      console.error('Export failed:', exportError);
      setError(exportError instanceof Error ? exportError.message : 'Failed to export audiobook');
    } finally {
      setUploadProgress(null);
    }
  };

  const cancelActiveExport = async () => {
    if (!exportJob) return;

    try {
      const cancelledJob = await cancelExportJob(exportJob.id);
      setExportJob(cancelledJob);
      clearExportJobReference(bookId);
      stopExportPolling();
    } catch (cancelError) {
      console.error('Failed to cancel export', cancelError);
      setError(cancelError instanceof Error ? cancelError.message : 'Failed to cancel export');
    }
  };

  const downloadCompletedExport = () => {
    if (!exportJob || exportJob.status !== 'completed') return;

    const link = document.createElement('a');
    link.href = getExportJobDownloadUrl(exportJob.id);
    link.download = `${bookMetadata?.title || 'audiobook'}.${exportJob.format}`;
    link.click();
    clearExportJobReference(bookId);
  };

  const skipTime = (amount: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime += amount;
    }
  };

  const downloadAudio = () => {
    if (narrationQueue.length > 0) {
      const link = document.createElement('a');
      link.href = narrationQueue[0].url;
      link.download = `${bookMetadata?.title || 'audiobook'}_ch${currentChapterIndex + 1}.wav`;
      link.click();
    }
  };

  const togglePlay = () => {
    if (!audioRef.current || chapters.length === 0) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else if (narrationQueue.length === 0) {
      void playChapter(currentChapterIndex, currentSectionIndex);
    } else {
      if (!audioRef.current.src) {
        audioRef.current.src = narrationQueue[0].url;
        audioRef.current.load();
      }
      audioRef.current.playbackRate = settings.playbackRate;
      audioRef.current.play().catch((playError) => console.error('Play toggle failed:', playError));
      setIsPlaying(true);
    }
  };

  useEffect(() => {
    const interval = window.setInterval(async () => {
      if (isPlaying && audioRef.current && chapters.length > 0) {
        await saveBookProgress({
          bookId,
          chapterIndex: currentChapterIndex,
          sectionIndex: currentSectionIndex,
          currentTime: audioRef.current.currentTime,
          lastPlayedAt: Date.now(),
        });
      }
    }, 5000);
    return () => window.clearInterval(interval);
  }, [isPlaying, currentChapterIndex, currentSectionIndex, bookId, chapters.length]);

  useEffect(() => {
    replaceNarrationQueue([]);
    if (isPlaying) {
      setIsPlaying(false);
      audioRef.current?.pause();
    }
  }, [settings.voice, settings.isAdaptive]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = settings.playbackRate;
    }
  }, [settings.playbackRate]);

  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center space-y-4">
        <Sparkles className="w-12 h-12 text-orange-500 animate-pulse" />
        <p className="font-serif italic text-zinc-400">Preparing your library...</p>
      </div>
    );
  }

  const currentChapter = chapters[currentChapterIndex];
  const activeProgress = uploadProgress || exportJob?.progress || null;
  const exportActionLabel = uploadProgress
    ? 'Uploading export batches...'
    : exportJob?.status === 'running'
      ? 'Rendering audiobook...'
      : exportJob?.status === 'queued'
        ? 'Queued for render...'
        : exportJob?.status === 'completed'
          ? `Download audiobook (.${exportJob.format})`
          : `Export Full Audiobook (.${settings.exportFormat})`;

  return (
    <div className="h-full flex relative bg-background">
      <aside className="w-80 bg-muted border-r border-border p-10 hidden lg:flex flex-col">
        <div className="flex items-center gap-2 mb-10">
          <div className="w-5 h-5 bg-primary rounded-[4px]" />
          <span className="text-lg font-bold tracking-tight">Lumina</span>
        </div>

        <div className="flex-1 overflow-y-auto pr-2">
          <div className="flex justify-between items-center mb-6 gap-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Chapters</p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={exportJob?.status === 'completed' ? downloadCompletedExport : exportFullBook}
                disabled={!!uploadProgress || exportJob?.status === 'running' || exportJob?.status === 'queued'}
                className="h-7 text-[9px] font-black uppercase tracking-widest border-primary/20 text-primary hover:bg-primary/10"
              >
                <Download className="w-3 h-3 mr-1" />
                {exportJob?.status === 'completed' ? 'Download' : 'Export'}
              </Button>
              {(uploadProgress || (exportJob && !isTerminalJob(exportJob))) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={cancelActiveExport}
                  className="h-7 px-2 text-[9px] font-black uppercase tracking-widest"
                >
                  <X className="w-3 h-3" />
                </Button>
              ) : null}
            </div>
          </div>
          <div className="space-y-2">
            {chapters.map((chapter, index) => (
              <button
                key={chapter.href}
                onClick={() => {
                  setCurrentChapterIndex(index);
                  void playChapter(index);
                }}
                className={`w-full text-left p-4 rounded-xl transition-all border ${
                  index === currentChapterIndex
                    ? 'bg-card border-border shadow-sm ring-1 ring-primary/5'
                    : 'hover:bg-black/5 border-transparent text-muted-foreground'
                }`}
              >
                <p className="text-[14px] font-semibold truncate">{chapter.title}</p>
                <div className="mt-2 h-[2px] bg-border rounded-full w-full">
                  <div className={`h-full bg-primary rounded-full ${index === currentChapterIndex ? 'w-1/3' : 'w-0'}`} />
                </div>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <main className="flex-1 h-full p-12 lg:p-24 overflow-y-auto">
        <div className="max-w-xl mx-auto flex flex-col h-full">
          <header className="flex items-center justify-between mb-12">
            <Button variant="ghost" onClick={onBack} className="text-muted-foreground font-bold text-xs uppercase tracking-widest gap-2">
              <ChevronLeft className="w-4 h-4" />
              Library
            </Button>

            <Sheet>
              <SheetTrigger render={
                <Button variant="ghost" size="icon" className="rounded-full lg:hidden">
                  <ListIcon className="w-5 h-5" />
                </Button>
              } />
              <SheetContent className="bg-background border-border">
                <SheetHeader>
                  <SheetTitle>Chapters</SheetTitle>
                </SheetHeader>
                <div className="mt-4">
                  <div className="flex gap-2 mb-6">
                    <Button
                      onClick={exportJob?.status === 'completed' ? downloadCompletedExport : exportFullBook}
                      disabled={!!uploadProgress || exportJob?.status === 'running' || exportJob?.status === 'queued'}
                      className="flex-1 bg-primary/10 text-primary border-primary/20 h-10 text-xs font-bold uppercase tracking-widest gap-2"
                    >
                      {exportActionLabel}
                    </Button>
                    {(uploadProgress || (exportJob && !isTerminalJob(exportJob))) ? (
                      <Button type="button" variant="outline" onClick={cancelActiveExport} className="h-10 px-3">
                        <X className="w-4 h-4" />
                      </Button>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    {chapters.map((chapter, index) => (
                      <button key={chapter.href} onClick={() => { setCurrentChapterIndex(index); void playChapter(index); }} className="w-full text-left p-4 rounded-lg bg-muted text-sm font-semibold">{chapter.title}</button>
                    ))}
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </header>

          <div className="bg-card border border-border rounded-[24px] p-12 shadow-[0_20px_50px_rgba(0,0,0,0.04)] flex flex-col flex-1">
            <div className="text-center mb-10">
              <h2 className="text-3xl font-bold tracking-tight mb-2 leading-tight">{currentChapter?.title || 'Select a Chapter'}</h2>
              <p className="text-muted-foreground font-medium text-lg">{bookMetadata?.author}</p>
              <p className="mt-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                {ttsState.ready ? 'Kokoro ready' : `Kokoro ${ttsState.status}`}
              </p>
              {error && (
                <p className="mt-4 text-sm font-bold text-red-500 bg-red-50 py-2 px-4 rounded-full inline-block">
                  {error}
                </p>
              )}
              {!ttsState.ready && ttsState.error ? (
                <p className="mt-3 text-xs text-red-500">{ttsState.error}</p>
              ) : null}
            </div>

            <div className="flex items-center justify-center gap-[3px] h-20 mb-12">
              {[...Array(24)].map((_, index) => (
                <motion.div
                  key={index}
                  animate={{ height: isPlaying ? [16, Math.random() * 60 + 16, 16] : 6 }}
                  transition={{ duration: 0.5, repeat: Infinity, delay: index * 0.05 }}
                  className={`w-1 rounded-full transition-opacity ${isPlaying && index < 12 ? 'bg-primary opacity-80' : 'bg-primary opacity-20'}`}
                />
              ))}
            </div>

            <div className="flex items-center justify-center gap-6 mb-12">
              <Button variant="ghost" size="icon" onClick={() => skipTime(-30)} className="text-foreground opacity-40 hover:opacity-100">
                <RotateCcw className="w-6 h-6" />
              </Button>

              <Button variant="ghost" size="icon" onClick={() => {
                if (currentSectionIndex > 0) {
                  void playChapter(currentChapterIndex, currentSectionIndex - 1);
                } else if (currentChapterIndex > 0) {
                  const previousChapterIndex = currentChapterIndex - 1;
                  const lastSection = chapters[previousChapterIndex]?.sections.length ? chapters[previousChapterIndex].sections.length - 1 : 0;
                  void playChapter(previousChapterIndex, lastSection);
                }
              }} className="text-foreground opacity-40 hover:opacity-100">
                <SkipBack className="w-7 h-7" />
              </Button>

              <Button
                size="icon"
                onClick={togglePlay}
                disabled={isGenerating || !ttsState.ready || chapters.length === 0}
                className="w-20 h-20 rounded-full bg-foreground text-background hover:scale-105 transition-all shadow-xl shadow-black/10"
              >
                {isGenerating ? (
                  <div className="w-6 h-6 border-2 border-background/30 border-t-background rounded-full animate-spin" />
                ) : isPlaying ? (
                  <Pause className="w-8 h-8 fill-current" />
                ) : (
                  <Play className="w-8 h-8 fill-current translate-x-1" />
                )}
              </Button>

              <Button variant="ghost" size="icon" onClick={() => {
                const chapterSections = chapters[currentChapterIndex]?.sections || [];
                if (currentSectionIndex < chapterSections.length - 1) {
                  void playChapter(currentChapterIndex, currentSectionIndex + 1);
                } else if (currentChapterIndex < chapters.length - 1) {
                  void playChapter(currentChapterIndex + 1, 0);
                }
              }} className="text-foreground opacity-40 hover:opacity-100">
                <SkipForward className="w-7 h-7" />
              </Button>

              <Button variant="ghost" size="icon" onClick={() => skipTime(30)} className="text-foreground opacity-40 hover:opacity-100">
                <RotateCw className="w-6 h-6" />
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-10 border-t border-border pt-10">
              <div className="space-y-4">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">Reading Speed</span>
                <div className="flex items-center gap-4">
                  <Slider
                    value={[settings.playbackRate]}
                    min={0.5}
                    max={2.5}
                    step={0.1}
                    onValueChange={(vals) => setSettings((state) => ({ ...state, playbackRate: vals[0] }))}
                    className="flex-1"
                  />
                  <span className="text-xs font-bold w-12">{settings.playbackRate}x</span>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-start mb-4">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">Kokoro Voice</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={downloadAudio}
                    className="h-4 w-4 opacity-40 hover:opacity-100"
                    title="Download current segment (WAV)"
                  >
                    <RotateCw className="w-3 h-3 rotate-45" />
                  </Button>
                </div>
                <div className="flex flex-col gap-4">
                  <DropdownMenu>
                    <DropdownMenuTrigger render={
                      <Button variant="ghost" className="p-0 h-auto font-bold flex items-center gap-2 hover:bg-transparent">
                        {settings.voice}
                        <div className="bg-emerald-500 text-[8px] text-white px-2 py-0.5 rounded-[4px] font-black uppercase tracking-widest">Local</div>
                      </Button>
                    } />
                    <DropdownMenuContent className="bg-card border-border max-h-72 overflow-y-auto">
                      {voices.map((voice) => (
                        <DropdownMenuItem key={voice} onClick={() => setSettings((state) => ({ ...state, voice }))} className="font-bold cursor-pointer">
                          {voice}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant={settings.exportFormat === 'mp3' ? 'default' : 'outline'}
                      className="flex-1"
                      onClick={() => setSettings((state) => ({ ...state, exportFormat: 'mp3' }))}
                    >
                      MP3
                    </Button>
                    <Button
                      type="button"
                      variant={settings.exportFormat === 'm4a' ? 'default' : 'outline'}
                      className="flex-1"
                      onClick={() => setSettings((state) => ({ ...state, exportFormat: 'm4a' }))}
                    >
                      M4A
                    </Button>
                  </div>

                  <Button
                    onClick={exportJob?.status === 'completed' ? downloadCompletedExport : exportFullBook}
                    disabled={!!uploadProgress || exportJob?.status === 'running' || exportJob?.status === 'queued'}
                    className="w-full bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 h-9 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2"
                  >
                    {exportJob?.status === 'completed' ? (
                      <>
                        <Download className="w-3.5 h-3.5" />
                        Download Completed Export
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5" />
                        {exportActionLabel}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>

            <div className="mt-12">
              {activeProgress ? (
                <div className="space-y-3 mb-6">
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-primary">
                    <span>{exportActionLabel}</span>
                    <span>{Math.round((activeProgress.current / activeProgress.total) * 100)}%</span>
                  </div>
                  <div className="h-[4px] bg-muted rounded-full overflow-hidden">
                    <motion.div className="h-full bg-primary" initial={{ width: 0 }} animate={{ width: `${(activeProgress.current / activeProgress.total) * 100}%` }} />
                  </div>
                </div>
              ) : null}
              <div className="h-[6px] bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full w-[35%] shadow-sm" />
              </div>
              <div className="flex justify-between mt-4 text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
                <span>0:00:00</span>
                <span>Local Kokoro playback</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onError={(event) => {
          const target = event.target as HTMLAudioElement;
          console.error('Audio error:', target.error);
        }}
        onEnded={() => {
          setIsPlaying(false);
          const chapter = chapters[currentChapterIndex];
          if (!chapter) return;

          if (currentSectionIndex < chapter.sections.length - 1) {
            void playChapter(currentChapterIndex, currentSectionIndex + 1);
          } else if (currentChapterIndex < chapters.length - 1) {
            void playChapter(currentChapterIndex + 1, 0);
          }
        }}
      />
    </div>
  );
};
