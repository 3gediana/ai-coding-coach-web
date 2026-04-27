/**
 * 浏览器 IndexedDB 存储，实现 CoachStorage 接口。
 * 容量大、查询快、零部署。
 */
import { openDB, type IDBPDatabase } from 'idb';
import type {
  CoachEvent,
  CoachStorage,
  Mistake,
  Problem,
  Session,
} from '../core/types';

const DB_NAME = 'ai-coding-coach';
const DB_VERSION = 1;

interface Schema {
  problems: { key: string; value: Problem };
  mistakes: { key: string; value: Mistake };
  sessions: { key: string; value: Session };
  events: { key: number; value: CoachEvent & { _id?: number } };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<Schema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('problems')) {
          db.createObjectStore('problems', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('mistakes')) {
          const m = db.createObjectStore('mistakes', { keyPath: 'id' });
          m.createIndex('createdAt', 'createdAt');
          m.createIndex('problemId', 'problemId');
        }
        if (!db.objectStoreNames.contains('sessions')) {
          const s = db.createObjectStore('sessions', { keyPath: 'id' });
          s.createIndex('startedAt', 'startedAt');
          s.createIndex('problemId', 'problemId');
        }
        if (!db.objectStoreNames.contains('events')) {
          const e = db.createObjectStore('events', { autoIncrement: true });
          e.createIndex('sessionId', 'sessionId');
          e.createIndex('ts', 'ts');
        }
      },
    });
  }
  return dbPromise;
}

export class BrowserStorage implements CoachStorage {
  // ===== Problems =====
  async saveProblem(p: Problem) {
    const db = await getDB();
    await db.put('problems', p);
  }
  async getProblem(id: string) {
    const db = await getDB();
    return db.get('problems', id);
  }
  async listProblems() {
    const db = await getDB();
    const all = await db.getAll('problems');
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }
  async deleteProblem(id: string) {
    const db = await getDB();
    await db.delete('problems', id);
  }

  // ===== Mistakes =====
  async saveMistake(m: Mistake) {
    const db = await getDB();
    await db.put('mistakes', m);
  }
  async getMistake(id: string) {
    const db = await getDB();
    return db.get('mistakes', id);
  }
  async listMistakes() {
    const db = await getDB();
    const all = await db.getAll('mistakes');
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }
  async deleteMistake(id: string) {
    const db = await getDB();
    await db.delete('mistakes', id);
  }

  // ===== Sessions =====
  async saveSession(s: Session) {
    const db = await getDB();
    await db.put('sessions', s);
  }
  async getSession(id: string) {
    const db = await getDB();
    return db.get('sessions', id);
  }
  async listSessions() {
    const db = await getDB();
    const all = await db.getAll('sessions');
    return all.sort((a, b) => b.startedAt - a.startedAt);
  }
  async deleteSession(id: string) {
    const db = await getDB();
    await db.delete('sessions', id);
  }

  // ===== Events =====
  async appendEvent(e: CoachEvent) {
    const db = await getDB();
    await db.add('events', e);
  }
  async listEvents(opts: { sessionId?: string; sinceTs?: number; limit?: number } = {}) {
    const db = await getDB();
    let events: CoachEvent[];
    if (opts.sessionId) {
      events = await db.getAllFromIndex('events', 'sessionId', opts.sessionId);
    } else {
      events = await db.getAll('events');
    }
    events.sort((a, b) => a.ts - b.ts);
    if (opts.sinceTs !== undefined) {
      events = events.filter((e) => e.ts >= opts.sinceTs!);
    }
    if (opts.limit !== undefined) {
      events = events.slice(-opts.limit);
    }
    return events;
  }

  async wipeAll() {
    const db = await getDB();
    const tx = db.transaction(['problems', 'mistakes', 'sessions', 'events'], 'readwrite');
    await Promise.all([
      tx.objectStore('problems').clear(),
      tx.objectStore('mistakes').clear(),
      tx.objectStore('sessions').clear(),
      tx.objectStore('events').clear(),
    ]);
    await tx.done;
  }
}

export const storage = new BrowserStorage();
