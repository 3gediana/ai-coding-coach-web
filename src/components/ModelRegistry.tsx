/**
 * 模型注册制 UI 组件。
 *
 * - {@link ModelRegistrySection}: Settings 顶部"已注册模型"列表，含新建 / 编辑 / 删除
 * - {@link ModelPicker}: 各 agent slot 用的"分配下拉"——选已注册的或快速新建一个
 *
 * 设计原则：
 *   - 注册表是唯一来源；slot 只持有 modelId
 *   - 旧字段（baseUrl/apiKey/model）当 modelId 不为空时彻底隐藏，降低用户混淆
 *   - 新建模型默认 label 跟 provider 预设走，减少输入
 */
import { useState } from 'react';
import { Plus, Pencil, Trash2, X, Check, Database } from 'lucide-react';
import { cn } from '../lib/cn';
import { useStore } from '../lib/store';
import type { AIProvider, ModelEntry } from '../core/types';
import { PRESETS } from '../lib/presets';

const PROVIDER_LABELS: Record<AIProvider, string> = {
  deepseek: 'DeepSeek',
  minimax: 'MiniMax',
  openai: 'OpenAI',
  anthropic: 'Claude',
  google: 'Gemini',
  qwen: '通义',
  zhipu: '智谱',
  moonshot: 'Kimi',
  ollama: 'Ollama 本地',
  custom: '自定义',
};

interface FormState {
  id?: string;
  label: string;
  provider: AIProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  numCtx?: number;
}

const EMPTY_FORM: FormState = {
  label: '',
  provider: 'deepseek',
  baseUrl: PRESETS[0].baseUrl,
  apiKey: '',
  model: PRESETS[0].defaultModel,
};

