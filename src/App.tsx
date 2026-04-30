import { useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { FileTree } from './components/FileTree';
import { CodeEditor } from './components/CodeEditor';
import { FeedbackPanel } from './components/FeedbackPanel';
import { TaskTray } from './components/TaskTray';
import { HackCaseCard } from './components/HackCaseCard';
import { AcReviewCard } from './components/AcReviewCard';
import { DailyReviewCard } from './components/DailyReviewCard';
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
import { useStore } from './lib/store';
import { startImportReceiver, stopImportReceiver } from './lib/importReceiver';
import { startOjBridgeReceiver, stopOjBridgeReceiver } from './lib/ojBridge';
import { loadDemoSeed } from './lib/demoSeed';
import { toast } from 'sonner';

export default function App() {
  const aiConfig = useStore((s) => s.aiConfig);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const startOnboarding = useStore((s) => s.startOnboarding);

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
          duration: 6000,
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
    const usable =
      aiConfig.provider === 'ollama'
        ? !!aiConfig.baseUrl?.trim()
        : !!aiConfig.apiKey?.trim();
    if (!usable) return;
    if (localStorage.getItem('aicc.onboarding.v1') !== 'done') {
      const t = setTimeout(() => {
        void startOnboarding();
      }, 1500);
      return () => clearTimeout(t);
    }
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
      <TopBar />
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <main className="flex-1 flex min-w-0">
          <FileTree />
          <div className="flex-1 min-w-0 flex flex-col relative">
            {/* P1 题眼速读卡：激活题目时云端生成的「头条 + 注意点」，固定在编辑器顶部 */}
            <ProblemOverviewCard />
            <CodeEditor />
            <RuntimePane />
            {/* QuickSetupCard 只在 !hasUsableAIConfig 时浮现在这个区域 */}
            <QuickSetupCard />
          </div>
          <FeedbackPanel />
        </main>
      </div>
      <TaskTray />
      <HackCaseCard />
      <AcReviewCard />
      <DailyReviewCard />
      <SettingsModal />
      <ProblemEditorModal />
      <ProblemBrowserModal />
      <CommandPalette />
      <DiffResultViewer />
      <SubmitResultModal />
      <StuckHintCard />
      <IntentSnifferCard />
      <OnboardingOverlay />
    </div>
  );
}
