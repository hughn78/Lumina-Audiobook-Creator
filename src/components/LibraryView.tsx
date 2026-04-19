import React, { useCallback } from 'react';
import { Book, BookProgress } from '../types';
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Plus, Book as BookIcon, Trash2 } from 'lucide-react';
import ePub from 'epubjs';
import { saveBookFile, deleteBookFile, deleteBookProgress } from '../lib/db';
import { motion } from 'motion/react';

interface LibraryViewProps {
  books: Book[];
  progress: Record<string, BookProgress>;
  onSelectBook: (id: string) => void;
  onBooksChange: (books: Book[]) => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({ 
  books, 
  progress, 
  onSelectBook, 
  onBooksChange 
}) => {
  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    const validTypes = ['application/epub+zip', 'application/pdf', 'text/plain', 'text/markdown'];
    const validExtensions = ['.epub', '.pdf', '.txt', '.md'];
    
    if (file && (validTypes.includes(file.type) || validExtensions.some(ext => file.name.toLowerCase().endsWith(ext)))) {
      await processFile(file);
    }
  }, [books]);

  const onFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await processFile(file);
    }
  }, [books]);

  const processFile = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const fileName = file.name;
    const extension = fileName.split('.').pop()?.toLowerCase();
    
    let title = fileName.replace(/\.[^/.]+$/, "");
    let author = 'Unknown Author';
    let format: 'epub' | 'pdf' | 'txt' | 'md' = 'txt';
    let cover: string | undefined = undefined;

    if (extension === 'epub') {
      format = 'epub';
      try {
        const book = ePub(buffer);
        const metadata = await book.loaded.metadata;
        cover = await book.coverUrl() || undefined;
        title = metadata.title || title;
        author = metadata.creator || author;
      } catch (e) {
        console.error("EPUB metadata extraction failed", e);
      }
    } else if (extension === 'pdf') {
      format = 'pdf';
    } else if (extension === 'md') {
      format = 'md';
    } else {
      format = 'txt';
    }

    const newBook: Book = {
      id: crypto.randomUUID(),
      title,
      author,
      format,
      cover,
      addedAt: Date.now(),
      status: 'ready'
    };

    await saveBookFile(newBook.id, buffer);
    onBooksChange([...books, newBook]);
  };

  const removeBook = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await Promise.all([
      deleteBookFile(id),
      deleteBookProgress(id),
    ]);
    onBooksChange(books.filter(b => b.id !== id));
  };

  return (
    <div className="max-w-6xl mx-auto px-10 py-16">
      <header className="mb-14 flex items-end justify-between border-b border-border pb-10">
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-6 h-6 bg-primary rounded-[4px]" />
            <h1 className="text-xl font-bold tracking-tight uppercase">VoxLib</h1>
          </div>
          <h2 className="text-4xl font-bold tracking-tight mb-2">My Library</h2>
          <p className="text-muted-foreground font-medium text-sm">
            {books.length} journeys available
          </p>
        </div>
        <label className="group flex items-center gap-2 bg-foreground text-background hover:opacity-90 px-6 py-3 rounded-lg cursor-pointer transition-all shadow-sm">
          <Plus className="w-4 h-4" />
          <span className="text-xs font-bold uppercase tracking-wider">Add File</span>
          <input type="file" accept=".epub,.pdf,.txt,.md" className="hidden" onChange={onFileChange} />
        </label>
      </header>

      {books.length === 0 ? (
        <div 
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="aspect-[21/9] border-2 border-dashed border-border rounded-2xl flex flex-col items-center justify-center bg-card hover:border-primary/50 transition-all group cursor-pointer"
          onClick={() => document.querySelector<HTMLInputElement>('input[type="file"]')?.click()}
        >
          <span className="text-4xl mb-4 opacity-20 group-hover:opacity-40 transition-opacity">+</span>
          <p className="text-base font-semibold text-foreground/80">Drop EPUB, PDF, or Text files</p>
          <p className="text-xs text-muted-foreground mt-2 font-bold uppercase tracking-widest">Powered by Gemini AI TTS</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
          {books.map((book) => {
            const bookProg = progress[book.id];
            // Simulate percent based on chapter index if book has metadata about chapters
            // For now we use a heuristic or stored progressPercent if available
            const percent = book.progressPercent || (bookProg ? Math.round(((bookProg.chapterIndex) / 10) * 100) : 0); 
            
            return (
              <motion.div
                key={book.id}
                layout
                whileHover={{ y: -4 }}
                className="group relative"
              >
                <Card 
                  className="bg-card border-border shadow-[0_2px_10px_rgba(0,0,0,0.02)] overflow-hidden cursor-pointer hover:shadow-xl hover:shadow-primary/5 transition-all duration-300"
                  onClick={() => onSelectBook(book.id)}
                >
                  <div className="aspect-[3/4] relative overflow-hidden bg-muted">
                    {book.cover ? (
                      <img 
                        src={book.cover} 
                        alt={book.title} 
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 opacity-90 group-hover:opacity-100"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <BookIcon className="w-12 h-12 opacity-5" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/5 group-hover:bg-transparent transition-colors" />
                  </div>
                  <CardContent className="p-8">
                    <div className="flex justify-between items-start gap-4 mb-2">
                      <h3 className="text-lg font-bold leading-tight line-clamp-2">{book.title}</h3>
                      <button 
                        onClick={(e) => removeBook(book.id, e)}
                        className="opacity-0 group-hover:opacity-30 hover:opacity-100 hover:text-red-600 transition-all p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-xs font-semibold text-muted-foreground mb-4 uppercase tracking-wide">{book.author}</p>
                    
                    <div className="flex items-center gap-2 mb-8">
                       <div className="bg-primary/5 text-primary text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-[4px] border border-primary/10">
                         {book.status || 'Ready'}
                       </div>
                       <span className="text-[10px] text-muted-foreground opacity-50 font-bold uppercase">
                          Added {new Date(book.addedAt).toLocaleDateString()}
                       </span>
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                        <span>Progress</span>
                        <span>{percent}%</span>
                      </div>
                      <Progress value={percent} className="h-[3px] bg-muted overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${percent}%` }} />
                      </Progress>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
};
