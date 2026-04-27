import { useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { CodeEditor } from './components/CodeEditor';
import { FeedbackPanel } from './components/FeedbackPanel';
import { TaskTray } from './components/TaskTray';
import { SettingsModal } from './components/SettingsModal';
import { ProblemEditorModal } from './components/ProblemEditorModal';
import { useStore } from './lib/store';
import { toast } from 'sonner';

export default function App() {
  const aiConfig = useStore((s) => s.aiConfig);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);

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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <TopBar />
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <main className="flex-1 flex min-w-0">
          <div className="flex-1 min-w-0 flex flex-col">
            <CodeEditor />
          </div>
          <FeedbackPanel />
        </main>
      </div>
      <TaskTray />
      <SettingsModal />
      <ProblemEditorModal />
    </div>
  );
}
