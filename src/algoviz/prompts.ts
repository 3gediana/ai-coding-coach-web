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

1) A React "Status visualization" component — a STATIC visual sketch of the algorithm's actual data structures
2) A JSON detection schema describing modules

Output format MUST be exactly:
<STATUS_TSX>
[the React component code, no markdown fence]
</STATUS_TSX>
<SCHEMA_JSON>
[a JSON object, no markdown fence]
</SCHEMA_JSON>

────────  STATUS COMPONENT — CRITICAL RULES  ────────

★★ THIS IS NOT A TEXT-CARD-STACK. ★★
DO NOT render rows of "Module 1: Read Input / Module 2: HashMap" labels.
INSTEAD: render the ACTUAL VISUAL PARTS of the algorithm (the same kind of shapes the Animation will use), all visible at once, statically.

Examples of correct visualizations:
  - Two Sum:   draw the input array as a row of square cells [2][7][11][15], a HashMap-shaped table next to it (key/value rows), and a small "result: i,j" badge
  - Dijkstra:  draw graph nodes as circles, edges as lines with weights, a distance array row, a small priority-queue stack
  - StringHash: draw the string as character cells [a][b][c][a]..., a prefix-hash array row below, and a small query-result badge
  - Knapsack:  draw the items list (weight/value), a 2D dp-table grid, an answer cell

EACH MODULE corresponds to ONE visual sub-region of the canvas (NOT a card).
  - moduleX = true  → that sub-region uses active styling (green stroke + glow + light green fill)
  - moduleX = false → that sub-region uses inactive styling (slate-700 stroke + 0.55 opacity + light gray fill)

Use REAL DATA from the problem's first example (parse it from input/output) so the visualization is concrete.

════════════════════════════════════════════════════════════════
★★★ STATUS COMPONENT — LAYOUT SAFETY ★★★
════════════════════════════════════════════════════════════════

The Status panel sits in a ~280px wide narrow column on the right side. Common bugs:
  - Modules drawn with SVG absolute coords (x,y) overlap each other
  - Long labels overflow the panel
  - Result/output box collides with the input array next to it

