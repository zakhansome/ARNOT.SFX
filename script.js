// ================= STATE =================
let videoFile = null;
let sfxFiles = [];
let detectedPoints = [];
let processedBlob = null;
let isProcessing = false;
let ffmpegInstance = null;

const $ = (id) => document.getElementById(id);
const videoInput = $('videoInput');
const sfxInput = $('sfxInput');
const videoBox = $('videoUploadBox');
const sfxBox = $('sfxUploadBox');
const videoInfo = $('videoInfo');
const sfxInfo = $('sfxInfo');
const processBtn = $('processBtn');
const progressSection = $('progressSection');
const progressFill = $('progressFill');
const progressText = $('progressText');
const previewSection = $('previewSection');
const videoPreview = $('videoPreview');
const sfxList = $('sfxList');
const alertBox = $('alertBox');
const loadingOverlay = $('loadingOverlay');
const loadingText = $('loadingText');
const downloadVideoBtn = $('downloadVideoBtn');
const statTransitions = $('statTransitions');
const statSFX = $('statSFX');
const statDuration = $('statDuration');

// ================= INIT =================
document.addEventListener('DOMContentLoaded', () => {
  videoBox.addEventListener('click', () => videoInput.click());
  sfxBox.addEventListener('click', () => sfxInput.click());
  videoInput.addEventListener('change', e => { if (e.target.files[0]) { videoFile = e.target.files[0]; onVideoUpload(); } });
  sfxInput.addEventListener('change', e => { if (e.target.files.length) { sfxFiles = Array.from(e.target.files); onSFXUpload(); } });

  $('transitionSensitivity').addEventListener('input', () => $('sensitivityValue').textContent = $('transitionSensitivity').value);
  $('sfxVolume').addEventListener('input', () => $('volumeValue').textContent = $('sfxVolume').value + '%');
  processBtn.addEventListener('click', process);
  downloadVideoBtn.addEventListener('click', downloadVideo);
});

// ================= UPLOAD =================
function onVideoUpload() {
  videoInfo.textContent = `📁 ${videoFile.name} (${formatSize(videoFile.size)})`;
  videoInfo.classList.add('show');
  videoBox.classList.add('has-file');
  updateProcessBtn();
  showAlert('✅ Video diupload', 'success');
}
function onSFXUpload() {
  sfxInfo.textContent = `📁 ${sfxFiles.length} SFX: ${sfxFiles.map(f => f.name).join(', ')}`;
  sfxInfo.classList.add('show');
  sfxBox.classList.add('has-file');
  updateProcessBtn();
  showAlert(`✅ ${sfxFiles.length} SFX diupload`, 'success');
}
function updateProcessBtn() {
  processBtn.disabled = !(videoFile && sfxFiles.length > 0);
}

// ================= HELPERS =================
function showAlert(msg, type) {
  alertBox.textContent = msg;
  alertBox.className = `alert alert-${type} show`;
  setTimeout(() => alertBox.classList.remove('show'), 5000);
}
function showLoading(msg) { loadingText.textContent = msg || 'Memproses...'; loadingOverlay.classList.add('show'); }
function hideLoading() { loadingOverlay.classList.remove('show'); }
function updateProgress(p, msg) {
  progressFill.style.width = Math.min(100, Math.max(0, p)) + '%';
  progressText.textContent = `${msg} (${Math.round(p)}%)`;
}
function formatSize(b) {
  if (b === 0) return '0 B';
  const k = 1024, s = ['B','KB','MB','GB'], i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(2)) + ' ' + s[i];
}
function formatTime(sec) {
  const m = Math.floor(sec/60), s = Math.floor(sec%60), cs = Math.floor((sec%1)*100);
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

// ================= DETEKSI SHOT BOUNDARY (HISTOGRAM) =================
function computeHistogram(imgData) {
  const hist = new Float32Array(64);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
    hist[Math.min(63, Math.floor(gray / 4))]++;
  }
  const total = d.length / 4;
  for (let i = 0; i < 64; i++) hist[i] /= total;
  return hist;
}

function histogramDistance(h1, h2) {
  let d = 0;
  for (let i = 0; i < 64; i++) {
    const diff = h1[i] - h2[i];
    const denom = h1[i] + h2[i];
    if (denom > 0) d += (diff * diff) / denom;
  }
  return d;
}

