import type { AIConfig } from '../core/types';
import { isLocalOllamaUrl } from './ollama';
import { resolveFastLaneModel } from './modelRegistry';
import { isEffectivelyOffline } from './offlineMode';

export const OFFLINE_DISABLED_MESSAGE = '离线模式下不可用：该功能需要云端强模型或长上下文。';

export type OfflineCapability =
  | 'ask'
  | 'analyze'
  | 'plain-explanation'
  | 'problem-overview'
  | 'summarize'
  | 'ac-review'
  | 'diff'
  | 'daily-plan'
  | 'algoviz-generate'
  | 'algoviz-detect'
  | 'hack-case'
  | 'hack-chain'
  | 'parse-problem'
  | 'feynman';

const OFFLINE_ALLOWED = new Set<OfflineCapability>([
  'ask',
  'analyze',
  'plain-explanation',
  'problem-overview',
  'summarize',
  'ac-review',
  'algoviz-detect',
  'hack-case',
  'parse-problem',
]);

export function isCloudAiConfig(cfg: Pick<AIConfig, 'provider' | 'baseUrl'>): boolean {
  return cfg.provider !== 'ollama' || !isLocalOllamaUrl(cfg.baseUrl);
}

export function getLocalFastLaneTarget(cfg: AIConfig): { baseUrl: string; model: string } | null {
  if (cfg.ollamaMode === 'disabled') return null;
  const target = resolveFastLaneModel(cfg);
  if (!target?.baseUrl?.trim() || !target.model?.trim()) return null;
  if (!isLocalOllamaUrl(target.baseUrl)) return null;
  return { baseUrl: target.baseUrl.trim(), model: target.model.trim() };
}

export function hasLocalFastLaneTarget(cfg: AIConfig): boolean {
  return !!getLocalFastLaneTarget(cfg);
}

export function isOfflineCapabilityAllowed(capability: OfflineCapability): boolean {
  return OFFLINE_ALLOWED.has(capability);
}

export function shouldBlockForOffline(capability: OfflineCapability): boolean {
  return isEffectivelyOffline() && !isOfflineCapabilityAllowed(capability);
}

export function offlineBlockReason(capability: OfflineCapability): string | null {
  return shouldBlockForOffline(capability) ? OFFLINE_DISABLED_MESSAGE : null;
}
