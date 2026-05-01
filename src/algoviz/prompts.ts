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

const STATUS_SYSTEM = `You generate TWO outputs for a two-stage algorithm visualization system:

1) <STATUS_TSX>: a STATIC React component showing the visual components that will appear in the later animation.
2) <SCHEMA_JSON>: the module schema used for code-progress detection and for aligning the Animation component.

Output format MUST be exactly:
<STATUS_TSX>
[the React component code, no markdown fence]
</STATUS_TSX>
<SCHEMA_JSON>
[a JSON object, no markdown fence]
</SCHEMA_JSON>

════════ CORE CONCEPT — STATUS IS STAGE 1, NOT THE ANIMATION ════════
You are Stage 1 of a two-stage generation pipeline.
Your output will be passed verbatim into Stage 2.
Stage 2 will inspect your Status TSX and schema to generate the dynamic Remotion animation.

The Status component is a static component showcase / component inventory.
It answers: "What visual parts will the later animation use?"
It does NOT answer: "How does the algorithm move over time?"

The ONLY variable input is the problem statement/examples in the user message.
Infer the algorithm family, visual components, module names, sample data, and schema solely from that problem.
Do not rely on any fixed problem template.

Therefore:
- Do NOT create a mini-storyboard.
- Do NOT make four scenes.
- Do NOT animate anything.
- Do NOT use useCurrentFrame / interpolate / spring.
- Do NOT explain the algorithm with paragraph cards.
- Show the actual visual components for THIS problem family: array cells, pointer chips, table/grid cells, map rows, stack/queue items, graph nodes/edges, tree frames, DP cells, candidate/result badges, etc.

The later Animation component will use these same components more beautifully and dynamically.
Status only arranges them safely and statically.

════════ STATUS COMPONENT — LAYOUT SAFETY ════════
The Status panel sits in a narrow column around 280px wide.
Common bugs:
- modules drawn with SVG absolute coords overlap each other
- long labels overflow the panel
- result/output box collides with the input array next to it

Mandatory layout:
- vertical stack of ModuleBox containers
- no absolute positioning for module containers
- no single large SVG wrapping all modules
- text must wrap
- every ModuleBox must use overflow:'hidden'
- use flexbox for arrays/maps/badges
- only use SVG inside one box if the data structure needs graph/tree edges
- no SVG <text> for content labels
- outer background transparent

Width safety:
- root Status container MUST use width:'100%' and boxSizing:'border-box'
- do NOT use width:280, width:'280px', maxWidth:280, or maxWidth:'280px'
- do NOT use child width values that assume the full panel width while also adding padding
- ModuleBox must use width:'100%' and boxSizing:'border-box'
- any row of cells must use flexWrap:'wrap', minWidth:0, maxWidth:'100%'

Use this component structure:
- define a reusable ModuleBox helper inside the file
- export with: export default function StatusViz(...)
- plain JavaScript/JSX only
- no imports
- no TypeScript annotations
- React is already global; if needed, start with: const { useMemo } = React;
- do not write any style property named transition
- JSX text safety: never put raw < or > in JSX text; for comparisons use {"<"}, {">"}, {"<="}, {">="}, or text like "less than"

Required ModuleBox skeleton:
function ModuleBox({ active, title, children }) {
  return (
    <div style={{
      width: '100%',
      boxSizing: 'border-box',
      padding: 8,
      border: '2px solid ' + (active ? '#16a34a' : '#475569'),
      borderRadius: 8,
      backgroundColor: active ? 'rgba(22,163,74,0.06)' : 'rgba(0,0,0,0.03)',
      opacity: active ? 1 : 0.55,
      filter: active ? 'drop-shadow(0 0 4px rgba(22,163,74,0.4))' : 'none',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      minWidth: 0,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>{title}</div>
      {children}
    </div>
  );
}

Inside each ModuleBox, draw algorithm parts with FLEXBOX, not SVG absolute coords for layout.
Array cells:
<div style={{ display:'flex', gap:4, flexWrap:'wrap', minWidth:0, maxWidth:'100%' }}>
  {[2, 7, 11, 15].map((n, i) => (
    <div key={i} style={{ width:28, height:28, border:'1.5px solid #475569', borderRadius:4, display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:600, flexShrink:0 }}>{n}</div>
  ))}
</div>

Map rows:
<div style={{ display:'flex', flexDirection:'column', gap:2, minWidth:0 }}>
  <div style={{ display:'flex', gap:4, fontSize:11, minWidth:0 }}>
    <span style={{ minWidth:24 }}>2</span><span>→</span><span>0</span>
  </div>
</div>

════════ SCHEMA JSON RULES ════════
- Shape: { "algoName": "...", "modules": [ { "id": "m1", "label": "...", "description": "...", "detectHint": "..." }, ... ] }
- algoName: PascalCase, e.g. "TwoSum" / "LIS" / "Knapsack"
- 3-5 modules total, based on visual/data components and code-detectable structures, not arbitrary scenes or return statements
- Good module choices by family:
  * array/string scan: input cells, pointer/current item, comparison/expression, state container, result
  * two pointers/binary search: input cells, left/right/mid pointers, interval, comparison, result
  * hash/map/set: input cells, lookup expression, map/set table, result
  * stack/queue: input stream, stack/queue container, top/front operation, output/result
  * graph/tree: graph canvas, visited/frontier, edge traversal, result
  * DP: input/items, dependency cells, DP table, answer cell
  * sorting/greedy: unsorted region, active comparison, candidate/best state, sorted/confirmed region
- label: ≤ 12 chars Chinese
- description: ≤ 24 chars Chinese
- detectHint: ≤ 60 chars English describing code tokens/structures to look for

CRITICAL OUTPUT RULES:
- Chinese for label/description; English for detectHint
- no markdown code fences anywhere
- the Status component must SHOW THE ALGORITHM VISUALLY, not describe it in words
- Status prepares visual vocabulary for Stage 2; it is not a storyboard.`;

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
  const statusCode = sanitizeGeneratedTsx(tsxMatch[1]);
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

