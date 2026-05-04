import type {
  AlgoVizPromptFamilyRoute,
  AlgoVizTemplateRoute,
  AlgoVizTrace,
  AlgoVizVisualPlan,
} from '../core/types';

export type { AlgoVizTemplateRoute };

export interface AlgoVizTemplate {
  id: string;
  family: string;
  subfamily?: string;
  version: string;
  visualPlanHint: string;
  animationHint: string;
}

const GRAPH_PROMPT_FAMILY_ID = 'cinematic-brightstage-curve-v22';
const GENERIC_PROMPT_FAMILY_ID = 'cinematic-brightstage-curve-v30';
const GRAPH_TEMPLATE_IDS = new Set([
  'bfs.queue.v1',
  'dijkstra.shortest_path.v1',
  'tree_traversal.frames.v1',
]);

const PROMPT_FAMILY_HINTS: Record<string, { visualPlanHint: string; animationHint: string }> = {
  [GRAPH_PROMPT_FAMILY_ID]: {
    visualPlanHint: `Layer-1 prompt family: graph/node-link cinematic brightstage. This is the broad visual foundation; still obey the Layer-2 VISUAL_TEMPLATE_HINT if present. Prefer graph_focus with one large node-link hero, exact node/edge anchors, stable route/visited/frontier semantics, and minimal surrounding panels. Plan curves/edges as semantic motion only: connected at node boundaries, symmetric where possible, never covering labels, and visible from frame 0.`,
    animationHint: `Layer-1 prompt family: graph/node-link cinematic brightstage. This is the broad visual foundation; still obey the Layer-2 ALGORITHM_TEMPLATE_HINT if present. Render one premium bright node-link stage with all nodes/edges visible at frame 0. Use deterministic frame-driven motion only. Curves and edges must connect exactly to node boundaries, avoid text, and never gap or drift. Keep labels minimal and stable; use SVG foreignObject or safe generated-label HTML for node labels, never SVG <text>. No raw animate tags, no undefined filters, no CSS keyframes, no style property named transition. Compute complex highlight indices and derived values in const variables before return; do not place nested ternaries in JSX attributes.`,
  },
  [GENERIC_PROMPT_FAMILY_ID]: {
    visualPlanHint: `Layer-1 prompt family: generic non-graph cinematic brightstage. This is the broad visual foundation; still obey the Layer-2 VISUAL_TEMPLATE_HINT if present. Prefer one large semantic hero structure: array row, binary-search interval, hash lookup row+map, DP row/table, stack/queue, heap, parent array, interval timeline, or recursion frames. Avoid dashboard/card-grid composition: use one dominant hero occupying most of the stage, with at most two compact support/result zones. Keep frame 0 readable with title/goal/core data visible. Plan minimal text, safe relation rails, and a clean final result composition.`,
    animationHint: `Layer-1 prompt family: generic non-graph cinematic brightstage v30. This is the broad visual foundation; still obey the Layer-2 ALGORITHM_TEMPLATE_HINT if present. Use a premium bright educational stage with one large hero data structure occupying most of the canvas; avoid dashboard/card-grid composition and empty panels. Use generated-label-only visible text when practical, and minimal raw DOM text. Include .generatedLabel::before { content: attr(data-label); } if using generated labels. Do not leave raw JSX text separators such as <span>→</span>; separators should also use data-label. Keep frame 0 title/goal/core data visible. Never call interpolate with equal or descending input ranges. SVG primitives must be inside svg, and SVG <text> is forbidden. Hide transient operation chips in final frames when they crowd the result. Compute complex highlight indices and derived values in const variables before return; do not place nested ternaries in JSX attributes. No CSS keyframes, no style property named transition, no timers, no random sources.`,
  },
};

