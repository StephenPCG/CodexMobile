function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isPendingLocalMessage(message) {
  const id = String(message?.id || '');
  if (id.startsWith('local-')) {
    return true;
  }
  return message?.role === 'activity' && ['running', 'queued'].includes(String(message?.status || ''));
}

function desktopBridgeUsesExternalThreadRefresh(bridge = null) {
  return Boolean(bridge?.connected && bridge?.mode === 'desktop-ipc');
}

export function shouldPollSelectedSessionMessages({
  hasSelectedRunning = false,
  desktopBridge = null,
  hasExternalThreadRefresh = false
} = {}) {
  if (!hasSelectedRunning) {
    return true;
  }
  return desktopBridgeUsesExternalThreadRefresh(desktopBridge) && Boolean(hasExternalThreadRefresh);
}

export function mergeLiveSelectedThreadMessages(current = [], loaded = []) {
  if (!Array.isArray(loaded)) {
    return Array.isArray(current) ? current : [];
  }
  if (!Array.isArray(current) || !current.length) {
    return loaded;
  }

  const loadedUserTexts = new Set(
    loaded
      .filter((message) => message?.role === 'user')
      .map((message) => normalizeText(message.content))
      .filter(Boolean)
  );
  const hasUncaughtLocalUser = current.some((message) =>
    message?.role === 'user' &&
    isPendingLocalMessage(message) &&
    !loadedUserTexts.has(normalizeText(message.content))
  );

  if (!hasUncaughtLocalUser) {
    return loaded;
  }

  const loadedIds = new Set(loaded.map((message) => String(message?.id || '')).filter(Boolean));
  const pending = current.filter((message) => {
    if (!isPendingLocalMessage(message)) {
      return false;
    }
    if (loadedIds.has(String(message?.id || ''))) {
      return false;
    }
    if (message?.role === 'user' && loadedUserTexts.has(normalizeText(message.content))) {
      return false;
    }
    return true;
  });

  return [...loaded, ...pending].sort(
    (a, b) => new Date(a?.timestamp || 0).getTime() - new Date(b?.timestamp || 0).getTime()
  );
}

export function desktopThreadHasAssistantAfterLocalSend(current = [], loaded = []) {
  if (!Array.isArray(current) || !Array.isArray(loaded) || !current.length || !loaded.length) {
    return false;
  }
  const pendingUserTexts = new Set(
    current
      .filter((message) => message?.role === 'user' && isPendingLocalMessage(message))
      .map((message) => normalizeText(message.content))
      .filter(Boolean)
  );
  if (!pendingUserTexts.size) {
    return false;
  }
  let matchedPendingUser = false;
  for (const message of loaded) {
    if (message?.role === 'user' && pendingUserTexts.has(normalizeText(message.content))) {
      matchedPendingUser = true;
      continue;
    }
    if (matchedPendingUser && message?.role === 'assistant' && normalizeText(message.content)) {
      return true;
    }
  }
  return false;
}

export function desktopThreadHasAssistantAfterPendingSend(pending = null, loaded = []) {
  const pendingText = normalizeText(pending?.message);
  if (!pendingText || !Array.isArray(loaded) || !loaded.length) {
    return false;
  }
  let matchedPendingUser = false;
  for (const message of loaded) {
    if (message?.role === 'user' && normalizeText(message.content) === pendingText) {
      matchedPendingUser = true;
      continue;
    }
    if (matchedPendingUser && message?.role === 'assistant' && normalizeText(message.content)) {
      return true;
    }
  }
  return false;
}
