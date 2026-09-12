#!/usr/bin/env node

/**
 * Terminal Music Player
 * A lightweight, interactive terminal music player built with Node.js and mpv IPC.
 *
 * Course: Interactive Systems Development
 * Architecture: Single-file player (player.js)
 */

import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { EventEmitter } from 'node:events';

// Supported audio file extensions
const SUPPORTED_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.flac',
  '.ogg',
  '.m4a',
  '.aac'
]);

// ANSI styling helpers for terminal output
const style = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  inverse: '\x1b[7m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

/**
 * Format bytes into a human-readable string (KB, MB).
 * @param {number} bytes
 * @returns {string}
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

/**
 * Format seconds into MM:SS (or HH:MM:SS if >= 3600).
 * @param {number} seconds
 * @returns {string}
 */
function formatTime(seconds) {
  if (!seconds || isNaN(seconds) || seconds < 0) return '00:00';
  const totalSecs = Math.floor(seconds);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');

  if (hrs > 0) {
    const hh = String(hrs).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/**
 * Generates an ASCII playback progress bar HUD.
 * @param {number} currentTime - Current playback position in seconds
 * @param {number} totalDuration - Total track duration in seconds
 * @param {number} barLength - Character width of progress bar (default 24)
 * @returns {string} Formatted HUD string
 */
function renderProgressBar(currentTime, totalDuration, barLength = 24) {
  if (!totalDuration || totalDuration <= 0) {
    const emptyBar = '─'.repeat(barLength);
    return `  ${style.gray}[${emptyBar}] --:-- / --:-- (0%)${style.reset}`;
  }

  const ratio = Math.min(1, Math.max(0, currentTime / totalDuration));
  const filledCount = Math.round(ratio * barLength);
  const emptyCount = barLength - filledCount;

  const filledBar = '█'.repeat(filledCount);
  const emptyBar = '░'.repeat(emptyCount);
  const percent = Math.round(ratio * 100);

  const curStr = formatTime(currentTime);
  const durStr = formatTime(totalDuration);

  return `  ${style.cyan}[${style.green}${filledBar}${style.gray}${emptyBar}${style.cyan}]${style.reset} ${style.bold}${curStr}${style.reset} / ${style.dim}${durStr}${style.reset} ${style.yellow}(${percent}%)${style.reset}`;
}

/**
 * Recursively scans a directory and collects all supported audio file paths.
 * @param {string} dirPath - Absolute directory path
 * @returns {string[]} List of absolute audio file paths
 */
function scanAudioFiles(dirPath) {
  const results = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      // Recurse into subdirectories
      results.push(...scanAudioFiles(fullPath));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(ext)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * Resolves and validates the target input (file or directory) into a structured playlist.
 * @param {string} inputPath - User-provided or default path
 * @returns {{ targetPath: string, isDirectory: boolean, playlist: Array<{ index: number, filename: string, fullPath: string, size: string, ext: string }> }}
 */
function buildPlaylist(inputPath) {
  const resolvedPath = path.resolve(process.cwd(), inputPath);

  // 1. Check if path exists
  if (!fs.existsSync(resolvedPath)) {
    console.error(
      `\n${style.red}${style.bold}Error:${style.reset} Target path does not exist:\n  ${style.dim}${resolvedPath}${style.reset}\n`
    );
    process.exit(1);
  }

  const stat = fs.statSync(resolvedPath);
  let audioFiles = [];

  if (stat.isDirectory()) {
    // 2. Scan directory
    audioFiles = scanAudioFiles(resolvedPath);

    if (audioFiles.length === 0) {
      console.error(
        `\n${style.yellow}${style.bold}Warning:${style.reset} No supported audio files found in directory:\n  ${style.dim}${resolvedPath}${style.reset}`
      );
      console.error(
        `${style.gray}Supported formats: ${Array.from(SUPPORTED_EXTENSIONS).join(', ')}${style.reset}\n`
      );
      process.exit(1);
    }
  } else if (stat.isFile()) {
    // 3. Single file validation
    const ext = path.extname(resolvedPath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      console.error(
        `\n${style.red}${style.bold}Error:${style.reset} Unsupported audio format: "${ext}"`
      );
      console.error(
        `File: ${style.dim}${resolvedPath}${style.reset}`
      );
      console.error(
        `${style.gray}Supported formats: ${Array.from(SUPPORTED_EXTENSIONS).join(', ')}${style.reset}\n`
      );
      process.exit(1);
    }

    audioFiles = [resolvedPath];
  } else {
    console.error(
      `\n${style.red}${style.bold}Error:${style.reset} Target is neither a regular file nor a directory.\n`
    );
    process.exit(1);
  }

  // Sort files naturally for consistent playlist ordering
  audioFiles.sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: 'base' }));

  // Build structured playlist queue
  const playlist = audioFiles.map((filePath, i) => {
    const fileStat = fs.statSync(filePath);
    return {
      index: i + 1,
      filename: path.basename(filePath),
      fullPath: filePath,
      size: formatFileSize(fileStat.size),
      ext: path.extname(filePath).toLowerCase()
    };
  });

  return {
    targetPath: resolvedPath,
    isDirectory: stat.isDirectory(),
    playlist
  };
}