export const COMMON_TEMPLATE_SAFETY_GUARD = `COMMON_TEMPLATE_SAFETY_GUARD:
- Never call interpolate() with an equal or descending inputRange. Every inputRange must be strictly increasing.
- For beat progress, do not use nextBeat.start when currentBeat is already the final beat. Use a safe denominator such as Math.max(currentBeat.end, currentBeat.start + 1), or Math.max((nextBeat?.start ?? currentBeat.end), currentBeat.start + 1).
- Clamp all interpolate() calls with extrapolateLeft:'clamp' and extrapolateRight:'clamp'.
- Always provide a fallback current state/beat before reading fields such as operation, data, start, end, focus, or invariant.
- Final beats must render at frame 290 and frame 299 without relying on a nonexistent next beat.
- TRACE_JSON is authoritative. Numeric arrays, pointers, ranges, map entries, table values, and result values must match trace states when provided.
- Never display NaN, undefined, Infinity, null as a user-facing value, or any out-of-range index such as nums[n], dp[n], arr[-1], parent[n], dist[n], or grid[-1].
- Before rendering any formula using nums[i], dp[i], prefix[i], parent[i], dist[i], heap[i], low/mid/high, or a map/set key, ensure that index/key exists in the displayed data. If uncertain, omit that formula and show the invariant/result text instead.
- If a beat is a final/result/return state, do not show active recurrence formulas, next-index computation, stale probe labels, or phantom updates; show only the validated result from TRACE_JSON.
- Do not put semantic text within 32px of the progress row or canvas bottom. Final result belongs in a side/result panel or centered inside an existing safe region.
- Semantic relation marks may use RemotionShapes Arrow/Rect/Circle only when they clarify dependency flow, interval/window bounds, lookup direction, parent pointers, relax edges, queue/stack movement, or traversal direction.
- Every Arrow must explicitly set length, headLength, headWidth, and shaftWidth. Keep length >= 24 and use headLength={8}, headWidth={8}, shaftWidth={3} unless there is a clear reason to use larger values.
- Shapes are inner-layer semantic marks only. Keep them inside clipped regions and away from text.`;

export const COMMON_TEMPLATE_VISUAL_PLAN_GUARD = `COMMON_TEMPLATE_VISUAL_PLAN_GUARD:
- Plan one dominant semantic relation per beat, not decorative motion.
- For final/result beats, stop planning active formulas or next-index computations; target only the validated result and stable invariant.
- If the topology has a dependency, interval, window, lookup, parent pointer, edge relax, queue/stack operation, or traversal relation, include a safe relation-marker action target that Animation may render with RemotionShapes.
- Keep result/invariant components away from the bottom progress row and inside normal grid regions.`;

