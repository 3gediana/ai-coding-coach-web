import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';
import { useStore } from '../lib/store';
import { PRESETS } from '../lib/presets';
import type { AIConfig, AIProvider } from '../core/types';
import { cn } from '../lib/cn';
import { X, Eye, EyeOff, ExternalLink, Check, Loader2, Sparkles, Zap, Settings2 } from 'lucide-react';
import { AIClient } from '../core/ai/client';
import { toast } from 'sonner';
import { DEFAULT_ROUTER_HINTS } from '../core/ai/router';

export function SettingsModal() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const cfg = useStore((s) => s.aiConfig);
  const setCfg = useStore((s) => s.setAIConfig);

  const [draft, setDraft] = useState<AIConfig>(cfg);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

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

  const onSave = () => {
    if (!draft.baseUrl.trim()) return toast.error('Base URL 不能为空');
    if (!draft.apiKey.trim()) return toast.error('API Key 不能为空');
    if (!draft.model.trim()) return toast.error('Model 不能为空');
    // fastLane 启用了就必须填全
    if (draft.fastLane?.enabled) {
      if (!draft.fastLane.baseUrl?.trim()) return toast.error('FastLane Base URL 不能为空');
      if (!draft.fastLane.model?.trim()) return toast.error('FastLane 模型不能为空');
    }
    setCfg(draft);
    toast.success('AI 配置已保存');
    setOpen(false);
  };

  const onTest = async () => {
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
      setTestResult({ ok: true, msg: `成功：${text.trim().slice(0, 60) || '(空响应)'}` });
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

              {/* Base URL */}
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
              </Field>

              {/* Model */}
              <Field label="Model" hint="OpenAI 兼容的模型名">
                <input
                  className="input font-mono text-xs"
                  placeholder="deepseek-chat"
                  value={draft.model}
                  onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                  list="model-suggestions"
                />
                <datalist id="model-suggestions">
                  {currentPreset?.modelExamples.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                {currentPreset && currentPreset.modelExamples.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {currentPreset.modelExamples.map((m) => (
                      <button
                        key={m}
                        onClick={() => setDraft({ ...draft, model: m })}
                        className="chip text-[10px] hover:border-accent/40 cursor-pointer"
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </Field>

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
                          baseUrl: 'http://localhost:11434',
                          model: 'sam:latest',
                          ...(draft.fastLane ?? {}),
                          enabled: e.target.checked,
                        },
                      })
                    }
                  />
                  <Zap size={14} className="text-warn" />
                  <span className="text-sm font-semibold">本地快车道（FastLane）</span>
                  <span className="text-[10px] text-ink-mute ml-auto">实时类任务走本地 Ollama</span>
                </label>
                <p className="text-[11px] text-ink-mute mb-3 pl-6">
                  代码批注 / 答疑 / 卡住引导 / 粘贴解释 走本地 Ollama；
                  题面解析 / 错题总结仍走主云端。命中下方"路由策略"任一阈值则跳云端保稳。
                </p>

                {draft.fastLane?.enabled && (
                  <div className="pl-6 space-y-3">
                    <Field label="Base URL" hint="必须本地（localhost / 127.* / 局域网）">
                      <input
                        className="input font-mono text-xs"
                        placeholder="http://localhost:11434"
                        value={draft.fastLane.baseUrl}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            fastLane: { ...draft.fastLane!, baseUrl: e.target.value },
                          })
                        }
                      />
                    </Field>
                    <Field label="模型" hint="ollama 已 pull 过的模型名">
                      <input
                        className="input font-mono text-xs"
                        placeholder="sam:latest"
                        value={draft.fastLane.model}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            fastLane: { ...draft.fastLane!, model: e.target.value },
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
            </div>

            <div className="px-6 py-3 border-t border-line flex items-center justify-end gap-2">
              <button
                onClick={onTest}
                disabled={testing || !draft.baseUrl || !draft.apiKey}
                className="btn"
              >
                {testing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                测试连接
              </button>
              <button onClick={() => setOpen(false)} className="btn">
                取消
              </button>
              <button onClick={onSave} className="btn-primary">
                保存
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