async function extractHistograms(video, sampleFps) {
  const duration = video.duration;
  const interval = 1 / sampleFps;
  const histograms = [];
  const canvas = document.createElement('canvas');
  canvas.width = 160; canvas.height = 90;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const hasRVFC = 'requestVideoFrameCallback' in video;

  // Tunggu frame BENAR-BENAR sudah ter-decode & siap digambar,
  // bukan cuma event 'seeked' yang kadang fire sebelum frame baru tersedia.
  const seekTo = (time) => new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };

    if (hasRVFC) {
      video.requestVideoFrameCallback(() => finish());
      video.currentTime = time;
    } else {
      const onSeeked = () => { video.removeEventListener('seeked', onSeeked); finish(); };
      video.addEventListener('seeked', onSeeked);
      video.currentTime = time;
    }
    setTimeout(finish, 500); // fallback safety net
  });

  for (let t = 0; t < duration; t += interval) {
    await seekTo(t);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    histograms.push({ time: t, hist: computeHistogram(imgData) });
    updateProgress(5 + (t / duration) * 20, 'Analisis histogram...');
  }
  return histograms;
}

function detectShotBoundaries(histograms, sensitivity) {
  const distances = [];
  for (let i = 1; i < histograms.length; i++) {
    distances.push({
      index: i,
      // titik potong sesungguhnya ada DI ANTARA frame i-1 dan i,
      // bukan persis di frame i (yang sudah masuk shot baru)
      time: (histograms[i-1].time + histograms[i].time) / 2,
      distance: histogramDistance(histograms[i-1].hist, histograms[i].hist)
    });
  }

  const values = distances.map(d => d.distance);
  const mean = values.reduce((a,b) => a+b, 0) / values.length;
  const variance = values.reduce((a,b) => a + (b-mean)**2, 0) / values.length;
  const stdDev = Math.sqrt(variance);

  // k: sensitivitas 1 → k=5 (konservatif), sensitivitas 10 → k=0.8 (agresif)
  const k = 5 - (sensitivity - 1) * (4.2 / 9);
  const threshold = mean + k * stdDev;
  const minDistance = mean + 0.5 * stdDev;

  console.log(`📊 Deteksi: mean=${mean.toFixed(4)}, stdDev=${stdDev.toFixed(4)}, k=${k.toFixed(2)}, threshold=${threshold.toFixed(4)}`);

  const candidates = distances.filter(d => d.distance > threshold && d.distance >= minDistance);

  // Non-maximum suppression: window 0.4s
  const peaks = [];
  let i = 0;
  while (i < candidates.length) {
    let best = candidates[i];
    let j = i;
    while (j + 1 < candidates.length && (candidates[j+1].time - candidates[j].time) < 0.4) {
      j++;
      if (candidates[j].distance > best.distance) best = candidates[j];
    }
    peaks.push(best);
    i = j + 1;
  }

  console.log(`🎯 Shot boundaries: ${peaks.length}`);
  return peaks.map(p => ({
    time: p.time,
    confidence: Math.min(p.distance / (threshold * 2), 1),
    type: 'transition'
  }));
}

