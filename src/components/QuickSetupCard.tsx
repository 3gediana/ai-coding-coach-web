/**
 * 首次启动卡片 (Quick Setup)：用户没配 AI 时浮在编辑器区中央。
 *
 * 设计哲学：
 * - 让"主体"最简：只需要 1 个 API Key 就能开始用
 * - 比 SettingsModal 更聚焦：3 个 chip + 1 个 input + 1 个按钮
 * - 复杂配置（base URL / 模型 / 高级）一律走 SettingsModal
 *
 * 用 deepseek 作为默认 provider（最便宜、对中文友好）。
 */
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, ExternalLink, Check, Loader2, Settings2, AlertCircle } from 'lucide-react';
import { useStore } from '../lib/store';
import { PRESETS } from '../lib/presets';
import type { AIConfig, AIProvider } from '../core/types';
import { AIClient } from '../core/ai/client';
import { toast } from 'sonner';
import { cn } from '../lib/cn';

const QUICK_SETUP_PROVIDERS: AIProvider[] = ['deepseek', 'minimax', 'openai'];

export function QuickSetupCard() {
  const cfg = useStore((s) => s.aiConfig);
  const setCfg = useStore((s) => s.setAIConfig);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const settingsOpen = useStore((s) => s.settingsOpen);

  // 只在还没配置 + Settings 没打开时显示（避免和 SettingsModal 同时存在）
  const usable =
    cfg.provider === 'ollama'
      ? cfg.ollamaMode !== 'disabled' && !!cfg.baseUrl?.trim()
      : !!cfg.apiKey?.trim();

  // 用户「先不填，关掉看看」的本会话隐藏标记
  const [dismissed, setDismissed] = useState(false);

  // 默认 provider 取 cfg 当前值（如果是常用三家），否则 fallback deepseek
  const [provider, setProvider] = useState<AIProvider>(() =>
    QUICK_SETUP_PROVIDERS.includes(cfg.provider) ? cfg.provider : 'deepseek',
  );
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // cfg 变了（比如 SettingsModal 保存）就同步 provider 选中
  useEffect(() => {
    if (QUICK_SETUP_PROVIDERS.includes(cfg.provider)) {
      setProvider(cfg.provider);
    }
  }, [cfg.provider]);

  if (usable || settingsOpen || dismissed) return null;

  const preset = PRESETS.find((p) => p.id === provider)!;

  const onConnect = async () => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      setError('请填 API Key');
      return;
    }
    setTesting(true);
    setError(null);
    const draft: AIConfig = {
      ...cfg,
      provider,
      baseUrl: preset.baseUrl,
      apiKey: trimmedKey,
      model: preset.defaultModel,
    };
    try {
      const client = new AIClient(draft);
      await client.chat({
        messages: [
          { role: 'system', content: 'reply with single word: OK' },
          { role: 'user', content: 'ping' },
        ],
        maxTokens: 10,
        timeoutMs: 30_000,
        maxRetries: 0,
      });
      setCfg(draft);
      toast.success('AI 配置已保存', { description: '可以开始做题了' });
    } catch (e: any) {
      setError(String(e?.message || e).slice(0, 240));
    } finally {
      setTesting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="absolute inset-0 z-20 flex items-center justify-center bg-bg/70 backdrop-blur-sm"
    >
      <motion.div
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.25, delay: 0.05 }}
        className="glass-card max-w-md w-full mx-6 p-6 space-y-4"
      >
        <div className="flex items-start gap-2">
          <Sparkles size={20} className="text-accent shrink-0 mt-0.5" />
          <div className="flex-1">
            <h2 className="text-base font-semibold mb-1">配置 AI，开始用</h2>
            <p className="text-[12px] text-ink-mute leading-relaxed">
              填一个 API Key 就够了。所有数据保存在浏览器，不上传任何服务器。
            </p>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="text-ink-mute hover:text-ink text-[11px]"
            title="先不填，本次会话隐藏（顶栏 ⚙️ 仍可打开）"
          >
            先不
          </button>
        </div>

        {/* Provider chips（只展示 3 家最常用 + 「更多」打开 SettingsModal） */}
        <div className="space-y-1.5">
          <div className="text-[11px] text-ink-mute">服务商</div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_SETUP_PROVIDERS.map((id) => {
              const p = PRESETS.find((x) => x.id === id)!;
              return (
                <button
                  key={id}
                  onClick={() => {
                    setProvider(id);
                    setError(null);
                  }}
                  className={cn(
                    'chip cursor-pointer hover:border-accent/60 transition',
                    provider === id && 'chip-accent',
                  )}
                >
                  {p.label}
                </button>
              );
            })}
            <button
              onClick={() => setSettingsOpen(true)}
              className="chip text-ink-mute hover:text-ink hover:border-line cursor-pointer"
              title="Anthropic / Google / 通义 / 智谱 / Kimi / Ollama / 自定义"
            >
              更多…
            </button>
          </div>
          {preset.hint && (
            <p className="text-[10px] text-ink-mute leading-snug">{preset.hint}</p>
          )}
        </div>

        {/* API Key */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="label !mb-0">API Key</span>
            {preset.apiKeyPage && (
              <a
                href={preset.apiKeyPage}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-accent-glow hover:underline inline-flex items-center gap-0.5"
              >
                去申请 <ExternalLink size={10} />
              </a>
            )}
          </div>
          <input
            className="input font-mono text-xs"
            type="password"
            placeholder="sk-..."
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && apiKey.trim() && !testing) {
                void onConnect();
              }
            }}
            autoFocus
            autoComplete="off"
          />
        </div>

        {/* 默认模型只展示一行，要改去 SettingsModal */}
        <div className="text-[11px] text-ink-mute flex items-center gap-1.5">
          <span>
            默认模型 <strong className="font-mono text-ink">{preset.defaultModel}</strong>
          </span>
          <button
            onClick={() => setSettingsOpen(true)}
            className="ml-auto text-accent-glow hover:underline inline-flex items-center gap-0.5"
            type="button"
          >
            <Settings2 size={10} /> 高级配置
          </button>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="rounded p-2 text-[11px] bg-bad/10 border border-bad/30 text-bad flex items-start gap-2">
            <AlertCircle size={12} className="shrink-0 mt-0.5" />
            <span className="font-mono break-all">{error}</span>
          </div>
        )}

        {/* 主按钮 */}
        <button
          onClick={onConnect}
          disabled={testing || !apiKey.trim()}
          className="btn-primary w-full"
        >
          {testing ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Check size={14} />
          )}
          {testing ? '测试中…' : '连接并开始使用'}
        </button>
      </motion.div>
    </motion.div>
  );
}
