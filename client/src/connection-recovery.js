export function connectionRecoveryState({
  authenticated = true,
  connectionState = 'connected',
  desktopBridge = {},
  syncing = false
} = {}) {
  if (!authenticated) {
    return {
      state: 'pairing',
      title: '需要重新配对',
      detail: '当前设备授权失效，需要重新输入配对码。',
      primaryAction: 'pair',
      primaryLabel: '重新配对'
    };
  }

  if (connectionState === 'connecting') {
    return {
      state: 'reconnecting',
      title: '正在重连',
      detail: '正在恢复手机和本机服务的连接。',
      primaryAction: 'retry',
      primaryLabel: '重试'
    };
  }

  if (connectionState === 'disconnected') {
    return {
      state: 'disconnected',
      title: '连接已断开',
      detail: '本机服务暂时不可达，可以重试或重新配对。',
      primaryAction: 'retry',
      primaryLabel: '重试连接',
      secondaryAction: 'pair',
      secondaryLabel: '重新配对'
    };
  }

  return null;
}
