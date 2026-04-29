import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { X, ScrollText, Wand2, Loader2, Link as LinkIcon, Download } from 'lucide-react';
import { toast } from 'sonner';
import { fetchAndParseProblem, detectSite, isFetchableSite, FetchProblemError } from '../lib/fetchProblem';
import { storage } from '../lib/storage';
import type { Problem } from '../core/types';
import { nanoid } from 'nanoid';

export function ProblemEditorModal() {
  const open = useStore((s) => s.problemEditorOpen);
  const setOpen = useStore((s) => s.setProblemEditorOpen);
  const enqueueParseProblem = useStore((s) => s.enqueueParseProblem);
  const aiOk = useStore((s) =>
    s.aiConfig.provider === 'ollama' ? !!s.aiConfig.baseUrl : !!s.aiConfig.apiKey,
  );
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);

  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);

  // 重置
  useEffect(() => {
    if (open) {
      setText('');
      setUrl('');
      setFetching(false);
    }
  }, [open]);

  const detected = url.trim() ? detectSite(url.trim()) : { site: 'unsupported' as const };
  const SITE_LABEL: Record<string, string> = {
    luogu: '洛谷', atcoder: 'AtCoder', poj: 'POJ', hdu: 'HDU',
    'unsupported-cf': 'Codeforces', 'unsupported-leetcode': 'LeetCode', 'unsupported-nowcoder': '牛客',
    unsupported: '',
  };
  const UNSUPPORTED_HINT: Record<string, string> = {
    'unsupported-cf': 'CF 反爬严 — 请打开题面页复制全文，粘到下方文本框走 AI 解析',
    'unsupported-leetcode': 'LeetCode 是 SPA — 请复制题面【描述 + 示例】到下方文本框',
    'unsupported-nowcoder': '牛客需登录 — 请复制题面到下方文本框',
    unsupported: '不识别该站 — 请复制题面到下方文本框',
  };
  const fetchable = isFetchableSite(detected.site);

  const refreshProblems = useStore((s) => s.refreshProblems);
  const setActiveProblem = useStore((s) => s.setActiveProblem);

  const onFetch = async () => {
    const u = url.trim();
    if (!u) return;
    setFetching(true);
    try {
      const p = await fetchAndParseProblem(u);
      // 直接转为 Problem 并入库（跳过 LLM）
      const problem: Problem = {
        id: nanoid(),
        title: p.title,
        statement: p.statement,
        constraints: p.constraints,
        examples: p.examples,
        tags: p.tags,
        source: p.source.url,
        difficulty: undefined,
        createdAt: Date.now(),
      };
      await storage.saveProblem(problem);
      await refreshProblems();
      await setActiveProblem(problem.id);
      toast.success(`已录入：${p.title}`, {
        description: `抓取耗时 ${p.meta?.ms ?? '?'}ms，来源：${p.source.site}`,
      });
      setOpen(false);
    } catch (e) {
      if (e instanceof FetchProblemError) {
        if (e.code === 'unsupported') {
          toast.error('不支持该站点', { description: e.message, duration: 8000 });
        } else {
          toast.error(`抓取失败 (${e.code})`, { description: e.message });
        }
      } else {
        toast.error('抓取失败', { description: String((e as any)?.message || e) });
      }
    } finally {
      setFetching(false);
    }
  };

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !fetching) {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen, fetching]);

  const onSubmit = () => {
    if (text.trim().length < 8) {
      toast.error('题目太短，多粘点');
      return;
    }
    if (!aiOk) {
      toast.error('请先配置 AI');
      setOpen(false);
      setSettingsOpen(true);
      return;
    }
    enqueueParseProblem(text);
    toast.success('解析任务已加入队列，可继续敲代码');
    setText('');
    setOpen(false);
  };

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
            className="glass-card w-full max-w-3xl max-h-[88vh] flex flex-col"
          >
            <div className="px-6 py-4 border-b border-line flex items-center gap-3">
              <ScrollText size={18} className="text-cyan" />
              <h2 className="text-lg font-semibold">录入题目</h2>
              <span className="ml-auto text-xs text-ink-mute">解析在后台跑，不会卡住编辑器</span>
              <button onClick={() => setOpen(false)} className="btn-ghost p-1.5">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {/* URL 一键抓题 */}
              <div className="rounded-md border border-line bg-bg-elev/40 p-3 space-y-2">
                <div className="flex items-center gap-2 text-[12px] font-semibold text-ink">
                  <LinkIcon size={13} className="text-cyan" />
                  从 OJ URL 抓题
                  <span className="ml-auto text-[10px] text-ink-mute font-normal">
                    支持 洛谷 / AtCoder / POJ / HDU
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    className="input font-mono text-[12px] flex-1"
                    placeholder="https://www.luogu.com.cn/problem/P1001  |  https://atcoder.jp/contests/abc100/tasks/abc100_a"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && fetchable && !fetching) {
                        e.preventDefault();
                        onFetch();
                      }
                    }}
                    disabled={fetching}
                  />
                  <button
                    onClick={onFetch}
                    disabled={!fetchable || fetching || !url.trim()}
                    className="btn-primary shrink-0"
                    title={!fetchable ? '该站不支持自动抓取，请复制题面到下方文本框' : '拉取题面并自动录入（无需 AI）'}
                  >
                    {fetching ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                    {fetching ? '抓取中…' : '抓取'}
                  </button>
                </div>
                {url.trim() && (
                  <div className="text-[11px] text-ink-mute">
                    {fetchable
                      ? <span className="text-ok">✓ 识别为 {SITE_LABEL[detected.site]}{detected.pid ? ` · ${detected.pid}` : ''}，点「抓取」直接入库（无需走 AI）</span>
                      : detected.site === 'unsupported'
                        ? <span className="text-warn">⚠ {UNSUPPORTED_HINT.unsupported}</span>
                        : <span className="text-warn">⚠ 识别为 {SITE_LABEL[detected.site]}{detected.pid ? ` · ${detected.pid}` : ''} — {UNSUPPORTED_HINT[detected.site]}</span>}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 text-[10px] text-ink-mute">
                <div className="h-px flex-1 bg-line" />
                <span>或手动粘贴</span>
                <div className="h-px flex-1 bg-line" />
              </div>

              <div>
                <div className="label">题面（粘贴 OJ 题目原文，AI 自动结构化）</div>
                <textarea
                  className="input font-mono text-xs resize-none"
                  rows={18}
                  placeholder={`示例：

两数之和

给定一个整数数组 nums 和一个整数目标值 target，请在该数组中找出和为目标值的那两个整数，并返回它们的数组下标。

约束：
2 <= nums.length <= 10^4
-10^9 <= nums[i] <= 10^9

示例：
输入：nums = [2,7,11,15], target = 9
输出：[0,1]`}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="text-xs text-ink-mute leading-relaxed">
                <p>
                  <strong className="text-ink">提示：</strong>
                  AI 会从原文提取标题、约束、示例、知识点标签和难度等信息。
                  解析过程通常 30–60s（依赖 AI 服务），过程中你可以
                  <span className="text-accent-glow"> 直接关闭弹窗继续敲代码 </span>—— 解析完会自动激活该题目。
                </p>
              </div>
            </div>

            <div className="px-6 py-3 border-t border-line flex items-center justify-between">
              <div className="text-[11px] text-ink-mute">
                {text.length > 0 && (
                  <span>
                    {text.length} 字符 · {text.split('\n').length} 行
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setOpen(false)} className="btn">
                  取消
                </button>
                <button onClick={onSubmit} className="btn-primary">
                  <Wand2 size={14} />
                  解析（异步）
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