/** Settings 顶部的"已注册模型"区块：列表 + 新建表单 */
export function ModelRegistrySection() {
  const registry = useStore((s) => s.aiConfig.modelRegistry ?? []);
  const registerModel = useStore((s) => s.registerModel);
  const updateModel = useStore((s) => s.updateModel);
  const removeModel = useStore((s) => s.removeModel);

  const [editing, setEditing] = useState<FormState | null>(null);

  const startCreate = () => setEditing({ ...EMPTY_FORM });
  const startEdit = (m: ModelEntry) =>
    setEditing({
      id: m.id,
      label: m.label,
      provider: m.provider,
      baseUrl: m.baseUrl,
      apiKey: m.apiKey,
      model: m.model,
      numCtx: m.numCtx,
    });
  const cancel = () => setEditing(null);

  const save = () => {
    if (!editing) return;
    if (!editing.label.trim() || !editing.baseUrl.trim() || !editing.model.trim()) return;
    if (editing.id) {
      updateModel(editing.id, {
        label: editing.label.trim(),
        provider: editing.provider,
        baseUrl: editing.baseUrl.trim(),
        apiKey: editing.apiKey.trim(),
        model: editing.model.trim(),
        numCtx: editing.numCtx,
      });
    } else {
      registerModel({
        label: editing.label.trim(),
        provider: editing.provider,
        baseUrl: editing.baseUrl.trim(),
        apiKey: editing.apiKey.trim(),
        model: editing.model.trim(),
        numCtx: editing.numCtx,
      });
    }
    setEditing(null);
  };

  return (
    <div className="border border-line/60 rounded-lg p-3 bg-bg-elev/40">
      <div className="flex items-center gap-2 mb-2">
        <Database size={14} className="text-accent" />
        <h3 className="text-sm font-semibold">模型注册表</h3>
        <span className="text-[10px] text-ink-mute ml-1">先注册，再分配给各 Agent</span>
        <button
          type="button"
          onClick={startCreate}
          className="chip cursor-pointer hover:border-accent/60 ml-auto text-[11px] px-2 py-0.5 flex items-center gap-1"
        >
          <Plus size={11} /> 注册新模型
        </button>
      </div>

      {registry.length === 0 && !editing && (
        <p className="text-[11px] text-ink-mute py-3 text-center">
          还没注册任何模型 — 点「注册新模型」开始
        </p>
      )}

      {registry.length > 0 && (
        <ul className="space-y-1.5">
          {registry.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded border border-line/40 bg-bg-base/50 text-[12px]"
            >
              <span className="font-medium text-ink truncate flex-1" title={`${m.baseUrl} · ${m.model}`}>
                {m.label}
              </span>
              <span className="chip text-[10px] px-1.5 py-0">{PROVIDER_LABELS[m.provider]}</span>
              <span className="text-[10px] text-ink-mute font-mono truncate max-w-[140px]" title={m.model}>
                {m.model}
              </span>
              <button
                type="button"
                onClick={() => startEdit(m)}
                className="btn-ghost p-1"
                title="编辑"
              >
                <Pencil size={11} />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`删除「${m.label}」？引用该模型的 Agent 会回到未配置状态。`)) {
                    removeModel(m.id);
                  }
                }}
                className="btn-ghost p-1 hover:text-bad"
                title="删除"
              >
                <Trash2 size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <div className="mt-3 border-t border-line/40 pt-3 space-y-2">
          <div className="text-[11px] font-semibold text-accent">
            {editing.id ? '编辑模型' : '注册新模型'}
          </div>

          {/* Provider 预设 chip */}
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  setEditing({
                    ...editing,
                    provider: p.id,
                    baseUrl: p.baseUrl,
                    model: editing.model || p.defaultModel,
                    label: editing.label || p.label,
                  })
                }
                className={cn(
                  'chip text-[10px] px-2 py-0.5 cursor-pointer hover:border-accent/60',
                  editing.provider === p.id && 'chip-accent',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <FormField label="显示名">
              <input
                className="input text-xs"
                placeholder="例如：DeepSeek 主力"
                value={editing.label}
                onChange={(e) => setEditing({ ...editing, label: e.target.value })}
              />
            </FormField>
            <FormField label="Model">
              <input
                className="input font-mono text-xs"
                placeholder="model-name"
                value={editing.model}
                onChange={(e) => setEditing({ ...editing, model: e.target.value })}
              />
            </FormField>
          </div>

          <FormField label="Base URL（完整 chat-completions endpoint）">
            <input
              className="input font-mono text-xs"
              placeholder="https://api.example.com/v1/chat/completions"
              value={editing.baseUrl}
              onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
            />
          </FormField>

          <FormField label="API Key（本地 ollama 可留空）">
            <input
              type="password"
              className="input font-mono text-xs"
              placeholder="sk-..."
              value={editing.apiKey}
              onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
            />
          </FormField>

          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={cancel} className="btn text-xs">
              <X size={12} /> 取消
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!editing.label.trim() || !editing.baseUrl.trim() || !editing.model.trim()}
              className="btn-primary text-xs ml-auto"
            >
              <Check size={12} /> 保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] text-ink-mute mb-0.5">{label}</span>
      {children}
    </label>
  );
}

/**
 * Slot 分配下拉：从注册表中选一个 model 分配给该 agent slot。
 *
 * - 选中：slot 完全按 registry 条目工作（旧的 baseUrl/apiKey/model 被忽略）
 * - 未选中：fallback 到 slot 自身的 baseUrl/apiKey/model 字段（兼容老 UI）
 *
 * @param value 当前选中的 modelId（undefined 表示未选）
 * @param onChange (modelId | undefined) => void
 * @param filter 可选 provider 过滤器：fastLane 工位只想列 ollama 模型时传 (m) => m.provider === 'ollama'
 */
export function ModelPicker({
  value,
  onChange,
  filter,
  placeholder,
}: {
  value: string | undefined;
  onChange: (modelId: string | undefined) => void;
  filter?: (m: ModelEntry) => boolean;
  placeholder?: string;
}) {
  const registry = useStore((s) => s.aiConfig.modelRegistry ?? []);
  const items = filter ? registry.filter(filter) : registry;

  return (
    <div className="flex items-center gap-1.5">
      <select
        className="input text-xs flex-1 cursor-pointer"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">{placeholder ?? '— 未分配 / 用下方手填 —'}</option>
        {items.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}（{PROVIDER_LABELS[m.provider]} · {m.model}）
          </option>
        ))}
      </select>
    </div>
  );
}
