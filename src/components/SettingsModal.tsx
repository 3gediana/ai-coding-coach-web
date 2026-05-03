import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../lib/store';
import { PRESETS, DEFAULT_AI_CONFIG, RECOMMENDED_OLLAMA_MODELS } from '../lib/presets';
import type { AIConfig, AIProvider } from '../core/types';
import { cn } from '../lib/cn';
import { fetchOllamaModels, formatModelSize, isLocalOllamaUrl } from '../lib/ollama';
import {
  X,
  Eye,
  EyeOff,
  ExternalLink,
  Check,
  Loader2,
  Sparkles,
  Zap,
  Settings2,
  Lightbulb,
  Copy,
  RefreshCw,
  Download,
  AlertTriangle,
  Bug,
  Compass,
  Ruler,
  ChevronDown,
  Cpu,
  PowerOff,
  Image,
  Activity,
  ScanLine,
  Palette,
  FileText,
  FolderTree,
  Plane,
  WifiOff,
} from 'lucide-react';
import { AIClient } from '../core/ai/client';
import { toast } from 'sonner';
import { DEFAULT_ROUTER_HINTS } from '../core/ai/router';
import { ModelRegistrySection, ModelPicker } from './ModelRegistry';
import { resolveFastLaneModel, resolvePrimaryModel } from '../lib/modelRegistry';
import {
  estimateCoachHistoryRounds,
  formatTokenWindow,
  inferModelContextWindowTokens,
} from '../core/coach/contextBudget';
import { collectLocalOllamaTargets, getLocalOllamaTargetConflict } from '../core/ai/warmup';
import { applyTheme, getStoredTheme, THEMES, type Theme } from '../lib/theme';
import { setForcedOffline, useOnlineStatus } from '../lib/offlineMode';

