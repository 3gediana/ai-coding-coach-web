import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import {
  Cpu,
  X,
  Activity,
  Bug,
  Ruler,
  Compass,
  Zap,
  Lightbulb,
  Image,
  Copy,
  ExternalLink,
  Check,
  PowerOff,
  Sparkles,
  ScanLine,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';
import { toast } from 'sonner';
import { safeGetItem, safeSetItem } from '../lib/safeLocalStorage';

const LS_KEY = 'aicc:ollama-intro-seen';

const FEATURES = [
  { icon: Activity, title: '实时模块点亮', desc: '算法可视化每 15s 自动检测代码到了哪步' },
  { icon: Bug, title: '运行时报错诊断', desc: 'exit ≠ 0 一键定位错误行 + 一句话提示' },
  { icon: Ruler, title: '数据范围 sanity check', desc: '样例通过后扫 TLE/MLE 风险' },
  { icon: Compass, title: '题意偏离嗅探', desc: '代码方向跑偏时 Coach 主动提醒' },
  { icon: Zap, title: 'FastLane 实时批注', desc: '前台批注 / 卡住引导 / 粘贴解释零延迟零成本' },
  { icon: Lightbulb, title: '意图路由器', desc: '小模型识别问题类型，路由到合适的工位' },
  { icon: ScanLine, title: 'AC 后 Hack Case', desc: '样例通过后本地生成极端测试挑战代码' },
  { icon: Image, title: '题目图片识别', desc: 'TM 推送的截图自动 OCR（qwen3.5）' },
];

const PULL_COMMANDS = [
  { label: 'qwen3.5:4b（推荐 · 4 GB · 通用快车道 + OJ 识图）', cmd: 'ollama pull qwen3.5:4b' },
];

export function OllamaIntroModal() {
  const aiConfig = useStore((s) => s.aiConfig);
  const setAIConfig = useStore((s) => s.setAIConfig);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const onboardingStep = useStore((s) => s.onboardingStep);

  const [open, setOpen] = useState(false);

  useEffect(() => {
    const seen = safeGetItem(LS_KEY) === '1';
    if (seen) return;
    const timer = setTimeout(() => {
      if (settingsOpen) return;
      if (onboardingStep && onboardingStep !== 'idle') return;
      setOpen(true);
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  function markSeen() {
    try {
      safeSetItem(LS_KEY, '1');
    } catch {
      /* ignore */
    }
  }

  function chooseEnabled() {
    setAIConfig({ ...aiConfig, ollamaMode: 'enabled' });
    markSeen();
    setOpen(false);
    toast.success('Ollama 模式已启用', {
      description: '8 项实时本地 AI 功能可用 · 任何时候都能在「设置」里切换',
      duration: 3500,
    });
  }

  function chooseDisabled() {
    setAIConfig({ ...aiConfig, ollamaMode: 'disabled' });
    markSeen();
    setOpen(false);
    toast.info('已切换为云端模式', {
      description: '8 项本地 AI 功能已隔离 · 装好 Ollama 后随时可在「设置」开启',
      duration: 4000,
    });
  }

  function chooseLater() {
    setOpen(false);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={chooseLater}
          className="fixed inset-0 z-[60] modal-overlay flex items-center justify-center p-6"
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-card w-full max-w-2xl max-h-[90vh] flex flex-col"
          >
            <div className="px-6 py-4 border-b border-line flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-warn/15 text-warn flex items-center justify-center">
                <Cpu size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  Coach 用本地 AI 加速实时反馈
                  <span className="chip text-[10px] px-1.5 py-0 border-warn/40 text-warn bg-warn/10">
                    1 步设置
                  </span>
                </h2>
                <p className="text-[11px] text-ink-mute mt-0.5">
                  本机装 Ollama 即可解锁 8 项零成本 / 低延迟的本地 AI；不装也能用云端模式
                </p>
              </div>
              <button onClick={chooseLater} className="btn-ghost p-1.5" title="稍后再说">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
              <div>
                <div className="text-xs font-semibold text-ink mb-2 flex items-center gap-1.5">
                  <Sparkles size={12} className="text-warn" />
                  装上 Ollama，立即解锁这 8 项
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {FEATURES.map((f) => {
                    const Icon = f.icon;
                    return (
                      <div
                        key={f.title}
                        className="flex items-start gap-2 rounded-md border border-line/60 bg-bg-elev/30 px-2.5 py-2"
                      >
                        <Icon size={13} className="text-warn shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-medium text-ink truncate">{f.title}</div>
                          <div className="text-[10.5px] text-ink-mute leading-snug mt-0.5">
                            {f.desc}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-lg border border-line bg-bg-elev/30 p-3 space-y-2.5">
                <div className="text-xs font-semibold flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-warn/15 text-warn text-[10px] flex items-center justify-center">
                    1
                  </span>
                  下载并安装 Ollama
                </div>
                <a
                  href="https://ollama.com/download"
                  target="_blank"
                  rel="noreferrer"
                  className="block text-[11px] text-ink-mute hover:text-warn pl-7 inline-flex items-center gap-1"
                >
                  ollama.com/download
                  <ExternalLink size={10} />
                </a>

                <div className="text-xs font-semibold flex items-center gap-1.5 pt-1">
                  <span className="w-5 h-5 rounded-full bg-warn/15 text-warn text-[10px] flex items-center justify-center">
                    2
                  </span>
                  Pull 推荐模型（首次约 5-10 分钟）
                </div>
                <div className="pl-7 space-y-1.5">
                  {PULL_COMMANDS.map((p) => (
                    <PullRow key={p.cmd} cmd={p.cmd} label={p.label} />
                  ))}
                </div>

                <div className="text-xs font-semibold flex items-center gap-1.5 pt-1">
                  <span className="w-5 h-5 rounded-full bg-warn/15 text-warn text-[10px] flex items-center justify-center">
                    3
                  </span>
                  确认 Ollama 在跑（11434 端口）
                </div>
                <p className="pl-7 text-[11px] text-ink-mute">
                  装完默认会启动后台服务；如未启动，命令行跑 <code className="text-warn">ollama serve</code>
                </p>
              </div>

              <div className="rounded-lg border border-line/60 bg-line/[0.05] p-3">
                <div className="text-xs font-semibold flex items-center gap-1.5 text-ink-mute">
                  <PowerOff size={12} />
                  不想装也行
                </div>
                <p className="text-[11px] text-ink-mute mt-1.5 leading-relaxed">
                  选「云端模式」后，8 项实时功能会被精确隔离（不会偷偷调云端），
                  录题 / 算法可视化生成 / WA 错题归档 / AC 复盘 / 学情诊断 等
                  <strong className="text-ink"> 核心功能仍可用</strong>，
                  只是少了实时点亮、报错诊断等贴身辅助。
                </p>
              </div>
            </div>

            <div className="border-t border-line px-6 py-3 flex items-center gap-2 flex-wrap">
              <button
                onClick={chooseEnabled}
                className="btn-primary flex-1 min-w-[140px] flex items-center justify-center gap-1.5"
              >
                <Check size={14} />
                已装好 Ollama，开启
              </button>
              <button
                onClick={chooseDisabled}
                className="btn-ghost flex-1 min-w-[140px] flex items-center justify-center gap-1.5"
              >
                <PowerOff size={14} />
                暂不装，用云端模式
              </button>
              <button
                onClick={chooseLater}
                className="text-[11px] text-ink-mute hover:text-ink px-2"
                title="下次启动还会问"
              >
                稍后再说
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PullRow({ cmd, label }: { cmd: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 group">
      <code className="flex-1 text-[11px] font-mono bg-line/30 rounded px-2 py-1 text-ink truncate">
        {cmd}
      </code>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(cmd).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className={cn(
          'shrink-0 p-1.5 rounded hover:bg-line/40 transition',
          copied ? 'text-ok' : 'text-ink-mute',
        )}
        title="复制命令"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
      <span className="text-[10px] text-ink-mute shrink-0 hidden sm:inline">{label}</span>
    </div>
  );
}
