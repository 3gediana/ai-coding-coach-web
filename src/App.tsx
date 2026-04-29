import { useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { FileTree } from './components/FileTree';
import { CodeEditor } from './components/CodeEditor';
import { FeedbackPanel } from './components/FeedbackPanel';
import { TaskTray } from './components/TaskTray';
import { SettingsModal } from './components/SettingsModal';
import { ProblemEditorModal } from './components/ProblemEditorModal';
import { ProblemBrowserModal } from './components/ProblemBrowserModal';
import { CommandPalette } from './components/CommandPalette';
import { DiffResultViewer } from './components/DiffResultViewer';
import { SubmitResultModal } from './components/SubmitResultModal';
import { StuckHintCard } from './components/StuckHintCard';
import { RuntimePane } from './components/RuntimePane';
import { OnboardingOverlay } from './components/OnboardingOverlay';
import { useStore } from './lib/store';
import { startImportReceiver, stopImportReceiver } from './lib/importReceiver';
import { toast } from 'sonner';

export default function App() {
  const aiConfig = useStore((s) => s.aiConfig);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const startOnboarding = useStore((s) => s.startOnboarding);

  useEffect(() => {
    if (!aiConfig.apiKey) {
      toast.message('欢迎使用 AI Coding Coach', {
        description: '请先配置 AI 服务（baseUrl + apiKey + model）',
        action: {
          label: '去设置',
          onClick: () => setSettingsOpen(true),
        },
        duration: 8000,
      });
      return;
    }
    // 已配置 AI 且没完成过 onboarding → 1.5s 后启动引导
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
    return () => stopImportReceiver();
  }, []);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <TopBar />
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <main className="flex-1 flex min-w-0">
          <FileTree />
          <div className="flex-1 min-w-0 flex flex-col">
            <CodeEditor />
            <RuntimePane />
          </div>
          <FeedbackPanel />
        </main>
      </div>
      <TaskTray />
      <SettingsModal />
      <ProblemEditorModal />
      <ProblemBrowserModal />
      <CommandPalette />
      <DiffResultViewer />
      <SubmitResultModal />
      <StuckHintCard />
      <OnboardingOverlay />
    </div>
  );
}
