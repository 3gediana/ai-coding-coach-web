import { useEffect, useRef } from 'react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { FileTree } from './components/FileTree';
import { CodeEditor } from './components/CodeEditor';
import { FeedbackPanel } from './components/FeedbackPanel';
import { TaskTray } from './components/TaskTray';
import { HackCaseCard } from './components/HackCaseCard';
import { HackChainModal } from './components/HackChainModal';
import { AcReviewCard } from './components/AcReviewCard';
import { DailyReviewCard } from './components/DailyReviewCard';
import { DailyPlanCard } from './components/DailyPlanCard';
import { FeynmanModal } from './components/FeynmanModal';
import { SettingsModal } from './components/SettingsModal';
import { ProblemEditorModal } from './components/ProblemEditorModal';
import { ProblemBrowserModal } from './components/ProblemBrowserModal';
import { CommandPalette } from './components/CommandPalette';
import { DiffResultViewer } from './components/DiffResultViewer';
import { SubmitResultModal } from './components/SubmitResultModal';
import { StuckHintCard } from './components/StuckHintCard';
import { IntentSnifferCard } from './components/IntentSnifferCard';
import { QuickSetupCard } from './components/QuickSetupCard';
import { ProblemOverviewCard } from './components/ProblemOverviewCard';
import { RuntimePane } from './components/RuntimePane';
import { OnboardingOverlay } from './components/OnboardingOverlay';
import { OllamaIntroModal } from './components/OllamaIntroModal';
import { OfflineBanner } from './components/OfflineBanner';
import { ErrorBoundary } from './components/ErrorBoundary';
import { hasUsableAIConfig, useStore } from './lib/store';
import { startImportReceiver, stopImportReceiver } from './lib/importReceiver';
import { startOjBridgeReceiver, stopOjBridgeReceiver } from './lib/ojBridge';
import { loadDemoSeed } from './lib/demoSeed';
import {
  collectLocalOllamaTargets,
  unloadLocalModels,
  warmupLocalModels,
} from './core/ai/warmup';
import { toast } from 'sonner';
import { safeGetItem } from './lib/safeLocalStorage';

