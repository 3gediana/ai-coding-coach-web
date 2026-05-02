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
import type { AlgoVizDetectionSchema, AlgoVizTrace, AlgoVizVisualPlan, ProblemExample } from '../core/types';
import { parseJsonLoose } from '../core/ai/client';

// ──────────────────────────────────────────────────────────────────────
// 1) Status + Schema
// ──────────────────────────────────────────────────────────────────────

const TRACE_SYSTEM = `You generate the algorithm execution trace for a multi-stage algorithm visualization pipeline.

Output format MUST be exactly:
<TRACE_JSON>
[a JSON object, no markdown fence]
</TRACE_JSON>

You are Stage 0. You do NOT write React, TSX, SVG, CSS, scenes, or animation code.
Your only job is to simulate the algorithm on the first concrete example and produce a compact, internally consistent state timeline.

The later stages will use this trace as the single source of truth:
- Status will choose visual components from this trace.
- Animation will derive frameState, highlights, expressions, invariants, and result from this trace.

The ONLY variable input is the problem statement/examples in the user message.
Infer the algorithm family from the problem, but do not invent unrelated data.

Required JSON shape:
{
  "algoName": "PascalCaseName",
  "family": "short_family_name",
  "templateRoute": {
    "templateId": "one allowed template id from the list below",
    "family": "normalized_family_name",
    "subfamily": "optional_specific_subfamily",
    "confidence": 0.0,
    "evidence": ["short reason from problem/trace"]
  },
  "sample": { "concrete": "input data parsed from the first example" },
  "states": [
    {
      "id": "s0",
      "label": "短中文标签",
      "operation": "setup | focus | compare | lookup_miss | lookup_hit | insert | update | move_pointer | shrink_interval | push | pop | enqueue | dequeue | write_dp | visit | confirm | done",
      "focus": ["array[0]", "map[2]"],
      "data": { "all variables needed to render this state": "..." },
      "invariant": "短中文不变量说明",
      "result": null,
      "codeHint": "short English hint for the code fragment represented by this state"
    }
  ]
}

Template routing is part of Stage 0 and MUST be decided by this model, not by downstream rule matching.
Choose the best templateId directly from this exact allowlist:
- dynamic_programming.table.v1 — DP table/row, recurrence, base cases, dependency reads/writes.
- hash_lookup.map.v1 — hash map/set lookup, complement/key hit/miss, insert/update.
- binary_search.interval.v1 — sorted bounded interval, left/mid/right, interval shrink.
- sliding_window.band.v1 — contiguous active window with left/right bounds and aggregate.
- monotonic_stack.stack.v1 — stack top comparison, pop/push, next greater/smaller style output.
- two_pointers.converging.v1 — left/right pointer pair scan or converging interval.
- prefix_sum.ranges.v1 — prefix row/table and range sum/difference query.
- bfs.queue.v1 — BFS, queue/frontier, visited set, graph/grid levels.
- dfs_backtracking.recursion.v1 — DFS/backtracking, path, choices, recursion/call stack.
- heap_topk.min_heap.v1 — heap/priority queue, top-k/kth, push/pop threshold.
- union_find.parent_array.v1 — DSU/union-find, parent array, roots, component count.
- greedy_intervals.timeline.v1 — interval scheduling/overlap greedy timeline.
- dijkstra.shortest_path.v1 — weighted graph shortest path, priority queue, relax distances.
- tree_traversal.frames.v1 — binary/tree traversal with stack/call frames and output order.
If none applies, set templateRoute to null. If one applies, include templateRoute with confidence 0.62-0.98 and concrete evidence.

Rules:
- 4-8 states total.
- states[0] must be setup with core input visible.
- final state must match the first example output.
- Every state's data must be internally consistent.
- Every data-structure mutation must have its own state whose data already reflects the mutation.
- Do NOT hide a mutation inside an invariant sentence. If map/stack/queue/dp/visited/interval changes, create a new state.
- For auxiliary lookup structures, lookup happens before inserting/updating the current item when the algorithm requires distinct current vs previous items.
- For lookup miss followed by inserting the current item, use two separate states: one lookup_miss state with the old structure, then one insert state with the new structure.
- For bounded-interval / probe-index algorithms, the probe index must be mathematically consistent with the current bounds, comparisons must match the probed value, and interval updates must shrink correctly.
- For pointer-bound algorithms, interval/pointer updates must be represented in a state whose data already contains the new bounds.
- After a bounded-interval update, do not keep a stale probe/mid as the current probe. If the previous probe is outside the new bounds or was already consumed, set mid/probe to null or mark it as staleMid/staleProbe; only set a new current mid/probe in the next state where it is recomputed from the new bounds.
- In every state, if data.mid/probe is non-null, it must lie inside the current bounds and the invariant must describe a comparison at exactly that index.
- For DP, dependency cells must appear before the written target cell.
- focus entries must refer to concrete visual targets, e.g. "array[1]", "mid", "map[2]", "dp[2][3]".
- invariant must explain what remains true after the current state.
- Return valid JSON only inside TRACE_JSON.`;

export interface TracePromptInput {
  title: string;
  statement: string;
  constraints?: string;
  examples?: ProblemExample[];
}