/**
 * Renders a clean terminal summary table of indexed playlist tracks.
 * @param {string} targetPath - The resolved input path
 * @param {boolean} isDirectory - Whether target is a directory
 * @param {Array} playlist - Structured playlist
 */
function printPlaylistSummary(targetPath, isDirectory, playlist) {
  console.log(`\n${style.cyan}${style.bold}🎵 Terminal Music Player — Track Indexer${style.reset}`);
  console.log(`${style.gray}${'━'.repeat(60)}${style.reset}`);
  console.log(
    `${style.bold}Source:${style.reset} ${style.dim}${targetPath}${style.reset} ${
      isDirectory ? `${style.blue}[Directory]${style.reset}` : `${style.blue}[Single File]${style.reset}`
    }`
  );
  console.log(`${style.bold}Total Tracks:${style.reset} ${style.green}${playlist.length}${style.reset}`);
  console.log(`${style.gray}${'━'.repeat(60)}${style.reset}\n`);

  console.log(
    `  ${style.bold}${'#'.padEnd(4)} ${'Track Filename'.padEnd(35)} ${'Size'.padStart(10)}  ${'Format'}${style.reset}`
  );
  console.log(`  ${style.gray}${'─'.repeat(4)} ${'─'.repeat(35)} ${'─'.repeat(10)}  ${'──────'}${style.reset}`);

  for (const track of playlist) {
    const num = `${track.index}.`.padEnd(4);
    const name = track.filename.length > 33
      ? track.filename.substring(0, 30) + '...'
      : track.filename.padEnd(35);
    const size = track.size.padStart(10);
    const fmt = track.ext.toUpperCase().replace('.', '');

    console.log(`  ${style.cyan}${num}${style.reset} ${name} ${style.dim}${size}${style.reset}  ${style.magenta}${fmt}${style.reset}`);
  }

  console.log(`\n${style.green}✔ ${playlist.length} track(s) ready in queue.${style.reset}\n`);
}

/**
 * MPV Audio Controller via IPC Socket
 */
class MPVAudioEngine extends EventEmitter {
  constructor() {
    super();
    this.socketPath = path.join(os.tmpdir(), `mpv-player-${process.pid}.sock`);
    this.process = null;
    this.socket = null;
    this.connected = false;
    this.buffer = '';
    this.requestId = 1;
    this.isQuitting = false;

    // Playback state cache
    this.state = {
      paused: false,
      timePos: 0,
      duration: 0,
      volume: 100,
      filename: ''
    };
  }

  /**
   * Spawns mpv in headless background mode with IPC socket.
   */
  async start() {
    // Remove stale socket file if it exists
    if (fs.existsSync(this.socketPath)) {
      try {
        fs.unlinkSync(this.socketPath);
      } catch {}
    }

    const mpvArgs = [
      `--input-ipc-server=${this.socketPath}`,
      '--idle=yes',
      '--no-video',
      '--audio-display=no',
      '--msg-level=all=no'
    ];

    this.process = spawn('mpv', mpvArgs, {
      stdio: ['ignore', 'ignore', 'ignore']
    });

    this.process.on('error', (err) => {
      console.error(`${style.red}${style.bold}Error:${style.reset} Failed to spawn mpv process: ${err.message}`);
      console.error(`${style.gray}Ensure mpv is installed (e.g. 'brew install mpv').${style.reset}`);
      process.exit(1);
    });

    this.process.on('exit', () => {
      if (!this.isQuitting) {
        this.cleanup();
      }
    });

    // Wait for the IPC socket to become available and connect
    await this.connectSocket();
    this.setupPropertyObservers();
  }

