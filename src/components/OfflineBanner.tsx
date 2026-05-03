/**
 * 离线 Banner：当 navigator.onLine=false 或用户开了"飞行模式"时，
 * 顶部出现一条 sticky 提示条，告诉用户当前 AI 走哪条路。
 *
 * - 'online'         → 不渲染
 * - 'offline'        → 黄色：网络确实不可用，正在用本地 FastLane 兜底
 * - 'forced-offline' → 蓝色：用户主动开飞行模式（演示 / 隐私场景），可一键关
 *
 * 行为只读 + 可关闭飞行模式；不主动改其它配置。
 */
import { WifiOff, Plane, X } from 'lucide-react';
import { setForcedOffline, useOnlineStatus } from '../lib/offlineMode';
import { hasUsableAIConfig, useStore } from '../lib/store';

export function OfflineBanner() {
  const status = useOnlineStatus();
  const aiConfig = useStore((s) => s.aiConfig);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);

  if (status === 'online') return null;

  // 真离线：根据是否能 fallback 到本地 fastLane 决定语气
  const cloudPrimary = aiConfig.provider !== 'ollama';
  const fastLaneOk =
    aiConfig.fastLane?.enabled &&
    aiConfig.ollamaMode !== 'disabled' &&
    !!aiConfig.fastLane?.baseUrl?.trim() &&
    !!aiConfig.fastLane?.model?.trim();
  const usable = hasUsableAIConfig(aiConfig);

  if (status === 'forced-offline') {
    return (
      <div className="px-3 py-1.5 text-[12px] flex items-center justify-between gap-2 bg-cyan/10 border-b border-cyan/30 text-ink-dim">
        <span className="flex items-center gap-1.5">
          <Plane size={12} className="text-cyan" />
          <span>
            <strong className="text-cyan">飞行模式</strong>
            <span className="ml-1.5 text-ink-mute">
              已主动禁用云端，所有任务走本地 Ollama
              {!fastLaneOk && '（但 FastLane 没配好，AI 任务可能失败）'}
            </span>
          </span>
        </span>
        <div className="flex items-center gap-2">
          {!fastLaneOk && (
            <button
              onClick={() => setSettingsOpen(true)}
              className="text-[11px] underline hover:text-accent"
            >
              去配 FastLane
            </button>
          )}
          <button
            onClick={() => setForcedOffline(false)}
            className="text-[11px] inline-flex items-center gap-1 hover:text-accent transition px-1.5 py-0.5 rounded border border-cyan/30 hover:border-cyan/60"
            title="关闭飞行模式，恢复云端"
          >
            <X size={10} /> 切回联网
          </button>
        </div>
      </div>
    );
  }

  // status === 'offline'：navigator 检测到真断网
  return (
    <div className="px-3 py-1.5 text-[12px] flex items-center justify-between gap-2 bg-warn/10 border-b border-warn/30 text-ink-dim">
      <span className="flex items-center gap-1.5">
        <WifiOff size={12} className="text-warn" />
        <span>
          <strong className="text-warn">网络已断开</strong>
          {cloudPrimary && fastLaneOk && (
            <span className="ml-1.5 text-ink-mute">
              主云端不可用；AI 任务会自动 fallback 到本地 FastLane
            </span>
          )}
          {cloudPrimary && !fastLaneOk && (
            <span className="ml-1.5 text-ink-mute">
              主云端不可用；当前没配可用的本地 FastLane，AI 任务会失败
            </span>
          )}
          {!cloudPrimary && (
            <span className="ml-1.5 text-ink-mute">
              主模型本就是本地，不受影响（如 baseUrl 指本机 Ollama）
            </span>
          )}
        </span>
      </span>
      {!usable && (
        <button
          onClick={() => setSettingsOpen(true)}
          className="text-[11px] underline hover:text-accent"
        >
          去检查配置
        </button>
      )}
    </div>
  );
}
