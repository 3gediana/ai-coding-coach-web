/**
 * algoViz 三段 prompt：
 *   1. buildStatusPrompt    — 一次输出 Status 组件 + detectionSchema（用 ___SCHEMA___ 分隔）
 *   2. buildAnimationPrompt — 携带 Status 代码生成 Remotion Animation（保证模块定义一致）
 *   3. buildDetectPrompt    — 实时检测：给小模型代码 + schema，输出极短"0/1"序列
 *
 * 设计要点：
 *   - Status 和 Schema 在一次调用里产出 → 避免两次调用之间模块定义漂移
 *   - Detect 强制极短输出（"1011" 4 字符），靠 system prompt 收死小模型行为
 *   - 用户写代码不充分时，detect 必须输出全 0（"0000"），不许猜
 */
import type { AlgoVizDetectionSchema, ProblemExample } from '../core/types';

// ──────────────────────────────────────────────────────────────────────
// 1) Status + Schema
// ──────────────────────────────────────────────────────────────────────

const STATUS_SYSTEM = `You generate TWO outputs for an algorithm visualization system:

1) A static React component (the "Status panel")
2) A JSON detection schema describing modules

Output format MUST be exactly:
<STATUS_TSX>
[the React component code, no markdown fence]
</STATUS_TSX>
<SCHEMA_JSON>
[a JSON object, no markdown fence]
</SCHEMA_JSON>

────────  STATUS COMPONENT RULES  ────────
- A SINGLE default-exported React functional component, no Remotion, no animation hooks
- Props: { module1?: boolean; module2?: boolean; module3?: boolean; module4?: boolean; module5?: boolean }, all default false
- Render a vertical stack of cards (one per module), ~300px wide, dark theme
- Active card style:   borderColor #22c55e, opacity 1,    boxShadow 0 0 12px rgba(34,197,94,0.3)
- Inactive card style: borderColor #475569, opacity 0.35, boxShadow none
- Each card shows: module index, label (15px), description (13px)
- Background #0f172a; cards #1e293b; text white / #94a3b8
- Use INLINE styles only (no className, no external CSS, no Tailwind) — runtime sandbox can't load Tailwind
- After all modules active, render a small "ALL MODULES READY" badge at bottom
- NO imports beyond React (use the global React from the sandbox window). Begin with: const { ... } = React;
- Component name: must be a default export, e.g. "export default function StatusPanel(props) { ... }"

────────  SCHEMA JSON RULES  ────────
- Shape: { "algoName": "...", "modules": [ { "id": "m1", "label": "...", "description": "...", "detectHint": "..." }, ... ] }
- algoName: PascalCase, e.g. "TwoSum" / "LIS" / "Knapsack"
- 3-5 modules total based on REAL CODE STRUCTURE (not abstract concepts):
  * If a single for-loop contains both lookup and storage → ONE module, not two
  * Typical breakdown: input read / data structure init / core loop / output
- label: ≤ 12 chars Chinese
- description: ≤ 24 chars Chinese describing what the code does
- detectHint: ≤ 60 chars English describing what tokens/structures to look for in user code
  Example: "look for 'cin >>' or 'scanf(' or vector reading in a for loop"

CRITICAL: Output Chinese for visible UI text (label/description); English for detectHint.
CRITICAL: NO markdown code fences anywhere in the output.`;

export interface StatusPromptInput {
  title: string;
  statement: string;
  constraints?: string;
  examples?: ProblemExample[];
}

export function buildStatusPrompt(input: StatusPromptInput) {
  const examplesText = (input.examples ?? [])
    .slice(0, 2)
    .map(
      (ex, i) =>
        `Example ${i + 1}:\nInput:\n${ex.input}\nOutput:\n${ex.output}${
          ex.explanation ? `\nNote: ${ex.explanation}` : ''
        }`,
    )
    .join('\n\n');
  const user = `Generate Status panel + detection schema for this algorithm problem.

Title: ${input.title}
Statement: ${input.statement}
${input.constraints ? `Constraints: ${input.constraints}\n` : ''}${examplesText ? `\n${examplesText}\n` : ''}
Output the two blocks as specified (STATUS_TSX then SCHEMA_JSON).`;
  return { system: STATUS_SYSTEM, user };
}