export function buildTracePrompt(input: TracePromptInput) {
  const examplesText = formatExamples(input.examples);
  const user = `Generate execution trace JSON for this algorithm problem.

Title: ${input.title}
Statement: ${input.statement}
${input.constraints ? `Constraints: ${input.constraints}\n` : ''}${examplesText ? `\n${examplesText}\n` : ''}
Output the TRACE_JSON block only.`;
  return { system: TRACE_SYSTEM, user };
}

export function parseTraceOutput(raw: string): AlgoVizTrace | null {
  const m = raw.match(/<TRACE_JSON>([\s\S]*?)<\/TRACE_JSON>/);
  const source = m?.[1] ?? extractJsonFallback(raw);
  if (!source) return null;
  let parsed: unknown;
  try {
    parsed = parseJsonLoose(stripFence(source).trim());
  } catch {
    return null;
  }
  return normalizeTrace(parsed);
}

const VISUAL_PLAN_SYSTEM = `You generate a visual plan JSON for an algorithm animation pipeline.

Output format MUST be exactly:
<VISUAL_PLAN_JSON>
[a JSON object, no markdown fence]
</VISUAL_PLAN_JSON>

You are Stage 0.5. You do NOT write React, TSX, CSS, SVG, or Remotion code.
Your job is to turn TRACE_JSON into a concrete visual production plan AND a cinematic composition plan:
- what components exist
- where they live
- which animation beats happen
- which action targets each beat affects
- which core components are visible at frame 0
- how the hero region avoids empty space
- how the viewer's eye moves from input → operation → state → result

The later Status and Animation stages will follow this plan. Be specific and visual.
This plan must make the later animation look like a polished educational product, not a sparse dashboard.

Required JSON shape:
{
  "layout": "hero_side_panels | grid_2x2 | table_focus | graph_focus | linear_timeline",
  "durationFrames": 300,
  "components": [
    { "id": "array", "type": "ArrayCells", "role": "input", "dataRef": "sample.nums", "label": "数组" }
  ],
  "regions": [
    { "id": "hero", "title": "主舞台", "role": "hero", "componentIds": ["array"] }
  ],
  "composition": {
    "frame0Visible": ["array", "target", "map", "invariant", "progress"],
    "heroContent": ["array"],
    "density": "cinematic",
    "heroRule": "core data must be centered, large, and occupy 55-70% of the hero region from frame 0",
    "focusStrategy": "current item scales and glows; persistent data does not fade in late",
    "antiEmptySpaceRule": "no hero panel may look empty; place core cells near center with generous size"
  },
  "beats": [
    {
      "id": "b0",
      "stateId": "s0",
      "start": 0,
      "end": 45,
      "actions": [
        { "type": "reveal", "target": "array", "label": "显示输入" },
        { "type": "showInvariant", "target": "invariant" }
      ]
    }
  ],
  "style": { "tone": "warm educational", "primaryColor": "#2563eb", "accentColor": "#d97706" }
}

Rules:
- Use exactly the state ids from TRACE_JSON for beat.stateId.
- 5-9 beats total, covering setup, core operation, state mutation, invariant, and conclusion.
- durationFrames MUST be exactly 300.
- All beat.start and beat.end values must stay inside 0..300. No beat may start at or after frame 300, and no beat may end after frame 300.
- The conclusion/result beat must be visible before the video ends: start the final answer reveal no later than frame 270 and keep it visible through frame 299.
- Distribute beats across the 300-frame timeline. For 6-8 beats, use roughly 35-50 frames per beat instead of extending the video beyond 300 frames.
- Layout choice is based on visual topology, not on a hardcoded problem title:
  * Single main structure + a few scalar variables/pointers/comparisons: grid_2x2
  * Main structure plus one evolving auxiliary data structure and one explanation/result panel: hero_side_panels
  * Dense recurrence / matrix / dependency table: table_focus
  * Node-link / adjacency / traversal frontier: graph_focus
- Layout priority is structural: choose the simplest layout that gives every persistent region enough space.
- For grid_2x2, use four content regions in the first two rows plus a bottom progress region spanning both columns.
- For hero_side_panels, use a large left hero region, stacked right panels, and a bottom progress region inside the 720px canvas.
- Every layout must reserve space for progress inside the root grid; progress must never be positioned below the canvas.
- Include an invariant component and a progress component.
- Component ids must be stable lowercase identifiers.
- Action targets must refer to component ids or concrete targets like array[1], map[2], dp[2][3], node[A].
- Core input component must be visible from beat 0.
- composition.frame0Visible is mandatory and must include the core input data structure, invariant, and progress.
- composition.frame0Visible must include the component id "invariant" exactly when an invariant component exists.
- composition.frame0Visible must include "progress" exactly.
- Do NOT make core input data a late reveal. Core input is the stage, not an entering actor.
- Do NOT use a reveal action for any component listed in composition.frame0Visible.
- The first beat may use highlight/focus/showInvariant on frame0Visible components, but those components must already exist before the first animation beat.
- The first beat may reveal labels or highlights, but the actual array/string/graph/table/stack/queue must already be visible.
- Hero region must not be sparse. The core data structure must be visually centered, large, and readable.
- Prefer fewer, larger visual elements over many tiny text panels.
- For linear cell-based problems, heroContent must include the input cells.
- For graph/tree problems, heroContent must include the graph/tree canvas.
- For DP problems, heroContent must include the table grid.
- Beats must specify both stateId and visible action target so Animation can keep visual and data state aligned.
- If a beat changes an algorithm variable, its stateId must refer to the Trace state whose data already contains the changed value.
- Do NOT create a visual mutation that does not exist in TRACE_JSON.
- If map/stack/queue/dp/visited/interval changes, the beat must point to the corresponding mutation state, not the previous state.
- Include an updateData action for the component that displays any changed variable.
- If a beat changes focus, include a focus/highlight action for the exact target, e.g. array[2], mid, map[7].
- Do not over-plan text. Prefer visual components: cells, chips, pointers, rows, badges, progress dots.
- If VISUAL_TEMPLATE_HINT is provided, use it as the preferred visual topology while still obeying TRACE_JSON.
- Return valid JSON only inside VISUAL_PLAN_JSON.`;

