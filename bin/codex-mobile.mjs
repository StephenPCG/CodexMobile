#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CONFIG_PATH,
  DEFAULT_LOG_DIR,
  ensureCodexMobileConfig,
  expandHome,
  loadCodexMobileConfig
} from '../server/runtime-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
const SERVICE_LABEL = 'com.codexmobile.app';
const SYSTEMD_SERVICE_NAME = 'codex-mobile.service';

function usage() {
  return `CodexMobile ${PACKAGE_JSON.version}

Usage:
  codex-mobile start [--config ~/.codex-mobile/config.yaml]
  codex-mobile install-service [--config ~/.codex-mobile/config.yaml]
  codex-mobile uninstall-service
  codex-mobile install-asr-docker [--rebuild] [--recreate]
  codex-mobile asr-status
  codex-mobile config-path
  codex-mobile --version
`;
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift() || 'help';
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--config' || arg === '-c') {
      options.config = args[index + 1];
      index += 1;
    } else if (arg === '--no-start') {
      options.start = false;
    } else if (arg === '--rebuild') {
      options.rebuild = true;
    } else if (arg === '--recreate') {
      options.recreate = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }
  return { command, options };
}

function resolveConfigPath(value) {
  return path.resolve(expandHome(value || process.env.CODEXMOBILE_CONFIG_PATH || DEFAULT_CONFIG_PATH));
}

