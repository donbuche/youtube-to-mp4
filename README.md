# YouTube to MP4

<img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" />
<img src="https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&amp;logoColor=white" alt="Node.js" />
<img src="https://img.shields.io/badge/Express-4.18-000000?logo=express&amp;logoColor=white" alt="Express" />
<img src="https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?logo=tailwindcss&amp;logoColor=white" alt="Tailwind CSS" />
<img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome" />

A web application to convert YouTube videos into lightweight MP4 clips — right from your browser. Paste a URL, configure the output options and download your clip in seconds.

![Screenshot placeholder](./assets/screenshot.png)

---

## Features

- **One-click conversion** — paste a YouTube URL and hit convert
- **Full option control** — FPS, dimensions, clip range and output filename
- **Local video preview** — scrub and loop the selected clip before generating the MP4
- **Live log terminal** — real-time conversion output streamed via Server-Sent Events (SSE)
- **MP4 preview** — inline playback and one-click download when done
- **Modern UI** — Tailwind CSS interface with dark/light mode toggle and smooth animations
- **Local-first** — runs directly with Node.js on your machine

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express |
| Frontend | HTML + Tailwind CSS (CDN) + Vanilla JS |
| Icons | Lucide |
| Fonts | Inter + JetBrains Mono |
| Streaming | Server-Sent Events (SSE) |
| Runtime | Node.js |
| Conversion | yt-dlp + ffmpeg |

---

## Prerequisites

### System dependencies

Make sure the following tools are installed on your machine:

```bash
# macOS (Homebrew)
brew install ffmpeg yt-dlp
```

### Local environment

- [Node.js](https://nodejs.org/) 20+

---

## Getting started

```bash
# 1. Clone and install dependencies
git clone https://github.com/donbuche/youtube-to-mp4.git
cd youtube-to-mp4
npm install

# 2. Start the server
npm start
```

The app will be available at `http://localhost:3000`.

### With browser cookies

For YouTube videos that trigger `Sign in to confirm you're not a bot`, run the server on your Mac with browser-cookie access:

```bash
npm run start:chrome
```

Optional profile override:

```bash
YT_DLP_COOKIES_FROM_BROWSER=chrome \
YT_DLP_COOKIES_FROM_BROWSER_PROFILE="$HOME/Library/Application Support/Google/Chrome" \
npm start
```

---

## Conversion options

The UI exposes the conversion settings supported by the app:

| Option | Description | Default |
|---|---|---|
| **URL** | YouTube video URL | *(required)* |
| **FPS** | Frames per second of the output MP4 | `30` |
| **Size** | Output dimensions (e.g. `768x432`) | `768x432` |
| **Clip range** | Start and end points selected with the dual range slider | full preview duration |
| **Output filename** | Custom name for the `.mp4` file | auto-generated |
| **Detailed logs** | Show full process output in the log terminal | on |

Generated MP4 files are saved to the `./output/` directory and served statically.

---

## Project structure

```
youtube-to-mp4/
├── assets/
│   └── screenshot.png               # README screenshot
├── public/
│   ├── favicon.ico                  # App favicon
│   ├── index.html                   # UI — preview player, form, results, footer
│   └── app.js                       # Client-side logic — form, preview, SSE, state
├── output/                          # Generated MP4 files (git-ignored)
├── server.js                        # Express server — REST API + SSE streaming
├── yt-dlp-cookies.txt               # Optional Netscape cookies file (git-ignored)
└── package.json
```

---

## Architecture

```
Browser
  │
  ▼ HTTP :3000
Node.js / Express       ← REST API + static file serving
  │
  ▼ child_process.spawn
yt-dlp                  ← resolves the downloadable media URL
  │
  ▼
temporary local video   ← downloaded by yt-dlp with the active auth strategy
  │
  ├─► /api/preview      ← served to the browser as a local HTML5 <video> preview
  │
  ▼
ffmpeg                  ← trims, scales and encodes the MP4
  │
  ▼
./output/*.mp4         ← served statically at /output/*
```

---

## Development

```bash
# Start in watch mode
npm run dev

# Start with Chrome cookies
npm run start:chrome
```

---

## Notes

- Output MP4 files are **not** git-tracked (`output/` is in `.gitignore`).
- Some YouTube videos require authenticated cookies for `yt-dlp`. You can place a Netscape-format cookies file at `./yt-dlp-cookies.txt` or set `YT_DLP_COOKIES_FILE` to another path before starting the server.
- For bot-protected videos, browser cookies are often more reliable than an exported `cookies.txt`. In local mode, use `npm run start:chrome`.
- The app downloads a temporary local source file before invoking `ffmpeg`, which avoids HLS segment `403` errors from protected YouTube manifests.
- The clip preview is also generated from a temporary local download and exposed through `/api/preview/*`. These preview temp files are cleaned up automatically after 30 minutes.

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git flow feature start my-feature`)
3. Commit your changes
4. Open a Pull Request

---

## License

[MIT License](LICENSE)

---

## Acknowledgements

- [ffmpeg](https://ffmpeg.org/) — video processing
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — YouTube download engine
- [Tailwind CSS](https://tailwindcss.com/) — utility-first CSS framework
- [Lucide](https://lucide.dev/) — icon library
