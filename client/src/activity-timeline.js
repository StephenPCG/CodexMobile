export function isPlaceholderTimelineItem(item = null) {
  if (!item || item.type !== 'tool') {
    return false;
  }
  const label = String(item.label || '').replace(/\s+/g, ' ').trim();
  const hasDetail = Boolean(
    String(item.detail || '').trim() ||
    String(item.command || '').trim() ||
    String(item.output || '').trim() ||
    String(item.error || '').trim() ||
    (Array.isArray(item.subAgents) && item.subAgents.length)
  );
  if (hasDetail) {
    return false;
  }
  return /^(正在完成一步操作|已完成一步操作|这一步操作失败|调用工具)$/.test(label);
}
