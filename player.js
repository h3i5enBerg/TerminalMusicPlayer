#!/usr/bin/env node

/**
 * Terminal Music Player
 * A lightweight, interactive terminal music player built with Node.js and mpv IPC.
 *
 * Course: Interactive Systems Development
 * Architecture: Single-file player (player.js)
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

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
 * Main entry point for Step 2 execution.
 */
function main() {
  const cliTarget = process.argv[2] || './music';
  const { targetPath, isDirectory, playlist } = buildPlaylist(cliTarget);

  printPlaylistSummary(targetPath, isDirectory, playlist);
}

main();