// ================= PROSES UTAMA =================
async function process() {
  if (isProcessing) return;
  isProcessing = true;
  processBtn.disabled = true;
  detectedPoints = [];
  processedBlob = null;

  try {
    progressSection.classList.add('show');
    previewSection.classList.remove('show');

    // Load video offscreen (cuma buat baca metadata + sampling frame, TIDAK dipakai untuk rendering)
    const video = document.createElement('video');
    video.src = URL.createObjectURL(videoFile);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    await new Promise((res, rej) => {
      video.onloadedmetadata = res;
      video.onerror = () => rej(new Error('Gagal memuat video'));
    });

    const duration = video.duration;
    const sensitivity = parseInt($('transitionSensitivity').value);

    // Deteksi
    updateProgress(5, 'Mengambil sample frame...');
    const histograms = await extractHistograms(video, 10);

    updateProgress(30, 'Mendeteksi shot boundary...');
    detectedPoints = detectShotBoundaries(histograms, sensitivity);

    // Statistik
    $('statistics').style.display = 'grid';
    statTransitions.textContent = detectedPoints.length;
    statSFX.textContent = detectedPoints.length;
    statDuration.textContent = Math.round(duration) + 's';

    if (detectedPoints.length === 0) {
      showAlert('⚠️ Tidak ada transisi terdeteksi. Naikkan sensitivitas dan coba lagi.', 'error');
      return;
    }

    // ---- Decode SFX buffers ----
    updateProgress(40, 'Memuat file SFX...');
    const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
    const sfxBuffers = [];
    for (const f of sfxFiles) {
      const ab = await f.arrayBuffer();
      const buf = await decodeCtx.decodeAudioData(ab.slice(0));
      sfxBuffers.push(buf);
    }

    // ---- Mixing audio secara OFFLINE (tidak real-time, tidak tergantung device) ----
    updateProgress(50, 'Mixing audio (offline)...');
    const sfxVolume = parseInt($('sfxVolume').value) / 100;
    const mixedAudioBlob = await mixAudioOffline(decodeCtx, videoFile, duration, detectedPoints, sfxBuffers, sfxVolume);
    try { decodeCtx.close(); } catch (e) {}

    // ---- Remux video asli + audio baru pakai ffmpeg.wasm (TANPA re-encode video) ----
    updateProgress(65, 'Menyiapkan ffmpeg...');
    processedBlob = await muxVideoWithAudio(videoFile, mixedAudioBlob);

    updateProgress(100, 'Selesai!');
    videoPreview.src = URL.createObjectURL(processedBlob);
    previewSection.classList.add('show');
    renderSFXList();

    showAlert(`✅ Selesai! ${detectedPoints.length} SFX ditempatkan otomatis.`, 'success');

  } catch (err) {
    console.error('❌ Error:', err);
    showAlert('❌ Gagal: ' + err.message, 'error');
  } finally {
    isProcessing = false;
    processBtn.disabled = false;
    progressSection.classList.remove('show');
    hideLoading();
  }
}

// ================= MIXING AUDIO OFFLINE =================
// Tidak pakai AudioContext realtime -> rendering secepat CPU mampu, bukan secepat durasi video.
async function mixAudioOffline(decodeCtx, videoFile, videoDuration, points, sfxBuffers, sfxVolume) {
  let originalBuffer = null;
  try {
    const videoArrayBuffer = await videoFile.arrayBuffer();
    originalBuffer = await decodeCtx.decodeAudioData(videoArrayBuffer.slice(0));
  } catch (e) {
    console.warn('⚠️ Tidak bisa decode audio asli dari video (mungkin video tanpa audio). Lanjut dengan audio bisu + SFX saja.', e);
  }

  const sampleRate = originalBuffer ? originalBuffer.sampleRate : 44100;
  const numChannels = originalBuffer ? Math.max(2, originalBuffer.numberOfChannels) : 2;
  const length = originalBuffer ? originalBuffer.length : Math.ceil(videoDuration * sampleRate);

  const offlineCtx = new OfflineAudioContext(numChannels, length, sampleRate);

  if (originalBuffer) {
    const originalSource = offlineCtx.createBufferSource();
    originalSource.buffer = originalBuffer;
    const originalGain = offlineCtx.createGain();
    originalGain.gain.value = 1.0;
    originalSource.connect(originalGain);
    originalGain.connect(offlineCtx.destination);
    originalSource.start(0);
  }

  const totalDuration = length / sampleRate;
  points.forEach((p, i) => {
    const buf = sfxBuffers[i % sfxBuffers.length];
    const when = Math.max(0, p.time);
    if (when >= totalDuration) return; // jangan jadwalkan SFX lewat dari panjang audio
    const src = offlineCtx.createBufferSource();
    src.buffer = buf;
    const gain = offlineCtx.createGain();
    gain.gain.value = sfxVolume;
    src.connect(gain);
    gain.connect(offlineCtx.destination);
    try { src.start(when); } catch (e) { console.warn('SFX start err', e); }
  });

  const rendered = await offlineCtx.startRendering();
  return audioBufferToWavBlob(rendered);
}

function audioBufferToWavBlob(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 2;
  const dataLength = buffer.length * numChannels * bytesPerSample;
  const arrBuf = new ArrayBuffer(44 + dataLength);
  const view = new DataView(arrBuf);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  const channels = [];
  for (let i = 0; i < numChannels; i++) channels.push(buffer.getChannelData(i));

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([arrBuf], { type: 'audio/wav' });
}

// ================= FETCH DENGAN PROGRESS (untuk file besar seperti ffmpeg-core.wasm) =================
async function fetchBlobURLWithProgress(url, mimeType, onProgressMB) {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    // fallback kalau streaming tidak didukung / request gagal
    const blob = await (await fetch(url)).blob();
    return URL.createObjectURL(blob);
  }

  const reader = res.body.getReader();
  const chunks = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    receivedBytes += value.length;
    onProgressMB(receivedBytes / (1024 * 1024));
  }

  const blob = new Blob(chunks, { type: mimeType });
  return URL.createObjectURL(blob);
}

