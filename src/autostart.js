'use strict';

/**
 * Auto-start installer. Registers the agent to launch on login.
 *   macOS   -> LaunchAgent plist in ~/Library/LaunchAgents, loaded via launchctl
 *   Windows -> Scheduled Task (ONLOGON) via schtasks
 *   Linux   -> XDG autostart .desktop entry (bonus; not required by the plan)
 *
 * Templates live in scripts/. We fill placeholders with the real node binary
 * path, the entry script path, and the working directory — all resolved with
 * path/os so nothing is hardcoded.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('./config');

const LABEL = 'com.fileorganiser.agent';
const TASK_NAME = 'FileOrganiserAgent';
const NODE_BIN = process.execPath;
const ENTRY = path.join(config.PROJECT_ROOT, 'src', 'index.js');
const TEMPLATES = path.join(config.PROJECT_ROOT, 'scripts');

function fill(template, map) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in map ? map[k] : `{{${k}}}`));
}

/* ---------------- macOS ---------------- */

function macInstall() {
  const dir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${LABEL}.plist`);
  const tpl = fs.readFileSync(path.join(TEMPLATES, 'launchd.plist'), 'utf8');
  const plist = fill(tpl, {
    LABEL,
    NODE_BIN,
    ENTRY,
    WORKDIR: config.PROJECT_ROOT,
    LOG_OUT: path.join(config.APP_DATA_DIR, 'agent.out.log'),
    LOG_ERR: path.join(config.APP_DATA_DIR, 'agent.err.log'),
  });
  config.ensureAppDirs();
  fs.writeFileSync(dest, plist, 'utf8');
  try {
    execFileSync('launchctl', ['unload', dest], { stdio: 'ignore' });
  } catch {
    /* not loaded yet */
  }
  execFileSync('launchctl', ['load', dest]);
  return dest;
}

function macRemove() {
  const dest = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
  try {
    execFileSync('launchctl', ['unload', dest], { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  return dest;
}

/* ---------------- Windows ---------------- */

function winInstall() {
  // Build the XML, write it, register via schtasks /XML.
  const tpl = fs.readFileSync(path.join(TEMPLATES, 'task-scheduler.xml'), 'utf8');
  const xml = fill(tpl, {
    NODE_BIN,
    ENTRY: `"${ENTRY}"`,
    WORKDIR: config.PROJECT_ROOT,
    USER: `${os.userInfo().username}`,
  });
  config.ensureAppDirs();
  const xmlPath = path.join(config.APP_DATA_DIR, 'task-scheduler.generated.xml');
  // schtasks expects UTF-16 for /XML in many setups; write UTF-16LE w/ BOM.
  fs.writeFileSync(xmlPath, '﻿' + xml, 'utf16le');
  execFileSync('schtasks', ['/Create', '/TN', TASK_NAME, '/XML', xmlPath, '/F']);
  return xmlPath;
}

function winRemove() {
  try {
    execFileSync('schtasks', ['/Delete', '/TN', TASK_NAME, '/F']);
  } catch {
    /* not present */
  }
  return TASK_NAME;
}

/* ---------------- Linux ---------------- */

function linuxInstall() {
  const dir = path.join(os.homedir(), '.config', 'autostart');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, 'file-organiser-agent.desktop');
  const desktop =
    `[Desktop Entry]\nType=Application\nName=File Organiser Agent\n` +
    `Exec="${NODE_BIN}" "${ENTRY}"\nPath=${config.PROJECT_ROOT}\n` +
    `X-GNOME-Autostart-enabled=true\nNoDisplay=true\n`;
  fs.writeFileSync(dest, desktop, 'utf8');
  return dest;
}

function linuxRemove() {
  const dest = path.join(os.homedir(), '.config', 'autostart', 'file-organiser-agent.desktop');
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  return dest;
}

/* ---------------- dispatch ---------------- */

function install() {
  switch (process.platform) {
    case 'darwin':
      return { platform: 'darwin', path: macInstall() };
    case 'win32':
      return { platform: 'win32', path: winInstall() };
    case 'linux':
      return { platform: 'linux', path: linuxInstall() };
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

function remove() {
  switch (process.platform) {
    case 'darwin':
      return { platform: 'darwin', path: macRemove() };
    case 'win32':
      return { platform: 'win32', path: winRemove() };
    case 'linux':
      return { platform: 'linux', path: linuxRemove() };
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

module.exports = { install, remove };
