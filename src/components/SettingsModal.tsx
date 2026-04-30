import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../lib/store';
import { PRESETS, DEFAULT_AI_CONFIG, RECOMMENDED_OLLAMA_MODELS } from '../lib/presets';
import type { AIConfig, AIProvider } from '../core/types';
import { cn } from '../lib/cn';
import { isLocalOllamaUrl } from '../lib/ollama';
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
} from 'lucide-react';
import { AIClient } from '../core/ai/client';
import { toast } from 'sonner';
import { DEFAULT_ROUTER_HINTS } from '../core/ai/router';

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

  /** fastLane 是否就绪：enabled + 本地 baseUrl + model 都配齐才算 */
  const fastLaneReady = !!(
    cfg.fastLane?.enabled &&
    cfg.fastLane.baseUrl?.trim() &&
    cfg.fastLane.model?.trim() &&
    isLocalOllamaUrl(cfg.fastLane.baseUrl)
  );

  const [draft, setDraft] = useState<AIConfig>(cfg);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

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
    });
  };

  /**
   * 保存并测试合一：先做合法性校验 → 跑一次 ping → 通过则 setCfg + 关闭 modal；
   * 失败则原地展示红条，不关闭，让用户改完再点。
   *
   * 这是「主体」最关键的操作：用户填一个 apikey 点一下 → 立刻知道行不行。
   */
  const onSaveAndTest = async () => {
    if (!draft.baseUrl.trim()) {
      setTestResult({ ok: false, msg: 'Base URL 不能为空（在「高级」里填）' });
      return;
    }
    // ollama 本地服务可以不要 apiKey
    const needsKey = draft.provider !== 'ollama';
    if (needsKey && !draft.apiKey.trim()) {
      setTestResult({ ok: false, msg: 'API Key 不能为空' });
      return;
    }
    if (!draft.model.trim()) {
      setTestResult({ ok: false, msg: 'Model 不能为空' });
      return;
    }
    if (draft.fastLane?.enabled) {
      if (!draft.fastLane.baseUrl?.trim()) {
        setTestResult({ ok: false, msg: 'FastLane Base URL 不能为空（在「高级」里填）' });
        return;
      }
      if (!draft.fastLane.model?.trim()) {
        setTestResult({ ok: false, msg: 'FastLane 模型不能为空（在「高级」里填）' });
        return;
      }
    }
    setTesting(true);
    setTestResult(null);
    const client = new AIClient(draft);
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
      // 测试通过 → 保存 + 关闭
      setCfg(draft);
      setTestResult({ ok: true, msg: `成功：${text.trim().slice(0, 60) || '(空响应)'}` });
      toast.success('AI 配置已保存', { description: '连接测试通过，可以开始用了' });
      // 留 600ms 让用户看到绿条，再关闭
      setTimeout(() => setOpen(false), 600);
    } catch (e: any) {
      setTestResult({ ok: false, msg: String(e?.message || e).slice(0, 200) });
    } finally {
      setTesting(false);
    }
  };

  const currentPreset = PRESETS.find((p) => p.id === draft.provider);

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
              <h2 className="text-lg font-semibold">AI 服务配置</h2>
              <button onClick={() => setOpen(false)} className="btn-ghost ml-auto p-1.5">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
              {/* Preset chips */}
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

              {/* API Key */}
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

              {/* Model（dropdown 模式） */}
              <Field
                label="模型"
                hint={currentPreset?.modelExamples.length ? '从预设挑或选 「其他…」 自定义' : '输入模型名'}
              >
                <ModelDropdown
                  preset={currentPreset}
                  value={draft.model}
                  onChange={(model) => setDraft({ ...draft, model })}
                />
              </Field>

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
                  {!draft.fastLane?.enabled && (
                    <span
                      className="ml-auto px-2 py-0.5 rounded-full bg-warn/15 border border-warn/40 text-[10px] font-medium text-warn"
                      title="启用本地 FastLane 后自动激活：运行时报错诊断 / 数据范围 sanity check / 题意偏离嗅探"
                    >
                      ⚠ 3 项嗅探休眠中
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
                    checked={!!draft.fastLane?.enabled}
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
                  <span className="text-[10px] text-ink-mute ml-auto">实时类任务走本地 Ollama</span>
                </label>
                <p className="text-[11px] text-ink-mute mb-3 pl-6 leading-relaxed">
                  <span className="text-ok">不启用也能完整使用 Coach</span>
                  ：所有任务走主云端服务。启用后，
                  代码批注 / 答疑 / 卡住引导 / 粘贴解释 走本地 Ollama（零成本、低延迟）；
                  题面解析 / 错题总结仍走主云端。命中下方「路由策略」任一阈值则跳云端保稳。
                </p>

                {/* 透明度提示：fastLane 未启用时，3 个主动嗅探 Agent 静默不工作 —— 显眼告诉用户 */}
                {!draft.fastLane?.enabled && (
                  <div className="ml-6 mb-3 px-3 py-2 rounded-md border border-line/60 bg-warn/5 text-[11px] leading-relaxed text-ink-mute">
                    <div className="font-semibold text-ink mb-0.5">
                      ⚠ 当前以下 3 个主动嗅探功能正在休眠：
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
                    </ul>
                    <div className="mt-1 opacity-80">
                      启用本地 FastLane 后自动激活，不会偷偷蹭主云端 token。
                    </div>
                  </div>
                )}

                {draft.fastLane?.enabled && (
                  <div className="pl-6 space-y-3">
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
                  </div>
                )}
              </div>

              {/* ━━ 🔀 路由策略（高级折叠） ━━ */}
              {draft.fastLane?.enabled && (
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
                  </div>
                )}
              </div>

              {/* ━━ 🎨 算法可视化模型（3 个工位独立可配） ━━ */}
              <details className="border-t border-line pt-4 group/algoviz">
                <summary className="cursor-pointer flex items-center gap-2 text-sm font-semibold list-none select-none mb-2 hover:text-accent transition">
                  <ChevronDown size={14} className="transition-transform -rotate-90 group-open/algoviz:rotate-0" />
                  <span>🎨 算法可视化模型</span>
                  <span className="chip text-[9px] px-1.5 py-0 ml-1">可选</span>
                  <span className="text-[10px] text-ink-mute font-normal ml-auto">
                    Status / Animation / Detect 三工位独立可配
                  </span>
                </summary>
                <p className="text-[11px] text-ink-mute mb-3 pl-6 leading-relaxed">
                  <span className="text-ok">不启用也能用</span>
                  ：默认 Status / Animation 走主云端（重活耗时长），Detect 走 fastLane（轻活高频）。
                  推荐把 <strong>Status / Animation</strong> 单独配成 DeepSeek-v4-pro（生成质量更稳）；
                  <strong> Detect</strong> 保持 fastLane 即可。
                </p>
                <div className="pl-6 space-y-4">
                  <AlgoVizRoleConfig
                    role="status"
                    label="Status 生成"
                    desc="一次性生成模块进度卡片（~20s，质量优先）"
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
                  <AlgoVizRoleConfig
                    role="detect"
                    label="实时模块检测"
                    desc="每 15s 跑一次，输出极短（轻活，速度优先）"
                    fallback="走 fastLane"
                    draft={draft}
                    setDraft={setDraft}
                  />
                </div>
              </details>

              {/* ━━ 💡 学习辅助 ━━ */}
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

              {/* ━━ ✨ Coach 主动嗅探（FastLane 专属） ━━ */}
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
                        <AlertTriangle size={9} /> fastLane 未配置 · 三个开关无效
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

                {/* A. 跑失败归因 */}
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

                {/* C. 数据范围 sanity */}
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

                {/* B. 题意偏离嗅探（最慎重，默认 OFF） */}
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
                </div>
              </details>
            </div>

            <div className="px-6 py-3 border-t border-line flex items-center justify-end gap-2">
              <button onClick={() => setOpen(false)} className="btn" disabled={testing}>
                取消
              </button>
              <button
                onClick={onSaveAndTest}
                disabled={
                  testing ||
                  !draft.baseUrl.trim() ||
                  !draft.model.trim() ||
                  (draft.provider !== 'ollama' && !draft.apiKey.trim())
                }
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
          {enabled ? `独立配置 · ${cur?.model || '未配 model'}` : `继承 ${fallback}`}
        </span>
      </label>
      <p className="text-[10.5px] text-ink-mute mt-1 pl-6 leading-relaxed">{desc}</p>
      {enabled && (
        <div className="pl-6 mt-2 space-y-2">
          {/* detect 工位每 15s 调一次，云端高频会持续烧 token；显式提示 */}
          {role === 'detect' && cur?.baseUrl && !isLocalUrl(cur.baseUrl) && (
            <div className="rounded border border-warn/50 bg-warn/10 px-2 py-1.5 text-[10.5px] text-warn leading-relaxed">
              ⚠️ <strong>不建议云端 detect</strong>：每 15 秒触发一次，长期使用会持续消耗云端 token。
              建议改用本地 Ollama 小模型（如 <code className="font-mono">http://localhost:11434/v1/chat/completions</code> + <code className="font-mono">qwen3:4b</code>）。
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
          <Field label="Model" hint={role === 'detect' ? '推荐本地小模型（如 qwen3:4b）' : '推荐 deepseek-v4-pro 或同等大模型'}>
            <input
              className="input font-mono text-xs"
              placeholder={role === 'detect' ? 'qwen3:4b' : 'deepseek-v4-pro'}
              value={cur?.model ?? ''}
              onChange={(e) => update({ model: e.target.value })}
            />
          </Field>
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
  const [models, setModels] = useState<string[] | null>(null);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const probe = useCallback(async () => {
    if (!baseUrl?.trim()) return;
    setProbing(true);
    setError(null);
    try {
      const target = baseUrl.replace(/\/+$/, '') + '/api/tags';
      const url = import.meta.env.DEV
        ? `/ai-proxy/${encodeURIComponent(target)}`
        : target;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (!Array.isArray(data?.models)) throw new Error('响应格式异常');
      const names: string[] = data.models
        .map((m: any) => m?.name)
        .filter((n: any): n is string => typeof n === 'string');
      setModels(names);
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
  }, [baseUrl]);

  // baseUrl 变化时清空旧探测结果（避免误导）
  useEffect(() => {
    setModels(null);
    setError(null);
  }, [baseUrl]);

  const hasOptions = models !== null && models.length > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-stretch gap-2">
        {hasOptions ? (
          <select
            className="input font-mono text-xs flex-1"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            {value && !models!.includes(value) && (
              <option value={value}>{value}（未安装）</option>
            )}
            {models!.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="input font-mono text-xs flex-1"
            placeholder={DEFAULT_AI_CONFIG.fastLane!.model}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        <button
          type="button"
          onClick={probe}
          disabled={probing || !baseUrl?.trim()}
          className="btn shrink-0"
          title="探测本地 Ollama 已 pull 的模型"
        >
          {probing ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          探测
        </button>
      </div>
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