// ================= REMUX VIA FFMPEG.WASM (tanpa re-encode video) =================
async function getFFmpeg() {
  if (ffmpegInstance) return ffmpegInstance;
  showLoading('Memuat ffmpeg (hanya sekali per sesi)...');
  const { FFmpeg } = await import('https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js');
  const { toBlobURL } = await import('https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js');

  const ffmpeg = new FFmpeg();
  const coreBaseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  const ffmpegBaseURL = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm';

  const coreURL = await fetchBlobURLWithProgress(
    `${coreBaseURL}/ffmpeg-core.js`, 'text/javascript',
    (mb) => showLoading(`Memuat ffmpeg-core.js... ${mb.toFixed(1)} MB`)
  );
  const wasmURL = await fetchBlobURLWithProgress(
    `${coreBaseURL}/ffmpeg-core.wasm`, 'application/wasm',
    (mb) => showLoading(`Memuat ffmpeg-core.wasm... ${mb.toFixed(1)} MB (file terbesar, ~30MB)`)
  );
  // worker.js juga HARUS di-convert ke blob URL, kalau tidak browser menolak
  // membuat Worker dari script yang asalnya beda origin (unpkg.com vs halaman kita)
  const classWorkerURL = await toBlobURL(`${ffmpegBaseURL}/worker.js`, 'text/javascript');

  showLoading('Menyiapkan ffmpeg...');
  await ffmpeg.load({ coreURL, wasmURL, classWorkerURL });

  ffmpegInstance = ffmpeg;
  hideLoading();
  return ffmpeg;
}

async function muxVideoWithAudio(videoFile, audioBlob) {
  const { fetchFile } = await import('https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js');
  const ffmpeg = await getFFmpeg();

  const ext = (videoFile.name.split('.').pop() || 'mp4').toLowerCase();
  const isWebm = ext === 'webm';
  const inputName = `input.${isWebm ? 'webm' : 'mp4'}`;
  const outputName = `output.${isWebm ? 'webm' : 'mp4'}`;
  const audioCodec = isWebm ? 'libopus' : 'aac';
  const outMime = isWebm ? 'video/webm' : 'video/mp4';

  const onProgress = ({ progress }) => {
    const pct = 65 + Math.min(30, Math.max(0, progress) * 30);
    updateProgress(pct, 'Menggabungkan video + audio (tanpa re-encode video)...');
  };
  ffmpeg.on('progress', onProgress);

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(videoFile));
    await ffmpeg.writeFile('audio.wav', await fetchFile(audioBlob));

    await ffmpeg.exec([
      '-i', inputName,
      '-i', 'audio.wav',
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',       // <-- kunci: video tidak di-re-encode sama sekali
      '-c:a', audioCodec,
      '-shortest',
      outputName
    ]);

    const data = await ffmpeg.readFile(outputName);
    return new Blob([data.buffer], { type: outMime });
  } finally {
    ffmpeg.off('progress', onProgress);
    try { await ffmpeg.deleteFile(inputName); } catch (e) {}
    try { await ffmpeg.deleteFile('audio.wav'); } catch (e) {}
    try { await ffmpeg.deleteFile(outputName); } catch (e) {}
  }
}

// ================= RENDER LIST =================
function renderSFXList() {
  sfxList.innerHTML = '';
  detectedPoints.forEach((point, i) => {
    const div = document.createElement('div');
    div.className = 'sfx-item';
    div.innerHTML = `
      <span class="sfx-time">${formatTime(point.time)}</span>
      <span class="sfx-type">🔄 Transisi</span>
      <span class="sfx-name">${sfxFiles[i % sfxFiles.length].name}</span>
      <span class="sfx-confidence">${Math.round(point.confidence * 100)}%</span>
    `;
    sfxList.appendChild(div);
  });
}

// ================= DOWNLOAD =================
function downloadVideo() {
  if (!processedBlob) return;
  const ext = processedBlob.type.includes('webm') ? 'webm' : 'mp4';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(processedBlob);
  a.download = `video_with_sfx_${Date.now()}.${ext}`;
  a.click();
  showAlert('📥 Download dimulai...', 'success');
}