  /**
   * Connects to the mpv UNIX domain socket with retry logic.
   */
  async connectSocket(maxRetries = 40, delayMs = 50) {
    for (let i = 0; i < maxRetries; i++) {
      if (fs.existsSync(this.socketPath)) {
        try {
          await new Promise((resolve, reject) => {
            const socket = net.createConnection(this.socketPath, () => {
              this.socket = socket;
              this.connected = true;
              this.setupSocketListeners();
              resolve();
            });

            socket.on('error', (err) => {
              reject(err);
            });
          });

          return;
        } catch {
          // Socket might be created on filesystem but not accepting connections yet
        }
      }

      await new Promise((r) => setTimeout(r, delayMs));
    }

    throw new Error('Failed to connect to mpv IPC socket within timeout.');
  }

  /**
   * Listens for and parses JSON-RPC events from the mpv socket stream.
   */
  setupSocketListeners() {
    this.socket.on('data', (chunk) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop(); // Retain incomplete chunk

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line.trim());
          this.handleIPCMessage(msg);
        } catch {}
      }
    });

    this.socket.on('close', () => {
      this.connected = false;
    });

    this.socket.on('error', () => {});
  }

  /**
   * Handles incoming IPC messages and property changes.
   */
  handleIPCMessage(msg) {
    if (msg.event === 'property-change') {
      const { name, data } = msg;

      if (name === 'time-pos' && typeof data === 'number') {
        this.state.timePos = data;
        this.emit('time-pos', data);
      } else if (name === 'pause' && typeof data === 'boolean') {
        this.state.paused = data;
        this.emit('pause', data);
      } else if (name === 'duration' && typeof data === 'number') {
        this.state.duration = data;
        this.emit('duration', data);
      } else if (name === 'volume' && typeof data === 'number') {
        this.state.volume = data;
        this.emit('volume', data);
      } else if (name === 'filename' && typeof data === 'string') {
        this.state.filename = data;
        this.emit('filename', data);
      }
    } else if (msg.event === 'end-file') {
      this.emit('end-file', msg);
    }
  }

  /**
   * Subscribes to mpv property changes via IPC.
   */
  setupPropertyObservers() {
    this.observeProperty('time-pos');
    this.observeProperty('pause');
    this.observeProperty('duration');
    this.observeProperty('volume');
    this.observeProperty('filename');
  }

  /**
   * Dispatches an IPC command to mpv.
   */
  command(cmd, args = []) {
    if (!this.connected || !this.socket) return;
    const req = {
      command: [cmd, ...args],
      request_id: this.requestId++
    };
    this.socket.write(JSON.stringify(req) + '\n');
  }

  observeProperty(name) {
    this.command('observe_property', [this.requestId, name]);
  }

  loadFile(filePath) {
    this.command('loadfile', [filePath, 'replace']);
  }

  togglePause() {
    this.command('cycle', ['pause']);
  }

  pause() {
    this.command('set_property', ['pause', true]);
  }

  resume() {
    this.command('set_property', ['pause', false]);
  }

  seek(seconds, type = 'relative') {
    this.command('seek', [seconds, type]);
  }

  setVolume(volume) {
    const clamped = Math.max(0, Math.min(100, volume));
    this.command('set_property', ['volume', clamped]);
  }

  adjustVolume(delta) {
    const nextVolume = Math.max(0, Math.min(100, this.state.volume + delta));
    this.setVolume(nextVolume);
  }

  /**
   * Cleanly closes the socket and terminates mpv.
   */
  cleanup() {
    if (this.isQuitting) return;
    this.isQuitting = true;

    try {
      if (this.connected && this.socket) {
        this.command('quit');
        this.socket.end();
        this.socket.destroy();
      }
    } catch {}

    try {
      if (this.process && !this.process.killed) {
        this.process.kill('SIGTERM');
      }
    } catch {}

    try {
      if (fs.existsSync(this.socketPath)) {
        fs.unlinkSync(this.socketPath);
      }
    } catch {}
  }
}

/**
 * Renders the interactive terminal playlist menu and HUD UI.
 * @param {object} state - Interactive player state
 */
