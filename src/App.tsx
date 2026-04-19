/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { Book, BookProgress } from "./types";
import { getAllProgress } from "./lib/db";
import { LibraryView } from "./components/LibraryView";
import { PlayerView } from "./components/PlayerView";
import { motion, AnimatePresence } from "motion/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { loadBooksMetadata, saveBooksMetadata } from "./lib/storage";

export default function App() {
  const [currentBookId, setCurrentBookId] = useState<string | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [progress, setProgress] = useState<Record<string, BookProgress>>({});

  useEffect(() => {
    setBooks(loadBooksMetadata());

    // Load progress from DB
    getAllProgress().then((records) => {
      const progMap: Record<string, BookProgress> = {};
      records.forEach((r) => (progMap[r.bookId] = r));
      setProgress(progMap);
    });
  }, []);

  const saveBooks = (updatedBooks: Book[]) => {
    setBooks(updatedBooks);
    saveBooksMetadata(updatedBooks);
  };

  const handleSelectBook = (id: string) => {
    setCurrentBookId(id);
  };

  const handleBackToLibrary = () => {
    setCurrentBookId(null);
    // Refresh progress on return
    getAllProgress().then((records) => {
      const progMap: Record<string, BookProgress> = {};
      records.forEach((r) => (progMap[r.bookId] = r));
      setProgress(progMap);
    });
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-[#0a0502] text-white selection:bg-orange-500/30">
        <AnimatePresence mode="wait">
          {!currentBookId ? (
            <motion.div
              key="library"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4 }}
            >
              <LibraryView
                books={books}
                progress={progress}
                onSelectBook={handleSelectBook}
                onBooksChange={saveBooks}
              />
            </motion.div>
          ) : (
            <motion.div
              key="player"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="h-screen w-full"
            >
              <PlayerView
                bookId={currentBookId}
                onBack={handleBackToLibrary}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </TooltipProvider>
  );
}
