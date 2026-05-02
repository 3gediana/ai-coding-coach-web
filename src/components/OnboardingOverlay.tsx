/**
 * Onboarding 浮层：根据 store.onboardingStep 高亮当前该按的元素 + tooltip 引导
 *
 * 状态机：
 *   wait-analyze: 高亮 [data-onboarding="analyze"] 按钮，等用户点
 *   wait-edit:    监听 demo 题分析结果出现 → 提示用户改 bug 那行代码
 *   celebrate:    完成庆祝 toast 3 秒后 finishOnboarding
 *
 * 设计原则：
 * - 不挡用户操作（pointer-events: none），只指引
 * - Esc 跳过整个流程
 * - 每步 60 秒超时自动 finish（防止用户卡住忘了）
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../lib/store';
import { toast } from 'sonner';
import { X, Sparkles } from 'lucide-react';

const ONBOARDING_PROBLEM_ID = '__onboarding_two_sum__';
const STEP_TIMEOUT_MS = 90_000;

export function OnboardingOverlay() {
  const step = useStore((s) => s.onboardingStep);
  const advance = useStore((s) => s.advanceOnboarding);
  const finish = useStore((s) => s.finishOnboarding);
  const analysisByProblem = useStore((s) => s.analysisByProblem);
  const lastEditAt = useStore((s) => s.lastEditAt);

  // 高亮按钮位置（wait-analyze）
  const [analyzeRect, setAnalyzeRect] = useState<DOMRect | null>(null);
  // wait-edit 进入时的 lastEditAt baseline
  const [editBaseline, setEditBaseline] = useState<number | null>(null);

  // ── Esc 跳过 ──
  useEffect(() => {
    if (step === 'idle') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        finish();
        toast.info('已跳过引导，可在命令面板里重新打开');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [step, finish]);

  // ── 各步骤超时兜底 ──
  useEffect(() => {
    if (step === 'idle' || step === 'celebrate') return;
    const t = setTimeout(() => {
      finish();
      toast.info('引导已自动结束（可在命令面板重新打开）');
    }, STEP_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [step, finish]);

  // ── wait-analyze: 找按钮位置 + 监听 analysis 出现 → 推进 ──
  useEffect(() => {
    if (step !== 'wait-analyze') {
      setAnalyzeRect(null);
      return;
    }
    const update = () => {
      const el = document.querySelector('[data-onboarding="analyze"]') as HTMLElement | null;
      setAnalyzeRect(el?.getBoundingClientRect() ?? null);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(document.body);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [step]);

  // analysis 出现 → 进入 wait-edit
  useEffect(() => {
    if (step !== 'wait-analyze') return;
    const result = analysisByProblem[ONBOARDING_PROBLEM_ID];
    if (result && result.issues.length > 0) {
      // 进 wait-edit；记 baseline
      setEditBaseline(useStore.getState().lastEditAt);
      advance('wait-edit');
      toast.info('🔍 看，AI 给出了批注（行末文字）', {
        description: '试着改一下有问题的那行（j <= n 应该是 j < n）',
        duration: 6000,
      });
    }
  }, [step, analysisByProblem, advance]);

  // ── wait-edit: 等用户改代码 → celebrate ──
  useEffect(() => {
    if (step !== 'wait-edit') return;
    if (editBaseline === null) return;
    if (lastEditAt > editBaseline) {
      advance('celebrate');
    }
  }, [step, editBaseline, lastEditAt, advance]);

  // ── celebrate: 庆祝 toast + 3 秒后 finish ──
  useEffect(() => {
    if (step !== 'celebrate') return;
    toast.success('🎉 完成！这就是核心循环', {
      description:
        '其他隐藏技能：① 卡住时点顶部 💡 求助  ② 选中代码可问 AI  ③ 提交错误代码自动入错题本',
      duration: 6000,
    });
    const t = setTimeout(() => finish(), 3000);
    return () => clearTimeout(t);
  }, [step, finish]);

  // ── 渲染 ──
  if (step === 'idle' || step === 'celebrate') return null;

  return (
    <AnimatePresence>
      {step === 'wait-analyze' && analyzeRect && (
        <>
          {/* 按钮 ring pulse */}
          <motion.div
            key="ring"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="fixed pointer-events-none z-[60] rounded-lg"
            style={{
              left: analyzeRect.left - 6,
              top: analyzeRect.top - 6,
              width: analyzeRect.width + 12,
              height: analyzeRect.height + 12,
              boxShadow: '0 0 0 3px rgb(var(--c-accent) / 0.6), 0 0 18px 4px rgb(var(--c-accent) / 0.4)',
              animation: 'pulseGlow 1.6s ease-in-out infinite',
            }}
          />
          {/* tooltip 箭头 + 文字（按钮下方） */}
          <motion.div
            key="tip"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed z-[60] flex flex-col items-center gap-1"
            style={{
              left: analyzeRect.left + analyzeRect.width / 2 - 100,
              top: analyzeRect.bottom + 12,
              width: 200,
            }}
          >
            <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-b-[8px] border-l-transparent border-r-transparent border-b-accent" />
            <div className="bg-accent text-bg px-3 py-2 rounded-lg shadow-lg text-xs font-semibold flex items-center gap-1.5 pointer-events-auto">
              <Sparkles size={12} />
              <span>👇 点这里让 AI 看你的代码</span>
              <button
                onClick={() => {
                  finish();
                  toast.info('已跳过引导');
                }}
                className="ml-2 opacity-70 hover:opacity-100"
                title="跳过引导 (Esc)"
              >
                <X size={11} />
              </button>
            </div>
          </motion.div>
        </>
      )}

      {step === 'wait-edit' && (
        <motion.div
          key="edit-tip"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] glass-card px-4 py-2 flex items-center gap-2 pointer-events-auto"
        >
          <Sparkles size={14} className="text-accent" />
          <div className="text-xs">
            <span className="font-semibold">看代码行末的橙色批注</span>
            <span className="text-ink-mute ml-2">改一行，AI 会重新分析</span>
          </div>
          <button
            onClick={() => {
              finish();
              toast.info('已跳过引导');
            }}
            className="ml-2 btn-ghost p-1"
            title="跳过 (Esc)"
          >
            <X size={11} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
