const ENDPOINT = '/__aicc-local-settings';
const MANIFEST_KEY = 'aicc.fileBackedKeys.v1';

type LocalSettingsResponse = {
  ok?: boolean;
  exists?: boolean;
  entries?: Record<string, string>;
};

type LocalSettingsManifest = {
  keys?: unknown;
};

function canUseFileBackedSettings(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  const host = window.location.hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

function parseManifest(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function normalizeEntries(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key === 'string' && typeof val === 'string') out[key] = val;
  }
  return out;
}

function readKnownFileBackedKeysFromManifest(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as LocalSettingsManifest;
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.keys)) {
      return parsed.keys.filter((x): x is string => typeof x === 'string');
    }
  } catch {
  }
  return [];
}

export async function bootstrapFileBackedLocalStorage(): Promise<void> {
  if (!canUseFileBackedSettings()) return;
  try {
    const res = await fetch(ENDPOINT, { method: 'GET', headers: { accept: 'application/json' } });
    if (!res.ok) return;
    const payload = (await res.json()) as LocalSettingsResponse;
    if (!payload.ok) return;
    const entries = normalizeEntries(payload.entries);
    const keys = Object.keys(entries);
    const previousKeys = new Set([
      ...parseManifest(window.localStorage.getItem(MANIFEST_KEY)),
      ...readKnownFileBackedKeysFromManifest(res.headers.get('x-aicc-local-settings-manifest')),
    ]);
    for (const key of previousKeys) {
      if (!(key in entries)) window.localStorage.removeItem(key);
    }
    for (const [key, value] of Object.entries(entries)) {
      window.localStorage.setItem(key, value);
    }
    window.localStorage.setItem(MANIFEST_KEY, JSON.stringify(keys));
  } catch {
    return;
  }
}

let pendingWrite: Promise<void> = Promise.resolve();

function enqueue(payload: { entries?: Record<string, string>; remove?: string[] }): void {
  if (!canUseFileBackedSettings()) return;
  pendingWrite = pendingWrite
    .catch(() => undefined)
    .then(async () => {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`local settings sync failed: ${res.status}`);
      const raw = window.localStorage.getItem(MANIFEST_KEY);
      const keys = new Set(parseManifest(raw));
      for (const key of Object.keys(payload.entries ?? {})) keys.add(key);
      for (const key of payload.remove ?? []) keys.delete(key);
      window.localStorage.setItem(MANIFEST_KEY, JSON.stringify([...keys]));
    });
}

export function queueLocalSettingWrite(key: string, value: string): void {
  enqueue({ entries: { [key]: value } });
}

export function queueLocalSettingRemove(key: string): void {
  enqueue({ remove: [key] });
}