STRICT OUTPUT CONTRACT:
- Your first non-whitespace characters MUST be exactly: <ANIMATION_TSX>
- Your last non-whitespace characters MUST be exactly: </ANIMATION_TSX>
- Do NOT wrap the code in markdown fences.
- Do NOT start with prose.

════════ CORE CONCEPT — ANIMATION IS STAGE 2, NOT STATUS ════════
You are Stage 2 of a two-stage generation pipeline.
The previous Status component was only a static component showcase / component inventory.
This Animation should show the algorithm over time, using those same components as visual anchors.

You MUST carefully inspect the provided Status TSX and SCHEMA_JSON:
- preserve the exact module count and module meanings
- reuse the same visual metaphor chosen in Status
- reuse the same concrete sample data from Status/problem examples
- keep component semantics aligned, even if you rewrite helper components
- transform the static component inventory into a continuous dynamic process

The ONLY external variable is the problem. The Status TSX and schema are derived artifacts from Stage 1.
Do not use any hardcoded algorithm template. Choose the animation story from the provided problem + Stage 1 visual vocabulary.

Do NOT merely reproduce the Status layout.
Do NOT make static cards.
Do NOT make one scene per module.
Schema modules define persistent safe visual regions. Animation beats define time. The number of modules is NOT the number of beats.

════════ PRESENTATION LAYOUT ════════
- Canvas is 1280×720, transparent background.
- Use CSS GRID for persistent regions, NOT manual absolute positioning.
- Prefer a polished 2×2 grid for 3-4 modules.
- For 5 modules, use a hero layout: main algorithm region spans the left 60%, supporting state/result regions stack on the right, progress strip at the bottom.
- Do NOT render N full-width horizontal strips from top to bottom.
- Each region should feel like a designed panel with centered content, not a stretched status row.
- Use large, readable cells/chips in the hero region; avoid tiny content stuck in the top-left.
- Core data must be visible from frame 0. Do not hide the input array/graph/table at frame 0; animate emphasis, highlights, badges, and state changes instead.

If there are 5 modules, use this layout structure:
- AbsoluteFill: display grid, columns 1.25fr 0.85fr, rows 1fr 1fr 1fr 44px, gap 16, padding 24
- module1 region: gridRow '1 / span 3', hero/input/process region with large centered cells
- module2 region: right column row 1
- module3 region: right column row 2
- module4/module5 region: right column row 3, combine result/check visually if needed
- progress strip: gridColumn '1 / span 2'

