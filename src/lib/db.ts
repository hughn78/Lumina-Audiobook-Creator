import { openDB, IDBPDatabase } from 'idb';
import { BookProgress } from '../types';

const DB_NAME = 'lumina-books';
const BOOKS_STORE = 'books-data';
const PROGRESS_STORE = 'progress';

async function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(BOOKS_STORE)) {
        db.createObjectStore(BOOKS_STORE);
      }
      if (!db.objectStoreNames.contains(PROGRESS_STORE)) {
        db.createObjectStore(PROGRESS_STORE, { keyPath: 'bookId' });
      }
    },
  });
}

export async function saveBookFile(id: string, file: ArrayBuffer) {
  const db = await getDB();
  await db.put(BOOKS_STORE, file, id);
}

export async function getBookFile(id: string): Promise<ArrayBuffer | undefined> {
  const db = await getDB();
  return db.get(BOOKS_STORE, id);
}

export async function deleteBookFile(id: string) {
  const db = await getDB();
  await db.delete(BOOKS_STORE, id);
}

export async function deleteBookProgress(bookId: string) {
  const db = await getDB();
  await db.delete(PROGRESS_STORE, bookId);
}

export async function saveBookProgress(progress: BookProgress) {
  const db = await getDB();
  await db.put(PROGRESS_STORE, progress);
}

export async function getBookProgress(bookId: string): Promise<BookProgress | undefined> {
  const db = await getDB();
  return db.get(PROGRESS_STORE, bookId);
}

export async function getAllProgress(): Promise<BookProgress[]> {
  const db = await getDB();
  return db.getAll(PROGRESS_STORE);
}