function renderUI(state) {
  const {
    targetPath,
    isDirectory,
    playlist,
    selectedIndex,
    activePlayingIndex,
    isPaused,
    statusText,
    timePos = 0,
    duration = 0,
    volume = 100
  } = state;
  const lines = [];

  // 1. Header Banner
  lines.push(`\n${style.cyan}${style.bold}🎵 TERMINAL MUSIC PLAYER${style.reset}`);
  lines.push(`${style.gray}${'━'.repeat(66)}${style.reset}`);
  lines.push(
    ` ${style.bold}Source:${style.reset} ${style.dim}${targetPath}${style.reset} ${
      isDirectory ? `${style.blue}[Directory]${style.reset}` : `${style.blue}[Single File]${style.reset}`
    }`
  );

  const volBarFilled = Math.round((volume / 100) * 8);
  const volBarEmpty = Math.max(0, 8 - volBarFilled);
  const volIcon = volume === 0 ? '🔇' : (volume < 50 ? '🔉' : '🔊');
  const volMeter = `${volIcon} ${volume}% ${style.gray}[${style.green}${'█'.repeat(volBarFilled)}${'░'.repeat(volBarEmpty)}${style.gray}]${style.reset}`;

  lines.push(` ${style.bold}Tracks:${style.reset} ${style.green}${playlist.length}${style.reset}   |   ${style.bold}Volume:${style.reset} ${volMeter}`);
  lines.push(`${style.gray}${'━'.repeat(66)}${style.reset}\n`);

  // 2. Playlist Menu View
  lines.push(`  ${style.bold}PLAYLIST MENU:${style.reset}`);
  lines.push(`  ${style.gray}${'─'.repeat(62)}${style.reset}`);

  playlist.forEach((track, i) => {
    const isHovered = i === selectedIndex;
    const isPlaying = i === activePlayingIndex;

    // Pointer symbol
    const pointer = isHovered ? `${style.cyan}${style.bold}❯${style.reset}` : ' ';

    // Playback badge
    let badge = '           ';
    if (isPlaying) {
      badge = isPaused
        ? `${style.yellow}⏸ [PAUSED] ${style.reset}`
        : `${style.green}▶ [PLAYING]${style.reset}`;
    }

    const num = `${track.index}.`.padEnd(3);
    const maxNameLen = 30;
    const truncatedName = track.filename.length > maxNameLen
      ? track.filename.substring(0, maxNameLen - 3) + '...'
      : track.filename.padEnd(maxNameLen);

    const size = track.size.padStart(9);
    const fmt = track.ext.toUpperCase().replace('.', '').padEnd(4);

    let rowText = '';
    if (isHovered) {
      rowText = `${pointer} ${style.cyan}${style.bold}${num}${style.reset} ${badge} ${style.bold}${style.cyan}${truncatedName}${style.reset} ${style.dim}${size}${style.reset}  ${style.magenta}${fmt}${style.reset}`;
    } else if (isPlaying) {
      rowText = `${pointer} ${num} ${badge} ${style.green}${style.bold}${truncatedName}${style.reset} ${style.dim}${size}${style.reset}  ${style.magenta}${fmt}${style.reset}`;
    } else {
      rowText = `${pointer} ${style.dim}${num}${style.reset} ${badge} ${truncatedName} ${style.dim}${size}${style.reset}  ${style.dim}${fmt}${style.reset}`;
    }

    lines.push(`  ${rowText}`);
  });

  lines.push(`  ${style.gray}${'─'.repeat(62)}${style.reset}\n`);

  // 3. Live Playback HUD & Progress Bar
  const activeTrack = activePlayingIndex >= 0 ? playlist[activePlayingIndex] : null;
  const trackTitle = activeTrack ? `${style.cyan}${style.bold}${activeTrack.filename}${style.reset}` : `${style.dim}Idle (Select track to play)${style.reset}`;
  const hudBar = renderProgressBar(timePos, duration, 24);

  lines.push(`  ${style.bold}Now Playing:${style.reset} ${trackTitle}`);
  lines.push(`${hudBar}\n`);

  // 4. Status / Toast message
  if (statusText) {
    lines.push(`  ${statusText}\n`);
  }

  // 5. Footer Keybindings Guide
  lines.push(`${style.gray}${'━'.repeat(66)}${style.reset}`);
  lines.push(
    ` ${style.bold}Controls:${style.reset} [${style.cyan}↑/↓${style.reset}] Move  [${style.green}Space${style.reset}] Play/Pause  [${style.cyan}←/→${style.reset}] ±10s  [${style.magenta}n/p${style.reset}] Next/Prev  [${style.yellow}+/-${style.reset}] Vol  [${style.red}q${style.reset}] Quit`
  );
  lines.push(`${style.gray}${'━'.repeat(66)}${style.reset}`);

  // Flicker-free write: move cursor to top-left and redraw
  process.stdout.write(`\x1b[?25l\x1b[H\x1b[J${lines.join('\n')}\n`);
}

/**
 * Main entry point for interactive player execution.
 */
