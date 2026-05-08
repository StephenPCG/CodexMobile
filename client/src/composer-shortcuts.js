export function detectComposerToken(text, cursor = null) {
  const value = String(text || '');
  const end = Number.isInteger(cursor) ? Math.max(0, Math.min(cursor, value.length)) : value.length;
  const before = value.slice(0, end);
  const match = before.match(/(^|\s)([@$])([^\s/@$]*)$/u);
  if (!match) {
    return null;
  }
  const marker = match[2];
  const query = match[3] || '';
  const markerIndex = end - marker.length - query.length;
  return {
    type: marker === '$' ? 'skill' : 'file',
    marker,
    query,
    start: markerIndex,
    end
  };
}

export function replaceComposerToken(text, token, replacement) {
  if (!token) {
    return String(text || '');
  }
  const value = String(text || '');
  const next = `${value.slice(0, token.start)}${replacement}${value.slice(token.end)}`;
  return next.replace(/[ \t]{2,}/g, ' ');
}
