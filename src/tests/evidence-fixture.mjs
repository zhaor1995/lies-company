import { RESEARCH_ROUNDS } from '../dist/research-content.js';

// Preverified evidence for isolated combat tests. Full acquisition and model
// recommendation are exercised separately in research and investigation tests.
export function queueEvidence(state, focus = 'spread') {
  const definition = RESEARCH_ROUNDS[state.evidence.length];
  const material = definition.materials.find(item => item.focus === focus);
  const result = { roundId: definition.id, time: state.time, query: definition.defaultQuery,
    evidenceIds: definition.materials.map(item => item.id), selectedId: material.id,
    promotedId: null, promotedAt: null, title: definition.finding, detail: definition.finding };
  state.evidence.push(definition.id); state.researchResults.push(result);
  return result;
}
