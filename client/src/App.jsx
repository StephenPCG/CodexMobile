import {
  Archive,
  ArrowDown,
  ArrowUp,
  Bell,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Folder,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequestCreateArrow,
  Hand,
  Headphones,
  Image,
  Laptop,
  Loader2,
  Menu,
  Mic,
  Minus,
  MessageSquare,
  MessageSquarePlus,
  Monitor,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Square,
  Terminal,
  Trash2,
  UploadCloud,
  Volume2,
  X
} from 'lucide-react';
import { CanvasAddon } from '@xterm/addon-canvas';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal as XTermTerminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { apiBlobFetch, apiFetch, clearToken, getToken, realtimeVoiceWebsocketUrl, setToken, websocketUrl } from './api.js';
import { isThinkingActivityStep, thinkingActivityText } from './activity-display.js';
import { removeDuplicateFinalAnswerActivity } from './activity-dedupe.js';
import { mergeActivityStep } from './activity-merge.js';
import { isPlaceholderTimelineItem } from './activity-timeline.js';
import { isNearChatBottom, shouldFollowChatOutput } from './chat-scroll.js';
import { composerSendState } from './send-state.js';
import {
  detectComposerToken,
  replaceComposerToken
} from './composer-shortcuts.js';
import { connectionRecoveryState } from './connection-recovery.js';
import {
  browserNotificationPermission,
  isStandalonePwa,
  notificationFromPayload,
  notificationPreferenceEnabled,
  setNotificationPreferenceEnabled,
  shouldUseWebNotification
} from './notification-events.js';
import {
  browserPushSupported,
  notificationEnablementMessage,
  registerWebPush
} from './web-push-client.js';
import {
  applySessionRenameToProjectSessions,
  desktopThreadHasAssistantAfterLocalSend,
  desktopThreadHasAssistantAfterPendingSend,
  mergeLiveSelectedThreadMessages,
  shouldPollSelectedSessionMessages
} from './session-live-refresh.js';
import { provisionalSessionTitle, sessionTitleFromConversation } from '../../shared/session-title.js';

const DEFAULT_STATUS = {
  connected: false,
  desktopBridge: {
    strict: true,
    connected: false,
    mode: 'unavailable',
    reason: null
  },
  environment: {
    hostName: '',
    osType: '',
    osRelease: '',
    platform: '',
    arch: '',
    nodeVersion: ''
  },
  codexCli: {
    path: '',
    source: '',
    version: '',
    error: ''
  },
  provider: 'codex',
  model: 'gpt-5.5',
  modelShort: '5.5 中',
  reasoningEffort: 'xhigh',
  models: [{ value: 'gpt-5.5', label: 'gpt-5.5' }],
  skills: [],
  docs: {
    provider: 'feishu',
    integration: 'lark-cli',
    label: '飞书文档',
    configured: false,
    connected: false,
    user: null,
    homeUrl: 'https://docs.feishu.cn/',
    cliInstalled: false,
    skillsInstalled: false,
    capabilities: [],
    codexEnabled: false,
    authorizationReady: false,
    missingScopes: [],
    scopeGroups: [],
    slidesAuthorized: false,
    sheetsAuthorized: false,
    authPending: null
  },
  context: {
    inputTokens: null,
    totalTokens: null,
    contextWindow: null,
    modelContextWindow: null,
    configuredContextWindow: null,
    maxContextWindow: null,
    percent: null,
    updatedAt: null,
    autoCompact: {
      enabled: false,
      tokenLimit: null,
      detected: false,
      status: 'unknown',
      lastCompactedAt: null,
      reason: ''
    }
  },
  voiceRealtime: { configured: false, model: 'qwen3.5-omni-plus-realtime', provider: '阿里百炼' },
  auth: { authenticated: false }
};

const DEFAULT_REASONING_EFFORT = 'xhigh';
const REASONING_DEFAULT_VERSION = 'xhigh-v1';
const RUN_MODE_KEY = 'codexmobile.runMode';
const THEME_KEY = 'codexmobile.theme';
const LANGUAGE_KEY = 'codexmobile.language';
const SELECTED_SKILLS_KEY = 'codexmobile.selectedSkills';
const VOICE_MAX_RECORDING_MS = 90 * 1000;
const VOICE_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const VOICE_MIME_CANDIDATES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
const VOICE_DIALOG_SILENCE_MS = 900;
const VOICE_DIALOG_MIN_RECORDING_MS = 600;
const VOICE_DIALOG_LEVEL_THRESHOLD = 0.018;
const VOICE_DIALOG_SILENCE_AUDIO =
  'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA==';
const MARKDOWN_PLUGINS = [remarkGfm];
const REALTIME_VOICE_SAMPLE_RATE = 24000;
const REALTIME_VOICE_BUFFER_SIZE = 2048;
const REALTIME_VOICE_MIN_TURN_MS = 500;
const REALTIME_VOICE_BARGE_IN_LEVEL_THRESHOLD = 0.026;
const REALTIME_VOICE_BARGE_IN_SUSTAIN_MS = 180;
const STALE_ACTIVITY_STATUS_MS = 2 * 60 * 60 * 1000;

const LOCALE_OPTIONS = ['system', 'zh', 'en'];
const THEME_OPTIONS = ['system', 'light', 'dark'];

const TRANSLATIONS = {
  zh: {
    'common.system': '跟随系统',
    'common.close': '关闭',
    'common.back': '返回',
    'common.cancel': '取消',
    'common.save': '保存',
    'common.archive': '归档',
    'common.processing': '处理中...',
    'common.loading': '加载中',
    'common.refresh': '刷新',
    'common.retry': '重试',
    'common.copy': '复制',
    'common.copied': '已复制',
    'common.delete': '删除',
    'common.unknown': '未知',
    'common.unavailable': '不可用',
    'common.bundledDependency': '内置依赖',
    'common.backgroundLocalCodex': '后台本机 Codex',
    'common.standaloneAppServer': '独立 app-server',
    'common.connected': '已连接',
    'common.connecting': '连接中',
    'common.disconnected': '未连接',
    'common.backgroundCodex': '后台 Codex',
    'common.failed': '失败',
    'common.running': '运行中',
    'common.success': '成功',
    'pairing.lead': '我的本机 Codex 移动工作台。电脑继续执行，iPhone 随时接管、追问、看过程、处理确认和收完成通知。',
    'pairing.capabilities': 'CodexMobile 核心能力',
    'pairing.sync': '桌面对话同步',
    'pairing.process': '完整执行过程',
    'pairing.private': '私有网络访问',
    'pairing.note': '输入电脑端启动日志里的 6 位配对码。',
    'pairing.placeholder': '6 位配对码',
    'pairing.connect': '连接',
    'settings.title': '设置',
    'settings.appearance': '外观',
    'settings.language': '语言',
    'settings.theme': '主题',
    'settings.zh': '中文',
    'settings.en': 'English',
    'settings.light': '浅色',
    'settings.dark': '深色',
    'settings.integrations': '集成',
    'settings.environment': '环境信息',
    'settings.host': '主机',
    'settings.system': '系统',
    'settings.codexConnection': '连接方式',
    'drawer.connectedWithTasks': '已连接 · {count} 个任务运行中',
    'drawer.searchPlaceholder': '搜索对话...',
    'drawer.categories': '对话分类',
    'drawer.conversation': '对话',
    'drawer.newConversation': '新对话',
    'drawer.pending': '待发送',
    'drawer.noConversations': '暂无对话',
    'drawer.renameConversation': '重命名对话',
    'drawer.archiveConversation': '归档对话',
    'drawer.expandSubagents': '展开子代理对话',
    'drawer.collapseSubagents': '折叠子代理对话',
    'drawer.subagents': '子代理',
    'drawer.running': '运行中',
    'drawer.processing': '正在处理',
    'drawer.hasNewResult': '有新完成结果',
    'quota.title': '剩余额度',
    'quota.staleRetry': '{message}，点击刷新',
    'quota.staleResult': '实时查询失败，显示最近一次成功结果',
    'quota.accountRetry': '{message}，点击刷新重试',
    'quota.failed': '查询失败',
    'quota.disabled': '已停用',
    'quota.loading': '正在读取额度...',
    'quota.empty': '暂无 Codex 凭证',
    'quota.refresh': '刷新额度',
    'quota.notUpdated': '暂未更新',
    'quota.updatedAt': '更新于 {time}',
    'quota.unknownUpdate': '更新时间未知',
    'quota.fiveHour': '5h limit',
    'quota.weekly': 'Weekly limit',
    'quota.sparkFiveHour': 'Codex Spark 5h',
    'quota.sparkWeekly': 'Codex Spark weekly',
    'quota.expand': '展开额度',
    'quota.collapse': '收起额度',
    'top.openMenu': '打开菜单',
    'top.more': '更多操作',
    'top.changes': '变更',
    'top.directories': '目录',
    'top.terminal': '终端',
    'top.rename': '修改对话标题',
    'top.archive': '归档对话',
    'top.copyThreadId': '复制对话 ID',
    'top.copiedThreadId': '已复制对话 ID',
    'top.gitPanel': 'Git 面板',
    'top.enableNotifications': '开启完成通知',
    'top.notificationsEnabled': '完成通知已开启',
    'top.noProject': '未选择项目',
    'modal.titleRequired': '标题不能为空',
    'modal.operationFailed': '操作失败',
    'modal.title': '标题',
    'modal.archiveConfirm': '归档“{title}”后会从列表中移除，并同步到可用的 Codex 后端。',
    'modal.renameFailed': '重命名失败：{message}',
    'modal.archiveRunning': '对话正在运行，稍后再归档。',
    'modal.archiveFailed': '归档失败：{message}',
    'welcome.body': '选择一个项目开始新对话，或从左侧菜单打开历史对话。',
    'welcome.projects': '项目',
    'welcome.empty': '还没有可用项目',
    'docs.title': '飞书文档',
    'docs.close': '关闭文档',
    'docs.pendingScope': '待补权限',
    'docs.waitingAuth': '等待授权',
    'docs.notConnected': '未连接',
    'docs.notConfigured': '未配置',
    'docs.authOpened': '授权页已打开，完成后回到这里刷新状态。',
    'docs.extraAuthSummary': '飞书账号已连接，但部分文档权限还没授权。补充授权后，Codex 可完整操作飞书文档、PPT、表格和云空间文件。',
    'docs.readySummary': 'Codex 已可操作飞书文档、PPT、表格和云空间文件。',
    'docs.noCli': '本机还没有检测到 lark-cli。',
    'docs.noSkills': '官方文档技能还没有安装完整。',
    'docs.connectSummary': '连接飞书账号后，Codex 才能以你的身份操作文档、PPT 和表格。',
    'docs.configSummary': '请先在后端配置飞书 App ID 和 Secret。',
    'docs.usage': '配置并授权后，在消息中提到飞书文档、PPT、表格或云空间时，Codex 会使用 lark-cli 来创建、读取和更新对应内容。',
    'docs.authCode': '授权码 {code}',
    'docs.generated': '已生成',
    'docs.openAuth': '打开授权页',
    'docs.missingScopes': '缺少 {scopes}',
    'docs.scopeSeparator': '、',
    'docs.addAuth': '补充授权',
    'docs.openFeishu': '打开飞书',
    'docs.disconnect': '断开',
    'docs.connect': '连接飞书',
    'docs.officialSkills': '官方技能',
    'docs.appCredentials': 'App 凭证',
    'docs.userAuth': '用户授权',
    'docs.slidesScope': 'PPT 权限',
    'docs.sheetsScope': '表格权限',
    'git.title': 'Git 面板',
    'git.diff': 'Git Diff',
    'git.sync': 'Git 同步',
    'git.commitPush': '提交并推送',
    'git.commit': 'Git 提交',
    'git.push': 'Git 推送',
    'git.branch': '创建分支',
    'git.refreshStatus': '刷新状态',
    'git.files': '{count} 个文件',
    'git.moreFiles': '还有 {count} 个文件',
    'git.diffPreview': 'Diff 预览',
    'git.readingDiff': '正在读取 diff...',
    'git.noDiff': '暂无 diff',
    'git.diffTruncated': 'diff 太长，已截断显示。',
    'git.syncHint': 'pull 使用 --ff-only，sync 会 pull 后按需 push',
    'git.commitMessage': '提交信息',
    'git.branchName': '分支名',
    'git.committed': '已提交 {hash}',
    'git.updated': '已更新 {branch}',
    'git.completed': 'Git 操作已完成',
    'git.running': '正在执行 Git 操作...',
    'git.failed': 'Git 操作失败',
    'git.statusReadFailed': '读取 Git 状态失败',
    'git.diffReadFailed': '读取 Git diff 失败',
    'git.clean': '工作区干净',
    'git.currentChanges': '当前改动',
    'git.notRead': '未读取',
    'git.tabs': 'Git 操作',
    'git.status': '状态',
    'git.syncOperation': '同步操作',
    'git.warningFiles': '工作区有 {count} 个改动文件',
    'git.warningBehind': '落后远端 {count} 个提交，pull/sync 会先尝试快进',
    'git.warningBranch': '当前不是 codex/ 分支，操作前请确认分支用途',
    'git.warningNoUpstream': '当前分支没有 upstream，push 会设置 origin upstream',
    'git.warningDirtyBehind': '本地有改动且落后远端，pull 可能失败并保留 Git 原始输出',
    'workspace.title': '文件',
    'workspace.preview': '文件预览',
    'workspace.filesAndChanges': '文件和变更',
    'workspace.search': '搜索文件',
    'workspace.searchFailed': '搜索失败',
    'workspace.detached': 'detached',
    'workspace.stagedSummary': '{staged} staged, {unstaged} unstaged',
    'workspace.searching': '正在搜索文件...',
    'workspace.noSearchResults': '没有匹配的文件。',
    'workspace.readingChanges': '正在读取变更...',
    'workspace.readChangesFailed': '读取变更失败',
    'workspace.stagedChanges': '已暂存变更 ({count})',
    'workspace.unstagedChanges': '未暂存变更 ({count})',
    'workspace.noChanges': '没有检测到变更。可切到目录浏览文件。',
    'workspace.readDirectory': '正在读取目录...',
    'workspace.readDirectoryFailed': '读取目录失败',
    'workspace.emptyDirectory': '空目录',
    'workspace.noChangesDisplay': '没有可显示的变更。',
    'workspace.readFile': '正在读取文件...',
    'workspace.readFileFailed': '读取文件失败',
    'workspace.binaryFile': '这个文件看起来是二进制文件，无法预览。',
    'workspace.emptyFile': '文件为空。',
    'workspace.fileTruncated': '文件较大，仅显示前 {size}。',
    'workspace.copyPath': '复制路径',
    'workspace.copyContentSuccess': '已复制文件内容',
    'terminal.title': '终端',
    'terminal.close': '关闭终端',
    'terminal.connectFailed': '终端连接失败',
    'terminal.wsDisconnected': 'WebSocket 未连接',
    'terminal.waitingWs': '等待 CodexMobile WebSocket...',
    'terminal.exited': '[terminal exited]',
    'terminal.paste': '粘贴',
    'activity.failed': '处理失败',
    'activity.processing': '处理中',
    'activity.processed': '已处理',
    'activity.progress': '任务进度',
    'activity.localFailed': '本地任务失败',
    'activity.localRunning': '正在处理本地任务',
    'activity.localDone': '本地任务已处理',
    'activity.exitCode': '退出码 {code}',
    'activity.subagentDefault': '{count} 个后台智能体（使用 @ 标记智能体）',
    'activity.subagent': '子代理',
    'activity.open': '打开',
    'activity.filesChanged': '{count} 个文件已更改',
    'activity.thinking': '正在思考中',
    'activity.sendFailed': '发送失败',
    'subagent.worker': '执行',
    'subagent.explorer': '探索',
    'message.actions': '消息操作',
    'message.copyFailed': '复制失败',
    'message.backToLatest': '回到最新消息',
    'message.deleteConfirm': '删除这条消息？',
    'message.deleteFailed': '删除失败：{message}',
    'message.copyCode': '复制代码',
    'image.preview': '预览图片',
    'image.loadFailed': '图片加载失败',
    'image.retry': '重试',
    'image.reload': '重新加载',
    'image.generated': '生成图片',
    'image.zoomOut': '缩小图片',
    'image.zoomIn': '放大图片',
    'image.resetZoom': '重置图片缩放',
    'image.attachments': '图片附件',
    'chat.emptyTitle': '新对话',
    'chat.emptyBody': '问 Codex 任何事。',
    'voice.title': '语音对话',
    'voice.close': '关闭语音对话',
    'voice.taskLabel': '交给 Codex 的任务',
    'voice.continue': '继续补充',
    'voice.submit': '交给 Codex',
    'voice.stop': '停止',
    'voice.start': '开始',
    'voice.end': '结束',
    'voice.stopTranscribe': '停止语音转录',
    'voice.processing': '正在处理语音',
    'voice.transcribe': '语音转录',
    'voice.statusIdle': '准备对话',
    'voice.statusListening': '正在听',
    'voice.statusTranscribing': '正在转写',
    'voice.statusSending': '正在发送',
    'voice.statusWaiting': '等待回复',
    'voice.statusSpeaking': '正在朗读',
    'voice.statusSummarizing': '正在整理任务',
    'voice.statusHandoff': '确认交给 Codex',
    'voice.statusError': '对话出错',
    'context.title': '背景信息窗口：',
    'context.used': '{used}% 已用（剩余 {remaining}%）',
    'context.syncing': '正在同步背景信息窗口',
    'context.tokens': '已用 {input} 标记，共 {total}',
    'context.compacted': 'Codex 已自动压缩背景信息',
    'context.autoCompact': 'Codex 自动压缩其背景信息',
    'context.view': '查看背景信息窗口',
    'connection.recovery': '连接恢复',
    'composer.online': '在线',
    'composer.connecting': '连接中',
    'composer.offline': '离线',
    'composer.album': '相册',
    'composer.file': '文件',
    'composer.startIn': '启动位置',
    'composer.model': '模型',
    'composer.reasoning': '思考深度',
    'composer.searchSkill': '搜索技能',
    'composer.noSkill': '不指定技能',
    'composer.noSkillMatch': '没有匹配的技能',
    'composer.skillsNotLoaded': '技能列表还没加载',
    'composer.searchingFiles': '正在搜索文件',
    'composer.noFileMatch': '没有匹配的文件',
    'composer.selectedSkillCount': '{count} 个技能',
    'composer.skillGeneric': '技能',
    'composer.removeSkill': '移除技能',
    'composer.queue': '排队消息',
    'composer.checkAttachments': '请查看附件。',
    'composer.checkFileReferences': '请查看引用文件。',
    'composer.queued': '排队中',
    'composer.sendNow': '立即发送到当前任务',
    'composer.deleteQueued': '删除排队消息',
    'composer.codexProcessing': 'Codex 正在处理',
    'composer.desktopDisconnected': '桌面端 Codex 未连接',
    'composer.desktopDisconnectedHint': '打开桌面端 Codex，或配置同源 app-server control socket 后再发送',
    'composer.createUnavailable': '只能继续桌面端已有对话',
    'composer.createUnavailableHint': '当前桌面端还没有开放从手机新建同源对话的入口',
    'composer.steer': '发送到当前任务',
    'composer.steerHint': '直接补充给桌面端正在执行的任务',
    'composer.steerUnavailable': '当前任务暂时不能接收补充消息',
    'composer.queueMessage': '加入队列',
    'composer.queueHint': '当前任务结束后自动发送',
    'composer.interrupt': '中止并发送',
    'composer.interruptHint': '停下当前任务，用这条消息重新引导',
    'composer.removeAttachment': '移除附件',
    'composer.removeFileMention': '移除文件引用',
    'composer.placeholder': '给 Codex 发送消息',
    'composer.addAttachment': '添加附件',
    'composer.permissionMode': '权限模式：{mode}',
    'composer.runMode': '启动模式：{mode}',
    'composer.modelMode': '模型：{model}，思考深度：{reasoning}',
    'permissions.default': '默认权限',
    'permissions.acceptEdits': '自动审核',
    'permissions.bypassPermissions': '完全访问',
    'run.local': '本地工作',
    'run.newWorktree': '新建 Worktree',
    'run.localShort': '本地',
    'run.newWorktreeShort': 'Worktree',
    'reasoning.low': 'Low',
    'reasoning.medium': 'Medium',
    'reasoning.high': 'High',
    'reasoning.xhigh': 'Extra High',
    'toast.syncDone': '同步完成',
    'toast.syncDoneBody': '对话和状态已经刷新。',
    'toast.syncFailed': '同步失败',
    'toast.syncFailedBody': '无法刷新同步。',
    'toast.connectionRefreshed': '连接已刷新',
    'toast.connectionRefreshedBody': '已重新读取本机服务状态。',
    'toast.connectionFailed': '连接失败',
    'toast.connectionFailedBody': '本机服务暂时不可达。',
    'toast.statusRead': 'CodexMobile 状态已读取。',
    'toast.selectProject': '请先选择项目',
    'toast.voiceFailed': '语音转录失败',
    'toast.voiceRecordFailed': '录音失败',
    'toast.voiceNoText': '没有识别到文字',
    'voice.noContent': '还没有可整理的语音内容',
    'voice.realtimeUnavailable': '实时语音连接不可用',
    'voice.httpsRequired': '请使用 HTTPS 地址',
    'voice.recordUnsupported': '当前浏览器不支持录音',
    'voice.realtimeUnsupported': '当前浏览器不支持实时音频',
    'voice.realtimeStartFailed': '实时语音启动失败',
    'voice.noHandoffTask': '没有整理出可交给 Codex 的任务',
    'voice.invalidJson': '整理结果不是标准 JSON，已作为草稿保留',
    'voice.summarizeFailed': '语音任务整理失败',
    'voice.realtimeFailed': '实时语音连接失败',
    'voice.realtimeNotConfigured': '未配置实时语音',
    'voice.noAudio': '没有录到声音',
    'voice.tooLarge': '录音超过 10MB',
    'voice.playFailed': '播放失败',
    'voice.speechUnsupported': '当前浏览器不支持朗读',
    'voice.speechFailed': '朗读失败',
    'voice.dialogFailed': '语音对话失败',
    'voice.microphoneDenied': '麦克风权限被拒绝',
    'voice.recordStartFailed': '录音启动失败',
    'voice.sendFailed': '发送给 Codex 失败',
    'docs.noAuthUrl': '没有收到飞书授权地址',
    'docs.connectFailed': '飞书连接失败',
    'docs.disconnectFailed': '断开飞书失败',
    'docs.refreshFailed': '刷新飞书状态失败',
    'toast.notificationUnavailable': '通知不可用',
    'toast.notificationsEnabled': '完成通知已开启',
    'toast.notificationDenied': '未开启通知',
    'toast.notificationFailed': '通知开启失败',
    'toast.notificationFailedBody': '无法请求 Web Push 通知权限。',
    'toast.notice': '提醒',
    'toast.taskFailed': '任务失败',
    'toast.aborted': '已中止'
  },
  en: {
    'common.system': 'Follow System',
    'common.close': 'Close',
    'common.back': 'Back',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.archive': 'Archive',
    'common.processing': 'Processing...',
    'common.loading': 'Loading',
    'common.refresh': 'Refresh',
    'common.retry': 'Retry',
    'common.copy': 'Copy',
    'common.copied': 'Copied',
    'common.delete': 'Delete',
    'common.unknown': 'Unknown',
    'common.unavailable': 'Unavailable',
    'common.bundledDependency': 'Bundled dependency',
    'common.backgroundLocalCodex': 'Background Local Codex',
    'common.standaloneAppServer': 'Standalone app-server',
    'common.connected': 'Connected',
    'common.connecting': 'Connecting',
    'common.disconnected': 'Disconnected',
    'common.backgroundCodex': 'Background Codex',
    'common.failed': 'Failed',
    'common.running': 'Running',
    'common.success': 'Success',
    'pairing.lead': 'A mobile workbench for your local Codex. Let the computer keep working while your iPhone can follow up, review progress, approve actions, and receive completion updates.',
    'pairing.capabilities': 'CodexMobile capabilities',
    'pairing.sync': 'Desktop thread sync',
    'pairing.process': 'Full activity stream',
    'pairing.private': 'Private network access',
    'pairing.note': 'Enter the 6-digit pairing code from the desktop startup log.',
    'pairing.placeholder': '6-digit pairing code',
    'pairing.connect': 'Connect',
    'settings.title': 'Settings',
    'settings.appearance': 'Appearance',
    'settings.language': 'Language',
    'settings.theme': 'Theme',
    'settings.zh': '中文',
    'settings.en': 'English',
    'settings.light': 'Light',
    'settings.dark': 'Dark',
    'settings.integrations': 'Integrations',
    'settings.environment': 'Environment',
    'settings.host': 'Host',
    'settings.system': 'System',
    'settings.codexConnection': 'Codex connection',
    'drawer.connectedWithTasks': 'Connected · {count} running tasks',
    'drawer.searchPlaceholder': 'Search conversations...',
    'drawer.categories': 'Conversation Groups',
    'drawer.conversation': 'Conversation',
    'drawer.newConversation': 'New Conversation',
    'drawer.pending': 'Pending',
    'drawer.noConversations': 'No conversations',
    'drawer.renameConversation': 'Rename Conversation',
    'drawer.archiveConversation': 'Archive Conversation',
    'drawer.expandSubagents': 'Expand subagent conversations',
    'drawer.collapseSubagents': 'Collapse subagent conversations',
    'drawer.subagents': 'subagents',
    'drawer.running': 'Running',
    'drawer.processing': 'Processing',
    'drawer.hasNewResult': 'New completed result',
    'quota.title': 'Rate limits remaining',
    'quota.staleRetry': '{message}, click to refresh',
    'quota.staleResult': 'Live query failed; showing the last successful result',
    'quota.accountRetry': '{message}, click to refresh',
    'quota.failed': 'Query failed',
    'quota.disabled': 'Disabled',
    'quota.loading': 'Reading rate limits...',
    'quota.empty': 'No Codex credentials',
    'quota.refresh': 'Refresh rate limits',
    'quota.notUpdated': 'Not updated yet',
    'quota.updatedAt': 'Updated {time}',
    'quota.unknownUpdate': 'Update time unknown',
    'quota.fiveHour': '5h limit',
    'quota.weekly': 'Weekly limit',
    'quota.sparkFiveHour': 'Codex Spark 5h',
    'quota.sparkWeekly': 'Codex Spark weekly',
    'quota.expand': 'Expand rate limits',
    'quota.collapse': 'Collapse rate limits',
    'top.openMenu': 'Open menu',
    'top.more': 'More Actions',
    'top.changes': 'Changes',
    'top.directories': 'Directories',
    'top.terminal': 'Terminal',
    'top.rename': 'Rename Conversation',
    'top.archive': 'Archive Conversation',
    'top.copyThreadId': 'Copy Conversation ID',
    'top.copiedThreadId': 'Conversation ID Copied',
    'top.gitPanel': 'Git Panel',
    'top.enableNotifications': 'Enable Completion Notifications',
    'top.notificationsEnabled': 'Completion Notifications Enabled',
    'top.noProject': 'No Project Selected',
    'modal.titleRequired': 'Title is required',
    'modal.operationFailed': 'Operation failed',
    'modal.title': 'Title',
    'modal.archiveConfirm': 'After archiving "{title}", it will be removed from the list and synced to any available Codex backend.',
    'modal.renameFailed': 'Rename failed: {message}',
    'modal.archiveRunning': 'This conversation is still running. Archive it later.',
    'modal.archiveFailed': 'Archive failed: {message}',
    'welcome.body': 'Select a project to start a new conversation, or open an existing conversation from the side menu.',
    'welcome.projects': 'Projects',
    'welcome.empty': 'No projects available',
    'docs.title': 'Feishu Docs',
    'docs.close': 'Close Docs',
    'docs.pendingScope': 'Needs scopes',
    'docs.waitingAuth': 'Waiting for authorization',
    'docs.notConnected': 'Not connected',
    'docs.notConfigured': 'Not configured',
    'docs.authOpened': 'The authorization page is open. Finish there, then refresh the status here.',
    'docs.extraAuthSummary': 'Your Feishu account is connected, but some document scopes are still missing. After granting them, Codex can fully work with Feishu Docs, Slides, Sheets, and Drive files.',
    'docs.readySummary': 'Codex can now work with Feishu Docs, Slides, Sheets, and Drive files.',
    'docs.noCli': 'lark-cli was not detected on this host.',
    'docs.noSkills': 'The official document skills are not fully installed.',
    'docs.connectSummary': 'Connect your Feishu account so Codex can work with Docs, Slides, and Sheets as you.',
    'docs.configSummary': 'Configure the Feishu App ID and Secret on the server first.',
    'docs.usage': 'After setup and authorization, mention Feishu Docs, Slides, Sheets, or Drive files in a message and Codex will use lark-cli to create, read, and update them.',
    'docs.authCode': 'Authorization code {code}',
    'docs.generated': 'Generated',
    'docs.openAuth': 'Open Authorization Page',
    'docs.missingScopes': 'Missing {scopes}',
    'docs.scopeSeparator': ', ',
    'docs.addAuth': 'Grant More Access',
    'docs.openFeishu': 'Open Feishu',
    'docs.disconnect': 'Disconnect',
    'docs.connect': 'Connect Feishu',
    'docs.officialSkills': 'Official skills',
    'docs.appCredentials': 'App credentials',
    'docs.userAuth': 'User authorization',
    'docs.slidesScope': 'Slides scope',
    'docs.sheetsScope': 'Sheets scope',
    'git.title': 'Git Panel',
    'git.diff': 'Git Diff',
    'git.sync': 'Git Sync',
    'git.commitPush': 'Commit and Push',
    'git.commit': 'Git Commit',
    'git.push': 'Git Push',
    'git.branch': 'Create Branch',
    'git.refreshStatus': 'Refresh Status',
    'git.files': '{count} files',
    'git.moreFiles': '{count} more files',
    'git.diffPreview': 'Diff Preview',
    'git.readingDiff': 'Reading diff...',
    'git.noDiff': 'No diff',
    'git.diffTruncated': 'Diff is too long and was truncated.',
    'git.syncHint': 'pull uses --ff-only; sync pulls and pushes when needed',
    'git.commitMessage': 'Commit Message',
    'git.branchName': 'Branch Name',
    'git.committed': 'Committed {hash}',
    'git.updated': 'Updated {branch}',
    'git.completed': 'Git operation completed',
    'git.running': 'Running Git operation...',
    'git.failed': 'Git operation failed',
    'git.statusReadFailed': 'Failed to read Git status',
    'git.diffReadFailed': 'Failed to read Git diff',
    'git.clean': 'Working tree clean',
    'git.currentChanges': 'Current changes',
    'git.notRead': 'Not read',
    'git.tabs': 'Git Actions',
    'git.status': 'Status',
    'git.syncOperation': 'Sync Operation',
    'git.warningFiles': '{count} changed files in the working tree',
    'git.warningBehind': '{count} commits behind remote; pull/sync will try a fast-forward first',
    'git.warningBranch': 'Current branch is not a codex/ branch; confirm its purpose before operating',
    'git.warningNoUpstream': 'Current branch has no upstream; push will set origin upstream',
    'git.warningDirtyBehind': 'Local changes plus remote commits may make pull fail and preserve raw Git output',
    'workspace.title': 'Files',
    'workspace.preview': 'File Preview',
    'workspace.filesAndChanges': 'Files and Changes',
    'workspace.search': 'Search files',
    'workspace.searchFailed': 'Search failed',
    'workspace.detached': 'detached',
    'workspace.stagedSummary': '{staged} staged, {unstaged} unstaged',
    'workspace.searching': 'Searching files...',
    'workspace.noSearchResults': 'No matching files.',
    'workspace.readingChanges': 'Reading changes...',
    'workspace.readChangesFailed': 'Failed to read changes',
    'workspace.stagedChanges': 'Staged Changes ({count})',
    'workspace.unstagedChanges': 'Unstaged Changes ({count})',
    'workspace.noChanges': 'No changes detected. Use Directories to browse files.',
    'workspace.readDirectory': 'Reading directory...',
    'workspace.readDirectoryFailed': 'Failed to read directory',
    'workspace.emptyDirectory': 'Empty directory',
    'workspace.noChangesDisplay': 'No changes to display.',
    'workspace.readFile': 'Reading file...',
    'workspace.readFileFailed': 'Failed to read file',
    'workspace.binaryFile': 'This looks like a binary file and cannot be previewed.',
    'workspace.emptyFile': 'File is empty.',
    'workspace.fileTruncated': 'Large file. Showing the first {size}.',
    'workspace.copyPath': 'Copy Path',
    'workspace.copyContentSuccess': 'File content copied',
    'terminal.title': 'Terminal',
    'terminal.close': 'Close Terminal',
    'terminal.connectFailed': 'Terminal connection failed',
    'terminal.wsDisconnected': 'WebSocket disconnected',
    'terminal.waitingWs': 'Waiting for CodexMobile WebSocket...',
    'terminal.exited': '[terminal exited]',
    'terminal.paste': 'Paste',
    'activity.failed': 'Failed',
    'activity.processing': 'Processing',
    'activity.processed': 'Processed',
    'activity.progress': 'Task progress',
    'activity.localFailed': 'Local task failed',
    'activity.localRunning': 'Processing local task',
    'activity.localDone': 'Local task completed',
    'activity.exitCode': 'Exit code {code}',
    'activity.subagentDefault': '{count} background agents (marked with @)',
    'activity.subagent': 'subagent',
    'activity.open': 'Open',
    'activity.filesChanged': '{count} files changed',
    'activity.thinking': 'Thinking',
    'activity.sendFailed': 'Send failed',
    'subagent.worker': 'Worker',
    'subagent.explorer': 'Explorer',
    'message.actions': 'Message Actions',
    'message.copyFailed': 'Copy failed',
    'message.backToLatest': 'Back to latest message',
    'message.deleteConfirm': 'Delete this message?',
    'message.deleteFailed': 'Delete failed: {message}',
    'message.copyCode': 'Copy code',
    'image.preview': 'Preview image',
    'image.loadFailed': 'Image failed to load',
    'image.retry': 'Retry',
    'image.reload': 'Reload',
    'image.generated': 'Generated image',
    'image.zoomOut': 'Zoom out',
    'image.zoomIn': 'Zoom in',
    'image.resetZoom': 'Reset image zoom',
    'image.attachments': 'Image attachments',
    'chat.emptyTitle': 'New Conversation',
    'chat.emptyBody': 'Ask Codex anything.',
    'voice.title': 'Voice Chat',
    'voice.close': 'Close Voice Chat',
    'voice.taskLabel': 'Task for Codex',
    'voice.continue': 'Keep Adding',
    'voice.submit': 'Send to Codex',
    'voice.stop': 'Stop',
    'voice.start': 'Start',
    'voice.end': 'End',
    'voice.stopTranscribe': 'Stop voice transcription',
    'voice.processing': 'Processing voice',
    'voice.transcribe': 'Voice transcription',
    'voice.statusIdle': 'Ready',
    'voice.statusListening': 'Listening',
    'voice.statusTranscribing': 'Transcribing',
    'voice.statusSending': 'Sending',
    'voice.statusWaiting': 'Waiting for reply',
    'voice.statusSpeaking': 'Speaking',
    'voice.statusSummarizing': 'Summarizing task',
    'voice.statusHandoff': 'Confirm send to Codex',
    'voice.statusError': 'Voice error',
    'context.title': 'Context window:',
    'context.used': '{used}% used ({remaining}% remaining)',
    'context.syncing': 'Syncing context window',
    'context.tokens': '{input} tokens used of {total}',
    'context.compacted': 'Codex already auto-compacted its context',
    'context.autoCompact': 'Codex will auto-compact its context',
    'context.view': 'View context window',
    'connection.recovery': 'Connection Recovery',
    'composer.online': 'online',
    'composer.connecting': 'connecting',
    'composer.offline': 'offline',
    'composer.album': 'Photos',
    'composer.file': 'Files',
    'composer.startIn': 'Start in',
    'composer.model': 'Model',
    'composer.reasoning': 'Reasoning',
    'composer.searchSkill': 'Search skills',
    'composer.noSkill': 'No skill',
    'composer.noSkillMatch': 'No matching skills',
    'composer.skillsNotLoaded': 'Skills have not loaded',
    'composer.searchingFiles': 'Searching files',
    'composer.noFileMatch': 'No matching files',
    'composer.selectedSkillCount': '{count} skills',
    'composer.skillGeneric': 'Skill',
    'composer.removeSkill': 'Remove skill',
    'composer.queue': 'Queued Messages',
    'composer.checkAttachments': 'Please review the attachments.',
    'composer.checkFileReferences': 'Please review the referenced files.',
    'composer.queued': 'Queued',
    'composer.sendNow': 'Send to current task now',
    'composer.deleteQueued': 'Delete queued message',
    'composer.codexProcessing': 'Codex is working',
    'composer.desktopDisconnected': 'Desktop Codex disconnected',
    'composer.desktopDisconnectedHint': 'Open Codex Desktop, or configure the same-origin app-server control socket before sending',
    'composer.createUnavailable': 'Can only continue existing desktop conversations',
    'composer.createUnavailableHint': 'The current desktop backend does not expose a same-origin conversation creation entrypoint yet',
    'composer.steer': 'Send to Current Task',
    'composer.steerHint': 'Add this directly to the task currently running on desktop',
    'composer.steerUnavailable': 'The current task cannot receive additions right now',
    'composer.queueMessage': 'Add to Queue',
    'composer.queueHint': 'Send automatically after the current task finishes',
    'composer.interrupt': 'Stop and Send',
    'composer.interruptHint': 'Stop the current task and steer with this message',
    'composer.removeAttachment': 'Remove attachment',
    'composer.removeFileMention': 'Remove file reference',
    'composer.placeholder': 'Message Codex',
    'composer.addAttachment': 'Add attachment',
    'composer.permissionMode': 'Permission mode: {mode}',
    'composer.runMode': 'Run mode: {mode}',
    'composer.modelMode': 'Model: {model}, reasoning: {reasoning}',
    'permissions.default': 'Default permissions',
    'permissions.acceptEdits': 'Auto-review',
    'permissions.bypassPermissions': 'Full access',
    'run.local': 'Work locally',
    'run.newWorktree': 'New worktree',
    'run.localShort': 'Local',
    'run.newWorktreeShort': 'Worktree',
    'reasoning.low': 'Low',
    'reasoning.medium': 'Medium',
    'reasoning.high': 'High',
    'reasoning.xhigh': 'Extra High',
    'toast.syncDone': 'Sync complete',
    'toast.syncDoneBody': 'Conversations and status have been refreshed.',
    'toast.syncFailed': 'Sync failed',
    'toast.syncFailedBody': 'Unable to refresh sync.',
    'toast.connectionRefreshed': 'Connection refreshed',
    'toast.connectionRefreshedBody': 'Local service status has been reloaded.',
    'toast.connectionFailed': 'Connection failed',
    'toast.connectionFailedBody': 'The local service is temporarily unavailable.',
    'toast.statusRead': 'CodexMobile status was read.',
    'toast.selectProject': 'Select a project first',
    'toast.voiceFailed': 'Voice transcription failed',
    'toast.voiceRecordFailed': 'Recording failed',
    'toast.voiceNoText': 'No text recognized',
    'voice.noContent': 'No voice content to organize yet',
    'voice.realtimeUnavailable': 'Realtime voice connection is unavailable',
    'voice.httpsRequired': 'Use an HTTPS URL',
    'voice.recordUnsupported': 'This browser does not support recording',
    'voice.realtimeUnsupported': 'This browser does not support realtime audio',
    'voice.realtimeStartFailed': 'Failed to start realtime voice',
    'voice.noHandoffTask': 'No task was organized for Codex',
    'voice.invalidJson': 'The organized result was not valid JSON and was kept as a draft',
    'voice.summarizeFailed': 'Failed to organize the voice task',
    'voice.realtimeFailed': 'Realtime voice connection failed',
    'voice.realtimeNotConfigured': 'Realtime voice is not configured',
    'voice.noAudio': 'No audio was recorded',
    'voice.tooLarge': 'Recording exceeds 10 MB',
    'voice.playFailed': 'Playback failed',
    'voice.speechUnsupported': 'This browser does not support speech playback',
    'voice.speechFailed': 'Speech playback failed',
    'voice.dialogFailed': 'Voice chat failed',
    'voice.microphoneDenied': 'Microphone permission was denied',
    'voice.recordStartFailed': 'Failed to start recording',
    'voice.sendFailed': 'Failed to send to Codex',
    'docs.noAuthUrl': 'No Feishu authorization URL received',
    'docs.connectFailed': 'Failed to connect Feishu',
    'docs.disconnectFailed': 'Failed to disconnect Feishu',
    'docs.refreshFailed': 'Failed to refresh Feishu status',
    'toast.notificationUnavailable': 'Notifications unavailable',
    'toast.notificationsEnabled': 'Completion notifications enabled',
    'toast.notificationDenied': 'Notifications not enabled',
    'toast.notificationFailed': 'Failed to enable notifications',
    'toast.notificationFailedBody': 'Unable to request Web Push notification permission.',
    'toast.notice': 'Notice',
    'toast.taskFailed': 'Task failed',
    'toast.aborted': 'Aborted'
  }
};

const UI_TEXT_PAIRS = [
  ['已连接', 'Connected'],
  ['连接中', 'Connecting'],
  ['已断开', 'Disconnected'],
  ['后台 Codex', 'Background Codex'],
  ['后台本机 Codex', 'Background Local Codex'],
  ['独立 app-server', 'Standalone app-server'],
  ['内置依赖', 'Bundled dependency'],
  ['不可用', 'Unavailable'],
  ['未知', 'Unknown'],
  ['新对话', 'New Conversation'],
  ['对话', 'Conversation'],
  ['正在上传', 'Uploading'],
  ['桌面端 Codex 未连接', 'Desktop Codex disconnected'],
  ['中止当前任务', 'Stop current task'],
  ['发送到当前任务', 'Send to current task'],
  ['选择发送方式', 'Choose send mode'],
  ['发送消息', 'Send message'],
  ['提醒', 'Notice'],
  ['任务失败', 'Task failed'],
  ['已中止', 'Aborted'],
  ['任务已完成', 'Task completed'],
  ['发送失败', 'Send failed'],
  ['正在思考中', 'Thinking'],
  ['正在思考', 'Thinking'],
  ['正在处理', 'Processing'],
  ['已处理', 'Processed'],
  ['结果同步中', 'Syncing result'],
  ['过程已同步', 'Activity synced'],
  ['正在自动压缩上下文', 'Auto-compacting context'],
  ['上下文已自动压缩', 'Context auto-compacted'],
  ['搜索代码', 'Searching code'],
  ['探索文件', 'Exploring files'],
  ['编辑文件', 'Editing files'],
  ['运行命令', 'Running command'],
  ['截取浏览器', 'Taking browser screenshot'],
  ['打开页面', 'Opening page'],
  ['操作页面', 'Controlling page'],
  ['操作浏览器', 'Controlling browser'],
  ['需要重新配对', 'Pairing required'],
  ['当前设备授权失效，需要重新输入配对码。', 'This device authorization expired. Enter the pairing code again.'],
  ['重新配对', 'Pair again'],
  ['正在重连', 'Reconnecting'],
  ['正在恢复手机和本机服务的连接。', 'Restoring the connection between this phone and the local service.'],
  ['重试', 'Retry'],
  ['连接已断开', 'Connection disconnected'],
  ['本机服务暂时不可达，可以重试或重新配对。', 'The local service is temporarily unavailable. Retry or pair again.'],
  ['重试连接', 'Retry connection'],
  ['正在回复', 'Replying'],
  ['正在整理回复', 'Preparing reply'],
  ['正在准备任务', 'Preparing task'],
  ['正在修改并验证', 'Editing and verifying'],
  ['正在执行命令', 'Running command'],
  ['命令已完成', 'Command completed'],
  ['文件已更新', 'File updated'],
  ['文件更新失败', 'File update failed'],
  ['工具调用完成', 'Tool call completed'],
  ['正在调用工具', 'Calling tool'],
  ['工具调用失败', 'Tool call failed'],
  ['已完成一步操作', 'Step completed'],
  ['这一步操作失败', 'Step failed'],
  ['确认授权', 'Confirm authorization'],
  ['查找文件', 'Finding files'],
  ['创建文件', 'Creating files'],
  ['修改并验证', 'Editing and verifying'],
  ['修改标题', 'Renaming title'],
  ['读取内容', 'Reading content'],
  ['修改内容', 'Editing content'],
  ['上传文件', 'Uploading files'],
  ['导出文件', 'Exporting files'],
  ['删除文件', 'Deleting files'],
  ['验证结果', 'Verifying result'],
  ['网页搜索', 'Web search'],
  ['后台智能体', 'Background agent'],
  ['搜索', 'Search'],
  ['更新计划', 'Updating plan'],
  ['调用工具', 'Calling tool'],
  ['正在运行后台智能体', 'Running background agent'],
  ['计划更新失败', 'Plan update failed'],
  ['正在更新计划', 'Updating plan'],
  ['已更新计划', 'Plan updated']
];

const TEXT_TO_LOCALES = UI_TEXT_PAIRS.reduce((map, [zh, en]) => {
  map.set(zh, { zh, en });
  map.set(en, { zh, en });
  return map;
}, new Map());

function templateText(template, vars = {}) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
}

function localeFromNavigator() {
  const language = String(navigator.language || navigator.userLanguage || '').toLowerCase();
  return language.startsWith('zh') ? 'zh' : 'en';
}

function resolvedThemeFromSystem() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function storedOption(key, options, fallback = 'system') {
  const stored = localStorage.getItem(key);
  return options.includes(stored) ? stored : fallback;
}

function localizeGeneratedText(text, locale) {
  if (locale !== 'en') {
    return text;
  }
  const value = String(text || '');
  const countPatterns = [
    [/^搜索失败 (\d+) 次$/, 'Search failed {count} times'],
    [/^正在搜索 (\d+) 次$/, 'Searching {count} times'],
    [/^已搜索 (\d+) 次$/, 'Searched {count} times'],
    [/^网页搜索失败 (\d+) 次$/, 'Web search failed {count} times'],
    [/^正在搜索网页 (\d+) 次$/, 'Searching web {count} times'],
    [/^已搜索网页 (\d+) 次$/, 'Searched web {count} times'],
    [/^探索失败 (\d+) 次$/, 'Exploration failed {count} times'],
    [/^正在探索 (\d+) 个文件$/, 'Exploring {count} files'],
    [/^已探索 (\d+) 个文件$/, 'Explored {count} files'],
    [/^编辑失败 (\d+) 个文件$/, 'Editing failed for {count} files'],
    [/^正在编辑 (\d+) 个文件$/, 'Editing {count} files'],
    [/^已编辑 (\d+) 个文件$/, 'Edited {count} files'],
    [/^(\d+) 个本地任务失败$/, '{count} local tasks failed'],
    [/^正在处理 (\d+) 个本地任务$/, 'Processing {count} local tasks'],
    [/^已处理 (\d+) 个本地任务$/, 'Processed {count} local tasks'],
    [/^浏览器操作失败 (\d+) 次$/, 'Browser actions failed {count} times'],
    [/^正在操作浏览器 (\d+) 次$/, 'Controlling browser {count} times'],
    [/^已操作浏览器 (\d+) 次$/, 'Controlled browser {count} times'],
    [/^(\d+) 步操作失败$/, '{count} steps failed'],
    [/^正在完成 (\d+) 步操作$/, 'Completing {count} steps'],
    [/^已完成 (\d+) 步操作$/, 'Completed {count} steps'],
    [/^后台智能体失败 (\d+) 个$/, '{count} background agents failed'],
    [/^正在运行 (\d+) 个后台智能体$/, 'Running {count} background agents'],
    [/^已完成 (\d+) 个后台智能体$/, 'Completed {count} background agents']
  ];
  for (const [pattern, replacement] of countPatterns) {
    const match = value.match(pattern);
    if (match) {
      return templateText(replacement, { count: match[1] });
    }
  }
  const prefixPatterns = [
    [/^正在编辑 (.+)$/, 'Editing {detail}'],
    [/^正在运行 (.+)$/, 'Running {detail}'],
    [/^正在搜索 (.+)$/, 'Searching {detail}'],
    [/^正在处理 (.+)$/, 'Processing {detail}']
  ];
  for (const [pattern, replacement] of prefixPatterns) {
    const match = value.match(pattern);
    if (match) {
      return templateText(replacement, { detail: match[1] });
    }
  }
  return value;
}

function makeI18n(locale) {
  const safeLocale = locale === 'en' ? 'en' : 'zh';
  return {
    locale: safeLocale,
    t(key, vars) {
      const text = TRANSLATIONS[safeLocale]?.[key] ?? TRANSLATIONS.zh[key] ?? key;
      return templateText(text, vars);
    },
    ui(value) {
      const text = String(value || '');
      const exact = TEXT_TO_LOCALES.get(text);
      return exact ? exact[safeLocale] : localizeGeneratedText(text, safeLocale);
    }
  };
}

const DEFAULT_I18N = makeI18n('zh');
const I18nContext = createContext(DEFAULT_I18N);

function useI18n() {
  return useContext(I18nContext);
}

const RUN_MODE_OPTIONS = [
  { value: 'local', label: 'Work locally', shortLabel: 'Local' },
  { value: 'newWorktree', label: 'New worktree', shortLabel: 'Worktree' }
];

function realtimePayloadErrorMessage(payload) {
  return String(payload?.error?.message || payload?.error || payload?.message || '');
}

function isBenignRealtimeCancelError(payload) {
  return /Conversation has none active response/i.test(realtimePayloadErrorMessage(payload));
}

function normalizeVoiceCommandText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s，。！？、,.!?;；:："'“”‘’（）()【】\[\]<>《》]/g, '');
}

function isVoiceHandoffCommand(value) {
  const text = normalizeVoiceCommandText(value);
  if (!text) {
    return false;
  }
  const wantsSummary = /总结|整理|归纳|汇总|梳理|提炼|概括|组织|形成任务|变成任务|整理成任务/.test(text);
  const wantsHandoff = /交给|发给|发送给|提交给|提交|让|叫|拿给|丢给|转给|传给|给/.test(text);
  const wantsAction = /执行|处理|做|改|实现|修|查|跑|操作|落实|开始干/.test(text);
  const mentionsExecutor =
    /codex|code[x叉]?|代码|扣德克斯|扣得克斯|扣的克斯|扣得|扣德|科德克斯|科得克斯|寇德克斯|口德克斯|口得克斯|助手|后台|你/.test(text);
  if (mentionsExecutor && ((wantsSummary && wantsHandoff) || (wantsSummary && wantsAction) || (wantsHandoff && wantsAction))) {
    return true;
  }
  if (wantsSummary && wantsHandoff) {
    return true;
  }
  if (/交给codex|发给codex|提交给codex|让codex|交给代码|发给代码|提交给代码|让代码/.test(text)) {
    return true;
  }
  return false;
}

async function copyTextToClipboard(text) {
  const value = String(text || '');
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall back below for browsers that block Clipboard API in PWA/http contexts.
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.left = '-1000px';
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  try {
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

const PERMISSION_OPTIONS = [
  { value: 'default', label: 'Default permissions' },
  { value: 'acceptEdits', label: 'Auto-review' },
  { value: 'bypassPermissions', label: 'Full access', danger: true }
];
const DEFAULT_PERMISSION_MODE = 'bypassPermissions';

const REASONING_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' }
];

function formatTime(value, locale = 'zh') {
  if (!value) {
    return '';
  }
  try {
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value));
  } catch {
    return '';
  }
}

function formatRelativeTime(value, now = Date.now()) {
  if (!value) {
    return '';
  }
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) {
    return '';
  }
  const diffMs = Math.max(0, now - time);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  if (diffMs < minute) {
    return '<1m';
  }
  if (diffMs < hour) {
    return `${Math.max(1, Math.floor(diffMs / minute))}m`;
  }
  if (diffMs < day) {
    return `${Math.max(1, Math.floor(diffMs / hour))}h`;
  }
  if (diffMs < week) {
    return `${Math.max(1, Math.floor(diffMs / day))}d`;
  }
  return `${Math.max(1, Math.floor(diffMs / week))}w`;
}

function formatQuotaUpdateTime(value, t = DEFAULT_I18N.t) {
  if (!value) {
    return t('quota.notUpdated');
  }
  const formatted = formatTime(value);
  return formatted ? t('quota.updatedAt', { time: formatted }) : t('quota.unknownUpdate');
}

function formatDuration(start, end = Date.now()) {
  const startMs = new Date(start || end).getTime();
  const endMs = new Date(end || Date.now()).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return '';
  }
  const totalSeconds = Math.max(1, Math.round((endMs - startMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

function formatDurationMs(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) {
    return '';
  }
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

function compactPath(value) {
  if (!value) {
    return '';
  }
  const normalized = value.replaceAll('\\', '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length > 2 ? `${parts.at(-2)}/${parts.at(-1)}` : normalized;
}

function formatBytes(value) {
  const size = Number(value) || 0;
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 102.4) / 10} KB`;
  }
  return `${Math.round(size / 1024 / 102.4) / 10} MB`;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function formatTokenCount(value) {
  const tokens = numberOrNull(value);
  if (!tokens) {
    return '--';
  }
  if (tokens >= 1000000) {
    return `${Math.round(tokens / 100000) / 10}m`;
  }
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}k`;
  }
  return String(Math.round(tokens));
}

function normalizeContextStatus(value = {}, fallback = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const base = fallback && typeof fallback === 'object' ? fallback : {};
  const inputTokens = numberOrNull(source.inputTokens ?? source.input_tokens ?? base.inputTokens);
  const totalTokens = numberOrNull(source.totalTokens ?? source.total_tokens ?? base.totalTokens);
  const contextWindow = numberOrNull(
    source.contextWindow ??
    source.modelContextWindow ??
    source.model_context_window ??
    base.contextWindow ??
    base.modelContextWindow
  );
  const percent =
    numberOrNull(source.percent ?? base.percent) ||
    (inputTokens && contextWindow ? Math.max(0, Math.min(100, Math.round((inputTokens / contextWindow) * 1000) / 10)) : null);
  const sourceCompact = source.autoCompact && typeof source.autoCompact === 'object' ? source.autoCompact : {};
  const baseCompact = base.autoCompact && typeof base.autoCompact === 'object' ? base.autoCompact : {};
  const tokenLimit = numberOrNull(
    sourceCompact.tokenLimit ??
    sourceCompact.token_limit ??
    source.autoCompactTokenLimit ??
    source.modelAutoCompactTokenLimit ??
    baseCompact.tokenLimit ??
    base.autoCompactTokenLimit
  );
  const detected = Boolean(sourceCompact.detected ?? baseCompact.detected);
  const compactEnabled = Boolean(sourceCompact.enabled ?? source.autoCompactEnabled ?? baseCompact.enabled ?? base.autoCompactEnabled ?? tokenLimit);
  return {
    ...base,
    ...source,
    inputTokens,
    totalTokens,
    contextWindow,
    percent,
    updatedAt: source.updatedAt || base.updatedAt || null,
    autoCompact: {
      ...baseCompact,
      ...sourceCompact,
      enabled: compactEnabled,
      tokenLimit,
      detected,
      status: sourceCompact.status || baseCompact.status || (detected ? 'detected' : compactEnabled ? 'watching' : 'unknown'),
      lastCompactedAt: sourceCompact.lastCompactedAt || baseCompact.lastCompactedAt || null,
      reason: sourceCompact.reason || baseCompact.reason || ''
    }
  };
}

function mergeContextStatus(current, incoming, configContext = {}) {
  const config = normalizeContextStatus(configContext);
  const base = normalizeContextStatus(current || config, config);
  const next = normalizeContextStatus(incoming || {}, base);
  return {
    ...base,
    ...next,
    inputTokens: next.inputTokens || base.inputTokens || null,
    totalTokens: next.totalTokens || base.totalTokens || null,
    contextWindow: next.contextWindow || base.contextWindow || config.contextWindow || null,
    percent: next.percent || base.percent || null,
    autoCompact: {
      ...base.autoCompact,
      ...next.autoCompact,
      tokenLimit: next.autoCompact?.tokenLimit || base.autoCompact?.tokenLimit || null,
      detected: Boolean(next.autoCompact?.detected || base.autoCompact?.detected)
    }
  };
}

function emptyContextStatus() {
  return normalizeContextStatus(DEFAULT_STATUS.context, DEFAULT_STATUS.context);
}

function shortModelName(model) {
  if (!model) {
    return '5.5';
  }
  return model
    .replace(/^gpt-/i, '')
    .replace(/-codex.*$/i, '')
    .replace(/-mini$/i, ' mini');
}

function permissionLabel(value, t = DEFAULT_I18N.t) {
  if (value === 'acceptEdits') {
    return t('permissions.acceptEdits');
  }
  if (value === 'bypassPermissions') {
    return t('permissions.bypassPermissions');
  }
  return t('permissions.default');
}

function PermissionModeIcon({ value, size = 18 }) {
  if (value === 'bypassPermissions') {
    return <ShieldAlert size={size} />;
  }
  if (value === 'acceptEdits') {
    return <ShieldQuestion size={size} />;
  }
  return <Hand size={size} />;
}

function runModeLabel(value, t = DEFAULT_I18N.t) {
  return value === 'newWorktree' ? t('run.newWorktree') : t('run.local');
}

function runModeShortLabel(value, t = DEFAULT_I18N.t) {
  return value === 'newWorktree' ? t('run.newWorktreeShort') : t('run.localShort');
}

function RunModeIcon({ value, size = 18 }) {
  if (value === 'newWorktree') {
    return <GitPullRequestCreateArrow size={size} />;
  }
  return <Laptop size={size} />;
}

function reasoningLabel(value, t = DEFAULT_I18N.t) {
  if (value === 'low') return t('reasoning.low');
  if (value === 'medium') return t('reasoning.medium');
  if (value === 'high') return t('reasoning.high');
  return t('reasoning.xhigh');
}

function safeStoredJsonArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function selectedSkillSummary(selectedSkills, t = DEFAULT_I18N.t) {
  if (!selectedSkills?.length) {
    return t('composer.skillGeneric');
  }
  if (selectedSkills.length === 1) {
    return selectedSkills[0]?.label || selectedSkills[0]?.name || t('composer.skillGeneric');
  }
  return t('composer.selectedSkillCount', { count: selectedSkills.length });
}

function imageUrlWithRetry(url, retryKey) {
  if (!retryKey || /^data:image\//i.test(String(url || '').trim())) {
    return url;
  }
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}r=${retryKey}`;
}

const resolvedImageSourceCache = new Map();

function isLocalImageSource(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('/generated/') || raw.startsWith('/assets/')) {
    return false;
  }
  return (
    /^file:\/\//i.test(raw) ||
    /^\//.test(raw) ||
    /^~[\\/]/.test(raw) ||
    /^[A-Za-z]:[\\/]/.test(raw)
  );
}

function isPreviewableImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return false;
  }
  return (
    /^data:image\//i.test(raw) ||
    isLocalImageSource(raw) ||
    /\.(?:png|jpe?g|webp|gif|bmp|svg)(?:[?#].*)?$/i.test(raw)
  );
}

function safeDecodeUriComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function localImageApiPath(value) {
  const raw = String(value || '').trim();
  const normalized = /%[0-9a-f]{2}/i.test(raw) ? safeDecodeUriComponent(raw) : raw;
  return `/api/local-image?path=${encodeURIComponent(normalized)}`;
}

function dataImageObjectUrl(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([\s\S]+)$/i);
  if (!match) {
    return '';
  }
  const binary = atob(match[2].replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return URL.createObjectURL(new Blob([bytes], { type: match[1].toLowerCase() }));
}

function cachedResolvedImageSource(url) {
  const raw = String(url || '').trim();
  if (!raw) {
    return null;
  }
  return resolvedImageSourceCache.get(raw) || null;
}

function useResolvedImageSource(url, retryKey) {
  const [resolved, setResolved] = useState(() => cachedResolvedImageSource(url) || { src: '', local: false, error: false, cached: false });

  useEffect(() => {
    const raw = String(url || '').trim();
    if (!raw) {
      setResolved({ src: '', local: false, error: true });
      return undefined;
    }
    const cached = resolvedImageSourceCache.get(raw);
    if (cached) {
      setResolved(cached);
      return undefined;
    }
    if (/^data:image\//i.test(raw)) {
      try {
        const src = dataImageObjectUrl(raw);
        if (src) {
          const next = { src, local: false, error: false, cached: true };
          resolvedImageSourceCache.set(raw, next);
          setResolved(next);
          return undefined;
        }
      } catch {
        setResolved({ src: raw, local: false, error: false, cached: false });
        return undefined;
      }
    }
    if (!isLocalImageSource(raw)) {
      setResolved({ src: imageUrlWithRetry(raw, retryKey), local: false, error: false });
      return undefined;
    }

    let stopped = false;
    let objectUrl = '';
    setResolved({ src: '', local: true, error: false });
    apiBlobFetch(localImageApiPath(raw))
      .then((blob) => {
        if (stopped) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        const next = { src: objectUrl, local: true, error: false, cached: true };
        resolvedImageSourceCache.set(raw, next);
        setResolved(next);
      })
      .catch(() => {
        if (!stopped) {
          setResolved({ src: '', local: true, error: true });
        }
      });

    return () => {
      stopped = true;
      if (objectUrl && !resolvedImageSourceCache.has(raw)) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [url, retryKey]);

  return resolved;
}

function diffStatsFromText(diff) {
  let additions = 0;
  let deletions = 0;
  for (const line of String(diff || '').split(/\r?\n/)) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    if (line.startsWith('+')) {
      additions += 1;
    } else if (line.startsWith('-')) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}

function normalizeFileChangeForView(change) {
  if (!change || typeof change !== 'object') {
    return null;
  }
  const filePath = change.path || change.file || change.name;
  if (!filePath) {
    return null;
  }
  const unifiedDiff = change.unifiedDiff || change.unified_diff || change.diff || '';
  const stats = diffStatsFromText(unifiedDiff);
  return {
    path: String(filePath),
    oldPath: change.oldPath || change.old_path || null,
    movePath: change.movePath || change.move_path || null,
    kind: change.kind || change.type || 'modified',
    additions: Number.isFinite(Number(change.additions)) ? Number(change.additions) : stats.additions,
    deletions: Number.isFinite(Number(change.deletions)) ? Number(change.deletions) : stats.deletions,
    unifiedDiff
  };
}

function normalizeFileChangesForView(changes) {
  if (!Array.isArray(changes)) {
    return [];
  }
  return changes.map(normalizeFileChangeForView).filter(Boolean);
}

function mergeFileChangesForView(existing = [], incoming = []) {
  const merged = new Map();
  for (const change of [...normalizeFileChangesForView(existing), ...normalizeFileChangesForView(incoming)]) {
    merged.set(change.path, {
      ...merged.get(change.path),
      ...change
    });
  }
  return [...merged.values()];
}

function fileChangeKindLabel(kind) {
  const value = String(kind || '').toLowerCase();
  if (value === 'add' || value === 'create' || value === 'added') {
    return 'added';
  }
  if (value === 'delete' || value === 'remove' || value === 'deleted') {
    return 'deleted';
  }
  if (value === 'rename' || value === 'move') {
    return 'renamed';
  }
  return 'modified';
}

function createClientTurnId() {
  return globalThis.crypto?.randomUUID?.() || `turn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const NEW_DRAFT_CACHE_PREFIX = 'codexmobile.newDraft.';

function createDraftSession(project, options = {}) {
  const now = new Date().toISOString();
  return {
    id: options.stable ? `draft-${project.id}` : `draft-${project.id}-${Date.now()}`,
    projectId: project.id,
    title: '新对话',
    summary: '等待第一条消息',
    messageCount: 0,
    updatedAt: now,
    draft: true
  };
}

function isDraftSession(session) {
  const id = typeof session === 'string' ? session : session?.id;
  return Boolean(session?.draft || id?.startsWith('draft-'));
}

function isConcreteSessionId(value) {
  const text = String(value || '');
  return Boolean(text && !text.startsWith('draft-') && !text.startsWith('codex-'));
}

function safeDecodePathSegment(value) {
  try {
    return decodeURIComponent(value || '');
  } catch {
    return value || '';
  }
}

function parseAppRoute(pathname = '') {
  const source =
    pathname ||
    (typeof window !== 'undefined' ? window.location.pathname : '/') ||
    '/';
  const parts = source.split('/').filter(Boolean).map(safeDecodePathSegment);
  if (!parts.length) {
    return { type: 'welcome' };
  }
  if (parts[0] === 'settings') {
    return { type: 'settings' };
  }
  if (parts[0] !== 'projects' || !parts[1]) {
    return { type: 'welcome' };
  }
  if (parts[2] === 'threads' && parts[3]) {
    return { type: 'thread', projectId: parts[1], sessionId: parts[3] };
  }
  return { type: 'project-new', projectId: parts[1] };
}

function projectNewRoutePath(projectId) {
  return `/projects/${encodeURIComponent(projectId)}/new`;
}

function sessionRoutePath(projectId, sessionId) {
  return `/projects/${encodeURIComponent(projectId)}/threads/${encodeURIComponent(sessionId)}`;
}

function settingsRoutePath() {
  return '/settings';
}

function newDraftCacheKey(projectId) {
  return `${NEW_DRAFT_CACHE_PREFIX}${projectId}`;
}

function readNewDraftCache(projectId) {
  if (!projectId || typeof localStorage === 'undefined') {
    return {};
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(newDraftCacheKey(projectId)) || '{}');
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return {
      input: typeof parsed.input === 'string' ? parsed.input : '',
      attachments: Array.isArray(parsed.attachments) ? parsed.attachments : [],
      fileMentions: Array.isArray(parsed.fileMentions) ? parsed.fileMentions : [],
      runMode: RUN_MODE_OPTIONS.some((option) => option.value === parsed.runMode) ? parsed.runMode : ''
    };
  } catch {
    return {};
  }
}

function writeNewDraftCache(projectId, draft) {
  if (!projectId || typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(
      newDraftCacheKey(projectId),
      JSON.stringify({
        input: String(draft?.input || ''),
        attachments: Array.isArray(draft?.attachments) ? draft.attachments : [],
        fileMentions: Array.isArray(draft?.fileMentions) ? draft.fileMentions : [],
        runMode: draft?.runMode || 'local',
        updatedAt: new Date().toISOString()
      })
    );
  } catch {
    // Storage can fail in private mode; losing a draft cache is non-fatal.
  }
}

function clearNewDraftCache(projectId) {
  if (!projectId || typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.removeItem(newDraftCacheKey(projectId));
  } catch {
    // Ignore localStorage failures.
  }
}

function runModeFromPath(value = '') {
  return String(value || '').includes('/.codex/worktrees/') ? 'newWorktree' : 'local';
}

function sessionEffectiveRunMode(session, runtime = null, fallback = 'local') {
  const pathValue = runtime?.workingDirectory || session?.cwd || '';
  return runtime?.runMode || session?.runMode || (pathValue ? runModeFromPath(pathValue) : '') || fallback;
}

function workspaceTargetForSelection(project, session, runtime = null) {
  if (!project) {
    return null;
  }
  const runtimePath = runtime?.workingDirectory || runtime?.targetProjectPath || '';
  const sessionPath = !isDraftSession(session) ? session?.cwd || '' : '';
  const targetPath = runtimePath || sessionPath || project.path;
  return {
    ...project,
    path: targetPath || project.path,
    basePath: project.path,
    sessionId: !isDraftSession(session) ? session?.id || runtime?.sessionId || '' : '',
    cwd: targetPath && targetPath !== project.path ? targetPath : '',
    runMode: sessionEffectiveRunMode(session, runtime, 'local')
  };
}

function workspaceTargetQuery(target) {
  const params = new URLSearchParams();
  if (target?.id) {
    params.set('projectId', target.id);
  }
  if (target?.sessionId) {
    params.set('sessionId', target.sessionId);
  }
  if (target?.cwd) {
    params.set('cwd', target.cwd);
  }
  return params.toString();
}

function workspaceTargetBody(target, extra = {}) {
  return {
    ...extra,
    projectId: target?.id || '',
    sessionId: target?.sessionId || '',
    cwd: target?.cwd || ''
  };
}

function sessionMessagesApiPath(sessionId, { limit = 120, activity = true } = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (activity) {
    params.set('activity', '1');
  }
  return `/api/sessions/${encodeURIComponent(sessionId)}/messages?${params.toString()}`;
}

function titleFromFirstMessage(message) {
  return provisionalSessionTitle(message);
}

function autoTitlePatch(title, phase = 'provisional') {
  return title ? { title, titleLocked: false, titleAutoGenerated: phase } : {};
}

function payloadRunKeys(payload) {
  return [payload?.turnId, payload?.sessionId, payload?.previousSessionId].filter(Boolean);
}

function selectedRunKeys(session) {
  return [session?.id, session?.turnId].filter(Boolean);
}

function hasRunningKey(runningById, keys) {
  return keys.some((key) => Boolean(runningById[key]));
}

function sessionRunKeys(session) {
  return [session?.id, session?.turnId, session?.previousSessionId].filter(Boolean);
}

function buildComposerRunStatus(messages, running, now = Date.now()) {
  const activity = [...(messages || [])]
    .reverse()
    .find((message) => message.role === 'activity' && (message.status === 'running' || message.status === 'queued'));
  if (!running && !activity) {
    return null;
  }

  const steps = Array.isArray(activity?.activities) ? activity.activities : [];
  const visibleSteps = steps.filter((step) => isVisibleActivityStep(step, activity?.status || 'running'));
  const activeStep = [...visibleSteps].reverse().find((step) => step.status === 'running' || step.status === 'queued') || null;
  const latestStep = activeStep || visibleSteps[visibleSteps.length - 1] || null;
  const startedAt = activity?.startedAt || activity?.timestamp || now;
  const startedAtMs = new Date(startedAt).getTime();
  if (!running && Number.isFinite(startedAtMs) && now - startedAtMs > STALE_ACTIVITY_STATUS_MS) {
    return null;
  }
  const duration = formatDuration(startedAt, now);
  let label = '正在思考';

  if (latestStep) {
    if (latestStep.kind === 'agent_message' || latestStep.kind === 'message') {
      label = '正在同步回复';
    } else if (activeStep) {
      label = describeActivityStep(latestStep).label || latestStep.label || label;
    } else if (activity?.status === 'running' || activity?.status === 'queued') {
      label = '正在思考';
    } else {
      const descriptor = describeActivityStep(latestStep);
      label = descriptor.type === 'command'
        ? '等待命令返回'
        : descriptor.type === 'edit'
          ? '文件变更已同步'
          : descriptor.type === 'web_search'
            ? '网页搜索已完成'
            : descriptor.label || latestStep.label || '等待下一步';
    }
  } else if (activity?.detail) {
    label = activity.detail;
  } else if (activity?.label && !isGenericActivityLabel(activity.label)) {
    label = activity.label;
  }

  return {
    label: compactActivityText(label) || '正在处理',
    duration,
    running: true
  };
}

function hasVisibleAssistantForTurn(messages, payload) {
  const hasExactTurnMatch = messages.some(
    (message) =>
      message.role === 'assistant' &&
      payload?.turnId &&
      message.turnId === payload.turnId &&
      typeof message.content === 'string' &&
      message.content.trim()
  );
  if (hasExactTurnMatch) {
    return true;
  }

  const latestUserIndex = messages.reduce(
    (latest, message, index) => (message.role === 'user' ? index : latest),
    -1
  );
  return messages.some(
    (message, index) =>
      message.role === 'assistant' &&
      index > latestUserIndex &&
      typeof message.content === 'string' &&
      message.content.trim()
  );
}

function spokenReplyText(value) {
  return String(value || '')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/```[\s\S]*?```/g, ' 代码块 ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[#>*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2400);
}

function voiceDialogStatusLabel(state, t = DEFAULT_I18N.t) {
  const labels = {
    idle: t('voice.statusIdle'),
    listening: t('voice.statusListening'),
    transcribing: t('voice.statusTranscribing'),
    sending: t('voice.statusSending'),
    waiting: t('voice.statusWaiting'),
    speaking: t('voice.statusSpeaking'),
    summarizing: t('voice.statusSummarizing'),
    handoff: t('voice.statusHandoff'),
    error: t('voice.statusError')
  };
  return labels[state] || labels.idle;
}

function downsampleAudio(input, inputRate, outputRate) {
  if (outputRate === inputRate) {
    return input;
  }
  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const before = Math.floor(sourceIndex);
    const after = Math.min(before + 1, input.length - 1);
    const weight = sourceIndex - before;
    output[index] = input[before] * (1 - weight) + input[after] * weight;
  }
  return output;
}

function floatToPcm16Base64(input) {
  const bytes = new Uint8Array(input.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function pcm16Base64ToFloat(base64) {
  const binary = atob(base64);
  const length = Math.floor(binary.length / 2);
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const lo = binary.charCodeAt(index * 2);
    const hi = binary.charCodeAt(index * 2 + 1);
    const value = (hi << 8) | lo;
    const signed = value >= 0x8000 ? value - 0x10000 : value;
    output[index] = Math.max(-1, Math.min(1, signed / 0x8000));
  }
  return output;
}

function audioLevel(samples) {
  if (!samples?.length) {
    return 0;
  }
  let total = 0;
  for (let index = 0; index < samples.length; index += 1) {
    total += samples[index] * samples[index];
  }
  return Math.sqrt(total / samples.length);
}

function upsertSessionInProject(current, projectId, session, replaceId = null) {
  if (!projectId || !session) {
    return current;
  }
  const existing = current[projectId] || [];
  const filtered = existing.filter((item) => item.id !== session.id && (!replaceId || item.id !== replaceId));
  return {
    ...current,
    [projectId]: [session, ...filtered]
  };
}

function statusMessageId(payload) {
  return `status-${payload.turnId || payload.sessionId || 'current'}`;
}

function larkCliActivityLabel(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  if (!lower.includes('lark-cli')) {
    return '';
  }

  if (/\bauth\b/.test(lower)) {
    return '确认飞书授权';
  }

  if (/\bsheets?\b/.test(lower)) {
    if (/\+create|\bcreate\b/.test(lower)) {
      return '创建表格';
    }
    if (/\+append|\bappend\b/.test(lower)) {
      return '追加表格数据';
    }
    if (/\+write|\bwrite\b/.test(lower)) {
      return '写入表格数据';
    }
    if (/\+find|\bfind\b/.test(lower)) {
      return '查找表格内容';
    }
    if (/\+replace|\breplace\b/.test(lower)) {
      return '替换表格内容';
    }
    if (/\+export|\bexport\b/.test(lower)) {
      return '导出表格';
    }
    if (/title|rename|\bpatch\b|\bupdate\b|spreadsheet\.meta/.test(lower)) {
      return '修改表名';
    }
    if (/\+read|\bread\b|\bget\b|\bmeta\b/.test(lower)) {
      return '读取表格信息';
    }
    return '操作表格';
  }

  if (/\bslides?\b/.test(lower)) {
    if (/\+create|\bcreate\b/.test(lower)) {
      return '创建 PPT';
    }
    if (/\+update|\bupdate\b|\breplace\b|\bpatch\b/.test(lower)) {
      return '修改 PPT';
    }
    if (/\+read|\bread\b|\bget\b|\bxml_presentations\b/.test(lower)) {
      return '读取 PPT';
    }
    return '操作 PPT';
  }

  if (/\bdocs?\b/.test(lower)) {
    if (/\+create|\bcreate\b/.test(lower)) {
      return '创建文档';
    }
    if (/\+update|\bupdate\b|\bappend\b|\breplace\b|\bpatch\b/.test(lower)) {
      return '修改文档';
    }
    if (/\+search|\bsearch\b/.test(lower)) {
      return '搜索文档';
    }
    if (/\+fetch|\bread\b|\bget\b|\bfetch\b/.test(lower)) {
      return '读取文档';
    }
    return '操作文档';
  }

  if (/\bdrive\b/.test(lower)) {
    if (/\+import|\bimport\b/.test(lower)) {
      return '导入文件';
    }
    if (/\+upload|\bupload\b/.test(lower)) {
      return '上传文件';
    }
    if (/\+download|\bdownload\b/.test(lower)) {
      return '下载文件';
    }
    if (/\+delete|\bdelete\b|\btrash\b/.test(lower)) {
      return '删除文件';
    }
    if (/\+move|\bmove\b/.test(lower)) {
      return '移动文件';
    }
    if (/title|rename|\bpatch\b|\bupdate\b/.test(lower)) {
      return '修改文件名';
    }
    if (/\+search|\bsearch\b/.test(lower)) {
      return '搜索云空间';
    }
    return '操作云空间';
  }

  return '';
}

function shellCommandActivityLabel(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  if (!text) {
    return '';
  }
  if (/\b(npm|pnpm|yarn|bun)\s+(run\s+)?build\b|\bvite\s+build\b|\bwebpack\b|\brollup\b/.test(lower)) {
    return '构建前端';
  }
  if (/\b(npm|pnpm|yarn|bun)\s+(run\s+)?smoke\b|\bsmoke\.mjs\b/.test(lower)) {
    return '运行冒烟检查';
  }
  if (/\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\bpytest\b|\bvitest\b|\bjest\b|\bmvn\b.*\btest\b|\bcargo\s+test\b/.test(lower)) {
    return '运行测试';
  }
  if (/\bnode\s+--check\b|\btsc\b|\beslint\b|\bbiome\b|\bprettier\b|\bflake8\b|\bmypy\b/.test(lower)) {
    return '检查代码';
  }
  if (/\bgit\s+(status|diff|show|log|ls-files)\b/.test(lower)) {
    return '检查改动';
  }
  if (/\b(get-content|select-string|rg|findstr|grep)\b/.test(lower)) {
    return /\b(select-string|rg|findstr|grep)\b/.test(lower) ? '搜索代码' : '读取文件';
  }
  if (/\b(get-childitem|ls|dir)\b/.test(lower)) {
    return '查看文件';
  }
  if (/\b(start-process|node\s+server\/index\.js|node\s+server\\index\.js)\b/.test(lower)) {
    return '启动服务';
  }
  return '';
}

function meaningfulActivityLabel(payload, rawLabel, detail) {
  const source = [payload.command, detail, rawLabel, payload.output]
    .filter(Boolean)
    .join(' ');
  const larkLabel = larkCliActivityLabel(source);
  if (larkLabel) {
    return larkLabel;
  }
  const commandLabel = shellCommandActivityLabel(payload.command || detail);
  if (commandLabel) {
    return commandLabel;
  }

  if (payload.kind === 'agent_message' || payload.kind === 'message') {
    const text = rawLabel || payload.content || detail;
    return isGenericActivityLabel(text) ? '' : text;
  }

  if (payload.kind === 'reasoning') {
    return briefActivityLabel(rawLabel || payload.content || detail);
  }

  if (isGenericActivityLabel(rawLabel)) {
    return '';
  }

  return rawLabel && rawLabel.length <= 18 ? rawLabel : '';
}

function isGenericActivityLabel(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return true;
  }
  return /^(正在思考中?|思考完成|正在处理|正在回复|正在整理回复|正在准备任务|正在修改并验证|正在执行命令|命令已完成|命令完成|命令执行完成|执行完成|正在处理本地任务|本地任务已处理|本地任务失败|文件已更新|文件更新失败|正在更新文件|工具调用完成|正在调用工具|工具调用失败|正在完成一步操作|已完成一步操作|这一步操作失败|工具已完成|网页信息已查到|正在查找网页信息|计划已更新|正在规划|任务已完成|已完成|完成|失败)$/i.test(text);
}

function activityStepFromPayload(payload, fallbackKind = 'status') {
  const preservesText = payload.kind === 'agent_message' || payload.kind === 'message';
  const rawLabel = preservesText
    ? String(payload.label || payload.content || '').trim()
    : String(payload.label || payload.content || '').replace(/\s+/g, ' ').trim();
  const detail = String(payload.detail || payload.error || '').trim();
  const label = meaningfulActivityLabel(payload, rawLabel, detail);
  if (!label) {
    return null;
  }
  return {
    id: payload.messageId || `${statusMessageId(payload)}-${payload.kind || fallbackKind}-${label || payload.status || 'step'}`,
    kind: payload.kind || fallbackKind,
    label,
    status: payload.status || 'running',
    detail,
    command: payload.command || '',
    output: payload.output || '',
    error: payload.error || '',
    fileChanges: payload.fileChanges || [],
    toolName: payload.toolName || payload.name || '',
    timestamp: payload.timestamp || new Date().toISOString()
  };
}

function compactActivityText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }
  return text;
}

function conciseActivityDetail(value, maxLength = 140) {
  const text = compactActivityText(value);
  if (!text || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function briefActivityLabel(value, fallback = '正在处理') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }
  if (/授权|登录|连接/.test(text)) {
    return '确认授权';
  }
  if (/记忆|skill|技能|能力|scope|权限/i.test(text)) {
    return '';
  }
  if (/搜索|查找|定位/.test(text)) {
    return '查找文件';
  }
  if (/创建|新建|生成/.test(text)) {
    return '创建文件';
  }
  if (/改名|重命名|修改标题|rename/i.test(text) && /验证|确认|检查|读取/.test(text)) {
    return '修改并验证';
  }
  if (/改名|重命名|修改标题|rename/i.test(text)) {
    return '修改标题';
  }
  if (/读取|获取|标题|内容/.test(text)) {
    return '读取内容';
  }
  if (/修改|更新|写入|追加|替换|编辑/.test(text)) {
    return '修改内容';
  }
  if (/上传|导入/.test(text)) {
    return '上传文件';
  }
  if (/下载|导出/.test(text)) {
    return '导出文件';
  }
  if (/删除|移除/.test(text)) {
    return '删除文件';
  }
  if (/验证|确认|检查/.test(text)) {
    return '验证结果';
  }
  if (/命令|lark-cli|PowerShell|shell|执行/i.test(text)) {
    return '';
  }
  return text.length > 18 ? '' : text;
}

function isVisibleActivityStep(step, messageStatus) {
  if (!step) {
    return false;
  }
  if (isThinkingActivityStep(step)) {
    return true;
  }
  const label = String(step.label || '').trim();
  const hasWorkDetail =
    Boolean(step.command || step.detail || step.output || step.error || step.toolName) ||
    (Array.isArray(step.fileChanges) && step.fileChanges.length > 0);
  const workKinds = new Set([
    'command_execution',
    'file_change',
    'mcp_tool_call',
    'dynamic_tool_call',
    'web_search',
    'image_generation_call',
    'plan',
    'context_compaction',
    'subagent_activity'
  ]);
  if (isGenericActivityLabel(label) && !hasWorkDetail && !workKinds.has(step.kind)) {
    return false;
  }
  if (
    ['reasoning', 'message', 'agent_message'].includes(step.kind) &&
    /^(正在思考中?|正在处理|正在回复|正在整理回复)$/.test(label)
  ) {
    return false;
  }
  if (step.kind === 'function_call_output' && messageStatus !== 'failed' && step.status !== 'failed') {
    return false;
  }
  if (messageStatus !== 'failed' && /blocked by policy|rejected/i.test(`${step.detail || ''}\n${step.output || ''}\n${step.error || ''}`)) {
    return false;
  }
  return true;
}

function completeActivityMessagesForTurn(current, payload) {
  const keys = new Set(payloadRunKeys(payload));
  if (!keys.size) {
    return current;
  }
  const finalText = normalizeActivityDuplicateText(payload.content || payload.label || '');
  const completedAt = payload.completedAt || payload.timestamp || new Date().toISOString();
  return current.map((message) => {
    if (message.role !== 'activity' || !payloadRunKeys(message).some((key) => keys.has(key))) {
      return message;
    }
    const activities =
      finalText && Array.isArray(message.activities)
        ? message.activities.filter((activity) => {
          if (!['agent_message', 'message'].includes(activity?.kind)) {
            return true;
          }
          return normalizeActivityDuplicateText(activity.label || activity.content || activity.detail) !== finalText;
        })
        : message.activities;
    return {
      ...message,
      status: message.status === 'failed' ? 'failed' : 'completed',
      label: message.status === 'failed' ? message.label : '过程已同步',
      content: message.status === 'failed' ? message.content : '过程已同步',
      startedAt: message.startedAt || payload.startedAt || message.timestamp || null,
      completedAt: message.completedAt || completedAt,
      durationMs: message.durationMs || payload.durationMs || null,
      activities
    };
  });
}

function normalizeActivityDuplicateText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function messageMatchesRun(message, keys) {
  if (!keys?.size) {
    return false;
  }
  return payloadRunKeys(message).some((key) => keys.has(key));
}

function mergeLoadedMessagesPreservingActivity(current, loaded, payload) {
  const keys = new Set(payloadRunKeys(payload));
  if (!keys.size || !Array.isArray(loaded)) {
    return loaded || [];
  }
  if (loaded.some((message) => message.role === 'activity' && message.durationMs)) {
    return loaded;
  }
  const activityMessages = completeActivityMessagesForTurn(
    current.filter((message) => message.role === 'activity' && messageMatchesRun(message, keys)),
    payload
  );
  if (!activityMessages.length) {
    return loaded;
  }

  const result = [];
  let inserted = false;
  for (const message of loaded) {
    if (!inserted && message.role === 'assistant' && messageMatchesRun(message, keys)) {
      result.push(...removeDuplicateFinalAnswerActivity(activityMessages, { ...payload, content: message.content }));
      inserted = true;
    }
    result.push(message);
  }
  if (!inserted) {
    result.push(...activityMessages);
  }
  return result;
}

function messageStreamSignature(messages) {
  return (messages || [])
    .map((message) => {
      const activities = Array.isArray(message.activities) ? message.activities : [];
      const activitySignature = activities
        .map((activity) => `${activity.id}:${activity.status}:${activity.label}:${activity.detail || activity.command || ''}`)
        .map((signature, index) => {
          const activity = activities[index] || {};
          const fileChanges = Array.isArray(activity.fileChanges) ? activity.fileChanges : [];
          const fileSignature = fileChanges
            .map((change) => `${change.path || ''}:${change.kind || ''}:${change.additions || 0}:${change.deletions || 0}:${String(change.unifiedDiff || '').length}`)
            .join(',');
          const output = String(activity.output || activity.error || '');
          return `${signature}:${output.length}:${output.slice(-160)}:${fileSignature}`;
        })
        .join('|');
      return `${message.id}:${message.role}:${message.status || ''}:${message.content || ''}:${activitySignature}`;
    })
    .join('\n');
}

function upsertStatusMessage(current, payload) {
  const id = statusMessageId(payload);
  const existingIndex = current.findIndex((message) => message.id === id);
  const previous = existingIndex >= 0 ? current[existingIndex] : null;
  const normalizedPayload =
    payload.kind === 'agent_message'
      ? { ...payload, label: String(payload.label || payload.content || '').trim() }
      : payload;
  const detail =
    normalizedPayload.kind === 'reasoning'
      ? previous?.detail || ''
      : normalizedPayload.detail || previous?.detail || '';
  const isTurnLevel = normalizedPayload.kind === 'turn' || normalizedPayload.kind === 'error';
  const terminalTimestamp =
    normalizedPayload.completedAt ||
    (['completed', 'failed'].includes(normalizedPayload.status) ? normalizedPayload.timestamp : '') ||
    '';
  const nextMessage = {
    id,
    role: 'activity',
    turnId: normalizedPayload.turnId || previous?.turnId || null,
    sessionId: normalizedPayload.sessionId || previous?.sessionId || null,
    content: isTurnLevel ? (normalizedPayload.label || previous?.content || '正在处理') : (previous?.content || '正在处理'),
    label: isTurnLevel ? (normalizedPayload.label || previous?.label || '正在处理') : (previous?.label || '正在处理'),
    detail,
    kind: normalizedPayload.kind || previous?.kind || 'turn',
    status: isTurnLevel ? (normalizedPayload.status || previous?.status || 'running') : (previous?.status || 'running'),
    timestamp: normalizedPayload.timestamp || previous?.timestamp || new Date().toISOString(),
    startedAt: previous?.startedAt || normalizedPayload.startedAt || normalizedPayload.timestamp || new Date().toISOString(),
    completedAt: previous?.completedAt || terminalTimestamp || null,
    durationMs: previous?.durationMs || normalizedPayload.durationMs || null,
    activities: mergeActivityStep(previous?.activities || [], activityStepFromPayload(normalizedPayload))
  };

  if (existingIndex >= 0) {
    const next = [...current];
    next[existingIndex] = nextMessage;
    return next;
  }
  return [...current, nextMessage];
}

function upsertActivityMessage(current, payload) {
  const id = statusMessageId(payload);
  const existingIndex = current.findIndex((message) => message.id === id);
  const previous = existingIndex >= 0 ? current[existingIndex] : null;
  const isTurnLevel = payload.kind === 'turn' || payload.kind === 'error';
  const activity = activityStepFromPayload(payload, 'activity');
  if (!activity && !previous) {
    return current;
  }
  const activities = activity
    ? mergeActivityStep(previous?.activities || [], activity)
    : previous?.activities || [];

  const nextMessage = {
    id,
    role: 'activity',
    turnId: payload.turnId || previous?.turnId || null,
    sessionId: payload.sessionId || previous?.sessionId || null,
    content: previous?.content || '正在处理',
    label: previous?.label || '正在处理',
    detail: payload.detail || previous?.detail || activity?.detail || '',
    kind: payload.kind || previous?.kind || 'activity',
    status: isTurnLevel ? (payload.status || previous?.status || 'running') : (previous?.status || 'running'),
    timestamp: previous?.timestamp || payload.timestamp || new Date().toISOString(),
    startedAt: previous?.startedAt || payload.startedAt || previous?.timestamp || payload.timestamp || new Date().toISOString(),
    completedAt:
      previous?.completedAt ||
      payload.completedAt ||
      (isTurnLevel && ['completed', 'failed'].includes(payload.status) ? payload.timestamp || new Date().toISOString() : null),
    durationMs: previous?.durationMs || payload.durationMs || null,
    activities
  };

  if (existingIndex >= 0) {
    const next = [...current];
    next[existingIndex] = nextMessage;
    return next;
  }
  return [...current, nextMessage];
}

function upsertDiffMessage(current, payload) {
  const fileChanges = normalizeFileChangesForView(payload.fileChanges);
  if (!fileChanges.length) {
    return current;
  }
  const id = `diff-${payload.turnId || payload.sessionId || payload.messageId || 'current'}`;
  const existingIndex = current.findIndex((message) => message.id === id);
  const previous = existingIndex >= 0 ? current[existingIndex] : null;
  const nextMessage = {
    id,
    role: 'diff',
    content: '',
    turnId: payload.turnId || previous?.turnId || null,
    sessionId: payload.sessionId || previous?.sessionId || null,
    fileChanges: mergeFileChangesForView(previous?.fileChanges || [], fileChanges),
    timestamp: payload.timestamp || previous?.timestamp || new Date().toISOString()
  };
  if (existingIndex >= 0) {
    const next = [...current];
    next[existingIndex] = nextMessage;
    return next;
  }
  return [...current, nextMessage];
}

function completeStatusMessage(current, payload) {
  const id = statusMessageId(payload);
  return current.filter((message) => message.id !== id);
}

function hasAssistantMessageForTurn(messages, payload) {
  return messages.some(
    (message) =>
      message.role === 'assistant' &&
      payload?.turnId &&
      message.turnId === payload.turnId &&
      typeof message.content === 'string' &&
      message.content.trim()
  );
}

function removeActivityMessagesForTurn(messages, payload) {
  const keys = new Set(payloadRunKeys(payload));
  if (!keys.size) {
    return messages;
  }
  return messages.filter((message) => {
    if (message.role !== 'activity') {
      return true;
    }
    return !payloadRunKeys(message).some((key) => keys.has(key));
  });
}

function upsertAssistantMessage(current, payload) {
  const content = String(payload.content || '').trim();
  if (!content) {
    return current;
  }
  const id = payload.messageId || `assistant-${payload.turnId || Date.now()}`;
  const nextMessage = {
    id,
    role: 'assistant',
    content,
    timestamp: new Date().toISOString(),
    turnId: payload.turnId || null,
    sessionId: payload.sessionId || null,
    kind: payload.kind
  };
  const dedupedActivity = removeDuplicateFinalAnswerActivity(current, payload);
  const withCompletedActivity = payload.done === false ? dedupedActivity : completeActivityMessagesForTurn(dedupedActivity, payload);
  const existingIndex = withCompletedActivity.findIndex((message) => message.id === id);
  if (existingIndex >= 0) {
    const next = [...withCompletedActivity];
    next[existingIndex] = nextMessage;
    return next;
  }
  return [...withCompletedActivity, nextMessage];
}

function PairingScreen({ onPaired }) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [pairing, setPairing] = useState(false);

  async function handlePair(event) {
    event.preventDefault();
    setPairing(true);
    setError('');
    try {
      const result = await apiFetch('/api/pair', {
        method: 'POST',
        body: {
          code,
          deviceName: navigator.platform || 'iPhone'
        }
      });
      setToken(result.token);
      onPaired();
    } catch (err) {
      setError(err.message);
    } finally {
      setPairing(false);
    }
  }

  return (
    <main className="pairing-screen">
      <div className="pairing-mark">
        <Monitor size={30} />
      </div>
      <h1>CodexMobile</h1>
      <p className="pairing-lead">
        {t('pairing.lead')}
      </p>
      <div className="pairing-points" aria-label={t('pairing.capabilities')}>
        <span>{t('pairing.sync')}</span>
        <span>{t('pairing.process')}</span>
        <span>{t('pairing.private')}</span>
      </div>
      <p className="pairing-note">{t('pairing.note')}</p>
      <form className="pairing-form" onSubmit={handlePair}>
        <input
          inputMode="numeric"
          maxLength={6}
          placeholder={t('pairing.placeholder')}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        <button type="submit" disabled={code.length !== 6 || pairing}>
          {pairing ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
          {t('pairing.connect')}
        </button>
      </form>
      {error ? <div className="pairing-error">{error}</div> : null}
    </main>
  );
}

function quotaPercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) {
    return null;
  }
  return Math.max(0, Math.min(100, percent));
}

function quotaRemainingPercent(quotaWindow) {
  if (!quotaWindow || typeof quotaWindow !== 'object') {
    return null;
  }
  const display = quotaPercent(quotaWindow.displayPercent ?? quotaWindow.display_percent);
  if (display !== null) {
    return display;
  }
  const explicit = quotaPercent(quotaWindow.remainingPercent ?? quotaWindow.remaining_percent);
  if (explicit !== null) {
    return explicit;
  }
  const used = quotaPercent(quotaWindow.usedPercent ?? quotaWindow.used_percent);
  return used === null ? null : Math.max(0, Math.min(100, 100 - used));
}

function formatQuotaPercent(quotaWindow) {
  const percent = quotaRemainingPercent(quotaWindow);
  return percent === null ? '--' : `${Math.round(percent)}%`;
}

function codexCliSourceLabel(source, t = DEFAULT_I18N.t) {
  if (source === 'path') {
    return 'PATH';
  }
  if (source === 'env') {
    return 'CODEXMOBILE_CODEX_PATH';
  }
  if (source === 'bundled') {
    return t('common.bundledDependency');
  }
  if (source === 'unavailable') {
    return t('common.unavailable');
  }
  return t('common.unknown');
}

function codexBridgeModeLabel(desktopBridge, t = DEFAULT_I18N.t) {
  const mode = desktopBridge?.mode || 'unavailable';
  if (mode === 'headless-local') {
    return t('common.backgroundLocalCodex');
  }
  if (mode === 'desktop-ipc') {
    return 'Codex Desktop Remote';
  }
  if (mode === 'desktop-proxy') {
    return 'Codex Desktop app-server';
  }
  if (mode === 'isolated-dev') {
    return t('common.standaloneAppServer');
  }
  return desktopBridge?.connected ? t('common.connected') : t('common.disconnected');
}

function hostSystemLabel(environment = {}, t = DEFAULT_I18N.t) {
  const system = [environment.osType || environment.platform, environment.osRelease]
    .filter(Boolean)
    .join(' ');
  const arch = environment.arch ? `(${environment.arch})` : '';
  return [system, arch].filter(Boolean).join(' ') || t('common.unknown');
}

function quotaToneClass(percent) {
  if (percent === null) {
    return 'is-low';
  }
  if (percent >= 80) {
    return 'is-healthy';
  }
  if (percent >= 60) {
    return 'is-medium';
  }
  if (percent >= 40) {
    return 'is-warning';
  }
  return 'is-low';
}

function shortHostName(value) {
  const text = String(value || '').trim();
  if (!text) {
    return 'localhost';
  }
  return text.split('.')[0] || text;
}

function connectionDotClass(connectionState, status = DEFAULT_STATUS) {
  if (connectionState === 'connecting') {
    return 'is-connecting';
  }
  if (connectionState === 'connected' && status?.connected !== false) {
    return 'is-connected';
  }
  return 'is-disconnected';
}

function quotaWindowRole(quotaWindow) {
  const source = `${quotaWindow?.id || ''} ${quotaWindow?.label || ''}`.toLowerCase();
  if (source.includes('weekly') || source.includes('周')) {
    return 'weekly';
  }
  if (source.includes('five-hour') || source.includes('5 小时') || source.includes('5h') || source.includes('5 hour')) {
    return 'five-hour';
  }
  return '';
}

function quotaWindowIsSpark(quotaWindow) {
  const source = `${quotaWindow?.id || ''} ${quotaWindow?.label || ''}`.toLowerCase();
  return source.includes('spark');
}

function firstQuotaAccount(accounts = []) {
  return accounts.find((account) => account?.status === 'ok' && Array.isArray(account.windows) && account.windows.length) ||
    accounts.find(Boolean) ||
    null;
}

function quotaRowDefinitions(account, t = DEFAULT_I18N.t) {
  const windows = Array.isArray(account?.windows) ? account.windows : [];
  const findWindow = (role, spark) => windows.find((quotaWindow) =>
    quotaWindowRole(quotaWindow) === role && quotaWindowIsSpark(quotaWindow) === spark
  );
  return [
    { key: 'five-hour', label: t('quota.fiveHour'), window: findWindow('five-hour', false), expandedOnly: false },
    { key: 'weekly', label: t('quota.weekly'), window: findWindow('weekly', false), expandedOnly: false },
    { key: 'spark-five-hour', label: t('quota.sparkFiveHour'), window: findWindow('five-hour', true), expandedOnly: true },
    { key: 'spark-weekly', label: t('quota.sparkWeekly'), window: findWindow('weekly', true), expandedOnly: true }
  ].filter((row) => row.window);
}

function Drawer({
  open,
  onClose,
  status = DEFAULT_STATUS,
  connectionState = 'disconnected',
  projects,
  selectedProject,
  selectedSession,
  expandedProjectIds,
  sessionsByProject,
  loadingProjectId,
  runningById,
  threadRuntimeById,
  completedSessionIds,
  quotaSnapshot,
  onToggleProject,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onNewConversation,
  onOpenSettings
}) {
  const { t } = useI18n();
  const [subagentExpandedById, setSubagentExpandedById] = useState({});
  const [quotaExpanded, setQuotaExpanded] = useState(false);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [quotaLoaded, setQuotaLoaded] = useState(false);
  const [quotaError, setQuotaError] = useState('');
  const [quotaNotice, setQuotaNotice] = useState('');
  const [quotaResult, setQuotaResult] = useState(null);
  const [quotaAccounts, setQuotaAccounts] = useState([]);
  const [drawerQuery, setDrawerQuery] = useState('');
  const normalizedDrawerQuery = drawerQuery.trim().toLowerCase();
  const hostName = shortHostName(status?.environment?.hostName || status?.hostName);
  const activeQuotaAccount = firstQuotaAccount(quotaAccounts);
  const quotaRows = quotaRowDefinitions(activeQuotaAccount, t);
  const visibleQuotaRows = quotaRows.filter((row) => quotaExpanded || !row.expandedOnly);

  async function loadCodexQuota({ refresh = false } = {}) {
    if (quotaLoading) {
      return;
    }
    setQuotaLoading(true);
    setQuotaError('');
    setQuotaNotice('');
    try {
      const result = refresh
        ? await apiFetch('/api/quotas/codex/refresh', { method: 'POST' })
        : await apiFetch('/api/quotas/codex');
      setQuotaResult(result);
      setQuotaAccounts(Array.isArray(result.accounts) ? result.accounts : []);
      setQuotaNotice(result.stale ? (result.staleReason || t('quota.staleResult')) : '');
      setQuotaLoaded(true);
    } catch (error) {
      setQuotaError(t('quota.accountRetry', { message: error.message || t('quota.failed') }));
      setQuotaLoaded(true);
    } finally {
      setQuotaLoading(false);
    }
  }

  async function refreshCodexQuota(event) {
    event?.preventDefault();
    event?.stopPropagation();
    await loadCodexQuota({ refresh: true });
  }

  useEffect(() => {
    if (!open || quotaLoaded || quotaLoading) {
      return;
    }
    loadCodexQuota().catch(() => null);
  }, [open, quotaLoaded, quotaLoading]);

  useEffect(() => {
    if (!quotaSnapshot) {
      return;
    }
    setQuotaResult(quotaSnapshot);
    setQuotaAccounts(Array.isArray(quotaSnapshot.accounts) ? quotaSnapshot.accounts : []);
    setQuotaNotice(quotaSnapshot.stale ? (quotaSnapshot.staleReason || t('quota.staleResult')) : '');
    setQuotaError('');
    setQuotaLoaded(true);
  }, [quotaSnapshot]);

  return (
    <>
      <div className={`drawer-backdrop ${open ? 'is-open' : ''}`} onClick={onClose} />
      <aside className={`drawer ${open ? 'is-open' : ''}`}>
        <div className="drawer-header">
          <div>
            <strong>CodexMobile</strong>
            <small className="drawer-host-line">
              <span className={`status-dot ${connectionDotClass(connectionState, status)}`} />
              <span>{hostName}</span>
            </small>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t('common.close')}>
            <X size={20} />
          </button>
        </div>

        <div className="drawer-command">
          <label className="drawer-search">
            <Search size={17} />
            <input
              type="search"
              value={drawerQuery}
              onChange={(event) => setDrawerQuery(event.target.value)}
              placeholder={t('drawer.searchPlaceholder')}
              aria-label={t('drawer.searchPlaceholder')}
            />
          </label>
        </div>

        <section className="drawer-section project-section">
          <div className="project-list">
            {projects.map((project) => {
              const isSelected = selectedProject?.id === project.id;
              const isExpanded = Boolean(expandedProjectIds[project.id]);
              const projectSessions = sessionsByProject[project.id] || [];
              const projectMatches = normalizedDrawerQuery
                ? [project.name, project.pathLabel, project.path].some((value) => String(value || '').toLowerCase().includes(normalizedDrawerQuery))
                : true;
              const visibleProjectSessions = normalizedDrawerQuery
                ? projectSessions.filter((session) => String(session.title || t('drawer.conversation')).toLowerCase().includes(normalizedDrawerQuery))
                : projectSessions;
              if (normalizedDrawerQuery && !projectMatches && !visibleProjectSessions.length) {
                return null;
              }
              const projectSessionIds = new Set(visibleProjectSessions.map((session) => session.id));
              const childSessionsByParent = visibleProjectSessions.reduce((acc, session) => {
                if (session.parentSessionId && projectSessionIds.has(session.parentSessionId)) {
                  if (!acc.has(session.parentSessionId)) {
                    acc.set(session.parentSessionId, []);
                  }
                  acc.get(session.parentSessionId).push(session);
                }
                return acc;
              }, new Map());
              const rootSessions = visibleProjectSessions.filter(
                (session) => !session.parentSessionId || !projectSessionIds.has(session.parentSessionId)
              );
              const sessionsOpen = isExpanded || Boolean(normalizedDrawerQuery);
              const hasVisibleDraft = visibleProjectSessions.some((session) => isDraftSession(session));
              const showNewConversationPlaceholder = sessionsOpen && !normalizedDrawerQuery && !hasVisibleDraft;
              const renderThreadRow = (session, { isSubAgent = false } = {}) => {
                const runtime = threadRuntimeById?.[session.id] || null;
                const sessionRunning = runtime?.status === 'running' || hasRunningKey(runningById, sessionRunKeys(session));
                const sessionCompleted = runtime?.status === 'completed' || Boolean(completedSessionIds?.[session.id]);
                const childCount = Number(session.childCount) || 0;
                const openChildCount = Number(session.openChildCount) || 0;
                const subagentsOpen = Boolean(subagentExpandedById[session.id]);
                const rowSelected = selectedSession?.id === session.id;
                const sessionTime = session.draft
                  ? t('drawer.pending')
                  : formatRelativeTime(session.createdAt || session.created_at || session.updatedAt);
                const statusIndicator = sessionRunning ? (
                  <Loader2 className="thread-status-spin spin" size={12} aria-label={t('drawer.running')} />
                ) : sessionCompleted ? (
                  <span className="thread-complete-dot" aria-label={t('drawer.hasNewResult')} />
                ) : null;
                return (
                  <div
                    key={session.id}
                    className={`thread-row ${rowSelected ? 'is-selected has-actions' : 'is-compact'} ${session.draft ? 'is-draft' : ''} ${sessionRunning ? 'is-running' : ''} ${sessionCompleted ? 'has-complete-notice' : ''} ${isSubAgent || session.isSubAgent ? 'is-subagent' : ''}`}
                  >
                    <button
                      type="button"
                      className="thread-main"
                      onClick={() => onSelectSession(project, session)}
                    >
                      <span className="thread-title-line">
                        <span>{session.title || t('drawer.conversation')}</span>
                        {!isSubAgent && childCount ? (
                          <span
                            role="button"
                            tabIndex={0}
                            className="thread-subagent-toggle"
                            aria-label={subagentsOpen ? t('drawer.collapseSubagents') : t('drawer.expandSubagents')}
                            aria-expanded={subagentsOpen}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSubagentExpandedById((current) => ({ ...current, [session.id]: !current[session.id] }));
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                event.stopPropagation();
                                setSubagentExpandedById((current) => ({ ...current, [session.id]: !current[session.id] }));
                              }
                            }}
                          >
                            {openChildCount ? `${openChildCount}/${childCount}` : childCount} {t('drawer.subagents')}
                            <ChevronDown size={12} />
                          </span>
                        ) : null}
                      </span>
                      <span className="thread-side-meta">
                        {statusIndicator || <time>{sessionTime}</time>}
                      </span>
                    </button>
                    {rowSelected ? (
                      <>
                        <button
                          type="button"
                          className="thread-rename"
                          onClick={() => onRenameSession(project, session)}
                          aria-label={t('drawer.renameConversation')}
                          title={t('drawer.renameConversation')}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="thread-delete"
                          onClick={() => onDeleteSession(project, session)}
                          aria-label={t('drawer.archiveConversation')}
                          title={t('drawer.archiveConversation')}
                        >
                          <Archive size={14} />
                        </button>
                      </>
                    ) : null}
                  </div>
                );
              };
              return (
                <div key={project.id} className="project-group">
                  <button
                    className={`project-row ${isSelected ? 'is-selected' : ''} ${sessionsOpen ? 'is-expanded' : ''}`}
                    onClick={() => onToggleProject(project)}
                  >
                    {project.projectless ? <MessageSquare size={18} /> : <Folder size={18} />}
                    <span>
                      <strong>{project.name}</strong>
                    </span>
                    <small className="project-count">{project.sessionCount || projectSessions.length || 0}</small>
                    <ChevronDown size={15} className="project-chevron" />
                  </button>
                  {sessionsOpen ? (
                    <div className="thread-list">
                      {showNewConversationPlaceholder ? (
                        <div className="thread-row is-draft is-new-placeholder">
                          <button
                            type="button"
                            className="thread-main"
                            onClick={() => onNewConversation(project)}
                          >
                            <span className="thread-title-line">
                              <span>{t('drawer.newConversation')}</span>
                            </span>
                            <span className="thread-side-meta"><time>{t('drawer.pending')}</time></span>
                          </button>
                        </div>
                      ) : null}
                      {loadingProjectId === project.id ? (
                        <div className="thread-empty">
                          <Loader2 className="spin" size={14} />
                          {t('common.loading')}
                        </div>
                      ) : visibleProjectSessions.length ? (
                        rootSessions.map((session) => {
                          const childSessions = childSessionsByParent.get(session.id) || [];
                          const childSessionsOpen = Boolean(subagentExpandedById[session.id]);
                          return (
                            <div key={session.id} className="thread-stack">
                              {renderThreadRow(session)}
                              {childSessions.length && childSessionsOpen ? (
                                <div className="thread-list is-subagents">
                                  {childSessions.map((childSession) => renderThreadRow(childSession, { isSubAgent: true }))}
                                </div>
                              ) : null}
                            </div>
                          );
                        })
                      ) : (
                        <div className="thread-empty">{t('drawer.noConversations')}</div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <section className="drawer-section drawer-controls">
          <div className={`quota-widget ${quotaExpanded ? 'is-expanded' : ''}`}>
            <div className="quota-panel">
              {quotaError ? (
                <button type="button" className="quota-error" onClick={refreshCodexQuota}>
                  {quotaError}
                </button>
              ) : null}
              {!quotaError && quotaNotice ? (
                <button type="button" className="quota-error" onClick={refreshCodexQuota}>
                  {t('quota.staleRetry', { message: quotaNotice })}
                </button>
              ) : null}
              {!quotaError && visibleQuotaRows.length ? (
                visibleQuotaRows.map((row) => {
                  const percent = quotaRemainingPercent(row.window);
                  return (
                    <div
                      key={row.key}
                      className={`quota-window ${quotaToneClass(percent)}`}
                      style={{ '--quota-percent': `${percent ?? 0}%` }}
                    >
                      <div className="quota-window-meta">
                        <span>{row.label}</span>
                        <strong>{formatQuotaPercent(row.window)}</strong>
                        {row.window.resetLabel ? <em>{row.window.resetLabel}</em> : null}
                      </div>
                      <div className="quota-bar">
                        <span />
                      </div>
                    </div>
                  );
                })
              ) : null}
              {!quotaError && !visibleQuotaRows.length && activeQuotaAccount?.status && activeQuotaAccount.status !== 'ok' ? (
                <button
                  type="button"
                  className="quota-account-message"
                  onClick={activeQuotaAccount.status === 'failed' ? refreshCodexQuota : undefined}
                >
                  {activeQuotaAccount.status === 'disabled'
                    ? t('quota.disabled')
                    : t('quota.accountRetry', { message: activeQuotaAccount.error || t('quota.failed') })}
                </button>
              ) : null}
              {quotaLoading && !quotaLoaded ? <div className="quota-empty">{t('quota.loading')}</div> : null}
              {!quotaLoading && !quotaError && quotaLoaded && !quotaAccounts.length ? (
                <div className="quota-empty">{t('quota.empty')}</div>
              ) : null}
            </div>
            <div className="quota-footer">
              <small>{formatQuotaUpdateTime(quotaResult?.updatedAt || quotaResult?.fetchedAt || quotaResult?.staleSavedAt || quotaResult?.cacheUpdatedAt, t)}</small>
              <span className="quota-footer-actions">
                <button
                  type="button"
                  className="quota-refresh"
                  onClick={refreshCodexQuota}
                  disabled={quotaLoading}
                  aria-label={t('quota.refresh')}
                  title={t('quota.refresh')}
                >
                  {quotaLoading ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}
                </button>
                <button
                  type="button"
                  className="quota-refresh"
                  onClick={() => setQuotaExpanded((value) => !value)}
                  aria-label={quotaExpanded ? t('quota.collapse') : t('quota.expand')}
                  title={quotaExpanded ? t('quota.collapse') : t('quota.expand')}
                >
                  <ChevronDown size={14} />
                </button>
              </span>
            </div>
          </div>
          <button type="button" className="settings-entry" onClick={onOpenSettings}>
            <span>
              <Settings size={18} />
              {t('settings.title')}
            </span>
            <ChevronRight size={17} />
          </button>
        </section>
      </aside>
    </>
  );
}

function SettingsPage({
  status = DEFAULT_STATUS,
  languageSetting,
  setLanguageSetting,
  themeSetting,
  setThemeSetting,
  onOpenDocs
}) {
  const { t } = useI18n();
  const environment = status?.environment || {};
  const codexCli = status?.codexCli || {};
  const codexCliVersion = codexCli.version || (codexCli.error ? t('common.unavailable') : t('common.unknown'));
  const codexCliMeta = [codexCliSourceLabel(codexCli.source, t), codexCli.path].filter(Boolean).join(' · ');
  const bridgeMeta = [status?.desktopBridge?.connected ? t('common.connected') : t('common.disconnected'), status?.desktopBridge?.mode]
    .filter(Boolean)
    .join(' · ');

  return (
    <main className="settings-page">
      <div className="settings-page-content">
        <header className="settings-page-header">
          <h1>{t('settings.title')}</h1>
        </header>
        <section className="settings-group">
          <div className="drawer-heading">{t('settings.appearance')}</div>
          <div className="theme-setting">
            <div className="theme-setting-title">
              <span>{t('settings.language')}</span>
            </div>
            <div className="theme-segment is-three" role="group" aria-label={t('settings.language')}>
              {LOCALE_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={languageSetting === option ? 'is-selected' : ''}
                  onClick={() => setLanguageSetting(option)}
                >
                  {option === 'system' ? t('common.system') : option === 'zh' ? t('settings.zh') : t('settings.en')}
                </button>
              ))}
            </div>
          </div>
          <div className="theme-setting">
            <div className="theme-setting-title">
              <span>{t('settings.theme')}</span>
            </div>
            <div className="theme-segment is-three" role="group" aria-label={t('settings.theme')}>
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={themeSetting === option ? 'is-selected' : ''}
                  onClick={() => setThemeSetting(option)}
                >
                  {option === 'system' ? t('common.system') : option === 'light' ? t('settings.light') : t('settings.dark')}
                </button>
              ))}
            </div>
          </div>
        </section>
        <section className="settings-group">
          <div className="drawer-heading">{t('settings.integrations')}</div>
          <div className="settings-list">
            <button type="button" className="settings-entry settings-card-entry" onClick={onOpenDocs}>
              <span>
                <FeishuLogoIcon size={18} />
                {t('docs.title')}
              </span>
              <ChevronRight size={17} />
            </button>
          </div>
        </section>
        <section className="settings-group">
          <div className="drawer-heading">{t('settings.environment')}</div>
          <div className="env-info">
            <div>
              <span>{t('settings.host')}</span>
              <strong>{environment.hostName || status?.hostName || t('common.unknown')}</strong>
            </div>
            <div>
              <span>{t('settings.system')}</span>
              <strong>{hostSystemLabel(environment, t)}</strong>
            </div>
            <div>
              <span>{t('settings.codexConnection')}</span>
              <strong>{codexBridgeModeLabel(status?.desktopBridge, t)}</strong>
            </div>
            <div>
              <span>Codex CLI</span>
              <strong>{codexCliVersion}</strong>
            </div>
            {bridgeMeta ? <small>{bridgeMeta}</small> : null}
            {codexCliMeta ? <small>{codexCliMeta}</small> : null}
            {codexCli.error ? <small className="is-error">{codexCli.error}</small> : null}
            {environment.nodeVersion ? <small>Node {environment.nodeVersion}</small> : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function bridgeConnectionLabel(connectionState, desktopBridge, t = DEFAULT_I18N.t) {
  if (connectionState !== 'connected') {
    if (connectionState === 'connecting') return { label: t('common.connecting'), className: 'is-connecting' };
    return { label: t('common.disconnected'), className: 'is-disconnected' };
  }
  if (desktopBridge?.mode === 'headless-local') {
    return { label: t('common.backgroundCodex'), className: 'is-connected is-headless' };
  }
  return { label: t('common.connected'), className: 'is-connected' };
}

function TopBar({
  selectedProject,
  selectedSession,
  view = 'chat',
  runMode = 'local',
  onMenu,
  onOpenWorkspace,
  onOpenTerminal,
  onGitAction,
  onRenameSession,
  onArchiveSession,
  notificationSupported,
  notificationEnabled,
  onEnableNotifications,
  gitDisabled = false
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copiedThreadId, setCopiedThreadId] = useState(false);
  const menuRef = useRef(null);
  const copiedTimerRef = useRef(null);
  const isSettingsView = view === 'settings';
  const canCopyThreadId = !isSettingsView && Boolean(selectedSession?.id && !isDraftSession(selectedSession));
  const canOperateThread = !isSettingsView && Boolean(selectedProject?.id && selectedSession?.id);
  const threadTitle = isSettingsView
    ? t('settings.title')
    : String(selectedSession?.title || (selectedProject ? t('drawer.newConversation') : 'CodexMobile')).trim();
  const projectTitle = String(selectedProject?.name || t('top.noProject')).trim();
  const subtitle = isSettingsView ? 'CodexMobile' : `${projectTitle} · ${runModeShortLabel(runMode, t)}`;

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }
    function closeMenu(event) {
      if (!menuRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('pointerdown', closeMenu);
    return () => document.removeEventListener('pointerdown', closeMenu);
  }, [menuOpen]);

  useEffect(() => () => {
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
  }, []);

  function handleGitAction(action) {
    setMenuOpen(false);
    onGitAction?.(action);
  }

  async function handleCopyThreadId() {
    if (!canCopyThreadId) {
      return;
    }
    const copied = await copyTextToClipboard(selectedSession.id);
    if (!copied) {
      window.alert(t('message.copyFailed'));
      return;
    }
    setCopiedThreadId(true);
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => setCopiedThreadId(false), 1400);
  }

  function handleOpenWorkspace(tab) {
    setMenuOpen(false);
    onOpenWorkspace?.(tab);
  }

  function handleOpenTerminal() {
    setMenuOpen(false);
    onOpenTerminal?.();
  }

  function handleRenameThread() {
    setMenuOpen(false);
    onRenameSession?.(selectedProject, selectedSession);
  }

  function handleArchiveThread() {
    setMenuOpen(false);
    onArchiveSession?.(selectedProject, selectedSession);
  }

  function handleEnableNotifications() {
    setMenuOpen(false);
    onEnableNotifications?.();
  }

  return (
    <header className="top-bar">
      <button className="icon-button" onClick={onMenu} aria-label={t('top.openMenu')}>
        <Menu size={22} />
      </button>
      <div className="top-title">
        <strong title={threadTitle}>{threadTitle}</strong>
        {isSettingsView ? (
          <small title={subtitle}>{subtitle}</small>
        ) : (
          <small title={subtitle}>
            <span>{projectTitle}</span>
            <span className="top-title-separator">·</span>
            <RunModeIcon value={runMode} size={13} />
            <span>{runModeShortLabel(runMode, t)}</span>
          </small>
        )}
      </div>
      <div className="top-actions">
        <div className="top-menu-wrap" ref={menuRef}>
          <button
            type="button"
            className="icon-button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-label={t('top.more')}
            aria-expanded={menuOpen}
          >
            <MoreHorizontal size={22} />
          </button>
          {menuOpen ? (
            <div className="top-menu-popover" role="menu" aria-label={t('top.more')}>
              <button type="button" role="menuitem" onClick={() => handleOpenWorkspace('changes')} disabled={!selectedProject}>
                <GitPullRequestCreateArrow size={16} />
                <span>{t('top.changes')}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => handleOpenWorkspace('directories')} disabled={!selectedProject}>
                <Folder size={16} />
                <span>{t('top.directories')}</span>
              </button>
              <button type="button" role="menuitem" onClick={handleOpenTerminal} disabled={!selectedProject}>
                <Terminal size={16} />
                <span>{t('top.terminal')}</span>
              </button>
              <div className="top-menu-divider" />
              <button type="button" role="menuitem" onClick={handleRenameThread} disabled={!canOperateThread}>
                <Pencil size={16} />
                <span>{t('top.rename')}</span>
              </button>
              <button type="button" role="menuitem" className="is-danger" onClick={handleArchiveThread} disabled={!canOperateThread}>
                <Archive size={16} />
                <span>{t('top.archive')}</span>
              </button>
              <button type="button" role="menuitem" onClick={handleCopyThreadId} disabled={!canCopyThreadId}>
                {copiedThreadId ? <Check size={16} /> : <Copy size={16} />}
                <span>{copiedThreadId ? t('top.copiedThreadId') : t('top.copyThreadId')}</span>
              </button>
              <div className="top-menu-divider" />
              <button type="button" role="menuitem" onClick={() => handleGitAction('status')} disabled={gitDisabled}>
                <GitBranch size={16} />
                <span>{t('top.gitPanel')}</span>
              </button>
              <button type="button" role="menuitem" onClick={handleEnableNotifications}>
                <Bell size={16} />
                <span>{notificationEnabled ? t('top.notificationsEnabled') : t('top.enableNotifications')}</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function SessionActionModal({ action, onClose, onConfirm }) {
  const { t } = useI18n();
  const [title, setTitle] = useState(action?.session?.title || t('drawer.newConversation'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setTitle(action?.session?.title || t('drawer.newConversation'));
    setBusy(false);
    setError('');
  }, [action]);

  if (!action) {
    return null;
  }

  const isRename = action.type === 'rename';
  const threadTitle = action.session?.title || t('drawer.conversation');
  async function submit(event) {
    event?.preventDefault?.();
    if (busy) {
      return;
    }
    const nextTitle = title.trim();
    if (isRename && !nextTitle) {
      setError(t('modal.titleRequired'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onConfirm(isRename ? nextTitle : undefined);
    } catch (confirmError) {
      setBusy(false);
      setError(confirmError.message || t('modal.operationFailed'));
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={isRename ? t('top.rename') : t('top.archive')}
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={`modal-icon ${isRename ? '' : 'is-danger'}`}>
          {isRename ? <Pencil size={22} /> : <Archive size={22} />}
        </div>
        <div className="modal-body">
          <h2>{isRename ? t('top.rename') : t('top.archive')}</h2>
          {isRename ? (
            <label className="modal-field">
              <span>{t('modal.title')}</span>
              <input
                autoFocus
                value={title}
                maxLength={52}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
          ) : (
            <p>
              {t('modal.archiveConfirm', { title: threadTitle })}
            </p>
          )}
          {error ? <p className="modal-error">{error}</p> : null}
        </div>
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="submit" className={isRename ? 'modal-primary' : 'modal-danger'} disabled={busy}>
            {busy ? t('common.processing') : isRename ? t('common.save') : t('common.archive')}
          </button>
        </div>
      </form>
    </div>
  );
}

function WelcomePane({ projects, onNewConversation }) {
  const { t } = useI18n();
  const visibleProjects = Array.isArray(projects) ? projects.slice(0, 6) : [];
  return (
    <main className="welcome-pane">
      <div className="welcome-content">
        <div className="welcome-mark">
          <MessageSquarePlus size={28} />
        </div>
        <h1>CodexMobile</h1>
        <p>{t('welcome.body')}</p>
        {visibleProjects.length ? (
          <div className="welcome-projects" aria-label={t('welcome.projects')}>
            {visibleProjects.map((project) => (
              <button key={project.id} type="button" onClick={() => onNewConversation(project)}>
                <Folder size={18} />
                <span>
                  <strong>{project.name}</strong>
                  <small>{project.path}</small>
                </span>
                <Plus size={17} />
              </button>
            ))}
          </div>
        ) : (
          <div className="welcome-empty">{t('welcome.empty')}</div>
        )}
      </div>
    </main>
  );
}

function FeishuLogoIcon({ size = 30, className = '' }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="飞书"
    >
      <rect x="4" y="4" width="56" height="56" rx="15" fill="#fff" />
      <path
        d="M24 15h16.4c2.2 0 3.4.7 4.7 2.5 4.1 5.7 6.5 12.2 7 19.6-6.4-5.5-13.3-8.5-20.4-8.7L24 15Z"
        fill="#12C9B7"
      />
      <path
        d="M14.5 25.8c7.1 7.9 15.3 13.8 24.5 17.8 7.4 3.2 14.7 2.7 21.4-1.6-5.7 9.6-14.7 15.1-27 16.4-7.1.8-13.9-.1-20.5-2.8-2.4-1-4.2-3.2-4.2-5.9V28.1c0-2.3 2.4-3.8 5.8-2.3Z"
        fill="#3A73F6"
      />
      <path
        d="M30.8 38.4c8.7-9.7 18.3-14.1 28.8-8.7-4.8 9.1-12.2 16.1-21.5 17.2-5.8.7-11.7-1-17.8-5.1 3.7-.5 7.2-1.6 10.5-3.4Z"
        fill="#1F45A7"
      />
    </svg>
  );
}

function DocsPanel({ open, docs, busy, error, onClose, onConnect, onDisconnect, onOpenHome, onOpenAuth, onRefresh }) {
  const { t } = useI18n();
  if (!open) {
    return null;
  }

  const cliInstalled = Boolean(docs?.cliInstalled);
  const skillsInstalled = Boolean(docs?.skillsInstalled);
  const configured = Boolean(docs?.configured);
  const connected = Boolean(docs?.connected);
  const authorizationReady = connected && Boolean(docs?.authorizationReady);
  const missingScopes = Array.isArray(docs?.missingScopes) ? docs.missingScopes : [];
  const needsExtraAuth = connected && (!authorizationReady || missingScopes.length > 0);
  const slidesAuthorized = connected && Boolean(docs?.slidesAuthorized);
  const sheetsAuthorized = connected && Boolean(docs?.sheetsAuthorized);
  const authPending = docs?.authPending;
  const setupItems = [
    { id: 'cli', label: 'lark-cli', ok: cliInstalled },
    { id: 'skills', label: t('docs.officialSkills'), ok: skillsInstalled },
    { id: 'config', label: t('docs.appCredentials'), ok: configured },
    { id: 'auth', label: t('docs.userAuth'), ok: connected },
    { id: 'slides', label: t('docs.slidesScope'), ok: slidesAuthorized },
    { id: 'sheets', label: t('docs.sheetsScope'), ok: sheetsAuthorized }
  ];
  const subtitle = connected
    ? needsExtraAuth
      ? t('docs.pendingScope')
      : ''
    : authPending?.status === 'polling'
      ? t('docs.waitingAuth')
      : configured
        ? t('docs.notConnected')
        : t('docs.notConfigured');
  const summary = authPending?.status === 'polling'
      ? t('docs.authOpened')
      : connected
        ? needsExtraAuth
          ? t('docs.extraAuthSummary')
          : t('docs.readySummary')
        : !cliInstalled
          ? t('docs.noCli')
          : !skillsInstalled
            ? t('docs.noSkills')
            : configured
              ? t('docs.connectSummary')
              : t('docs.configSummary');
  const canConnect = cliInstalled && skillsInstalled && configured;

  return (
    <section className="docs-panel" role="dialog" aria-modal="true" aria-label={t('docs.title')}>
      <header className="docs-panel-header">
        <button className="icon-button" type="button" onClick={onClose} aria-label={t('docs.close')}>
          <ChevronLeft size={22} />
        </button>
        <div className="docs-panel-title">
          <strong>{t('docs.title')}</strong>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label={t('docs.close')}>
          <X size={20} />
        </button>
      </header>
      <div className="docs-panel-body">
        <div className="docs-status-state">
          <div className="docs-status-icon">
            <FeishuLogoIcon size={58} />
          </div>
          <h2>{t('docs.title')}</h2>
          <p>{summary}</p>
          <p className="docs-usage-note">
            {t('docs.usage')}
          </p>
          {error ? <div className="docs-panel-error">{error}</div> : null}
          {authPending?.verificationUrl && (!connected || needsExtraAuth) ? (
            <div className="docs-auth-box">
              <span>{t('docs.authCode', { code: authPending.userCode || t('docs.generated') })}</span>
              <button type="button" onClick={() => onOpenAuth(authPending.verificationUrl)}>
                {t('docs.openAuth')}
              </button>
            </div>
          ) : null}
          <div className="docs-check-list">
            {setupItems.map((item) => (
              <div key={item.id} className={item.ok ? 'is-ok' : ''}>
                {item.ok ? <Check size={15} /> : <X size={15} />}
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          {needsExtraAuth && missingScopes.length ? (
            <div className="docs-scope-hint">
              {t('docs.missingScopes', { scopes: missingScopes.slice(0, 4).join(t('docs.scopeSeparator')) })}
            </div>
          ) : null}
          <div className="docs-panel-actions">
            {connected ? (
              <>
                <button type="button" onClick={needsExtraAuth ? onConnect : onOpenHome} disabled={needsExtraAuth && busy}>
                  {needsExtraAuth ? (
                    busy ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />
                  ) : (
                    <FeishuLogoIcon size={18} />
                  )}
                  {needsExtraAuth ? t('docs.addAuth') : t('docs.openFeishu')}
                </button>
                <button type="button" onClick={onDisconnect} disabled={busy}>
                  {busy ? <Loader2 className="spin" size={16} /> : <X size={16} />}
                  {t('docs.disconnect')}
                </button>
                <button type="button" onClick={onRefresh} disabled={busy}>
                  <RefreshCw size={16} />
                  {t('common.refresh')}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={onConnect} disabled={!canConnect || busy}>
                  {busy ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}
                  {t('docs.connect')}
                </button>
                <button type="button" onClick={onRefresh} disabled={busy}>
                  <RefreshCw size={16} />
                  {t('common.refresh')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function gitActionTitle(action, t = DEFAULT_I18N.t) {
  if (action === 'status') {
    return t('git.title');
  }
  if (action === 'diff') {
    return t('git.diff');
  }
  if (action === 'sync') {
    return t('git.sync');
  }
  if (action === 'commit-push') {
    return t('git.commitPush');
  }
  if (action === 'commit') {
    return t('git.commit');
  }
  if (action === 'push') {
    return t('git.push');
  }
  if (action === 'branch') {
    return t('git.branch');
  }
  return 'Git';
}

function gitBranchDraft(project) {
  const name = String(project?.name || 'changes')
    .trim()
    .toLowerCase()
    .replace(/^codex\//, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  return `codex/${name || 'changes'}`;
}

function gitViewFromAction(action) {
  if (action === 'commit' || action === 'commit-push') {
    return 'commit';
  }
  if (action === 'branch') {
    return 'branch';
  }
  if (action === 'push' || action === 'sync') {
    return 'sync';
  }
  if (action === 'diff') {
    return 'diff';
  }
  return 'status';
}

function gitSafetyWarnings(status = {}, t = DEFAULT_I18N.t) {
  const warnings = [];
  const files = Array.isArray(status.files) ? status.files : [];
  if (files.length) {
    warnings.push(t('git.warningFiles', { count: files.length }));
  }
  if (status.behind > 0) {
    warnings.push(t('git.warningBehind', { count: status.behind }));
  }
  if (status.branch && !String(status.branch).startsWith('codex/')) {
    warnings.push(t('git.warningBranch'));
  }
  if (status.branch && !status.upstream) {
    warnings.push(t('git.warningNoUpstream'));
  }
  if (!status.clean && status.behind > 0) {
    warnings.push(t('git.warningDirtyBehind'));
  }
  return warnings;
}

function GitPanel({ open, action, project, onClose, onToast }) {
  const { t } = useI18n();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [diff, setDiff] = useState(null);
  const [activeView, setActiveView] = useState(() => gitViewFromAction(action));
  const [commitMessage, setCommitMessage] = useState('');
  const [branchName, setBranchName] = useState('');

  const projectId = project?.id || '';
  const targetQuery = workspaceTargetQuery(project);
  const title = gitActionTitle(activeView === 'status' ? 'status' : activeView, t);
  const files = Array.isArray(status?.files) ? status.files : [];
  const canCommit = Boolean(status?.canCommit);
  const canPush = Boolean(status?.branch);
  const safetyWarnings = gitSafetyWarnings(status || {}, t);

  const loadGitStatus = useCallback(async () => {
    if (!open || !projectId) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = await apiFetch(`/api/git/status?${targetQuery}`);
      const nextStatus = data.status || null;
      setStatus(nextStatus);
      setCommitMessage((current) => current || nextStatus?.defaultCommitMessage || '');
      setBranchName((current) => current || gitBranchDraft(project));
    } catch (loadError) {
      setError(loadError.message || t('git.statusReadFailed'));
    } finally {
      setBusy(false);
    }
  }, [open, projectId, project, targetQuery]);

  const loadGitDiff = useCallback(async () => {
    if (!open || !projectId) {
      return;
    }
    setBusy(true);
    setBusyAction('diff');
    setError('');
    try {
      const data = await apiFetch(`/api/git/diff?${targetQuery}`);
      setDiff(data.diff || null);
      if (data.diff?.status) {
        setStatus(data.diff.status);
      }
    } catch (loadError) {
      setError(loadError.message || t('git.diffReadFailed'));
    } finally {
      setBusy(false);
      setBusyAction('');
    }
  }, [open, projectId, targetQuery]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setResult(null);
    setDiff(null);
    setActiveView(gitViewFromAction(action));
    setCommitMessage('');
    setBranchName('');
    loadGitStatus();
  }, [open, action, projectId, loadGitStatus]);

  useEffect(() => {
    if (open && activeView === 'diff' && !diff && !busy) {
      loadGitDiff();
    }
  }, [open, activeView, diff, busy, loadGitDiff]);

  if (!open) {
    return null;
  }

  async function runGitAction(nextAction = action) {
    if (!projectId || busy) {
      return;
    }
    setBusy(true);
    setBusyAction(nextAction);
    setError('');
    setResult(null);
    onToast?.({ level: 'info', title: gitActionTitle(nextAction, t), body: t('git.running') });
    try {
      let data = null;
      if (nextAction === 'commit') {
        data = await apiFetch('/api/git/commit', {
          method: 'POST',
          body: workspaceTargetBody(project, { message: commitMessage })
        });
      } else if (nextAction === 'commit-push') {
        data = await apiFetch('/api/git/commit-push', {
          method: 'POST',
          body: workspaceTargetBody(project, { message: commitMessage })
        });
      } else if (nextAction === 'push') {
        data = await apiFetch('/api/git/push', {
          method: 'POST',
          body: workspaceTargetBody(project)
        });
      } else if (nextAction === 'pull') {
        data = await apiFetch('/api/git/pull', {
          method: 'POST',
          body: workspaceTargetBody(project)
        });
      } else if (nextAction === 'sync') {
        data = await apiFetch('/api/git/sync', {
          method: 'POST',
          body: workspaceTargetBody(project)
        });
      } else if (nextAction === 'branch') {
        data = await apiFetch('/api/git/branch', {
          method: 'POST',
          body: workspaceTargetBody(project, { branchName })
        });
      }
      setResult(data || {});
      setStatus(data?.status || status);
      if (data?.status?.defaultCommitMessage) {
        setCommitMessage(data.status.defaultCommitMessage);
      }
      onToast?.({ level: 'success', title: gitActionTitle(nextAction, t), body: t('git.completed') });
    } catch (runError) {
      setError(runError.message || t('git.failed'));
      onToast?.({ level: 'error', title: gitActionTitle(nextAction, t), body: runError.message || t('git.failed') });
    } finally {
      setBusy(false);
      setBusyAction('');
    }
  }

  const commitDisabled = busy || !projectId || !canCommit || !commitMessage.trim();
  const pushDisabled = busy || !projectId || !canPush;
  const branchDisabled = busy || !projectId || !branchName.trim();

  return (
    <section className="docs-panel git-panel" role="dialog" aria-modal="true" aria-label={title}>
      <header className="docs-panel-header">
        <button className="icon-button" type="button" onClick={onClose} aria-label={t('common.close')}>
          <ChevronLeft size={22} />
        </button>
        <div className="docs-panel-title">
          <strong>{title}</strong>
          <span>{status?.branch || project?.name || 'Git'}</span>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label={t('common.close')}>
          <X size={20} />
        </button>
      </header>
      <div className="docs-panel-body git-panel-body">
        <div className="git-tabs" role="tablist" aria-label={t('git.tabs')}>
          {[
            ['status', t('git.status')],
            ['diff', 'Diff'],
            ['sync', t('git.sync')],
            ['commit', t('git.commit')],
            ['branch', t('git.branch')]
          ].map(([view, label]) => (
            <button
              key={view}
              type="button"
              className={activeView === view ? 'is-active' : ''}
              onClick={() => setActiveView(view)}
            >
              {label}
            </button>
          ))}
        </div>

        <section className="git-status-card">
          <div className="git-status-head">
            <div>
              <strong>{status?.clean ? t('git.clean') : t('git.currentChanges')}</strong>
              <span>
                {status?.branch || t('git.notRead')}
                {status?.upstream ? ` -> ${status.upstream}` : ''}
              </span>
            </div>
            <button type="button" className="icon-button" onClick={loadGitStatus} disabled={busy} aria-label={t('git.refreshStatus')}>
              <RefreshCw size={18} />
            </button>
          </div>
          <div className="git-status-metrics">
            <span>{t('git.files', { count: files.length })}</span>
            <span>ahead {status?.ahead || 0}</span>
            <span>behind {status?.behind || 0}</span>
          </div>
          {files.length ? (
            <div className="git-file-list">
              {files.slice(0, 18).map((file) => (
                <div key={`${file.status}:${file.path}`}>
                  <code>{file.status}</code>
                  <span>{file.path}</span>
                </div>
              ))}
              {files.length > 18 ? <small>{t('git.moreFiles', { count: files.length - 18 })}</small> : null}
            </div>
          ) : null}
          {safetyWarnings.length ? (
            <div className="git-safety-list">
              {safetyWarnings.map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
          ) : null}
        </section>

        {activeView === 'diff' ? (
          <section className="git-diff-card">
            <div className="git-section-head">
              <strong>{t('git.diffPreview')}</strong>
              <button type="button" onClick={loadGitDiff} disabled={busy}>
                {busyAction === 'diff' ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
                {t('common.refresh')}
              </button>
            </div>
            {diff?.summary ? <pre className="git-diff-summary">{diff.summary}</pre> : null}
            <pre className="git-diff-pre">{diff?.patch || (busyAction === 'diff' ? t('git.readingDiff') : t('git.noDiff'))}</pre>
            {diff?.truncated ? <small className="git-diff-note">{t('git.diffTruncated')}</small> : null}
          </section>
        ) : null}

        {activeView === 'sync' ? (
          <section className="git-action-card">
            <div className="git-section-head">
              <strong>{t('git.syncOperation')}</strong>
              <span>{t('git.syncHint')}</span>
            </div>
            <div className="git-action-grid">
              <button type="button" onClick={() => runGitAction('pull')} disabled={busy || !projectId}>
                {busyAction === 'pull' ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
                Pull
              </button>
              <button type="button" onClick={() => runGitAction('sync')} disabled={busy || !projectId}>
                {busyAction === 'sync' ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
                Sync
              </button>
              <button type="button" onClick={() => runGitAction('push')} disabled={pushDisabled}>
                {busyAction === 'push' ? <Loader2 className="spin" size={15} /> : <UploadCloud size={15} />}
                Push
              </button>
            </div>
          </section>
        ) : null}

        {activeView === 'commit' ? (
          <label className="git-field">
            <span>{t('git.commitMessage')}</span>
            <input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} />
          </label>
        ) : null}

        {activeView === 'commit' ? (
          <div className="git-action-grid">
            <button type="button" onClick={() => runGitAction('commit')} disabled={commitDisabled}>
              {busyAction === 'commit' ? <Loader2 className="spin" size={15} /> : <GitCommitHorizontal size={15} />}
              {t('git.commit')}
            </button>
            <button type="button" onClick={() => runGitAction('commit-push')} disabled={commitDisabled}>
              {busyAction === 'commit-push' ? <Loader2 className="spin" size={15} /> : <UploadCloud size={15} />}
              {t('git.commitPush')}
            </button>
          </div>
        ) : null}

        {activeView === 'branch' ? (
          <label className="git-field">
            <span>{t('git.branchName')}</span>
            <input value={branchName} onChange={(event) => setBranchName(event.target.value)} />
          </label>
        ) : null}

        {activeView === 'branch' ? (
          <div className="git-action-grid">
            <button type="button" onClick={() => runGitAction('branch')} disabled={branchDisabled}>
              {busyAction === 'branch' ? <Loader2 className="spin" size={15} /> : <GitBranch size={15} />}
              {t('git.branch')}
            </button>
          </div>
        ) : null}

        {error ? <div className="docs-panel-error">{error}</div> : null}
        {result ? (
          <div className="git-result">
            <Check size={17} />
            <span>
              {action === 'commit' && result.hash ? t('git.committed', { hash: result.hash }) : null}
              {result.hash && action !== 'commit' ? t('git.committed', { hash: result.hash }) : null}
              {result.branch || result.pushed?.branch ? t('git.updated', { branch: result.branch || result.pushed?.branch }) : null}
              {!result.hash && !result.branch && !result.pushed?.branch ? t('git.completed') : null}
            </span>
          </div>
        ) : null}
        {result?.output ? <pre className="git-output">{result.output}</pre> : null}

        <div className="docs-panel-actions git-panel-actions">
          <button type="button" onClick={loadGitStatus} disabled={busy}>
            <RefreshCw size={16} />
            {t('git.refreshStatus')}
          </button>
          <button type="button" onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </section>
  );
}

function changeStatusLabel(status) {
  const value = String(status || '');
  if (value === 'added') return 'A';
  if (value === 'deleted') return 'D';
  if (value === 'renamed') return 'R';
  if (value === 'untracked') return '?';
  if (value === 'conflicted') return 'U';
  return 'M';
}

function workspaceFileIcon(type, name = '') {
  if (type === 'directory') {
    return <Folder size={22} />;
  }
  return <FileText size={21} />;
}

function WorkspaceFileRow({ file, staged, onOpen }) {
  const pathLabel = file.filePath || file.path?.split('/').slice(0, -1).join('/') || 'project root';
  const fullPath = file.fullPath || file.relativePath || file.path || '';
  const fileNameValue = file.fileName || file.name || fullPath.split('/').pop() || fullPath;
  const added = Number(file.linesAdded || 0);
  const removed = Number(file.linesRemoved || 0);
  return (
    <button type="button" className="workspace-file-row" onClick={() => onOpen(fullPath, staged)}>
      <span className="workspace-file-icon">{workspaceFileIcon(file.type, fileNameValue)}</span>
      <span className="workspace-file-main">
        <strong>{fileNameValue}</strong>
        <small>{pathLabel}</small>
      </span>
      <span className="workspace-file-stats">
        {added ? <em className="diff-add">+{added}</em> : null}
        {removed ? <em className="diff-del">-{removed}</em> : null}
      </span>
      {file.status ? <span className={`workspace-status-badge is-${file.status}`}>{changeStatusLabel(file.status)}</span> : null}
    </button>
  );
}

function WorkspaceDirectoryNode({ target, pathValue, label, depth, expanded, onToggle, onOpenFile }) {
  const { t } = useI18n();
  const [state, setState] = useState({ loading: false, error: '', entries: [] });
  const isExpanded = expanded.has(pathValue);
  const targetQuery = workspaceTargetQuery(target);
  const projectId = target?.id || '';

  useEffect(() => {
    if (!isExpanded || !projectId) {
      return undefined;
    }
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: '' }));
    apiFetch(`/api/workspace/directory?${targetQuery}&path=${encodeURIComponent(pathValue)}`)
      .then((result) => {
        if (!cancelled) {
          setState({ loading: false, error: '', entries: Array.isArray(result.directory?.entries) ? result.directory.entries : [] });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({ loading: false, error: error.message || t('workspace.readDirectoryFailed'), entries: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isExpanded, projectId, pathValue, targetQuery]);

  const childDepth = depth + 1;
  const indent = 12 + depth * 14;
  const childIndent = 12 + childDepth * 14;

  return (
    <div className="workspace-dir-node">
      <button
        type="button"
        className="workspace-dir-row"
        style={{ paddingLeft: indent }}
        onClick={() => onToggle(pathValue)}
        aria-expanded={isExpanded}
      >
        <ChevronRight size={16} />
        <Folder size={22} />
        <span>{label}</span>
      </button>
      {isExpanded ? (
        state.loading ? (
          <div className="workspace-empty" style={{ paddingLeft: childIndent }}>{t('workspace.readDirectory')}</div>
        ) : state.error ? (
          <div className="workspace-error-inline" style={{ paddingLeft: childIndent }}>{state.error}</div>
        ) : state.entries.length ? (
          <div>
            {state.entries.map((entry) => entry.type === 'directory' ? (
              <WorkspaceDirectoryNode
                key={entry.path}
                target={target}
                pathValue={entry.path}
                label={entry.name}
                depth={childDepth}
                expanded={expanded}
                onToggle={onToggle}
                onOpenFile={onOpenFile}
              />
            ) : (
              <button
                key={entry.path}
                type="button"
                className="workspace-dir-row is-file"
                style={{ paddingLeft: childIndent }}
                onClick={() => onOpenFile(entry.path)}
              >
                <span className="workspace-dir-spacer" />
                <FileText size={21} />
                <span>{entry.name}</span>
                {entry.size !== null ? <small>{formatBytes(entry.size)}</small> : null}
              </button>
            ))}
          </div>
        ) : (
          <div className="workspace-empty" style={{ paddingLeft: childIndent }}>{t('workspace.emptyDirectory')}</div>
        )
      ) : null}
    </div>
  );
}

function WorkspaceDirectoryTree({ project, onOpenFile }) {
  const [expanded, setExpanded] = useState(() => new Set(['']));
  const rootLabel = project?.name || compactPath(project?.path || '') || 'project';
  const toggle = useCallback((pathValue) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(pathValue)) {
        next.delete(pathValue);
      } else {
        next.add(pathValue);
      }
      return next;
    });
  }, []);

  return (
    <div className="workspace-directory-tree">
      <WorkspaceDirectoryNode
        target={project}
        pathValue=""
        label={rootLabel}
        depth={0}
        expanded={expanded}
        onToggle={toggle}
        onOpenFile={onOpenFile}
      />
    </div>
  );
}

function WorkspaceDiffDisplay({ patch }) {
  const { t } = useI18n();
  const rows = parseUnifiedDiffLines(patch || '');
  if (!rows.length) {
    return <div className="workspace-empty">{t('workspace.noChangesDisplay')}</div>;
  }
  return (
    <div className="workspace-diff-view">
      {rows.map((row, index) => (
        <div key={`${index}-${row.oldLine}-${row.newLine}`} className={`workspace-diff-row is-${row.type}`}>
          <span className="workspace-diff-num">{row.oldLine}</span>
          <span className="workspace-diff-num">{row.newLine}</span>
          <code>{row.text || ' '}</code>
        </div>
      ))}
    </div>
  );
}

function WorkspaceFileView({ project, selectedFile, onBack, onToast }) {
  const { t } = useI18n();
  const [displayMode, setDisplayMode] = useState('diff');
  const [state, setState] = useState({ loading: false, error: '', diff: null, file: null });
  const projectId = project?.id || '';
  const targetQuery = workspaceTargetQuery(project);
  const filePath = selectedFile?.path || '';
  const fileNameValue = filePath.split('/').pop() || filePath || 'File';
  const hasDiff = Boolean(state.diff?.patch);
  const canCopy = Boolean(state.file?.content && !state.file?.binary);

  useEffect(() => {
    if (!projectId || !filePath) {
      return undefined;
    }
    let cancelled = false;
    const stagedQuery = selectedFile?.staged === undefined ? '' : `&staged=${selectedFile.staged ? '1' : '0'}`;
    setDisplayMode('diff');
    setState({ loading: true, error: '', diff: null, file: null });
    Promise.all([
      apiFetch(`/api/git/file-diff?${targetQuery}&path=${encodeURIComponent(filePath)}${stagedQuery}`)
        .then((result) => result.diff)
        .catch(() => null),
      apiFetch(`/api/workspace/file?${targetQuery}&path=${encodeURIComponent(filePath)}`)
        .then((result) => result.file)
    ])
      .then(([diff, file]) => {
        if (!cancelled) {
          setState({ loading: false, error: '', diff, file });
          if (!diff?.patch) {
            setDisplayMode('file');
          }
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({ loading: false, error: error.message || t('workspace.readFileFailed'), diff: null, file: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, targetQuery, filePath, selectedFile?.staged]);

  async function copyFileContent() {
    if (!canCopy) {
      return;
    }
    const copied = await copyTextToClipboard(state.file.content);
    onToast?.({
      level: copied ? 'success' : 'error',
      title: copied ? t('workspace.copyContentSuccess') : t('message.copyFailed')
    });
  }

  return (
    <div className="workspace-panel-view">
      <header className="workspace-panel-header">
        <button className="icon-button" type="button" onClick={onBack} aria-label={t('common.back')}>
          <ChevronLeft size={22} />
        </button>
        <div className="workspace-panel-title">
          <strong>{fileNameValue}</strong>
          <span>{filePath || 'Unknown path'}</span>
        </div>
        <button className="icon-button" type="button" onClick={() => copyTextToClipboard(filePath)} aria-label={t('workspace.copyPath')}>
          <Copy size={18} />
        </button>
      </header>

      <div className="workspace-file-toolbar">
        {hasDiff ? (
          <>
            <button type="button" className={displayMode === 'diff' ? 'is-active' : ''} onClick={() => setDisplayMode('diff')}>Diff</button>
            <button type="button" className={displayMode === 'file' ? 'is-active' : ''} onClick={() => setDisplayMode('file')}>File</button>
          </>
        ) : (
          <button type="button" className="is-active">File</button>
        )}
        <span />
        <button type="button" onClick={copyFileContent} disabled={!canCopy}>
          <Copy size={15} />
        </button>
      </div>

      <div className="workspace-panel-scroll">
        {state.loading ? (
          <div className="workspace-empty">{t('workspace.readFile')}</div>
        ) : state.error ? (
          <div className="docs-panel-error">{state.error}</div>
        ) : displayMode === 'diff' && hasDiff ? (
          <WorkspaceDiffDisplay patch={state.diff.patch} />
        ) : state.file?.binary ? (
          <div className="workspace-empty">{t('workspace.binaryFile')}</div>
        ) : state.file?.content ? (
          <pre className="workspace-file-content"><code>{state.file.content}</code></pre>
        ) : (
          <div className="workspace-empty">{t('workspace.emptyFile')}</div>
        )}
        {state.file?.truncated ? (
          <div className="workspace-empty">{t('workspace.fileTruncated', { size: formatBytes(state.file.maxBytes) })}</div>
        ) : null}
      </div>
    </div>
  );
}

function WorkspacePanel({ open, initialTab = 'changes', project, onClose, onToast }) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState(initialTab === 'directories' ? 'directories' : 'changes');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [gitState, setGitState] = useState({ loading: false, error: '', status: null });
  const [searchState, setSearchState] = useState({ loading: false, error: '', files: [] });
  const projectId = project?.id || '';
  const targetQuery = workspaceTargetQuery(project);

  const loadGitFiles = useCallback(async () => {
    if (!open || !projectId) {
      return;
    }
    setGitState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const data = await apiFetch(`/api/git/files?${targetQuery}`);
      setGitState({ loading: false, error: '', status: data.status || null });
    } catch (error) {
      setGitState({ loading: false, error: error.message || t('workspace.readChangesFailed'), status: null });
    }
  }, [open, projectId, targetQuery]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setActiveTab(initialTab === 'directories' ? 'directories' : 'changes');
    setSearchQuery('');
    setSelectedFile(null);
    loadGitFiles();
  }, [open, initialTab, projectId, loadGitFiles]);

  useEffect(() => {
    if (!open || !projectId || !searchQuery.trim()) {
      setSearchState({ loading: false, error: '', files: [] });
      return undefined;
    }
    let cancelled = false;
    const query = searchQuery.trim();
    setSearchState((current) => ({ ...current, loading: true, error: '' }));
    const timer = window.setTimeout(() => {
      apiFetch(`/api/files/search?${targetQuery}&q=${encodeURIComponent(query)}`)
        .then((result) => {
          if (!cancelled) {
            setSearchState({ loading: false, error: '', files: Array.isArray(result.files) ? result.files : [] });
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setSearchState({ loading: false, error: error.message || t('workspace.searchFailed'), files: [] });
          }
        });
    }, 140);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, projectId, targetQuery, searchQuery]);

  if (!open) {
    return null;
  }

  function openFile(pathValue, staged) {
    if (!pathValue) {
      return;
    }
    setSelectedFile({ path: pathValue, staged });
  }

  if (selectedFile) {
    return (
      <section className="workspace-panel" role="dialog" aria-modal="true" aria-label={t('workspace.preview')}>
        <WorkspaceFileView
          project={project}
          selectedFile={selectedFile}
          onBack={() => setSelectedFile(null)}
          onToast={onToast}
        />
      </section>
    );
  }

  const status = gitState.status;
  const stagedFiles = Array.isArray(status?.stagedFiles) ? status.stagedFiles : [];
  const unstagedFiles = Array.isArray(status?.unstagedFiles) ? status.unstagedFiles : [];
  const searching = Boolean(searchQuery.trim());

  return (
    <section className="workspace-panel" role="dialog" aria-modal="true" aria-label={t('workspace.filesAndChanges')}>
      <header className="workspace-panel-header">
        <button className="icon-button" type="button" onClick={onClose} aria-label={t('common.back')}>
          <ChevronLeft size={22} />
        </button>
        <div className="workspace-panel-title">
          <strong>{t('workspace.title')}</strong>
          <span>{project?.path || project?.name || ''}</span>
        </div>
        <button className="icon-button" type="button" onClick={activeTab === 'changes' ? loadGitFiles : undefined} aria-label={t('common.refresh')}>
          <RefreshCw size={18} />
        </button>
      </header>

      <div className="workspace-search">
        <Search size={16} />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={t('workspace.search')}
          autoCapitalize="none"
          autoCorrect="off"
        />
      </div>

      <div className="workspace-tabs" role="tablist">
        <button type="button" role="tab" className={activeTab === 'changes' ? 'is-active' : ''} onClick={() => setActiveTab('changes')}>
          {t('top.changes')}
        </button>
        <button type="button" role="tab" className={activeTab === 'directories' ? 'is-active' : ''} onClick={() => setActiveTab('directories')}>
          {t('top.directories')}
        </button>
      </div>

      {!searching && activeTab === 'changes' && status ? (
        <div className="workspace-git-summary">
          <GitBranch size={16} />
          <strong>{status.branch || t('workspace.detached')}</strong>
          <span>{t('workspace.stagedSummary', { staged: status.totalStaged || 0, unstaged: status.totalUnstaged || 0 })}</span>
        </div>
      ) : null}

      <div className="workspace-panel-scroll">
        {searching ? (
          searchState.loading ? (
            <div className="workspace-empty">{t('workspace.searching')}</div>
          ) : searchState.error ? (
            <div className="docs-panel-error">{searchState.error}</div>
          ) : searchState.files.length ? (
            searchState.files.map((file) => (
              <WorkspaceFileRow key={file.relativePath || file.path} file={{ ...file, fullPath: file.relativePath, fileName: file.name, filePath: file.relativePath?.split('/').slice(0, -1).join('/') }} onOpen={openFile} />
            ))
          ) : (
            <div className="workspace-empty">{t('workspace.noSearchResults')}</div>
          )
        ) : activeTab === 'directories' ? (
          <WorkspaceDirectoryTree project={project} onOpenFile={openFile} />
        ) : gitState.loading ? (
          <div className="workspace-empty">{t('workspace.readingChanges')}</div>
        ) : gitState.error ? (
          <div className="docs-panel-error">{gitState.error}</div>
        ) : stagedFiles.length || unstagedFiles.length ? (
          <div className="workspace-changes-list">
            {stagedFiles.length ? (
              <div>
                <div className="workspace-section-label is-staged">{t('workspace.stagedChanges', { count: stagedFiles.length })}</div>
                {stagedFiles.map((file) => <WorkspaceFileRow key={`staged-${file.fullPath}`} file={file} staged={true} onOpen={openFile} />)}
              </div>
            ) : null}
            {unstagedFiles.length ? (
              <div>
                <div className="workspace-section-label is-unstaged">{t('workspace.unstagedChanges', { count: unstagedFiles.length })}</div>
                {unstagedFiles.map((file) => <WorkspaceFileRow key={`unstaged-${file.fullPath}`} file={file} staged={false} onOpen={openFile} />)}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="workspace-empty">{t('workspace.noChanges')}</div>
        )}
      </div>
    </section>
  );
}

function makeTerminalId() {
  return globalThis.crypto?.randomUUID?.() || `terminal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const TERMINAL_QUICK_KEY_ROWS = [
  [
    { label: 'Esc', sequence: '\u001b', title: 'Escape' },
    { label: 'Tab', sequence: '\t', title: 'Tab' },
    { label: 'C-c', sequence: '\u0003', title: 'Ctrl-C' },
    { label: 'Home', sequence: '\u001b[H', title: 'Home' },
    { label: '↑', sequence: '\u001b[A', title: 'Arrow up' },
    { label: 'End', sequence: '\u001b[F', title: 'End' },
    { label: 'PgUp', sequence: '\u001b[5~', title: 'Page up' }
  ],
  [
    { label: '/', sequence: '/', title: 'Slash' },
    { label: '-', sequence: '-', title: 'Hyphen' },
    { label: 'Ctrl', modifier: 'ctrl', title: 'Control modifier' },
    { label: 'Alt', modifier: 'alt', title: 'Alt modifier' },
    { label: '←', sequence: '\u001b[D', title: 'Arrow left' },
    { label: '↓', sequence: '\u001b[B', title: 'Arrow down' },
    { label: '→', sequence: '\u001b[C', title: 'Arrow right' },
    { label: 'PgDn', sequence: '\u001b[6~', title: 'Page down' }
  ]
];

function terminalTheme() {
  return {
    background: '#0b1120',
    foreground: '#e5e7eb',
    cursor: '#f8fafc',
    cursorAccent: '#0b1120',
    selectionBackground: 'rgba(148, 163, 184, 0.36)',
    black: '#0f172a',
    red: '#ef4444',
    green: '#22c55e',
    yellow: '#eab308',
    blue: '#60a5fa',
    magenta: '#d946ef',
    cyan: '#22d3ee',
    white: '#e5e7eb',
    brightBlack: '#64748b',
    brightRed: '#f87171',
    brightGreen: '#4ade80',
    brightYellow: '#fde047',
    brightBlue: '#93c5fd',
    brightMagenta: '#f0abfc',
    brightCyan: '#67e8f9',
    brightWhite: '#ffffff'
  };
}

function applyTerminalModifier(sequence, modifierState = {}) {
  let modified = String(sequence || '');
  if (modifierState.alt) {
    modified = `\u001b${modified}`;
  }
  if (modifierState.ctrl && modified.length === 1) {
    const code = modified.toUpperCase().charCodeAt(0);
    if (code >= 64 && code <= 95) {
      modified = String.fromCharCode(code - 64);
    }
  }
  return modified;
}

function TerminalCanvas({ onData, onMount, onResize }) {
  const containerRef = useRef(null);
  const onDataRef = useRef(onData);
  const onMountRef = useRef(onMount);
  const onResizeRef = useRef(onResize);

  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  useEffect(() => {
    onMountRef.current = onMount;
  }, [onMount]);

  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    const terminal = new XTermTerminal({
      allowTransparency: false,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: 'block',
      customGlyphs: true,
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: terminalTheme()
    });
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const canvasAddon = new CanvasAddon();
    const dataDisposable = terminal.onData((data) => {
      onDataRef.current?.(data);
    });
    let lastSize = '';
    let animationFrame = 0;
    let disposed = false;

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    try {
      terminal.loadAddon(canvasAddon);
    } catch {
      // Canvas rendering is an optimization; DOM rendering is fine if unavailable.
    }
    terminal.open(container);

    const fit = () => {
      if (disposed) {
        return;
      }
      try {
        fitAddon.fit();
      } catch {
        return;
      }
      const nextSize = `${terminal.cols}x${terminal.rows}`;
      if (terminal.cols > 0 && terminal.rows > 0 && nextSize !== lastSize) {
        lastSize = nextSize;
        onResizeRef.current?.(terminal.cols, terminal.rows);
      }
    };
    const scheduleFit = () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      animationFrame = requestAnimationFrame(() => {
        animationFrame = 0;
        fit();
      });
    };
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(container);
    scheduleFit();
    onMountRef.current?.(terminal);

    return () => {
      disposed = true;
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      observer.disconnect();
      dataDisposable.dispose();
      try {
        fitAddon.dispose();
        webLinksAddon.dispose();
        canvasAddon.dispose();
      } catch {
        // Ignore addon cleanup errors from partially initialized renderers.
      }
      terminal.dispose();
    };
  }, []);

  return <div ref={containerRef} className="terminal-canvas" />;
}

function TerminalQuickKey({ item, active, disabled, onInput, onModifier, onPaste }) {
  function handleClick() {
    if (disabled) {
      return;
    }
    if (item.action === 'paste') {
      onPaste();
      return;
    }
    if (item.modifier) {
      onModifier(item.modifier);
      return;
    }
    onInput(item.sequence || '');
  }

  return (
    <button
      type="button"
      className={`terminal-quick-key${active ? ' is-active' : ''}`}
      disabled={disabled}
      aria-pressed={item.modifier ? active : undefined}
      title={item.title || item.label}
      onClick={handleClick}
    >
      {item.label}
    </button>
  );
}

function TerminalPanel({
  open,
  project,
  connectionState,
  onClose,
  onToast,
  onRegisterTerminal,
  onSendTerminal
}) {
  const { t } = useI18n();
  const terminalIdRef = useRef(makeTerminalId());
  const terminalRef = useRef(null);
  const terminalStateRef = useRef('idle');
  const lastSizeRef = useRef({ cols: 100, rows: 28 });
  const modifierStateRef = useRef({ ctrl: false, alt: false });
  const toastShownRef = useRef(false);
  const onToastRef = useRef(onToast);
  const [state, setState] = useState('idle');
  const [terminalReady, setTerminalReady] = useState(false);
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);
  const projectId = project?.id || '';
  const projectSessionId = project?.sessionId || '';
  const projectCwd = project?.cwd || '';

  useEffect(() => {
    onToastRef.current = onToast;
  }, [onToast]);

  useEffect(() => {
    if (!open) {
      setTerminalReady(false);
      terminalRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    terminalStateRef.current = state;
  }, [state]);

  useEffect(() => {
    modifierStateRef.current = { ctrl: ctrlActive, alt: altActive };
  }, [ctrlActive, altActive]);

  const sendTerminal = useCallback((payload) => {
    if (!terminalIdRef.current) {
      return false;
    }
    return Boolean(onSendTerminal?.({ terminalId: terminalIdRef.current, ...payload }));
  }, [onSendTerminal]);

  const resetModifiers = useCallback(() => {
    setCtrlActive(false);
    setAltActive(false);
  }, []);

  const writeRemote = useCallback((data, modifierState = modifierStateRef.current) => {
    if (terminalStateRef.current !== 'connected' || !data) {
      return false;
    }
    const sent = sendTerminal({ type: 'terminal-input', data: applyTerminalModifier(data, modifierState) });
    if (modifierState.ctrl || modifierState.alt) {
      resetModifiers();
    }
    terminalRef.current?.focus();
    return sent;
  }, [resetModifiers, sendTerminal]);

  const handleTerminalData = useCallback((data) => {
    writeRemote(data);
  }, [writeRemote]);

  const handleTerminalMount = useCallback((terminal) => {
    terminalRef.current = terminal;
    setTerminalReady(true);
    terminal.focus();
  }, []);

  const handleTerminalResize = useCallback((cols, rows) => {
    lastSizeRef.current = { cols, rows };
    if (terminalStateRef.current === 'connected') {
      sendTerminal({ type: 'terminal-resize', cols, rows });
    }
  }, [sendTerminal]);

  useEffect(() => {
    if (!open || !projectId || !terminalReady) {
      return undefined;
    }
    if (connectionState !== 'connected') {
      setState('connecting');
      terminalRef.current?.writeln(t('terminal.waitingWs'));
      return undefined;
    }
    const terminalId = makeTerminalId();
    terminalIdRef.current = terminalId;
    toastShownRef.current = false;
    setState('connecting');
    terminalRef.current?.reset();
    const notifyConnectionFailed = (message) => {
      if (toastShownRef.current) {
        return;
      }
      toastShownRef.current = true;
      onToastRef.current?.({ level: 'error', title: t('terminal.connectFailed'), body: message || '' });
    };
    const unregister = onRegisterTerminal?.(terminalId, (payload) => {
      if (payload.terminalId && payload.terminalId !== terminalId) {
        return;
      }
      if (payload.type === 'terminal-ready') {
        setState('connected');
        terminalRef.current?.focus();
      } else if (payload.type === 'terminal-output') {
        terminalRef.current?.write(String(payload.data || ''));
      } else if (payload.type === 'terminal-error') {
        const message = payload.message || 'Terminal error';
        setState('error');
        terminalRef.current?.writeln(`\r\n${message}`);
        notifyConnectionFailed(message);
      } else if (payload.type === 'terminal-exit') {
        setState('closed');
        terminalRef.current?.writeln(`\r\n${t('terminal.exited')}`);
      }
    }) || (() => {});
    const size = lastSizeRef.current || { cols: 100, rows: 28 };
    const sent = onSendTerminal?.({
      type: 'terminal-open',
      terminalId,
      projectId,
      sessionId: projectSessionId,
      cwd: projectCwd,
      cols: size.cols,
      rows: size.rows
    });
    if (!sent) {
      const message = t('terminal.wsDisconnected');
      setState('error');
      terminalRef.current?.writeln(message);
      notifyConnectionFailed(message);
    }
    return () => {
      onSendTerminal?.({ type: 'terminal-close', terminalId });
      unregister();
    };
  }, [open, projectId, projectSessionId, projectCwd, terminalReady, connectionState, onRegisterTerminal, onSendTerminal]);

  if (!open) {
    return null;
  }

  async function handlePaste() {
    if (state !== 'connected') {
      return;
    }
    let text = '';
    try {
      text = await navigator.clipboard?.readText?.() || '';
    } catch {
      text = '';
    }
    if (!text) {
      text = window.prompt(t('terminal.paste')) || '';
    }
    if (text) {
      writeRemote(text, { ctrl: false, alt: false });
    }
  }

  function handleQuickInput(sequence) {
    writeRemote(sequence);
  }

  function handleModifier(modifier) {
    if (state !== 'connected') {
      return;
    }
    if (modifier === 'ctrl') {
      setCtrlActive((value) => !value);
      setAltActive(false);
    } else if (modifier === 'alt') {
      setAltActive((value) => !value);
      setCtrlActive(false);
    }
    terminalRef.current?.focus();
  }

  return (
    <section className="terminal-panel" role="dialog" aria-modal="true" aria-label={t('terminal.title')}>
      <header className="workspace-panel-header terminal-panel-header">
        <button className="icon-button" type="button" onClick={onClose} aria-label={t('terminal.close')}>
          <ChevronLeft size={22} />
        </button>
        <div className="workspace-panel-title">
          <strong>{t('terminal.title')}</strong>
          <span>{project?.path || project?.name || ''}</span>
        </div>
        <span className={`terminal-state is-${state}`}>{state}</span>
      </header>
      <div className="terminal-body">
        <TerminalCanvas
          onData={handleTerminalData}
          onMount={handleTerminalMount}
          onResize={handleTerminalResize}
        />
      </div>
      <div className="terminal-quick-panel">
        <button
          type="button"
          className="terminal-paste-button"
          disabled={state !== 'connected'}
          onClick={() => {
            void handlePaste();
          }}
        >
          {t('terminal.paste')}
        </button>
        {TERMINAL_QUICK_KEY_ROWS.map((row, rowIndex) => (
          <div className="terminal-quick-row" key={`terminal-quick-row-${rowIndex}`}>
            {row.map((item) => (
              <TerminalQuickKey
                key={item.label}
                item={item}
                active={(item.modifier === 'ctrl' && ctrlActive) || (item.modifier === 'alt' && altActive)}
                disabled={state !== 'connected'}
                onInput={handleQuickInput}
                onModifier={handleModifier}
                onPaste={handlePaste}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function ActivityMessage({ message, now = Date.now() }) {
  const { t, ui } = useI18n();
  const running = message.status === 'running' || message.status === 'queued';
  const failed = message.status === 'failed';
  const [open, setOpen] = useState(() => running);
  const activities = message.activities || [];
  const visibleSteps = activities.filter((activity) => isVisibleActivityStep(activity, message.status));
  const details = activityTimeRange(visibleSteps);
  const timeline = buildActivityTimeline(visibleSteps, running);
  const fileSummary = buildActivityFileSummary(visibleSteps);
  const startedAt = message.startedAt || details.startedAt || message.timestamp;
  const endedAt = running ? now : message.completedAt || details.endedAt || message.timestamp || now;
  const duration = !running ? formatDurationMs(message.durationMs) || formatDuration(startedAt, endedAt) : formatDuration(startedAt, endedAt);
  const headline = failed ? t('activity.failed') : running ? t('activity.processing') : t('activity.processed');

  useEffect(() => {
    setOpen(running);
  }, [message.id, running]);

  return (
    <div className="message-row is-activity">
      <div className={`message-bubble activity-bubble ${failed ? 'is-failed' : ''}`}>
        <button
          type="button"
          className="activity-summary"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span>{duration ? `${headline} ${duration}` : headline}</span>
          <ChevronDown className={`activity-chevron ${open ? 'is-open' : ''}`} size={15} />
        </button>
        {open && (timeline.length || fileSummary) ? (
          <div className="activity-timeline" aria-label={t('activity.progress')}>
            {timeline.map((item) =>
              item.type === 'text' ? (
                <MarkdownContent
                  key={item.id}
                  className="message-content activity-markdown activity-text"
	                  text={ui(item.text)}
                />
              ) : item.type === 'live' ? (
                <div key={item.id} className={`activity-live is-${item.liveType || 'step'} ${item.status === 'running' ? 'is-running' : ''}`}>
                  <span className="activity-live-dot" />
	                  <span>{ui(item.text)}</span>
                </div>
              ) : item.type === 'divider' ? (
                <div key={item.id} className="activity-divider">
	                  <span>{ui(item.text)}</span>
                </div>
              ) : item.metaType === 'subagent' ? (
                <SubagentActivityBlock key={item.id} item={item} />
              ) : item.items.some((step) => activityDetailText(step)) ? (
                <details key={item.id} className={`activity-meta ${item.items.some((step) => step.status === 'running' || step.status === 'queued') ? 'is-running' : ''}`}>
                  <summary className="activity-meta-summary">
                    {activityMetaIcon(item)}
	                    <span>{ui(item.title)}</span>
                  </summary>
                  <div className="activity-meta-body">
                    {item.items.filter((step) => activityDetailText(step)).map((step) => (
                      <ActivityStepDetail key={step.id} step={step} />
                    ))}
                  </div>
                </details>
              ) : (
                <div key={item.id} className={`activity-meta ${item.items.some((step) => step.status === 'running' || step.status === 'queued') ? 'is-running' : ''}`}>
                  <div className="activity-meta-summary">
                    {activityMetaIcon(item)}
	                    <span>{ui(item.title)}</span>
                  </div>
                </div>
              )
            )}
            {fileSummary ? <ActivityFileSummary summary={fileSummary} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ActivityStepDetail({ step }) {
  const { t, ui } = useI18n();
  const detail = activityDetailText(step);
  const isCommand = step.type === 'command' || Boolean(step.command);
  if (isCommand) {
    const command = step.command || detail;
    const output = step.output || step.error || '';
    const failed = step.status === 'failed';
    const running = step.status === 'running';
    const title = `${failed ? t('activity.localFailed') : running ? t('activity.localRunning') : t('activity.localDone')} ${conciseActivityDetail(command, 110)}`;
    const shellText = [`$ ${command}`, output].filter(Boolean).join('\n\n');
    const statusText = failed && step.exitCode !== undefined && step.exitCode !== null
      ? t('activity.exitCode', { code: step.exitCode })
      : failed
        ? t('common.failed')
        : running
          ? t('common.running')
          : t('common.success');
    return (
      <details className={`activity-command-detail ${failed ? 'is-failed' : ''}`} open={failed}>
        <summary>
          <span>{title}</span>
        </summary>
        <div className="activity-shell">
          <div className="activity-shell-head">Shell</div>
          <pre><code>{shellText}</code></pre>
          <div className="activity-shell-status">{statusText}</div>
        </div>
      </details>
    );
  }

  return (
    <div className="activity-meta-line">
      <MarkdownContent
        className="message-content activity-markdown activity-meta-label"
        text={ui(step.label)}
      />
      <MarkdownContent
        className="message-content activity-markdown activity-meta-detail"
        text={ui(detail)}
      />
    </div>
  );
}

function SubagentActivityBlock({ item }) {
  const { t, ui } = useI18n();
  const agents = item.items.flatMap((step) => (Array.isArray(step.subAgents) ? step.subAgents : []));
  const title = item.items[0]?.label || item.title || t('activity.subagentDefault', { count: agents.length || 1 });
  return (
    <details className="activity-meta activity-subagents">
      <summary className="activity-meta-summary">
        <Bot size={13} />
        <span>{ui(title)}</span>
      </summary>
      <div className="activity-subagent-list">
        {agents.length ? agents.map((agent) => (
          <div key={agent.threadId || `${agent.nickname}-${agent.role}`} className="activity-subagent-row">
            <span>
              <strong>{agent.nickname || agent.threadId || t('activity.subagent')}</strong>
              {agent.role ? <small>({agent.role})</small> : null}
              <em>{ui(agent.statusText || t('activity.open'))}</em>
            </span>
          </div>
        )) : (
          <div className="activity-subagent-row">
            <span><strong>{item.title}</strong></span>
          </div>
        )}
      </div>
    </details>
  );
}

function activityTimeRange(steps) {
  let startedAt = null;
  let endedAt = null;

  for (const step of steps || []) {
    const timestamp = step.timestamp || '';
    if (timestamp && (!startedAt || new Date(timestamp) < new Date(startedAt))) {
      startedAt = timestamp;
    }
    if (timestamp && (!endedAt || new Date(timestamp) > new Date(endedAt))) {
      endedAt = timestamp;
    }
  }

  return { startedAt, endedAt };
}

function stepsForActivityTimeline(steps) {
  const items = Array.isArray(steps) ? steps : [];
  let latestThinkingIndex = -1;
  items.forEach((step, index) => {
    if (isThinkingActivityStep(step)) {
      latestThinkingIndex = index;
    }
  });
  return items.filter((step, index) => {
    if (isThinkingActivityStep(step)) {
      return index === latestThinkingIndex;
    }
    return true;
  });
}

function buildActivityTimeline(steps, running) {
  const timeline = [];
  let batch = [];
  let batchIndex = 0;

  function flushBatch() {
    if (!batch.length) {
      return;
    }
    timeline.push({
      id: `meta-${batchIndex++}-${batch.map((item) => item.id).join('-')}`,
      type: 'meta',
      metaType: dominantActivityType(batch),
      title: summarizeActivityBatch(batch, running),
      items: batch
    });
    batch = [];
  }

  for (const step of stepsForActivityTimeline(steps)) {
    if (isThinkingActivityStep(step)) {
      flushBatch();
      timeline.push({
        id: `thinking-${step.id}`,
        type: 'live',
        liveType: 'thinking',
        text: thinkingActivityText(step),
        status: step.status || 'running'
      });
    } else if (isContextCompactionActivity(step)) {
      flushBatch();
      timeline.push({
        id: `divider-${step.id}`,
        type: 'divider',
        text: step.status === 'running' ? '正在自动压缩上下文' : '上下文已自动压缩'
      });
    } else if (isNarrativeActivity(step)) {
      flushBatch();
      timeline.push({
        id: `text-${step.id}`,
        type: 'text',
        text: String(step.label || step.detail || step.content || '').trim()
      });
    } else {
      const item = activityTimelineItem(step);
      if (!isPlaceholderTimelineItem(item)) {
        batch.push(item);
      }
    }
  }
  flushBatch();

  return timeline;
}

function isContextCompactionActivity(step) {
  const source = `${step?.kind || ''} ${step?.label || ''} ${step?.detail || ''}`.trim();
  return step?.kind === 'context_compaction' || /自动压缩上下文|上下文已自动压缩/.test(source);
}

function isNarrativeActivity(step) {
  const label = String(step?.label || '').trim();
  const detail = activityDetailText(step);
  const source = `${step?.kind || ''} ${label} ${detail}`.toLowerCase();
  if (step?.command) {
    return false;
  }
  if (step?.kind === 'agent_message' || step?.kind === 'message') {
    return true;
  }
  if (/command|function_call|工具|命令|已运行|执行|编辑|修改|写入|读取|搜索|检查|查看|explore|search|read/.test(source)) {
    return false;
  }
  return label.length > 26;
}

function activityTimelineItem(step) {
  const descriptor = describeActivityStep(step);
  return {
    id: step.id,
    type: descriptor.type,
    label: descriptor.label,
    detail: descriptor.detail,
    count: descriptor.count,
    unit: descriptor.unit,
    command: step.command || '',
    output: step.output || '',
    error: step.error || '',
    exitCode: step.exitCode,
    subAgents: step.subAgents || [],
    status: step.status || 'running'
  };
}

function describeActivityStep(step) {
  const detail = activityDetailText(step);
  const label = String(step?.label || '').trim();
  const toolName = String(step?.toolName || '').trim();
  const command = String(step?.command || '').trim();
  const source = `${step?.kind || ''} ${toolName} ${label} ${command} ${detail} ${step?.output || ''}`.toLowerCase();
  const fileRefs = extractFileRefs([command, detail, step?.output, fileChangeText(step)].filter(Boolean).join('\n'));
  const count = Math.max(1, fileRefs.size || (Array.isArray(step?.fileChanges) ? step.fileChanges.length : 0));

  if (step?.kind === 'file_change' || Array.isArray(step?.fileChanges) && step.fileChanges.length) {
    return {
      type: 'edit',
      label: compactActivityText(label || '编辑文件'),
      detail: detail || compactActivityText(fileChangeText(step)),
      count,
      unit: 'file'
    };
  }

  const commandKind = classifyCommandIntent(
    command || (step?.kind === 'command_execution' ? detail : ''),
    Boolean(command) || step?.kind === 'command_execution'
  );
  if (commandKind) {
    const type =
      commandKind === 'search'
        ? 'search'
        : commandKind === 'read' || commandKind === 'inspect'
          ? 'explore'
          : commandKind === 'edit'
            ? 'edit'
            : 'command';
    return {
      type,
      label: compactActivityText(label || commandActivityLabel(commandKind)),
      detail: compactActivityText(command || detail),
      count: type === 'command' ? 1 : count,
      unit: type === 'command' ? 'command' : type === 'search' ? 'time' : 'file'
    };
  }

  if (step?.kind === 'web_search' || /web_search|网页搜索|搜索网页|web search/.test(source)) {
    return {
      type: 'web_search',
      label: compactActivityText(label || '网页搜索'),
      detail,
      count: 1,
      unit: 'time'
    };
  }

  if (step?.kind === 'subagent_activity' || /后台智能体|subagent|spawn_agent|wait_agent/.test(source)) {
    return {
      type: 'subagent',
      label: compactActivityText(label || '后台智能体'),
      detail,
      count: Math.max(1, Array.isArray(step?.subAgents) ? step.subAgents.length : 1),
      unit: 'agent'
    };
  }

  if (/搜索|查找|search/.test(source)) {
    return {
      type: 'search',
      label: compactActivityText(label || '搜索'),
      detail,
      count: 1,
      unit: 'time'
    };
  }

  if (/browser_|浏览器|截图|点击|导航|navigate|screenshot|click|type/.test(source)) {
    return {
      type: 'browser',
      label: compactActivityText(label || browserActivityLabel(toolName || source)),
      detail,
      count: 1,
      unit: 'action'
    };
  }

  if (/编辑|修改|写入|替换|创建|删除|updated|deleted|apply_patch/.test(source)) {
    return {
      type: 'edit',
      label: compactActivityText(label || '编辑文件'),
      detail,
      count,
      unit: 'file'
    };
  }

  if (/读取|查看|检查|探索|read|list|inspect|load_workspace_dependencies|view_image/.test(source)) {
    return {
      type: 'explore',
      label: compactActivityText(label || '探索文件'),
      detail,
      count,
      unit: 'file'
    };
  }

  if (/todo_list|计划/.test(source)) {
    return {
      type: 'plan',
      label: compactActivityText(label || '更新计划'),
      detail,
      count: 1,
      unit: 'step'
    };
  }

  return {
    type: 'tool',
    label: compactActivityText(label || (toolName ? `调用 ${toolName}` : '调用工具')),
    detail,
    count: 1,
    unit: 'step'
  };
}

function dominantActivityType(items) {
  if (items.some((item) => item.type === 'command')) {
    return 'command';
  }
  if (items.some((item) => item.type === 'edit')) {
    return 'edit';
  }
  if (items.some((item) => item.type === 'search')) {
    return 'search';
  }
  if (items.some((item) => item.type === 'web_search')) {
    return 'web_search';
  }
  if (items.some((item) => item.type === 'browser')) {
    return 'browser';
  }
  if (items.some((item) => item.type === 'explore')) {
    return 'explore';
  }
  if (items.some((item) => item.type === 'subagent')) {
    return 'subagent';
  }
  return items[0]?.type || 'tool';
}

function summarizeActivityBatch(items, running) {
  const activeItem = items.length === 1 && running && items[0]?.status === 'running' ? items[0] : null;
  if (activeItem?.type === 'edit') {
    const detail = activeItem.detail || activeItem.label || '';
    return detail ? `正在编辑 ${conciseActivityDetail(detail)}` : '正在编辑文件';
  }
  if (activeItem?.type === 'command' && activeItem.detail) {
    return `正在运行 ${conciseActivityDetail(activeItem.detail)}`;
  }
  if ((activeItem?.type === 'search' || activeItem?.type === 'web_search') && activeItem.detail) {
    return `正在搜索 ${conciseActivityDetail(activeItem.detail)}`;
  }
  if ((activeItem?.type === 'explore' || activeItem?.type === 'browser' || activeItem?.type === 'tool') && activeItem.detail) {
    return `${activeItem.label || '正在处理'} ${conciseActivityDetail(activeItem.detail)}`;
  }
  if (activeItem?.type === 'subagent') {
    return activeItem.label || '正在运行后台智能体';
  }

  const order = [];
  const groups = items.reduce((acc, item) => {
    const key = item.type || 'tool';
    if (!acc[key]) {
      acc[key] = { steps: 0, count: 0, failed: 0, running: false, unit: item.unit || 'step' };
      order.push(key);
    }
    acc[key].steps += 1;
    acc[key].count += Number(item.count) || 1;
    acc[key].failed += item.status === 'failed' ? Number(item.count) || 1 : 0;
    acc[key].running = acc[key].running || item.status === 'running';
    return acc;
  }, {});

  function groupText(key, group) {
    const active = running && group.running;
    const doneCount = Math.max(0, group.count - group.failed);
    const failedOnly = group.failed && !doneCount && !active;
    if (key === 'search') {
      return failedOnly ? `搜索失败 ${group.failed} 次` : `${active ? '正在搜索' : '已搜索'} ${doneCount || group.count} 次`;
    }
    if (key === 'web_search') {
      return failedOnly ? `网页搜索失败 ${group.failed} 次` : `${active ? '正在搜索网页' : '已搜索网页'} ${doneCount || group.count} 次`;
    }
    if (key === 'explore') {
      return failedOnly ? `探索失败 ${group.failed} 次` : `${active ? '正在探索' : '已探索'} ${doneCount || group.count} 个文件`;
    }
    if (key === 'edit') {
      return failedOnly ? `编辑失败 ${group.failed} 个文件` : `${active ? '正在编辑' : '已编辑'} ${doneCount || group.count} 个文件`;
    }
    if (key === 'command') {
      return failedOnly ? `${group.failed} 个本地任务失败` : `${active ? '正在处理' : '已处理'} ${doneCount || group.count} 个本地任务`;
    }
    if (key === 'browser') {
      return failedOnly ? `浏览器操作失败 ${group.failed} 次` : `${active ? '正在操作浏览器' : '已操作浏览器'} ${doneCount || group.count} 次`;
    }
    if (key === 'plan') {
      return failedOnly ? '计划更新失败' : active ? '正在更新计划' : '已更新计划';
    }
    if (key === 'tool') {
      return failedOnly ? `${group.failed} 步操作失败` : `${active ? '正在完成' : '已完成'} ${doneCount || group.count} 步操作`;
    }
    if (key === 'subagent') {
      return failedOnly
        ? `后台智能体失败 ${group.failed} 个`
        : `${active ? '正在运行' : '已完成'} ${doneCount || group.count} 个后台智能体`;
    }
    return '';
  }

  const parts = [];
  for (const key of order) {
    const text = groupText(key, groups[key]);
    if (text) {
      parts.push(text);
    }
  }
  return parts.join('，') || '已处理';
}

function activityMetaIcon(item) {
  if (item.metaType === 'command') {
    return <Terminal size={13} />;
  }
  if (item.metaType === 'edit') {
    return <Pencil size={13} />;
  }
  if (item.metaType === 'search' || item.metaType === 'web_search') {
    return <Search size={13} />;
  }
  if (item.metaType === 'subagent') {
    return <Bot size={13} />;
  }
  return <FileText size={13} />;
}

function activityDetailText(activity) {
  const label = String(activity?.label || '').trim();
  const detail = String(activity?.command || activity?.detail || activity?.error || '').trim();
  if (!detail || detail === label || isGenericActivityLabel(detail)) {
    return '';
  }
  return detail;
}

function fileChangeText(step) {
  return Array.isArray(step?.fileChanges)
    ? step.fileChanges.map((change) => `${change.kind || 'update'} ${change.path || ''}`.trim()).filter(Boolean).join('\n')
    : '';
}

function buildActivityFileSummary(steps) {
  const files = new Map();
  for (const step of steps || []) {
    if (!Array.isArray(step?.fileChanges)) {
      continue;
    }
    for (const change of step.fileChanges) {
      const rawPath = String(change?.path || '').trim();
      if (!rawPath) {
        continue;
      }
      const existing = files.get(rawPath) || {
        path: rawPath,
        label: compactActivityPath(rawPath),
        additions: 0,
        deletions: 0,
        kind: change?.kind || 'update',
        diffs: []
      };
      const diff = change?.unifiedDiff || change?.unified_diff || change?.diff || '';
      const stats = diffStatsFromUnifiedDiff(diff);
      existing.additions += Number(change?.additions) || stats.additions;
      existing.deletions += Number(change?.deletions) || stats.deletions;
      existing.kind = change?.kind || existing.kind;
      if (diff && !existing.diffs.includes(diff)) {
        existing.diffs.push(diff);
      }
      files.set(rawPath, existing);
    }
  }
  const items = [...files.values()];
  if (!items.length) {
    return null;
  }
  return {
    files: items,
    additions: items.reduce((total, item) => total + item.additions, 0),
    deletions: items.reduce((total, item) => total + item.deletions, 0)
  };
}

function diffStatsFromUnifiedDiff(unifiedDiff = '') {
  let additions = 0;
  let deletions = 0;
  for (const line of String(unifiedDiff || '').split(/\r?\n/)) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    if (line.startsWith('+')) {
      additions += 1;
    } else if (line.startsWith('-')) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}

function compactActivityPath(value) {
  const normalized = String(value || '').replaceAll('\\', '/');
  const marker = '/CodexMobile/';
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex >= 0) {
    return normalized.slice(markerIndex + marker.length);
  }
  if (normalized.startsWith('/')) {
    const parts = normalized.split('/').filter(Boolean);
    return parts.length > 3 ? parts.slice(-3).join('/') : parts.join('/');
  }
  return normalized;
}

function parseUnifiedDiffLines(unifiedDiff = '') {
  const rows = [];
  let oldLine = null;
  let newLine = null;
  for (const rawLine of String(unifiedDiff || '').split(/\r?\n/)) {
    const hunk = rawLine.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)$/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      rows.push({ type: 'hunk', oldLine: '', newLine: '', text: rawLine });
      continue;
    }
    if (/^(diff --git|index |--- |\+\+\+ )/.test(rawLine)) {
      continue;
    }
    if (rawLine.startsWith('\\ No newline')) {
      rows.push({ type: 'meta', oldLine: '', newLine: '', text: rawLine });
      continue;
    }
    if (oldLine === null || newLine === null) {
      if (rawLine.trim()) {
        rows.push({ type: 'meta', oldLine: '', newLine: '', text: rawLine });
      }
      continue;
    }
    if (rawLine.startsWith('+')) {
      rows.push({ type: 'add', oldLine: '', newLine: newLine++, text: rawLine.slice(1) });
    } else if (rawLine.startsWith('-')) {
      rows.push({ type: 'del', oldLine: oldLine++, newLine: '', text: rawLine.slice(1) });
    } else {
      rows.push({ type: 'ctx', oldLine: oldLine++, newLine: newLine++, text: rawLine.startsWith(' ') ? rawLine.slice(1) : rawLine });
    }
  }
  return rows;
}

function ActivityDiffView({ diffs }) {
  const rows = (diffs || []).flatMap((diff, diffIndex) => {
    const parsed = parseUnifiedDiffLines(diff);
    if (diffIndex === 0) {
      return parsed;
    }
    return [{ type: 'gap', oldLine: '', newLine: '', text: '' }, ...parsed];
  });

  if (!rows.length) {
    return null;
  }
  return (
    <div className="activity-diff-shell">
      <div className="activity-diff-view">
        {rows.map((row, index) => (
          <div key={`${index}-${row.oldLine}-${row.newLine}`} className={`activity-diff-row is-${row.type}`}>
            <span className="activity-diff-num">{row.oldLine}</span>
            <span className="activity-diff-num">{row.newLine}</span>
            <code>{row.text || ' '}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityFileSummary({ summary }) {
  const { t } = useI18n();
  return (
    <div className="activity-file-summary">
      <div className="activity-file-summary-head">
        <span>{t('activity.filesChanged', { count: summary.files.length })}</span>
        {summary.additions ? <strong className="is-added">+{summary.additions}</strong> : null}
        {summary.deletions ? <strong className="is-deleted">-{summary.deletions}</strong> : null}
      </div>
      <div className="activity-file-list">
        {summary.files.map((file) => (
          <details key={file.path} className="activity-file-item">
            <summary>
              <span>{file.label}</span>
              {file.additions ? <strong className="is-added">+{file.additions}</strong> : null}
              {file.deletions ? <strong className="is-deleted">-{file.deletions}</strong> : null}
            </summary>
            <ActivityDiffView diffs={file.diffs} />
          </details>
        ))}
      </div>
    </div>
  );
}

function DiffMessage({ message }) {
  const fileChanges = normalizeFileChangesForView(message.fileChanges || []);
  const summary = buildActivityFileSummary([{ fileChanges }]);
  if (!summary) {
    return null;
  }
  return (
    <div className="message-row is-assistant">
      <div className="message-stack">
        <div className="message-bubble diff-message-bubble">
          <ActivityFileSummary summary={summary} />
          {message.timestamp ? <time>{formatTime(message.timestamp)}</time> : null}
        </div>
      </div>
    </div>
  );
}

function classifyCommandIntent(value, assumeCommand = false) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }
  const lower = text.toLowerCase();
  if (/\b(apply_patch|perl\s+-0pi|python\b.*\bwrite_text|node\b.*\bwritefile|cat\s+>)/.test(lower)) {
    return 'edit';
  }
  if (/\b(rg|grep|findstr|select-string)\b/.test(lower)) {
    return 'search';
  }
  if (/\b(sed|cat|nl|head|tail|less|more|awk|jq|wc|ls|find|fd|tree)\b/.test(lower)) {
    return 'read';
  }
  if (/\bgit\s+(status|diff|show|log|ls-files|branch|rev-parse)\b/.test(lower)) {
    return 'inspect';
  }
  if (/\b(lsof|curl|ps|pwd|date|which|node\s+--check|tsc|eslint|biome|prettier|npm\s+run\s+build|npm\s+run\s+smoke|npm\s+run\s+test|pnpm|yarn|bun|pytest|vitest|jest|kill|sleep|npm\s+run\s+start|npm\s+run\s+start:bg|node\s+)/.test(lower)) {
    return 'command';
  }
  return assumeCommand ? 'command' : '';
}

function commandActivityLabel(kind) {
  if (kind === 'search') {
    return '搜索代码';
  }
  if (kind === 'read' || kind === 'inspect') {
    return '探索文件';
  }
  if (kind === 'edit') {
    return '编辑文件';
  }
  return '运行命令';
}

function browserActivityLabel(toolName) {
  const text = String(toolName || '').toLowerCase();
  if (/screenshot/.test(text)) {
    return '截取浏览器';
  }
  if (/navigate/.test(text)) {
    return '打开页面';
  }
  if (/click|type|press/.test(text)) {
    return '操作页面';
  }
  return '操作浏览器';
}

function extractFileRefs(value) {
  const refs = new Set();
  const text = String(value || '');
  const pattern = /(?:^|[\s"'`(])((?:\.{1,2}|~|\/)?[\w@.+\-~\u4e00-\u9fff]+(?:\/[\w@.+\- \u4e00-\u9fff]+)+\.(?:jsx?|tsx?|css|scss|json|md|mjs|cjs|html|yml|yaml|toml|py|sh|sql|swift|kt|java|go|rs|rb|php|txt|log)|[\w@.+\-~\u4e00-\u9fff]+\.(?:jsx?|tsx?|css|scss|json|md|mjs|cjs|html|yml|yaml|toml|py|sh|sql|swift|kt|java|go|rs|rb|php|txt|log))/g;
  for (const match of text.matchAll(pattern)) {
    const candidate = match[1]?.replace(/[,:;.)\]]+$/g, '');
    if (candidate && !candidate.startsWith('http')) {
      refs.add(candidate);
    }
  }
  return refs;
}

function GeneratedImage({ part, onPreviewImage, compact = false }) {
  const { t } = useI18n();
  const [loadState, setLoadState] = useState('loading');
  const [retryKey, setRetryKey] = useState(0);
  const resolved = useResolvedImageSource(part.url, retryKey);
  const src = resolved.src;

  useEffect(() => {
    setLoadState(resolved.error ? 'failed' : resolved.cached ? 'loaded' : 'loading');
  }, [resolved.cached, resolved.error, src]);

  function retry(event) {
    event.stopPropagation();
    setLoadState('loading');
    setRetryKey(Date.now());
  }

  return (
    <button
      type="button"
      className={`message-image-link ${compact ? 'is-thumbnail' : ''} ${loadState === 'failed' ? 'is-failed' : ''}`}
      onClick={() => (loadState === 'failed' ? setRetryKey(Date.now()) : onPreviewImage?.(part))}
      aria-label={t('image.preview')}
    >
      {src ? (
        <img
          className="message-image"
          src={src}
          alt={part.alt}
          loading="eager"
          decoding="async"
          onLoad={() => setLoadState('loaded')}
          onError={() => setLoadState('failed')}
        />
      ) : null}
      {loadState === 'failed' ? (
        <span className="image-error">
          {t('image.loadFailed')}
          <span onClick={retry}>{t('image.retry')}</span>
        </span>
      ) : null}
    </button>
  );
}

function UserImageStrip({ images, onPreviewImage }) {
  const { t } = useI18n();
  if (!images?.length) {
    return null;
  }
  return (
    <div className="message-image-strip" aria-label={t('image.attachments')}>
      {images.map((image, index) => (
        <GeneratedImage
          key={`${image.url}-${index}`}
          part={image}
          onPreviewImage={onPreviewImage}
          compact
        />
      ))}
    </div>
  );
}

function ImagePreviewModal({ image, onClose }) {
  const { t } = useI18n();
  const [loadState, setLoadState] = useState('loading');
  const [retryKey, setRetryKey] = useState(0);
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [isGesturing, setIsGesturing] = useState(false);
  const imageRef = useRef(null);
  const pointersRef = useRef(new Map());
  const gestureRef = useRef(null);
  const lastTapRef = useRef(0);
  const resolved = useResolvedImageSource(image?.url, retryKey);

  const clampScale = useCallback((value) => Math.min(5, Math.max(1, value)), []);
  const normalizeTransform = useCallback((next) => {
    const scale = clampScale(next.scale);
    if (scale === 1) {
      return { scale, x: 0, y: 0 };
    }
    return { scale, x: next.x, y: next.y };
  }, [clampScale]);
  const updateTransform = useCallback((updater) => {
    setTransform((current) => normalizeTransform(typeof updater === 'function' ? updater(current) : updater));
  }, [normalizeTransform]);
  const resetZoom = useCallback(() => {
    pointersRef.current.clear();
    gestureRef.current = null;
    setIsGesturing(false);
    setTransform({ scale: 1, x: 0, y: 0 });
  }, []);

  useEffect(() => {
    setLoadState('loading');
    setRetryKey(0);
    resetZoom();
  }, [image?.url, resetZoom]);

  useEffect(() => {
    setLoadState(resolved.error ? 'failed' : 'loading');
  }, [resolved.error, resolved.src]);

  useEffect(() => {
    return () => {
      pointersRef.current.clear();
    };
  }, []);

  if (!image) {
    return null;
  }

  const src = resolved.src;
  const zoomIn = () => updateTransform((current) => ({ ...current, scale: current.scale + 0.5 }));
  const zoomOut = () => updateTransform((current) => ({ ...current, scale: current.scale - 0.5 }));
  const pointerDistance = (first, second) => Math.hypot(first.x - second.x, first.y - second.y);
  const pointerCenter = (first, second) => ({ x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 });

  function handlePointerDown(event) {
    if (!src || loadState === 'failed') {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const pointer = { x: event.clientX, y: event.clientY };
    pointersRef.current.set(event.pointerId, pointer);
    setIsGesturing(true);
    const pointers = Array.from(pointersRef.current.values());
    if (pointers.length === 2) {
      gestureRef.current = {
        mode: 'pinch',
        startDistance: pointerDistance(pointers[0], pointers[1]),
        startCenter: pointerCenter(pointers[0], pointers[1]),
        startTransform: transform
      };
    } else if (pointers.length === 1) {
      gestureRef.current = {
        mode: 'pan',
        startPointer: pointer,
        startTransform: transform
      };
    }
  }

  function handlePointerMove(event) {
    if (!pointersRef.current.has(event.pointerId)) {
      return;
    }
    const pointer = { x: event.clientX, y: event.clientY };
    pointersRef.current.set(event.pointerId, pointer);
    const pointers = Array.from(pointersRef.current.values());
    const gesture = gestureRef.current;
    if (!gesture) {
      return;
    }
    if (gesture.mode === 'pinch' && pointers.length >= 2) {
      const distance = pointerDistance(pointers[0], pointers[1]);
      const center = pointerCenter(pointers[0], pointers[1]);
      const scale = gesture.startTransform.scale * (distance / Math.max(gesture.startDistance, 1));
      updateTransform({
        scale,
        x: gesture.startTransform.x + (center.x - gesture.startCenter.x),
        y: gesture.startTransform.y + (center.y - gesture.startCenter.y)
      });
      return;
    }
    if (gesture.mode === 'pan' && pointers.length === 1 && gesture.startTransform.scale > 1) {
      updateTransform({
        scale: gesture.startTransform.scale,
        x: gesture.startTransform.x + pointer.x - gesture.startPointer.x,
        y: gesture.startTransform.y + pointer.y - gesture.startPointer.y
      });
    }
  }

  function handlePointerEnd(event) {
    pointersRef.current.delete(event.pointerId);
    const pointers = Array.from(pointersRef.current.values());
    if (pointers.length === 0) {
      gestureRef.current = null;
      setIsGesturing(false);
      return;
    }
    if (pointers.length === 1) {
      gestureRef.current = {
        mode: 'pan',
        startPointer: pointers[0],
        startTransform: transform
      };
    }
  }

  function handleDoubleTap() {
    const now = Date.now();
    if (now - lastTapRef.current < 280) {
      updateTransform((current) => (current.scale > 1 ? { scale: 1, x: 0, y: 0 } : { ...current, scale: 2.5 }));
      lastTapRef.current = 0;
      return;
    }
    lastTapRef.current = now;
  }

  function handleWheel(event) {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.25 : 0.25;
    updateTransform((current) => ({ ...current, scale: current.scale + delta }));
  }

  return (
    <div className="image-lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="lightbox-top">
        <button type="button" className="lightbox-close" onClick={onClose} aria-label={t('image.preview')}>
          <X size={22} />
        </button>
      </div>
      <div
        className={`lightbox-stage ${transform.scale > 1 ? 'is-zoomed' : ''}`}
        onClick={(event) => {
          event.stopPropagation();
          handleDoubleTap();
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onWheel={handleWheel}
      >
        {src ? (
          <img
            ref={imageRef}
            src={src}
            alt={image.alt || t('image.generated')}
            style={{
              transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
              transition: isGesturing ? 'none' : undefined
            }}
            onLoad={() => setLoadState('loaded')}
            onError={() => setLoadState('failed')}
          />
        ) : null}
      </div>
      {loadState !== 'failed' ? (
        <div className="lightbox-zoom-controls" onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={zoomOut} aria-label={t('image.zoomOut')} disabled={transform.scale <= 1}>
            <Minus size={17} />
          </button>
          <button type="button" onClick={resetZoom} aria-label={t('image.resetZoom')} disabled={transform.scale === 1 && transform.x === 0 && transform.y === 0}>
            {Math.round(transform.scale * 100)}%
          </button>
          <button type="button" onClick={zoomIn} aria-label={t('image.zoomIn')} disabled={transform.scale >= 5}>
            <Plus size={17} />
          </button>
        </div>
      ) : null}
      {loadState === 'failed' ? (
        <div className="lightbox-actions" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            onClick={() => {
              setLoadState('loading');
              setRetryKey(Date.now());
            }}
          >
            <RefreshCw size={16} />
            {t('image.reload')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MarkdownContent({ text, onPreviewImage, className = 'message-content' }) {
  const { t } = useI18n();
  const value = String(text || '');

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        skipHtml
        urlTransform={markdownUrlTransform}
        components={{
          a({ node, href, children, ...props }) {
            const safeHref = normalizeInlineHref(href);
            if (!safeHref) {
              return <span {...props}>{children}</span>;
            }
            return (
              <a href={safeHref} target="_blank" rel="noreferrer noopener" {...props}>
                {children}
              </a>
            );
          },
          img({ node, src, alt }) {
            if (!src) {
              return null;
            }
            return <GeneratedImage part={{ type: 'image', url: src, alt: alt || t('image.generated') }} onPreviewImage={onPreviewImage} />;
          },
          table({ node, children, ...props }) {
            return (
              <div className="markdown-table-wrap">
                <table {...props}>{children}</table>
              </div>
            );
          },
          pre({ node, children }) {
            return <>{children}</>;
          },
          code({ node, className, children, ...props }) {
            const language = String(className || '').match(/language-([\w-]+)/)?.[1] || '';
            const isBlock = Boolean(language) || node?.position?.start?.line !== node?.position?.end?.line;
            if (!isBlock) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            return <CodeBlock language={language || 'text'} code={String(children).replace(/\n$/, '')} />;
          }
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}

function MessageContent({ content, onPreviewImage }) {
  const parsed = splitMemoryCitationTail(stripDisplayDirectives(content));
  return (
    <>
      <MarkdownContent text={parsed.text} onPreviewImage={onPreviewImage} />
      {parsed.citation ? <CitationBlock block={parsed.citation} /> : null}
    </>
  );
}

function stripDisplayDirectives(content) {
  return String(content || '')
    .replace(/(^|\n)[^\S\r\n]*::(?:git-[a-z0-9-]+|archive)\{[^\n]*\}[^\S\r\n]*(?=\n|$)/gi, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

function CodeBlock({ language, code }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef(null);

  useEffect(() => () => {
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
  }, []);

  async function handleCopy() {
    const ok = await copyTextToClipboard(code);
    if (!ok) {
      return;
    }
    setCopied(true);
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-head">
        <span>{language}</span>
        <button type="button" onClick={handleCopy} aria-label={t('message.copyCode')}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
      <pre>
        <code className={`language-${language}`}>{code}</code>
      </pre>
    </div>
  );
}

function normalizeInlineHref(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (/^https?:\/\//i.test(raw) || /^mailto:/i.test(raw) || raw.startsWith('/') || raw.startsWith('#')) {
    return raw;
  }
  return `https://${raw}`;
}

function markdownUrlTransform(url, key) {
  const raw = String(url || '').trim();
  if (key === 'src' && /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(raw)) {
    return raw;
  }
  if (key === 'src' && isLocalImageSource(raw)) {
    return raw;
  }
  return defaultUrlTransform(raw);
}

function renderInlineText(text, keyPrefix) {
  const value = String(text || '');
  const pattern = /(`([^`]+)`)|(\*\*([^*]+)\*\*)|(__([^_]+)__)|\[([^\]]+)\]\(((?:https?:\/\/|www\.|mailto:|\/)[^\s)]*)\)|((?:https?:\/\/|www\.)[^\s<>()]+)/gi;
  const nodes = [];
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(value))) {
    if (match.index > lastIndex) {
      blocks.push({ type: 'markdown', value: value.slice(lastIndex, match.index) });
    }

    if (match[2]) {
      nodes.push(<code key={`${keyPrefix}-code-${partIndex++}`}>{match[2]}</code>);
    } else if (match[4] || match[6]) {
      nodes.push(<strong key={`${keyPrefix}-strong-${partIndex++}`}>{match[4] || match[6]}</strong>);
    } else if (match[7] && match[8]) {
      const href = normalizeInlineHref(match[8]);
      nodes.push(
        <a key={`${keyPrefix}-link-${partIndex++}`} href={href} target="_blank" rel="noreferrer noopener">
          {match[7]}
        </a>
      );
    } else if (match[9]) {
      const href = normalizeInlineHref(match[9]);
      nodes.push(
        <a key={`${keyPrefix}-link-${partIndex++}`} href={href} target="_blank" rel="noreferrer noopener">
          {match[9]}
        </a>
      );
    }

    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < value.length) {
    blocks.push({ type: 'markdown', value: value.slice(lastIndex) });
  }
  const expandedBlocks = [];
  for (const block of blocks.length ? blocks : [{ type: 'markdown', value }]) {
    if (block.type !== 'markdown') {
      expandedBlocks.push(block);
      continue;
    }
    expandedBlocks.push(...splitDiffBlocks(block.value));
  }
  return expandedBlocks;
}

function splitDiffBlocks(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let pending = [];
  let index = 0;

  function flushPending() {
    if (pending.length) {
      blocks.push({ type: 'markdown', value: pending.join('\n') });
      pending = [];
    }
  }

  while (index < lines.length) {
    const diffSummary = collectDiffSummary(lines, index);
    if (diffSummary) {
      flushPending();
      blocks.push({ type: 'diff', value: diffSummary.summary });
      index = diffSummary.nextIndex;
      continue;
    }
    pending.push(lines[index]);
    index += 1;
  }

  flushPending();
  return blocks.length ? blocks : [{ type: 'markdown', value: text }];
}

function MarkdownBlock({ content, onPreviewImage }) {
  return (
    <ReactMarkdown
      remarkPlugins={MARKDOWN_PLUGINS}
      components={{
        a: ({ href, children }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
        img: ({ src, alt }) => <MarkdownImage src={src} alt={alt} onPreviewImage={onPreviewImage} />
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function MarkdownLink({ href, children }) {
  const raw = String(href || '').trim();
  if (isLocalFileReference(raw)) {
    return <FileReference path={raw} label={childrenToText(children)} />;
  }
  const normalizedHref = normalizeInlineHref(raw);
  return (
    <a href={normalizedHref} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

function MarkdownImage({ src, alt, onPreviewImage }) {
  const url = String(src || '').trim();
  const label = alt || pathDisplayName(url);
  if (!isPreviewableImageUrl(url)) {
    return <FileReference path={url} label={label} />;
  }
  return <GeneratedImage part={{ alt: label, url }} onPreviewImage={onPreviewImage} />;
}

function FileReference({ path, label }) {
  return (
    <span className="markdown-file-ref">
      <FileText size={14} />
      <span>{label || pathDisplayName(path)}</span>
      <code>{path}</code>
    </span>
  );
}

function CitationBlock({ block }) {
  const parsed = parseMemoryCitation(block);
  if (!parsed.entries.length && !parsed.rolloutIds.length) {
    return <pre className="citation-block">{block}</pre>;
  }
  return (
    <details className="citation-card">
      <summary className="citation-title">
        <span>Memory citations</span>
        <small>
          {parsed.entries.length ? `${parsed.entries.length} entries` : ''}
          {parsed.entries.length && parsed.rolloutIds.length ? ' · ' : ''}
          {parsed.rolloutIds.length ? `${parsed.rolloutIds.length} rollouts` : ''}
        </small>
        <ChevronDown size={15} />
      </summary>
      {parsed.entries.map((entry, index) => (
        <div key={`citation-entry-${index}`} className="citation-entry">
          <strong>{entry.source}</strong>
          {entry.note ? <span>{entry.note}</span> : null}
        </div>
      ))}
      {parsed.rolloutIds.length ? (
        <div className="citation-rollouts">
          {parsed.rolloutIds.map((id) => (
            <code key={id}>{id}</code>
          ))}
        </div>
      ) : null}
    </details>
  );
}

function splitMemoryCitationTail(content) {
  const text = String(content || '');
  const trimmed = text.trimEnd();
  const fullMatch = trimmed.match(/(?:\n|^)\s*<oai-mem-citation>\s*([\s\S]*?)\s*<\/oai-mem-citation>\s*$/);
  if (fullMatch) {
    return {
      text: trimmed.slice(0, fullMatch.index).trimEnd(),
      citation: fullMatch[0].trim()
    };
  }
  const entriesMatch = trimmed.match(/(?:\n|^)\s*<citation_entries>\s*[\s\S]*?<\/citation_entries>\s*(?:\s*<rollout_ids>\s*[\s\S]*?<\/rollout_ids>\s*)?$/);
  if (entriesMatch) {
    return {
      text: trimmed.slice(0, entriesMatch.index).trimEnd(),
      citation: entriesMatch[0].trim()
    };
  }
  const rolloutMatch = trimmed.match(/(?:\n|^)\s*<rollout_ids>\s*[\s\S]*?<\/rollout_ids>\s*$/);
  if (rolloutMatch) {
    return {
      text: trimmed.slice(0, rolloutMatch.index).trimEnd(),
      citation: rolloutMatch[0].trim()
    };
  }
  return { text, citation: '' };
}

function parseMemoryCitation(block) {
  const entriesText = block.match(/<citation_entries>\s*([\s\S]*?)\s*<\/citation_entries>/)?.[1] || '';
  const rolloutText = block.match(/<rollout_ids>\s*([\s\S]*?)\s*<\/rollout_ids>/)?.[1] || '';
  const entries = entriesText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [source, notePart] = line.split('|note=');
      return {
        source: source || line,
        note: notePart ? notePart.replace(/^\[/, '').replace(/\]$/, '') : ''
      };
    });
  const rolloutIds = rolloutText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return { entries, rolloutIds };
}

function collectDiffSummary(lines, startIndex) {
  const header = String(lines[startIndex] || '').trim();
  if (!/^\d+\s+files?\s+changed\b/i.test(header)) {
    return null;
  }
  const files = [];
  let index = startIndex + 1;
  while (index < lines.length && lines[index].trim()) {
    const line = lines[index].trim();
    const match = line.match(/^(.+?)\s+([+-]\d+)\s+([+-]\d+)$/);
    if (!match) {
      break;
    }
    files.push({ path: match[1].trim(), additions: Number(match[2]), deletions: Math.abs(Number(match[3])) });
    index += 1;
  }
  return { summary: { header, files }, nextIndex: index };
}

function parseDiffSummary(output) {
  const lines = String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const changedLine = lines.find((line) => /\bfiles?\s+changed\b/i.test(line));
  if (!changedLine) {
    return null;
  }
  const files = [];
  for (const line of lines) {
    if (line === changedLine) {
      continue;
    }
    const compact = line.match(/^(.+?)\s+([+-]\d+)\s+([+-]\d+)$/);
    if (compact) {
      files.push({ path: compact[1].trim(), additions: Number(compact[2]), deletions: Math.abs(Number(compact[3])) });
      continue;
    }
    const stat = line.match(/^(.+?)\s+\|\s+\d+\s+([+\-]+)$/);
    if (stat) {
      files.push({
        path: stat[1].trim(),
        additions: (stat[2].match(/\+/g) || []).length,
        deletions: (stat[2].match(/-/g) || []).length
      });
    }
  }
  return { header: changedLine, files };
}

function DiffSummaryBlock({ summary }) {
  const { t } = useI18n();
  const headerTotals = String(summary.header || '').match(/\+(\d+)\s+-(\d+)/);
  const fileAdditions = summary.files?.reduce((total, file) => total + Math.max(0, Number(file.additions) || 0), 0) || 0;
  const fileDeletions = summary.files?.reduce((total, file) => total + Math.max(0, Number(file.deletions) || 0), 0) || 0;
  const additions = fileAdditions || Number(headerTotals?.[1]) || 0;
  const deletions = fileDeletions || Number(headerTotals?.[2]) || 0;
  return (
    <div className="diff-card">
      <div className="diff-card-title">
        <strong>{summary.header || t('activity.filesChanged', { count: summary.files?.length || 0 })}</strong>
        <span className="diff-add">+{additions}</span>
        <span className="diff-del">-{deletions}</span>
      </div>
      {summary.files?.length ? (
        <div className="diff-file-list">
          {summary.files.slice(0, 32).map((file, index) => (
            <div key={`${file.path}-${index}`} className="diff-file-row">
              <span>{file.path}</span>
              <em className="diff-add">+{Math.max(0, Number(file.additions) || 0)}</em>
              <em className="diff-del">-{Math.max(0, Number(file.deletions) || 0)}</em>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function truncateText(value, maxLength) {
  const text = String(value || '');
  if (!maxLength || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n...`;
}

function renderInlineWithBreaks(text, keyPrefix) {
  return String(text || '')
    .split('\n')
    .flatMap((line, index, lines) => {
      const nodes = renderInlineText(line, `${keyPrefix}-line-${index}`);
      if (index < lines.length - 1) {
        nodes.push(<br key={`${keyPrefix}-br-${index}`} />);
      }
      return nodes;
    });
}

function markdownImageFromLine(line) {
  const match = String(line || '').trim().match(/^!\[([^\]]*)\]\((?:<([^>]*)>|([^)]*?))\)$/);
  if (!match) {
    return null;
  }
  const url = String(match[2] || match[3] || '').trim();
  if (!url) {
    return null;
  }
  return { type: 'image', alt: match[1] || '图片', url };
}

function legacyAttachmentImageFromLine(line) {
  const match = String(line || '').trim().match(/^[-*]\s*图片[:：]\s*(.*?)\s*\((.+)\)\s*$/);
  if (!match) {
    return null;
  }
  const url = String(match[2] || '').trim();
  if (!isLocalImageSource(url) && !/\.(?:png|jpe?g|webp|gif)(?:[?#].*)?$/i.test(url)) {
    return null;
  }
  return { type: 'image', alt: match[1] || '图片', url };
}

function markdownImageDestination(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (/[\s<>()]/.test(raw)) {
    return `<${raw.replace(/>/g, '%3E')}>`;
  }
  return raw;
}

function markdownImageAlt(value) {
  return String(value || '图片').replace(/[\[\]\n\r]/g, '').trim() || '图片';
}

function contentWithAttachmentPreviews(content, attachments = []) {
  const imageLines = (Array.isArray(attachments) ? attachments : [])
    .filter((attachment) => attachment?.kind === 'image' && attachment.path)
    .map((attachment) => `![${markdownImageAlt(attachment.name)}](${markdownImageDestination(attachment.path)})`)
    .filter(Boolean);
  return [content, imageLines.join('\n')].filter(Boolean).join('\n\n');
}

function splitMessageImages(content) {
  const textLines = [];
  const images = [];
  const seenImages = new Set();
  for (const line of String(content || '').replace(/\r\n?/g, '\n').split('\n')) {
    const image = markdownImageFromLine(line) || legacyAttachmentImageFromLine(line);
    if (image) {
      const key = image.url || line;
      if (!seenImages.has(key)) {
        seenImages.add(key);
        images.push(image);
      }
    } else {
      textLines.push(line);
    }
  }
  return {
    text: textLines.join('\n').replace(/\n*附件路径[:：]\s*$/g, '').replace(/\n{3,}/g, '\n\n').trim(),
    images
  };
}

function isListLine(line) {
  return /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line);
}

function isBlockStarter(line, nextLine) {
  return (
    /^```/.test(line) ||
    /^#{1,6}\s+/.test(line) ||
    /^>\s?/.test(line) ||
    isListLine(line) ||
    Boolean(markdownImageFromLine(line)) ||
    (line.includes('|') && isTableSeparator(nextLine || ''))
  );
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(String(line || ''));
}

function splitTableRow(line) {
  return String(line || '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function renderMarkdownBlocks(content, onPreviewImage) {
  const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```([^\s`]*)?.*$/);
    if (fence) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(
        <pre key={`code-${blocks.length}`}>
          <code className={fence[1] ? `language-${fence[1]}` : undefined}>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    const image = markdownImageFromLine(line);
    if (image) {
      blocks.push(<GeneratedImage key={`image-${blocks.length}-${image.url}`} part={image} onPreviewImage={onPreviewImage} />);
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 2, 6);
      const HeadingTag = `h${level}`;
      blocks.push(<HeadingTag key={`heading-${blocks.length}`}>{renderInlineWithBreaks(heading[2], `heading-${blocks.length}`)}</HeadingTag>);
      index += 1;
      continue;
    }

    if (line.includes('|') && isTableSeparator(lines[index + 1] || '')) {
      const headers = splitTableRow(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push(
        <div className="markdown-table-wrap" key={`table-${blocks.length}`}>
          <table>
            <thead>
              <tr>
                {headers.map((cell, cellIndex) => (
                  <th key={`head-${cellIndex}`}>{renderInlineWithBreaks(cell, `table-${blocks.length}-head-${cellIndex}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {headers.map((_, cellIndex) => (
                    <td key={`cell-${rowIndex}-${cellIndex}`}>
                      {renderInlineWithBreaks(row[cellIndex] || '', `table-${blocks.length}-cell-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push(<blockquote key={`quote-${blocks.length}`}>{renderInlineWithBreaks(quoteLines.join('\n'), `quote-${blocks.length}`)}</blockquote>);
      continue;
    }

    if (isListLine(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const ListTag = ordered ? 'ol' : 'ul';
      const items = [];
      while (index < lines.length && isListLine(lines[index]) && /^\s*\d+[.)]\s+/.test(lines[index]) === ordered) {
        items.push(lines[index].replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, ''));
        index += 1;
      }
      blocks.push(
        <ListTag key={`list-${blocks.length}`}>
          {items.map((item, itemIndex) => (
            <li key={`item-${itemIndex}`}>{renderInlineWithBreaks(item, `list-${blocks.length}-item-${itemIndex}`)}</li>
          ))}
        </ListTag>
      );
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStarter(lines[index], lines[index + 1])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(<p key={`paragraph-${blocks.length}`}>{renderInlineWithBreaks(paragraph.join('\n'), `paragraph-${blocks.length}`)}</p>);
  }

  return blocks.length ? blocks : null;
}

function ChatMessage({ message, now, onPreviewImage, onDeleteMessage }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef(null);

  useEffect(() => () => {
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
  }, []);

  if (message.role === 'activity') {
    return <ActivityMessage message={message} now={now} />;
  }
  if (message.role === 'diff') {
    return <DiffMessage message={message} />;
  }
  const isUser = message.role === 'user';
  const canAct = message.role === 'user' || message.role === 'assistant';
  const userMedia = isUser ? splitMessageImages(message.content) : { text: message.content, images: [] };
  const visibleContent = isUser ? userMedia.text : message.content;

  async function handleCopy() {
    const copiedText = await copyTextToClipboard(message.content);
    if (!copiedText) {
      window.alert(t('message.copyFailed'));
      return;
    }
    setCopied(true);
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={`message-row ${isUser ? 'is-user' : 'is-assistant'}`}>
      <div className="message-stack">
        {isUser ? <UserImageStrip images={userMedia.images} onPreviewImage={onPreviewImage} /> : null}
        {visibleContent ? (
          <div className="message-bubble">
            <MessageContent content={visibleContent} onPreviewImage={onPreviewImage} />
            {message.timestamp ? <time>{formatTime(message.timestamp)}</time> : null}
          </div>
        ) : null}
        {canAct ? (
          <div className="message-actions" aria-label={t('message.actions')}>
            <button type="button" className="message-action" onClick={handleCopy}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied ? t('common.copied') : t('common.copy')}</span>
            </button>
            <button type="button" className="message-action is-delete" onClick={() => onDeleteMessage?.(message)}>
              <Trash2 size={13} />
              <span>{t('common.delete')}</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ChatPane({ messages, selectedSession, running, now, onPreviewImage, onDeleteMessage }) {
  const { t } = useI18n();
  const paneRef = useRef(null);
  const contentRef = useRef(null);
  const bottomPinnedRef = useRef(true);
  const pendingInitialScrollSessionRef = useRef(null);
  const [showScrollLatest, setShowScrollLatest] = useState(false);
  const hasMessages = messages.length > 0;
  const sessionId = selectedSession?.id || '';

  const scrollToBottom = useCallback((behavior = 'auto') => {
    const pane = paneRef.current;
    if (!pane) {
      return;
    }
    pane.scrollTo({ top: pane.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) {
      return undefined;
    }

    function updatePinnedState() {
      const pinned = isNearChatBottom(pane);
      bottomPinnedRef.current = pinned;
      setShowScrollLatest(!pinned);
    }

    updatePinnedState();
    pane.addEventListener('scroll', updatePinnedState, { passive: true });
    return () => pane.removeEventListener('scroll', updatePinnedState);
  }, [hasMessages]);

  useEffect(() => {
    const force = Boolean(hasMessages && sessionId && pendingInitialScrollSessionRef.current === sessionId);
    if (!shouldFollowChatOutput({ pinnedToBottom: bottomPinnedRef.current, running, force })) {
      return undefined;
    }
    const frame = requestAnimationFrame(() => {
      scrollToBottom('auto');
      setShowScrollLatest(false);
      if (force) {
        pendingInitialScrollSessionRef.current = null;
        bottomPinnedRef.current = true;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, running, scrollToBottom, hasMessages, sessionId]);

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      if (shouldFollowChatOutput({ pinnedToBottom: bottomPinnedRef.current, running })) {
        scrollToBottom('auto');
      }
    });
    observer.observe(contentRef.current || pane);
    return () => observer.disconnect();
  }, [running, scrollToBottom]);

  useEffect(() => {
    pendingInitialScrollSessionRef.current = selectedSession?.id || null;
    bottomPinnedRef.current = true;
    setShowScrollLatest(false);
    const frame = requestAnimationFrame(() => scrollToBottom('auto'));
    return () => cancelAnimationFrame(frame);
  }, [selectedSession?.id, scrollToBottom]);

  if (!messages.length) {
    return (
      <section className="chat-pane empty-chat">
        <div className="empty-orbit">
          <ShieldCheck size={30} />
        </div>
        <h2>{selectedSession ? selectedSession.title : t('chat.emptyTitle')}</h2>
        <p>{t('chat.emptyBody')}</p>
      </section>
    );
  }

  return (
    <section className="chat-pane" ref={paneRef}>
      <div className="chat-content" ref={contentRef}>
        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            now={now}
            onPreviewImage={onPreviewImage}
            onDeleteMessage={onDeleteMessage}
          />
        ))}
      </div>
      {showScrollLatest ? (
        <button
          type="button"
          className="scroll-latest-button"
          onClick={() => {
            scrollToBottom('smooth');
            bottomPinnedRef.current = true;
            setShowScrollLatest(false);
          }}
          aria-label={t('message.backToLatest')}
        >
          <ArrowDown size={16} />
        </button>
      ) : null}
    </section>
  );
}

function VoiceDialogPanel({
  open,
  state,
  error,
  transcript,
  assistantText,
  handoffDraft,
  onHandoffDraftChange,
  onHandoffSubmit,
  onHandoffContinue,
  onHandoffCancel,
  onStart,
  onStop,
  onClose
}) {
  const { t } = useI18n();
  if (!open) {
    return null;
  }

  const listening = state === 'listening';
  const confirmingHandoff = state === 'handoff';
  const busy = ['transcribing', 'sending', 'waiting', 'speaking', 'summarizing'].includes(state);
  const statusIcon = state === 'speaking'
    ? <Volume2 size={28} />
    : busy
      ? <Loader2 className="spin" size={28} />
      : <Mic size={28} />;

  return (
    <div className="voice-dialog-backdrop">
      <section className="voice-dialog-panel" role="dialog" aria-modal="true" aria-label={t('voice.title')}>
        <div className="voice-dialog-header">
          <span>
            <Headphones size={17} />
            {t('voice.title')}
          </span>
          <button type="button" onClick={onClose} aria-label={t('voice.close')}>
            <X size={18} />
          </button>
        </div>
        <div className={`voice-dialog-orb is-${state}`}>
          {statusIcon}
        </div>
        <div className={`voice-dialog-status ${error ? 'is-error' : ''}`}>
          {error || voiceDialogStatusLabel(state, t)}
        </div>
        {transcript ? <p className="voice-dialog-line is-user">{transcript}</p> : null}
        {assistantText ? <p className="voice-dialog-line is-assistant">{assistantText}</p> : null}
        {confirmingHandoff ? (
          <div className="voice-dialog-handoff">
            <textarea
              value={handoffDraft}
              onChange={(event) => onHandoffDraftChange(event.target.value)}
              rows={8}
              aria-label={t('voice.taskLabel')}
            />
            <div className="voice-dialog-actions voice-dialog-handoff-actions">
              <button type="button" className="voice-dialog-secondary" onClick={onHandoffContinue}>
                {t('voice.continue')}
              </button>
              <button type="button" className="voice-dialog-secondary" onClick={onHandoffCancel}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="voice-dialog-primary"
                onClick={onHandoffSubmit}
                disabled={!String(handoffDraft || '').trim()}
              >
                {t('voice.submit')}
              </button>
            </div>
          </div>
        ) : (
          <div className="voice-dialog-actions">
          <button
            type="button"
            className={`voice-dialog-primary ${listening ? 'is-listening' : ''}`}
            onClick={listening ? onStop : onStart}
            disabled={busy}
          >
            {listening ? t('voice.stop') : t('voice.start')}
          </button>
          <button type="button" className="voice-dialog-secondary" onClick={onClose}>
            {t('voice.end')}
          </button>
          </div>
        )}
      </section>
    </div>
  );
}

function ContextStatusDetails({ contextStatus }) {
  const { t } = useI18n();
  const context = normalizeContextStatus(contextStatus);
  const usedPercent = numberOrNull(context.percent);
  const remainingPercent = usedPercent === null ? null : Math.max(0, Math.round((100 - usedPercent) * 10) / 10);
  const inputTokens = context.inputTokens;
  const contextWindow = context.contextWindow;
  const compact = context.autoCompact || {};
  const compactText = compact.detected
    ? t('context.compacted')
    : t('context.autoCompact');

  return (
    <>
      <div className="context-popover-title">{t('context.title')}</div>
      <div>
        {usedPercent !== null && remainingPercent !== null
          ? t('context.used', { used: usedPercent, remaining: remainingPercent })
          : t('context.syncing')}
      </div>
      <div>
        {t('context.tokens', { input: formatTokenCount(inputTokens), total: formatTokenCount(contextWindow) })}
      </div>
      <div>{compactText}</div>
    </>
  );
}

function ContextStatusButton({ contextStatus, open, onToggle }) {
  const { t } = useI18n();
  const context = normalizeContextStatus(contextStatus);
  const usedPercent = numberOrNull(context.percent);
  const inputTokens = context.inputTokens;
  const contextWindow = context.contextWindow;
  const compact = context.autoCompact || {};
  const hasWindow = Boolean(inputTokens && contextWindow);

  return (
    <div className="context-status-wrap">
      <button
        type="button"
        className={`context-status-button ${compact.detected ? 'is-compacted' : ''} ${hasWindow ? 'has-window' : ''}`}
        onClick={onToggle}
        aria-label={t('context.view')}
        aria-expanded={open}
      >
        <span className="context-status-dot" aria-hidden="true" />
        <span>{usedPercent !== null ? `${Math.round(usedPercent)}%` : '--'}</span>
      </button>
    </div>
  );
}

function ToastStack({ toasts, onDismiss }) {
  const { t, ui } = useI18n();
  if (!toasts.length) {
    return null;
  }
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast-item is-${toast.level || 'info'}`}>
          <span className="toast-dot" />
          <span>
            <strong>{ui(toast.title)}</strong>
            {toast.body ? <small>{ui(toast.body)}</small> : null}
          </span>
          <button type="button" onClick={() => onDismiss(toast.id)} aria-label={t('common.close')}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function ConnectionRecoveryCard({ state, onRetry, onSync, onPair, onStatus }) {
  const { t, ui } = useI18n();
  if (!state) {
    return null;
  }

  function runAction(action) {
    if (action === 'pair') {
      onPair?.();
    } else if (action === 'sync') {
      onSync?.();
    } else if (action === 'status') {
      onStatus?.();
    } else {
      onRetry?.();
    }
  }

  return (
    <section className={`connection-recovery-card is-${state.state}`} aria-label={t('connection.recovery')}>
      <span className="connection-recovery-dot" />
      <span className="connection-recovery-main">
        <strong>{ui(state.title)}</strong>
        <small>{ui(state.detail)}</small>
      </span>
      <button type="button" onClick={() => runAction(state.primaryAction)}>
        {ui(state.primaryLabel)}
      </button>
      {state.secondaryAction ? (
        <button type="button" onClick={() => runAction(state.secondaryAction)}>
          {ui(state.secondaryLabel)}
        </button>
      ) : null}
    </section>
  );
}

function composerConnectionStatus(connectionState, t = DEFAULT_I18N.t) {
  if (connectionState === 'connected') {
    return { label: t('composer.online'), className: 'is-online' };
  }
  if (connectionState === 'connecting') {
    return { label: t('composer.connecting'), className: 'is-connecting' };
  }
  return { label: t('composer.offline'), className: 'is-offline' };
}

function VoiceWaveIcon() {
  return (
    <span className="voice-wave-icon" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

function Composer({
  input,
  setInput,
  selectedProject,
  selectedSession,
  onSubmit,
  running,
  onAbort,
  models,
  selectedModel,
  onSelectModel,
  selectedReasoningEffort,
  onSelectReasoningEffort,
  skills,
  selectedSkillPaths,
  onToggleSkill,
  onSelectSkill,
  onClearSkills,
  permissionMode,
  onSelectPermission,
  runMode,
  effectiveRunMode,
  canSelectRunMode,
  onSelectRunMode,
  attachments,
  onUploadFiles,
  onRemoveAttachment,
  fileMentions,
  onAddFileMention,
  onRemoveFileMention,
  uploading,
  contextStatus,
  runStatus,
  desktopBridge,
  queueDrafts,
  onRestoreQueueDraft,
  onRemoveQueueDraft,
  onSteerQueueDraft,
  connectionState,
  voiceState,
  voiceError,
  voiceTranscription,
  onVoiceTranscribe
}) {
  const { t, ui } = useI18n();
  const composerWrapRef = useRef(null);
  const textareaRef = useRef(null);
  const imageInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const [openMenu, setOpenMenu] = useState(null);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [skillFilter, setSkillFilter] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const [dismissedTokenKey, setDismissedTokenKey] = useState('');
  const [fileSearch, setFileSearch] = useState({ query: '', loading: false, results: [] });
  const selectedFileMentions = Array.isArray(fileMentions) ? fileMentions : [];
  const modelList = models?.length ? models : [{ value: selectedModel || 'gpt-5.5', label: selectedModel || 'gpt-5.5' }];
  const selectedModelLabel = modelList.find((model) => model.value === selectedModel)?.label || selectedModel || 'gpt-5.5';
  const selectedModelTriggerLabel = `${shortModelName(selectedModelLabel)} ${reasoningLabel(selectedReasoningEffort, t)}`;
  const displayRunMode = effectiveRunMode || runMode;
  const selectedPermission = PERMISSION_OPTIONS.find((option) => option.value === permissionMode) || PERMISSION_OPTIONS[0];
  const skillList = Array.isArray(skills) ? skills : [];
  const selectedSkillSet = new Set(Array.isArray(selectedSkillPaths) ? selectedSkillPaths : []);
  const selectedSkills = skillList.filter((skill) => selectedSkillSet.has(skill.path));
  const composerToken = useMemo(
    () => detectComposerToken(input, cursorPosition || input.length),
    [input, cursorPosition]
  );
  const composerTokenKey = composerToken
    ? `${composerToken.type}:${composerToken.start}:${composerToken.end}:${composerToken.query}`
    : '';
  const tokenSkillMatches = composerToken?.type === 'skill'
    ? skillList
      .filter((skill) => {
        const query = composerToken.query.trim().toLowerCase();
        if (!query) {
          return true;
        }
        return [skill.label, skill.name, skill.description, skill.path]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));
      })
      .slice(0, 12)
    : [];
  const tokenPanelOpen = !openMenu && composerToken && composerTokenKey !== dismissedTokenKey && (
    (composerToken.type === 'skill') ||
    (composerToken.type === 'file')
  );
  const hasInput = input.trim().length > 0 || attachments.length > 0 || selectedFileMentions.length > 0;
  const hasComposerChips = attachments.length > 0 || selectedFileMentions.length > 0 || selectedSkills.length > 0;
  const sendState = composerSendState({
    running,
    hasInput,
    uploading,
    desktopBridge,
    steerable: runStatus?.steerable !== false,
    sessionIsDraft: isDraftSession(selectedSession)
  });
  const stopMode = sendState.mode === 'abort';
  const runningInputMode = running && hasInput;
  const sendLabel = ui(sendState.label);
  const filteredSkills = skillList.filter((skill) => {
    const query = skillFilter.trim().toLowerCase();
    if (!query) {
      return true;
    }
    return [skill.label, skill.name, skill.description, skill.path]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
  const connection = composerConnectionStatus(connectionState, t);
  const voiceListening = voiceState === 'listening';
  const voiceProcessing = ['transcribing', 'sending'].includes(voiceState);
  const voiceFailed = voiceState === 'error' && Boolean(voiceError);
  const voiceAvailable = voiceTranscription?.configured !== false;
  const voiceLabel = voiceListening
    ? t('voice.stopTranscribe')
    : voiceProcessing
      ? t('voice.processing')
      : t('voice.transcribe');

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const minHeight = 34;
    const maxHeight = 96;
    textarea.style.height = 'auto';
    const nextHeight = input.trim()
      ? Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)
      : minHeight;
    textarea.style.height = `${nextHeight}px`;
  }, [input]);

  useEffect(() => {
    if (!openMenu) {
      return undefined;
    }
    function closeMenu() {
      setOpenMenu(null);
      setMenuAnchor(null);
    }
    function handlePointerDown(event) {
      if (composerWrapRef.current?.contains(event.target)) {
        return;
      }
      closeMenu();
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        closeMenu();
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('orientationchange', closeMenu);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('orientationchange', closeMenu);
    };
  }, [openMenu]);

  useEffect(() => {
    if (!tokenPanelOpen || !composerTokenKey) {
      return undefined;
    }
    function dismissTokenPanel() {
      setDismissedTokenKey(composerTokenKey);
    }
    function handlePointerDown(event) {
      if (composerWrapRef.current?.contains(event.target)) {
        return;
      }
      dismissTokenPanel();
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        dismissTokenPanel();
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', dismissTokenPanel);
    window.addEventListener('orientationchange', dismissTokenPanel);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', dismissTokenPanel);
      window.removeEventListener('orientationchange', dismissTokenPanel);
    };
  }, [tokenPanelOpen, composerTokenKey]);

  useEffect(() => {
    if (composerToken?.type !== 'file' || !selectedProject?.id) {
      setFileSearch({ query: '', loading: false, results: [] });
      return undefined;
    }

    const query = composerToken.query || '';
    let cancelled = false;
    setFileSearch((current) => ({ ...current, query, loading: true }));
    const timer = window.setTimeout(() => {
      apiFetch(`/api/files/search?projectId=${encodeURIComponent(selectedProject.id)}&q=${encodeURIComponent(query)}`)
        .then((result) => {
          if (!cancelled) {
            setFileSearch({ query, loading: false, results: Array.isArray(result.files) ? result.files : [] });
          }
        })
        .catch(() => {
          if (!cancelled) {
            setFileSearch({ query, loading: false, results: [] });
          }
        });
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [composerToken?.type, composerToken?.query, selectedProject?.id]);

  function updateCursorFromTextarea() {
    const textarea = textareaRef.current;
    setCursorPosition(textarea?.selectionStart ?? input.length);
  }

  function replaceCurrentToken(replacement) {
    if (!composerToken) {
      return;
    }
    const next = replaceComposerToken(input, composerToken, replacement);
    setInput(next);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const position = Math.min(next.length, composerToken.start + String(replacement || '').length);
      textareaRef.current?.setSelectionRange(position, position);
      setCursorPosition(position);
    });
  }

  function selectTokenSkill(skill) {
    if (skill?.path) {
      onSelectSkill(skill.path);
    }
    replaceCurrentToken('');
    setOpenMenu(null);
  }

  function selectTokenFile(file) {
    if (!file?.path) {
      return;
    }
    onAddFileMention(file);
    replaceCurrentToken(`@${file.relativePath || file.name} `);
    setOpenMenu(null);
  }

  function submit(event) {
    event.preventDefault();
    if (stopMode) {
      onAbort();
      return;
    }
    if (runningInputMode) {
      setOpenMenu((current) => (current === 'send-mode' ? null : 'send-mode'));
      return;
    }
    if (hasInput) {
      onSubmit({ mode: 'start' });
      setOpenMenu(null);
    }
  }

  function menuAnchorFor(name, target) {
    const rect = target?.getBoundingClientRect?.();
    if (!rect) {
      return null;
    }
    const align = name === 'model' || name === 'send-mode' ? 'right' : 'left';
    return {
      name,
      align,
      bottom: Math.max(8, window.innerHeight - rect.top + 6),
      left: Math.max(8, rect.left),
      right: Math.max(8, window.innerWidth - rect.right)
    };
  }

  function menuStyle(name) {
    if (!menuAnchor || menuAnchor.name !== name) {
      return undefined;
    }
    const base = { bottom: `${menuAnchor.bottom}px` };
    return menuAnchor.align === 'right'
      ? { ...base, right: `${menuAnchor.right}px` }
      : { ...base, left: `${menuAnchor.left}px` };
  }

  function toggleMenu(name, event) {
    if (openMenu === name) {
      setOpenMenu(null);
      setMenuAnchor(null);
    } else {
      setOpenMenu(name);
      setMenuAnchor(menuAnchorFor(name, event?.currentTarget));
    }
    if (name !== 'skill') {
      setSkillFilter('');
    }
  }

  function handleFiles(event, kind) {
    const files = Array.from(event.target.files || []);
    if (files.length) {
      onUploadFiles(files, kind);
    }
    event.target.value = '';
    setOpenMenu(null);
  }

  return (
    <form ref={composerWrapRef} className="composer-wrap" onSubmit={submit}>
      <input
        ref={imageInputRef}
        className="file-input"
        type="file"
        accept="image/*"
        multiple
        onChange={(event) => handleFiles(event, 'image')}
      />
      <input
        ref={fileInputRef}
        className="file-input"
        type="file"
        multiple
        onChange={(event) => handleFiles(event, 'file')}
      />
      {openMenu === 'attach' ? (
        <div className="composer-menu attach-menu" style={menuStyle('attach')}>
          <button type="button" onClick={() => imageInputRef.current?.click()}>
            <Image size={17} />
            {t('composer.album')}
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            <FileText size={17} />
            {t('composer.file')}
          </button>
        </div>
      ) : null}
      {openMenu === 'permission' ? (
        <div className="composer-menu permission-menu" style={menuStyle('permission')}>
          {PERMISSION_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`${permissionMode === option.value ? 'is-selected' : ''} ${option.danger ? 'is-danger' : ''}`}
              onClick={() => {
                onSelectPermission(option.value);
                setOpenMenu(null);
              }}
            >
              <PermissionModeIcon value={option.value} size={18} />
              <span>{permissionLabel(option.value, t)}</span>
              {permissionMode === option.value ? <Check className="menu-check" size={17} /> : null}
            </button>
          ))}
        </div>
      ) : null}
      {openMenu === 'run-mode' && canSelectRunMode ? (
        <div className="composer-menu run-mode-menu" style={menuStyle('run-mode')}>
          <div className="menu-section-label">{t('composer.startIn')}</div>
          {RUN_MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={runMode === option.value ? 'is-selected' : ''}
              onClick={() => {
                onSelectRunMode(option.value);
                setOpenMenu(null);
              }}
            >
              <RunModeIcon value={option.value} size={18} />
              <span>{runModeLabel(option.value, t)}</span>
              {runMode === option.value ? <Check className="menu-check" size={17} /> : null}
            </button>
          ))}
        </div>
      ) : null}
      {openMenu === 'skill' ? (
        <div className="composer-menu skill-menu" style={menuStyle('skill')}>
          <div className="skill-search-wrap">
            <Search size={14} />
            <input
              type="search"
              value={skillFilter}
              onChange={(event) => setSkillFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                }
              }}
              placeholder={t('composer.searchSkill')}
              aria-label={t('composer.searchSkill')}
            />
          </div>
          {selectedSkills.length ? (
            <button type="button" className="skill-clear-button" onClick={onClearSkills}>
              <span className="menu-spacer" />
              <span>{t('composer.noSkill')}</span>
            </button>
          ) : null}
          {filteredSkills.length ? (
            filteredSkills.map((skill) => {
              const selected = selectedSkillSet.has(skill.path);
              return (
                <button
                  key={skill.path}
                  type="button"
                  className={`skill-menu-item ${selected ? 'is-selected' : ''}`}
                  onClick={() => onToggleSkill(skill.path)}
                >
                  {selected ? <Check size={16} /> : <span className="menu-spacer" />}
                  <span>
                    <strong>{skill.label || skill.name}</strong>
                    {skill.description ? <small>{skill.description}</small> : null}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="menu-empty">{skillList.length ? t('composer.noSkillMatch') : t('composer.skillsNotLoaded')}</div>
          )}
        </div>
      ) : null}
      {openMenu === 'model' ? (
        <div className="composer-menu model-menu" style={menuStyle('model')}>
          <div className="menu-section-label">{t('composer.model')}</div>
          {modelList.map((model) => (
            <button
              key={model.value}
              type="button"
              className={selectedModel === model.value ? 'is-selected' : ''}
              onClick={() => {
                onSelectModel(model.value);
                setOpenMenu(null);
              }}
            >
              <Bot size={17} />
              <span>{model.label}</span>
              {selectedModel === model.value ? <Check className="menu-check" size={17} /> : null}
            </button>
          ))}
          <div className="menu-divider" />
          <div className="menu-section-label">{t('composer.reasoning')}</div>
          {REASONING_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={selectedReasoningEffort === option.value ? 'is-selected' : ''}
              onClick={() => {
                onSelectReasoningEffort(option.value);
                setOpenMenu(null);
              }}
            >
              <MoreHorizontal size={17} />
              <span>{reasoningLabel(option.value, t)}</span>
              {selectedReasoningEffort === option.value ? <Check className="menu-check" size={17} /> : null}
            </button>
          ))}
        </div>
      ) : null}
      {openMenu === 'context' ? (
        <div className="context-popover" role="status">
          <ContextStatusDetails contextStatus={contextStatus} />
        </div>
      ) : null}
      {tokenPanelOpen ? (
        <div className="composer-menu shortcut-menu" role="listbox">
          {composerToken.type === 'skill' ? (
            tokenSkillMatches.length ? tokenSkillMatches.map((skill) => (
              <button key={skill.path} type="button" onClick={() => selectTokenSkill(skill)}>
                {selectedSkillSet.has(skill.path) ? <Check size={16} /> : <Bot size={16} />}
                <span>
                  <strong>{skill.label || skill.name}</strong>
                  {skill.description ? <small>{skill.description}</small> : null}
                </span>
              </button>
            )) : <div className="menu-empty">{skillList.length ? t('composer.noSkillMatch') : t('composer.skillsNotLoaded')}</div>
          ) : null}
          {composerToken.type === 'file' ? (
            fileSearch.loading ? (
              <div className="menu-empty"><Loader2 className="spin" size={15} /> {t('composer.searchingFiles')}</div>
            ) : fileSearch.results.length ? fileSearch.results.map((file) => (
              <button key={file.path} type="button" onClick={() => selectTokenFile(file)}>
                <FileText size={16} />
                <span>
                  <strong>{file.name}</strong>
                  <small>{file.relativePath}</small>
                </span>
              </button>
            )) : <div className="menu-empty">{t('composer.noFileMatch')}</div>
          ) : null}
        </div>
      ) : null}
      {queueDrafts?.length ? (
        <div className="queued-drafts-panel" aria-label={t('composer.queue')}>
          {queueDrafts.map((draft) => (
            <div key={draft.id} className="queued-draft-row">
              <MessageSquarePlus size={15} />
              <button type="button" className="queued-draft-text" onClick={() => onRestoreQueueDraft(draft.id)}>
                <strong>{draft.text || t('composer.checkAttachments')}</strong>
                <small>{draft.selectedSkills?.length ? t('composer.selectedSkillCount', { count: draft.selectedSkills.length }) : t('composer.queued')}</small>
              </button>
              <div className="queued-draft-actions">
                <button type="button" onClick={() => onSteerQueueDraft(draft.id)} aria-label={t('composer.sendNow')}>
                  <MessageSquare size={14} />
                </button>
                <button type="button" onClick={() => onRemoveQueueDraft(draft.id)} aria-label={t('composer.deleteQueued')}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {runStatus ? (
        <div className="composer-run-status" role="status" aria-live="polite">
          <span className="composer-run-dot" />
          <span className="composer-run-main">
            <strong>{t('composer.codexProcessing')}</strong>
            <small>{ui(runStatus.label)}</small>
          </span>
          {runStatus.duration ? <span className="composer-run-time">{runStatus.duration}</span> : null}
        </div>
      ) : null}
      {!hasInput || !sendState.disabled || sendState.mode !== 'unavailable' ? null : (
        <div className="composer-run-status is-warning" role="status" aria-live="polite">
          <span className="composer-run-dot" />
          <span className="composer-run-main">
            <strong>{t('composer.desktopDisconnected')}</strong>
            <small>{desktopBridge?.reason || t('composer.desktopDisconnectedHint')}</small>
          </span>
        </div>
      )}
      {!hasInput || sendState.mode !== 'create-unavailable' ? null : (
        <div className="composer-run-status is-warning" role="status" aria-live="polite">
          <span className="composer-run-dot" />
          <span className="composer-run-main">
            <strong>{t('composer.createUnavailable')}</strong>
            <small>{desktopBridge?.capabilities?.createThreadReason || t('composer.createUnavailableHint')}</small>
          </span>
        </div>
      )}
      {openMenu === 'send-mode' ? (
        <div className="composer-menu send-mode-menu">
          <button
            type="button"
            disabled={!sendState.canSteer}
            onClick={() => {
              if (!sendState.canSteer) {
                return;
              }
              onSubmit({ mode: 'steer' });
              setOpenMenu(null);
            }}
          >
            <MessageSquare size={16} />
            <span>
              <strong>{t('composer.steer')}</strong>
              <small>{sendState.canSteer ? t('composer.steerHint') : t('composer.steerUnavailable')}</small>
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              onSubmit({ mode: 'queue' });
              setOpenMenu(null);
            }}
          >
            <MessageSquarePlus size={16} />
            <span>
              <strong>{t('composer.queueMessage')}</strong>
              <small>{t('composer.queueHint')}</small>
            </span>
          </button>
          <button
            type="button"
            className="is-danger"
            onClick={() => {
              onSubmit({ mode: 'interrupt' });
              setOpenMenu(null);
            }}
          >
            <Square size={15} />
            <span>
              <strong>{t('composer.interrupt')}</strong>
              <small>{t('composer.interruptHint')}</small>
            </span>
          </button>
        </div>
      ) : null}
      <div className={`composer-connection-status ${connection.className}`} role="status" aria-live="polite">
        <span />
        <strong>{connection.label}</strong>
      </div>
      <div className="composer">
        {hasComposerChips ? (
          <div className="attachment-tray">
            {selectedSkills.map((skill) => (
              <span key={skill.path} className="attachment-chip skill-mention-chip">
                <Bot size={14} />
                <span>{skill.label || skill.name || t('composer.skillGeneric')}</span>
                <button type="button" onClick={() => onToggleSkill(skill.path)} aria-label={t('composer.removeSkill')}>
                  <Trash2 size={13} />
                </button>
              </span>
            ))}
            {attachments.map((attachment) => (
              <span key={attachment.id} className="attachment-chip">
                <Paperclip size={14} />
                <span>{attachment.name}</span>
                <small>{formatBytes(attachment.size)}</small>
                <button type="button" onClick={() => onRemoveAttachment(attachment.id)} aria-label={t('composer.removeAttachment')}>
                  <Trash2 size={13} />
                </button>
              </span>
            ))}
            {selectedFileMentions.map((file) => (
              <span key={file.path} className="attachment-chip file-mention-chip">
                <FileText size={14} />
                <span>{file.relativePath || file.name}</span>
                <button type="button" onClick={() => onRemoveFileMention(file.path)} aria-label={t('composer.removeFileMention')}>
                  <Trash2 size={13} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            setCursorPosition(event.target.selectionStart ?? event.target.value.length);
          }}
          onClick={updateCursorFromTextarea}
          onKeyUp={updateCursorFromTextarea}
          onFocus={() => {
            setOpenMenu(null);
            setMenuAnchor(null);
          }}
          placeholder={t('composer.placeholder')}
        />
        <div className="composer-controls">
          <div className="control-left">
            <button
              type="button"
              className="composer-icon-control"
              aria-label={t('composer.addAttachment')}
              title={t('composer.addAttachment')}
              onClick={(event) => toggleMenu('attach', event)}
              disabled={uploading}
            >
              <Paperclip size={18} />
            </button>
            <button
              type="button"
              className={`composer-icon-control ${openMenu === 'permission' ? 'is-active' : ''} ${selectedPermission?.danger ? 'is-danger' : ''}`}
              onClick={(event) => toggleMenu('permission', event)}
              aria-label={t('composer.permissionMode', { mode: permissionLabel(permissionMode, t) })}
              title={permissionLabel(permissionMode, t)}
            >
              <PermissionModeIcon value={permissionMode} size={18} />
            </button>
            {canSelectRunMode ? (
              <button
                type="button"
                className={`composer-icon-control ${openMenu === 'run-mode' ? 'is-active' : ''}`}
                onClick={(event) => toggleMenu('run-mode', event)}
                disabled={!selectedProject}
                aria-label={t('composer.runMode', { mode: runModeLabel(displayRunMode, t) })}
                title={runModeLabel(displayRunMode, t)}
              >
                <RunModeIcon value={displayRunMode} size={18} />
              </button>
            ) : null}
          </div>
          <div className="control-right">
            <button
              type="button"
              className={`composer-model-control ${openMenu === 'model' ? 'is-active' : ''}`}
              onClick={(event) => toggleMenu('model', event)}
              aria-label={t('composer.modelMode', { model: selectedModelLabel, reasoning: reasoningLabel(selectedReasoningEffort, t) })}
              title={selectedModelTriggerLabel}
            >
              <span>{selectedModelTriggerLabel}</span>
              <ChevronDown size={14} />
            </button>
            {voiceAvailable ? (
              <button
                type="button"
                className={`composer-icon-control voice-control ${voiceListening ? 'is-listening' : ''} ${voiceProcessing ? 'is-processing' : ''} ${voiceFailed ? 'is-error' : ''}`}
                onClick={onVoiceTranscribe}
                disabled={!selectedProject || voiceProcessing}
                aria-label={voiceLabel}
                title={voiceFailed ? voiceError : voiceLabel}
              >
                {voiceListening ? <VoiceWaveIcon /> : voiceProcessing ? <Loader2 className="spin" size={18} /> : <Mic size={18} />}
              </button>
            ) : null}
            <button
              type="submit"
              className={`send-button ${stopMode ? 'is-running' : ''} ${runningInputMode ? 'is-queueing' : ''}`}
              disabled={sendState.disabled}
              aria-label={sendLabel}
              title={sendLabel}
            >
              {stopMode ? <Square size={16} /> : uploading ? <Loader2 className="spin" size={16} /> : <ArrowUp size={19} />}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

export default function App() {
  const [appRoute, setAppRoute] = useState(() => parseAppRoute());
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [contextStatus, setContextStatus] = useState(() => normalizeContextStatus(DEFAULT_STATUS.context));
  const [authenticated, setAuthenticated] = useState(Boolean(getToken()));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState({});
  const [sessionsByProject, setSessionsByProject] = useState({});
  const [loadingProjectId, setLoadingProjectId] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [activityClockNow, setActivityClockNow] = useState(() => Date.now());
  const [completedSessionIds, setCompletedSessionIds] = useState({});
  const [previewImage, setPreviewImage] = useState(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [docsBusy, setDocsBusy] = useState(false);
  const [docsError, setDocsError] = useState('');
  const [quotaSnapshot, setQuotaSnapshot] = useState(null);
  const [gitPanel, setGitPanel] = useState({ open: false, action: 'commit' });
  const [workspacePanel, setWorkspacePanel] = useState({ open: false, tab: 'changes' });
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [fileMentions, setFileMentions] = useState([]);
  const [queueDrafts, setQueueDrafts] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [notificationPermission, setNotificationPermission] = useState(() => browserNotificationPermission());
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => notificationPreferenceEnabled());
  const [uploading, setUploading] = useState(false);
  const [permissionMode, setPermissionMode] = useState(DEFAULT_PERMISSION_MODE);
  const [runMode, setRunModeState] = useState(() => {
    const stored = localStorage.getItem(RUN_MODE_KEY);
    return RUN_MODE_OPTIONS.some((option) => option.value === stored) ? stored : 'local';
  });
  const [selectedModel, setSelectedModel] = useState(DEFAULT_STATUS.model);
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState(() => {
    const defaultVersion = localStorage.getItem('codexmobile.reasoningDefaultVersion');
    if (defaultVersion !== REASONING_DEFAULT_VERSION) {
      localStorage.setItem('codexmobile.reasoningDefaultVersion', REASONING_DEFAULT_VERSION);
      localStorage.setItem('codexmobile.reasoningEffort', DEFAULT_REASONING_EFFORT);
      return DEFAULT_REASONING_EFFORT;
    }
    return localStorage.getItem('codexmobile.reasoningEffort') || DEFAULT_REASONING_EFFORT;
  });
  const [selectedSkillPaths, setSelectedSkillPaths] = useState(() =>
    safeStoredJsonArray(SELECTED_SKILLS_KEY).filter((item) => typeof item === 'string' && item.trim())
  );
  const [runningById, setRunningById] = useState({});
  const [threadRuntimeById, setThreadRuntimeById] = useState({});
  const [languageSetting, setLanguageSetting] = useState(() => storedOption(LANGUAGE_KEY, LOCALE_OPTIONS, 'system'));
  const [themeSetting, setThemeSetting] = useState(() => storedOption(THEME_KEY, THEME_OPTIONS, 'system'));
  const [systemTheme, setSystemTheme] = useState(() => resolvedThemeFromSystem());
  const [systemLocale, setSystemLocale] = useState(() => localeFromNavigator());
  const [syncing, setSyncing] = useState(false);
  const [connectionState, setConnectionState] = useState(() => (getToken() ? 'connecting' : 'disconnected'));
  const [sessionModal, setSessionModal] = useState(null);
  const appRouteRef = useRef(appRoute);
  const wsRef = useRef(null);
  const terminalHandlersRef = useRef(new Map());
  const selectedProjectRef = useRef(null);
  const selectedSessionRef = useRef(null);
  const messagesRef = useRef([]);
  const autoTitleSyncRef = useRef(new Set());
  const runningByIdRef = useRef({});
  const activePollsRef = useRef(new Set());
  const turnRefreshTimersRef = useRef(new Map());
  const sessionLivePollRef = useRef(false);
  const desktopIpcPendingRunsRef = useRef(new Map());
  const voiceDialogRecorderRef = useRef(null);
  const toastTimersRef = useRef(new Map());
  const voiceDialogChunksRef = useRef([]);
  const voiceDialogStreamRef = useRef(null);
  const voiceDialogTimerRef = useRef(null);
  const voiceDialogSilenceFrameRef = useRef(null);
  const voiceDialogAudioContextRef = useRef(null);
  const voiceDialogAudioSourceRef = useRef(null);
  const voiceDialogSpeechStartedRef = useRef(false);
  const voiceDialogLastSoundAtRef = useRef(0);
  const voiceDialogAudioRef = useRef(null);
  const voiceDialogAudioUnlockedRef = useRef(false);
  const voiceDialogAudioUrlRef = useRef('');
  const voiceDialogAwaitingTurnRef = useRef(null);
  const voiceDialogLastSpokenRef = useRef('');
  const locale = languageSetting === 'system' ? systemLocale : languageSetting;
  const theme = themeSetting === 'system' ? systemTheme : themeSetting;
  const i18n = useMemo(() => makeI18n(locale), [locale]);
  const { t } = i18n;
  const voiceDialogAutoListenRef = useRef(false);
  const voiceDialogOpenRef = useRef(false);
  const voiceDialogStateRef = useRef('idle');
  const voiceDialogRealtimeRef = useRef(false);
  const voiceRealtimeSocketRef = useRef(null);
  const voiceRealtimeStreamRef = useRef(null);
  const voiceRealtimeAudioContextRef = useRef(null);
  const voiceRealtimeAudioSourceRef = useRef(null);
  const voiceRealtimeProcessorRef = useRef(null);
  const voiceRealtimePlaybackContextRef = useRef(null);
  const voiceRealtimePlaybackSourcesRef = useRef(new Set());
  const voiceRealtimePlayheadRef = useRef(0);
  const voiceRealtimeAssistantTextRef = useRef('');
  const voiceRealtimeSpeechStartedRef = useRef(false);
  const voiceRealtimeTurnStartedAtRef = useRef(0);
  const voiceRealtimeLastSoundAtRef = useRef(0);
  const voiceRealtimeAwaitingResponseRef = useRef(false);
  const voiceRealtimeBargeInStartedAtRef = useRef(0);
  const voiceRealtimeSuppressAssistantAudioRef = useRef(false);
  const voiceDialogIdeaBufferRef = useRef([]);
  const voiceDialogHandoffDraftRef = useRef('');
  const [voiceDialogOpen, setVoiceDialogOpen] = useState(false);
  const [voiceDialogState, setVoiceDialogState] = useState('idle');
  const [voiceDialogError, setVoiceDialogError] = useState('');
  const [voiceDialogTranscript, setVoiceDialogTranscript] = useState('');
  const [voiceDialogAssistantText, setVoiceDialogAssistantText] = useState('');
  const [voiceDialogHandoffDraft, setVoiceDialogHandoffDraft] = useState('');

  const setRunMode = useCallback((value) => {
    const next = RUN_MODE_OPTIONS.some((option) => option.value === value) ? value : 'local';
    localStorage.setItem(RUN_MODE_KEY, next);
    setRunModeState(next);
  }, []);

  const registerTerminalHandler = useCallback((terminalId, handler) => {
    if (!terminalId || typeof handler !== 'function') {
      return () => {};
    }
    terminalHandlersRef.current.set(terminalId, handler);
    return () => {
      if (terminalHandlersRef.current.get(terminalId) === handler) {
        terminalHandlersRef.current.delete(terminalId);
      }
    };
  }, []);

  const sendTerminalMessage = useCallback((payload) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    const updateViewport = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const viewport = window.visualViewport;
        const height = Math.round(viewport?.height || window.innerHeight || 0);
        const width = Math.round(viewport?.width || window.innerWidth || 0);
        const layoutHeight = Math.round(document.documentElement.clientHeight || window.innerHeight || 0);
        const keyboardOpen = height > 0 && layoutHeight > 0 && layoutHeight - height > 120;
        if (height > 0) {
          root.style.setProperty('--app-height', `${height}px`);
        }
        if (width > 0) {
          root.style.setProperty('--app-width', `${width}px`);
        }
        root.dataset.keyboard = keyboardOpen ? 'open' : 'closed';
        if (window.scrollX || window.scrollY) {
          window.scrollTo(0, 0);
        }
      });
    };

    updateViewport();
    window.visualViewport?.addEventListener('resize', updateViewport);
    window.visualViewport?.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    window.addEventListener('orientationchange', updateViewport);

    return () => {
      cancelAnimationFrame(frame);
      window.visualViewport?.removeEventListener('resize', updateViewport);
      window.visualViewport?.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
      window.removeEventListener('orientationchange', updateViewport);
      root.style.removeProperty('--app-height');
      root.style.removeProperty('--app-width');
      delete root.dataset.keyboard;
    };
  }, []);

  const running = hasRunningKey(runningById, selectedRunKeys(selectedSession));
  const selectedRuntime = selectedRunKeys(selectedSession)
    .map((key) => threadRuntimeById[key])
    .find(Boolean) || null;
  const selectedWorkspaceTarget = useMemo(
    () => workspaceTargetForSelection(selectedProject, selectedSession, selectedRuntime),
    [selectedProject, selectedSession, selectedRuntime]
  );
  const canSelectRunMode = !selectedSession || isDraftSession(selectedSession);
  const effectiveRunMode = canSelectRunMode ? runMode : selectedWorkspaceTarget?.runMode || runMode;
  const hasRunningActivity = useMemo(
    () =>
      messages.some(
        (message) =>
          message.role === 'activity' &&
          (message.status === 'running' || message.status === 'queued')
      ),
    [messages]
  );
  const composerRunStatus = useMemo(
    () => buildComposerRunStatus(messages, running, activityClockNow),
    [messages, running, activityClockNow]
  );

  useEffect(() => {
    loadQueueDrafts(selectedSession).catch(() => null);
  }, [selectedSession?.id]);

  useEffect(() => {
    if (!running && !hasRunningActivity) {
      return undefined;
    }
    setActivityClockNow(Date.now());
    const timer = window.setInterval(() => setActivityClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, hasRunningActivity]);

  function setVoiceDialogMode(next) {
    voiceDialogStateRef.current = next;
    setVoiceDialogState(next);
  }

  function setVoiceDialogHandoffDraftValue(next) {
    const value = String(next || '');
    voiceDialogHandoffDraftRef.current = value;
    setVoiceDialogHandoffDraft(value);
  }

  function clearVoiceDialogTimer() {
    if (voiceDialogTimerRef.current) {
      window.clearTimeout(voiceDialogTimerRef.current);
      voiceDialogTimerRef.current = null;
    }
  }

  function clearVoiceDialogSilenceDetection() {
    if (voiceDialogSilenceFrameRef.current) {
      window.cancelAnimationFrame(voiceDialogSilenceFrameRef.current);
      voiceDialogSilenceFrameRef.current = null;
    }
    voiceDialogAudioSourceRef.current?.disconnect?.();
    voiceDialogAudioSourceRef.current = null;
    const context = voiceDialogAudioContextRef.current;
    voiceDialogAudioContextRef.current = null;
    if (context && context.state !== 'closed') {
      const closePromise = context.close?.();
      closePromise?.catch?.(() => null);
    }
    voiceDialogSpeechStartedRef.current = false;
    voiceDialogLastSoundAtRef.current = 0;
  }

  function stopVoiceDialogStream() {
    clearVoiceDialogSilenceDetection();
    voiceDialogStreamRef.current?.getTracks?.().forEach((track) => track.stop());
    voiceDialogStreamRef.current = null;
  }

  function setupVoiceDialogSilenceDetection(stream, recorder) {
    clearVoiceDialogSilenceDetection();
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }

    try {
      const context = new AudioContextCtor();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      voiceDialogAudioContextRef.current = context;
      voiceDialogAudioSourceRef.current = source;
      voiceDialogSpeechStartedRef.current = false;

      const samples = new Uint8Array(analyser.fftSize);
      const startedAt = performance.now();
      voiceDialogLastSoundAtRef.current = startedAt;

      const tick = (now) => {
        if (!voiceDialogOpenRef.current || recorder.state !== 'recording') {
          return;
        }

        analyser.getByteTimeDomainData(samples);
        let total = 0;
        for (let index = 0; index < samples.length; index += 1) {
          const value = (samples[index] - 128) / 128;
          total += value * value;
        }
        const level = Math.sqrt(total / samples.length);
        if (level >= VOICE_DIALOG_LEVEL_THRESHOLD) {
          voiceDialogSpeechStartedRef.current = true;
          voiceDialogLastSoundAtRef.current = now;
        }

        const heardSpeech = voiceDialogSpeechStartedRef.current;
        const recordingLongEnough = now - startedAt >= VOICE_DIALOG_MIN_RECORDING_MS;
        const silentLongEnough = now - voiceDialogLastSoundAtRef.current >= VOICE_DIALOG_SILENCE_MS;
        if (heardSpeech && recordingLongEnough && silentLongEnough) {
          setVoiceDialogMode('transcribing');
          recorder.stop();
          return;
        }

        voiceDialogSilenceFrameRef.current = window.requestAnimationFrame(tick);
      };

      const resumePromise = context.resume?.();
      resumePromise?.catch?.(() => null);
      voiceDialogSilenceFrameRef.current = window.requestAnimationFrame(tick);
    } catch {
      clearVoiceDialogSilenceDetection();
    }
  }

  function ensureVoiceDialogAudio() {
    if (!voiceDialogAudioRef.current) {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.playsInline = true;
      voiceDialogAudioRef.current = audio;
    }
    return voiceDialogAudioRef.current;
  }

  function unlockVoiceDialogAudio() {
    if (voiceDialogAudioUnlockedRef.current) {
      return;
    }
    try {
      const audio = ensureVoiceDialogAudio();
      audio.muted = true;
      audio.src = VOICE_DIALOG_SILENCE_AUDIO;
      const playPromise = audio.play();
      playPromise
        ?.then?.(() => {
          audio.pause();
          audio.muted = false;
          audio.removeAttribute('src');
          audio.load?.();
          voiceDialogAudioUnlockedRef.current = true;
        })
        ?.catch?.(() => {
          audio.muted = false;
        });
    } catch {
      voiceDialogAudioUnlockedRef.current = false;
    }
  }

  function clearVoiceDialogAudio({ release = false } = {}) {
    const audio = voiceDialogAudioRef.current;
    if (audio) {
      audio.pause();
      audio.onended = null;
      audio.onerror = null;
      audio.removeAttribute('src');
      audio.load?.();
      if (release) {
        voiceDialogAudioRef.current = null;
        voiceDialogAudioUnlockedRef.current = false;
      }
    }
    if (voiceDialogAudioUrlRef.current) {
      URL.revokeObjectURL(voiceDialogAudioUrlRef.current);
      voiceDialogAudioUrlRef.current = '';
    }
    window.speechSynthesis?.cancel?.();
  }

  function stopRealtimePlayback({ release = false } = {}) {
    for (const source of voiceRealtimePlaybackSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    voiceRealtimePlaybackSourcesRef.current.clear();
    const context = voiceRealtimePlaybackContextRef.current;
    voiceRealtimePlayheadRef.current = context?.currentTime || 0;
    if (release && context && context.state !== 'closed') {
      context.close?.().catch?.(() => null);
      voiceRealtimePlaybackContextRef.current = null;
      voiceRealtimePlayheadRef.current = 0;
    }
  }

  function stopRealtimeVoiceDialog({ keepPanel = false } = {}) {
    const socket = voiceRealtimeSocketRef.current;
    voiceRealtimeSocketRef.current = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.send(JSON.stringify({ type: 'close' }));
      } catch {
        // Socket may already be closed.
      }
      try {
        socket.close();
      } catch {
        // Socket may already be closed.
      }
    }

    voiceRealtimeProcessorRef.current?.disconnect?.();
    voiceRealtimeProcessorRef.current = null;
    voiceRealtimeAudioSourceRef.current?.disconnect?.();
    voiceRealtimeAudioSourceRef.current = null;
    voiceRealtimeStreamRef.current?.getTracks?.().forEach((track) => track.stop());
    voiceRealtimeStreamRef.current = null;
    const context = voiceRealtimeAudioContextRef.current;
    voiceRealtimeAudioContextRef.current = null;
    if (context && context.state !== 'closed') {
      context.close?.().catch?.(() => null);
    }
    voiceRealtimeAssistantTextRef.current = '';
    voiceRealtimeSpeechStartedRef.current = false;
    voiceRealtimeTurnStartedAtRef.current = 0;
    voiceRealtimeLastSoundAtRef.current = 0;
    voiceRealtimeAwaitingResponseRef.current = false;
    voiceRealtimeBargeInStartedAtRef.current = 0;
    voiceRealtimeSuppressAssistantAudioRef.current = false;
    stopRealtimePlayback({ release: true });
    if (!keepPanel) {
      voiceDialogRealtimeRef.current = false;
    }
  }

  function playRealtimeAudioDelta(delta) {
    if (!delta) {
      return;
    }
    const samples = pcm16Base64ToFloat(delta);
    if (!samples.length) {
      return;
    }
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }
    let context = voiceRealtimePlaybackContextRef.current;
    if (!context || context.state === 'closed') {
      context = new AudioContextCtor();
      voiceRealtimePlaybackContextRef.current = context;
      voiceRealtimePlayheadRef.current = context.currentTime;
    }
    context.resume?.().catch?.(() => null);
    const outputSampleRate = Number(status.voiceRealtime?.outputSampleRate) || REALTIME_VOICE_SAMPLE_RATE;
    const buffer = context.createBuffer(1, samples.length, outputSampleRate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    voiceRealtimePlaybackSourcesRef.current.add(source);
    source.onended = () => {
      voiceRealtimePlaybackSourcesRef.current.delete(source);
      if (
        voiceDialogOpenRef.current &&
        voiceDialogRealtimeRef.current &&
        voiceRealtimePlaybackSourcesRef.current.size === 0 &&
        voiceDialogStateRef.current === 'speaking'
      ) {
        voiceRealtimeAwaitingResponseRef.current = false;
        setVoiceDialogMode('listening');
      }
    };
    const startAt = Math.max(voiceRealtimePlayheadRef.current, context.currentTime + 0.03);
    source.start(startAt);
    voiceRealtimePlayheadRef.current = startAt + buffer.duration;
  }

  function appendVoiceDialogIdeaTranscript(transcript) {
    const text = String(transcript || '').replace(/\s+/g, ' ').trim();
    if (!text) {
      return;
    }
    const buffer = voiceDialogIdeaBufferRef.current;
    if (buffer[buffer.length - 1] === text) {
      return;
    }
    buffer.push(text);
    if (buffer.length > 30) {
      buffer.splice(0, buffer.length - 30);
    }
  }

  function requestVoiceHandoffSummary(triggerText = '') {
    const socket = voiceRealtimeSocketRef.current;
    const transcripts = voiceDialogIdeaBufferRef.current.filter(Boolean);
    if (!transcripts.length) {
      setVoiceDialogErrorBriefly(t('voice.noContent'));
      return;
    }
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setVoiceDialogErrorBriefly(t('voice.realtimeUnavailable'));
      return;
    }
    stopRealtimePlayback();
    voiceRealtimeSuppressAssistantAudioRef.current = true;
    voiceRealtimeAwaitingResponseRef.current = false;
    voiceRealtimeBargeInStartedAtRef.current = 0;
    voiceRealtimeAssistantTextRef.current = '';
    setVoiceDialogAssistantText('');
    setVoiceDialogHandoffDraftValue('');
    setVoiceDialogError('');
    setVoiceDialogMode('summarizing');
    socket.send(JSON.stringify({
      type: 'voice.handoff.summarize',
      transcripts,
      trigger: triggerText
    }));
  }

  async function startRealtimeMicrophone(socket) {
    if (!window.isSecureContext) {
      throw new Error(t('voice.httpsRequired'));
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(t('voice.recordUnsupported'));
    }
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error(t('voice.realtimeUnsupported'));
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    const context = new AudioContextCtor();
    await context.resume?.().catch?.(() => null);
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(REALTIME_VOICE_BUFFER_SIZE, 1, 1);
    const inputSampleRate = Number(status.voiceRealtime?.inputSampleRate) || REALTIME_VOICE_SAMPLE_RATE;
    const useClientVad = Boolean(status.voiceRealtime?.clientTurnDetection);
    const silenceMs = Number(status.voiceRealtime?.clientVadSilenceMs) || VOICE_DIALOG_SILENCE_MS;
    const commitCurrentTurn = () => {
      if (!voiceRealtimeSpeechStartedRef.current || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      voiceRealtimeSpeechStartedRef.current = false;
      voiceRealtimeBargeInStartedAtRef.current = 0;
      voiceRealtimeAwaitingResponseRef.current = true;
      voiceRealtimeSuppressAssistantAudioRef.current = false;
      setVoiceDialogMode('waiting');
      socket.send(JSON.stringify({ type: 'input_audio.commit' }));
    };
    const beginBargeIn = () => {
      voiceRealtimeSuppressAssistantAudioRef.current = true;
      socket.send(JSON.stringify({ type: 'response.cancel' }));
      socket.send(JSON.stringify({ type: 'input_audio.clear' }));
      stopRealtimePlayback();
      voiceRealtimeAwaitingResponseRef.current = false;
      voiceRealtimeBargeInStartedAtRef.current = 0;
      voiceRealtimeAssistantTextRef.current = '';
      setVoiceDialogAssistantText('');
      setVoiceDialogMode('listening');
    };
    processor.onaudioprocess = (event) => {
      const output = event.outputBuffer.getChannelData(0);
      output.fill(0);
      if (
        !voiceDialogOpenRef.current ||
        !voiceDialogRealtimeRef.current ||
        socket.readyState !== WebSocket.OPEN
      ) {
        return;
      }
      if (voiceDialogStateRef.current === 'summarizing' || voiceDialogStateRef.current === 'handoff') {
        return;
      }
      const input = event.inputBuffer.getChannelData(0);
      const downsampled = downsampleAudio(input, context.sampleRate, inputSampleRate);
      if (!useClientVad) {
        socket.send(JSON.stringify({
          type: 'input_audio.append',
          audio: floatToPcm16Base64(downsampled)
        }));
        return;
      }

      const now = performance.now();
      const level = audioLevel(downsampled);
      const hasSound = level >= VOICE_DIALOG_LEVEL_THRESHOLD;
      if (voiceRealtimeAwaitingResponseRef.current) {
        const playbackActive =
          voiceRealtimePlaybackSourcesRef.current.size > 0 ||
          voiceDialogStateRef.current === 'speaking';
        if (playbackActive) {
          const bargeInCandidate = level >= REALTIME_VOICE_BARGE_IN_LEVEL_THRESHOLD;
          if (!bargeInCandidate) {
            voiceRealtimeBargeInStartedAtRef.current = 0;
            return;
          }
          if (!voiceRealtimeBargeInStartedAtRef.current) {
            voiceRealtimeBargeInStartedAtRef.current = now;
            return;
          }
          if (now - voiceRealtimeBargeInStartedAtRef.current < REALTIME_VOICE_BARGE_IN_SUSTAIN_MS) {
            return;
          }
          beginBargeIn();
        } else if (hasSound) {
          beginBargeIn();
        } else {
          voiceRealtimeBargeInStartedAtRef.current = 0;
          return;
        }
      }

      if (hasSound) {
        if (!voiceRealtimeSpeechStartedRef.current) {
          voiceRealtimeSpeechStartedRef.current = true;
          voiceRealtimeTurnStartedAtRef.current = now;
          setVoiceDialogMode('listening');
        }
        voiceRealtimeLastSoundAtRef.current = now;
      }

      if (!voiceRealtimeSpeechStartedRef.current) {
        return;
      }

      socket.send(JSON.stringify({
        type: 'input_audio.append',
        audio: floatToPcm16Base64(downsampled)
      }));

      const turnLongEnough = now - voiceRealtimeTurnStartedAtRef.current >= REALTIME_VOICE_MIN_TURN_MS;
      const silentLongEnough = now - voiceRealtimeLastSoundAtRef.current >= silenceMs;
      if (turnLongEnough && silentLongEnough) {
        commitCurrentTurn();
      }
    };

    source.connect(processor);
    processor.connect(context.destination);
    voiceRealtimeStreamRef.current = stream;
    voiceRealtimeAudioContextRef.current = context;
    voiceRealtimeAudioSourceRef.current = source;
    voiceRealtimeProcessorRef.current = processor;
  }

  function handleRealtimeVoiceEvent(payload) {
    if (!voiceDialogOpenRef.current || !voiceDialogRealtimeRef.current) {
      return;
    }
    if (payload.type === 'voice.realtime.connecting') {
      setVoiceDialogMode('waiting');
      return;
    }
    if (payload.type === 'voice.realtime.ready') {
      const socket = voiceRealtimeSocketRef.current;
      if (!socket || voiceRealtimeStreamRef.current) {
        setVoiceDialogMode('listening');
        return;
      }
      startRealtimeMicrophone(socket)
        .then(() => {
          setVoiceDialogError('');
          setVoiceDialogMode('listening');
        })
        .catch((error) => {
          setVoiceDialogErrorBriefly(error.message || t('voice.realtimeStartFailed'));
          stopRealtimeVoiceDialog({ keepPanel: true });
        });
      return;
    }
    if (payload.type === 'voice.realtime.cancel_ignored') {
      voiceRealtimeAwaitingResponseRef.current = false;
      voiceRealtimeBargeInStartedAtRef.current = 0;
      setVoiceDialogError('');
      setVoiceDialogMode('listening');
      return;
    }
    if (payload.type === 'voice.handoff.summarizing') {
      stopRealtimePlayback();
      voiceRealtimeSuppressAssistantAudioRef.current = true;
      voiceRealtimeAssistantTextRef.current = '';
      setVoiceDialogAssistantText('');
      setVoiceDialogError('');
      setVoiceDialogMode('summarizing');
      return;
    }
    if (payload.type === 'voice.handoff.summary_delta') {
      return;
    }
    if (payload.type === 'voice.handoff.summary_done') {
      const draft = String(payload.message || payload.rawText || '').trim();
      if (!draft) {
        setVoiceDialogErrorBriefly(t('voice.noHandoffTask'));
        return;
      }
      setVoiceDialogHandoffDraftValue(draft);
      setVoiceDialogAssistantText('');
      setVoiceDialogError(payload.parsed ? '' : t('voice.invalidJson'));
      setVoiceDialogMode('handoff');
      return;
    }
    if (payload.type === 'voice.handoff.summary_error') {
      voiceRealtimeSuppressAssistantAudioRef.current = false;
      setVoiceDialogErrorBriefly(payload.error || t('voice.summarizeFailed'));
      return;
    }
    if (payload.type === 'response.created') {
      if (voiceDialogStateRef.current === 'summarizing' || voiceDialogStateRef.current === 'handoff') {
        return;
      }
      voiceRealtimeSuppressAssistantAudioRef.current = false;
      voiceRealtimeAwaitingResponseRef.current = true;
      return;
    }
    if (payload.type === 'voice.realtime.error' || payload.type === 'error') {
      if (isBenignRealtimeCancelError(payload)) {
        voiceRealtimeAwaitingResponseRef.current = false;
        voiceRealtimeBargeInStartedAtRef.current = 0;
        setVoiceDialogError('');
        setVoiceDialogMode('listening');
        return;
      }
      const message = payload.error?.message || payload.error || t('voice.realtimeFailed');
      voiceRealtimeAwaitingResponseRef.current = false;
      setVoiceDialogErrorBriefly(message);
      stopRealtimeVoiceDialog({ keepPanel: true });
      return;
    }
    if (payload.type === 'input_audio_buffer.speech_started') {
      stopRealtimePlayback();
      voiceRealtimeAssistantTextRef.current = '';
      voiceRealtimeAwaitingResponseRef.current = false;
      setVoiceDialogAssistantText('');
      setVoiceDialogMode('listening');
      return;
    }
    if (payload.type === 'input_audio_buffer.speech_stopped') {
      setVoiceDialogMode('waiting');
      return;
    }
    if (
      payload.type === 'conversation.item.input_audio_transcription.completed' &&
      payload.transcript
    ) {
      const transcript = String(payload.transcript || '').trim();
      setVoiceDialogTranscript(transcript);
      if (isVoiceHandoffCommand(transcript)) {
        requestVoiceHandoffSummary(transcript);
        return;
      }
      appendVoiceDialogIdeaTranscript(transcript);
      return;
    }
    if (
      (payload.type === 'response.audio_transcript.delta' ||
        payload.type === 'response.output_audio_transcript.delta') &&
      payload.delta
    ) {
      if (voiceRealtimeSuppressAssistantAudioRef.current) {
        return;
      }
      voiceRealtimeAssistantTextRef.current += payload.delta;
      setVoiceDialogAssistantText(voiceRealtimeAssistantTextRef.current.trim());
      return;
    }
    if (
      (payload.type === 'response.audio.delta' ||
        payload.type === 'response.output_audio.delta') &&
      payload.delta
    ) {
      if (voiceRealtimeSuppressAssistantAudioRef.current) {
        return;
      }
      voiceRealtimeAwaitingResponseRef.current = true;
      setVoiceDialogMode('speaking');
      playRealtimeAudioDelta(payload.delta);
      return;
    }
    if (
      payload.type === 'response.done' &&
      voiceDialogStateRef.current !== 'summarizing' &&
      voiceDialogStateRef.current !== 'handoff' &&
      voiceRealtimePlaybackSourcesRef.current.size === 0
    ) {
      voiceRealtimeSuppressAssistantAudioRef.current = false;
      voiceRealtimeAwaitingResponseRef.current = false;
      setVoiceDialogMode('listening');
    }
  }

  function startRealtimeVoiceDialog() {
    if (!status.voiceRealtime?.configured) {
      setVoiceDialogErrorBriefly(t('voice.realtimeNotConfigured'));
      return;
    }
    if (voiceRealtimeSocketRef.current) {
      return;
    }
    clearVoiceDialogAudio();
    stopRealtimeVoiceDialog({ keepPanel: true });
    voiceDialogRealtimeRef.current = true;
    voiceRealtimeAssistantTextRef.current = '';
    setVoiceDialogError('');
    setVoiceDialogTranscript('');
    setVoiceDialogAssistantText('');
    setVoiceDialogMode('waiting');

    const socket = new WebSocket(realtimeVoiceWebsocketUrl());
    voiceRealtimeSocketRef.current = socket;
    socket.onopen = () => {
      setVoiceDialogMode('waiting');
    };
    socket.onmessage = (event) => {
      try {
        handleRealtimeVoiceEvent(JSON.parse(event.data));
      } catch {
        // Ignore malformed proxy events.
      }
    };
    socket.onerror = () => {
      setVoiceDialogErrorBriefly(t('voice.realtimeFailed'));
      stopRealtimeVoiceDialog({ keepPanel: true });
    };
    socket.onclose = () => {
      if (voiceDialogOpenRef.current && voiceDialogRealtimeRef.current) {
        stopRealtimeVoiceDialog({ keepPanel: true });
        setVoiceDialogMode('idle');
      }
    };
  }

  function voiceDialogMimeType() {
    if (!window.MediaRecorder?.isTypeSupported) {
      return '';
    }
    return VOICE_MIME_CANDIDATES.find((type) => window.MediaRecorder.isTypeSupported(type)) || '';
  }

  function setVoiceDialogErrorBriefly(message) {
    setVoiceDialogError(message);
    setVoiceDialogMode('error');
  }

  async function transcribeVoiceDialogBlob(blob) {
    if (!blob?.size) {
      throw new Error(t('voice.noAudio'));
    }
    if (blob.size > VOICE_MAX_UPLOAD_BYTES) {
      throw new Error(t('voice.tooLarge'));
    }

    const formData = new FormData();
    const extension = blob.type.includes('mp4') ? 'm4a' : 'webm';
    formData.append('audio', blob, `voice-dialog.${extension}`);
    const result = await apiFetch('/api/voice/transcribe', {
      method: 'POST',
      body: formData
    });
    const text = String(result.text || '').trim();
    if (!text) {
      throw new Error(t('toast.voiceNoText'));
    }
    return text;
  }

  function playAudioBlob(blob) {
    return new Promise((resolve, reject) => {
      clearVoiceDialogAudio();
      const url = URL.createObjectURL(blob);
      const audio = ensureVoiceDialogAudio();
      voiceDialogAudioUrlRef.current = url;
      audio.muted = false;
      audio.src = url;
      audio.playsInline = true;
      audio.onended = () => {
        voiceDialogAudioUnlockedRef.current = true;
        resolve();
      };
      audio.onerror = () => reject(new Error(t('voice.playFailed')));
      audio.load?.();
      audio.play().catch(reject);
    });
  }

  function speakWithBrowser(text) {
    return new Promise((resolve, reject) => {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
        reject(new Error(t('voice.speechUnsupported')));
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.onend = resolve;
      utterance.onerror = () => reject(new Error(t('voice.speechFailed')));
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    });
  }

  function scheduleNextVoiceDialogTurn() {
    if (!voiceDialogOpenRef.current || !voiceDialogAutoListenRef.current) {
      setVoiceDialogMode('idle');
      return;
    }
    setVoiceDialogMode('idle');
    window.setTimeout(() => {
      if (voiceDialogOpenRef.current && voiceDialogAutoListenRef.current) {
        startVoiceDialogRecording();
      }
    }, 220);
  }

  async function playVoiceDialogReply(message) {
    const text = spokenReplyText(message?.content);
    if (!text) {
      scheduleNextVoiceDialogTurn();
      return;
    }

    setVoiceDialogAssistantText(text);
    setVoiceDialogError('');
    setVoiceDialogMode('speaking');

    try {
      const blob = await apiBlobFetch('/api/voice/speech', {
        method: 'POST',
        body: { text }
      });
      await playAudioBlob(blob);
    } catch (error) {
      try {
        await speakWithBrowser(text);
      } catch {
        setVoiceDialogError(error.message || t('voice.speechFailed'));
      }
    } finally {
      clearVoiceDialogAudio();
      scheduleNextVoiceDialogTurn();
    }
  }

  async function startVoiceDialogRecording() {
    if (voiceDialogRealtimeRef.current) {
      startRealtimeVoiceDialog();
      return;
    }
    if (!voiceDialogOpenRef.current) {
      return;
    }
    if (['transcribing', 'sending', 'waiting', 'speaking'].includes(voiceDialogStateRef.current)) {
      return;
    }
    clearVoiceDialogTimer();
    clearVoiceDialogAudio();
    unlockVoiceDialogAudio();
    setVoiceDialogError('');
    setVoiceDialogTranscript('');
    setVoiceDialogAssistantText('');

    if (!selectedProjectRef.current && !selectedProject) {
      setVoiceDialogErrorBriefly(t('toast.selectProject'));
      return;
    }
    if (!window.isSecureContext) {
      setVoiceDialogErrorBriefly(t('voice.httpsRequired'));
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setVoiceDialogErrorBriefly(t('voice.recordUnsupported'));
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = voiceDialogMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      voiceDialogStreamRef.current = stream;
      voiceDialogChunksRef.current = [];
      voiceDialogRecorderRef.current = recorder;
      setupVoiceDialogSilenceDetection(stream, recorder);

      recorder.ondataavailable = (event) => {
        if (event.data?.size) {
          voiceDialogChunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        clearVoiceDialogTimer();
        stopVoiceDialogStream();
        voiceDialogRecorderRef.current = null;
        voiceDialogOpenRef.current = false;
        setVoiceDialogOpen(false);
        showToast({ level: 'error', title: t('toast.voiceFailed'), body: t('toast.voiceRecordFailed') });
        setVoiceDialogErrorBriefly(t('toast.voiceRecordFailed'));
      };
      recorder.onstop = async () => {
        clearVoiceDialogTimer();
        stopVoiceDialogStream();
        const recordedType = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(voiceDialogChunksRef.current, { type: recordedType });
        voiceDialogChunksRef.current = [];
        voiceDialogRecorderRef.current = null;

        try {
          setVoiceDialogMode('transcribing');
          const transcript = await transcribeVoiceDialogBlob(blob);
          setVoiceDialogTranscript(transcript);
          setVoiceDialogMode('sending');
          const turn = await handleVoiceSubmit(transcript);
          if (turn?.appended) {
            voiceDialogOpenRef.current = false;
            setVoiceDialogOpen(false);
            setVoiceDialogMode('idle');
            voiceDialogAwaitingTurnRef.current = null;
            voiceDialogAutoListenRef.current = false;
            return;
          }
          voiceDialogAwaitingTurnRef.current = {
            turnId: turn?.turnId,
            message: transcript,
            startedAt: Date.now()
          };
          setVoiceDialogMode('waiting');
        } catch (error) {
          voiceDialogAwaitingTurnRef.current = null;
          voiceDialogOpenRef.current = false;
          setVoiceDialogOpen(false);
          showToast({ level: 'error', title: t('toast.voiceFailed'), body: error.message || t('toast.voiceNoText') });
          setVoiceDialogErrorBriefly(error.message || t('voice.dialogFailed'));
        }
      };

      recorder.start();
      setVoiceDialogMode('listening');
      voiceDialogTimerRef.current = window.setTimeout(() => {
        if (voiceDialogRecorderRef.current?.state === 'recording') {
          setVoiceDialogMode('transcribing');
          voiceDialogRecorderRef.current.stop();
        }
      }, VOICE_MAX_RECORDING_MS);
    } catch (error) {
      clearVoiceDialogTimer();
      stopVoiceDialogStream();
      voiceDialogRecorderRef.current = null;
      const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
      const message = denied ? t('voice.microphoneDenied') : t('voice.recordStartFailed');
      voiceDialogOpenRef.current = false;
      setVoiceDialogOpen(false);
      showToast({ level: 'error', title: t('toast.voiceFailed'), body: message });
      setVoiceDialogErrorBriefly(message);
    }
  }

  function stopVoiceDialogRecording() {
    if (voiceDialogRealtimeRef.current) {
      stopRealtimeVoiceDialog({ keepPanel: true });
      setVoiceDialogMode('idle');
      return;
    }
    if (voiceDialogRecorderRef.current?.state === 'recording') {
      setVoiceDialogError('');
      setVoiceDialogMode('transcribing');
      voiceDialogRecorderRef.current.stop();
      return;
    }
    clearVoiceDialogTimer();
    stopVoiceDialogStream();
    setVoiceDialogMode('idle');
  }

  function continueVoiceHandoffCollection() {
    setVoiceDialogHandoffDraftValue('');
    setVoiceDialogError('');
    setVoiceDialogAssistantText('');
    voiceRealtimeSuppressAssistantAudioRef.current = false;
    setVoiceDialogMode('listening');
  }

  function cancelVoiceHandoffConfirmation() {
    setVoiceDialogHandoffDraftValue('');
    setVoiceDialogError('');
    voiceRealtimeSuppressAssistantAudioRef.current = false;
    setVoiceDialogMode('listening');
  }

  async function submitVoiceHandoffToCodex() {
    const message = voiceDialogHandoffDraftRef.current.trim();
    if (!message) {
      return;
    }
    if (!selectedProjectRef.current && !selectedProject) {
      setVoiceDialogError(t('toast.selectProject'));
      setVoiceDialogMode('handoff');
      return;
    }
    try {
      setVoiceDialogError('');
      setVoiceDialogMode('sending');
      await submitCodexMessage({ message });
      voiceDialogIdeaBufferRef.current = [];
      setVoiceDialogHandoffDraftValue('');
      closeVoiceDialog();
    } catch (error) {
      setVoiceDialogError(error.message || t('voice.sendFailed'));
      setVoiceDialogMode('handoff');
    }
  }

  function openVoiceDialog() {
    unlockVoiceDialogAudio();
    voiceDialogOpenRef.current = true;
    voiceDialogRealtimeRef.current = Boolean(status.voiceRealtime?.configured);
    voiceDialogAutoListenRef.current = !voiceDialogRealtimeRef.current;
    voiceDialogAwaitingTurnRef.current = null;
    voiceDialogIdeaBufferRef.current = [];
    setVoiceDialogHandoffDraftValue('');
    setVoiceDialogOpen(true);
    setVoiceDialogError('');
    setVoiceDialogTranscript('');
    setVoiceDialogAssistantText('');
    setVoiceDialogMode('idle');
    window.setTimeout(() => {
      if (voiceDialogOpenRef.current) {
        if (voiceDialogRealtimeRef.current) {
          startRealtimeVoiceDialog();
        } else {
          startVoiceDialogRecording();
        }
      }
    }, 80);
  }

  function openVoiceTranscriptionDialog() {
    if (voiceDialogRecorderRef.current?.state === 'recording') {
      stopVoiceDialogRecording();
      return;
    }
    if (['transcribing', 'sending'].includes(voiceDialogStateRef.current)) {
      return;
    }
    unlockVoiceDialogAudio();
    voiceDialogOpenRef.current = true;
    voiceDialogRealtimeRef.current = false;
    voiceDialogAutoListenRef.current = false;
    voiceDialogAwaitingTurnRef.current = null;
    voiceDialogIdeaBufferRef.current = [];
    setVoiceDialogHandoffDraftValue('');
    setVoiceDialogOpen(false);
    setVoiceDialogError('');
    setVoiceDialogTranscript('');
    setVoiceDialogAssistantText('');
    setVoiceDialogMode('idle');
    window.setTimeout(() => {
      if (voiceDialogOpenRef.current) {
        startVoiceDialogRecording();
      }
    }, 80);
  }

  function closeVoiceDialog() {
    voiceDialogAutoListenRef.current = false;
    voiceDialogOpenRef.current = false;
    voiceDialogAwaitingTurnRef.current = null;
    voiceDialogIdeaBufferRef.current = [];
    setVoiceDialogHandoffDraftValue('');
    stopRealtimeVoiceDialog();
    if (voiceDialogRecorderRef.current?.state === 'recording') {
      voiceDialogRecorderRef.current.onstop = null;
      voiceDialogRecorderRef.current.stop();
    }
    voiceDialogRecorderRef.current = null;
    clearVoiceDialogTimer();
    stopVoiceDialogStream();
    clearVoiceDialogAudio({ release: true });
    setVoiceDialogOpen(false);
    setVoiceDialogError('');
    setVoiceDialogTranscript('');
    setVoiceDialogAssistantText('');
    setVoiceDialogMode('idle');
  }

  function runtimeKeysForPayload(payload) {
    const keys = new Set(payloadRunKeys(payload));
    const current = selectedSessionRef.current;
    if (current) {
      const sameProject = !payload?.projectId || !current.projectId || payload.projectId === current.projectId;
      const matchesCurrent =
        keys.has(current.id) ||
        keys.has(current.turnId) ||
        (payload?.turnId && current.turnId === payload.turnId) ||
        (current.draft && sameProject);
      if (matchesCurrent) {
        if (current.id) {
          keys.add(current.id);
        }
        if (current.turnId) {
          keys.add(current.turnId);
        }
      }
    }
    return Array.from(keys).filter(Boolean);
  }

  function markRun(payload) {
    const keys = runtimeKeysForPayload(payload);
    if (!keys.length) {
      return;
    }
    setRunningById((current) => {
      const next = { ...current };
      for (const key of keys) {
        next[key] = true;
      }
      runningByIdRef.current = next;
      return next;
    });
    setThreadRuntimeById((current) => {
      const next = { ...current };
      for (const key of keys) {
        next[key] = {
          status: 'running',
          steerable: payload.steerable !== false,
          sessionId: payload.sessionId || null,
          requestedRunMode: payload.requestedRunMode || null,
          runMode: payload.runMode || null,
          workingDirectory: payload.workingDirectory || payload.targetProjectPath || null,
          targetProjectPath: payload.targetProjectPath || payload.workingDirectory || null,
          worktree: payload.worktree || null,
          updatedAt: payload.timestamp || payload.startedAt || new Date().toISOString()
        };
      }
      return next;
    });
  }

  function clearRun(payload) {
    const keys = runtimeKeysForPayload(payload);
    if (!keys.length) {
      return;
    }
    setRunningById((current) => {
      const next = { ...current };
      for (const key of keys) {
        delete next[key];
      }
      runningByIdRef.current = next;
      return next;
    });
    setThreadRuntimeById((current) => {
      const next = { ...current };
      for (const key of keys) {
        if (next[key]?.status === 'running') {
          delete next[key];
        }
      }
      return next;
    });
  }

  function markSessionCompleteNotice(payload) {
    const ids = runtimeKeysForPayload(payload).filter((id) => !isDraftSession(id));
    if (!ids.length) {
      return;
    }
    setCompletedSessionIds((current) => {
      const next = { ...current };
      for (const id of ids) {
        next[id] = true;
      }
      return next;
    });
    setThreadRuntimeById((current) => {
      const next = { ...current };
      for (const id of ids) {
        next[id] = {
          status: 'completed',
          updatedAt: payload.completedAt || payload.timestamp || new Date().toISOString()
        };
      }
      return next;
    });
  }

  function clearSessionCompleteNotice(sessionId) {
    if (!sessionId) {
      return;
    }
    setCompletedSessionIds((current) => {
      if (!current[sessionId]) {
        return current;
      }
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    setThreadRuntimeById((current) => {
      if (current[sessionId]?.status !== 'completed') {
        return current;
      }
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
  }

  function syncActiveRunsFromStatus(nextStatus) {
    const activeRuns = Array.isArray(nextStatus?.activeRuns) ? nextStatus.activeRuns : [];
    const shouldPreserveLocalRuns =
      activePollsRef.current.size > 0 ||
      turnRefreshTimersRef.current.size > 0;

    if (!activeRuns.length) {
      if (!shouldPreserveLocalRuns) {
        setRunningById(() => {
          runningByIdRef.current = {};
          return {};
        });
        setThreadRuntimeById((current) => {
          const next = { ...current };
          for (const [key, value] of Object.entries(next)) {
            if (value?.status === 'running') {
              delete next[key];
            }
          }
          return next;
        });
      }
      setMessages((current) => {
        if (shouldPreserveLocalRuns) {
          return current;
        }
        return current.filter(
          (message) => !(message.role === 'activity' && (message.status === 'running' || message.status === 'queued'))
        );
      });
      return;
    }

    const nextRunning = {};
    const nextRuntime = {};
    for (const run of activeRuns) {
      for (const key of payloadRunKeys(run)) {
        nextRunning[key] = true;
        nextRuntime[key] = {
          status: 'running',
          steerable: run.steerable !== false,
          sessionId: run.sessionId || null,
          requestedRunMode: run.requestedRunMode || null,
          runMode: run.runMode || null,
          workingDirectory: run.workingDirectory || run.targetProjectPath || null,
          targetProjectPath: run.targetProjectPath || run.workingDirectory || null,
          worktree: run.worktree || null,
          updatedAt: run.startedAt || new Date().toISOString()
        };
      }
    }
    setRunningById((current) => {
      const next = shouldPreserveLocalRuns ? { ...current, ...nextRunning } : nextRunning;
      runningByIdRef.current = next;
      return next;
    });
    setThreadRuntimeById((current) => {
      const next = shouldPreserveLocalRuns ? { ...current, ...nextRuntime } : nextRuntime;
      return next;
    });
  }

  function payloadMatchesCurrentConversation(payload) {
    const current = selectedSessionRef.current;
    if (!current) {
      return true;
    }
    const keys = payloadRunKeys(payload);
    return keys.includes(current.id) || keys.includes(current.turnId);
  }

  function clearTurnRefreshTimer(turnId) {
    if (!turnId) {
      return;
    }
    const timer = turnRefreshTimersRef.current.get(turnId);
    if (timer) {
      window.clearTimeout(timer);
      turnRefreshTimersRef.current.delete(turnId);
    }
  }

  function rememberDesktopIpcPendingRun(sessionId, pending) {
    if (!sessionId || !pending?.message) {
      return;
    }
    desktopIpcPendingRunsRef.current.set(sessionId, {
      ...pending,
      sessionId,
      startedAt: pending.startedAt || new Date().toISOString()
    });
  }

  function completeDesktopIpcPendingRun(sessionId) {
    const pending = desktopIpcPendingRunsRef.current.get(sessionId);
    if (!pending) {
      return false;
    }
    desktopIpcPendingRunsRef.current.delete(sessionId);
    const completedPayload = {
      sessionId,
      turnId: selectedSessionRef.current?.turnId || pending.clientTurnId || pending.turnId || null,
      completedAt: new Date().toISOString()
    };
    clearRun(completedPayload);
    if (pending.turnId && pending.turnId !== completedPayload.turnId) {
      clearRun({ ...completedPayload, turnId: pending.turnId });
    }
    if (pending.clientTurnId && pending.clientTurnId !== completedPayload.turnId) {
      clearRun({ ...completedPayload, turnId: pending.clientTurnId });
    }
    markSessionCompleteNotice(completedPayload);
    return true;
  }

  async function refreshMessagesForPayload(payload) {
    if (!payload?.sessionId || !payloadMatchesCurrentConversation(payload)) {
      return false;
    }
    try {
      const data = await apiFetch(sessionMessagesApiPath(payload.sessionId));
      if (data.messages?.length && hasVisibleAssistantForTurn(data.messages, payload)) {
        setContextStatus((current) => mergeContextStatus(current, data.context || DEFAULT_STATUS.context, DEFAULT_STATUS.context));
        setMessages((current) => mergeLoadedMessagesPreservingActivity(current, data.messages, payload));
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  function finalizeTurnWithoutAssistant(payload) {
    if (!payload?.turnId) {
      return;
    }
    clearTurnRefreshTimer(payload.turnId);
    setMessages((current) =>
      upsertStatusMessage(current, {
        ...payload,
        status: 'completed',
        label: '任务已完成',
        detail: payload.error || payload.detail || ''
      })
    );
    clearRun(payload);
  }

  function markTurnCompleted(payload, detail = '结果同步中') {
    if (!payload?.turnId) {
      return;
    }
    const completedAt = payload.completedAt || payload.timestamp || new Date().toISOString();
    setMessages((current) => {
      if (hasAssistantMessageForTurn(current, payload)) {
        return completeActivityMessagesForTurn(current, { ...payload, completedAt });
      }
      return upsertStatusMessage(current, {
        ...payload,
        kind: 'turn',
        status: 'completed',
        label: '任务已完成',
        detail,
        completedAt
      });
    });
  }

  function scheduleTurnRefresh(payload, attempt = 0) {
    const turnId = payload?.turnId;
    if (!turnId || !payload?.sessionId || !payloadMatchesCurrentConversation(payload)) {
      return;
    }
    clearTurnRefreshTimer(turnId);
    const delays = [300, 800, 1500, 2500, 4000, 6500, 10000, 15000, 22000, 30000, 30000];
    const delay = delays[attempt];
    if (delay === undefined) {
      finalizeTurnWithoutAssistant(payload);
      return;
    }

    const timer = window.setTimeout(async () => {
      if (!payloadMatchesCurrentConversation(payload)) {
        return;
      }
      const loaded = await refreshMessagesForPayload(payload);
      if (loaded) {
        clearTurnRefreshTimer(turnId);
        clearRun(payload);
        return;
      }
      scheduleTurnRefresh(payload, attempt + 1);
    }, delay);
    turnRefreshTimersRef.current.set(turnId, timer);
  }

  useEffect(() => {
    selectedProjectRef.current = selectedProject;
  }, [selectedProject]);

  useEffect(() => {
    selectedSessionRef.current = selectedSession;
  }, [selectedSession]);

  useEffect(() => {
    appRouteRef.current = appRoute;
  }, [appRoute]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!authenticated || !selectedSession?.id || isDraftSession(selectedSession)) {
      return undefined;
    }

    const sessionId = selectedSession.id;
    let stopped = false;
    async function pollSelectedSession() {
      if (stopped || sessionLivePollRef.current) {
        return;
      }
      const hasSelectedRunning = hasRunningKey(
        runningByIdRef.current || {},
        selectedRunKeys(selectedSessionRef.current || selectedSession)
      );
      const hasExternalThreadRefresh = Boolean(desktopIpcPendingRunsRef.current.get(sessionId));
      if (!shouldPollSelectedSessionMessages({
        hasSelectedRunning,
        desktopBridge: status.desktopBridge,
        hasExternalThreadRefresh
      })) {
        return;
      }
      sessionLivePollRef.current = true;
      try {
        const data = await apiFetch(sessionMessagesApiPath(sessionId));
        if (!stopped && selectedSessionRef.current?.id === sessionId && Array.isArray(data.messages)) {
          const pendingDesktopRun = desktopIpcPendingRunsRef.current.get(sessionId) || null;
          const shouldCompleteDesktopRun =
            hasSelectedRunning &&
            status.desktopBridge?.mode === 'desktop-ipc' &&
            (
              desktopThreadHasAssistantAfterPendingSend(pendingDesktopRun, data.messages) ||
              desktopThreadHasAssistantAfterLocalSend(messagesRef.current, data.messages)
            );
          setContextStatus((current) => mergeContextStatus(current, data.context || DEFAULT_STATUS.context, DEFAULT_STATUS.context));
          setMessages((current) =>
            messageStreamSignature(current) === messageStreamSignature(data.messages)
              ? current
              : mergeLiveSelectedThreadMessages(current, data.messages)
          );
          if (shouldCompleteDesktopRun) {
            completeDesktopIpcPendingRun(sessionId);
          }
        }
      } catch {
        // Keep the currently rendered conversation if a transient poll fails.
      } finally {
        sessionLivePollRef.current = false;
      }
    }

    const intervalMs = hasRunningActivity || running ? 700 : 1600;
    const timer = window.setInterval(pollSelectedSession, intervalMs);
    pollSelectedSession();
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [authenticated, selectedSession?.id, hasRunningActivity, running, status.desktopBridge]);

  useEffect(() => () => closeVoiceDialog(), []);

  useEffect(
    () => () => {
      for (const timer of turnRefreshTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      turnRefreshTimersRef.current.clear();
    },
    []
  );

  useEffect(
    () => () => {
      for (const timer of toastTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      toastTimersRef.current.clear();
    },
    []
  );

  useEffect(() => {
    const awaiting = voiceDialogAwaitingTurnRef.current;
    if (!voiceDialogOpen || !awaiting?.turnId || voiceDialogStateRef.current !== 'waiting') {
      return;
    }
    if (runningById[awaiting.turnId]) {
      return;
    }

    const reversed = [...messages].reverse();
    let reply = reversed.find(
      (message) =>
        message.role === 'assistant' &&
        message.turnId === awaiting.turnId &&
        String(message.content || '').trim()
    );

    if (!reply) {
      let userIndex = -1;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (
          message.role === 'user' &&
          (message.turnId === awaiting.turnId || String(message.content || '').trim() === awaiting.message)
        ) {
          userIndex = index;
          break;
        }
      }
      if (userIndex >= 0) {
        reply = [...messages.slice(userIndex + 1)].reverse().find(
          (message) => message.role === 'assistant' && String(message.content || '').trim()
        );
      }
    }

    const speechText = spokenReplyText(reply?.content);
    if (!reply || !speechText) {
      return;
    }

    const speechKey = `${awaiting.turnId}:${reply.id}:${speechText.length}`;
    if (voiceDialogLastSpokenRef.current === speechKey) {
      return;
    }
    voiceDialogLastSpokenRef.current = speechKey;
    voiceDialogAwaitingTurnRef.current = null;
    playVoiceDialogReply(reply);
  }, [messages, runningById, voiceDialogOpen]);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, themeSetting);
    document.documentElement.dataset.theme = theme;
  }, [theme, themeSetting]);

  useEffect(() => {
    localStorage.setItem(LANGUAGE_KEY, languageSetting);
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }, [languageSetting, locale]);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) {
      return undefined;
    }
    const syncTheme = () => setSystemTheme(media.matches ? 'dark' : 'light');
    syncTheme();
    media.addEventListener?.('change', syncTheme);
    return () => media.removeEventListener?.('change', syncTheme);
  }, []);

  useEffect(() => {
    const syncLocale = () => setSystemLocale(localeFromNavigator());
    window.addEventListener('languagechange', syncLocale);
    return () => window.removeEventListener('languagechange', syncLocale);
  }, []);

  useEffect(() => {
    if (selectedReasoningEffort) {
      localStorage.setItem('codexmobile.reasoningEffort', selectedReasoningEffort);
    }
  }, [selectedReasoningEffort]);

  useEffect(() => {
    if (!selectedProject?.id || !selectedSession || !isDraftSession(selectedSession)) {
      return;
    }
    writeNewDraftCache(selectedProject.id, {
      input,
      attachments,
      fileMentions,
      runMode
    });
  }, [attachments, fileMentions, input, runMode, selectedProject?.id, selectedSession]);

  useEffect(() => {
    localStorage.setItem(SELECTED_SKILLS_KEY, JSON.stringify(selectedSkillPaths));
  }, [selectedSkillPaths]);

  useEffect(() => {
    if (!Array.isArray(status.skills) || !status.skills.length || !selectedSkillPaths.length) {
      return;
    }
    const available = new Set(status.skills.map((skill) => skill.path));
    const next = selectedSkillPaths.filter((item) => available.has(item));
    if (next.length !== selectedSkillPaths.length) {
      setSelectedSkillPaths(next);
    }
  }, [selectedSkillPaths, status.skills]);

  useEffect(() => {
    if (status.model && selectedModel === DEFAULT_STATUS.model) {
      setSelectedModel(status.model);
    }
  }, [selectedModel, status.model]);

  useEffect(() => {
    const saved = localStorage.getItem('codexmobile.reasoningEffort');
    if (!saved && status.reasoningEffort && !selectedReasoningEffort) {
      setSelectedReasoningEffort(status.reasoningEffort);
    }
  }, [selectedReasoningEffort, status.reasoningEffort]);

  const loadStatus = useCallback(async () => {
    const data = await apiFetch('/api/status');
    setStatus(data);
    setAuthenticated(Boolean(data.auth?.authenticated));
    syncActiveRunsFromStatus(data);
    return data;
  }, []);

  function navigateAppRoute(path, options = {}) {
    if (typeof window === 'undefined' || !path) {
      return;
    }
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (currentPath !== path) {
      const method = options.replace ? 'replaceState' : 'pushState';
      window.history[method]({}, '', path);
    }
    const nextRoute = parseAppRoute(window.location.pathname);
    appRouteRef.current = nextRoute;
    setAppRoute(nextRoute);
  }

  function selectProjectDraft(project, options = {}) {
    if (!project?.id) {
      return null;
    }
    const draft = createDraftSession(project, { stable: true });
    const cache = options.ignoreCache ? {} : readNewDraftCache(project.id);
    selectedProjectRef.current = project;
    selectedSessionRef.current = draft;
    setSelectedProject(project);
    setSelectedSession(draft);
    setExpandedProjectIds((current) => ({ ...current, [project.id]: true }));
    setSessionsByProject((current) => {
      const source = Array.isArray(options.sessions) ? options.sessions : current[project.id] || [];
      return {
        ...current,
        [project.id]: [draft, ...source.filter((session) => session.id !== draft.id)]
      };
    });
    setMessages([]);
    setContextStatus(emptyContextStatus());
    setInput(cache.input || '');
    setAttachments(cache.attachments || []);
    setFileMentions(cache.fileMentions || []);
    if (cache.runMode) {
      setRunModeState(cache.runMode);
    }
    if (options.updateRoute) {
      navigateAppRoute(projectNewRoutePath(project.id), { replace: options.updateRoute === 'replace' });
    }
    return draft;
  }

  const loadSessions = useCallback(async (project, options = true) => {
    const settings =
      typeof options === 'boolean'
        ? { chooseLatest: options, preserveSelection: false }
        : {
          chooseLatest: options?.chooseLatest ?? true,
          preserveSelection: Boolean(options?.preserveSelection),
          requestedSessionId: options?.requestedSessionId || '',
          forceNewDraft: Boolean(options?.forceNewDraft),
          replaceMissingWithDraft: Boolean(options?.replaceMissingWithDraft)
        };
    if (!project) {
      selectedSessionRef.current = null;
      setSelectedSession(null);
      setMessages([]);
      setInput('');
      setAttachments([]);
      setFileMentions([]);
      setContextStatus(emptyContextStatus());
      return;
    }
    setLoadingProjectId(project.id);
    try {
      const data = await apiFetch(`/api/projects/${encodeURIComponent(project.id)}/sessions`);
      const apiSessions = data.sessions || [];
      const currentSession = selectedSessionRef.current;
      if (settings.forceNewDraft) {
        setSessionsByProject((current) => ({ ...current, [project.id]: apiSessions }));
        selectProjectDraft(project, { sessions: apiSessions });
        return;
      }
      if (settings.requestedSessionId) {
        const requested = apiSessions.find((session) => String(session.id) === String(settings.requestedSessionId));
        if (requested) {
          selectedSessionRef.current = requested;
          setSessionsByProject((current) => ({ ...current, [project.id]: apiSessions }));
          setSelectedSession(requested);
          setInput('');
          setAttachments([]);
          setFileMentions([]);
          setContextStatus(normalizeContextStatus(requested.context || DEFAULT_STATUS.context, DEFAULT_STATUS.context));
          const messageData = await apiFetch(sessionMessagesApiPath(requested.id));
          if (selectedSessionRef.current?.id === requested.id) {
            setMessages(messageData.messages || []);
            setContextStatus(
              normalizeContextStatus(messageData.context || requested.context || DEFAULT_STATUS.context, DEFAULT_STATUS.context)
            );
          }
          return;
        }
        setSessionsByProject((current) => ({ ...current, [project.id]: apiSessions }));
        if (settings.replaceMissingWithDraft) {
          selectProjectDraft(project, { sessions: apiSessions, updateRoute: 'replace' });
          return;
        }
      }
      const preserveCurrent =
        settings.preserveSelection &&
        currentSession?.projectId === project.id &&
        (isDraftSession(currentSession) || apiSessions.some((session) => session.id === currentSession.id));
      const nextSessions =
        preserveCurrent && isDraftSession(currentSession)
          ? [currentSession, ...apiSessions.filter((session) => session.id !== currentSession.id)]
          : apiSessions;
      setSessionsByProject((current) => ({ ...current, [project.id]: nextSessions }));

      if (preserveCurrent) {
        if (isDraftSession(currentSession)) {
          selectedSessionRef.current = currentSession;
          setSelectedSession(currentSession);
          setMessages([]);
          setContextStatus(emptyContextStatus());
          return;
        }
        const refreshed = nextSessions.find((session) => session.id === currentSession.id);
        if (refreshed) {
          setSelectedSession((current) => (current?.id === refreshed.id ? { ...current, ...refreshed } : current));
          setContextStatus(normalizeContextStatus(refreshed.context || DEFAULT_STATUS.context, DEFAULT_STATUS.context));
          const messageData = await apiFetch(sessionMessagesApiPath(refreshed.id));
          if (selectedSessionRef.current?.id === refreshed.id) {
            setMessages(messageData.messages || []);
            setContextStatus(
              normalizeContextStatus(messageData.context || refreshed.context || DEFAULT_STATUS.context, DEFAULT_STATUS.context)
            );
          }
          return;
        }
      }

      if (settings.chooseLatest) {
        const next = nextSessions[0] || null;
        selectedSessionRef.current = next;
        setSelectedSession(next);
        setInput('');
        setAttachments([]);
        setFileMentions([]);
        if (next) {
          setContextStatus(normalizeContextStatus(next.context || DEFAULT_STATUS.context, DEFAULT_STATUS.context));
          const messageData = await apiFetch(sessionMessagesApiPath(next.id));
          if (selectedSessionRef.current?.id === next.id) {
            setMessages(messageData.messages || []);
            setContextStatus(normalizeContextStatus(messageData.context || next.context || DEFAULT_STATUS.context, DEFAULT_STATUS.context));
          }
        } else {
          setMessages([]);
          setContextStatus(emptyContextStatus());
        }
      } else {
        selectedSessionRef.current = null;
        setSelectedSession(null);
        setMessages([]);
        setContextStatus(emptyContextStatus());
      }
    } finally {
      setLoadingProjectId((current) => (current === project.id ? null : current));
    }
  }, []);

  const loadProjects = useCallback(async (options = {}) => {
    const preserveSelection = Boolean(options?.preserveSelection);
    const route = options?.route || parseAppRoute();
    appRouteRef.current = route;
    setAppRoute(route);
    const data = await apiFetch('/api/projects');
    const list = data.projects || [];
    setProjects(list);
    if (route.type === 'welcome' || route.type === 'settings') {
      selectedProjectRef.current = null;
      selectedSessionRef.current = null;
      setSelectedProject(null);
      setSelectedSession(null);
      setMessages([]);
      setInput('');
      setAttachments([]);
      setFileMentions([]);
      setContextStatus(emptyContextStatus());
      return;
    }
    const currentProject = selectedProjectRef.current;
    const routeProject = route.projectId
      ? list.find((project) => String(project.id) === String(route.projectId))
      : null;
    const preferred = route.projectId
      ? routeProject
      : (
        (preserveSelection && currentProject
          ? list.find((project) => project.id === currentProject.id)
          : null) ||
        list.find((project) => project.name.toLowerCase() === 'codexmobile') ||
        list.find((project) => project.path.toLowerCase().includes('codexmobile')) ||
        list[0] ||
        null
      );
    if (route.projectId && !routeProject) {
      navigateAppRoute('/', { replace: true });
      selectedProjectRef.current = null;
      selectedSessionRef.current = null;
      setSelectedProject(null);
      setSelectedSession(null);
      setMessages([]);
      setInput('');
      setAttachments([]);
      setFileMentions([]);
      setContextStatus(emptyContextStatus());
      return;
    }
    setSelectedProject(preferred);
    if (preferred) {
      setExpandedProjectIds((current) => ({ ...current, [preferred.id]: true }));
    }
    await loadSessions(preferred, {
      chooseLatest: !preserveSelection || !selectedSessionRef.current,
      preserveSelection,
      forceNewDraft: route.type === 'project-new',
      requestedSessionId: route.type === 'thread' ? route.sessionId : '',
      replaceMissingWithDraft: route.type === 'thread'
    });
  }, [loadSessions]);

  const bootstrap = useCallback(async () => {
    try {
      const currentStatus = await loadStatus();
      if (currentStatus.auth?.authenticated) {
        await loadProjects();
        setSyncing(true);
        apiFetch('/api/sync', { method: 'POST' })
          .then(async () => {
            await loadStatus();
            await loadProjects({ preserveSelection: true });
          })
          .catch(() => null)
          .finally(() => setSyncing(false));
      }
    } catch (error) {
      if (String(error.message).includes('Pairing')) {
        clearToken();
        setAuthenticated(false);
      }
    }
  }, [loadProjects, loadStatus]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    function handlePopState() {
      const route = parseAppRoute();
      appRouteRef.current = route;
      setAppRoute(route);
      if (authenticated) {
        loadProjects({ route }).catch(() => null);
      }
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [authenticated, loadProjects]);

  useEffect(() => {
    if (!authenticated || !getToken()) {
      setConnectionState('disconnected');
      return undefined;
    }

    let stopped = false;
    let reconnectTimer = null;

    const connect = () => {
      setConnectionState('connecting');
      const ws = new WebSocket(websocketUrl());
      wsRef.current = ws;

      ws.onopen = () => setConnectionState('connecting');
      ws.onclose = () => {
        setConnectionState('disconnected');
        if (!stopped) {
          reconnectTimer = window.setTimeout(connect, 1200);
        }
      };
      ws.onerror = () => setConnectionState('disconnected');
      ws.onmessage = (event) => {
      let payload = null;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (String(payload?.type || '').startsWith('terminal-')) {
        const terminalId = payload.terminalId || '';
        const handler = terminalHandlersRef.current.get(terminalId);
        if (handler) {
          handler(payload);
        }
        return;
      }
      if (payload.type === 'connected') {
        setStatus(payload.status || DEFAULT_STATUS);
        setConnectionState(payload.status?.connected ? 'connected' : 'disconnected');
        syncActiveRunsFromStatus(payload.status || DEFAULT_STATUS);
        return;
      }
      if (payload.type === 'quota-updated') {
        setQuotaSnapshot(payload.quota || null);
        return;
      }
      if (payload.type === 'chat-started') {
        markRun(payload);
        if (!payloadMatchesCurrentConversation(payload)) {
          return;
        }
        if (!selectedSessionRef.current && payload.sessionId) {
          setSelectedSession({
            id: payload.sessionId,
            projectId: payload.projectId,
            title: '新对话',
            cwd: payload.workingDirectory || payload.targetProjectPath || null,
            runMode: payload.runMode || null,
            worktree: payload.worktree || null
          });
        }
        return;
      }
      if (payload.type === 'thread-started' && payload.sessionId) {
        const projectId = payload.projectId || selectedProjectRef.current?.id || selectedSessionRef.current?.projectId;
        const currentSession = selectedSessionRef.current;
        const nextSession = {
          ...(currentSession || {}),
          id: payload.sessionId,
          projectId,
          title: currentSession?.title || '新对话',
          cwd: payload.workingDirectory || payload.targetProjectPath || currentSession?.cwd || null,
          runMode: payload.runMode || currentSession?.runMode || null,
          requestedRunMode: payload.requestedRunMode || currentSession?.requestedRunMode || null,
          worktree: payload.worktree || currentSession?.worktree || null,
          turnId: payload.turnId || currentSession?.turnId || null,
          updatedAt: new Date().toISOString(),
          draft: false
        };
        markRun(payload);
        const startedFromDraft =
          isDraftSession(payload.previousSessionId) ||
          currentSession?.draft ||
          (currentSession?.projectId === projectId && isDraftSession(currentSession));
        setSelectedSession((current) => {
          if (!current) {
            return nextSession;
          }
          const shouldReplace =
            current.id === payload.previousSessionId ||
            current.id === payload.sessionId ||
            current.turnId === payload.turnId ||
            (current.draft && current.projectId === projectId);
          return shouldReplace ? { ...current, ...nextSession } : current;
        });
        setSessionsByProject((current) =>
          upsertSessionInProject(current, projectId, nextSession, payload.previousSessionId)
        );
        setMessages((current) =>
          current.map((message) =>
            message.turnId === payload.turnId || message.sessionId === payload.previousSessionId
              ? { ...message, sessionId: payload.sessionId }
              : message
          )
        );
        if (startedFromDraft && projectId) {
          clearNewDraftCache(projectId);
          navigateAppRoute(sessionRoutePath(projectId, payload.sessionId), { replace: true });
        }
        return;
      }
      if (payload.type === 'message-deleted') {
        if (payloadMatchesCurrentConversation(payload)) {
          setMessages((current) => current.filter((message) => String(message.id) !== String(payload.messageId)));
        }
        return;
      }
      if (payload.type === 'session-renamed') {
        const sessionId = payload.sessionId || payload.session?.id;
        const projectId = payload.projectId || payload.session?.projectId;
        const title = String(payload.title || payload.session?.title || '').trim();
        if (!sessionId || !projectId || !title) {
          return;
        }
        setSessionsByProject((current) => applySessionRenameToProjectSessions(current, payload));
        setSelectedSession((current) => {
          if (!current || String(current.id) !== String(sessionId)) {
            return current;
          }
          return {
            ...current,
            ...(payload.session || {}),
            id: sessionId,
            projectId,
            title,
            titleLocked: payload.titleLocked ?? payload.session?.titleLocked ?? true,
            updatedAt: payload.updatedAt || payload.session?.updatedAt || current.updatedAt
          };
        });
        return;
      }
      if (payload.type === 'user-message') {
        if (!payloadMatchesCurrentConversation(payload)) {
          return;
        }
        setMessages((current) => {
          const alreadyShown = current.some(
            (message) => message.role === 'user' && message.content === payload.message.content
          );
          if (alreadyShown) {
            return current;
          }
          return [...current, payload.message];
        });
        return;
      }
      if (payload.type === 'assistant-update') {
        if (!payload.content?.trim()) {
          return;
        }
        markRun(payload);
        if (!payloadMatchesCurrentConversation(payload)) {
          return;
        }
        if (payload.phase === 'commentary') {
          setMessages((current) =>
            upsertStatusMessage(current, {
              ...payload,
              kind: payload.kind || 'agent_message',
              label: String(payload.content || '').trim(),
              status: payload.status || 'running'
            })
          );
          return;
        }
        setMessages((current) => upsertAssistantMessage(current, payload));
        if (payload.done !== false) {
          applyAutoSessionTitle(payload, payload.content);
        }
        return;
      }
      if (payload.type === 'status-update') {
        if (payload.status === 'running' || payload.status === 'queued') {
          markRun(payload);
        }
        notifyFromPayload(payload);
        if (payload.status === 'queued' && payloadMatchesCurrentConversation(payload)) {
          loadQueueDrafts(selectedSessionRef.current).catch(() => null);
        }
        if (!payloadMatchesCurrentConversation(payload)) {
          return;
        }
        if (payload.kind === 'turn' && payload.status === 'completed') {
          markTurnCompleted(payload);
          return;
        }
        setMessages((current) => upsertStatusMessage(current, payload));
        return;
      }
      if (payload.type === 'activity-update') {
        if (payload.status === 'running' || payload.status === 'queued') {
          markRun(payload);
        }
        notifyFromPayload(payload);
        if (!payloadMatchesCurrentConversation(payload)) {
          return;
        }
        setMessages((current) => upsertDiffMessage(upsertActivityMessage(current, payload), payload));
        return;
      }
      if (payload.type === 'context-status-update') {
        markRun(payload);
        if (payloadMatchesCurrentConversation(payload)) {
          setContextStatus((current) => mergeContextStatus(current, payload, DEFAULT_STATUS.context));
        }
        return;
      }
      if (payload.type === 'chat-complete' || payload.type === 'chat-error' || payload.type === 'chat-aborted') {
        notifyFromPayload(payload);
        loadQueueDrafts(selectedSessionRef.current).catch(() => null);
        if (!payloadMatchesCurrentConversation(payload)) {
          clearRun(payload);
          return;
        }
        if (payload.type === 'chat-complete') {
          if (payload.context) {
            setContextStatus((current) => mergeContextStatus(current, payload.context, DEFAULT_STATUS.context));
          }
          markSessionCompleteNotice(payload);
          clearRun(payload);
          markTurnCompleted(payload);
          scheduleTurnRefresh(payload);
          return;
        }
        clearRun(payload);
        if (payload.type === 'chat-error' && payload.error) {
          setMessages((current) =>
            upsertStatusMessage(current, {
              ...payload,
              status: 'failed',
          label: t('toast.taskFailed'),
              detail: payload.error
            })
          );
        } else if (payload.type === 'chat-aborted') {
          setMessages((current) =>
            upsertStatusMessage(current, {
              ...payload,
              status: 'completed',
              label: t('toast.aborted')
            })
          );
        }
        return;
      }
      if (payload.type === 'sync-complete' && payload.projects) {
        setProjects(payload.projects);
        const project = selectedProjectRef.current;
        if (!project?.id) {
          const preferred =
            payload.projects.find((item) => item.name.toLowerCase() === 'codexmobile') ||
            payload.projects.find((item) => item.path.toLowerCase().includes('codexmobile')) ||
            payload.projects[0] ||
            null;
          if (preferred) {
            setSelectedProject(preferred);
            setExpandedProjectIds((current) => ({ ...current, [preferred.id]: true }));
            loadSessions(preferred, {
              chooseLatest: true,
              preserveSelection: false
            }).catch(() => null);
          }
          return;
        }
        if (project?.id) {
          apiFetch(`/api/projects/${encodeURIComponent(project.id)}/sessions`)
            .then((data) => {
              const nextSessions = data.sessions || [];
              setSessionsByProject((current) => ({ ...current, [project.id]: nextSessions }));
              const currentSession = selectedSessionRef.current;
              const refreshedSession = nextSessions.find((session) => session.id === currentSession?.id);
              if (refreshedSession) {
                setSelectedSession((current) => (current?.id === refreshedSession.id ? { ...current, ...refreshedSession } : current));
                setContextStatus(normalizeContextStatus(refreshedSession.context || DEFAULT_STATUS.context, DEFAULT_STATUS.context));
              }
            })
            .catch(() => null);
        }
      }
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      wsRef.current?.close();
      setConnectionState('disconnected');
    };
  }, [authenticated]);

  async function handleSync() {
    setSyncing(true);
    try {
      await apiFetch('/api/sync', { method: 'POST' });
      await loadStatus();
      await loadProjects({ preserveSelection: true });
      showToast({ level: 'success', title: t('toast.syncDone'), body: t('toast.syncDoneBody') });
    } catch (error) {
      showToast({ level: 'error', title: t('toast.syncFailed'), body: error.message || t('toast.syncFailedBody') });
    } finally {
      setSyncing(false);
    }
  }

  async function handleRetryConnection() {
    try {
      await loadStatus();
      showToast({ level: 'success', title: t('toast.connectionRefreshed'), body: t('toast.connectionRefreshedBody') });
    } catch (error) {
      showToast({ level: 'error', title: t('toast.connectionFailed'), body: error.message || t('toast.connectionFailedBody') });
    }
  }

  function handleResetPairing() {
    clearToken();
    setAuthenticated(false);
    setConnectionState('disconnected');
  }

  function handleShowConnectionStatus() {
    showToast({
      level: status.desktopBridge?.connected ? 'info' : 'warning',
      title: bridgeConnectionLabel(connectionState, status.desktopBridge, t).label,
      body: status.desktopBridge?.reason || status.desktopBridge?.mode || t('toast.statusRead')
    });
  }

  async function handleToggleProject(project) {
    const isExpanded = Boolean(expandedProjectIds[project.id]);
    if (isExpanded) {
      setExpandedProjectIds((current) => {
        const next = { ...current };
        delete next[project.id];
        return next;
      });
      return;
    }

    setExpandedProjectIds((current) => ({ ...current, [project.id]: true }));
    const projectChanged = selectedProject?.id !== project.id;
    setSelectedProject(project);
    if (projectChanged) {
      setSelectedSession(null);
      setMessages([]);
      setContextStatus(emptyContextStatus());
    }
    if (!sessionsByProject[project.id]) {
      await loadSessions(project, false);
    }
  }

  async function handleSelectSession(projectOrSession, maybeSession = null) {
    const session = maybeSession || projectOrSession;
    const project =
      maybeSession
        ? projectOrSession
        : projects.find((item) => item.id === session?.projectId) || selectedProjectRef.current || selectedProject;
    if (project?.id) {
      selectedProjectRef.current = project;
      setSelectedProject(project);
      setExpandedProjectIds((current) => ({ ...current, [project.id]: true }));
    }
    clearSessionCompleteNotice(session?.id);
    selectedSessionRef.current = session;
    setSelectedSession(session);
    const requestedSessionId = session?.id || null;
    if (isDraftSession(session)) {
      if (project?.id) {
        selectProjectDraft(project, { updateRoute: 'push' });
      }
      setMessages([]);
      setContextStatus(emptyContextStatus());
      setDrawerOpen(false);
      return;
    }
    if (project?.id && session?.id) {
      navigateAppRoute(sessionRoutePath(project.id, session.id));
    }
    setInput('');
    setAttachments([]);
    setFileMentions([]);
    setContextStatus(normalizeContextStatus(session?.context || DEFAULT_STATUS.context, DEFAULT_STATUS.context));
    const data = await apiFetch(sessionMessagesApiPath(session.id));
    if (selectedSessionRef.current?.id !== requestedSessionId) {
      return;
    }
    setMessages(data.messages || []);
    setContextStatus(normalizeContextStatus(data.context || session.context || DEFAULT_STATUS.context, DEFAULT_STATUS.context));
    setDrawerOpen(false);
  }

  async function refreshProjectSessions(project) {
    if (!project?.id) {
      return;
    }
    const [projectData, sessionData] = await Promise.all([
      apiFetch('/api/projects'),
      apiFetch(`/api/projects/${encodeURIComponent(project.id)}/sessions`)
    ]);
    const nextProjects = projectData.projects || [];
    setProjects(nextProjects);
    setSessionsByProject((current) => ({ ...current, [project.id]: sessionData.sessions || [] }));
    const nextSelectedProject = nextProjects.find((item) => item.id === selectedProjectRef.current?.id);
    if (nextSelectedProject) {
      setSelectedProject(nextSelectedProject);
    }
  }

  function firstUserMessageForTurn(turnId) {
    const scoped = (messagesRef.current || []).filter((message) => !turnId || message.turnId === turnId);
    return scoped.find((message) => message.role === 'user' && String(message.content || '').trim())?.content || '';
  }

  function applyAutoSessionTitle(payload, assistantContent) {
    const currentSession = selectedSessionRef.current;
    const projectId = payload.projectId || selectedProjectRef.current?.id || currentSession?.projectId;
    if (!currentSession || !projectId || currentSession.titleLocked) {
      return;
    }
    const userMessage = firstUserMessageForTurn(payload.turnId);
    const nextTitle = sessionTitleFromConversation({
      userMessage,
      assistantMessage: assistantContent
    });
    if (!nextTitle || nextTitle === currentSession.title) {
      return;
    }

    const ids = new Set([currentSession.id, payload.sessionId, payload.previousSessionId, payload.turnId].filter(Boolean));
    const patch = autoTitlePatch(nextTitle, 'completed');
    selectedSessionRef.current = { ...currentSession, ...patch };
    setSelectedSession((current) => (current && ids.has(current.id) ? { ...current, ...patch } : current));
    setSessionsByProject((current) => ({
      ...current,
      [projectId]: (current[projectId] || []).map((item) => (ids.has(item.id) ? { ...item, ...patch } : item))
    }));

    const sessionId = payload.sessionId || (!isDraftSession(currentSession) ? currentSession.id : '');
    if (!sessionId || isDraftSession(sessionId)) {
      return;
    }
    const syncKey = `${projectId}:${sessionId}:${nextTitle}`;
    if (autoTitleSyncRef.current.has(syncKey)) {
      return;
    }
    autoTitleSyncRef.current.add(syncKey);
    apiFetch(`/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      body: { title: nextTitle, auto: true }
    }).catch(() => {
      autoTitleSyncRef.current.delete(syncKey);
    });
  }

  async function performRenameSession(project, session, title) {
    if (!project?.id || !session?.id) {
      return;
    }

    const currentTitle = session.title || '对话';
    const nextTitle = String(title || '').trim().slice(0, 52);
    if (!nextTitle || nextTitle === currentTitle) {
      return;
    }

    const applyLocalTitle = () => {
      setSessionsByProject((current) => ({
        ...current,
        [project.id]: (current[project.id] || []).map((item) =>
          item.id === session.id ? { ...item, title: nextTitle, titleLocked: true } : item
        )
      }));
      if (selectedSessionRef.current?.id === session.id) {
        setSelectedSession((current) => (current ? { ...current, title: nextTitle, titleLocked: true } : current));
      }
    };

    if (isDraftSession(session)) {
      applyLocalTitle();
      return;
    }

    try {
      await apiFetch(`/api/projects/${encodeURIComponent(project.id)}/sessions/${encodeURIComponent(session.id)}`, {
        method: 'PATCH',
        body: { title: nextTitle }
      });
      applyLocalTitle();
      await refreshProjectSessions(project);
    } catch (error) {
      throw new Error(t('modal.renameFailed', { message: error.message }));
    }
  }

  async function performArchiveSession(project, session) {
    if (!project?.id || !session?.id) {
      return;
    }

    const wasSelected = selectedSessionRef.current?.id === session.id;
    const removeLocalSession = () => {
      setSessionsByProject((current) => ({
        ...current,
        [project.id]: (current[project.id] || []).filter((item) => item.id !== session.id)
      }));
      if (selectedSessionRef.current?.id === session.id) {
        selectedSessionRef.current = null;
      }
    };

    if (isDraftSession(session)) {
      clearNewDraftCache(project.id);
      removeLocalSession();
      if (wasSelected) {
        selectProjectDraft(project, { updateRoute: 'replace', ignoreCache: true });
      }
      return;
    }

    try {
      await apiFetch(`/api/projects/${encodeURIComponent(project.id)}/sessions/${encodeURIComponent(session.id)}`, {
        method: 'DELETE'
      });
      removeLocalSession();
      await refreshProjectSessions(project);
      if (wasSelected) {
        selectProjectDraft(project, { updateRoute: 'replace' });
      }
    } catch (error) {
      const message = String(error.message || '');
      throw new Error(
        message.toLowerCase().includes('running')
          ? t('modal.archiveRunning')
          : t('modal.archiveFailed', { message })
      );
    }
  }

  function handleRenameSession(project, session) {
    if (!project?.id || !session?.id) {
      return;
    }
    setSessionModal({ type: 'rename', project, session });
  }

  function handleDeleteSession(project, session) {
    if (!project?.id || !session?.id) {
      return;
    }
    setSessionModal({ type: 'archive', project, session });
  }

  async function handleConfirmSessionModal(value) {
    if (!sessionModal) {
      return;
    }
    if (sessionModal.type === 'rename') {
      await performRenameSession(sessionModal.project, sessionModal.session, value);
    } else if (sessionModal.type === 'archive') {
      await performArchiveSession(sessionModal.project, sessionModal.session);
    }
    setSessionModal(null);
  }

  async function handleDeleteMessage(message) {
    if (!message?.id) {
      return;
    }
    if (!window.confirm(t('message.deleteConfirm'))) {
      return;
    }

    const messageId = String(message.id);
    const sessionId = selectedSessionRef.current?.id || message.sessionId || '';
    const existingIndex = messages.findIndex((item) => String(item.id) === messageId);
    const removedMessage = existingIndex >= 0 ? messages[existingIndex] : message;
    setMessages((current) => current.filter((item) => String(item.id) !== messageId));

    if (!sessionId || isDraftSession({ id: sessionId })) {
      return;
    }

    try {
      await apiFetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}`,
        { method: 'DELETE' }
      );
    } catch (error) {
      setMessages((current) => {
        if (current.some((item) => String(item.id) === messageId)) {
          return current;
        }
        const next = [...current];
        const insertAt = existingIndex >= 0 ? Math.min(existingIndex, next.length) : next.length;
        next.splice(insertAt, 0, removedMessage);
        return next;
      });
      window.alert(t('message.deleteFailed', { message: error.message }));
    }
  }

  function handleNewConversation(projectOverride = null) {
    const project = projectOverride || selectedProject || projects[0];
    if (!project) {
      return;
    }
    selectProjectDraft(project, { updateRoute: 'push' });
    setDrawerOpen(false);
  }

  async function handleUploadFiles(files) {
    setUploading(true);
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        const result = await apiFetch('/api/uploads', {
          method: 'POST',
          body: formData
        });
        setAttachments((current) => [...current, result.upload]);
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `upload-error-${Date.now()}`,
          role: 'activity',
          content: error.message,
          timestamp: new Date().toISOString()
        }
      ]);
    } finally {
      setUploading(false);
    }
  }

  function handleRemoveAttachment(id) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  function turnMatchesCurrentSelection(turnId, optimisticSessionId, realSessionId, previousSessionId) {
    const current = selectedSessionRef.current;
    if (!current) {
      return true;
    }
    return (
      current.id === optimisticSessionId ||
      current.id === realSessionId ||
      current.id === previousSessionId ||
      current.turnId === turnId ||
      current.draft
    );
  }

  function applyTurnSession(turn, optimisticSessionId, projectId, previousSessionId) {
    const sessionIdText = String(turn.sessionId || '');
    const realSessionId =
      sessionIdText && !sessionIdText.startsWith('draft-') && !sessionIdText.startsWith('codex-')
        ? sessionIdText
        : null;
    if (!realSessionId) {
      return null;
    }

    const currentSession = selectedSessionRef.current;
    const nextSession = {
      ...(currentSession || {}),
      id: realSessionId,
      projectId,
      title: currentSession?.title || '新对话',
      cwd: turn.workingDirectory || turn.targetProjectPath || currentSession?.cwd || null,
      runMode: turn.runMode || currentSession?.runMode || null,
      requestedRunMode: turn.requestedRunMode || currentSession?.requestedRunMode || null,
      worktree: turn.worktree || currentSession?.worktree || null,
      turnId: turn.turnId || currentSession?.turnId || null,
      updatedAt: turn.completedAt || turn.updatedAt || new Date().toISOString(),
      draft: false
    };

    setSelectedSession((current) => {
      if (!current) {
        return nextSession;
      }
      if (!turnMatchesCurrentSelection(turn.turnId, optimisticSessionId, realSessionId, previousSessionId)) {
        return current;
      }
      return { ...current, ...nextSession };
    });
    setSessionsByProject((current) =>
      upsertSessionInProject(current, projectId, nextSession, previousSessionId || optimisticSessionId)
    );
    setMessages((current) =>
      current.map((message) =>
        message.turnId === turn.turnId || message.sessionId === optimisticSessionId || message.sessionId === previousSessionId
          ? { ...message, sessionId: realSessionId }
          : message
      )
    );
    if (turn.status === 'running' || turn.status === 'queued') {
      markRun({ turnId: turn.turnId, sessionId: realSessionId, previousSessionId: previousSessionId || optimisticSessionId });
    }
    return realSessionId;
  }

  async function loadTurnMessages(realSessionId, turnId, optimisticSessionId, previousSessionId) {
    if (!realSessionId) {
      return false;
    }
    const current = selectedSessionRef.current;
    if (
      current &&
      current.id !== realSessionId &&
      current.id !== optimisticSessionId &&
      current.id !== previousSessionId &&
      current.turnId !== turnId
    ) {
      return false;
    }
    const data = await apiFetch(sessionMessagesApiPath(realSessionId));
    if (data.messages?.length && hasVisibleAssistantForTurn(data.messages, { turnId })) {
      setContextStatus((current) => mergeContextStatus(current, data.context || DEFAULT_STATUS.context, DEFAULT_STATUS.context));
      setMessages((currentMessages) =>
        mergeLoadedMessagesPreservingActivity(currentMessages, data.messages, {
          sessionId: realSessionId,
          previousSessionId,
          turnId
        })
      );
      return true;
    }
    return false;
  }

  async function pollTurnUntilComplete({ turnId, optimisticSessionId, projectId, previousSessionId }) {
    if (!turnId || activePollsRef.current.has(turnId)) {
      return;
    }
    activePollsRef.current.add(turnId);
    const startedAt = Date.now();
    try {
      while (Date.now() - startedAt < 1800000) {
        await new Promise((resolve) => window.setTimeout(resolve, 1400));
        let turn = null;
        try {
          const result = await apiFetch(`/api/chat/turns/${encodeURIComponent(turnId)}`);
          turn = result.turn;
        } catch {
          continue;
        }
        if (!turn) {
          continue;
        }

        const realSessionId = applyTurnSession(turn, optimisticSessionId, projectId, previousSessionId);
        if (turn.status === 'failed') {
          clearRun({ turnId, sessionId: realSessionId || optimisticSessionId, previousSessionId });
          setMessages((current) =>
            upsertStatusMessage(current, {
              sessionId: realSessionId || optimisticSessionId,
              turnId,
              kind: 'turn',
              status: 'failed',
              label: t('toast.taskFailed'),
              detail: turn.error || turn.detail || t('toast.taskFailed')
            })
          );
          break;
        }
        if (turn.status === 'aborted') {
          clearRun({ turnId, sessionId: realSessionId || optimisticSessionId, previousSessionId });
          setMessages((current) =>
            upsertStatusMessage(current, {
              sessionId: realSessionId || optimisticSessionId,
              turnId,
              kind: 'turn',
              status: 'completed',
              label: t('toast.aborted')
            })
          );
          break;
        }
        if (turn.status === 'completed') {
          const terminalPayload = {
            sessionId: realSessionId || optimisticSessionId,
            turnId,
            previousSessionId,
            startedAt: turn.startedAt || '',
            completedAt: turn.completedAt || turn.updatedAt || '',
            durationMs: turn.durationMs || null,
            detail: turn.detail || ''
          };
          if (turn.context) {
            setContextStatus((current) => mergeContextStatus(current, turn.context, DEFAULT_STATUS.context));
          }
          markSessionCompleteNotice(terminalPayload);
          markTurnCompleted(terminalPayload);
          const loaded = await loadTurnMessages(realSessionId, turnId, optimisticSessionId, previousSessionId);
          if (loaded) {
            clearRun(terminalPayload);
          } else {
            scheduleTurnRefresh({
              sessionId: realSessionId || optimisticSessionId,
              turnId,
              previousSessionId,
              startedAt: turn.startedAt || '',
              completedAt: turn.completedAt || turn.updatedAt || '',
              durationMs: turn.durationMs || null,
              hadAssistantText: turn.hadAssistantText || Boolean(turn.assistantPreview),
              usage: turn.usage || null
            });
          }
          break;
        }
      }
    } finally {
      activePollsRef.current.delete(turnId);
    }
  }

  function selectedSkillsForTurn() {
    const selected = new Set(selectedSkillPaths);
    return (Array.isArray(status.skills) ? status.skills : [])
      .filter((skill) => selected.has(skill.path))
      .map((skill) => ({
        name: skill.name || skill.label,
        path: skill.path
      }));
  }

  function dismissToast(id) {
    const timer = toastTimersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  function showToast(toast) {
    const id = toast.id || `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const nextToast = {
      id,
      level: toast.level || 'info',
      title: toast.title || t('toast.notice'),
      body: toast.body || ''
    };
    setToasts((current) => [nextToast, ...current.filter((item) => item.id !== id)].slice(0, 4));
    if (toastTimersRef.current.has(id)) {
      window.clearTimeout(toastTimersRef.current.get(id));
    }
    const timer = window.setTimeout(() => dismissToast(id), toast.durationMs || 5200);
    toastTimersRef.current.set(id, timer);
    return id;
  }

  function maybeSendWebNotification(notification) {
    if (!notification) {
      return;
    }
    if (browserPushSupported()) {
      return;
    }
    if (!shouldUseWebNotification({
      enabled: notificationsEnabled,
      permission: notificationPermission,
      visibilityState: document.visibilityState,
      standalone: isStandalonePwa()
    })) {
      return;
    }
    try {
      new Notification(notification.title, {
        body: notification.body,
        tag: `codexmobile-${notification.title}`,
        silent: false
      });
    } catch {
      // Browser notification support varies across mobile browsers.
    }
  }

  function notifyFromPayload(payload) {
    const notification = notificationFromPayload(payload);
    if (!notification) {
      return;
    }
    showToast(notification);
    maybeSendWebNotification(notification);
  }

  async function enableNotifications() {
    const pushSupported = browserPushSupported();
    const standalone = isStandalonePwa();
    const secureContext = Boolean(window.isSecureContext);
    if (!pushSupported || !secureContext || !standalone) {
      showToast({
        level: 'warning',
        title: t('toast.notificationUnavailable'),
        body: notificationEnablementMessage({ supported: pushSupported, secureContext, standalone }),
        durationMs: 7000
      });
      return;
    }
    try {
      const result = await registerWebPush({ apiFetch });
      setNotificationPermission(result.permission);
      setNotificationsEnabled(true);
      setNotificationPreferenceEnabled(true);
      showToast({
        level: 'success',
        title: t('toast.notificationsEnabled'),
        body: notificationEnablementMessage({ supported: true, secureContext: true, standalone: true })
      });
    } catch (error) {
      setNotificationPermission(browserNotificationPermission());
      setNotificationsEnabled(false);
      setNotificationPreferenceEnabled(false);
      showToast({
        level: error.code === 'permission-denied' ? 'warning' : 'error',
        title: error.code === 'permission-denied' ? t('toast.notificationDenied') : t('toast.notificationFailed'),
        body: error.message || t('toast.notificationFailedBody'),
        durationMs: 7000
      });
    }
  }

  function toggleSelectedSkill(path) {
    const value = String(path || '').trim();
    if (!value) {
      return;
    }
    setSelectedSkillPaths((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    );
  }

  function selectSkill(path) {
    const value = String(path || '').trim();
    if (!value) {
      return;
    }
    setSelectedSkillPaths((current) => current.includes(value) ? current : [...current, value]);
  }

  function clearSelectedSkills() {
    setSelectedSkillPaths([]);
  }

  function addFileMention(file) {
    const pathValue = String(file?.path || '').trim();
    if (!pathValue) {
      return;
    }
    setFileMentions((current) => {
      if (current.some((item) => item.path === pathValue)) {
        return current;
      }
      return [
        ...current,
        {
          name: file.name || pathValue.split('/').pop() || pathValue,
          path: pathValue,
          relativePath: file.relativePath || file.name || pathValue
        }
      ].slice(0, 12);
    });
  }

  function removeFileMention(pathValue) {
    setFileMentions((current) => current.filter((item) => item.path !== pathValue));
  }

  function queueQueryForSession(session = selectedSessionRef.current) {
    if (!session?.id) {
      return '';
    }
    if (isDraftSession(session)) {
      return `draftSessionId=${encodeURIComponent(session.id)}`;
    }
    return `sessionId=${encodeURIComponent(session.id)}`;
  }

  async function loadQueueDrafts(session = selectedSessionRef.current) {
    const query = queueQueryForSession(session);
    if (!query) {
      setQueueDrafts([]);
      return;
    }
    try {
      const result = await apiFetch(`/api/chat/queue?${query}`);
      setQueueDrafts(Array.isArray(result.drafts) ? result.drafts : []);
    } catch {
      setQueueDrafts([]);
    }
  }

  async function removeQueueDraft(draftId) {
    const session = selectedSessionRef.current;
    const body = {
      sessionId: isDraftSession(session) ? null : session?.id,
      draftSessionId: isDraftSession(session) ? session?.id : null,
      draftId
    };
    await apiFetch('/api/chat/queue', { method: 'DELETE', body }).catch(() => null);
    await loadQueueDrafts(session);
  }

  async function restoreQueueDraft(draftId) {
    const session = selectedSessionRef.current;
    const body = {
      sessionId: isDraftSession(session) ? null : session?.id,
      draftSessionId: isDraftSession(session) ? session?.id : null,
      draftId
    };
    const result = await apiFetch('/api/chat/queue/restore', { method: 'POST', body }).catch(() => null);
    const draft = result?.draft;
    if (!draft) {
      await loadQueueDrafts(session);
      return;
    }
    setInput(draft.text || '');
    setAttachments(Array.isArray(draft.attachments) ? draft.attachments : []);
    setFileMentions(Array.isArray(draft.fileMentions) ? draft.fileMentions : []);
    setSelectedSkillPaths((Array.isArray(draft.selectedSkills) ? draft.selectedSkills : [])
      .map((skill) => skill.path)
      .filter(Boolean));
    await loadQueueDrafts(session);
  }

  async function steerQueueDraft(draftId) {
    const session = selectedSessionRef.current;
    const body = {
      projectId: selectedProjectRef.current?.id || selectedProject?.id,
      sessionId: isDraftSession(session) ? null : session?.id,
      draftSessionId: isDraftSession(session) ? session?.id : null,
      draftId
    };
    await apiFetch('/api/chat/queue/steer', { method: 'POST', body }).catch(() => null);
    await loadQueueDrafts(session);
  }

  async function submitCodexMessage({
    message,
    attachmentsForTurn = [],
    fileMentionsForTurn = [],
    clearComposer = false,
    restoreTextOnError = false,
    sendMode = 'start'
  }) {
    const project = selectedProject || selectedProjectRef.current;
    const selectedAttachments = Array.isArray(attachmentsForTurn) ? attachmentsForTurn : [];
    const selectedFileMentions = Array.isArray(fileMentionsForTurn) ? fileMentionsForTurn : [];
    const displayMessage =
      String(message || '').trim() ||
      (selectedAttachments.length ? t('composer.checkAttachments') : (selectedFileMentions.length ? t('composer.checkFileReferences') : ''));
    if ((!displayMessage && !selectedAttachments.length && !selectedFileMentions.length) || !project) {
      if (restoreTextOnError && displayMessage) {
        restoreVoiceTextToInput(displayMessage);
      }
      throw new Error(project ? 'message or attachments are required' : t('toast.selectProject'));
    }

    let sessionForTurn = selectedSession;
    if (!sessionForTurn) {
      sessionForTurn = selectProjectDraft(project, { updateRoute: 'replace' }) || createDraftSession(project);
    }

    const turnId = createClientTurnId();
    const draftSessionId = isDraftSession(sessionForTurn) ? sessionForTurn.id : null;
    const outgoingSessionId = draftSessionId ? null : sessionForTurn?.id || null;
    const optimisticSessionId = draftSessionId || outgoingSessionId || turnId;
    const runModeForTurn = draftSessionId
      ? runMode
      : sessionEffectiveRunMode(sessionForTurn, selectedRuntime, runMode);
    const initialTitle = draftSessionId && !sessionForTurn.titleLocked
      ? titleFromFirstMessage(displayMessage)
      : null;
    const optimisticContent = contentWithAttachmentPreviews(displayMessage, selectedAttachments);

    if (clearComposer) {
      setInput('');
      setAttachments([]);
      setFileMentions([]);
    }

    markRun({
      turnId,
      sessionId: optimisticSessionId,
      previousSessionId: draftSessionId || outgoingSessionId,
      runMode: runModeForTurn,
      workingDirectory: !draftSessionId ? sessionForTurn?.cwd || selectedRuntime?.workingDirectory || null : null
    });
    setSelectedSession((current) =>
      current?.id === sessionForTurn?.id
        ? { ...current, turnId, ...autoTitlePatch(initialTitle) }
        : current
    );
    setSessionsByProject((current) => ({
      ...current,
      [project.id]: (current[project.id] || []).map((item) =>
        item.id === sessionForTurn.id
          ? { ...item, turnId, ...autoTitlePatch(initialTitle) }
          : item
      )
    }));
    const submittedAt = new Date().toISOString();
    setMessages((current) =>
      upsertStatusMessage(
        [
          ...current,
          {
            id: `local-${Date.now()}`,
            role: 'user',
            content: optimisticContent,
            timestamp: submittedAt,
            sessionId: optimisticSessionId,
            turnId
          }
        ],
        {
          sessionId: optimisticSessionId,
          turnId,
          kind: 'reasoning',
          status: 'running',
          label: t('activity.thinking'),
          timestamp: submittedAt,
          startedAt: submittedAt
        }
      )
    );

    try {
      const result = await apiFetch('/api/chat/send', {
        method: 'POST',
        body: {
          projectId: project.id,
          sessionId: outgoingSessionId,
          draftSessionId,
          clientTurnId: turnId,
          message: displayMessage,
          permissionMode,
          runMode: runModeForTurn,
          model: selectedModel || status.model,
          reasoningEffort: selectedReasoningEffort || status.reasoningEffort || DEFAULT_REASONING_EFFORT,
          selectedSkills: selectedSkillsForTurn(),
          attachments: selectedAttachments,
          fileMentions: selectedFileMentions,
          sendMode
        }
      });
      const resultTurnId = result.turnId || turnId;
      const resultSessionId = result.sessionId || optimisticSessionId;
      if (draftSessionId && isConcreteSessionId(resultSessionId)) {
        clearNewDraftCache(project.id);
        navigateAppRoute(sessionRoutePath(project.id, resultSessionId), { replace: true });
      }
      if (result.desktopBridge?.mode === 'desktop-ipc') {
        rememberDesktopIpcPendingRun(resultSessionId, {
          message: displayMessage,
          turnId: resultTurnId,
          clientTurnId: turnId,
          previousSessionId: draftSessionId || outgoingSessionId,
          startedAt: submittedAt
        });
        markRun({
          turnId: resultTurnId,
          sessionId: resultSessionId,
          previousSessionId: draftSessionId || outgoingSessionId
        });
        return {
          turnId: resultTurnId,
          optimisticSessionId,
          projectId: project.id,
          previousSessionId: draftSessionId || outgoingSessionId
        };
      }
      pollTurnUntilComplete({
        turnId: resultTurnId,
        optimisticSessionId,
        projectId: project.id,
        previousSessionId: draftSessionId || outgoingSessionId
      });
      return {
        turnId: resultTurnId,
        optimisticSessionId,
        projectId: project.id,
        previousSessionId: draftSessionId || outgoingSessionId
      };
    } catch (error) {
      clearRun({ turnId, sessionId: optimisticSessionId, previousSessionId: draftSessionId || outgoingSessionId });
      if (clearComposer) {
        setAttachments(selectedAttachments);
        setFileMentions(selectedFileMentions);
        if (String(message || '').trim()) {
          setInput(String(message).trim());
        }
      }
      if (restoreTextOnError) {
        restoreVoiceTextToInput(displayMessage);
      }
      setMessages((current) =>
        upsertStatusMessage(current, {
          sessionId: optimisticSessionId,
          turnId,
          kind: 'turn',
          status: 'failed',
          label: t('activity.sendFailed'),
          detail: error.message,
          timestamp: new Date().toISOString()
        })
      );
      throw error;
    }
  }

  async function abortCurrentRun() {
    const abortId =
      selectedSessionRef.current?.id ||
      selectedSessionRef.current?.turnId ||
      Object.keys(runningByIdRef.current || runningById)[0];
    if (!abortId) {
      return false;
    }
    await apiFetch('/api/chat/abort', {
      method: 'POST',
      body: { sessionId: abortId, turnId: selectedSessionRef.current?.turnId || null }
    }).catch(() => null);
    desktopIpcPendingRunsRef.current.delete(abortId);
    clearRun({ sessionId: abortId, turnId: selectedSessionRef.current?.turnId || null });
    return true;
  }

  async function handleSubmit({ mode = 'start' } = {}) {
    const message = input.trim();
    if ((!message && !attachments.length && !fileMentions.length) || !selectedProject) {
      return;
    }
    try {
      await submitCodexMessage({
        message,
        attachmentsForTurn: attachments,
        fileMentionsForTurn: fileMentions,
        clearComposer: true,
        sendMode: mode === 'guide' ? 'interrupt' : mode
      });
      await loadQueueDrafts(selectedSessionRef.current);
    } catch {
      // submitCodexMessage already reflects the failure in the chat UI.
    }
  }

  async function handleGitAction(action) {
    if (!selectedProject || running) {
      return;
    }
    setGitPanel({ open: true, action });
  }

  function handleOpenWorkspace(tab = 'changes') {
    if (!selectedProject) {
      showToast({ level: 'error', title: t('toast.selectProject') });
      return;
    }
    setWorkspacePanel({ open: true, tab });
  }

  function handleOpenTerminal() {
    if (!selectedProject) {
      showToast({ level: 'error', title: t('toast.selectProject') });
      return;
    }
    setTerminalOpen(true);
  }

  function restoreVoiceTextToInput(text) {
    const value = String(text || '').trim();
    if (!value) {
      return;
    }
    setInput((current) => {
      const base = String(current || '').trimEnd();
      if (!base) {
        return value;
      }
      if (base.includes(value)) {
        return current;
      }
      return `${base}\n${value}`;
    });
  }

  async function handleVoiceSubmit(transcript) {
    const message = String(transcript || '').trim();
    if (!message) {
      throw new Error('没有识别到文字');
    }
    restoreVoiceTextToInput(message);
    return { appended: true };
  }

  async function handleAbort() {
    await abortCurrentRun();
  }

  async function handleConnectDocs() {
    if (docsBusy) {
      return;
    }
    setDocsBusy(true);
    setDocsError('');
    try {
      const result = await apiFetch('/api/feishu/cli/auth/start', { method: 'POST' });
      if (result.docs) {
        setStatus((current) => ({ ...current, docs: result.docs }));
      }
      if (!result.verificationUrl) {
        throw new Error(t('docs.noAuthUrl'));
      }
      window.location.assign(result.verificationUrl);
    } catch (error) {
      setDocsError(error.message || t('docs.connectFailed'));
      setDocsBusy(false);
    }
  }

  async function handleDisconnectDocs() {
    if (docsBusy) {
      return;
    }
    setDocsBusy(true);
    setDocsError('');
    try {
      await apiFetch('/api/feishu/cli/auth/logout', { method: 'POST' });
      await loadStatus();
    } catch (error) {
      setDocsError(error.message || t('docs.disconnectFailed'));
    } finally {
      setDocsBusy(false);
    }
  }

  async function handleRefreshDocs() {
    if (docsBusy) {
      return;
    }
    setDocsBusy(true);
    setDocsError('');
    try {
      await loadStatus();
    } catch (error) {
      setDocsError(error.message || t('docs.refreshFailed'));
    } finally {
      setDocsBusy(false);
    }
  }

  function handleOpenDocsHome() {
    const docsUrl = String(status.docs?.homeUrl || 'https://docs.feishu.cn/').trim();
    if (docsUrl) {
      window.location.assign(docsUrl);
    }
  }

  function handleOpenDocsAuth(url) {
    const authUrl = String(url || '').trim();
    if (authUrl) {
      window.location.assign(authUrl);
    }
  }

  const shellClass = useMemo(() => (drawerOpen ? 'app-shell drawer-active' : 'app-shell'), [drawerOpen]);
  const visibleContextStatus = useMemo(
    () => {
      if (!selectedSession || isDraftSession(selectedSession)) {
        return emptyContextStatus();
      }
      return normalizeContextStatus(contextStatus || selectedSession.context || DEFAULT_STATUS.context, DEFAULT_STATUS.context);
    },
    [contextStatus, selectedSession]
  );
  const notificationSupported = browserPushSupported();
  const recoveryState = connectionRecoveryState({
    authenticated,
    connectionState,
    desktopBridge: status.desktopBridge,
    syncing
  });
  const showingWelcome = appRoute.type === 'welcome';
  const showingSettings = appRoute.type === 'settings';

  if (!authenticated) {
    return (
      <I18nContext.Provider value={i18n}>
        <PairingScreen onPaired={bootstrap} />
      </I18nContext.Provider>
    );
  }

  return (
    <I18nContext.Provider value={i18n}>
    <div className={shellClass}>
      <TopBar
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        view={showingSettings ? 'settings' : showingWelcome ? 'welcome' : 'chat'}
        runMode={effectiveRunMode}
        onMenu={() => setDrawerOpen(true)}
        onOpenWorkspace={handleOpenWorkspace}
        onOpenTerminal={handleOpenTerminal}
        onGitAction={handleGitAction}
        onRenameSession={handleRenameSession}
        onArchiveSession={handleDeleteSession}
        notificationSupported={notificationSupported}
        notificationEnabled={notificationsEnabled && notificationPermission === 'granted'}
        onEnableNotifications={enableNotifications}
        gitDisabled={!selectedProject || running}
      />
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        status={status}
        connectionState={connectionState}
        projects={projects}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        expandedProjectIds={expandedProjectIds}
        sessionsByProject={sessionsByProject}
        loadingProjectId={loadingProjectId}
        runningById={runningById}
        threadRuntimeById={threadRuntimeById}
        completedSessionIds={completedSessionIds}
        quotaSnapshot={quotaSnapshot}
        onToggleProject={handleToggleProject}
        onSelectSession={handleSelectSession}
        onRenameSession={handleRenameSession}
        onDeleteSession={handleDeleteSession}
        onNewConversation={handleNewConversation}
        onOpenSettings={() => {
          navigateAppRoute(settingsRoutePath());
          setDrawerOpen(false);
        }}
      />
      <DocsPanel
        open={docsOpen}
        docs={status.docs}
        busy={docsBusy}
        error={docsError}
        onClose={() => setDocsOpen(false)}
        onConnect={handleConnectDocs}
        onDisconnect={handleDisconnectDocs}
        onOpenHome={handleOpenDocsHome}
        onOpenAuth={handleOpenDocsAuth}
        onRefresh={handleRefreshDocs}
      />
      <GitPanel
        open={gitPanel.open}
        action={gitPanel.action}
        project={selectedWorkspaceTarget}
        onToast={showToast}
        onClose={() => setGitPanel((current) => ({ ...current, open: false }))}
      />
      <WorkspacePanel
        open={workspacePanel.open}
        initialTab={workspacePanel.tab}
        project={selectedWorkspaceTarget}
        onToast={showToast}
        onClose={() => setWorkspacePanel((current) => ({ ...current, open: false }))}
      />
      <TerminalPanel
        open={terminalOpen}
        project={selectedWorkspaceTarget}
        connectionState={connectionState}
        onToast={showToast}
        onRegisterTerminal={registerTerminalHandler}
        onSendTerminal={sendTerminalMessage}
        onClose={() => setTerminalOpen(false)}
      />
      {showingWelcome || showingSettings ? null : (
        <ConnectionRecoveryCard
          state={recoveryState}
          onRetry={handleRetryConnection}
          onSync={handleSync}
          onPair={handleResetPairing}
          onStatus={handleShowConnectionStatus}
        />
      )}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      {showingWelcome ? (
        <WelcomePane projects={projects} onNewConversation={handleNewConversation} />
      ) : showingSettings ? (
        <SettingsPage
          status={status}
          languageSetting={languageSetting}
          setLanguageSetting={setLanguageSetting}
          themeSetting={themeSetting}
          setThemeSetting={setThemeSetting}
          onOpenDocs={() => setDocsOpen(true)}
        />
      ) : (
        <>
          <ChatPane
            messages={messages}
            selectedSession={selectedSession}
            running={running}
            now={activityClockNow}
            onPreviewImage={setPreviewImage}
            onDeleteMessage={handleDeleteMessage}
          />
          <Composer
            input={input}
            setInput={setInput}
            selectedProject={selectedProject}
            selectedSession={selectedSession}
            onSubmit={handleSubmit}
            running={running}
            onAbort={handleAbort}
            models={status.models}
            selectedModel={selectedModel}
            onSelectModel={setSelectedModel}
            selectedReasoningEffort={selectedReasoningEffort}
            onSelectReasoningEffort={setSelectedReasoningEffort}
            skills={status.skills}
            selectedSkillPaths={selectedSkillPaths}
            onToggleSkill={toggleSelectedSkill}
            onSelectSkill={selectSkill}
            onClearSkills={clearSelectedSkills}
            permissionMode={permissionMode}
            onSelectPermission={setPermissionMode}
            runMode={runMode}
            effectiveRunMode={effectiveRunMode}
            canSelectRunMode={canSelectRunMode}
            onSelectRunMode={setRunMode}
            attachments={attachments}
            onUploadFiles={handleUploadFiles}
            onRemoveAttachment={handleRemoveAttachment}
            fileMentions={fileMentions}
            onAddFileMention={addFileMention}
            onRemoveFileMention={removeFileMention}
            uploading={uploading}
            contextStatus={visibleContextStatus}
            runStatus={composerRunStatus ? { ...composerRunStatus, steerable: selectedRuntime?.steerable !== false } : null}
            desktopBridge={status.desktopBridge}
            queueDrafts={queueDrafts}
            onRestoreQueueDraft={restoreQueueDraft}
            onRemoveQueueDraft={removeQueueDraft}
            onSteerQueueDraft={steerQueueDraft}
            connectionState={connectionState}
            voiceState={voiceDialogState}
            voiceError={voiceDialogError}
            voiceTranscription={status.voiceTranscription}
            onVoiceTranscribe={openVoiceTranscriptionDialog}
          />
        </>
      )}
      <SessionActionModal
        action={sessionModal}
        onClose={() => setSessionModal(null)}
        onConfirm={handleConfirmSessionModal}
      />
      <VoiceDialogPanel
        open={voiceDialogOpen}
        state={voiceDialogState}
        error={voiceDialogError}
        transcript={voiceDialogTranscript}
        assistantText={voiceDialogAssistantText}
        handoffDraft={voiceDialogHandoffDraft}
        onHandoffDraftChange={setVoiceDialogHandoffDraftValue}
        onHandoffSubmit={submitVoiceHandoffToCodex}
        onHandoffContinue={continueVoiceHandoffCollection}
        onHandoffCancel={cancelVoiceHandoffConfirmation}
        onStart={startVoiceDialogRecording}
        onStop={stopVoiceDialogRecording}
        onClose={closeVoiceDialog}
      />
      <ImagePreviewModal image={previewImage} onClose={() => setPreviewImage(null)} />
    </div>
    </I18nContext.Provider>
  );
}
