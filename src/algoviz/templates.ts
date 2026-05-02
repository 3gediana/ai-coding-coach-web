import type { AlgoVizTemplateRoute } from '../core/types';

export type { AlgoVizTemplateRoute };

export interface AlgoVizTemplate {
  id: string;
  family: string;
  subfamily?: string;
  version: string;
  visualPlanHint: string;
  animationHint: string;
}

export const COMMON_TEMPLATE_SAFETY_GUARD = `COMMON_TEMPLATE_SAFETY_GUARD:
- Never call interpolate() with an equal or descending inputRange. Every inputRange must be strictly increasing.
- For beat progress, do not use nextBeat.start when currentBeat is already the final beat. Use a safe denominator such as Math.max(currentBeat.end, currentBeat.start + 1), or Math.max((nextBeat?.start ?? currentBeat.end), currentBeat.start + 1).
- Clamp all interpolate() calls with extrapolateLeft:'clamp' and extrapolateRight:'clamp'.
- Always provide a fallback current state/beat before reading fields such as operation, data, start, end, focus, or invariant.
- Final beats must render at frame 290 and frame 299 without relying on a nonexistent next beat.`;

const templates: AlgoVizTemplate[] = [
  {
    id: 'dynamic_programming.table.v1',
    family: 'dynamic_programming',
    subfamily: 'dp_table',
    version: 'v1',
    visualPlanHint: `Use table_focus or a large hero table. Keep input cells, base cases, DP row/table, recurrence badge, invariant, progress, and final answer visible. Model each beat as dependency READ cells first, then target WRITE cell. Keep intermediate writes blue, dependency reads amber, and reserve green for final confirmed answer only.`,
    animationHint: `Render a persistent DP table/row as the hero. Show base cases from frame 0. For every transition, highlight dependency cells in amber before highlighting the target cell in blue. Display a compact recurrence expression near the table. Do not turn intermediate DP cells green. Use green only on the final answer cell/result badge.`,
  },
  {
    id: 'hash_lookup.map.v1',
    family: 'hash_lookup',
    version: 'v1',
    visualPlanHint: `Use hero_side_panels with input cells as the hero and a persistent hash map/set side panel. Beats should separate current item, complement/key lookup, miss/hit, insert/update, and final confirmation.`,
    animationHint: `Render input cells and a persistent map/set table. Highlight current value in blue and lookup key/complement in amber. On lookup miss, show insertion/update into the map as a blue write. On lookup hit, connect current cell to matched map entry and reserve green for the confirmed result pair/value.`,
  },
  {
    id: 'binary_search.interval.v1',
    family: 'binary_search',
    version: 'v1',
    visualPlanHint: `Use a linear row hero with fixed L, mid, and R markers plus a comparison/result side panel. Beats must recompute mid only when it lies inside the current interval, then shrink the interval according to the trace state.`,
    animationHint: `Render the sorted row persistently. Place L, mid, and R markers under/above cells. Use amber for the active comparison at mid and blue for active interval boundaries. When the interval shrinks, dim excluded cells but keep them visible. Do not display a stale mid outside the current interval. Use green only for found/confirmed result.`,
  },
  {
    id: 'sliding_window.band.v1',
    family: 'sliding_window',
    version: 'v1',
    visualPlanHint: `Use a linear row hero with a translucent active window band spanning L..R, plus side panels for current aggregate, validity, best answer, invariant, and progress. Beats should alternate expand, update aggregate, shrink if needed, and confirm best.`,
    animationHint: `Render an input row with a translucent window band. Attach L and R pointer chips to the current bounds. Highlight newly included values in blue, values being removed in amber/danger, and current best only as a stable badge. Keep the band geometry readable and avoid turning routine valid windows green before final confirmation.`,
  },
  {
    id: 'monotonic_stack.stack.v1',
    family: 'monotonic_stack',
    version: 'v1',
    visualPlanHint: `Use hero_side_panels or grid_2x2 with input row, vertical stack, answer/output row, comparison badge, invariant, and progress. Beats should show current item, stack top comparison, repeated pops, push, and answer write.`,
    animationHint: `Render input row, output row, and a vertical stack container. Highlight current item in blue and stack top comparison in amber. Show pop operations by moving/dimming the top element out of the stack, then write the discovered answer in blue. Keep stack order visually stable; reserve green for final completed output only.`,
  },
  {
    id: 'two_pointers.converging.v1',
    family: 'two_pointers',
    version: 'v1',
    visualPlanHint: `Use a linear row hero with persistent left and right pointer chips, plus comparison/sum, move reason, invariant, result, and progress panels. Beats should compare, decide pointer move, update pointer, and confirm result.`,
    animationHint: `Render the row persistently with L and R markers. Highlight both pointed cells in blue and the comparison/sum expression in amber. When a pointer moves, keep the old position dimmed and the new pointer blue. Do not hide excluded cells; show them as outside the active search interval. Use green only for the confirmed pair/result.`,
  },
  {
    id: 'prefix_sum.ranges.v1',
    family: 'prefix_sum',
    version: 'v1',
    visualPlanHint: `Use a table/row layout with input row, prefix row, selected range band, formula badge, answer badge, invariant, and progress. Beats should build prefix values or read two prefix endpoints before computing a range.`,
    animationHint: `Render input and prefix rows as persistent aligned cells. Highlight prefix endpoints in amber when reading, then show the subtraction formula. Highlight newly written prefix cells in blue. Use a translucent range band over the input cells for queried ranges. Reserve green for the final computed answer only.`,
  },
  {
    id: 'bfs.queue.v1',
    family: 'bfs',
    subfamily: 'queue_traversal',
    version: 'v1',
    visualPlanHint: `Use graph_focus for graph/grid traversal. Include graph/grid hero, queue/frontier panel, visited set, current node/cell, distance/level badge, invariant, and progress. Beats should dequeue, visit, inspect neighbors, enqueue new nodes, and confirm result.`,
    animationHint: `Render graph/grid persistently. Highlight the current dequeued node/cell in blue, candidate neighbors in amber, and already visited nodes dimmed. Show the queue/frontier as ordered chips. Enqueue writes should be blue; do not use green until the target/result is confirmed.`,
  },
  {
    id: 'dfs_backtracking.recursion.v1',
    family: 'dfs_backtracking',
    version: 'v1',
    visualPlanHint: `Use a recursion/search-tree focused layout with choice list, current path, call stack or recursion tree, result collection, invariant, and progress. Beats should choose, recurse, hit base case, record result, and backtrack.`,
    animationHint: `Render current path and call stack persistently. Highlight the active choice in blue, rejected/skipped choices in amber or danger, and base-case recording as a clear write to the result collection. On backtrack, visually remove the last choice from the path without deleting historical context abruptly. Use green only for confirmed collected results/final answer.`,
  },
  {
    id: 'heap_topk.min_heap.v1',
    family: 'heap_topk',
    version: 'v1',
    visualPlanHint: `Use input stream plus heap hero/side panel, size threshold k, push/pop operation badge, heap top, invariant, result, and progress. Beats should process current value, push, compare heap size/top, pop if oversized, and confirm heap top/result.`,
    animationHint: `Render the input stream and a persistent min-heap/top-k container. Highlight current input in blue. Show push as a blue insertion into heap. When heap exceeds k, highlight heap top/smallest in amber/danger before popping. Keep the k threshold visible. Use green only for the final kth/top-k result.`,
  },
  {
    id: 'union_find.parent_array.v1',
    family: 'union_find',
    version: 'v1',
    visualPlanHint: `Use a node/parent-array layout with node circles, parent array, find path, union edge, component count, invariant, result, and progress. Beats should show find path/root, compare roots, parent write, count decrement, and final components.`,
    animationHint: `Render node circles and parent array persistently. Highlight find path reads in amber, roots in blue, and parent pointer writes in blue. For union, show the edge being processed and the two roots before the parent update. Decrement component count only on successful union. Reserve green for final components/result.`,
  },
  {
    id: 'greedy_intervals.timeline.v1',
    family: 'greedy_intervals',
    version: 'v1',
    visualPlanHint: `Use a horizontal interval timeline hero with sorted intervals, current candidate, accepted/rejected set, end boundary, invariant, result, and progress. Beats should sort/scan, compare start with current end, accept or reject, update boundary, and confirm count/result.`,
    animationHint: `Render intervals on a shared timeline. Highlight current interval in blue and the active end boundary in amber. Accepted intervals may become stable blue/slate, rejected intervals should dim or mark danger. Show greedy invariant as the earliest finishing boundary. Use green only on final answer/count.`,
  },
  {
    id: 'dijkstra.shortest_path.v1',
    family: 'dijkstra',
    version: 'v1',
    visualPlanHint: `Use graph_focus with weighted graph hero, priority queue, distance table, settled set, relax operation, invariant, and progress. Beats should pop min-distance node, settle it, inspect outgoing edge, relax distance, update queue, and confirm shortest path/result.`,
    animationHint: `Render weighted graph and distance table persistently. Highlight the priority-queue minimum in blue, inspected edge in amber, and distance relax/write in blue. Settled nodes should become stable but not green unless they are the final target. Keep queue order and distance values readable. Use green only for confirmed final shortest distance/path.`,
  },
  {
    id: 'tree_traversal.frames.v1',
    family: 'tree_traversal',
    version: 'v1',
    visualPlanHint: `Use graph_focus with tree hero, call stack or traversal stack, visited/output row, current node, invariant, result, and progress. Beats should descend, visit node, emit/output value, move to child/subtree, and confirm traversal order.`,
    animationHint: `Render the tree persistently. Highlight current node in blue, next child/edge in amber, and emitted output cells in blue as they are written. Show stack/call frames as ordered chips. Keep previously visited nodes visible but subdued. Use green only for final completed traversal/output.`,
  },
];

const templateById = new Map(templates.map((template) => [template.id, template]));

export function getAlgoVizTemplate(templateId: string | null | undefined): AlgoVizTemplate | null {
  if (!templateId) return null;
  return templateById.get(templateId) ?? null;
}

export function buildVisualPlanTemplateHint(template: AlgoVizTemplate, route: AlgoVizTemplateRoute): string {
  return `Template route: ${route.templateId} (${Math.round(route.confidence * 100)}% confidence). Evidence: ${route.evidence.join(', ') || 'rule match'}.
${template.visualPlanHint}`;
}

export function buildAnimationTemplateHint(template: AlgoVizTemplate, route: AlgoVizTemplateRoute): string {
  return `Template route: ${route.templateId} (${Math.round(route.confidence * 100)}% confidence). Evidence: ${route.evidence.join(', ') || 'rule match'}.
${template.animationHint}

${COMMON_TEMPLATE_SAFETY_GUARD}`;
}