★ MANDATORY LAYOUT (vertical stack, NO SVG absolute coordinates for module containers):

  export default function StatusViz({ module1 = false, module2 = false, module3 = false, module4 = false }) {
    return (
      <div style={{
        width: '100%',
        boxSizing: 'border-box',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        fontFamily: 'system-ui, sans-serif',
        color: '#1e293b',
      }}>
        <ModuleBox active={module1} title="输入数组">
          {/* shape content here */}
        </ModuleBox>
        <ModuleBox active={module2} title="哈希表">
          ...
        </ModuleBox>
        ... (one ModuleBox per schema module, vertical stack)
      </div>
    );
  }

  Define ModuleBox INLINE inside the file (not exported):
    function ModuleBox({ active, title, children }) {
      return (
        <div style={{
          boxSizing: 'border-box',
          padding: 8,
          border: '2px solid ' + (active ? '#16a34a' : '#475569'),
          borderRadius: 8,
          backgroundColor: active ? 'rgba(22,163,74,0.06)' : 'rgba(0,0,0,0.03)',
          opacity: active ? 1 : 0.55,
          filter: active ? 'drop-shadow(0 0 4px rgba(22,163,74,0.4))' : 'none',
          overflow: 'hidden',                   // ★ MANDATORY
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>{title}</div>
          {children}
        </div>
      );
    }

★ Inside each ModuleBox, draw the algorithm parts with FLEXBOX (NOT SVG absolute coords for layout):
  - Array cells:
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {[2, 7, 11, 15].map((n, i) => (
        <div key={i} style={{
          width: 28, height: 28,
          border: '1.5px solid #475569', borderRadius: 4,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 600,
          flexShrink: 0,
        }}>{n}</div>
      ))}
    </div>

  - HashMap rows (key/value):
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', gap: 4, fontSize: 11 }}>
        <span style={{ width: 40 }}>2</span><span>→</span><span>0</span>
      </div>
      ...
    </div>

  - Result badge:
    <div style={{ fontSize: 12, fontWeight: 600 }}>result: [0, 1]</div>

★ ONLY use raw <svg> for shapes that flexbox can't draw (graph edges, dp-table grids).
  When you DO use <svg>, use viewBox + width:'100%' so it auto-scales:
    <svg viewBox="0 0 280 80" width="100%" style={{ display: 'block' }}>
      <line x1="..." ... />
    </svg>

────────  FORBIDDEN  ────────
- ✗ Single big <svg> wrapping ALL modules with absolute (x,y) for each module's box
- ✗ <text x="..." y="...">label</text> for module titles or content text — use <div>
- ✗ Width/height with hard pixel values that exceed ~256px (panel is ~280 wide; account for padding)
- ✗ position: absolute / left / top                                       — use flex column
- ✗ whiteSpace: nowrap on labels — let them wrap

────────  TECH RULES  ────────
- A SINGLE default-exported React functional component
- Props: { module1?: boolean; module2?: boolean; module3?: boolean; module4?: boolean; module5?: boolean }, all default false
- Background TRANSPARENT (host page is warm-flax / linen)
- INLINE styles only — no className, no Tailwind
- Color palette (works on warm flax bg): primary #2563eb, success #16a34a, accent #d97706, dim #475569 (NOT #94a3b8), text #1e293b
- NO imports beyond React (global). Begin with: const { ... } = React;
- Use REAL DATA from the problem's first example (parse it from input/output)

────────  SCHEMA JSON RULES  ────────
- Shape: { "algoName": "...", "modules": [ { "id": "m1", "label": "...", "description": "...", "detectHint": "..." }, ... ] }
- algoName: PascalCase, e.g. "TwoSum" / "LIS" / "Knapsack"
- 3-4 modules total based on REAL CODE STRUCTURE (NOT abstract concepts; NOT "return 0" as its own module):
  * If a single for-loop contains both lookup and storage → ONE module
  * Typical breakdown: input read / data structure init / core algorithm loop / output
- label: ≤ 12 chars Chinese (this is the module name shown in debug info)
- description: ≤ 24 chars Chinese describing what the code does
- detectHint: ≤ 60 chars English describing what tokens/structures to look for in user code

CRITICAL OUTPUT RULES:
- Chinese for label/description; English for detectHint
- NO markdown code fences anywhere
- The Status component must SHOW THE ALGORITHM VISUALLY, not describe it in words.`;

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

════════════════════════════════════════════════════════════════
★★★ LAYOUT SAFETY — TOP PRIORITY (most failures come from here) ★★★
════════════════════════════════════════════════════════════════

The #1 failure mode of generated animations is:
  - Text overflowing its container (e.g. "target - nums[i" cut off, missing "]")
  - Modules overlapping each other (one region's box drawn on top of another)
  - Numbers floating outside their cells

To prevent this, you MUST follow these rules with NO exceptions:

★ RULE 1: Use CSS GRID for the 4 fixed regions (NOT manual absolute positioning).
  The outer AbsoluteFill should be a flex/grid container that auto-sizes the regions:

  Example for N=4 modules (2×2 grid):
    <AbsoluteFill style={{
      backgroundColor: 'transparent',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: '1fr 1fr',
      gap: 32,
      padding: 40,
      fontFamily: 'system-ui, sans-serif',
      color: '#1e293b',
      boxSizing: 'border-box',
    }}>
      <div style={regionStyle(module1)}> ... region 1 content ... </div>
      <div style={regionStyle(module2)}> ... region 2 content ... </div>
      <div style={regionStyle(module3)}> ... region 3 content ... </div>
      <div style={regionStyle(module4)}> ... region 4 content ... </div>
    </AbsoluteFill>

  Layout per N (use GRID, NOT absolute coords):
    N=2: gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr'    (or rows '1fr 1fr', cols '1fr')
    N=3: gridTemplateColumns: '1fr 1fr 1fr', rows '1fr'
    N=4: gridTemplateColumns: '1fr 1fr', rows '1fr 1fr'             ★ MOST COMMON
    N=5: gridTemplateColumns: '1fr 1fr', rows '1fr 1fr 1fr', region5 spans 2 cols

★ RULE 2: Every region MUST have these styles to prevent overflow:
    {
      boxSizing: 'border-box',
      padding: 28,
      border: '2px solid <color>',
      borderRadius: 16,
      overflow: 'hidden',          // ★ MANDATORY — clips overflowing children
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      minWidth: 0,                 // ★ MANDATORY — allows flex children to shrink
      minHeight: 0,
      backgroundColor: 'rgba(255,255,255,0.4)',
    }

★ RULE 3: ALL TEXT must use <div>, NEVER use SVG <text> with textAnchor and absolute coords for content text.
  Text inside a region:
    <div style={{
      fontSize: 18,                 // small fixed size — DO NOT exceed 22 for region text
      lineHeight: 1.4,
      whiteSpace: 'normal',         // allow wrap (NOT 'nowrap')
      wordBreak: 'break-word',      // long expressions break properly
      overflow: 'hidden',
    }}>
      Check: target - nums[i]
    </div>

  Region title (e.g. "Loop", "HashMap"):
    fontSize: 16, fontWeight: 600, color: '#475569', marginBottom: 4

★ RULE 4: Cell-style data (array elements, hashmap key-value rows) — use FLEXBOX, not absolute:
    {/* array of 4 numbers */}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {[2, 7, 11, 15].map((n, i) => (
        <div key={i} style={{
          width: 56, height: 56,
          border: '2px solid ' + (highlight ? '#16a34a' : '#475569'),
          borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, fontWeight: 600,
          flexShrink: 0,
        }}>{n}</div>
      ))}
    </div>

★ RULE 5: Animation pointers (the moving highlight) — use transform on a positioned cell, NOT absolute coords:
    Apply transform: \`scale(1.15)\` and box-shadow on the active cell driven by useCurrentFrame.
    DO NOT draw a separate <div style={{ position: 'absolute', left: 200 }} />.

★ RULE 6 (★★ CRITICAL — region must be visible from frame 0):
  The region CONTAINER's opacity is OWNED by moduleX prop (via regionStyle()):
    moduleX=true  → opacity 1
    moduleX=false → opacity 0.35
  ★ NEVER override the container's opacity with useCurrentFrame interpolate.
  ★ NEVER do: <div style={{ ...regionStyle(module1), opacity: someInterpolate }}>
                                                     ^^^^^^^^^^^^^^^^^^^^^^^^^^ FORBIDDEN
  
  The animation timeline is for INNER CONTENT only, not for fading regions in/out.
  The 4 regions are ALWAYS visible (controlled only by moduleX prop).
  
  ✓ CORRECT — animate the INSIDE content, not the region:
    <div style={regionStyle(module1)}>                        // region opacity from props ONLY
      <div style={{ opacity: phase1Opacity }}>                // INNER content can interpolate
        Step 1 details...
      </div>
    </div>

  ✗ WRONG — fades the whole region by frame:
    <div style={{ ...regionStyle(module1), opacity: phase1Opacity }}>   // ★ NO ★
      ...
    </div>

  Why this matters: when the user opens the player at frame 0, all 4 regions MUST be visible
  (they're the static visual map of the algorithm). Only the highlights / pointers / step
  numbers inside should animate.

────────  FORBIDDEN (these cause the layout bugs we're fixing)  ────────
- ✗ SVG <text x="..." y="..." textAnchor="..."> for content text       — overflow risk
- ✗ <div style={{ position: 'absolute', left: ..., top: ... }}>        — collision risk
- ✗ Manually computed pixel coordinates for region positioning         — use grid
- ✗ whiteSpace: 'nowrap' on long expressions / sentences               — causes truncation
- ✗ width/height with hard pixel values on region containers           — let grid size them
- ✗ fontSize > 22 for region text                                       — won't fit
- ✗ Sequence (scene switching)                                          — all regions always visible
- ✗ CSS transition / keyframes / animation property                    — use Remotion interpolate
- ✗ props.moduleX gating animation playback                             — only style, never logic
- ✗ { ...regionStyle(moduleX), opacity: <interpolate> }                  — ★ frame-driven opacity on region
- ✗ { ...regionStyle(moduleX), filter: <interpolate> }                   — same; both override props
- ✗ External imports                                                    — sandbox has only Remotion + React globals

────────  REGION STATE STYLING  ────────
- moduleX=true (active):
    borderColor: '#16a34a'
    opacity: 1
    filter: 'drop-shadow(0 0 12px rgba(22,163,74,0.35))'
    backgroundColor: 'rgba(22,163,74,0.06)'
- moduleX=false (inactive):
    borderColor: '#475569'
    opacity: 0.35
    filter: 'none'
    backgroundColor: 'rgba(0,0,0,0.02)'

────────  ARCHITECTURE  ────────
- Component receives: { module1?, module2?, module3?, module4?, module5? } (all boolean, default false)
- Canvas: 1280×720, transparent background (host page is warm-flax / linen colored)
- 300 frames @ 30fps total (10 seconds)
- Animation timeline driven SOLELY by useCurrentFrame(); props only control region CSS

────────  CODE RULES  ────────
- Single default-exported function component
- NO imports — APIs from globals: const { useCurrentFrame, interpolate, spring, AbsoluteFill } = Remotion;
- React from global: const { useMemo } = React;
- INLINE styles only
- All motion via interpolate / spring; NO setTimeout, NO CSS keyframes, NO setInterval

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
