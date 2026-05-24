/* =========================================================
   YouTube → MP4  |  Client-side app
   ========================================================= */

// ── Dark mode ──────────────────────────────────────────────
const html = document.documentElement;
const themeToggle = document.getElementById('theme-toggle');

const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'light') html.classList.remove('dark');
else html.classList.add('dark');

themeToggle.addEventListener('click', () => {
  const isDark = html.classList.toggle('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
});

// ── Lucide icons ───────────────────────────────────────────
lucide.createIcons();

// ── DOM refs ───────────────────────────────────────────────
const form            = document.getElementById('convert-form');
const submitBtn       = document.getElementById('submit-btn');
const btnText         = document.getElementById('btn-text');
const btnIcon         = document.getElementById('btn-icon');
const urlInput        = document.getElementById('url');
const urlError        = document.getElementById('url-error');
const previewPanel    = document.getElementById('video-preview-panel');
const previewPlayerHost = document.getElementById('video-player');
const previewPlaceholder = document.getElementById('video-preview-placeholder');
const beginTimeInput  = document.getElementById('beginTime');
const beginTimeRange  = document.getElementById('beginTimeRange');
const endTimeRange    = document.getElementById('endTimeRange');
const clipRangeTrack  = document.getElementById('clip-range-track');
const coverFrameRange = document.getElementById('coverFrameRange');
const coverFrameInput = document.getElementById('coverFrameTime');
const coverFrameValue = document.getElementById('coverFrameValue');
const beginTimeValue  = document.getElementById('beginTimeValue');
const beginTimeMax    = document.getElementById('beginTimeMax');
const rangeSelection  = document.getElementById('rangeSelection');
const rangePlaybackProgress = document.getElementById('rangePlaybackProgress');
const rangeStartLabel = document.getElementById('rangeStartLabel');
const rangeDurationLabel = document.getElementById('rangeDurationLabel');
const rangeEndLabel   = document.getElementById('rangeEndLabel');
const durationInput   = document.getElementById('duration');
const previewLoopToggle = document.getElementById('preview-loop-toggle');
const previewLoopLabel  = document.getElementById('preview-loop-label');
const previewSoundToggle = document.getElementById('preview-sound-toggle');
const previewSoundLabel  = document.getElementById('preview-sound-label');

const progressCard    = document.getElementById('progress-card');
const logOutput       = document.getElementById('log-output');
const progressBar     = document.getElementById('progress-bar');
const statusBadge     = document.getElementById('status-badge');
const statusText      = document.getElementById('status-text');

const resultCard      = document.getElementById('result-card');
const resultVideo     = document.getElementById('result-video');
const downloadBtn     = document.getElementById('download-btn');
const downloadCoverBtn = document.getElementById('download-cover-btn');
const newConvBtn      = document.getElementById('new-conversion-btn');

const errorCard       = document.getElementById('error-card');
const errorMessage    = document.getElementById('error-message');
const retryBtn        = document.getElementById('retry-btn');

// ── State ──────────────────────────────────────────────────
let activeEventSource = null;
let progressInterval  = null;
let fakeProgress      = 0;
let previewReady      = false;
let previewDurationLimit = 0;
let previewLoopActive = false;
let previewMuted      = true;
let previewRequestTimer = null;
let previewAbortController = null;
let currentPreviewSourceUrl = '';
const SLIDER_STEP = 0.1;

// ── Helpers ────────────────────────────────────────────────
function show(el)  { el.classList.remove('hidden'); }
function hide(el)  { el.classList.add('hidden'); }

function formatSeconds(value) {
  const total = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(total / 60);
  const seconds = total - (minutes * 60);
  const normalizedSeconds = Number(seconds.toFixed(1));

  if (minutes > 0) {
    const secondsLabel = normalizedSeconds < 10
      ? `0${normalizedSeconds.toFixed(1)}`
      : normalizedSeconds.toFixed(1);
    return `${minutes}:${secondsLabel}`;
  }

  return `${normalizedSeconds.toFixed(1)}s`;
}

function roundToStep(value) {
  return Math.round((Number(value) || 0) / SLIDER_STEP) * SLIDER_STEP;
}

function extractYouTubeVideoId(value) {
  try {
    const url = new URL(value);
    if (url.hostname.includes('youtu.be')) {
      return url.pathname.slice(1) || null;
    }
    if (url.hostname.includes('youtube.com')) {
      if (url.pathname === '/watch') {
        return url.searchParams.get('v');
      }
      const parts = url.pathname.split('/').filter(Boolean);
      const embedIndex = parts.findIndex((part) => part === 'embed' || part === 'shorts' || part === 'live');
      if (embedIndex !== -1 && parts[embedIndex + 1]) {
        return parts[embedIndex + 1];
      }
    }
    return null;
  } catch {
    return null;
  }
}

function updateRangeVisuals() {
  const max = Math.max(0, Number(beginTimeRange.max) || 0);
  const start = roundToStep(Math.max(0, Number(beginTimeRange.value) || 0));
  const end = roundToStep(Math.min(max, Math.max(start + SLIDER_STEP, Number(endTimeRange.value) || start + SLIDER_STEP)));
  const duration = roundToStep(Math.max(SLIDER_STEP, end - start));

  beginTimeInput.value = start.toFixed(1);
  durationInput.value = duration.toFixed(1);
  beginTimeValue.textContent = formatSeconds(start);
  beginTimeMax.textContent = formatSeconds(previewDurationLimit || max);
  rangeStartLabel.textContent = `Start ${formatSeconds(start)}`;
  rangeEndLabel.textContent = `End ${formatSeconds(end)}`;
  rangeDurationLabel.textContent = `Duration ${formatSeconds(duration)}`;

  const denominator = max || 1;
  const startPercent = (start / denominator) * 100;
  const endPercent = (end / denominator) * 100;
  rangeSelection.style.left = `${startPercent}%`;
  rangeSelection.style.width = `${Math.max(endPercent - startPercent, 0)}%`;
}

function syncCoverFrameRange(preferredValue = null) {
  const maxCoverValue = roundToStep(Math.max(0, previewDurationLimit));
  const defaultValue = roundToStep(maxCoverValue / 2);
  const requested = preferredValue !== null ? Number(preferredValue) : Number(coverFrameRange.value || defaultValue);
  const nextValue = roundToStep(Math.min(maxCoverValue, Math.max(0, Number.isFinite(requested) ? requested : defaultValue)));

  coverFrameRange.min = '0';
  coverFrameRange.max = maxCoverValue.toFixed(1);
  coverFrameRange.value = nextValue.toFixed(1);
  coverFrameInput.value = nextValue.toFixed(1);
  coverFrameValue.textContent = formatSeconds(nextValue);
}

function resetRangePlaybackProgress() {
  rangePlaybackProgress.style.width = '0%';
}

function updateRangePlaybackProgress(currentTime) {
  const start = Number(beginTimeRange.value || 0);
  const end = Number(endTimeRange.value || start + SLIDER_STEP);
  const duration = Math.max(SLIDER_STEP, end - start);
  const progress = ((currentTime - start) / duration) * 100;
  rangePlaybackProgress.style.width = `${Math.min(100, Math.max(0, progress))}%`;
}

function stopPreviewLoop() {
  previewLoopActive = false;
  resetRangePlaybackProgress();

  previewLoopLabel.textContent = 'Play clip';
  previewLoopToggle.querySelector('[data-lucide]')?.setAttribute('data-lucide', 'play');
  lucide.createIcons();

  if (previewReady) {
    previewPlayerHost.pause();
  }
}

function updatePreviewSoundUI() {
  previewSoundLabel.textContent = previewMuted ? 'Muted' : 'Sound on';
  previewSoundToggle.querySelector('[data-lucide]')?.setAttribute('data-lucide', previewMuted ? 'volume-x' : 'volume-2');
  lucide.createIcons();

  if (previewReady) {
    previewPlayerHost.muted = previewMuted;
  }
}

function startPreviewLoop() {
  if (!previewReady) return;

  const start = Number(beginTimeRange.value || 0);
  const end = Number(endTimeRange.value || start + 1);

  stopPreviewLoop();
  previewLoopActive = true;
  previewLoopLabel.textContent = 'Stop preview';
  previewLoopToggle.querySelector('[data-lucide]')?.setAttribute('data-lucide', 'pause');
  lucide.createIcons();

  previewPlaceholder.classList.add('hidden');
  previewPlayerHost.currentTime = start;
  previewPlayerHost.muted = previewMuted;
  updateRangePlaybackProgress(start);
  previewPlayerHost.play().catch(() => {
    stopPreviewLoop();
  });
}

function refreshPreviewFrame(second) {
  stopPreviewLoop();

  if (previewReady) {
    previewPlayerHost.classList.remove('hidden');
    previewPlayerHost.currentTime = second;
    previewPlayerHost.pause();
    resetRangePlaybackProgress();
  }
}

function setPreviewDuration(duration) {
  const preferredCoverFrameValue = Number(coverFrameInput.value || 0);
  previewDurationLimit = roundToStep(Math.max(0, Number(duration) || 0));
  const maxValue = previewDurationLimit;
  const previousMax = Math.max(0, Number(beginTimeRange.max) || 0);
  const currentStart = previousMax > 0 ? roundToStep(Math.min(Number(beginTimeRange.value || 0), maxValue)) : 0;
  const currentEnd = previousMax > 0
    ? roundToStep(Math.min(Math.max(Number(endTimeRange.value || maxValue), currentStart + SLIDER_STEP), maxValue))
    : maxValue;

  beginTimeRange.max = maxValue.toFixed(1);
  endTimeRange.max = maxValue.toFixed(1);
  beginTimeRange.value = currentStart.toFixed(1);
  endTimeRange.value = currentEnd.toFixed(1);
  updateRangeVisuals();
  syncCoverFrameRange(preferredCoverFrameValue);
}

function resetPreview() {
  hide(previewPanel);
  previewPlayerHost.classList.add('hidden');
  previewPlayerHost.pause();
  previewPlayerHost.removeAttribute('src');
  previewPlayerHost.load();
  previewReady = false;
  previewDurationLimit = 0;
  previewMuted = true;
  currentPreviewSourceUrl = '';
  stopPreviewLoop();
  resetRangePlaybackProgress();
  beginTimeRange.max = '0';
  endTimeRange.max = '0';
  beginTimeRange.value = '0';
  endTimeRange.value = SLIDER_STEP.toFixed(1);
  coverFrameRange.min = '0';
  coverFrameRange.max = '0';
  coverFrameRange.value = '0';
  coverFrameInput.value = '0';
  coverFrameValue.textContent = '0s';
  updateRangeVisuals();
  previewPlaceholder.innerHTML = `
    <div class="flex items-center gap-2 rounded-full bg-black/40 px-4 py-2 text-sm font-medium backdrop-blur-sm">
      <i data-lucide="loader-2" class="h-4 w-4 spinner"></i>
      Preview loading
    </div>
  `;
  lucide.createIcons();
  updatePreviewSoundUI();
}

function handleStartRangeInput() {
  const max = Math.max(0, Number(beginTimeRange.max) || 0);
  const start = roundToStep(Math.min(Math.max(0, Number(beginTimeRange.value) || 0), max));
  let end = roundToStep(Math.min(Math.max(0, Number(endTimeRange.value) || 0), max));

  if (start >= end) {
    end = roundToStep(Math.min(max, start + SLIDER_STEP));
    endTimeRange.value = end.toFixed(1);
  }

  beginTimeRange.value = start.toFixed(1);
  updateRangeVisuals();
  refreshPreviewFrame(start);
}

function handleEndRangeInput() {
  const max = Math.max(0, Number(endTimeRange.max) || 0);
  let end = roundToStep(Math.min(Math.max(0, Number(endTimeRange.value) || 0), max));
  let start = roundToStep(Math.min(Math.max(0, Number(beginTimeRange.value) || 0), max));

  if (end <= start) {
    start = roundToStep(Math.max(0, end - SLIDER_STEP));
    beginTimeRange.value = start.toFixed(1);
  }

  endTimeRange.value = end.toFixed(1);
  updateRangeVisuals();
  stopPreviewLoop();
}

function getTrackTimeFromPointer(clientX) {
  const rect = clipRangeTrack.getBoundingClientRect();
  const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
  const boundedRatio = Math.min(1, Math.max(0, ratio));
  const max = Math.max(0, Number(beginTimeRange.max) || 0);
  return roundToStep(boundedRatio * max);
}

function handleClipTrackLeftClick(event) {
  if (event.target.closest('input[type="range"]')) return;

  const max = Math.max(0, Number(beginTimeRange.max) || 0);
  const nextStart = Math.min(Math.max(0, getTrackTimeFromPointer(event.clientX)), max);
  const currentEnd = Math.max(0, Number(endTimeRange.value) || 0);
  const nextEnd = roundToStep(Math.min(max, Math.max(currentEnd, nextStart + SLIDER_STEP)));

  beginTimeRange.value = nextStart.toFixed(1);
  endTimeRange.value = nextEnd.toFixed(1);
  updateRangeVisuals();
  refreshPreviewFrame(nextStart);
}

function handleClipTrackRightClick(event) {
  if (event.target.closest('input[type="range"]')) return;

  event.preventDefault();

  const max = Math.max(0, Number(endTimeRange.max) || 0);
  const nextEnd = Math.min(Math.max(0, getTrackTimeFromPointer(event.clientX)), max);
  const currentStart = Math.max(0, Number(beginTimeRange.value) || 0);
  const nextStart = roundToStep(Math.max(0, Math.min(currentStart, nextEnd - SLIDER_STEP)));

  beginTimeRange.value = nextStart.toFixed(1);
  endTimeRange.value = Math.max(nextEnd, nextStart + SLIDER_STEP).toFixed(1);
  updateRangeVisuals();
  refreshPreviewFrame(Number(endTimeRange.value));
}

function handleCoverFrameInput() {
  const maxCoverValue = Math.max(0, previewDurationLimit);
  const selected = roundToStep(Math.min(maxCoverValue, Math.max(0, Number(coverFrameRange.value) || 0)));

  coverFrameRange.value = selected.toFixed(1);
  coverFrameInput.value = selected.toFixed(1);
  coverFrameValue.textContent = formatSeconds(selected);
  refreshPreviewFrame(selected);
}

function setConverting(loading) {
  submitBtn.disabled = loading;
  if (loading) {
    btnText.textContent = 'Converting…';
    btnIcon.setAttribute('data-lucide', 'loader-2');
    btnIcon.classList.add('spinner');
  } else {
    btnText.textContent = 'Convert to MP4';
    btnIcon.setAttribute('data-lucide', 'wand-2');
    btnIcon.classList.remove('spinner');
  }
  lucide.createIcons();
}

function appendLog(text) {
  logOutput.textContent += text;
  logOutput.scrollTop = logOutput.scrollHeight;
}

function startFakeProgress() {
  fakeProgress = 0;
  progressBar.style.width = '0%';
  progressInterval = setInterval(() => {
    if (fakeProgress < 85) {
      fakeProgress += Math.random() * 3;
      progressBar.style.width = Math.min(fakeProgress, 85) + '%';
    }
  }, 800);
}

function finishProgress(success) {
  clearInterval(progressInterval);
  progressBar.style.width = success ? '100%' : fakeProgress + '%';
  if (success) {
    progressBar.classList.remove('bg-brand-500');
    progressBar.classList.add('bg-green-500');
  } else {
    progressBar.classList.remove('bg-brand-500');
    progressBar.classList.add('bg-red-500');
  }
}

function resetUI() {
  hide(progressCard);
  hide(resultCard);
  hide(errorCard);
  resultVideo.pause();
  resultVideo.removeAttribute('src');
  resultVideo.load();
  downloadBtn.removeAttribute('href');
  downloadCoverBtn.removeAttribute('href');
  logOutput.textContent = '';
  progressBar.style.width = '0%';
  progressBar.classList.remove('bg-green-500', 'bg-red-500');
  progressBar.classList.add('bg-brand-500');
  statusText.textContent = 'Running';
  statusBadge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-medium';
  statusBadge.querySelector('span').className = 'w-1.5 h-1.5 rounded-full bg-amber-500 pulse-dot';

  if (activeEventSource) {
    activeEventSource.close();
    activeEventSource = null;
  }
  clearInterval(progressInterval);
}

function showError(msg) {
  finishProgress(false);
  setConverting(false);
  errorMessage.textContent = msg;
  show(errorCard);
  statusText.textContent = 'Failed';
  statusBadge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-xs font-medium';
}

// ── Form validation ────────────────────────────────────────
function validateUrl(value) {
  try {
    const u = new URL(value);
    return (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be'));
  } catch {
    return false;
  }
}

urlInput.addEventListener('input', () => {
  if (urlInput.value && !validateUrl(urlInput.value)) {
    urlError.classList.remove('hidden');
  } else {
    urlError.classList.add('hidden');
  }
  queuePreviewLoad();
});

beginTimeRange.addEventListener('input', handleStartRangeInput);
endTimeRange.addEventListener('input', handleEndRangeInput);
clipRangeTrack.addEventListener('click', handleClipTrackLeftClick);
clipRangeTrack.addEventListener('contextmenu', handleClipTrackRightClick);
coverFrameRange.addEventListener('input', handleCoverFrameInput);
previewLoopToggle.addEventListener('click', () => {
  if (previewLoopActive) {
    stopPreviewLoop();
  } else {
    startPreviewLoop();
  }
});
previewSoundToggle.addEventListener('click', () => {
  previewMuted = !previewMuted;
  updatePreviewSoundUI();
});

updateRangeVisuals();
syncCoverFrameRange();
updatePreviewSoundUI();

previewPlayerHost.addEventListener('loadedmetadata', () => {
  previewReady = true;
  previewPlayerHost.classList.remove('hidden');
  previewPlaceholder.classList.add('hidden');
  const preferredCoverFrameValue = Number(coverFrameInput.value || 0);
  setPreviewDuration(previewPlayerHost.duration);
  updatePreviewSoundUI();
  refreshPreviewFrame(Number(coverFrameRange.value || preferredCoverFrameValue || 0));
});

previewPlayerHost.addEventListener('timeupdate', () => {
  if (previewLoopActive) {
    const start = Number(beginTimeRange.value || 0);
    const end = Number(endTimeRange.value || start + 1);
    updateRangePlaybackProgress(previewPlayerHost.currentTime);
    if (previewPlayerHost.currentTime >= end) {
      updateRangePlaybackProgress(end);
      previewPlayerHost.currentTime = start;
      previewPlayerHost.play().catch(() => {
        stopPreviewLoop();
      });
    }
  }
});

async function loadPreview(url) {
  if (previewAbortController) {
    previewAbortController.abort();
  }

  previewAbortController = new AbortController();
  previewReady = false;
  show(previewPanel);
  previewPlayerHost.classList.add('hidden');
  previewPlaceholder.classList.remove('hidden');
  previewPlaceholder.querySelector('div').lastChild.textContent = 'Preparing preview';

  try {
    const res = await fetch('/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: previewAbortController.signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to prepare preview');
    if (urlInput.value.trim() !== url) return;

    currentPreviewSourceUrl = url;
    previewPlayerHost.src = `${data.previewUrl}?t=${Date.now()}`;
    previewPlayerHost.load();
  } catch (err) {
    if (err.name === 'AbortError') return;
    previewPlaceholder.querySelector('div').lastChild.textContent = 'Preview unavailable';
  }
}

function queuePreviewLoad() {
  const value = urlInput.value.trim();
  if (!value || !validateUrl(value)) {
    if (previewRequestTimer) clearTimeout(previewRequestTimer);
    if (previewAbortController) previewAbortController.abort();
    resetPreview();
    return;
  }

  if (previewRequestTimer) clearTimeout(previewRequestTimer);
  previewRequestTimer = window.setTimeout(() => {
    if (value !== currentPreviewSourceUrl) {
      loadPreview(value);
    }
  }, 500);
}

// ── Form submit ────────────────────────────────────────────
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const url = urlInput.value.trim();
  if (!url) { urlError.classList.remove('hidden'); urlInput.focus(); return; }
  if (!validateUrl(url)) { urlError.classList.remove('hidden'); urlInput.focus(); return; }
  urlError.classList.add('hidden');

  resetUI();
  setConverting(true);
  show(progressCard);
  progressCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  startFakeProgress();

  const payload = {
    url,
    output:    document.getElementById('output').value.trim() || null,
    fps:       document.getElementById('fps').value      || null,
    size:      document.getElementById('size').value     || null,
    beginTime: document.getElementById('beginTime').value !== '' ? document.getElementById('beginTime').value : null,
    duration:  document.getElementById('duration').value  || null,
    coverFrameTime: document.getElementById('coverFrameTime').value !== '' ? document.getElementById('coverFrameTime').value : null,
    verbose:   document.getElementById('verbose').checked,
  };

  let jobId;
  try {
    const res = await fetch('/api/convert', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error');
    jobId = data.jobId;
  } catch (err) {
    showError(err.message);
    return;
  }

  // ── SSE stream ──────────────────────────────────────────
  const es = new EventSource(`/api/stream/${jobId}`);
  activeEventSource = es;

  es.onmessage = (ev) => {
    const event = JSON.parse(ev.data);

    if (event.type === 'log') {
      appendLog(event.message);
    }

    if (event.type === 'done') {
      es.close();
      finishProgress(true);
      setConverting(false);

      statusText.textContent = 'Done';
      statusBadge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-medium';

      // Update spinner icon in progress card header
      const spinnerIcon = progressCard.querySelector('[data-lucide="loader-2"]');
      if (spinnerIcon) {
        spinnerIcon.setAttribute('data-lucide', 'check-circle-2');
        spinnerIcon.classList.remove('spinner');
        spinnerIcon.closest('.rounded-lg').classList.replace('bg-amber-100', 'bg-green-100');
        spinnerIcon.closest('.rounded-lg').classList.replace('dark:bg-amber-900/30', 'dark:bg-green-900/30');
        spinnerIcon.classList.replace('text-amber-600', 'text-green-600');
        spinnerIcon.classList.replace('dark:text-amber-400', 'dark:text-green-400');
        lucide.createIcons();
      }

      // Show result
      resultVideo.src = `${event.outputPath}?t=${Date.now()}`;
      resultVideo.load();
      downloadBtn.href = event.outputPath;
      downloadCoverBtn.href = event.coverImagePath;
      const filename = event.outputPath.split('/').pop();
      const coverFilename = event.coverImagePath.split('/').pop();
      downloadBtn.setAttribute('download', filename);
      downloadCoverBtn.setAttribute('download', coverFilename);
      show(resultCard);
      resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    if (event.type === 'error') {
      es.close();
      showError(event.message || 'Conversion failed');
    }
  };

  es.onerror = () => {
    es.close();
    if (submitBtn.disabled) {
      showError('Lost connection to the server.');
    }
  };
});

// ── New conversion ─────────────────────────────────────────
newConvBtn.addEventListener('click', () => {
  resetUI();
  setConverting(false);
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

retryBtn.addEventListener('click', () => {
  resetUI();
  hide(errorCard);
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
