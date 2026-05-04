import { describe, expect, it } from 'vitest';
import {
  buildAnimationPromptFamilyHint,
  buildAnimationTemplateHint,
  buildVisualPlanPromptFamilyHint,
  buildVisualPlanTemplateHint,
  getAlgoVizTemplate,
  selectAlgoVizPromptFamily,
} from './templates';
import type { AlgoVizTrace, AlgoVizVisualPlan } from '../core/types';

function traceWithTemplate(templateId: string): AlgoVizTrace {
  return {
    algoName: 'SampleAlgo',
    family: 'sample',
    templateRoute: {
      templateId,
      family: templateId.split('.')[0],
      confidence: 0.9,
      evidence: ['unit-test'],
    },
    sample: {},
    states: [
      { id: 's0', label: 'setup', operation: 'setup', data: {}, focus: ['array[0]'] },
      { id: 's1', label: 'done', operation: 'done', data: {}, result: true },
    ],
  };
}

describe('AlgoViz prompt family routing', () => {
  it('routes dijkstra template to graph prompt family while preserving the layer-2 template hint', () => {
    const trace = traceWithTemplate('dijkstra.shortest_path.v1');
    const familyRoute = selectAlgoVizPromptFamily({ trace });
    const template = getAlgoVizTemplate(trace.templateRoute?.templateId);

    expect(familyRoute.promptFamilyId).toBe('cinematic-brightstage-curve-v22');
    expect(familyRoute.topologyKind).toBe('node_link_graph');
    expect(template?.id).toBe('dijkstra.shortest_path.v1');
    expect(buildVisualPlanPromptFamilyHint(familyRoute)).toContain('Layer-1 prompt family');
    expect(buildAnimationPromptFamilyHint(familyRoute)).toContain('graph/node-link');
    expect(template && trace.templateRoute ? buildAnimationTemplateHint(template, trace.templateRoute) : '').toContain('dijkstra.shortest_path.v1');
  });

  it('routes hash lookup template to generic prompt family while preserving the layer-2 template hint', () => {
    const trace = traceWithTemplate('hash_lookup.map.v1');
    const familyRoute = selectAlgoVizPromptFamily({ trace });
    const template = getAlgoVizTemplate(trace.templateRoute?.templateId);

    expect(familyRoute.promptFamilyId).toBe('cinematic-brightstage-curve-v30');
    expect(template?.id).toBe('hash_lookup.map.v1');
    expect(buildAnimationPromptFamilyHint(familyRoute)).toContain('generic non-graph');
    expect(template && trace.templateRoute ? buildVisualPlanTemplateHint(template, trace.templateRoute) : '').toContain('hash_lookup.map.v1');
  });

  it('uses visual-plan graph_focus as fallback for old traces without prompt family metadata', () => {
    const trace = traceWithTemplate('union_find.parent_array.v1');
    const visualPlan: AlgoVizVisualPlan = {
      layout: 'graph_focus',
      durationFrames: 300,
      components: [{ id: 'graph', type: 'GraphCanvas', role: 'input' }],
      regions: [{ id: 'hero', title: 'Graph', role: 'graph', componentIds: ['graph'] }],
      beats: [{ id: 'b0', stateId: 's0', start: 0, end: 300, actions: [{ type: 'focus', target: 'graph' }] }],
    };

    const familyRoute = selectAlgoVizPromptFamily({ trace, visualPlan });

    expect(familyRoute.promptFamilyId).toBe('cinematic-brightstage-curve-v22');
    expect(familyRoute.evidence).toContain('layout:graph_focus');
  });
});
