import { test, expect } from './fixtures';

test('无 Ollama 模式：主流程可用，本地触点不调用 localhost:11434', async ({ page }) => {
  test.setTimeout(60_000);

  const localOllamaRequests: string[] = [];
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('127.0.0.1:11434') || url.includes('localhost:11434')) {
      localOllamaRequests.push(url);
      await route.fulfill({ status: 599, body: 'blocked by no-ollama spec' });
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__aiccStore, undefined, { timeout: 15_000 });

  const result = await page.evaluate(async () => {
    const store = (window as any).__aiccStore;
    const now = Date.now();
    const problemId = 'no-ollama-two-sum';
    const fileId = 'no-ollama-solution-cpp';
    const code = `#include <bits/stdc++.h>
using namespace std;
int main(){
  int n,target; cin>>n>>target;
  vector<int>a(n);
  for(int i=0;i<n;i++) cin>>a[i];
  unordered_map<int,int> mp;
  for(int i=0;i<n;i++){
    int need=target-a[i];
    if(mp.count(need)){ cout<<mp[need]<<" "<<i<<"\\n"; return 0; }
    mp[a[i]]=i;
  }
  return 0;
}`;

    store.getState().setAIConfig({
      ...store.getState().aiConfig,
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1/chat/completions',
      apiKey: 'sk-fake-key-for-no-ollama-spec',
      model: 'deepseek-chat',
      ollamaMode: 'disabled',
      fastLane: {
        enabled: true,
        baseUrl: 'http://localhost:11434/v1/chat/completions',
        model: 'qwen3.5:4b',
        numCtx: 8192,
      },
      intentRouter: {
        enabled: true,
        provider: 'ollama',
        baseUrl: 'http://localhost:11434/v1/chat/completions',
        model: 'qwen3.5:4b',
      },
      algoVizModels: {
        ...(store.getState().aiConfig.algoVizModels ?? {}),
        detect: {
          enabled: true,
          provider: 'ollama',
          baseUrl: 'http://localhost:11434/v1/chat/completions',
          apiKey: '',
          model: 'qwen3.5:4b',
          temperature: 0,
          maxTokens: 32,
        },
      },
    });

    store.setState({
      activeProblemId: problemId,
      activeFileIdByScope: { ...store.getState().activeFileIdByScope, [problemId]: fileId },
      filesByScope: {
        ...store.getState().filesByScope,
        [problemId]: [
          {
            id: fileId,
            problemId,
            name: 'solution.cpp',
            language: 'cpp',
            content: code,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
      problems: [
        ...store.getState().problems.filter((p: any) => p.id !== problemId),
        {
          id: problemId,
          title: '两数之和（No Ollama）',
          statement: '给定数组 nums 和 target，输出任意一组下标。',
          examples: [{ input: '4 9\n2 7 11 15', output: '0 1' }],
          difficulty: 'easy',
          tags: ['hash'],
          createdAt: now,
          plainExplanation: '哈希表。',
          coachOverview: { headline: '哈希找补数', notes: ['注意下标'], generatedAt: now },
          algoViz: {
            status: 'ready',
            statusCode: 'export default function StatusViz(){ return <div>实时点亮组件</div>; }',
            animationCode: null,
            detectionSchema: {
              algoName: 'TwoSum',
              modules: [
                { id: 'm1', label: '读入', description: '读取输入', detectHint: '是否读取 n,target 和数组' },
                { id: 'm2', label: '哈希表', description: '维护映射', detectHint: '是否声明并维护哈希表' },
              ],
            },
            statusGeneratedAt: now,
            animationGeneratedAt: now,
          },
        },
      ],
      lastRunByScope: {
        ...store.getState().lastRunByScope,
        [problemId]: {
          scope: problemId,
          fileId,
          stdin: '4 9\n2 7 11 15',
          stdout: '',
          stderr: 'AddressSanitizer: heap-buffer-overflow at line 7',
          exitCode: 1,
          durationMs: 12,
          ranAt: now,
        },
      },
    });

    const beforeTasks = store.getState().tasks.length;
    const beforeHints = (store.getState().coachHintsByScope[problemId] ?? []).length;

    await store.getState().detectAlgoVizModules(problemId, code);
    await store.getState().requestRuntimeDiagnosis(problemId);
    await store.getState().requestConstraintSanity(problemId);
    await store.getState().requestIntentSniff(problemId);
    const hackTaskId = store.getState().enqueueHackCase({ reason: 'no-ollama-spec' });

    await new Promise((r) => setTimeout(r, 250));

    return {
      ollamaMode: store.getState().aiConfig.ollamaMode,
      moduleStatus: store.getState().moduleStatusByProblem[problemId] ?? null,
      hintsAfter: (store.getState().coachHintsByScope[problemId] ?? []).length,
      beforeHints,
      hackTaskId,
      tasksDelta: store.getState().tasks.length - beforeTasks,
      pendingHackCase: store.getState().pendingHackCase,
      fastClientPresent: !!(store.getState().coach as any).aiFast,
      settingsOpen: store.getState().settingsOpen,
    };
  });

  expect(result.ollamaMode).toBe('disabled');
  expect(result.fastClientPresent).toBe(false);
  expect(result.moduleStatus).toBeNull();
  expect(result.hintsAfter).toBe(result.beforeHints);
  expect(result.hackTaskId).toBeNull();
  expect(result.tasksDelta).toBe(0);
  expect(result.pendingHackCase).toBeNull();
  expect(localOllamaRequests).toEqual([]);

  const serverMode = await page.evaluate(async () => {
    const res = await fetch('/__aicc-ollama-mode');
    return res.ok ? await res.json() : null;
  });
  expect(serverMode?.mode).toBe('disabled');

  await page.evaluate(() => (window as any).__aiccStore.getState().setFeedbackTab('algoviz'));
  await expect(page.getByText('算法动画').first()).toBeVisible();
  await expect(page.getByText('算法 0/2')).toHaveCount(0);
  await expect(page.getByText('实时点亮组件')).toHaveCount(0);
  await expect(page.getByText('schema 调试信息')).toHaveCount(0);
  await expect(page.getByText('动画还没生成，点上面「重新生成」开跑。')).toBeVisible();

  await page.evaluate(() => (window as any).__aiccStore.getState().setSettingsOpen(true));
  await expect(page.getByText('Ollama 模式').first()).toBeVisible();
  await expect(page.getByText('已关闭').first()).toBeVisible();
  await expect(page.getByText('纯云端模式 · 8 项本地 AI 功能已隔离，不会调云端兜底')).toBeVisible();
  await page.getByText('高级设置').click();
  await expect(page.getByText('Animation 保留 · Detect 已隐藏')).toBeVisible();
  await expect(page.getByText('实时模块检测')).toHaveCount(0);
  await expect(page.getByText('120s 卡住主动提醒')).toHaveCount(0);
  await expect(page.getByText('Coach 意图路由（AI 兜底）')).toHaveCount(0);
  await expect(page.getByText('Coach 主动嗅探（FastLane 专属）')).toHaveCount(0);
});