export interface VisualPlanPromptInput extends TracePromptInput {
  trace: AlgoVizTrace;
  templateHint?: string;
}

export function buildVisualPlanPrompt(input: VisualPlanPromptInput) {
  const examplesText = formatExamples(input.examples);
  const user = `Generate visual plan JSON for this algorithm problem and execution trace.

Title: ${input.title}
Statement: ${input.statement}
${input.constraints ? `Constraints: ${input.constraints}\n` : ''}${examplesText ? `\n${examplesText}\n` : ''}
TRACE_JSON:
${formatTraceForPrompt(input.trace)}
${input.templateHint ? `\nVISUAL_TEMPLATE_HINT:\n${input.templateHint}\n` : ''}

Output the VISUAL_PLAN_JSON block only.`;
  return { system: VISUAL_PLAN_SYSTEM, user };
}

export function parseVisualPlanOutput(raw: string): AlgoVizVisualPlan | null {
  const m = raw.match(/<VISUAL_PLAN_JSON>([\s\S]*?)<\/VISUAL_PLAN_JSON>/);
  const source = m?.[1] ?? extractJsonFallback(raw);
  if (!source) return null;
  let parsed: unknown;
  try {
    parsed = parseJsonLoose(stripFence(source).trim());
  } catch {
    return null;
  }
  return normalizeVisualPlan(parsed);
}

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
If TRACE_JSON is provided in the user message, use it as authoritative structured algorithm state data.

The Status component is a static component showcase / component inventory.
It answers: "What visual parts will the later animation use?"
It does NOT answer: "How does the algorithm move over time?"

The variable inputs are the problem statement/examples and optional TRACE_JSON in the user message.
Infer the algorithm family, visual components, module names, sample data, and schema from those inputs.
Use TRACE_JSON only to identify component inventory and representative data values, not timing, storyboard, or visual effects.
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
- algoName: PascalCase, e.g. "LinearScan" / "IntervalProbe" / "RecurrenceTable"
- 3-5 modules total, based on visual/data components and code-detectable structures, not arbitrary scenes or return statements
- Good module choices by family:
  * linear scan: input cells, pointer/current item, comparison/expression, state container, result
  * bounded interval / multi-pointer: input cells, boundary/probe pointers, interval, comparison, result
  * auxiliary lookup structure: input cells, lookup expression, key-value/set table, result
  * linear container: input stream, stack/queue/deque container, top/front/back operation, output/result
  * node-link traversal: graph/tree canvas, visited/frontier, edge traversal, result
  * recurrence table: input/items, dependency cells, table grid, answer cell
  * ordering/selection: unsorted region, active comparison, candidate/best state, sorted/confirmed region
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
  trace?: AlgoVizTrace | null;
}

