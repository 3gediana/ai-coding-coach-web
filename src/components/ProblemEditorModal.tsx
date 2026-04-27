import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { useStore } from '../lib/store';
import { X, ScrollText, Wand2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export function ProblemEditorModal() {
  const open = useStore((s) => s.problemEditorOpen);
  const setOpen = useStore((s) => s.setProblemEditorOpen);
  const enqueueParseProblem = useStore((s) => s.enqueueParseProblem);
  const aiOk = useStore((s) => !!s.aiConfig.apiKey);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);

  const [text, setText] = useState('');

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
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
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
