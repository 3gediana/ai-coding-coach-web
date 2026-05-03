const LOCAL_SETTINGS_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function getSettingsAccessHost(): string {
  if (typeof window === 'undefined') return 'localhost';
  return window.location.hostname;
}

export function canEditLocalSettings(hostname = getSettingsAccessHost()): boolean {
  return LOCAL_SETTINGS_HOSTS.has(hostname.toLowerCase());
}