const templates: AlgoVizTemplate[] = [
  {
    id: 'dynamic_programming.table.v1',
    family: 'dynamic_programming',
    subfamily: 'dp_table',
    version: 'v1',
    visualPlanHint: `Use table_focus or a large hero table. Keep input cells, base cases, DP row/table, recurrence badge, invariant, progress, and final answer visible. Model each beat as dependency READ cells first, then target WRITE cell. Keep intermediate writes blue, dependency reads amber, and reserve green for final confirmed answer only.`,
    animationHint: `Render a persistent DP table/row as the hero. Show base cases from frame 0. For every transition, highlight dependency cells in amber before highlighting the target cell in blue. Use a small RemotionShapes Arrow from dependency cells toward the target write when it fits without covering text. Display a compact recurrence expression near the table. Do not turn intermediate DP cells green. Use green only on the final answer cell/result badge.`,
  },
  {
    id: 'hash_lookup.map.v1',
    family: 'hash_lookup',
    version: 'v1',
    visualPlanHint: `Use hero_side_panels with input cells as the hero and a persistent hash map/set side panel. Beats should separate current item, complement/key lookup, miss/hit, insert/update, and final confirmation.`,
    animationHint: `Render input cells and a persistent map/set table. Highlight current value in blue and lookup key/complement in amber. Use a small RemotionShapes Arrow for current-cell to lookup-key or matched-entry flow when it fits without covering text. On lookup miss, show insertion/update into the map as a blue write. On lookup hit, connect current cell to matched map entry and reserve green for the confirmed result pair/value.`,
  },
  {
    id: 'binary_search.interval.v1',
    family: 'binary_search',
    version: 'v1',
    visualPlanHint: `Use a linear row hero with fixed L, mid, and R markers plus a comparison/result side panel. Beats must recompute mid only when it lies inside the current interval, then shrink the interval according to the trace state.`,
    animationHint: `Render the sorted row persistently. Place L, mid, and R markers under/above cells. Use RemotionShapes Rect or a thin Arrow/line-like marker to show the active interval only if it stays inside the row. Use amber for the active comparison at mid and blue for active interval boundaries. When the interval shrinks, dim excluded cells but keep them visible. Do not display a stale mid outside the current interval. Use green only for found/confirmed result.`,
  },
  {
    id: 'sliding_window.band.v1',
    family: 'sliding_window',
    version: 'v1',
    visualPlanHint: `Use a linear row hero with a translucent active window band spanning L..R, plus side panels for current aggregate, validity, best answer, invariant, and progress. Beats should alternate expand, update aggregate, shrink if needed, and confirm best.`,
    animationHint: `Render an input row with a translucent window band. Attach L and R pointer chips to the current bounds. Use RemotionShapes Rect for the active window band if it is easier and safer than custom borders. Highlight newly included values in blue, values being removed in amber/danger, and current best only as a stable badge. Keep the band geometry readable and avoid turning routine valid windows green before final confirmation.`,
  },
  {
    id: 'monotonic_stack.stack.v1',
    family: 'monotonic_stack',
    version: 'v1',
    visualPlanHint: `Use hero_side_panels or grid_2x2 with input row, vertical stack, answer/output row, comparison badge, invariant, and progress. Beats should show current item, stack top comparison, repeated pops, push, and answer write.`,
    animationHint: `Render input row, output row, and a vertical stack container. Highlight current item in blue and stack top comparison in amber. Use a small RemotionShapes Arrow for push/pop direction when it fits inside the stack region. Show pop operations by moving/dimming the top element out of the stack, then write the discovered answer in blue. Keep stack order visually stable; reserve green for final completed output only.`,
  },
  {
    id: 'two_pointers.converging.v1',
    family: 'two_pointers',
    version: 'v1',
    visualPlanHint: `Use a linear row hero with persistent left and right pointer chips, plus comparison/sum, move reason, invariant, result, and progress panels. Beats should compare, decide pointer move, update pointer, and confirm result.`,
    animationHint: `Render the row persistently with L and R markers. Highlight both pointed cells in blue and the comparison/sum expression in amber. Use small RemotionShapes Arrows only to indicate pointer movement direction, not as decorative arrows. When a pointer moves, keep the old position dimmed and the new pointer blue. Do not hide excluded cells; show them as outside the active search interval. Use green only for the confirmed pair/result.`,
  },
  {
    id: 'prefix_sum.ranges.v1',
    family: 'prefix_sum',
    version: 'v1',
    visualPlanHint: `Use a table/row layout with input row, prefix row, selected range band, formula badge, answer badge, invariant, and progress. Beats should build prefix values or read two prefix endpoints before computing a range.`,
    animationHint: `Render input and prefix rows as persistent aligned cells. Highlight prefix endpoints in amber when reading, then show the subtraction formula. Use RemotionShapes Rect for the queried input range band when it stays within the row. Highlight newly written prefix cells in blue. Reserve green for the final computed answer only.`,
  },
  {
    id: 'bfs.queue.v1',
    family: 'bfs',
    subfamily: 'queue_traversal',
    version: 'v1',
    visualPlanHint: `Use graph_focus for graph/grid traversal. Include graph/grid hero, queue/frontier panel, visited set, current node/cell, distance/level badge, invariant, and progress. Beats should dequeue, visit, inspect neighbors, enqueue new nodes, and confirm result.`,
    animationHint: `Render graph/grid persistently. Highlight the current dequeued node/cell in blue, candidate neighbors in amber, and already visited nodes dimmed. Use small RemotionShapes Arrows for inspected neighbor direction or queue movement when they do not cover labels. Show the queue/frontier as ordered chips. Enqueue writes should be blue; do not use green until the target/result is confirmed.`,
  },
  {
    id: 'dfs_backtracking.recursion.v1',
    family: 'dfs_backtracking',
    version: 'v1',
    visualPlanHint: `Use a recursion/search-tree focused layout with choice list, current path, call stack or recursion tree, result collection, invariant, and progress. Beats should choose, recurse, hit base case, record result, and backtrack.`,
    animationHint: `Render current path and call stack persistently. Highlight the active choice in blue, rejected/skipped choices in amber or danger, and base-case recording as a clear write to the result collection. Use a small RemotionShapes Arrow for choose/recurse or backtrack direction when it fits inside the path/stack region. On backtrack, visually remove the last choice from the path without deleting historical context abruptly. Use green only for confirmed collected results/final answer.`,
  },
  {
    id: 'heap_topk.min_heap.v1',
    family: 'heap_topk',
    version: 'v1',
    visualPlanHint: `Use input stream plus heap hero/side panel, size threshold k, push/pop operation badge, heap top, invariant, result, and progress. Beats should process current value, push, compare heap size/top, pop if oversized, and confirm heap top/result.`,
    animationHint: `Render the input stream and a persistent min-heap/top-k container. Highlight current input in blue. Use a small RemotionShapes Arrow for push into heap or pop from heap when it stays inside the heap region. Show push as a blue insertion into heap. When heap exceeds k, highlight heap top/smallest in amber/danger before popping. Keep the k threshold visible. Use green only for the final kth/top-k result.`,
  },
  {
    id: 'union_find.parent_array.v1',
    family: 'union_find',
    version: 'v1',
    visualPlanHint: `Use a node/parent-array layout with node circles, parent array, find path, union edge, component count, invariant, result, and progress. Beats should show find path/root, compare roots, parent write, count decrement, and final components.`,
    animationHint: `Render node circles and parent array persistently. Highlight find path reads in amber, roots in blue, and parent pointer writes in blue. Use RemotionShapes Arrows for parent-pointer or union-edge relation only when endpoints are clear and labels remain readable. For union, show the edge being processed and the two roots before the parent update. Decrement component count only on successful union. Reserve green for final components/result.`,
  },
  {
    id: 'greedy_intervals.timeline.v1',
    family: 'greedy_intervals',
    version: 'v1',
    visualPlanHint: `Use a horizontal interval timeline hero with sorted intervals, current candidate, accepted/rejected set, end boundary, invariant, result, and progress. Beats should sort/scan, compare start with current end, accept or reject, update boundary, and confirm count/result.`,
    animationHint: `Render intervals on a shared timeline. Highlight current interval in blue and the active end boundary in amber. Use RemotionShapes Rect for current/accepted interval overlays or boundary emphasis when it remains inside the timeline. Accepted intervals may become stable blue/slate, rejected intervals should dim or mark danger. Show greedy invariant as the earliest finishing boundary. Use green only on final answer/count.`,
  },
  {
    id: 'dijkstra.shortest_path.v1',
    family: 'dijkstra',
    version: 'v1',
    visualPlanHint: `Use graph_focus with weighted graph hero, priority queue, distance table, settled set, relax operation, invariant, and progress. Beats should pop min-distance node, settle it, inspect outgoing edge, relax distance, update queue, and confirm shortest path/result.`,
    animationHint: `Render weighted graph and distance table persistently. Highlight the priority-queue minimum in blue, inspected edge in amber, and distance relax/write in blue. Use a RemotionShapes Arrow for inspected edge/relax direction when it stays inside the graph region and does not cover weights. Settled nodes should become stable but not green unless they are the final target. Keep queue order and distance values readable. Use green only for confirmed final shortest distance/path.`,
  },
  {
    id: 'tree_traversal.frames.v1',
    family: 'tree_traversal',
    version: 'v1',
    visualPlanHint: `Use graph_focus with tree hero, call stack or traversal stack, visited/output row, current node, invariant, result, and progress. Beats should descend, visit node, emit/output value, move to child/subtree, and confirm traversal order.`,
    animationHint: `Render the tree persistently. Highlight current node in blue, next child/edge in amber, and emitted output cells in blue as they are written. Use a RemotionShapes Arrow for traversal edge direction only when it remains inside the tree region and avoids text. Show stack/call frames as ordered chips. Keep previously visited nodes visible but subdued. Use green only for final completed traversal/output.`,
  },
];

