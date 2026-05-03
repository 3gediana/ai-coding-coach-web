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
import { safeGetItem, safeSetItem } from './safeLocalStorage';

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
let problemBankImportPromise: Promise<void> | null = null;
const mirroredProblemIds = new Set<string>();
const LS_DELETED_PROBLEMS = 'aicc.deletedProblems.v1';

function readDeletedProblemIds(): Set<string> {
  try {
    const parsed = JSON.parse(safeGetItem(LS_DELETED_PROBLEMS) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function isProblemDeletedLocally(id: string): boolean {
  return readDeletedProblemIds().has(id);
}

export function markProblemDeletedLocally(id: string): void {
  const ids = readDeletedProblemIds();
  ids.add(id);
  safeSetItem(LS_DELETED_PROBLEMS, JSON.stringify([...ids]));
}

export function clearProblemDeletedLocally(id: string): void {
  const ids = readDeletedProblemIds();
  if (!ids.delete(id)) return;
  safeSetItem(LS_DELETED_PROBLEMS, JSON.stringify([...ids]));
}

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

async function deleteProblemFromLocalBank(id: string): Promise<void> {
  try {
    await fetch(`/__problem-bank/problems?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  } catch {
    /* ignore */
  }
}

async function importProblemsFromLocalBank(): Promise<Problem[]> {
  try {
    const res = await fetch('/__problem-bank/problems');
    if (!res.ok) return [];
    const data = await res.json() as { problems?: Problem[] };
    return Array.isArray(data.problems) ? data.problems : [];
  } catch {
    return [];
  }
}

async function ensureLocalProblemBankImported(db: IDBPDatabase<Schema>): Promise<void> {
  if (problemBankImportPromise) {
    await problemBankImportPromise;
    return;
  }
  problemBankImportPromise = (async () => {
    const localProblems = await importProblemsFromLocalBank();
    if (localProblems.length === 0) return;
    const tx = db.transaction('problems', 'readwrite');
    for (const p of localProblems) {
      if (isProblemDeletedLocally(p.id)) continue;
      const existing = await tx.store.get(p.id);
      if (!existing) {
        await tx.store.put(p);
      }
    }
    await tx.done;
  })();
  try {
    await problemBankImportPromise;
  } finally {
    problemBankImportPromise = null;
  }
}

export class BrowserStorage implements CoachStorage {
  // ===== Problems =====
  async saveProblem(p: Problem) {
    clearProblemDeletedLocally(p.id);
    const db = await getDB();
    await db.put('problems', p);
  }
  async getProblem(id: string) {
    const db = await getDB();
    return db.get('problems', id);
  }
  async listProblems() {
    const db = await getDB();
    await ensureLocalProblemBankImported(db);
    const all = await db.getAll('problems');
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }
  async deleteProblem(id: string) {
    markProblemDeletedLocally(id);
    const db = await getDB();
    await db.delete('problems', id);
    mirroredProblemIds.delete(id);
    await deleteProblemFromLocalBank(id);
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
  async deleteEventsByProblem(problemId: string) {
    const db = await getDB();
    const tx = db.transaction('events', 'readwrite');
    const store = tx.objectStore('events');
    const [keys, events] = await Promise.all([store.getAllKeys(), store.getAll()]);
    await Promise.all(
      events.map((event, idx) =>
        event.problemId === problemId ? store.delete(keys[idx]) : Promise.resolve(),
      ),
    );
    await tx.done;
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
    safeSetItem(LS_DELETED_PROBLEMS, '[]');
    mirroredProblemIds.clear();
  }
}

export const storage = new BrowserStorage();