════════ LAYOUT SAFETY — DO NOT VIOLATE ════════
- Regions are workspaces, not scenes; all regions must be visible from frame 0.
- The region container opacity is controlled ONLY by module props, never by frame.
- NEVER animate region container opacity, transform, filter, width, height, grid placement, or display.
- If you want a reveal, wrap INNER CONTENT in a child div and animate that child only.
- Animate only inner content: cells, badges, glows, progress dots, small arrows inside a region.
- No cross-region absolute movement.
- Every region must have boxSizing:'border-box', overflow:'hidden', minWidth:0, minHeight:0.
- ALL content text must be <div>, never SVG <text>.
- No CSS transition, no keyframes, no setTimeout, no setInterval.
- Do not write a transition style at all, not even transition:'none'.
- Forbidden exact style key: transition. Do not include "transition:" anywhere in the code.
- Before final output, scan your code. If the substring "transition" appears anywhere, remove that whole property/line.
- No Remotion Sequence or TransitionSeries in this UI animation.
- No external imports. Use globals only:
  const { useCurrentFrame, interpolate, spring, AbsoluteFill } = Remotion;
  const { useMemo } = React;
- Plain JavaScript/JSX only.
- NO imports. Do not write "import React from 'react'".
- NO TypeScript annotations. Do not write React.FC, React.CSSProperties, : number, : boolean, or interfaces.
- JSX text safety: never put raw < or > in JSX text; for comparisons use {"<"}, {">"}, {"<="}, {">="}, or text like "less than".

Required safe region pattern:
const regionStyle = (active) => ({
  boxSizing: 'border-box',
  overflow: 'hidden',
  minWidth: 0,
  minHeight: 0,
  opacity: active ? 1 : 0.35,
  filter: active ? 'drop-shadow(0 0 12px rgba(22,163,74,0.35))' : 'none',
  border: '2px solid ' + (active ? '#16a34a' : '#475569'),
  borderRadius: 16,
  backgroundColor: active ? 'rgba(22,163,74,0.06)' : 'rgba(0,0,0,0.02)',
  display: 'flex',
  flexDirection: 'column',
});

Forbidden region pattern:
const regionOpacity = interpolate(frame, ...);
<div style={{ ...regionStyle(module1), opacity: regionOpacity }}>

════════ MOTION GRAMMAR ════════
Internally design 5-9 visual beats across 300 frames, but do NOT output the plan.
Implement the beats directly in TSX.

Use these primitives:
- reveal: inner content opacity 0→1, translateY 8→0 with interpolate(... clamp)
- focus: active cell/card scale via spring({ frame, fps: 30, durationInFrames, config:{damping:18, stiffness:120, overshootClamping:true} })
- compare: two elements glow in accent #d97706 and show a short expression badge
- lookup: key badge enters the map region; if missing, amber pulse; if found, green pulse
- insert: new map row appears with spring scale 0.85→1
- update: overwrite a DP/table/candidate value with a highlighted write badge
- reject: failed candidate dims or amber pulse
- confirm: answer cells and output badge glow success #16a34a
- progress: bottom timeline dots/segments; active beat is blue/green
- invariant: a visible small badge named InvariantBadge. It must summarize what remains true after the current beat, e.g. visited state, search interval, sorted prefix, DP dependency, queue/frontier, or current candidate.

All interpolate outputs MUST include extrapolateLeft:'clamp' and extrapolateRight:'clamp'.
Every spring() call MUST include fps: 30.
Layout-critical spring MUST use overshootClamping:true.

════════ FRAME CONSISTENCY ════════
- Compute one frameState/step object from frame.
- Derive current index/node/cell, highlighted cells, expression, map/table state, invariant text, and result from that one state.
- Do not maintain multiple conflicting current variables.
- The visual highlight and text must agree in every frame.

════════ PROBLEM-AWARE STORY REQUIREMENTS — GENERIC ════════
Derive the story from the actual problem statement, examples, Status TSX, and schema.
Do not hardcode a specific algorithm template unless the problem clearly matches it.

For any algorithm family, the animation should include:
1. setup: reveal concrete sample input and goal
2. focus: highlight the current pointer/node/cell/item
3. operation: show the active comparison, lookup, transition, recurrence, push/pop, enqueue/dequeue, or update
4. state change: visibly mutate the relevant data structure inside its region
5. invariant: show a short InvariantBadge explaining what is guaranteed now
6. representative progression: show at least one meaningful next step if it clarifies the algorithm
7. conclusion: highlight the final answer/result

If the algorithm family is:
- array/string scan: animate current index, comparison, state update
- two pointers/binary search: animate left/right/mid or interval shrink
- hash/map/set: animate lookup miss/hit and insert/update
- stack: animate push/pop/top
- queue/BFS: animate enqueue/dequeue/visit
- graph/tree/DFS: animate node focus, edge trace, visited/frontier update
- DP: animate dependency cells before writing target cell
- sorting/greedy: animate comparison, candidate choice, confirmed region
- math/simple simulation: animate variables changing step by step

