export function isThinkingActivityStep(step = null) {
  const kind = String(step?.kind || '');
  const label = String(step?.label || step?.content || '').trim();
  if (kind !== 'reasoning') {
    return false;
  }
  return /正在思考|思考中|thinking/i.test(label) || step?.status === 'running';
}

export function thinkingActivityText(step = null) {
  const label = String(step?.label || step?.content || '').trim();
  return label || '正在思考';
}
