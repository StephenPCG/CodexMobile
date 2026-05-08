# Changelog

All notable changes to CodexMobile are tracked here.

## Unreleased

### Added

- Added per-project mobile draft creation so a new conversation can choose Local or New worktree before the first send, then start through the headless local Codex path.
- Added backend Codex quota caching with startup, scheduled hourly, and manual refresh paths.
- Added an xterm-based browser Terminal with PTY-backed color output, direct keyboard input, a blinking cursor, paste, and mobile quick keys.
- Added mobile workspace tools for Changes, Directories, file previews, and diff viewing.
- Added a browser Terminal panel with multi-tab-safe backend terminal sessions.
- Added a queue panel for running conversations: queued drafts can be viewed, restored, deleted, or sent immediately as steer input.
- Added composer shortcuts with `/` commands for status, context compaction, code review, and sub-agent workflows.
- Added `$skill` autocomplete backed by the existing skills list.
- Added `@file` search backed by a project-local file search API that ignores generated and dependency directories.
- Added file mention support for chat sends so selected local paths can be attached as context.
- Added an expanded Git panel with status, diff preview, pull, sync, and commit+push actions.
- Added foreground toast notifications for Git progress, task completion, failures, and user-input prompts.
- Added Web Push support for installed HTTPS PWAs, including service worker handling and server-side subscription storage.
- Added a compact connection recovery card for reconnecting, syncing, repairing pairing, and checking status.
- Added route-addressable welcome, per-project new-conversation, and conversation pages for refresh-safe navigation.

### Changed

- Replaced rename/archive browser prompts with in-app modal dialogs.
- Persisted per-project new-conversation composer drafts, including text, attachments, file mentions, and run mode.
- Show the active Local/Worktree mode in the header subtitle and keep the composer run-mode switch only on new conversations.
- Removed ambiguous drawer-level new-conversation and manual sync controls; project rows keep explicit new-conversation actions while startup sync remains automatic.
- Reworked Settings Codex details into environment information with host, OS, Codex connection mode, and Codex CLI details.
- Reduced the empty composer height and softened the connection status label.
- Render memory citation tails as collapsible cards, hide internal git directives, and proxy local-path Markdown images through the backend.
- Removed duplicate per-project "+ 新对话" buttons while preserving the draft-style new conversation row.
- Moved workspace and Terminal entry points into the top More menu, and made the header show conversation title above project name.
- Moved Feishu Docs into Settings, simplified the top More menu Git actions to Git Panel, and grouped conversation actions with unified wording.
- Reworked the drawer quota widget into a compact Rate limits remaining card with cached data, update time, and icon-only refresh.
- Added top More menu actions for renaming and archiving the current conversation.
- Reworked voice transcription into an inline composer control that records, processes, and appends text without opening a confirmation dialog.
- Moved server connection status above the composer.
- Updated the dev workflow so `npm run dev` starts both frontend and backend with hot reload.
- Scoped Local/New worktree selection to new conversations while showing the active run mode for existing sessions.
- Routed Changes, Directories, and Terminal views through the selected session working directory, including Codex worktrees.
- Tightened composer controls with compact model, reasoning, permission, attachment, ASR, and send/stop actions.
- Auto-select the Codex communication transport at startup, preferring headless local Codex on Linux/non-Desktop hosts.
- Improved local Codex session grouping and status recovery when desktop bridge data is unavailable.
- Kept completed task activity collapsed by default while preserving the full execution text when expanded.
- Improved mobile activity rendering and reduced noisy lifecycle messages.
- Rewrote README to describe CodexMobile as a local Codex mobile workbench rather than a thin upstream UI fork.
- Updated package metadata to describe the current mobile workbench scope.

### Fixed

- Hid synthetic AGENTS.md instruction messages from chat history.
- Fixed a white-screen crash after the first assistant update in newly created conversations.

### Notes

- iOS background notifications require an HTTPS Home Screen PWA. Local HTTP access still works for chat, sync, and foreground toast.
- `sync` is defined as `pull --ff-only` followed by `push` when the branch is ahead.