const templateById = new Map(templates.map((template) => [template.id, template]));

export function getAlgoVizTemplate(templateId: string | null | undefined): AlgoVizTemplate | null {
  if (!templateId) return null;
  return templateById.get(templateId) ?? null;
}

export function selectAlgoVizPromptFamily(input: {
  trace?: AlgoVizTrace | null;
  visualPlan?: AlgoVizVisualPlan | null;
}): AlgoVizPromptFamilyRoute {
  const explicit = input.visualPlan?.promptFamilyRoute ?? input.trace?.promptFamilyRoute ?? null;
  if (explicit) return explicit;
  const templateId = input.trace?.templateRoute?.templateId;
  const layout = input.visualPlan?.layout;
  const graphByLayout = layout === 'graph_focus';
  const graphByTemplate = !!templateId && GRAPH_TEMPLATE_IDS.has(templateId);
  const graphByFocus =
    input.trace?.states.some((state) => state.focus?.some((target) => /^node\[|^edge\[|^graph\[/.test(target))) ?? false;
  if (graphByLayout || graphByTemplate || graphByFocus) {
    return {
      promptFamilyId: GRAPH_PROMPT_FAMILY_ID,
      topologyKind: 'node_link_graph',
      confidence: graphByTemplate || graphByLayout ? 0.86 : 0.72,
      evidence: [
        ...(templateId ? [`template:${templateId}`] : []),
        ...(layout ? [`layout:${layout}`] : []),
        ...(graphByFocus ? ['trace focus uses node/edge targets'] : []),
      ],
    };
  }
  return {
    promptFamilyId: GENERIC_PROMPT_FAMILY_ID,
    topologyKind: layout === 'table_focus' ? 'table_or_dp' : 'linear_or_structured_non_graph',
    confidence: 0.78,
    evidence: [
      ...(templateId ? [`template:${templateId}`] : []),
      ...(layout ? [`layout:${layout}`] : []),
      'default non-graph cinematic generated-label family',
    ],
  };
}

export function buildVisualPlanPromptFamilyHint(route: AlgoVizPromptFamilyRoute): string {
  const hint = PROMPT_FAMILY_HINTS[route.promptFamilyId] ?? PROMPT_FAMILY_HINTS[GENERIC_PROMPT_FAMILY_ID];
  return `Prompt family route: ${route.promptFamilyId} / ${route.topologyKind} (${Math.round(route.confidence * 100)}% confidence). Evidence: ${route.evidence.join(', ') || 'topology route'}.
${hint.visualPlanHint}`;
}

export function buildAnimationPromptFamilyHint(route: AlgoVizPromptFamilyRoute): string {
  const hint = PROMPT_FAMILY_HINTS[route.promptFamilyId] ?? PROMPT_FAMILY_HINTS[GENERIC_PROMPT_FAMILY_ID];
  return `Prompt family route: ${route.promptFamilyId} / ${route.topologyKind} (${Math.round(route.confidence * 100)}% confidence). Evidence: ${route.evidence.join(', ') || 'topology route'}.
${hint.animationHint}`;
}

export function buildVisualPlanTemplateHint(template: AlgoVizTemplate, route: AlgoVizTemplateRoute): string {
  return `Template route: ${route.templateId} (${Math.round(route.confidence * 100)}% confidence). Evidence: ${route.evidence.join(', ') || 'rule match'}.
${template.visualPlanHint}

${COMMON_TEMPLATE_VISUAL_PLAN_GUARD}`;
}

export function buildAnimationTemplateHint(template: AlgoVizTemplate, route: AlgoVizTemplateRoute): string {
  return `Template route: ${route.templateId} (${Math.round(route.confidence * 100)}% confidence). Evidence: ${route.evidence.join(', ') || 'rule match'}.
${template.animationHint}

${COMMON_TEMPLATE_SAFETY_GUARD}`;
}