export function SettingsModal() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const cfg = useStore((s) => s.aiConfig);
  const setCfg = useStore((s) => s.setAIConfig);
  const stuckHintEnabled = useStore((s) => s.stuckHintEnabled);
  const setStuckHintEnabled = useStore((s) => s.setStuckHintEnabled);
  const diagnoseOnFailEnabled = useStore((s) => s.diagnoseOnFailEnabled);
  const setDiagnoseOnFailEnabled = useStore((s) => s.setDiagnoseOnFailEnabled);
  const constraintSanityEnabled = useStore((s) => s.constraintSanityEnabled);
  const setConstraintSanityEnabled = useStore((s) => s.setConstraintSanityEnabled);
  const intentSniffEnabled = useStore((s) => s.intentSniffEnabled);
  const setIntentSniffEnabled = useStore((s) => s.setIntentSniffEnabled);
  const multiFileMode = useStore((s) => s.multiFileMode);
  const setMultiFileMode = useStore((s) => s.setMultiFileMode);
  const onlineStatus = useOnlineStatus();

  const [draft, setDraft] = useState<AIConfig>(cfg);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [currentTheme, setCurrentTheme] = useState<Theme>(getStoredTheme());

  const fastLaneModel = resolveFastLaneModel(draft);
  const localOllamaTargets = collectLocalOllamaTargets(draft);
  const localOllamaConflicts = getLocalOllamaTargetConflict(draft);

  /** fastLane 是否就绪：enabled + 本地 baseUrl + model + Ollama 模式打开 */
  const fastLaneReady = !!(
    draft.ollamaMode !== 'disabled' &&
    fastLaneModel?.baseUrl.trim() &&
    fastLaneModel?.model.trim() &&
    isLocalOllamaUrl(fastLaneModel.baseUrl)
  );
  const ollamaEnabled = draft.ollamaMode !== 'disabled';
  const offlineFastUsable =
    ollamaEnabled &&
    !!fastLaneModel?.baseUrl &&
    !!fastLaneModel?.model;
  const forcedOffline = onlineStatus === 'forced-offline';

  const onPickTheme = (theme: Theme) => {
    applyTheme(theme);
    setCurrentTheme(theme);
  };

  const onToggleMultiFileMode = (next: boolean) => {
    setMultiFileMode(next);
    toast.message(next ? '已切到多文件模式 · 文件树已显示' : '已切到单文件模式 · 文件树已隐藏', {
      description: next
        ? 'AI 分析会考虑多文件耦合（头文件 / include / 跨文件引用）'
        : '只编辑当前一个文件，界面更专注',
    });
  };

  const onToggleForcedOffline = () => {
    if (forcedOffline) {
      setForcedOffline(false);
      toast.success('已退出飞行模式');
      return;
    }
    if (!ollamaEnabled) {
      toast.warning('当前为「无 Ollama 模式」', {
        description: '飞行模式需要本地 Ollama；可在设置顶部打开 Ollama 模式',
      });
      return;
    }
    if (!offlineFastUsable) {
      toast.warning('飞行模式需要先配本地 FastLane (Ollama)');
      return;
    }
    setForcedOffline(true);
    toast.success('已进入飞行模式 · AI 全部走本地');
  };

  /**
   * 智能识别 apiKey 前缀，提示用户是否要切到对应 provider。
   * 只识别**前缀有歧义**的厂商，sk- 这种通用前缀不识别（DeepSeek/OpenAI/Qwen/Moonshot 都用）。
   * 返回 null 表示「不识别」或「已经是这个 provider」。
   */
  const pasteSuggestion = (() => {
    const k = draft.apiKey?.trim() ?? '';
    if (!k || k.length < 8) return null;
    let detected: AIProvider | null = null;
    if (k.startsWith('sk-ant-')) detected = 'anthropic';
    else if (k.startsWith('sk-or-')) detected = 'custom'; // OpenRouter
    else if (k.startsWith('AIza')) detected = 'google';
    if (!detected || detected === draft.provider) return null;
    const p = PRESETS.find((x) => x.id === detected);
    return p ? { provider: detected, label: p.label } : null;
  })();

  useEffect(() => {
    if (open) {
      setDraft(cfg);
      setTestResult(null);
      setCurrentTheme(getStoredTheme());
    }
  }, [open, cfg]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const onApplyPreset = (id: AIProvider) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setDraft({
      ...draft,
      provider: id,
      baseUrl: p.baseUrl,
      model: p.defaultModel || draft.model,
      contextWindowTokens:
        p.modelContextTokens?.[p.defaultModel] ??
        p.defaultContextWindowTokens ??
        inferModelContextWindowTokens(id, p.defaultModel),
    });
  };

  /**
   * 保存并测试合一：先做合法性校验 → 跑一次 ping → 通过则 setCfg + 关闭 modal；
   * 失败则原地展示红条，不关闭，让用户改完再点。
   *
   * 这是「主体」最关键的操作：用户填一个 apikey 点一下 → 立刻知道行不行。
   */
  const onSaveAndTest = async () => {
    // 校验"实际生效的主模型"——若分配了 primaryModelId 就走 registry，否则走顶层字段
    const primary = resolvePrimaryModel(draft);
    if (localOllamaConflicts.length > 1) {
      setTestResult({
        ok: false,
        msg:
          '本地 Ollama 只能配置一个模型。请让所有本地工位使用同一个模型：\n' +
          localOllamaConflicts.map((t) => `- ${t.label}: ${t.model} @ ${t.baseUrl}`).join('\n'),
      });
      return;
    }
    if (!primary.baseUrl.trim()) {
      setTestResult({ ok: false, msg: 'Base URL 不能为空（请到注册表登记或填写下方字段）' });
      return;
    }
    if (draft.ollamaMode === 'disabled' && primary.provider === 'ollama') {
      setTestResult({
        ok: false,
        msg: '当前是「无 Ollama 模式」，主 AI 服务不能选择 Ollama。请切到 DeepSeek / OpenAI 兼容云端，或打开 Ollama 模式。',
      });
      return;
    }
    if (!primary.model.trim()) {
      setTestResult({ ok: false, msg: 'Model 不能为空' });
      return;
    }
    if (draft.ollamaMode !== 'disabled' && draft.fastLane?.enabled) {
      // FastLane 也支持注册制：modelId 优先，否则看 fastLane 自身字段
      const flEntry = draft.fastLane.modelId
        ? draft.modelRegistry?.find((m) => m.id === draft.fastLane!.modelId)
        : null;
      const flBase = flEntry?.baseUrl ?? draft.fastLane.baseUrl;
      const flModel = flEntry?.model ?? draft.fastLane.model;
      if (!flBase?.trim()) {
        setTestResult({ ok: false, msg: 'FastLane Base URL 不能为空（在「高级」里填或注册一个本地模型）' });
        return;
      }
      if (!flModel?.trim()) {
        setTestResult({ ok: false, msg: 'FastLane 模型不能为空（在「高级」里填或注册一个本地模型）' });
        return;
      }
    }
    setTesting(true);
    setTestResult(null);
    setCfg(draft);
    toast.success(localOllamaTargets.length > 0 ? 'AI 配置已保存，正在预热本地模型' : 'AI 配置已保存', {
      description:
        localOllamaTargets.length > 0
          ? `本地模型：${localOllamaTargets[0].model}。请稍等，预热完成后会占用显存。`
          : '连接测试将在后台继续执行。',
    });
    // primary 是本地 Ollama → 跳过 ping，避免和 warmup 并发把按钮卡 30s；warmup 自身会 toast 成功/失败
    const primaryIsLocalOllama =
      primary.provider === 'ollama' && isLocalOllamaUrl(primary.baseUrl);
    if (primaryIsLocalOllama) {
      setTestResult({
        ok: true,
        msg: '配置已保存。本地 Ollama 主模型不再前台 ping，预热结果会以 toast 形式反馈。',
      });
      setTesting(false);
      setTimeout(() => setOpen(false), 600);
      return;
    }
    const shouldTestPrimary = !!primary.apiKey.trim();
    if (!shouldTestPrimary) {
      setTestResult({
        ok: true,
        msg: '配置已保存。主云端模型尚未填写 API Key，云端任务会继续显示未配置；本地 Ollama 工位会按配置预热/工作。',
      });
      setTesting(false);
      setTimeout(() => setOpen(false), 600);
      return;
    }
    // 用解析后的 primary 字段拼一个临时 AIConfig 给 AIClient
    const resolvedDraft: AIConfig = {
      ...draft,
      provider: primary.provider,
      baseUrl: primary.baseUrl,
      apiKey: primary.apiKey,
      model: primary.model,
      numCtx: primary.numCtx ?? draft.numCtx,
    };
    const client = new AIClient(resolvedDraft);
    try {
      const text = await client.chat({
        messages: [
          { role: 'system', content: 'reply with single word: OK' },
          { role: 'user', content: 'ping' },
        ],
        maxTokens: 10,
        timeoutMs: 30_000,
        maxRetries: 0,
      });
      setTestResult({ ok: true, msg: `成功：${text.trim().slice(0, 60) || '(空响应)'}` });
      toast.success('主模型连接测试通过', { description: '配置已保存，可以开始用了' });
      // 留 600ms 让用户看到绿条，再关闭
      setTimeout(() => setOpen(false), 600);
    } catch (e: any) {
      setTestResult({ ok: false, msg: String(e?.message || e).slice(0, 200) });
      toast.warning('配置已保存，但主模型连接测试失败', {
        description: '本地模型预热不依赖云端主模型测试；如需云端任务，请回到设置检查主模型。',
      });
    } finally {
      setTesting(false);
    }
  };

  const currentPreset = PRESETS.find((p) => p.id === draft.provider);
  const previewPrimary = resolvePrimaryModel(draft);
  const previewContextWindow =
    previewPrimary.contextWindowTokens ??
    draft.contextWindowTokens ??
    inferModelContextWindowTokens(previewPrimary.provider, previewPrimary.model);
  const estimatedCoachRounds = estimateCoachHistoryRounds(previewContextWindow);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 modal-overlay flex items-center justify-center p-6"
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-card w-full max-w-2xl max-h-[90vh] flex flex-col"
          >
            <div className="px-6 py-4 border-b border-line flex items-center gap-3">
              <Sparkles size={18} className="text-accent" />
              <h2 className="text-lg font-semibold">设置</h2>
              <button onClick={() => setOpen(false)} className="btn-ghost ml-auto p-1.5">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
              <div className="rounded-lg border border-line bg-bg-elev2/40 p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-1.5">
                    <Settings2 size={14} className="text-accent" />
                    界面与演示
                  </h3>
                  <p className="text-[11px] text-ink-mute mt-1">
                    低频入口已从顶栏收进这里，顶栏只保留运行、问教练、题目和设置。
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="text-[11px] text-ink-mute font-semibold flex items-center gap-1.5">
                    <Palette size={12} />
                    主题
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {THEMES.map((theme) => (
                      <button
                        key={theme.id}
                        type="button"
                        onClick={() => onPickTheme(theme.id)}
                        className={cn(
                          'rounded-lg border px-3 py-2 text-left transition hover:border-accent/50 hover:bg-accent/5',
                          currentTheme === theme.id
                            ? 'border-accent/60 bg-accent/10 text-accent'
                            : 'border-line bg-bg text-ink',
                        )}
                      >
                        <div className="flex items-center gap-1.5 text-[12px] font-semibold">
                          <span className="truncate">{theme.label}</span>
                          {currentTheme === theme.id && <Check size={11} className="shrink-0" />}
                        </div>
                        <div className="text-[10px] text-ink-mute mt-0.5 leading-snug">{theme.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => onToggleMultiFileMode(!multiFileMode)}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-left transition hover:border-cyan/50 hover:bg-cyan/5',
                      multiFileMode
                        ? 'border-cyan/60 bg-cyan/10 text-cyan'
                        : 'border-line bg-bg text-ink',
                    )}
                  >
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      {multiFileMode ? <FolderTree size={14} /> : <FileText size={14} />}
                      {multiFileMode ? '多文件模式' : '单文件模式'}
                      <span className="ml-auto chip text-[9px] px-1.5 py-0">
                        {multiFileMode ? '已开启' : '已关闭'}
                      </span>
                    </div>
                    <p className="text-[11px] text-ink-mute mt-1 leading-relaxed">
                      {multiFileMode
                        ? '文件树显示，AI 会考虑跨文件引用。'
                        : '文件树隐藏，只编辑当前文件，界面更专注。'}
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={onToggleForcedOffline}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-left transition hover:border-warn/50 hover:bg-warn/5',
                      forcedOffline
                        ? 'border-warn/60 bg-warn/10 text-warn'
                        : 'border-line bg-bg text-ink',
                    )}
                  >
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      {forcedOffline ? <Plane size={14} /> : onlineStatus === 'offline' ? <WifiOff size={14} /> : <Plane size={14} />}
                      飞行模式
                      <span className="ml-auto chip text-[9px] px-1.5 py-0">
                        {forcedOffline ? '已开启' : onlineStatus === 'offline' ? '真离线' : '已关闭'}
                      </span>
                    </div>
                    <p className="text-[11px] text-ink-mute mt-1 leading-relaxed">
                      手动模拟拔网线。需要本地 FastLane 可用，开启后 AI 强制走本地。
                    </p>
                    {offlineFastUsable && (
                      <div className="text-[10px] text-ok mt-1">⚡ Local FastLane 已就绪</div>
                    )}
                  </button>
                </div>
              </div>

              <OllamaModeSwitch
                mode={draft.ollamaMode ?? 'enabled'}
                onChange={(m) => setDraft({ ...draft, ollamaMode: m })}
              />

              {ollamaEnabled && (
                <div
                  className={cn(
                    'rounded-lg border px-3 py-2 text-[11px] leading-relaxed',
                    localOllamaConflicts.length > 1
                      ? 'border-bad/50 bg-bad/10 text-bad'
                      : localOllamaTargets.length > 0
                        ? 'border-ok/40 bg-ok/10 text-ok'
                        : 'border-line/60 bg-bg-elev/40 text-ink-mute',
                  )}
                >
                  <div className="font-semibold text-ink mb-0.5">本地 Ollama 预热状态</div>
                  {localOllamaConflicts.length > 1 ? (
                    <>
                      <div>只能配置一个本地模型；请把所有本地工位改成同一个模型：</div>
                      <div className="font-mono whitespace-pre-wrap mt-1">
                        {localOllamaConflicts.map((t) => `${t.label}: ${t.model} @ ${t.baseUrl}`).join('\n')}
                      </div>
                    </>
                  ) : localOllamaTargets.length > 0 ? (
                    <div>
                      保存后会立即预热：<strong>{localOllamaTargets[0].model}</strong>
                      <span className="text-ink-mute">（{localOllamaTargets.map((t) => t.label).join(' / ')} 共用）</span>
                    </div>
                  ) : (
                    <div>当前没有任何工位使用本地 Ollama；不会占用显存。</div>
                  )}
                </div>
              )}

              {/* 模型注册表：先注册好模型，再分配给各 Agent slot */}
              <ModelRegistrySection config={draft} onChange={setDraft} />

              {/* 主模型分配：从注册表里挑一个；选了之后下面的预设/key/model 就被注册表覆盖 */}
              <div>
                <div className="label">主模型（默认走云端的所有任务）</div>
                <ModelPicker
                  value={draft.primaryModelId}
                  onChange={(id) => setDraft({ ...draft, primaryModelId: id })}
                  config={draft}
                  placeholder="— 未分配 / 用下方手填字段 —"
                />
                <p className="text-[11px] text-ink-mute mt-1">
                  分配后，下面的 <strong>预设 / API Key / 模型</strong> 字段被注册表条目覆盖；想改连接信息请回到上面
                  <strong>「模型注册表」</strong>编辑该条目。
                </p>
              </div>

              {/* Preset chips（仅在未分配主模型时显示） */}
              {!draft.primaryModelId && (
              <div>
                <div className="label">快速预设（点击填充，仍可改）</div>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => onApplyPreset(p.id)}
                      className={cn(
                        'chip cursor-pointer hover:border-accent/60',
                        draft.provider === p.id && 'chip-accent',
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {currentPreset?.hint && (
                  <p className="text-[11px] text-ink-mute mt-1.5">{currentPreset.hint}</p>
                )}
              </div>
              )}

              {/* API Key（仅在未分配主模型时显示） */}
              {!draft.primaryModelId && (
              <Field
                label="API Key"
                hint={
                  currentPreset?.apiKeyPage ? (
                    <a
                      href={currentPreset.apiKeyPage}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent-glow hover:underline inline-flex items-center gap-1"
                    >
                      去申请
                      <ExternalLink size={10} />
                    </a>
                  ) : (
                    '保存在浏览器 localStorage'
                  )
                }
              >
                <div className="relative">
                  <input
                    className="input pr-9 font-mono text-xs"
                    type={showKey ? 'text' : 'password'}
                    placeholder="sk-..."
                    value={draft.apiKey}
                    onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-mute hover:text-ink"
                  >
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {/* 智能粘贴提示：sk-ant- / sk-or- / AIza 前缀检测 */}
                {pasteSuggestion && (
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-cyan-glow bg-cyan/5 border border-cyan/30 rounded px-2 py-1">
                    <Sparkles size={11} className="text-cyan shrink-0" />
                    <span className="flex-1">
                      看起来是 <strong>{pasteSuggestion.label}</strong> 的 key
                    </span>
                    <button
                      type="button"
                      onClick={() => onApplyPreset(pasteSuggestion.provider)}
                      className="chip text-[10px] px-2 py-0.5 cursor-pointer hover:border-cyan/60 hover:text-cyan-glow"
                    >
                      切到 {pasteSuggestion.label}
                    </button>
                  </div>
                )}
              </Field>
              )}

              {/* Model（dropdown 模式）：未分配主模型时显示 */}
              {!draft.primaryModelId && (
              <Field
                label="模型"
                hint={currentPreset?.modelExamples.length ? '从预设挑或选 「其他…」 自定义' : '输入模型名'}
              >
                <ModelDropdown
                  preset={currentPreset}
                  value={draft.model}
                  onChange={(model) =>
                    setDraft({
                      ...draft,
                      model,
                      contextWindowTokens:
                        currentPreset?.modelContextTokens?.[model] ??
                        currentPreset?.defaultContextWindowTokens ??
                        inferModelContextWindowTokens(draft.provider, model),
                    })
                  }
                />
              </Field>
              )}

              {/* 已分配主模型 → 给个简洁的预览，告知用户当前路径 */}
              {draft.primaryModelId && (
                <div className="rounded-md border border-accent/40 bg-accent/5 px-3 py-2 text-[12px] text-ink">
                  <Sparkles size={12} className="inline text-accent mr-1" />
                  当前主模型：
                  <strong className="ml-1">
                    {(() => {
                      const r = resolvePrimaryModel(draft);
                      const ctx = r.contextWindowTokens ?? inferModelContextWindowTokens(r.provider, r.model);
                      return `${r.model}（${r.provider} · ${formatTokenWindow(ctx)}）`;
                    })()}
                  </strong>
                </div>
              )}

              {/* Test result */}
              <AnimatePresence>
                {testResult && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={cn(
                      'rounded-lg p-3 text-xs',
                      testResult.ok
                        ? 'bg-ok/10 border border-ok/40 text-ok'
                        : 'bg-bad/10 border border-bad/40 text-bad',
                    )}
                  >
                    <div className="font-semibold mb-1 flex items-center gap-2">
                      {testResult.ok ? <Check size={12} /> : <X size={12} />}
                      {testResult.ok ? '连接成功' : '连接失败'}
                    </div>
                    <div className="font-mono text-[11px] text-ink whitespace-pre-wrap">{testResult.msg}</div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* 高级设置（默认折叠）—— Base URL / 调优 / FastLane / 进阶能力 */}
              <details className="border-t border-line pt-4 group/adv">
                <summary className="cursor-pointer flex items-center gap-2 text-sm font-semibold list-none select-none mb-3 hover:text-accent transition">
                  <ChevronDown size={14} className="transition-transform -rotate-90 group-open/adv:rotate-0" />
                  高级设置
                  <span className="text-[10px] text-ink-mute font-normal ml-1">Base URL · 调优 · FastLane · 进阶能力</span>
                  {/* fastLane 未启用时折叠状态下也提示休眠功能：避免用户不知情 */}
                  {(draft.ollamaMode === 'disabled' || !draft.fastLane?.enabled) && (
                    <span
                      className="ml-auto px-2 py-0.5 rounded-full bg-warn/15 border border-warn/40 text-[10px] font-medium text-warn"
                      title={
                        draft.ollamaMode === 'disabled'
                          ? '无 Ollama 模式下，所有本地 AI 功能已隔离'
                          : '启用本地 FastLane 后自动激活：运行时报错诊断 / 数据范围 sanity check / 题意偏离嗅探'
                      }
                    >
                      {draft.ollamaMode === 'disabled' ? '无 Ollama 模式' : '⚠ 3 项嗅探休眠中'}
                    </span>
                  )}
                </summary>

                <div className="space-y-5 pt-2">
                  {/* Base URL（从主体区移下来） */}
                  <Field
                    label="Base URL（完整 endpoint）"
                    hint="必须是完整的 chat-completions URL；OpenAI 兼容协议"
                  >
                    <input
                      className="input font-mono text-xs"
                      placeholder="https://api.deepseek.com/v1/chat/completions"
                      value={draft.baseUrl}
                      onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                    />
                  </Field>

                  {/* 调优子分区 */}
                  <div className="text-[11px] text-ink-mute font-semibold pt-1">调优参数</div>
                  <div className="grid grid-cols-2 gap-4">
                <Field label="Max Tokens" hint="建议 4000-8000">
                  <input
                    className="input font-mono"
                    type="number"
                    value={draft.maxTokens}
                    onChange={(e) =>
                      setDraft({ ...draft, maxTokens: Number(e.target.value) || 8000 })
                    }
                  />
                </Field>
                <Field label="Temperature" hint="0.0–1.0；推理类建议 0.2–0.4">
                  <input
                    className="input font-mono"
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={draft.temperature ?? 0.3}
                    onChange={(e) => setDraft({ ...draft, temperature: Number(e.target.value) })}
                  />
                </Field>
                <Field
                  label="上下文窗口 tokens"
                  hint={`问教练预计可带约 ${estimatedCoachRounds} 轮`}
                >
                  <input
                    className="input font-mono"
                    type="number"
                    min="1024"
                    placeholder={String(inferModelContextWindowTokens(draft.provider, draft.model))}
                    value={draft.contextWindowTokens ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        contextWindowTokens: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                  />
                </Field>
                <Field label="超时（毫秒）" hint="推理模型建议 ≥ 120000">
                  <input
                    className="input font-mono"
                    type="number"
                    value={draft.timeoutMs ?? 180000}
                    onChange={(e) => setDraft({ ...draft, timeoutMs: Number(e.target.value) })}
                  />
                </Field>
                <Field label="重试次数" hint="429/5xx/网络错误自动重试">
                  <input
                    className="input font-mono"
                    type="number"
                    value={draft.maxRetries ?? 2}
                    onChange={(e) => setDraft({ ...draft, maxRetries: Number(e.target.value) })}
                  />
                </Field>
              </div>

              {/* ━━ ⚡ FastLane（本地快车道） ━━ */}
              <div className="border-t border-line pt-4">
                <label className="flex items-center gap-2 cursor-pointer mb-2">
                  <input
                    type="checkbox"
                    className="accent-warn"
                    checked={draft.ollamaMode !== 'disabled' && !!draft.fastLane?.enabled}
                    disabled={draft.ollamaMode === 'disabled'}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        fastLane: {
                          ...DEFAULT_AI_CONFIG.fastLane!,
                          ...(draft.fastLane ?? {}),
                          enabled: e.target.checked,
                        },
                      })
                    }
                  />
                  <Zap size={14} className="text-warn" />
                  <span className="text-sm font-semibold">本地快车道（FastLane）</span>
                  <span className="chip text-[9px] px-1.5 py-0 ml-1">可选</span>
                  <span className="text-[10px] text-ink-mute ml-auto">
                    {draft.ollamaMode === 'disabled' ? '已由无 Ollama 模式隔离' : '实时类任务走本地 Ollama'}
                  </span>
                </label>
                <p className="text-[11px] text-ink-mute mb-3 pl-6 leading-relaxed">
                  <span className="text-ok">不启用也能完整使用 Coach</span>
                  ：所有任务走主云端服务。启用后，
                  代码批注 / 答疑 / 卡住引导 / 粘贴解释 走本地 Ollama（零成本、低延迟）；
                  题面解析 / 错题总结仍走主云端。命中下方「路由策略」任一阈值则跳云端保稳。
                </p>

                {/* 透明度提示：fastLane 未启用时，3 个主动嗅探 Agent 静默不工作 —— 显眼告诉用户 */}
                {(draft.ollamaMode === 'disabled' || !draft.fastLane?.enabled) && (
                  <div className="ml-6 mb-3 px-3 py-2 rounded-md border border-line/60 bg-warn/5 text-[11px] leading-relaxed text-ink-mute">
                    <div className="font-semibold text-ink mb-0.5">
                      {draft.ollamaMode === 'disabled'
                        ? '⚠ 无 Ollama 模式：以下 8 项本地功能已隔离'
                        : '⚠ 当前以下 3 个主动嗅探功能正在休眠：'}
                    </div>
                    <ul className="list-disc list-inside space-y-0.5">
                      <li>
                        <span className="text-ink">运行时报错诊断</span>
                        <span className="opacity-70">（exit&nbsp;≠&nbsp;0 时一键定位错误行）</span>
                      </li>
                      <li>
                        <span className="text-ink">数据范围 sanity check</span>
                        <span className="opacity-70">（样例通过后扫 TLE/MLE 风险）</span>
                      </li>
                      <li>
                        <span className="text-ink">题意偏离嗅探</span>
                        <span className="opacity-70">（代码方向跑偏时给一句提醒）</span>
                      </li>
                      {draft.ollamaMode === 'disabled' && (
                        <>
                          <li>
                            <span className="text-ink">实时模块点亮</span>
                            <span className="opacity-70">（算法可视化 Detect）</span>
                          </li>
                          <li>
                            <span className="text-ink">FastLane 实时批注</span>
                            <span className="opacity-70">（前台批注 / 卡住引导 / 粘贴解释）</span>
                          </li>
                          <li>
                            <span className="text-ink">意图路由器</span>
                            <span className="opacity-70">（本地小模型路由问题类型）</span>
                          </li>
                          <li>
                            <span className="text-ink">AC 后 Hack Case</span>
                            <span className="opacity-70">（本地生成极端测试）</span>
                          </li>
                          <li>
                            <span className="text-ink">题目图片识别 OCR</span>
                            <span className="opacity-70">（TM 导入截图转文字）</span>
                          </li>
                        </>
                      )}
                    </ul>
                    <div className="mt-1 opacity-80">
                      {draft.ollamaMode === 'disabled'
                        ? '打开设置顶部「Ollama 模式」后，这些功能才会恢复；关闭时不会偷偷蹭主云端 token。'
                        : '启用本地 FastLane 后自动激活，不会偷偷蹭主云端 token。'}
                    </div>
                  </div>
                )}

                {draft.ollamaMode !== 'disabled' && draft.fastLane?.enabled && (
                  <div className="pl-6 space-y-3">
                    {/* 注册制：从已注册的本地 Ollama 模型挑一个分配给 FastLane */}
                    <Field label="分配模型（从注册表）" hint="只列出本地 Ollama 模型；选中后下方手填字段自动隐藏">
                      <ModelPicker
                        value={draft.fastLane.modelId}
                        onChange={(id) =>
                          setDraft({
                            ...draft,
                            fastLane: { ...draft.fastLane!, modelId: id },
                          })
                        }
                        config={draft}
                        filter={(m) => m.provider === 'ollama'}
                        placeholder="— 未分配 / 用下方手填 —"
                      />
                    </Field>
                    {!draft.fastLane.modelId && (
                      <>
                        <OllamaSetupHint />
                        <Field label="Base URL" hint="必须本地（localhost / 127.* / 局域网）">
                          <input
                            className="input font-mono text-xs"
                            placeholder={DEFAULT_AI_CONFIG.fastLane!.baseUrl}
                            value={draft.fastLane.baseUrl}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                fastLane: { ...draft.fastLane!, baseUrl: e.target.value },
                              })
                            }
                          />
                        </Field>
                        <Field label="模型" hint="必须是 Ollama 已 pull 的模型；点「探测」自动列出">
                          <OllamaModelPicker
                            baseUrl={draft.fastLane.baseUrl}
                            value={draft.fastLane.model}
                            onChange={(model) =>
                              setDraft({
                                ...draft,
                                fastLane: { ...draft.fastLane!, model },
                              })
                            }
                          />
                        </Field>
                        <Field label="num_ctx" hint="上下文窗口；VRAM 紧张可降到 8192">
                          <input
                            className="input font-mono"
                            type="number"
                            placeholder="20480"
                            value={draft.fastLane.numCtx ?? ''}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                fastLane: {
                                  ...draft.fastLane!,
                                  numCtx: e.target.value ? Number(e.target.value) : undefined,
                                },
                              })
                            }
                          />
                        </Field>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* ━━ 🔀 路由策略（高级折叠） ━━ */}
              {draft.ollamaMode !== 'disabled' && draft.fastLane?.enabled && (
                <details className="border-t border-line pt-4">
                  <summary className="cursor-pointer flex items-center gap-2 text-sm font-semibold list-none select-none">
                    <Settings2 size={14} className="text-cyan" />
                    路由策略（高级）
                    <span className="text-[10px] text-ink-mute font-normal ml-auto">
                      点击展开
                    </span>
                  </summary>
                  <p className="text-[11px] text-ink-mute mt-2 mb-3 pl-6">
                    fastLane 启用后，命中以下任一条件 → 自动跳主云端（保稳）。留空走默认值。
                  </p>
                  <div className="pl-6 grid grid-cols-2 gap-3">
                    <Field
                      label="代码字符上限"
                      hint={`默认 ${DEFAULT_ROUTER_HINTS.codeCharLimit}`}
                    >
                      <input
                        className="input font-mono"
                        type="number"
                        placeholder={String(DEFAULT_ROUTER_HINTS.codeCharLimit)}
                        value={draft.routerHints?.codeCharLimit ?? ''}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            routerHints: {
                              ...(draft.routerHints ?? {}),
                              codeCharLimit: e.target.value ? Number(e.target.value) : undefined,
                            },
                          })
                        }
                      />
                    </Field>
                    <Field
                      label="代码行数上限"
                      hint={`默认 ${DEFAULT_ROUTER_HINTS.codeLineLimit}`}
                    >
                      <input
                        className="input font-mono"
                        type="number"
                        placeholder={String(DEFAULT_ROUTER_HINTS.codeLineLimit)}
                        value={draft.routerHints?.codeLineLimit ?? ''}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            routerHints: {
                              ...(draft.routerHints ?? {}),
                              codeLineLimit: e.target.value ? Number(e.target.value) : undefined,
                            },
                          })
                        }
                      />
                    </Field>
                    <Field
                      label="问题字符上限"
                      hint={`ask 用，默认 ${DEFAULT_ROUTER_HINTS.questionCharLimit}`}
                    >
                      <input
                        className="input font-mono"
                        type="number"
                        placeholder={String(DEFAULT_ROUTER_HINTS.questionCharLimit)}
                        value={draft.routerHints?.questionCharLimit ?? ''}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            routerHints: {
                              ...(draft.routerHints ?? {}),
                              questionCharLimit: e.target.value
                                ? Number(e.target.value)
                                : undefined,
                            },
                          })
                        }
                      />
                    </Field>
                    <Field
                      label="粘贴字符上限"
                      hint={`explain 用，默认 ${DEFAULT_ROUTER_HINTS.pasteCharLimit}`}
                    >
                      <input
                        className="input font-mono"
                        type="number"
                        placeholder={String(DEFAULT_ROUTER_HINTS.pasteCharLimit)}
                        value={draft.routerHints?.pasteCharLimit ?? ''}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            routerHints: {
                              ...(draft.routerHints ?? {}),
                              pasteCharLimit: e.target.value ? Number(e.target.value) : undefined,
                            },
                          })
                        }
                      />
                    </Field>
                  </div>
                  <Field
                    label="复杂题 tag 触发词"
                    hint="逗号分隔；命中即跳云端。留空走默认列表"
                  >
                    <textarea
                      className="input font-mono text-xs min-h-[60px]"
                      placeholder={DEFAULT_ROUTER_HINTS.heavyTags.join(', ')}
                      value={draft.routerHints?.heavyTags?.join(', ') ?? ''}
                      onChange={(e) => {
                        const arr = e.target.value
                          .split(/[,，]/)
                          .map((s) => s.trim())
                          .filter(Boolean);
                        setDraft({
                          ...draft,
                          routerHints: {
                            ...(draft.routerHints ?? {}),
                            heavyTags: arr.length > 0 ? arr : undefined,
                          },
                        });
                      }}
                    />
                  </Field>
                </details>
              )}

              {/* ━━ 🧭 Coach 意图路由 ━━ */}
              {ollamaEnabled && (
                <div className="border-t border-line pt-4">
                  <label className="flex items-center gap-2 cursor-pointer mb-2">
                    <input
                      type="checkbox"
                      className="accent-cyan"
                      checked={!!draft.intentRouter?.enabled}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          intentRouter: {
                            ...DEFAULT_AI_CONFIG.intentRouter!,
                            ...(draft.intentRouter ?? {}),
                            enabled: e.target.checked,
                          },
                        })
                      }
                    />
                    <span className="text-sm font-semibold">Coach 意图路由（AI 兜底）</span>
                    <span className="chip text-[9px] px-1.5 py-0 ml-1">可选</span>
                    <span className="text-[10px] text-ink-mute ml-auto">
                      规则识别不到时，让一个轻模型再判一遍
                    </span>
                  </label>
                  <p className="text-[11px] text-ink-mute mb-3 pl-6 leading-relaxed">
                    <span className="text-ok">不启用也能正常用</span>
                    ：只走规则路由（速度最快、无成本）。开启后，模糊问题再调一次该模型返回 JSON
                    分类（intent / contextTemplate / outputMode），失败自动回落到规则。
                  </p>
                  {draft.intentRouter?.enabled && (
                    <div className="pl-6 space-y-3">
                      {/* 注册制：从已注册模型挑一个分配给意图路由器 */}
                      <Field label="分配模型（从注册表）" hint="选中后下方手填字段自动隐藏">
                        <ModelPicker
                          value={draft.intentRouter.modelId}
                          onChange={(id) =>
                            setDraft({
                              ...draft,
                              intentRouter: { ...draft.intentRouter!, modelId: id },
                            })
                          }
                          config={draft}
                          placeholder="— 未分配 / 用下方手填 —"
                        />
                      </Field>
                      {!draft.intentRouter.modelId && (
                        <>
                          <Field label="Base URL" hint="OpenAI 兼容 chat 接口或本地 ollama">
                            <input
                              className="input font-mono text-xs"
                              placeholder={DEFAULT_AI_CONFIG.intentRouter!.baseUrl}
                              value={draft.intentRouter.baseUrl}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  intentRouter: { ...draft.intentRouter!, baseUrl: e.target.value },
                                })
                              }
                            />
                          </Field>
                          <Field label="模型" hint="本地 Ollama 模型可点「探测」自动列出">
                            <OllamaModelPicker
                              baseUrl={draft.intentRouter.baseUrl}
                              value={draft.intentRouter.model}
                              onChange={(model) =>
                                setDraft({
                                  ...draft,
                                  intentRouter: { ...draft.intentRouter!, model },
                                })
                              }
                            />
                          </Field>
                          <Field label="API Key（可选）" hint="ollama 等本地服务可留空">
                            <input
                              className="input font-mono text-xs"
                              placeholder=""
                              value={draft.intentRouter.apiKey ?? ''}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  intentRouter: { ...draft.intentRouter!, apiKey: e.target.value },
                                })
                              }
                            />
                          </Field>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ━━ 🎨 算法可视化模型（3 个工位独立可配） ━━ */}
              <details className="border-t border-line pt-4 group/algoviz">
                <summary className="cursor-pointer flex items-center gap-2 text-sm font-semibold list-none select-none mb-2 hover:text-accent transition">
                  <ChevronDown size={14} className="transition-transform -rotate-90 group-open/algoviz:rotate-0" />
                  <span>🎨 算法可视化模型</span>
                  <span className="chip text-[9px] px-1.5 py-0 ml-1">可选</span>
                  <span className="text-[10px] text-ink-mute font-normal ml-auto">
                    {ollamaEnabled ? 'Status / Animation / Detect 三工位独立可配' : 'Animation 保留 · Detect 已隐藏'}
                  </span>
                </summary>
                <p className="text-[11px] text-ink-mute mb-3 pl-6 leading-relaxed">
                  <span className="text-ok">不启用也能用</span>
                  {ollamaEnabled ? (
                    <>
                      ：默认 Status / Animation 走主云端（重活耗时长），Detect 走 fastLane（轻活高频）。
                      推荐把 <strong>Status / Animation</strong> 单独配成 DeepSeek-v4-pro（生成质量更稳）；
                      <strong> Detect</strong> 保持 fastLane 即可。
                    </>
                  ) : (
                    <>
                      ：AC 动画仍走主云端生成；实时模块点亮 / Detect 已随 Ollama 模式关闭。
                    </>
                  )}
                </p>
                <div className="pl-6 space-y-4">
                  <AlgoVizRoleConfig
                    role="status"
                    label={ollamaEnabled ? 'Status 生成' : '动画素材生成'}
                    desc={
                      ollamaEnabled
                        ? '一次性生成模块进度卡片（~20s，质量优先）'
                        : '一次性生成动画所需结构化素材（后台使用，不显示实时点亮）'
                    }
                    fallback="走主云端"
                    draft={draft}
                    setDraft={setDraft}
                  />
                  <AlgoVizRoleConfig
                    role="animation"
                    label="Animation 生成"
                    desc="一次性生成 Remotion 动画（~60-100s，质量优先）"
                    fallback="走主云端"
                    draft={draft}
                    setDraft={setDraft}
                  />
                  {ollamaEnabled && (
                    <AlgoVizRoleConfig
                      role="detect"
                      label="实时模块检测"
                      desc="每 15s 跑一次，输出极短（轻活，速度优先）"
                      fallback="走 fastLane"
                      draft={draft}
                      setDraft={setDraft}
                    />
                  )}
                </div>
              </details>

              {/* ━━ 💡 学习辅助 ━━ */}
              {ollamaEnabled && (
                <div className="border-t border-line pt-4">
                  <label className="flex items-center gap-2 cursor-pointer mb-2">
                    <input
                      type="checkbox"
                      className="accent-warn"
                      checked={stuckHintEnabled}
                      onChange={(e) => setStuckHintEnabled(e.target.checked)}
                    />
                    <Lightbulb size={14} className="text-warn" />
                    <span className="text-sm font-semibold">120s 卡住主动提醒</span>
                    <span className="text-[10px] text-ink-mute ml-auto">
                      {stuckHintEnabled ? '已开启' : '未开启'}
                    </span>
                  </label>
                  <p className="text-[11px] text-ink-mute pl-6">
                    连续 2 分钟没编辑代码时，AI 自动给一条引导式提示（不直接给答案）。
                    关闭后，仍可点顶栏 <span className="inline-flex items-center gap-0.5"><Lightbulb size={10} className="text-warn" />求助</span> 按钮手动触发。
                  </p>
                </div>
              )}

              {/* ━━ ✨ Coach 主动嗅探（FastLane 专属） ━━ */}
              {ollamaEnabled && (
                <div className="border-t border-line pt-4 space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-1">
                      <Sparkles size={13} className="text-accent" />
                      Coach 主动嗅探（FastLane 专属）
                      {fastLaneReady ? (
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-ok/15 text-ok border border-ok/40 flex items-center gap-1">
                          <Check size={9} /> fastLane 已就绪
                        </span>
                      ) : (
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-bad/10 text-bad border border-bad/40 flex items-center gap-1">
                          <AlertTriangle size={9} />
                          fastLane 未配置 · 三个开关无效
                        </span>
                      )}
                    </h3>
                    <p className="text-[11px] text-ink-mute leading-relaxed">
                      本地模型在<strong>有意义事件</strong>（跑代码失败、跑通样例、长时间停顿后代码净增）发生时
                      自己扫一眼代码，<strong>静默</strong>把发现写到 Agent 行动面板和编辑器右上角小角标。
                      不弹窗、不抢焦点、可随时关掉。
                    </p>
                    <p className="text-[11px] text-warn leading-relaxed mt-1">
                      ⚠ <strong>仅走本地 fastLane</strong>：fastLane 没配好这三个开关全部静默不生效，
                      绝不会偷偷蹭主云端 token。
                    </p>
                  </div>

                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="accent-bad mt-1"
                      checked={diagnoseOnFailEnabled}
                      onChange={(e) => setDiagnoseOnFailEnabled(e.target.checked)}
                    />
                    <Bug size={14} className="text-bad mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium flex items-center gap-2">
                        跑失败 → 秒级错误归因
                        <span className="text-[10px] text-ink-mute">
                          {diagnoseOnFailEnabled ? '已开启' : '未开启'}
                        </span>
                      </div>
                      <p className="text-[11px] text-ink-mute mt-0.5">
                        退出码 ≠ 0 时，本地模型在 0.8 秒内根据 stderr 给一句话定位（e.g. "可能在 L42 数组 a 越界"）。
                        <strong className="text-ink">推荐开</strong>，最直接的 FastLane 价值。
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="accent-warn mt-1"
                      checked={constraintSanityEnabled}
                      onChange={(e) => setConstraintSanityEnabled(e.target.checked)}
                    />
                    <Ruler size={14} className="text-warn mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium flex items-center gap-2">
                        跑通样例 → 数据范围审计
                        <span className="text-[10px] text-ink-mute">
                          {constraintSanityEnabled ? '已开启' : '未开启'}
                        </span>
                      </div>
                      <p className="text-[11px] text-ink-mute mt-0.5">
                        首次跑通样例时一次性扫数据范围风险（int 是否够、数组是否开小、复杂度是否过得去）。
                        每题终生只跑一次，<strong className="text-ink">推荐开</strong>。
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="accent-accent mt-1"
                      checked={intentSniffEnabled}
                      onChange={(e) => setIntentSniffEnabled(e.target.checked)}
                    />
                    <Compass size={14} className="text-accent mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium flex items-center gap-2">
                        90s 停顿 + 代码净增 → 题意校对
                        <span className="text-[10px] text-warn ml-1">实验性</span>
                        <span className="text-[10px] text-ink-mute">
                          {intentSniffEnabled ? '已开启' : '未开启'}
                        </span>
                      </div>
                      <p className="text-[11px] text-ink-mute mt-0.5">
                        停下 90 秒且代码净增 ≥ 30 字时，本地模型扫一眼判方向是否对。
                        只在<strong>明显偏题</strong>时才报警，否则全静默。
                        5 分钟全局节流，同段代码不重复嗅探。<strong className="text-warn">默认关</strong>，担心打扰先别开。
                      </p>
                    </div>
                  </label>
                </div>
              )}
                </div>
              </details>
            </div>

            <div className="px-6 py-3 border-t border-line flex items-center justify-end gap-2">
              <button onClick={() => setOpen(false)} className="btn" disabled={testing}>
                取消
              </button>
              <button
                onClick={onSaveAndTest}
                disabled={(() => {
                  if (testing) return true;
                  // 校验"实际生效的主模型"——若用了注册制就看注册条目，否则看顶层字段
                  const r = resolvePrimaryModel(draft);
                  if (!r.baseUrl.trim() || !r.model.trim()) return true;
                  return false;
                })()}
                className="btn-primary"
              >
                {testing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Check size={14} />
                )}
                {testing ? '测试中…' : '保存并测试'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="label !mb-0">{label}</span>
        {hint && <span className="text-[10px] text-ink-mute">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * algoViz 单个工位的 enable + 配置卡片。
 * 折叠默认收起；展开后给 baseUrl / apiKey / model 三字段（apiKey 留空时识别为 ollama 本地）。
 */
function isLocalUrl(url: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    const h = u.hostname;
    return (
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h === '::1' ||
      h.startsWith('192.168.') ||
      h.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    );
  } catch {
    return false;
  }
}

function AlgoVizRoleConfig({
  role,
  label,
  desc,
  fallback,
  draft,
  setDraft,
}: {
  role: 'status' | 'animation' | 'detect';
  label: string;
  desc: string;
  /** 未启用时这个工位走啥的简短描述（"走主云端" / "走 fastLane"） */
  fallback: string;
  draft: AIConfig;
  setDraft: (cfg: AIConfig) => void;
}) {
  const cur = draft.algoVizModels?.[role];
  const enabled = !!cur?.enabled;
  const boundEntry = cur?.modelId ? draft.modelRegistry?.find((m) => m.id === cur.modelId) : undefined;
  const update = (patch: Partial<NonNullable<AIConfig['algoVizModels']>[typeof role]>) => {
    setDraft({
      ...draft,
      algoVizModels: {
        ...(draft.algoVizModels ?? {}),
        [role]: {
          enabled: false,
          baseUrl: '',
          apiKey: '',
          model: '',
          ...(cur ?? {}),
          ...patch,
        },
      },
    });
  };
  return (
    <div className="rounded-md border border-line/60 bg-bg-elev/40 px-3 py-2">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="accent-cyan"
          checked={enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
        />
        <span className="text-[13px] font-medium text-ink">{label}</span>
        <span className="text-[10px] text-ink-mute ml-auto">
          {enabled
            ? boundEntry
              ? `分配 · ${boundEntry.label}`
              : `独立配置 · ${cur?.model || '未配 model'}`
            : `继承 ${fallback}`}
        </span>
      </label>
      <p className="text-[10.5px] text-ink-mute mt-1 pl-6 leading-relaxed">{desc}</p>
      {enabled && (
        <div className="pl-6 mt-2 space-y-2">
          {/* 注册制：从已注册模型挑一个 */}
          <Field label="分配模型（从注册表）" hint="选中后下方手填字段自动隐藏">
            <ModelPicker
              value={cur?.modelId}
              onChange={(id) => update({ modelId: id })}
              config={draft}
              filter={role === 'detect' ? (m) => m.provider === 'ollama' : undefined}
              placeholder="— 未分配 / 用下方手填 —"
            />
          </Field>
          {!cur?.modelId && (
            <>
              {/* detect 工位每 15s 调一次，云端高频会持续烧 token；显式提示 */}
              {role === 'detect' && cur?.baseUrl && !isLocalUrl(cur.baseUrl) && (
                <div className="rounded border border-warn/50 bg-warn/10 px-2 py-1.5 text-[10.5px] text-warn leading-relaxed">
                  ⚠️ <strong>不建议云端 detect</strong>：每 15 秒触发一次，长期使用会持续消耗云端 token。
                  建议改用本地 Ollama 模型（如 <code className="font-mono">http://localhost:11434/v1/chat/completions</code> + <code className="font-mono">qwen3.5:4b</code>）。
                </div>
              )}
              <Field label="Base URL" hint={role === 'detect' ? '建议本地 Ollama；云端会持续消耗 token' : 'OpenAI 兼容 chat-completions endpoint'}>
                <input
                  className="input font-mono text-xs"
                  placeholder={role === 'detect' ? 'http://localhost:11434/v1/chat/completions' : 'https://api.deepseek.com/v1/chat/completions'}
                  value={cur?.baseUrl ?? ''}
                  onChange={(e) => update({ baseUrl: e.target.value })}
                />
              </Field>
              <Field label="API Key" hint="本地 Ollama 可留空">
                <input
                  className="input font-mono text-xs"
                  type="password"
                  placeholder="sk-..."
                  value={cur?.apiKey ?? ''}
                  onChange={(e) => update({ apiKey: e.target.value })}
                />
              </Field>
              <Field label="Model" hint={role === 'detect' ? '推荐本地 qwen3.5:4b' : '推荐 deepseek-v4-pro 或同等大模型'}>
                <input
                  className="input font-mono text-xs"
                  placeholder={role === 'detect' ? 'qwen3.5:4b' : 'deepseek-v4-pro'}
                  value={cur?.model ?? ''}
                  onChange={(e) => update({ model: e.target.value })}
                />
              </Field>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ───────── 模型 dropdown ─────────

const CUSTOM_MODEL_SENTINEL = '__custom__';

/**
 * 模型选择器：把 preset.modelExamples 列成 select，并附「其他…」选项让用户填自定义模型名。
 *
 * 设计意图：
 * - 新手只看到下拉菜单，挑一个就走（不必知道型号长啥样）
 * - 老手选「其他…」展开 input，仍可填任意 OpenAI 兼容 model 名
 * - provider=custom 时无 modelExamples，只显示 input
 */
function ModelDropdown({
  preset,
  value,
  onChange,
}: {
  preset: { id: string; modelExamples: string[]; defaultModel: string } | undefined;
  value: string;
  onChange: (model: string) => void;
}) {
  const examples = preset?.modelExamples ?? [];
  // 当前 value 是不是自定义（不在预设里）
  const isCustom = examples.length === 0 || (value && !examples.includes(value));
  // 用户主动展开自定义输入（即使 value 在预设里也想换成空白自定义）
  const [showCustomInput, setShowCustomInput] = useState(false);
  const showInput = isCustom || showCustomInput;

  if (examples.length === 0) {
    // custom provider：直接 input
    return (
      <input
        className="input font-mono text-xs"
        placeholder="model-name"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <div className="space-y-1.5">
      <select
        className="input font-mono text-xs cursor-pointer"
        value={isCustom ? CUSTOM_MODEL_SENTINEL : value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === CUSTOM_MODEL_SENTINEL) {
            setShowCustomInput(true);
            // 让用户清空重填；保留旧值方便他改
          } else {
            setShowCustomInput(false);
            onChange(v);
          }
        }}
      >
        {examples.map((m) => (
          <option key={m} value={m}>
            {m}
            {m === preset?.defaultModel ? ' （推荐）' : ''}
          </option>
        ))}
        <option value={CUSTOM_MODEL_SENTINEL}>其他模型…（自定义）</option>
      </select>
      {showInput && (
        <input
          className="input font-mono text-xs"
          placeholder="输入自定义模型名"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={showCustomInput}
        />
      )}
    </div>
  );
}

// ───────── Ollama 引导横幅 ─────────

/**
 * 引导用户安装 Ollama + pull 推荐模型。
 * 紧凑横幅样式：左上 icon，右上「打开官网」链接，下方 pull 命令列表。
 */
function OllamaSetupHint() {
  return (
    <div className="rounded-lg border border-cyan/30 bg-cyan/5 px-3 py-2.5 text-[11px] leading-relaxed">
      <div className="flex items-start gap-2">
        <Download size={13} className="text-cyan shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-cyan-glow mb-1">需要先安装 Ollama 并 pull 一个模型</div>
          <div className="text-ink-dim">
            没有 Ollama 也能完整使用 Coach（走主云端）。装好后从下面任选一个 pull：
          </div>
          <div className="mt-2 space-y-1">
            {RECOMMENDED_OLLAMA_MODELS.slice(0, 3).map((m) => (
              <PullCommandRow key={m.name} model={m} />
            ))}
          </div>
        </div>
        <a
          href="https://ollama.com/download"
          target="_blank"
          rel="noopener noreferrer"
          className="text-cyan hover:text-cyan-glow flex items-center gap-1 shrink-0 text-[11px]"
          title="打开 Ollama 官网下载页"
        >
          <ExternalLink size={11} />
          安装
        </a>
      </div>
    </div>
  );
}

function PullCommandRow({
  model,
}: {
  model: { name: string; size: string; vramHint?: string; desc: string };
}) {
  const cmd = `ollama pull ${model.name}`;
  const onCopy = () => {
    navigator.clipboard.writeText(cmd).then(
      () => toast.success(`已复制：${cmd}`),
      () => toast.error('复制失败'),
    );
  };
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <code className="font-mono bg-bg-elev2 px-1.5 py-0.5 rounded text-ink whitespace-nowrap">
        {cmd}
      </code>
      <span className="text-ink-mute shrink-0">{model.size}</span>
      <span className="text-ink-dim text-[10px] truncate">{model.desc}</span>
      <button
        onClick={onCopy}
        className="text-cyan hover:text-cyan-glow shrink-0 ml-auto"
        title="复制命令"
        type="button"
      >
        <Copy size={11} />
      </button>
    </div>
  );
}

// ───────── 本地 Ollama 模型选择器 ─────────

/**
 * 探测本地 Ollama 已 pull 的模型并以下拉框展示。
 *
 * - 默认：纯 input + 「探测」按钮
 * - 探测成功：替换为 select 下拉，列出 ollama 上实际存在的模型
 * - 探测失败：保持 input + 显示「未连上 Ollama」+ 推荐 pull 命令
 *
 * 走 vite dev 中间件 /ai-proxy 避开 CORS；prod 部署直连（用户需要 OLLAMA_ORIGINS=*）。
 */
function OllamaModelPicker({
  baseUrl,
  value,
  onChange,
}: {
  baseUrl: string;
  value: string;
  onChange: (model: string) => void;
}) {
  const [models, setModels] = useState<Array<{ name: string; size: number }> | null>(null);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);

  const probe = useCallback(async (autoPick = false) => {
    if (!baseUrl?.trim()) return;
    setProbing(true);
    setError(null);
    try {
      const names = await fetchOllamaModels(baseUrl);
      setModels(names);
      setLastLoadedAt(Date.now());
      if (autoPick && names[0]?.name && !names.some((m) => m.name === value)) {
        onChange(names[0].name);
      }
    } catch (e: any) {
      const msg =
        e?.name === 'AbortError'
          ? '连接超时（4s）'
          : String(e?.message ?? e).slice(0, 100);
      setError(msg);
      setModels(null);
    } finally {
      setProbing(false);
    }
  }, [baseUrl, onChange, value]);

  useEffect(() => {
    setModels(null);
    setError(null);
    setLastLoadedAt(null);
    if (baseUrl?.trim()) {
      void probe(true);
      // 30s 一次足够；10s 会让 ollama 日志一直滚
      const timer = window.setInterval(() => void probe(false), 30_000);
      return () => window.clearInterval(timer);
    }
  }, [baseUrl]);

  const hasOptions = models !== null && models.length > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-stretch gap-2">
        {hasOptions ? (
          <select
            className="input font-mono text-xs flex-1"
            value={value}
            onFocus={() => void probe(false)}
            onChange={(e) => onChange(e.target.value)}
          >
            {value && !models!.some((m) => m.name === value) && (
              <option value={value}>{value}（未安装）</option>
            )}
            {models!.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name} · {formatModelSize(m.size)}
              </option>
            ))}
          </select>
        ) : probing && !error ? (
          <select className="input font-mono text-xs flex-1" value="" disabled>
            <option value="">正在实时读取本机 ollama list...</option>
          </select>
        ) : (
          <input
            className="input font-mono text-xs flex-1"
            placeholder="未读取到本机 ollama list，可临时手填"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        <button
          type="button"
          onClick={() => void probe(false)}
          disabled={probing || !baseUrl?.trim()}
          className="btn shrink-0"
          title="刷新本机 Ollama 已 pull 的模型"
        >
          {probing ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          刷新
        </button>
      </div>
      {lastLoadedAt && (
        <div className="text-[10px] text-ok">
          已实时读取本机 ollama list：{models?.length ?? 0} 个模型 · {new Date(lastLoadedAt).toLocaleTimeString()}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-2 py-1.5 text-[11px] text-warn flex items-start gap-2">
          <AlertTriangle size={11} className="shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            未连上 Ollama（{error}）。请确认已运行 <code className="font-mono">ollama serve</code>
            ，或在{' '}
            <a
              href="https://ollama.com/download"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              ollama.com
            </a>{' '}
            安装。
          </div>
        </div>
      )}
      {models !== null && models.length === 0 && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-2 py-1.5 text-[11px] text-warn flex items-start gap-2">
          <AlertTriangle size={11} className="shrink-0 mt-0.5" />
          已连上 Ollama 但还没 pull 任何模型。请从下方任选一个：
        </div>
      )}
      {(error || (models !== null && models.length === 0)) && (
        <div className="space-y-1 pl-1">
          {RECOMMENDED_OLLAMA_MODELS.map((m) => (
            <PullCommandRow key={m.name} model={m} />
          ))}
        </div>
      )}
    </div>
  );
}

interface OllamaImpact {
  icon: typeof Cpu;
  title: string;
  desc: string;
}

const OLLAMA_IMPACTS: OllamaImpact[] = [
  { icon: Activity, title: '实时模块点亮', desc: '算法可视化每 15s 自动检测代码进度' },
  { icon: Bug, title: '运行时报错诊断', desc: 'exit ≠ 0 时一键定位错误行 + 一句话提示' },
  { icon: Ruler, title: '数据范围 sanity check', desc: '样例通过后扫 TLE/MLE 风险' },
  { icon: Compass, title: '题意偏离嗅探', desc: '代码方向跑偏时给一句提醒' },
  { icon: Zap, title: 'FastLane 实时批注', desc: '前台流式批注 / 卡住引导 / 粘贴解释走本地' },
  { icon: Lightbulb, title: '意图路由器', desc: '小模型识别问题类型，路由到合适工位' },
  { icon: ScanLine, title: 'AC 后 Hack Case', desc: '样例通过后本地生成极端测试挑战代码' },
  { icon: Image, title: '题目图片识别 (OCR)', desc: 'TM 推送的题目截图自动转文字（qwen3.5）' },
];

function OllamaModeSwitch({
  mode,
  onChange,
}: {
  mode: 'enabled' | 'disabled';
  onChange: (m: 'enabled' | 'disabled') => void;
}) {
  const [showImpacts, setShowImpacts] = useState(false);
  const enabled = mode === 'enabled';

  return (
    <div
      className={cn(
        'rounded-lg border-2 transition-all',
        enabled
          ? 'border-warn/50 bg-warn/[0.03]'
          : 'border-line bg-line/[0.03] opacity-90',
      )}
    >
      {/* 顶部：状态 + 大开关 */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div
          className={cn(
            'shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
            enabled ? 'bg-warn/15 text-warn' : 'bg-line/40 text-ink-mute',
          )}
        >
          {enabled ? <Cpu size={20} /> : <PowerOff size={20} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">
              Ollama 模式
            </span>
            <span
              className={cn(
                'chip text-[10px] px-1.5 py-0',
                enabled
                  ? 'border-warn/50 text-warn bg-warn/10'
                  : 'border-line text-ink-mute',
              )}
            >
              {enabled ? '已启用' : '已关闭'}
            </span>
          </div>
          <p className="text-[11px] text-ink-mute mt-0.5 leading-relaxed">
            {enabled
              ? '本机已装 Ollama · 8 项实时本地 AI 功能可用（推荐）'
              : '纯云端模式 · 8 项本地 AI 功能已隔离，不会调云端兜底'}
          </p>
        </div>
        {/* 大 toggle */}
        <button
          type="button"
          onClick={() => onChange(enabled ? 'disabled' : 'enabled')}
          className={cn(
            'relative shrink-0 w-12 h-6 rounded-full transition-colors overflow-hidden',
            enabled ? 'bg-warn' : 'bg-line',
          )}
          title={enabled ? '点击关闭 Ollama 模式（隔离 8 项本地功能）' : '点击启用 Ollama 模式'}
        >
          <span
            className={cn(
              'absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-bg-card border border-line shadow-md transition-transform',
              enabled ? 'translate-x-6' : 'translate-x-0',
            )}
          />
        </button>
      </div>

      {/* 切换 → 影响列表 */}
      <button
        type="button"
        onClick={() => setShowImpacts((v) => !v)}
        className="w-full px-4 py-2 border-t border-line/60 text-[11px] text-ink-mute hover:bg-line/20 transition flex items-center gap-1.5"
      >
        <ChevronDown
          size={11}
          className={cn(
            'transition-transform',
            showImpacts ? 'rotate-180' : 'rotate-0',
          )}
        />
        {enabled ? '查看 8 项受 Ollama 驱动的功能' : '查看 8 项被关闭的功能'}
      </button>

      <AnimatePresence initial={false}>
        {showImpacts && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 pt-1 space-y-2">
              {OLLAMA_IMPACTS.map((it) => {
                const Icon = it.icon;
                return (
                  <div key={it.title} className="flex items-start gap-2">
                    <Icon
                      size={13}
                      className={cn(
                        'shrink-0 mt-0.5',
                        enabled ? 'text-warn' : 'text-ink-mute opacity-60',
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div
                        className={cn(
                          'text-xs font-medium',
                          enabled ? 'text-ink' : 'text-ink-mute line-through opacity-70',
                        )}
                      >
                        {it.title}
                      </div>
                      <div className="text-[11px] text-ink-mute leading-relaxed">{it.desc}</div>
                    </div>
                  </div>
                );
              })}
              {!enabled && (
                <div className="mt-3 rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-[11px] leading-relaxed">
                  <div className="font-semibold text-warn mb-1 flex items-center gap-1.5">
                    <ScanLine size={11} />
                    想要这些功能？
                  </div>
                  <div className="text-ink-mute">
                    安装 Ollama（约 100 MB）+ pull 一个 4B 小模型（约 3 GB）即可全部解锁。
                    访问{' '}
                    <a
                      href="https://ollama.com/download"
                      target="_blank"
                      rel="noreferrer"
                      className="text-warn hover:underline inline-flex items-center gap-0.5"
                    >
                      ollama.com/download
                      <ExternalLink size={9} />
                    </a>
                    ，安装后回到这里打开开关。
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