async function main() {
  const cliTarget = process.argv[2] || './music';
  const { targetPath, isDirectory, playlist } = buildPlaylist(cliTarget);

  // Application state
  const state = {
    targetPath,
    isDirectory,
    playlist,
    selectedIndex: 0,
    activePlayingIndex: -1,
    isPaused: false,
    timePos: 0,
    duration: 0,
    volume: 100,
    statusText: `${style.dim}Use ↑/↓ or k/j to navigate, Space/Enter to play.${style.reset}`
  };

  const player = new MPVAudioEngine();

  // Throttled UI rendering helper to avoid terminal flicker and CPU spikes
  let lastRenderTime = 0;
  let renderTimer = null;

  const requestRender = (force = false) => {
    const now = Date.now();
    if (force || now - lastRenderTime >= 250) {
      if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = null;
      }
      lastRenderTime = now;
      renderUI(state);
    } else if (!renderTimer) {
      renderTimer = setTimeout(() => {
        renderTimer = null;
        lastRenderTime = Date.now();
        renderUI(state);
      }, 250 - (now - lastRenderTime));
    }
  };

  // Graceful shutdown handler
  const shutdown = () => {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }

    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
        process.stdin.pause();
      } catch {}
    }

    // Restore cursor and print exit message
    process.stdout.write('\x1b[?25h\n');
    console.log(`${style.yellow}Playback stopped. Exiting Terminal Music Player...${style.reset}\n`);
    player.cleanup();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('exit', () => {
    player.cleanup();
    process.stdout.write('\x1b[?25h');
  });

  try {
    await player.start();
  } catch (err) {
    console.error(`${style.red}${style.bold}Error starting audio engine:${style.reset}`, err.message);
    shutdown();
  }

  // Listen to MPV state events to update UI dynamically
  player.on('time-pos', (time) => {
    state.timePos = time;
    requestRender(false);
  });

  player.on('duration', (dur) => {
    state.duration = dur;
    requestRender(true);
  });

  player.on('pause', (paused) => {
    state.isPaused = paused;
    requestRender(true);
  });

  player.on('volume', (vol) => {
    state.volume = Math.round(vol);
    requestRender(true);
  });

  player.on('end-file', () => {
    // Auto-advance to next track on song completion
    if (state.activePlayingIndex >= 0) {
      state.activePlayingIndex = (state.activePlayingIndex + 1) % playlist.length;
      state.selectedIndex = state.activePlayingIndex;
      state.timePos = 0;
      state.duration = 0;
      const nextTrack = playlist[state.activePlayingIndex];
      state.statusText = `${style.green}▶ Auto-playing next track:${style.reset} ${style.bold}${nextTrack.filename}${style.reset}`;
      player.loadFile(nextTrack.fullPath);
      requestRender(true);
    }
  });

  // Enable raw keyboard mode for low-latency interactive input
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
  }

  // Modular keypress listener
  process.stdin.on('keypress', (str, key) => {
    if (!key && !str) return;

    // Quit application
    if ((key && key.ctrl && key.name === 'c') || str === 'q' || str === 'Q') {
      shutdown();
      return;
    }

    // Navigate Up
    if ((key && key.name === 'up') || str === 'k') {
      state.selectedIndex = (state.selectedIndex - 1 + playlist.length) % playlist.length;
      requestRender(true);
      return;
    }

    // Navigate Down
    if ((key && key.name === 'down') || str === 'j') {
      state.selectedIndex = (state.selectedIndex + 1) % playlist.length;
      requestRender(true);
      return;
    }

    // Play/Select Track (Enter)
    if (key && (key.name === 'return' || key.name === 'enter')) {
      state.activePlayingIndex = state.selectedIndex;
      state.isPaused = false;
      state.timePos = 0;
      state.duration = 0;
      const track = playlist[state.activePlayingIndex];
      state.statusText = `${style.green}▶ Now playing:${style.reset} ${style.bold}${track.filename}${style.reset}`;
      player.loadFile(track.fullPath);
      requestRender(true);
      return;
    }

    // Play / Pause Toggle (Spacebar)
    if ((key && key.name === 'space') || str === ' ') {
      if (state.activePlayingIndex === -1) {
        // If nothing is playing yet, play the currently hovered item
        state.activePlayingIndex = state.selectedIndex;
        state.isPaused = false;
        state.timePos = 0;
        state.duration = 0;
        const track = playlist[state.activePlayingIndex];
        state.statusText = `${style.green}▶ Now playing:${style.reset} ${style.bold}${track.filename}${style.reset}`;
        player.loadFile(track.fullPath);
      } else {
        // Toggle pause on the active track
        player.togglePause();
        state.isPaused = !state.isPaused;
        const track = playlist[state.activePlayingIndex];
        state.statusText = state.isPaused
          ? `${style.yellow}⏸ Playback paused:${style.reset} ${style.dim}${track.filename}${style.reset}`
          : `${style.green}▶ Playback resumed:${style.reset} ${style.bold}${track.filename}${style.reset}`;
      }
      requestRender(true);
      return;
    }

    // Next Track ('n' / 'N')
    if (str === 'n' || str === 'N') {
      if (state.activePlayingIndex === -1) {
        state.activePlayingIndex = state.selectedIndex;
      } else {
        state.activePlayingIndex = (state.activePlayingIndex + 1) % playlist.length;
      }
      state.selectedIndex = state.activePlayingIndex;
      state.isPaused = false;
      state.timePos = 0;
      state.duration = 0;
      const track = playlist[state.activePlayingIndex];
      state.statusText = `${style.green}⏭ Next track:${style.reset} ${style.bold}${track.filename}${style.reset}`;
      player.loadFile(track.fullPath);
      requestRender(true);
      return;
    }

    // Previous Track ('p' / 'P')
    if (str === 'p' || str === 'P') {
      if (state.activePlayingIndex === -1) {
        state.activePlayingIndex = state.selectedIndex;
        state.isPaused = false;
        state.timePos = 0;
        state.duration = 0;
        const track = playlist[state.activePlayingIndex];
        state.statusText = `${style.green}▶ Now playing:${style.reset} ${style.bold}${track.filename}${style.reset}`;
        player.loadFile(track.fullPath);
      } else {
        const currentTime = player.state.timePos || 0;
        if (currentTime > 3) {
          // Smart restart: restart from 0s if already played > 3s
          player.seek(0, 'absolute');
          const track = playlist[state.activePlayingIndex];
          state.statusText = `${style.cyan}⏮ Restarting track:${style.reset} ${style.bold}${track.filename}${style.reset}`;
        } else {
          // Switch to previous track in playlist with loop/wrap
          state.activePlayingIndex = (state.activePlayingIndex - 1 + playlist.length) % playlist.length;
          state.selectedIndex = state.activePlayingIndex;
          state.isPaused = false;
          state.timePos = 0;
          state.duration = 0;
          const track = playlist[state.activePlayingIndex];
          state.statusText = `${style.green}⏮ Previous track:${style.reset} ${style.bold}${track.filename}${style.reset}`;
          player.loadFile(track.fullPath);
        }
      }
      requestRender(true);
      return;
    }

    // Seek Forward 10s (Right Arrow or 'l')
    if ((key && key.name === 'right') || str === 'l') {
      if (state.activePlayingIndex !== -1) {
        player.seek(10, 'relative');
        const track = playlist[state.activePlayingIndex];
        state.statusText = `${style.cyan}⏩ Seeked +10s:${style.reset} ${style.bold}${track.filename}${style.reset}`;
      } else {
        state.statusText = `${style.yellow}⚠ No track is currently playing to seek.${style.reset}`;
      }
      requestRender(true);
      return;
    }

    // Seek Backward 10s (Left Arrow or 'h')
    if ((key && key.name === 'left') || str === 'h') {
      if (state.activePlayingIndex !== -1) {
        player.seek(-10, 'relative');
        const track = playlist[state.activePlayingIndex];
        state.statusText = `${style.cyan}⏪ Seeked -10s:${style.reset} ${style.bold}${track.filename}${style.reset}`;
      } else {
        state.statusText = `${style.yellow}⚠ No track is currently playing to seek.${style.reset}`;
      }
      requestRender(true);
      return;
    }

    // Volume Up ('+' or '=')
    if (str === '+' || str === '=') {
      const newVol = Math.min(100, (state.volume || 100) + 5);
      player.setVolume(newVol);
      state.volume = newVol;
      state.statusText = `${style.yellow}🔊 Volume: ${state.volume}%${style.reset}`;
      requestRender(true);
      return;
    }

    // Volume Down ('-' or '_')
    if (str === '-' || str === '_') {
      const newVol = Math.max(0, (state.volume || 100) - 5);
      player.setVolume(newVol);
      state.volume = newVol;
      state.statusText = `${style.yellow}🔉 Volume: ${state.volume}%${style.reset}`;
      requestRender(true);
      return;
    }
  });

  // Initial UI Render
  requestRender(true);
}

main();


