// Platform — shared steering infrastructure for all product shells.
export * from './types';
export { assemblePrompt } from './prompt-assembler';
export {
  initialConversationState,
  updateConversationState,
  detectLaughter,
  activateWitCluster,
} from './conversation-tracker';
export { classify, computeRelationalDepth } from './classifier';
export { validate } from './validation';
export { selectPolicy } from './policy-selector';
export type { PolicySelectionContext } from './policy-selector';
export { scoreDepth } from './depth-scoring';
export { DEPTH_EVAL_CONFIG } from './depth-config';
export { antiSycophancyReinjection, detectSycophancy } from './sycophancy';
export { storePendingDepth, consumePendingDepth, clearPendingDepth } from './pending-depth';
export type { PendingDepth } from './pending-depth';
export { loadPolicies, reloadPolicies } from './policy-loader';
export { reformulate } from './reformulator';
export {
  detectRelationshipContext,
  updateRelationshipTurnCount,
  buildRelationshipInjection,
  relationshipSafetyRewrite,
} from './relationship-safety';