export default function App() {
  const aiConfig = useStore((s) => s.aiConfig);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const startOnboarding = useStore((s) => s.startOnboarding);
  const multiFileMode = useStore((s) => s.multiFileMode);
  const dailyPlan = useStore((s) => s.dailyPlan);
  const dailyPlanGenerating = useStore((s) => s.dailyPlanGenerating);
  const pendingHackCase = useStore((s) => s.pendingHackCase);
  const warmTargetsRef = useRef<ReturnType<typeof collectLocalOllamaTargets>>([]);
  const lastWarmResultKeyRef = useRef<string>('');
  const isLocalBrowser =
    typeof window === 'undefined' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '::1';
  // 派生 key：只有本地 Ollama 目标 / ollamaMode 变化时才重新 warm，避免 temperature 等无关字段触发
  const warmDepKey = (() => {
    const mode = !isLocalBrowser || aiConfig.ollamaMode === 'disabled' ? 'disabled' : 'enabled';
    const targets =
      mode === 'disabled'
        ? []
        : collectLocalOllamaTargets(aiConfig).map((t) => `${t.baseUrl}|${t.model}`);
    return `${mode}:${targets.sort().join(',')}`;
  })();
  const dailyPlanBlocksOverlay =
    (dailyPlanGenerating && !dailyPlan) || dailyPlan?.status === 'pending';
  const hackCaseBlocksOverlay =
    !dailyPlanBlocksOverlay && !!pendingHackCase && aiConfig.ollamaMode !== 'disabled';

  // 启动后预热所有本地 ollama 工位（fastLane / intentRouter / algoViz.detect 等）。
  // 不阻塞首屏；并行 warm；失败静默。配置变更时也重新 warm（用户切换模型后立即生效）。
  useEffect(() => {
    let cancelled = false;
    const targets = !isLocalBrowser || aiConfig.ollamaMode === 'disabled' ? [] : collectLocalOllamaTargets(aiConfig);
    const targetKey = (t: (typeof targets)[number]) => `${t.baseUrl}|${t.model}`;
    const nextKeys = new Set(targets.map(targetKey));
    const removedTargets = warmTargetsRef.current.filter((t) => !nextKeys.has(targetKey(t)));
    warmTargetsRef.current = targets;
    if (typeof window !== 'undefined' && isLocalBrowser) {
      const mode = aiConfig.ollamaMode === 'disabled' ? 'disabled' : 'enabled';
      // dev / preview 都挂了 /__aicc-ollama-mode 中间件；生产部署没有也不会影响业务，fetch catch 静默
      const notifyMode = () =>
        fetch('/__aicc-ollama-mode', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode }),
        }).catch(() => undefined);
      if (mode === 'disabled' && removedTargets.length > 0) {
        void unloadLocalModels(removedTargets).finally(() => {
          void notifyMode();
        });
      } else {
        void notifyMode();
        if (removedTargets.length > 0) {
          void unloadLocalModels(removedTargets);
        }
      }
    }
    const timer = setTimeout(() => {
      if (cancelled) return;
      if (!isLocalBrowser) return;
      void warmupLocalModels(aiConfig).then((results) => {
        if (cancelled || results.length === 0) return;
        const okCount = results.filter((r) => r.ok).length;
        const message = results.map((r) => `${r.label}/${r.model}: ${r.ok ? r.latencyMs + 'ms' : r.error ?? '失败'}`).join('\n');
        const resultKey = results.map((r) => `${r.label}:${r.model}:${r.ok}:${r.error ?? ''}`).join('|');
        if (resultKey === lastWarmResultKeyRef.current) return;
        lastWarmResultKeyRef.current = resultKey;
        if (okCount === results.length) {
          toast.success(`本地模型已预热：${results[0].model}`, {
            description: `已加载到 Ollama keep_alive=24h；首次实时调用不再冷启动。`,
            duration: 3000,
          });
        } else {
          toast.error(`本地模型预热失败：${okCount}/${results.length} 就绪`, {
            description: message,
            duration: 3000,
          });
        }
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // 仅依赖派生 key + ollamaMode：改 temperature/timeoutMs/maxTokens 等无关字段不会反复预热
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warmDepKey, isLocalBrowser]);

  // 注意：以前这里监听 pagehide 自动卸载本地模型，导致每次刷新/关 tab 都要冷启 3-5s。
  // 现在交给 Ollama 自己的 keep_alive=24h 管理；用户可在设置里显式切到"无 Ollama 模式"来释放显存。

  // ?seed=demo：清空 IndexedDB 并注入 5 题 + 错题 + 7 天学习记录，然后 reload
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('seed') !== 'demo') return;
    let cancelled = false;
    void (async () => {
      try {
        toast.message('正在加载演示数据…', {
          description: '清空当前数据库并注入 5 道题 + 错题 + 7 天学习记录',
          duration: 2000,
        });
        await loadDemoSeed();
        if (cancelled) return;
        // 清掉 ?seed=demo 避免每次 reload 都重置数据
        const url = new URL(window.location.href);
        url.searchParams.delete('seed');
        window.location.replace(url.toString());
      } catch (e) {
        toast.error('Demo 数据加载失败', {
          description: String((e as Error)?.message ?? e),
          duration: 3000,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 已配置 AI 且没完成过 onboarding → 1.5s 后启动引导。
  // 未配置时不弹 toast 了 —— QuickSetupCard 会在编辑器中央自己浮现，更醒目。
  useEffect(() => {
    if (!hasUsableAIConfig(aiConfig)) return;
    if (safeGetItem('aicc.onboarding.v1') !== 'done') {
      const t = setTimeout(() => {
        void startOnboarding();
      }, 1500);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // B 路线：每天首次开 app 触发学习规划 Agent（已配 AI + 今日 plan 缺失时）
  useEffect(() => {
    if (!hasUsableAIConfig(aiConfig)) return;
    // 等其它 effect / mount 稳定后再触发，避免和 onboarding 抢焦点
    const t = setTimeout(() => {
      void useStore.getState().requestDailyPlan();
    }, 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 启动 TM 推送的 SSE 订阅（仅 dev）
  useEffect(() => {
    startImportReceiver();
    startOjBridgeReceiver();
    return () => {
      stopImportReceiver();
      stopOjBridgeReceiver();
    };
  }, []);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <ErrorBoundary title="顶部栏异常" compact>
        <TopBar />
      </ErrorBoundary>
      <ErrorBoundary title="离线提示异常" compact>
        <OfflineBanner />
      </ErrorBoundary>
      <div className="flex-1 flex min-h-0">
        <ErrorBoundary title="侧边栏异常" compact>
          <Sidebar />
        </ErrorBoundary>
        <main className="flex-1 flex min-w-0">
          {multiFileMode && (
            <ErrorBoundary title="文件树异常" compact>
              <FileTree />
            </ErrorBoundary>
          )}
          <div className="flex-1 min-w-0 flex flex-col relative">
            <ErrorBoundary title="编辑区异常" compact>
              {/* P1 题眼速读卡：激活题目时云端生成的「头条 + 注意点」，固定在编辑器顶部 */}
              <ProblemOverviewCard />
              <CodeEditor />
              <RuntimePane />
              {/* QuickSetupCard 只在 !hasUsableAIConfig 时浮现在这个区域 */}
              <QuickSetupCard />
            </ErrorBoundary>
          </div>
          <ErrorBoundary title="反馈面板异常" compact>
            <FeedbackPanel />
          </ErrorBoundary>
        </main>
      </div>
      <ErrorBoundary title="任务队列异常" compact>
        <TaskTray />
      </ErrorBoundary>
      <ErrorBoundary title="Hack 提示异常" compact>
        {!dailyPlanBlocksOverlay && <HackCaseCard />}
      </ErrorBoundary>
      <ErrorBoundary title="Hack Chain 弹窗异常" compact>
        <HackChainModal />
      </ErrorBoundary>
      <ErrorBoundary title="AC 复盘异常" compact>
        <AcReviewCard />
      </ErrorBoundary>
      <ErrorBoundary title="每日复习异常" compact>
        <DailyReviewCard />
      </ErrorBoundary>
      <ErrorBoundary title="学习计划异常" compact>
        <DailyPlanCard />
      </ErrorBoundary>
      <ErrorBoundary title="费曼弹窗异常" compact>
        <FeynmanModal />
      </ErrorBoundary>
      <ErrorBoundary title="设置弹窗异常" compact>
        <SettingsModal />
      </ErrorBoundary>
      <ErrorBoundary title="题目录入异常" compact>
        <ProblemEditorModal />
      </ErrorBoundary>
      <ErrorBoundary title="题库浏览异常" compact>
        <ProblemBrowserModal />
      </ErrorBoundary>
      <ErrorBoundary title="命令面板异常" compact>
        <CommandPalette />
      </ErrorBoundary>
      <ErrorBoundary title="对比结果异常" compact>
        <DiffResultViewer />
      </ErrorBoundary>
      <ErrorBoundary title="提交结果异常" compact>
        <SubmitResultModal />
      </ErrorBoundary>
      <ErrorBoundary title="卡住提示异常" compact>
        <StuckHintCard />
      </ErrorBoundary>
      <ErrorBoundary title="意图提示异常" compact>
        <IntentSnifferCard />
      </ErrorBoundary>
      <ErrorBoundary title="引导浮层异常" compact>
        <OnboardingOverlay />
      </ErrorBoundary>
      <ErrorBoundary title="Ollama 引导异常" compact>
        {isLocalBrowser && !dailyPlanBlocksOverlay && !hackCaseBlocksOverlay && <OllamaIntroModal />}
      </ErrorBoundary>
    </div>
  );
}