/**
 * 解析 LLM 的 STATUS_TSX + SCHEMA_JSON 双块输出。
 * 容错：剥离可能的 markdown 围栏 + 容忍空白；任一块缺失就返回 null。
 */
export function parseStatusOutput(
  raw: string,
): { statusCode: string; schema: AlgoVizDetectionSchema } | null {
  const tsxMatch = raw.match(/<STATUS_TSX>([\s\S]*?)<\/STATUS_TSX>/);
  const jsonMatch = raw.match(/<SCHEMA_JSON>([\s\S]*?)<\/SCHEMA_JSON>/);
  if (!tsxMatch || !jsonMatch) return null;
  const statusCode = stripFence(tsxMatch[1]).trim();
  const schemaText = stripFence(jsonMatch[1]).trim();
  if (!statusCode || !schemaText) return null;
  let schema: AlgoVizDetectionSchema;
  try {
    schema = JSON.parse(schemaText) as AlgoVizDetectionSchema;
  } catch {
    return null;
  }
  if (
    !schema.algoName ||
    !Array.isArray(schema.modules) ||
    schema.modules.length < 2 ||
    schema.modules.length > 5
  ) {
    return null;
  }
  for (const m of schema.modules) {
    if (!m.id || !m.label || !m.detectHint) return null;
    if (!m.description) m.description = '';
  }
  return { statusCode, schema };
}

// ──────────────────────────────────────────────────────────────────────
// 2) Animation
// ──────────────────────────────────────────────────────────────────────

const ANIMATION_SYSTEM = `You generate a Remotion algorithm animation component.

Output format MUST be exactly:
<ANIMATION_TSX>
[the Remotion React component code, no markdown fence]
</ANIMATION_TSX>

────────  ARCHITECTURE  ────────
- The component receives props: { module1?, module2?, module3?, module4?, module5? } (all boolean, default false)
- The canvas (1280x720) has N FIXED REGIONS (absolute positioned), one per module from the schema. They NEVER disappear, all visible from frame 0 to frame 300.
- The ANIMATION TIMELINE (pointer moving, numbers appearing, etc.) is driven SOLELY by useCurrentFrame(). It plays independently and is NOT affected by props.
- The MODULE PROPS only control each region's CSS:
  * moduleX=true:  borderColor #22c55e, opacity 1,    boxShadow '0 0 20px rgba(34,197,94,0.4)'
  * moduleX=false: borderColor #475569, opacity 0.35, boxShadow 'none'

────────  CODE RULES  ────────
- Single default-exported function component
- NO imports — Remotion APIs come from a global \`Remotion\` object in the sandbox: const { useCurrentFrame, interpolate, spring, AbsoluteFill } = Remotion;
- React also from global: const { useMemo } = React;
- INLINE styles only — no className, no Tailwind, no external CSS
- All motion via interpolate / spring with useCurrentFrame; NO setTimeout, NO CSS keyframes, NO setInterval
- Canvas: 1280×720, background #0f172a, font sans-serif
- Color palette: primary #3b82f6, success #22c55e, accent #fbbf24, text white / #94a3b8
- 300 frames @ 30fps total (10 seconds)
- Layout for N regions:
  * 2 → top/bottom or left/right
  * 3 → left-mid-right OR triangle
  * 4 → 2×2 grid
  * 5 → 2×2 + center top

────────  FORBIDDEN  ────────
- NO Sequence (no scene switching — all regions always present)
- NO CSS transition / keyframes / animation property
- NO props.moduleX gating any animation playback / start / stop
- NO external imports

CRITICAL: Output ONE block <ANIMATION_TSX>...</ANIMATION_TSX>, no markdown fences.`;

