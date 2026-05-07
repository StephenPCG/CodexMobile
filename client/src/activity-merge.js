import { isThinkingActivityStep } from './activity-display.js';

function isNarrativeStep(step = null) {
  const kind = String(step?.kind || '');
  return (kind === 'agent_message' || kind === 'message') && !step?.command;
}

function findLastIndex(items, predicate) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index], index)) {
      return index;
    }
  }
  return -1;
}

export function mergeActivityStep(currentSteps, step) {
  if (!step) {
    return currentSteps || [];
  }
  const steps = [...(currentSteps || [])];
  const existingIndex = steps.findIndex((item) => item.id === step.id);
  if (existingIndex >= 0) {
    steps[existingIndex] = { ...steps[existingIndex], ...step };
    return steps;
  }

  if (isThinkingActivityStep(step)) {
    const thinkingIndex = steps.findIndex((item) => isThinkingActivityStep(item));
    if (thinkingIndex >= 0) {
      steps[thinkingIndex] = { ...steps[thinkingIndex], ...step };
      return steps;
    }
  }

  if (isNarrativeStep(step)) {
    const narrativeIndex = findLastIndex(steps, (item) => isNarrativeStep(item));
    if (narrativeIndex >= 0) {
      steps[narrativeIndex] = { ...steps[narrativeIndex], ...step };
      return steps;
    }
  }

  const sameWorkIndex = steps.findIndex(
    (item) =>
      item.kind === step.kind &&
      item.label === step.label &&
      (item.command || '') === (step.command || '')
  );
  if (sameWorkIndex >= 0) {
    steps[sameWorkIndex] = { ...steps[sameWorkIndex], ...step };
    return steps;
  }
  const last = steps[steps.length - 1];
  if (last && last.label === step.label && last.detail === step.detail && last.status === step.status) {
    return steps;
  }
  return [...steps, step];
}
