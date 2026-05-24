const express = require('express');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const OUTPUT_DIR = path.join(__dirname, 'output');
const DEFAULT_COOKIES_FILE = path.join(__dirname, 'yt-dlp-cookies.txt');
const YT_DLP_BINARY = process.env.YT_DLP_BINARY || 'yt-dlp';
const FFMPEG_BINARY = process.env.FFMPEG_BINARY || 'ffmpeg';
const YT_DLP_COOKIES_FROM_BROWSER = process.env.YT_DLP_COOKIES_FROM_BROWSER;
const YT_DLP_COOKIES_FROM_BROWSER_PROFILE = process.env.YT_DLP_COOKIES_FROM_BROWSER_PROFILE;
const PREVIEW_TTL_MS = 30 * 60 * 1000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const jobs = new Map();
const previews = new Map();

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseSize(size) {
  const match = /^(\d+)\s*x\s*(\d+)$/i.exec(size.trim());
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function resolveCookiesFile() {
  const configured = process.env.YT_DLP_COOKIES_FILE;
  if (configured && fs.existsSync(configured)) return configured;
  if (fs.existsSync(DEFAULT_COOKIES_FILE)) return DEFAULT_COOKIES_FILE;
  return null;
}

function resolveAuthStrategies() {
  const strategies = [];

  if (YT_DLP_COOKIES_FROM_BROWSER) {
    strategies.push({
      kind: 'browser',
      label: `browser cookies (${YT_DLP_COOKIES_FROM_BROWSER})`,
      args: YT_DLP_COOKIES_FROM_BROWSER_PROFILE
        ? ['--cookies-from-browser', `${YT_DLP_COOKIES_FROM_BROWSER}:${YT_DLP_COOKIES_FROM_BROWSER_PROFILE}`]
        : ['--cookies-from-browser', YT_DLP_COOKIES_FROM_BROWSER],
    });
  }

  const cookiesFile = resolveCookiesFile();
  if (cookiesFile) {
    strategies.push({
      kind: 'file',
      label: `cookies file (${cookiesFile})`,
      cookiesFile,
      args: ['--cookies', cookiesFile],
    });
  }

  if (strategies.length === 0) {
    strategies.push({
      kind: 'none',
      label: 'no authentication',
      args: [],
    });
  }

  return strategies;
}

function formatYtDlpError(code, stderr, strategy) {
  const details = stderr ? `: ${stderr.trim()}` : '';
  if (/Sign in to confirm you.?re not a bot/i.test(stderr)) {
    if (strategy?.kind === 'browser') {
      return `yt-dlp failed with code ${code}. YouTube still rejected the configured browser cookies (${YT_DLP_COOKIES_FROM_BROWSER}). Refresh your browser session and retry.${details}`;
    }

    if (strategy?.kind === 'file') {
      return `yt-dlp failed with code ${code}. YouTube rejected the configured cookies file (${strategy.cookiesFile}). For bot-protected videos, browser cookies are often more reliable. In local mode, start the server with YT_DLP_COOKIES_FROM_BROWSER=chrome.${details}`;
    }

    return `yt-dlp failed with code ${code}. YouTube is requiring authenticated cookies for this video. Add a Netscape-format cookies file at ${DEFAULT_COOKIES_FILE}, set YT_DLP_COOKIES_FILE to its path, or run locally with YT_DLP_COOKIES_FROM_BROWSER=chrome.${details}`;
  }

  return `yt-dlp failed with code ${code}${details}`;
}

async function removePath(targetPath) {
  if (!targetPath) return;
  await fs.promises.rm(targetPath, { recursive: true, force: true });
}

function runYtDlp(url, verbose, broadcast, strategy, jobId) {
  return new Promise((resolve, reject) => {
    const tempDir = path.join(os.tmpdir(), `youtube-to-mp4-${jobId}`);
    const outputTemplate = path.join(tempDir, 'source.%(ext)s');
    const ytDlpArgs = [
      '--no-part',
      '--no-playlist',
      '--print', 'after_move:filepath',
      '--format', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
      '--merge-output-format', 'mp4',
      '--output', outputTemplate,
      ...strategy.args,
      url.trim(),
    ];

    fs.promises.mkdir(tempDir, { recursive: true }).then(() => {
      if (verbose) {
        broadcast({ type: 'log', message: `$ ${YT_DLP_BINARY} ${ytDlpArgs.join(' ')}\n` });
        broadcast({ type: 'log', message: `Authentication mode: ${strategy.label}\n` });
      }

      const ytDlpProc = spawn(YT_DLP_BINARY, ytDlpArgs);
      let ytDlpStdout = '';
      let ytDlpStderr = '';

      ytDlpProc.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        ytDlpStdout += text;
        if (verbose) broadcast({ type: 'log', message: text });
      });

      ytDlpProc.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        ytDlpStderr += text;
        if (verbose) broadcast({ type: 'log', message: text });
      });

      ytDlpProc.on('error', reject);

      ytDlpProc.on('close', async (code) => {
        if (code !== 0) {
          await removePath(tempDir);
          resolve({
            ok: false,
            code,
            stderr: ytDlpStderr,
            strategy,
          });
          return;
        }

        const downloadedFile = ytDlpStdout
          .trim()
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .at(-1);

        if (!downloadedFile || !fs.existsSync(downloadedFile)) {
          await removePath(tempDir);
          resolve({
            ok: false,
            code: 1,
            stderr: 'yt-dlp did not produce a local video file',
            strategy,
          });
          return;
        }

        resolve({
          ok: true,
          inputPath: downloadedFile,
          tempDir,
          strategy,
        });
      });
    }).catch(reject);
  });
}