export interface AnimationPromptInput extends StatusPromptInput {
  /** 第 1 次调用产出的 Status 代码，让第 2 次调用对齐模块定义 */
  statusCode: string;
  /** Status 输出的 schema，告诉 Animation 用哪些 module key */
  schema: AlgoVizDetectionSchema;
}

export function buildAnimationPrompt(input: AnimationPromptInput) {
  const moduleList = input.schema.modules
    .map((m, i) => `  ${i + 1}. ${m.id} (${m.label}) — ${m.description}`)
    .join('\n');
  const user = `Generate Remotion animation for: ${input.schema.algoName}

Title: ${input.title}
Statement: ${input.statement}
${input.constraints ? `Constraints: ${input.constraints}\n` : ''}
Modules from schema (you MUST use exactly these as N fixed regions):
${moduleList}

CONTEXT (for module-definition consistency):
The Status component below was already generated with the same modules. Match its module count and meaning.

--- STATUS COMPONENT CODE ---
${input.statusCode}
--- END STATUS COMPONENT ---

Output the <ANIMATION_TSX> block.`;
  return { system: ANIMATION_SYSTEM, user };
}

/** 解析 Animation 单块输出 */
export function parseAnimationOutput(raw: string): string | null {
  const m = raw.match(/<ANIMATION_TSX>([\s\S]*?)<\/ANIMATION_TSX>/);
  if (!m) return null;
  const code = stripFence(m[1]).trim();
  return code || null;
}

// ──────────────────────────────────────────────────────────────────────
// 3) Detect (实时填空)
// ──────────────────────────────────────────────────────────────────────

const DETECT_SYSTEM = `You analyze code completeness for module detection.

Input: a list of N modules (with detectHint each) and the user's current code.
Output: EXACTLY N digits, no spaces, no newlines, no other text.
  - Digit i is 1 if module i is present/complete in the code, 0 otherwise.
  - When uncertain or code is too sparse, output 0 for that position (do not guess).

Examples (4 modules):
  user code is empty            → 0000
  only input reading present    → 1000
  input + map declared          → 1100
  almost done, only output left → 1110
  fully done                    → 1111

CRITICAL: Output ONLY the N digits. Nothing else. No explanation, no JSON, no quotes.`;

export interface DetectPromptInput {
  schema: AlgoVizDetectionSchema;
  code: string;
}

export function buildDetectPrompt(input: DetectPromptInput) {
  const moduleList = input.schema.modules
    .map((m, i) => `${i + 1}. [${m.id}] ${m.label}: ${m.detectHint}`)
    .join('\n');
  const truncated = input.code.length > 4000 ? input.code.slice(0, 4000) + '\n// ...(truncated)' : input.code;
  const user = `Modules (${input.schema.modules.length} total):
${moduleList}

User code:
\`\`\`
${truncated}
\`\`\`

Output ${input.schema.modules.length} digits:`;
  return { system: DETECT_SYSTEM, user };
}

/**
 * 把"1011"这种字符串解析成 { m1: true, m2: false, m3: true, m4: true }。
 * - 容错：剥首尾空白 / 取第一段连续 0/1
 * - 长度不匹配 schema → 返回 null（拒绝半截结果）
 */
export function parseDetectOutput(
  raw: string,
  schema: AlgoVizDetectionSchema,
): Record<string, boolean> | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/[^01]/g, '');
  if (cleaned.length !== schema.modules.length) return null;
  const out: Record<string, boolean> = {};
  for (let i = 0; i < schema.modules.length; i++) {
    out[schema.modules[i].id] = cleaned[i] === '1';
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────

function stripFence(s: string): string {
  return s
    .replace(/^\s*```(?:tsx?|jsx?|javascript|typescript|json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}