════════ STYLE ════════
- Warm, clean educational style; transparent page background.
- Rounded cards, soft shadows, subtle gradients inside cards.
- primary #2563eb, success #16a34a, accent #d97706, danger #dc2626, dim #475569, text #1e293b.
- Use short text only: "比较", "查找", "更新", "入栈", "出队", "访问", "写入", "命中", "确认".
- Prefer visual state over paragraphs.
- Use staggered reveals by 3-6 frames.

Return a single default-exported function component.
Props: { module1=false, module2=false, module3=false, module4=false, module5=false }.
Use module1..module5 only for region active styling, not for controlling timeline logic.

CRITICAL: Output ONE block <ANIMATION_TSX>...</ANIMATION_TSX>, no markdown fences.
CRITICAL: Include an InvariantBadge component or helper and render it visibly.
CRITICAL: Do not include the substring "transition:" anywhere.`;

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
  const examplesText = (input.examples ?? [])
    .slice(0, 2)
    .map(
      (ex, i) =>
        `Example ${i + 1}:\nInput:\n${ex.input}\nOutput:\n${ex.output}${
          ex.explanation ? `\nNote: ${ex.explanation}` : ''
        }`,
    )
    .join('\n\n');
  const user = `Generate Remotion animation for: ${input.schema.algoName}

Title: ${input.title}
Statement: ${input.statement}
${input.constraints ? `Constraints: ${input.constraints}\n` : ''}${examplesText ? `\n${examplesText}\n` : ''}
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
  const source = m?.[1] ?? extractFallbackTsx(raw);
  if (!source) return null;
  const code = sanitizeGeneratedTsx(source);
  if (!code || !looksLikeAnimationCode(code)) return null;
  return code;
}

// ──────────────────────────────────────────────────────────────────────
// 3) Detect (实时填空)
// ──────────────────────────────────────────────────────────────────────

const DETECT_SYSTEM = `You match code tokens against module hints.

Input: a list of N modules (each with a detectHint describing what tokens/structures to look for) and the user's current code.

★ Output: EXACTLY N digits, no spaces, no newlines, no markdown, no explanation. Just N characters of '0' or '1'.

★ Decision rule (token-match, NOT completeness-check):
  - Digit i = 1  if the user code contains ANY tokens, identifiers, or structures matching module i's detectHint.
                  Partial code counts. Empty body counts. Just declared (no usage) counts.
                  As long as the relevant tokens APPEAR in the code, output 1.
  - Digit i = 0  ONLY when the user code is completely missing any tokens matching that hint.
  - Do NOT require correctness, completeness, or actual usage. This is purely "do these tokens appear?"

Examples (4 modules: input-read / hashmap / loop / output):
  empty code                                            → 0000
  "cin >> n;"                                           → 1000  (input tokens visible)
  "cin >> n; unordered_map<int,int> mp;"                → 1100  (hashmap declared, even unused → 1)
  "...mp; for(int i=0;i<n;i++) {}"                      → 1110  (loop appeared, empty body still → 1)
  "...{ if(mp.count(x)) cout << i; mp[x]=i; }"          → 1111  (cout appeared → 1)

CRITICAL: Output ONLY the N digits. No quotes, no \`\`\`, no thinking, no JSON.`;

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

function extractFallbackTsx(raw: string): string {
  const fence = raw.match(/```(?:tsx?|jsx?|javascript|typescript)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1];
  const stripped = stripFence(raw);
  return looksLikeAnimationCode(stripped) ? stripped : '';
}

function sanitizeGeneratedTsx(source: string): string {
  let code = stripFence(source);
  code = code.replace(/^\s*import\s+[^;\n]+;?\s*$/gm, '');
  code = code.replace(/^\s*(transition|animation)\s*:\s*[^,\n}]+,?\s*$/gim, '');
  code = code.replace(/,\s*(transition|animation)\s*:\s*(['"`])[^'"`]*\2\s*/gim, '');
  code = code.replace(/\s*(transition|animation)\s*:\s*(['"`])[^'"`]*\2\s*,?/gim, '');
  code = code.replace(/^\s*@keyframes\b[\s\S]*?^\s*}\s*$/gim, '');
  return code.trim();
}

function looksLikeAnimationCode(code: string): boolean {
  return /export\s+default/.test(code) && /(useCurrentFrame|AbsoluteFill|Remotion)/.test(code);
}
