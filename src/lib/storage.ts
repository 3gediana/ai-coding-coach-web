/**
 * 浏览器 IndexedDB 存储，实现 CoachStorage 接口。
 * 容量大、查询快、零部署。
 */
import { openDB, type IDBPDatabase } from 'idb';
import type {
  CodeFile,
  CoachEvent,
  CoachStorage,
  Mistake,
  Problem,
  Session,
} from '../core/types';

const DB_NAME = 'ai-coding-coach';
const DB_VERSION = 2; // v2: 加 files store

interface Schema {
  problems: { key: string; value: Problem };
  mistakes: { key: string; value: Mistake };
  sessions: { key: string; value: Session };
  events: { key: number; value: CoachEvent & { _id?: number } };
  files: { key: string; value: CodeFile };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<Schema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
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
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains('files')) {
            const f = db.createObjectStore('files', { keyPath: 'id' });
            f.createIndex('problemId', 'problemId');
            f.createIndex('updatedAt', 'updatedAt');
          }
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

  // ===== Files =====
  async saveFile(f: CodeFile) {
    const db = await getDB();
    await db.put('files', f);
  }
  async getFile(id: string) {
    const db = await getDB();
    return db.get('files', id);
  }
  async listFiles(opts: { problemId?: string | null } = {}) {
    const db = await getDB();
    let files: CodeFile[];
    if (opts.problemId !== undefined) {
      // problemId 可能是 null（草稿），IndexedDB 的索引不能查 null，要全表过滤
      const all = await db.getAll('files');
      files = all.filter((f) => f.problemId === opts.problemId);
    } else {
      files = await db.getAll('files');
    }
    return files.sort((a, b) => {
      // pinned 优先，然后 updatedAt 倒序
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
  }
  async deleteFile(id: string) {
    const db = await getDB();
    await db.delete('files', id);
  }

  async wipeAll() {
    const db = await getDB();
    const tx = db.transaction(
      ['problems', 'mistakes', 'sessions', 'events', 'files'],
      'readwrite',
    );
    await Promise.all([
      tx.objectStore('problems').clear(),
      tx.objectStore('mistakes').clear(),
      tx.objectStore('sessions').clear(),
      tx.objectStore('events').clear(),
      tx.objectStore('files').clear(),
    ]);
    await tx.done;
  }
}

export const storage = new BrowserStorage();