async function downloadSourceVideo(url, verbose, broadcast, jobId) {
  const authStrategies = resolveAuthStrategies();
  let lastFailure = null;

  for (const strategy of authStrategies) {
    try {
      const result = await runYtDlp(url, verbose, broadcast, strategy, jobId);
      if (result.ok) {
        return result;
      }

      lastFailure = result;
      if (verbose && authStrategies.length > 1) {
        broadcast({ type: 'log', message: `yt-dlp failed using ${strategy.label}. Trying next authentication strategy.\n` });
      }
    } catch (err) {
      throw err;
    }
  }

  const message = lastFailure
    ? formatYtDlpError(lastFailure.code, lastFailure.stderr, lastFailure.strategy)
    : 'yt-dlp could not download the source video';

  return {
    ok: false,
    message,
  };
}

function schedulePreviewCleanup(previewId, tempDir) {
  const existing = previews.get(previewId);
  if (existing?.timeoutId) {
    clearTimeout(existing.timeoutId);
  }

  const timeoutId = setTimeout(async () => {
    previews.delete(previewId);
    await removePath(tempDir);
  }, PREVIEW_TTL_MS);

  if (existing) {
    existing.timeoutId = timeoutId;
  }
}

app.get(['/output', '/output/'], async (_req, res) => {
  try {
    const entries = await fs.promises.readdir(OUTPUT_DIR, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const filePath = path.join(OUTPUT_DIR, entry.name);
          const stats = await fs.promises.stat(filePath);
          return {
            name: entry.name,
            mtimeMs: stats.mtimeMs,
          };
        })
    );

    files.sort((a, b) => b.mtimeMs - a.mtimeMs);

    const listItems = files.length
      ? files.map((file) => {
        const safeName = escapeHtml(file.name);
        return `<li><a href="/output/${encodeURIComponent(file.name)}">${safeName}</a></li>`;
      }).join('')
      : '<li>No MP4 files available.</li>';

    res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Output Files</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #0f172a; background: #f8fafc; }
    h1 { margin: 0 0 1rem; font-size: 1.5rem; }
    ul { padding-left: 1.25rem; }
    li + li { margin-top: 0.5rem; }
    a { color: #4f46e5; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>output/</h1>
  <ul>${listItems}</ul>
</body>
</html>`);
  } catch (err) {
    res.status(500).send(`Failed to list output files: ${err.message}`);
  }
});

app.use('/output', express.static(OUTPUT_DIR));

app.post('/api/preview', async (req, res) => {
  const { url } = req.body || {};

  if (!url || !url.trim()) {
    return res.status(400).json({ error: 'YouTube URL is required' });
  }

  const previewId = crypto.randomUUID();
  const noop = () => {};

  try {
    const result = await downloadSourceVideo(url.trim(), false, noop, `preview-${previewId}`);
    if (!result.ok) {
      return res.status(400).json({ error: result.message });
    }

    previews.set(previewId, {
      filePath: result.inputPath,
      tempDir: result.tempDir,
      timeoutId: null,
    });
    schedulePreviewCleanup(previewId, result.tempDir);

    return res.json({
      previewId,
      previewUrl: `/api/preview/${previewId}`,
    });
  } catch (err) {
    return res.status(500).json({ error: `Failed to prepare preview: ${err.message}` });
  }
});

app.get('/api/preview/:previewId', (req, res) => {
  const preview = previews.get(req.params.previewId);
  if (!preview) {
    return res.status(404).json({ error: 'Preview not found' });
  }

  schedulePreviewCleanup(req.params.previewId, preview.tempDir);
  res.sendFile(preview.filePath);
});

app.post('/api/convert', (req, res) => {
  const { url, output, fps, size, beginTime, duration, coverFrameTime, verbose } = req.body;

  if (!url || !url.trim()) {
    return res.status(400).json({ error: 'YouTube URL is required' });
  }

  const jobId = crypto.randomUUID();
  const outputFilename = output && output.trim()
    ? (output.trim().endsWith('.mp4') ? output.trim() : `${output.trim()}.mp4`)
    : `${jobId}.mp4`;
  const absoluteOutputPath = path.join(OUTPUT_DIR, outputFilename);
  const publicOutputPath = `/output/${outputFilename}`;
  const coverFilename = outputFilename.replace(/\.mp4$/i, '.webp');
  const absoluteCoverPath = path.join(OUTPUT_DIR, coverFilename);
  const publicCoverPath = `/output/${coverFilename}`;
  const resolvedFps = fps ? Number(fps) : 30;
  const resolvedDuration = duration ? Number(duration) : 15;
  const resolvedBeginTime = beginTime !== undefined && beginTime !== '' ? Number(beginTime) : 3;
  const defaultCoverFrameTime = resolvedBeginTime + (resolvedDuration / 2);
  const resolvedCoverFrameTime = coverFrameTime !== undefined && coverFrameTime !== '' ? Number(coverFrameTime) : defaultCoverFrameTime;
  const resolvedSize = (size && size.trim()) ? size.trim() : '768x432';
  const parsedSize = parseSize(resolvedSize);

  if (!parsedSize) {
    return res.status(400).json({ error: 'Output size must use WIDTHxHEIGHT format, e.g. 640x360' });
  }

  if (!Number.isFinite(resolvedFps) || resolvedFps <= 0) {
    return res.status(400).json({ error: 'FPS must be a number greater than 0' });
  }

  if (!Number.isFinite(resolvedDuration) || resolvedDuration <= 0) {
    return res.status(400).json({ error: 'Duration must be a number greater than 0' });
  }

  if (!Number.isFinite(resolvedBeginTime) || resolvedBeginTime < 0) {
    return res.status(400).json({ error: 'Start offset must be a number greater than or equal to 0' });
  }

  if (!Number.isFinite(resolvedCoverFrameTime) || resolvedCoverFrameTime < 0) {
    return res.status(400).json({ error: 'Cover frame time must be a number greater than or equal to 0' });
  }

  const clampedCoverFrameTime = Math.max(0, resolvedCoverFrameTime);

  const job = {
    id: jobId,
    status: 'running',
    logs: [],
    outputPath: publicOutputPath,
    clients: new Set(),
  };

  jobs.set(jobId, job);

  const broadcast = (event) => {
    job.logs.push(event);
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    job.clients.forEach(client => client.write(payload));
  };

  const closeClients = () => {
    job.clients.forEach(client => client.end());
    job.clients.clear();
  };

  const finishJob = (success, message) => {
    job.status = success ? 'done' : 'error';
    if (success) {
      broadcast({ type: 'done', outputPath: publicOutputPath, coverImagePath: publicCoverPath });
    } else {
      broadcast({ type: 'error', message });
    }
    closeClients();
    setTimeout(() => jobs.delete(jobId), 10 * 60 * 1000);
  };

  const failToStart = (err) => {
    job.status = 'error';
    broadcast({ type: 'error', message: `Failed to start process: ${err.message}` });
    closeClients();
  };

  res.json({ jobId });

  (async () => {
    let inputPath = null;
    let tempDir = null;

    try {
      const result = await downloadSourceVideo(url, verbose, broadcast, jobId);
      if (!result.ok) {
        finishJob(false, result.message);
        return;
      }

      inputPath = result.inputPath;
      tempDir = result.tempDir;
    } catch (err) {
      failToStart(err);
      return;
    }

    const ffmpegArgs = [
      '-y',
      '-ss', String(resolvedBeginTime),
      '-t', String(resolvedDuration),
      '-i', inputPath,
      '-map', '0:v:0',
      '-vf', `fps=${resolvedFps},scale=${parsedSize.width}:${parsedSize.height}:flags=lanczos`,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '24',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-an',
      absoluteOutputPath,
    ];

    if (verbose) {
      broadcast({ type: 'log', message: `$ ${FFMPEG_BINARY} ${ffmpegArgs.join(' ')}\n` });
    }

    const ffmpegProc = spawn(FFMPEG_BINARY, ffmpegArgs);

    ffmpegProc.stdout.on('data', (chunk) => {
      if (verbose) broadcast({ type: 'log', message: chunk.toString() });
    });

    ffmpegProc.stderr.on('data', (chunk) => {
      broadcast({ type: 'log', message: chunk.toString() });
    });

    ffmpegProc.on('error', failToStart);

    ffmpegProc.on('close', (ffmpegCode) => {
      if (ffmpegCode !== 0 || !fs.existsSync(absoluteOutputPath)) {
        removePath(tempDir).catch(() => {});
        finishJob(false, `ffmpeg failed with code ${ffmpegCode}`);
        return;
      }

      const coverArgs = [
        '-y',
        '-ss', String(clampedCoverFrameTime),
        '-i', inputPath,
        '-vf', `scale=${parsedSize.width}:${parsedSize.height}:flags=lanczos`,
        '-frames:v', '1',
        '-an',
        '-c:v', 'libwebp',
        '-quality', '80',
        '-compression_level', '6',
        absoluteCoverPath,
      ];

      if (verbose) {
        broadcast({ type: 'log', message: `$ ${FFMPEG_BINARY} ${coverArgs.join(' ')}\n` });
      }

      const coverProc = spawn(FFMPEG_BINARY, coverArgs);

      coverProc.stdout.on('data', (chunk) => {
        if (verbose) broadcast({ type: 'log', message: chunk.toString() });
      });

      coverProc.stderr.on('data', (chunk) => {
        broadcast({ type: 'log', message: chunk.toString() });
      });

      coverProc.on('error', failToStart);

      coverProc.on('close', (coverCode) => {
        removePath(tempDir).catch(() => {});
        if (coverCode === 0 && fs.existsSync(absoluteOutputPath) && fs.existsSync(absoluteCoverPath)) {
          finishJob(true);
        } else {
          finishJob(false, `ffmpeg cover generation failed with code ${coverCode}`);
        }
      });
    });
  })();
});

app.get('/api/stream/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  job.logs.forEach(event => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  if (job.status !== 'running') {
    res.end();
    return;
  }

  job.clients.add(res);
  req.on('close', () => job.clients.delete(res));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
