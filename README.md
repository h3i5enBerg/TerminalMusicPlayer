# 🎵 Terminal Music Player

> A lightweight, interactive terminal music player built with **Node.js** and **mpv IPC** for the **Interactive Systems Development** course.

---

## 📌 Project Overview

**Terminal Music Player** is a keyboard-driven, command-line audio player designed to deliver a smooth and responsive music listening experience directly inside your terminal. Built with simplicity, robustness, and performance in mind, it interfaces with `mpv` using asynchronous IPC (Inter-Process Communication) to provide seamless playback, seeking, volume adjustments, and dynamic terminal UI updates.

---

## 🏗️ Architecture & Design Rationale

### 1. Single-File Architecture (`player.js`)
- All player logic, IPC socket communication, input handling, and terminal rendering reside within a clean, well-structured, single-file design (`player.js`).
- Minimizes boilerplate and dependency overhead while ensuring code readability and maintainability.

### 2. Audio Backend: Why `mpv` IPC over `afplay`?
| Feature / Characteristic | macOS `afplay` | `mpv` via IPC Socket |
| :--- | :--- | :--- |
| **Pause / Resume** | ❌ Spawns new process / fragile | ✅ Instant IPC command without audio glitches |
| **Accurate Seeking** | ❌ Requires process restarts | ✅ Millisecond-accurate relative/absolute seek |
| **Volume Control** | ⚠️ Global or fixed per spawn | ✅ Dynamic real-time adjustment |
| **Real-time Metadata & Time** | ❌ None | ✅ Bidirectional event stream & property polling |
| **Cross-Platform Support** | ❌ macOS only | ✅ macOS, Linux, and Windows |

---

## ✨ Features

- 🎧 **Direct Audio Playback**: Supports MP3, FLAC, WAV, AAC, OGG, and more via `mpv`.
- 📂 **Directory & Playlist Scanning**: Load single files or recursively load all audio files in a folder.
- ⌨️ **Interactive Terminal Controls**: Low-latency keyboard interactions (raw mode).
- 📊 **Dynamic Terminal UI**: Real-time progress bar, track elapsed/total time, volume indicator, and playback state.
- ⏩ **Precise Scrubbing**: Jump forward and backward seamlessly without interrupting playback flow.
- 🔊 **Volume Management**: Smooth volume adjustments with bounds checking.
- 🔀 **Track Navigation**: Jump to next, previous, or loop tracks.

---

## 🛠️ Prerequisites & Installation

### 1. Requirements
- **Node.js** (v18.0.0 or higher recommended)
- **mpv** (command-line media player)

### 2. Install `mpv`
- **macOS (Homebrew)**:
  ```bash
  brew install mpv
  ```
- **Ubuntu / Debian**:
  ```bash
  sudo apt update && sudo apt install mpv
  ```
- **Arch Linux**:
  ```bash
  sudo pacman -S mpv
  ```

### 3. Setup Project
Clone the repository and inspect the project structure:
```bash
git clone https://github.com/h3i5enBerg/TerminalMusicPlayer.git
cd TerminalMusicPlayer
```

---

## 🚀 Usage

Run the player by passing an audio file or a folder of songs:

```bash
# Play a single audio file
node player.js /path/to/song.mp3

# Play an entire directory of songs
node player.js /path/to/music/folder
```

---

## 🎮 Keybindings & Controls

| Key | Action | Description |
| :---: | :--- | :--- |
| `Space` | **Play / Pause** | Toggle playback state |
| `→` / `l` | **Seek Forward** | Fast-forward 5 seconds |
| `←` / `h` | **Seek Backward** | Rewind 5 seconds |
| `↑` / `k` | **Volume Up** | Increase volume by 5% |
| `↓` / `j` | **Volume Down** | Decrease volume by 5% |
| `n` | **Next Track** | Skip to next track in playlist |
| `p` | **Previous Track** | Return to previous track |
| `q` / `Ctrl+C` | **Quit** | Clean up IPC socket and exit gracefully |

---

## 📡 IPC Architecture Overview

```mermaid
flowchart LR
    A[Node.js Terminal UI] -- JSON Commands (UNIX Socket) --> B[mpv Background Process]
    B -- Playback Events & Time Position --> A
    C[User Keyboard Input] --> A
```

1. **Process Spawn**: Node.js initializes `mpv` in headless mode with an active IPC socket (`--input-ipc-server`).
2. **Bidirectional Socket Communication**: Node.js dispatches JSON commands (e.g., `set_property pause`, `seek`, `set_property volume`) and listens for real-time status updates.
3. **Clean Shutdown**: Gracefully terminates the socket connection and background child process upon exit signals.

---

## 👨‍💻 Author & Course Information

- **Project**: Terminal Music Player Application
- **Course**: Interactive Systems Development
- **Developer**: [Niraj Satam](https://github.com/h3i5enBerg)
- **License**: MIT