function ensureLogDir(logDir = process.env.CODEXMOBILE_LOG_DIR || DEFAULT_LOG_DIR) {
  const resolved = path.resolve(expandHome(logDir));
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function formatLogArg(arg) {
  if (arg instanceof Error) {
    return arg.stack || arg.message;
  }
  if (typeof arg === 'string') {
    return arg;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function installConsoleLogTee(logDir) {
  const logPath = path.join(logDir, 'codex-mobile.log');
  const stream = fs.createWriteStream(logPath, { flags: 'a' });
  for (const level of ['log', 'info', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      stream.write(`[${new Date().toISOString()}] [${level}] ${args.map(formatLogArg).join(' ')}\n`);
    };
  }
  process.on('exit', () => {
    stream.end();
  });
  return logPath;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function systemdQuote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function serviceCommand(configPath) {
  return [process.execPath, fileURLToPath(import.meta.url), 'start', '--config', configPath];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.stdio || 'pipe'
  });
  if (!options.allowFailure && result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`);
  }
  return result;
}

function installLaunchdService({ configPath, logDir, start = true }) {
  const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  const plistPath = path.join(plistDir, `${SERVICE_LABEL}.plist`);
  const uid = process.getuid?.();
  const domain = Number.isInteger(uid) ? `gui/${uid}` : 'gui';
  const args = serviceCommand(configPath);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(SERVICE_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((arg) => `    <string>${xmlEscape(arg)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(ROOT_DIR)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(path.join(logDir, 'service.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(path.join(logDir, 'service.err.log'))}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${xmlEscape(os.homedir())}</string>
    <key>PATH</key>
    <string>${xmlEscape(process.env.PATH || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin')}</string>
    <key>CODEXMOBILE_CONFIG_PATH</key>
    <string>${xmlEscape(configPath)}</string>
  </dict>
</dict>
</plist>
`;

  fs.mkdirSync(plistDir, { recursive: true });
  fs.writeFileSync(plistPath, plist, 'utf8');
  run('launchctl', ['bootout', domain, plistPath], { allowFailure: true });
  run('launchctl', ['remove', SERVICE_LABEL], { allowFailure: true });
  run('launchctl', ['bootstrap', domain, plistPath]);
  run('launchctl', ['enable', `${domain}/${SERVICE_LABEL}`], { allowFailure: true });
  if (start) {
    run('launchctl', ['kickstart', '-k', `${domain}/${SERVICE_LABEL}`], { allowFailure: true });
  }
  console.log(`Installed launchd service: ${plistPath}`);
}

function installSystemdUserService({ configPath, logDir, start = true }) {
  const serviceDir = path.join(os.homedir(), '.config', 'systemd', 'user');
  const servicePath = path.join(serviceDir, SYSTEMD_SERVICE_NAME);
  const args = serviceCommand(configPath).map(systemdQuote).join(' ');
  const unit = `[Unit]
Description=CodexMobile local bridge
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${ROOT_DIR}
ExecStart=${args}
Restart=on-failure
RestartSec=5
Environment=HOME=${os.homedir()}
Environment=PATH=${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}
Environment=CODEXMOBILE_CONFIG_PATH=${configPath}
StandardOutput=append:${path.join(logDir, 'service.out.log')}
StandardError=append:${path.join(logDir, 'service.err.log')}

[Install]
WantedBy=default.target
`;

  fs.mkdirSync(serviceDir, { recursive: true });
  fs.writeFileSync(servicePath, unit, 'utf8');
  const systemctl = ['systemctl', '--user'];
  run(systemctl[0], [...systemctl.slice(1), 'daemon-reload']);
  run(systemctl[0], [...systemctl.slice(1), 'enable', SYSTEMD_SERVICE_NAME]);
  if (start) {
    run(systemctl[0], [...systemctl.slice(1), 'restart', SYSTEMD_SERVICE_NAME]);
  }
  console.log(`Installed systemd user service: ${servicePath}`);
  console.log('If it should run before login after reboot, enable lingering manually: loginctl enable-linger "$USER"');
}

function uninstallLaunchdService() {
  const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
  const uid = process.getuid?.();
  const domain = Number.isInteger(uid) ? `gui/${uid}` : 'gui';
  run('launchctl', ['bootout', domain, plistPath], { allowFailure: true });
  run('launchctl', ['remove', SERVICE_LABEL], { allowFailure: true });
  if (fs.existsSync(plistPath)) {
    fs.unlinkSync(plistPath);
  }
  console.log(`Removed launchd service: ${SERVICE_LABEL}`);
}

function uninstallSystemdUserService() {
  const servicePath = path.join(os.homedir(), '.config', 'systemd', 'user', SYSTEMD_SERVICE_NAME);
  run('systemctl', ['--user', 'disable', '--now', SYSTEMD_SERVICE_NAME], { allowFailure: true });
  if (fs.existsSync(servicePath)) {
    fs.unlinkSync(servicePath);
  }
  run('systemctl', ['--user', 'daemon-reload'], { allowFailure: true });
  console.log(`Removed systemd user service: ${SYSTEMD_SERVICE_NAME}`);
}

async function startServer(options) {
  const configPath = resolveConfigPath(options.config);
  const loaded = loadCodexMobileConfig({ configPath, create: true });
  const logDir = ensureLogDir(loaded.logDir);
  const logPath = installConsoleLogTee(logDir);
  console.log(`CodexMobile config: ${loaded.configPath}`);
  console.log(`CodexMobile logs: ${logPath}`);
  await import('../server/index.js');
}

function installService(options) {
  const configPath = resolveConfigPath(options.config);
  const loaded = loadCodexMobileConfig({ configPath, create: true });
  const logDir = ensureLogDir(loaded.logDir);
  if (process.platform === 'darwin') {
    installLaunchdService({ configPath: loaded.configPath, logDir, start: options.start !== false });
    return;
  }
  if (process.platform === 'linux') {
    installSystemdUserService({ configPath: loaded.configPath, logDir, start: options.start !== false });
    return;
  }
  throw new Error(`install-service is not supported on ${process.platform}`);
}

function uninstallService() {
  if (process.platform === 'darwin') {
    uninstallLaunchdService();
    return;
  }
  if (process.platform === 'linux') {
    uninstallSystemdUserService();
    return;
  }
  throw new Error(`uninstall-service is not supported on ${process.platform}`);
}

function runScript(scriptPath, args = [], { env = process.env } = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: ROOT_DIR,
    env,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
  }
}

function installAsrDocker(options) {
  const configPath = resolveConfigPath(options.config);
  loadCodexMobileConfig({ configPath, create: true });
  if (options.rebuild) {
    process.env.CODEXMOBILE_ASR_REBUILD = '1';
  }
  if (options.recreate) {
    process.env.CODEXMOBILE_ASR_RECREATE = '1';
  }
  runScript(path.join(ROOT_DIR, 'scripts', 'start-asr.mjs'));
}

async function printAsrStatus(options) {
  const configPath = resolveConfigPath(options.config);
  loadCodexMobileConfig({ configPath, create: true });
  const { asrDockerStatus } = await import('../server/asr-docker.js');
  const status = await asrDockerStatus({ force: true });
  console.log(JSON.stringify(status, null, 2));
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (options.help || command === 'help' || command === '--help' || command === '-h') {
    console.log(usage());
    return;
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    console.log(`codex-mobile ${PACKAGE_JSON.version}`);
    return;
  }
  if (command === 'config-path') {
    const configPath = resolveConfigPath(options.config);
    ensureCodexMobileConfig({ configPath, create: true });
    console.log(configPath);
    return;
  }
  if (command === 'start') {
    await startServer(options);
    return;
  }
  if (command === 'install-service') {
    installService(options);
    return;
  }
  if (command === 'uninstall-service' || command === 'remove-service') {
    uninstallService();
    return;
  }
  if (command === 'install-asr-docker') {
    installAsrDocker(options);
    return;
  }
  if (command === 'asr-status') {
    await printAsrStatus(options);
    return;
  }
  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