export function buildStatusPrompt(input: StatusPromptInput) {
  const examplesText = formatExamples(input.examples);
  const traceText = input.trace ? `\nTRACE_JSON from Stage 0:\n${formatTraceForPrompt(input.trace)}\n` : '';
  const user = `Generate Status panel + detection schema for this algorithm problem.

Title: ${input.title}
Statement: ${input.statement}
${input.constraints ? `Constraints: ${input.constraints}\n` : ''}${examplesText ? `\n${examplesText}\n` : ''}${traceText}
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
    schema = parseJsonLoose<AlgoVizDetectionSchema>(schemaText);
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

If TRACE_JSON is provided, it is the authoritative source of algorithm state:
- derive frameState, current item, expression, data-structure content, invariant text, and final result from trace.states
- do not invent a different timeline
- do not let visual highlights conflict with trace.data

If VISUAL_PLAN_JSON is provided, it is the authoritative source of presentation:
- use its layout, components, regions, beats, and action targets
- do not invent a different layout style
- translate beats into frame ranges and motion primitives
- obey composition.frame0Visible exactly: those components must be rendered at full visibility at frame 0
- obey composition.heroRule / focusStrategy / antiEmptySpaceRule

The ONLY external variable is the problem. The Status TSX and schema are derived artifacts from Stage 1.
Do not use any hardcoded algorithm template unless ALGORITHM_TEMPLATE_HINT is explicitly provided. If it is provided, follow it as the preferred algorithm-family motion grammar while still obeying TRACE_JSON, VISUAL_PLAN_JSON, Status TSX, and schema.

Do NOT merely reproduce the Status layout.
Do NOT make static cards.
Do NOT make one scene per module.
Schema modules define persistent safe visual regions. Animation beats define time. The number of modules is NOT the number of beats.

════════ REMOTION ENGINE BEST PRACTICES ════════
- All animation must be deterministic and driven by useCurrentFrame().
- Do not use CSS transitions, keyframes, timers, Date.now(), performance.now(), Math.random(), or browser layout effects for motion.
- Define one fps constant, const fps = 30, and reuse it in every spring().
- Define a single timeline source such as beats/states plus currentBeat and beatProgress. Derive visible data, highlights, text, and progress from that timeline only.
- Use interpolate() for readable frame-to-value mappings: opacity, translate, progress, and simple position changes.
- Use spring() for physical emphasis only: scale, pop, settle, pulse, or confirmation. Do not use spring() to move whole regions.
- Never use a raw spring() value directly as the full scale of a persistent/core element, because spring starts at 0. Use scale = 1 + springValue * 0.08, or scale = active ? 1 + springValue * 0.08 : 1.
- Persistent frame0Visible components must have scale 1 at frame 0. Only non-core entering overlays may start at scale 0.85.
- For non-spring fades/slides, use Easing from Remotion when useful, e.g. Easing.bezier(0.22, 1, 0.36, 1), and still clamp interpolate output.
- Use useMemo for static arrays, trace states, derived sample data, and style constants that do not depend on frame.
- Keep the component self-contained and render-safe. No external assets, no fetch, no DOM reads, no random sources.

════════ PRESENTATION LAYOUT ════════
- Canvas is 1280×720, transparent background.
- Use CSS GRID for persistent regions, NOT manual absolute positioning.
- Prefer a polished 2×2 grid for 3-4 modules.
- For 5 modules, use a hero layout: main algorithm region spans the left 60%, supporting state/result regions stack on the right, progress strip at the bottom.
- Do NOT render N full-width horizontal strips from top to bottom.
- Region containers are neutral stage surfaces. They should not look like semantic status lights; use neutral border/background and reserve blue/amber/green for inner active elements only.
- Every frame needs a clear hierarchy: one hero visual, one active operation/invariant, one progress/result cue. Avoid giving every panel equal visual weight.
- Do not create decorative or placeholder side panels just to fill a grid. Every visible side panel must contain a concrete current expression, invariant, operation, or result with readable contrast from frame 0; otherwise combine it with another panel.
- Never render spacer/placeholder panels such as "empty but keeps grid", "extra info", inactive formula cards, or regionStyle(false) panels. Empty grid slots should be omitted or merged into an active panel.
- Core data must be visible from frame 0. Do not hide the input array/graph/table at frame 0; animate emphasis, highlights, badges, and state changes instead.
- ROOT CANVAS HARD RULE:
  * AbsoluteFill style MUST include boxSizing:'border-box', overflow:'hidden', width:'100%', height:'100%'.
  * Root grid must fit inside 1280×720 including padding and gap.
  * Never place progress below the canvas. Progress must be an actual grid row inside AbsoluteFill.
  * For grid_2x2 use: gridTemplateRows:'1fr 1fr 44px' and progress gridColumn:'1 / span 2'.
  * For hero_side_panels use rows that include the bottom progress row, e.g. '1fr 1fr 44px' or '1fr 1fr 1fr 44px'.
  * Do not use margins or transforms that push children outside the canvas.
- LAYOUT PRIORITY HARD RULE:
  * Choose layout from the visual topology, not from a specific problem name.
  * If there is one dominant data structure and only scalar/pointer/comparison side information, use grid_2x2.
  * If there is one dominant data structure plus an evolving auxiliary structure, use hero_side_panels.
  * If the dominant structure is a table/matrix, use table_focus.
  * If the dominant structure is node-link, use graph_focus.
- FRAME 0 HARD RULE:
  * At frame 0, the core input structure must already be visible: array/string cells, graph/tree canvas, DP table, stack/queue, or main variables.
  * Do NOT set opacity:0 for the core input structure at frame 0.
  * Do NOT set transform scale(0) or scale(springValue) on the core input structure at frame 0.
  * Do NOT use interpolate(frame,[0,40],[0,1]) on the core input structure.
  * Do NOT reveal persistent/core cells with a per-beat opacity function such as cellOpacity(beat.start, i). Beat changes must never reset core cells to opacity 0.
  * Do NOT wrap any VisualPlan.composition.frame0Visible component in an opacity reveal such as interpolate(frame,[0,15],[0,1]).
  * Do NOT compute heroContentOpacity from 0 to 1 if the hero contains core input; hero content opacity must be 1 at frame 0.
  * Render frame0Visible components as the static base layer first; animate only glow, scale, pointer, label, badge, or highlight overlays.
  * You may animate labels/highlights, but the actual data cells/nodes/table must be fully present at frame 0.
  * If VisualPlan.composition.frame0Visible lists a component, that component must be visible at frame 0 with opacity 1.
  * If invariant is listed in frame0Visible, InvariantBadge text must be readable at frame 0. Do not fade it from opacity 0.
  * Input cells must all be fully visible at frame 0. DP/table cells may show unknown values as "?" or dim text, but the cell boxes themselves must already be visible.
- HERO DENSITY HARD RULE:
  * The hero region must not look empty.
  * For linear cell-based structures, input cells should be centered in the hero panel and large enough to be the focal point.
  * For a small visible cell row/list/tree frontier (roughly 2-10 items), use generous cell sizes: about 64-88px cells, 10-16px gap, 18-26px value font.
  * For DP arrays/tables with 5-8 visible cells and enough space, use 64-72px cells and 20-24px value font. Do not shrink DP cells below 60px just because there is a side panel.
  * The main cells/nodes/table should occupy roughly 35-70% of the useful hero width; if the raw item count is small, enlarge cells or place them in a minWidth:'45%' to '60%' centered wrapper.
  * For small combined input+DP hero layouts, the bounding box of all visible core cells should occupy at least 30% of the full 1280px canvas width at every sampled frame.
  * Do not leave the core row at natural tiny width inside a huge hero panel.
  * Never leave a giant blank hero panel with tiny content near the top.
  * Use justifyContent:'center' and alignItems:'center' in the hero content wrapper unless the structure requires a table/graph layout.

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
- No Date.now(), performance.now(), Math.random(), window, document, requestAnimationFrame, or layout measurement APIs.
- Do not write a transition style at all, not even transition:'none'.
- Forbidden exact style key: transition. Do not include "transition:" anywhere in the code.
- Before final output, scan your code. If the substring "transition" appears anywhere, remove that whole property/line.
- No Remotion Sequence or TransitionSeries in this UI animation.
- No external imports. Use globals only:
  const { useCurrentFrame, interpolate, spring, AbsoluteFill, Easing } = Remotion;
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
  opacity: active ? 1 : 0.45,
  filter: active ? 'drop-shadow(0 10px 24px rgba(15,23,42,0.08))' : 'none',
  border: '1.5px solid ' + (active ? 'rgba(148,163,184,0.55)' : 'rgba(148,163,184,0.35)'),
  borderRadius: 16,
  backgroundColor: active ? 'rgba(248,250,252,0.72)' : 'rgba(248,250,252,0.38)',
  display: 'flex',
  flexDirection: 'column',
});

Forbidden region pattern:
const regionOpacity = interpolate(frame, ...);
<div style={{ ...regionStyle(module1), opacity: regionOpacity }}>

════════ MOTION GRAMMAR ════════
Internally design 5-9 visual beats across 300 frames, but do NOT output the plan.
Implement the beats directly in TSX.
The entire story must complete within frames 0-299. If VisualPlan beat timings exceed 300 frames, compress them into a 300-frame timeline instead of creating a longer animation.
The final result must be visible by frame 270 and remain visible at frame 299.

Use a three-layer visual model:
- base layer: persistent data structures visible from frame 0
- action layer: current pointer/probe/lookup/comparison and data mutation
- annotation layer: short invariant/result/progress; never paragraphs

Use timing with intent:
- 6-12 frames for quick opacity/position reveals
- 12-20 frames for focus springs and insert/confirm pops
- 45-75 frames per algorithm beat so the viewer can read the state
- stagger related child elements by 3-6 frames, but keep core data visible

Use these primitives:
- reveal: inner content opacity 0→1, translateY 8→0 with interpolate(... clamp)
- focus: active cell/card scale via spring({ frame, fps: 30, durationInFrames, config:{damping:18, stiffness:120, overshootClamping:true} })
- focus scale must be additive, e.g. transform: scale(active ? 1 + focusSpring * 0.08 : 1), never transform: scale(focusSpring).
- compare: two elements glow in accent #d97706 and show a short expression badge
- lookup: key badge enters the map region; if missing, amber pulse; if found, green pulse
- insert: new map row appears with spring scale 0.85→1
- update: overwrite a DP/table/candidate value with a highlighted write badge
- reject: failed candidate dims or amber pulse
- confirm: answer cells and output badge glow success #16a34a
- progress: bottom timeline dots/segments; current beat is blue, completed beats are soft blue/slate, pending beats are slate; do not use success green for progress.
- invariant: a visible small badge named InvariantBadge. It must summarize what remains true after the current beat, e.g. visited state, search interval, sorted prefix, DP dependency, queue/frontier, or current candidate.
- side panels must never look empty at beat boundaries. Keep the previous valid expression/invariant/result visible until the next one is ready; do not fade core explanatory text to 0 at the exact frame a new beat starts.
- final/conclusion side text must be concrete, e.g. "返回 dp[5] = 12" or "答案下标 [0,1]". Do not show a generic recurrence/formula as the final expression.
- Avoid low-contrast disabled placeholder text panels. If a formula or explanation is not active, keep the latest useful message readable or remove/combine the panel.
- Routine DP writes are intermediate state, not final confirmation. Do not color every computed DP cell green. Use neutral fill for written cells, amber for dependency comparison cells, blue for the current write/focus cell, and green only for the final answer badge or one final answer cell.
- Persistent core data opacity must be constant 1. Animate only highlight opacity/glow/outline/scale overlays. Never compute cell opacity from beat.start, currentBeat.start, or a per-beat targetFrame.

All interpolate outputs MUST include extrapolateLeft:'clamp' and extrapolateRight:'clamp'.
Every spring() call MUST include fps: 30.
Layout-critical spring MUST use overshootClamping:true.

════════ FRAME CONSISTENCY ════════
- Compute one frameState/step object from frame.
- Derive current index/node/cell, highlighted cells, expression, map/table state, invariant text, and result from that one state.
- Do not maintain multiple conflicting current variables.
- The visual highlight and text must agree in every frame.
- For bounded-interval / pointer-bound visuals, do not display a stale mid/probe as current after a boundary shrink. If trace.data.mid/probe is null or stale, hide/dim the probe label until the next recomputed-probe state. The pointer summary, highlighted cell, and invariant must all refer to the same left/right/mid/probe values.

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

Choose animation actions from the visual/data topology:
- linear scan: animate current index, comparison, state update
- bounded interval / multi-pointer: animate boundary/probe movement and interval shrink/expand
- auxiliary lookup structure: animate lookup miss/hit and insert/update
- LIFO/FIFO container: animate push/pop/top or enqueue/dequeue/front/back
- node-link traversal: animate node focus, edge trace, visited/frontier update
- recurrence table: animate dependency cells before writing target cell
- sorting/greedy: animate comparison, candidate choice, confirmed region
- math/simple simulation: animate variables changing step by step

════════ VISUAL DESIGN TOKENS — SMALL LOCAL SET ONLY ════════
If style constants make the TSX clearer, define a compact local token set. Do not paste a huge unused design system.
Use plain JavaScript only, no TypeScript annotations.

Recommended tokens:
const COLORS = {
  primary: '#2563eb',
  success: '#16a34a',
  accent: '#d97706',
  danger: '#dc2626',
  text: '#1e293b',
  dim: '#475569',
  panel: 'rgba(248,250,252,0.72)',
  panelSoft: 'rgba(248,250,252,0.46)',
  border: 'rgba(148,163,184,0.42)',
};
const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 };
const RADIUS = { sm: 6, md: 10, lg: 14, xl: 16 };
const FONT = {
  sans: 'Manrope, PingFang SC, Microsoft YaHei UI, system-ui, sans-serif',
  mono: 'Fira Code, JetBrains Mono, Cascadia Code, Menlo, monospace',
};
const SHADOW = {
  card: '0 8px 24px rgba(15,23,42,0.08)',
  focus: '0 0 0 3px rgba(37,99,235,0.16), 0 12px 28px rgba(37,99,235,0.12)',
  compare: '0 0 0 3px rgba(217,119,6,0.18), 0 12px 28px rgba(217,119,6,0.10)',
  success: '0 0 0 3px rgba(22,163,74,0.18), 0 12px 28px rgba(22,163,74,0.12)',
};

════════ SURFACE DEPTH — POLISHED BUT RESTRAINED ════════
Make the scene feel premium through hierarchy, not decoration:
- Use neutral panel surfaces with subtle borders and soft shadows.
- Add very light gradients only inside cards or badges, never large saturated canvas backgrounds.
- Use one dominant hero visual; side panels should be quieter and smaller.
- Focus glow must follow the active operation color: blue current (SHADOW.focus), amber compare (SHADOW.compare), green final result (SHADOW.success). Do not use a single color for all states.
- Avoid glassmorphism, heavy blur, neon gradients, and purple app-template backgrounds unless the provided Status component already uses that metaphor.
- Use inner content depth: base data layer, action/highlight layer, annotation/result layer.

════════ COMPACTNESS GUARD — NO TOKEN DUMPING ════════
Do not output unused constants. Only define COLORS / SPACING / RADIUS / FONT / SHADOW if each is used at least once; drop any token set that is not referenced.
Prefer 6-20 lines of reusable local style helpers over dozens of one-off inline styles.
The final code should look intentionally designed, not like a pasted design-system catalog.

════════ STYLE ════════
- Warm, clean educational style; transparent page background.
- Use a restrained visual system: neutral panels, strong hero content, semantic color only on the active operation and confirmed result.
- Rounded cards, soft shadows, subtle gradients inside cards; avoid large saturated panel backgrounds.
- primary #2563eb for current focus, success #16a34a only for confirmed results/completed states, accent #d97706 for comparison or lookup, danger #dc2626 for rejection, dim #475569, text #1e293b.
- Do not use success green for progress dots/segments or routine intermediate DP writes. Progress should use blue/current, soft blue/slate completed, and slate pending. Reserve #16a34a for the final answer/result badge or truly confirmed answer cells.
- Use short text only: "比较", "查找", "更新", "入栈", "出队", "访问", "写入", "命中", "确认".
- Prefer visual state over paragraphs. One short invariant badge is enough.
- Keep typography consistent: labels 11-13px, badges 12-14px, hero values 20-28px, titles 13-16px.
- Leave intentional breathing room inside panels, but never allow the hero data to feel small or decorative.

Return a single default-exported function component.
Props: { module1=false, module2=false, module3=false, module4=false, module5=false }.
Use module1..module5 only for region active styling, not for controlling timeline logic.

CRITICAL: Output ONE block <ANIMATION_TSX>...</ANIMATION_TSX>, no markdown fences.
CRITICAL: Include an InvariantBadge component or helper and render it visibly.
CRITICAL: Do not include the substring "transition:" anywhere.
CRITICAL: Use interpolate with extrapolateLeft:'clamp' and extrapolateRight:'clamp' for opacity, position, and progress changes. Spring alone is not enough.`;

export interface AnimationPromptInput extends StatusPromptInput {
  /** 第 1 次调用产出的 Status 代码，让第 2 次调用对齐模块定义 */
  statusCode: string;
  /** Status 输出的 schema，告诉 Animation 用哪些 module key */
  schema: AlgoVizDetectionSchema;
  visualPlan?: AlgoVizVisualPlan | null;
  templateHint?: string;
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
  const traceText = input.trace ? `\nTRACE_JSON from Stage 0:\n${formatTraceForPrompt(input.trace)}\n` : '';
  const visualPlanText = input.visualPlan
    ? `\nVISUAL_PLAN_JSON from Stage 0.5:\n${formatVisualPlanForPrompt(input.visualPlan)}\n`
    : '';
  const user = `Generate Remotion animation for: ${input.schema.algoName}

Title: ${input.title}
Statement: ${input.statement}
${input.constraints ? `Constraints: ${input.constraints}\n` : ''}${examplesText ? `\n${examplesText}\n` : ''}${traceText}${visualPlanText}
Modules from schema (you MUST use exactly these as N fixed regions):
${moduleList}

CONTEXT (for module-definition consistency):
The Status component below was already generated with the same modules. Match its module count and meaning.

--- STATUS COMPONENT CODE ---
${input.statusCode}
--- END STATUS COMPONENT ---
${input.templateHint ? `\nALGORITHM_TEMPLATE_HINT:\n${input.templateHint}\n` : ''}

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

Examples (4 modules: input-read / auxiliary-index-structure / loop / output):
  empty code                                            → 0000
  "cin >> n;"                                           → 1000  (input tokens visible)
  "cin >> n; unordered_map<int,int> mp;"                → 1100  (auxiliary structure declared, even unused → 1)
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

function formatExamples(examples?: ProblemExample[]): string {
  return (examples ?? [])
    .slice(0, 2)
    .map(
      (ex, i) =>
        `Example ${i + 1}:\nInput:\n${ex.input}\nOutput:\n${ex.output}${
          ex.explanation ? `\nNote: ${ex.explanation}` : ''
        }`,
    )
    .join('\n\n');
}

function formatTraceForPrompt(trace: AlgoVizTrace): string {
  return JSON.stringify(trace, null, 2);
}

function formatVisualPlanForPrompt(plan: AlgoVizVisualPlan): string {
  return JSON.stringify(plan, null, 2);
}

function extractJsonFallback(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1];
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return '';
}

function normalizeTrace(value: unknown): AlgoVizTrace | null {
  if (!isRecord(value)) return null;
  const algoName = typeof value.algoName === 'string' ? value.algoName.trim() : '';
  const family = typeof value.family === 'string' ? value.family.trim() : '';
  const templateRoute = normalizeTemplateRoute(value.templateRoute);
  const sample = isRecord(value.sample) ? value.sample : {};
  const rawStates = Array.isArray(value.states) ? value.states : [];
  if (!algoName || !family || rawStates.length < 2 || rawStates.length > 12) return null;
  const states = rawStates
    .map((state, index) => {
      if (!isRecord(state)) return null;
      const id = typeof state.id === 'string' && state.id.trim() ? state.id.trim() : `s${index}`;
      const label = typeof state.label === 'string' && state.label.trim() ? state.label.trim() : id;
      const operation =
        typeof state.operation === 'string' && state.operation.trim() ? state.operation.trim() : 'update';
      const focus = Array.isArray(state.focus)
        ? state.focus.filter((item): item is string => typeof item === 'string')
        : undefined;
      const data = isRecord(state.data) ? state.data : {};
      const invariant =
        typeof state.invariant === 'string' && state.invariant.trim() ? state.invariant.trim() : undefined;
      const codeHint =
        typeof state.codeHint === 'string' && state.codeHint.trim() ? state.codeHint.trim() : undefined;
      return {
        id,
        label,
        operation,
        ...(focus?.length ? { focus } : {}),
        data,
        ...(invariant ? { invariant } : {}),
        ...(Object.prototype.hasOwnProperty.call(state, 'result') ? { result: state.result } : {}),
        ...(codeHint ? { codeHint } : {}),
      };
    })
    .filter((state): state is AlgoVizTrace['states'][number] => !!state);
  if (states.length < 2) return null;
  return { algoName, family, templateRoute, sample, states };
}

function normalizeTemplateRoute(value: unknown): AlgoVizTrace['templateRoute'] {
  if (value === null) return null;
  if (!isRecord(value)) return null;
  const templateId = typeof value.templateId === 'string' ? value.templateId.trim() : '';
  const family = typeof value.family === 'string' ? value.family.trim() : '';
  if (!templateId || !family) return null;
  const confidence =
    typeof value.confidence === 'number' && Number.isFinite(value.confidence)
      ? Math.max(0, Math.min(1, value.confidence))
      : 0.62;
  const evidence = Array.isArray(value.evidence)
    ? value.evidence.filter((item): item is string => typeof item === 'string' && !!item.trim()).slice(0, 6)
    : [];
  const subfamily =
    typeof value.subfamily === 'string' && value.subfamily.trim() ? value.subfamily.trim() : undefined;
  return {
    templateId,
    family,
    ...(subfamily ? { subfamily } : {}),
    confidence,
    evidence,
  };
}

function normalizeVisualPlan(value: unknown): AlgoVizVisualPlan | null {
  if (!isRecord(value)) return null;
  const layout = typeof value.layout === 'string' && value.layout.trim() ? value.layout.trim() : 'grid_2x2';
  const durationFrames = 300;
  const components = Array.isArray(value.components)
    ? value.components
        .map((component) => {
          if (!isRecord(component)) return null;
          const id = typeof component.id === 'string' && component.id.trim() ? component.id.trim() : '';
          const type = typeof component.type === 'string' && component.type.trim() ? component.type.trim() : '';
          if (!id || !type) return null;
          return {
            id,
            type,
            role: typeof component.role === 'string' && component.role.trim() ? component.role.trim() : 'state',
            ...(typeof component.dataRef === 'string' && component.dataRef.trim()
              ? { dataRef: component.dataRef.trim() }
              : {}),
            ...(typeof component.label === 'string' && component.label.trim()
              ? { label: component.label.trim() }
              : {}),
          };
        })
        .filter((component): component is AlgoVizVisualPlan['components'][number] => !!component)
    : [];
  const componentIdSet = new Set(components.map((component) => component.id));
  const regions = Array.isArray(value.regions)
    ? value.regions
        .map((region) => {
          if (!isRecord(region)) return null;
          const id = typeof region.id === 'string' && region.id.trim() ? region.id.trim() : '';
          const title = typeof region.title === 'string' && region.title.trim() ? region.title.trim() : id;
          const componentIds = Array.isArray(region.componentIds)
            ? region.componentIds.filter((item): item is string => typeof item === 'string')
            : [];
          if (!id || !title) return null;
          return {
            id,
            title,
            role: typeof region.role === 'string' && region.role.trim() ? region.role.trim() : 'side',
            componentIds: componentIds.filter((id) => componentIdSet.size === 0 || componentIdSet.has(id)),
          };
        })
        .filter((region): region is AlgoVizVisualPlan['regions'][number] => !!region)
    : [];
  const beats = Array.isArray(value.beats)
    ? value.beats
        .map((beat, index) => {
          if (!isRecord(beat)) return null;
          const id = typeof beat.id === 'string' && beat.id.trim() ? beat.id.trim() : `b${index}`;
          const stateId = typeof beat.stateId === 'string' && beat.stateId.trim() ? beat.stateId.trim() : `s${index}`;
          const start = typeof beat.start === 'number' && Number.isFinite(beat.start) ? Math.max(0, Math.round(beat.start)) : index * 40;
          const end =
            typeof beat.end === 'number' && Number.isFinite(beat.end)
              ? Math.max(start + 1, Math.round(beat.end))
              : start + 40;
          const actions = Array.isArray(beat.actions)
            ? beat.actions
                .map((action) => {
                  if (!isRecord(action)) return null;
                  const type = typeof action.type === 'string' && action.type.trim() ? action.type.trim() : '';
                  const target = typeof action.target === 'string' && action.target.trim() ? action.target.trim() : '';
                  if (!type || !target) return null;
                  return {
                    type,
                    target,
                    ...(typeof action.label === 'string' && action.label.trim()
                      ? { label: action.label.trim() }
                      : {}),
                    ...(isRecord(action.payload) ? { payload: action.payload } : {}),
                  };
                })
                .filter((action): action is AlgoVizVisualPlan['beats'][number]['actions'][number] => !!action)
            : [];
          return { id, stateId, start, end, actions };
        })
        .filter((beat): beat is AlgoVizVisualPlan['beats'][number] => !!beat)
    : [];
  if (components.length === 0 || regions.length === 0 || beats.length === 0) return null;
  const maxBeatEnd = beats.reduce((max, beat) => Math.max(max, beat.end), 0);
  const beatScale = maxBeatEnd > durationFrames ? durationFrames / maxBeatEnd : 1;
  const normalizedBeats = beats.map((beat) => {
    const scaledStart = Math.round(beat.start * beatScale);
    const scaledEnd = Math.round(beat.end * beatScale);
    const start = Math.max(0, Math.min(durationFrames - 1, scaledStart));
    const end = Math.max(start + 1, Math.min(durationFrames, scaledEnd));
    return { ...beat, start, end };
  });
  const finalBeat = normalizedBeats.at(-1);
  if (finalBeat) finalBeat.end = durationFrames;
  const style = isRecord(value.style)
    ? {
        ...(typeof value.style.tone === 'string' ? { tone: value.style.tone } : {}),
        ...(typeof value.style.primaryColor === 'string' ? { primaryColor: value.style.primaryColor } : {}),
        ...(typeof value.style.accentColor === 'string' ? { accentColor: value.style.accentColor } : {}),
      }
    : undefined;
  const composition = isRecord(value.composition)
    ? {
        ...(Array.isArray(value.composition.frame0Visible)
          ? {
              frame0Visible: value.composition.frame0Visible.filter(
                (item): item is string => typeof item === 'string',
              ),
            }
          : {}),
        ...(Array.isArray(value.composition.heroContent)
          ? {
              heroContent: value.composition.heroContent.filter(
                (item): item is string => typeof item === 'string',
              ),
            }
          : {}),
        ...(typeof value.composition.density === 'string' ? { density: value.composition.density } : {}),
        ...(typeof value.composition.heroRule === 'string' ? { heroRule: value.composition.heroRule } : {}),
        ...(typeof value.composition.focusStrategy === 'string'
          ? { focusStrategy: value.composition.focusStrategy }
          : {}),
        ...(typeof value.composition.antiEmptySpaceRule === 'string'
          ? { antiEmptySpaceRule: value.composition.antiEmptySpaceRule }
          : {}),
      }
    : undefined;
  return {
    layout,
    durationFrames,
    components,
    regions,
    beats: normalizedBeats,
    ...(composition ? { composition } : {}),
    ...(style ? { style } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
