// ================= STATE =================
let videoFile = null;
let sfxFiles = [];
let detectedPoints = [];
let processedBlob = null;
let isProcessing = false;

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
  videoInput.addEventListener('change', e => {
    if (e.target.files[0]) { videoFile = e.target.files[0]; onVideoUpload(); }
  });
  sfxInput.addEventListener('change', e => {
    if (e.target.files.length) { sfxFiles = Array.from(e.target.files); onSFXUpload(); }
  });
  $('transitionSensitivity').addEventListener('input', () => {
    $('sensitivityValue').textContent = $('transitionSensitivity').value;
  });
  $('sfxVolume').addEventListener('input', () => {
    $('volumeValue').textContent = $('sfxVolume').value + '%';
  });
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
  progressFill.style.width = p + '%';
  progressText.textContent = `${msg} (${Math.round(p)}%)`;
}
function formatSize(b) {
  if (b === 0) return '0 B';
  const k = 1024, s = ['B','KB','MB','GB'], i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(2)) + ' ' + s[i];
}
function formatTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60), ms = Math.floor((sec % 1) * 100);
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(2,'0')}`;
}

// ================= SEEK =================
function seekTo(video, time) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', finish);
      resolve();
    };
    const onSeeked = () => finish();

    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', finish, { once: true });

    try {
      video.currentTime = time;
    } catch (e) {
      finish();
      return;
    }

    setTimeout(finish, 1000);
  });
}

// ================= HISTOGRAM =================
function computeHistogram(imgData) {
  const hist = new Float32Array(64);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
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

// ================= EKSTRAK HISTOGRAM =================
async function extractHistograms(video, sampleFps) {
  const duration = video.duration;
  const interval = 1 / sampleFps;
  const histograms = [];

  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 90;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const totalSamples = Math.max(1, Math.floor(duration * sampleFps));
  let count = 0;

  for (let t = 0; t < duration; t += interval) {
    await seekTo(video, t);
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      histograms.push({ time: t, hist: computeHistogram(imgData) });
    } catch (e) {
      console.warn('Gagal baca frame di', t, e);
    }
    count++;
    updateProgress(5 + (count / totalSamples) * 20, 'Analisis histogram...');
  }

  console.log(`📊 Total histograms: ${histograms.length}`);
  return histograms;
}

// ================= DETEKSI SHOT BOUNDARY =================
function detectShotBoundaries(histograms, sensitivity) {
  if (histograms.length < 3) return [];

  const distances = [];
  for (let i = 1; i < histograms.length; i++) {
    distances.push({
      index: i,
      time: histograms[i].time,
      distance: histogramDistance(histograms[i - 1].hist, histograms[i].hist)
    });
  }

  const values = distances.map(d => d.distance);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);

  const k = 5 - (sensitivity - 1) * (4.2 / 9);
  const threshold = mean + k * stdDev;
  const minDistance = mean + 0.5 * stdDev;

  console.log(`📊 Deteksi: mean=${mean.toFixed(4)}, stdDev=${stdDev.toFixed(4)}, k=${k.toFixed(2)}, threshold=${threshold.toFixed(4)}`);

  const candidates = distances.filter(d => d.distance > threshold && d.distance >= minDistance);

  const peaks = [];
  let i = 0;
  while (i < candidates.length) {
    let best = candidates[i];
    let j = i;
    while (j + 1 < candidates.length && (candidates[j + 1].time - candidates[j].time) < 0.4) {
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

    const video = document.createElement('video');
    video.src = URL.createObjectURL(videoFile);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';

    await new Promise((res, rej) => {
      video.onloadedmetadata = res;
      video.onerror = () => rej(new Error('Gagal memuat video'));
    });

    if (video.readyState < 1) {
      await new Promise((res) => {
        video.onloadeddata = res;
        setTimeout(res, 2000);
      });
    }

    const duration = video.duration;
    const sensitivity = parseInt($('transitionSensitivity').value);

    updateProgress(5, 'Mengambil sample frame...');
    const histograms = await extractHistograms(video, 10);

    updateProgress(30, 'Mendeteksi shot boundary...');
    detectedPoints = detectShotBoundaries(histograms, sensitivity);

    $('statistics').style.display = 'grid';
    statTransitions.textContent = detectedPoints.length;
    statSFX.textContent = detectedPoints.length;
    statDuration.textContent = Math.round(duration) + 's';

    if (detectedPoints.length === 0) {
      showAlert('⚠️ Tidak ada transisi terdeteksi. Naikkan sensitivitas dan coba lagi.', 'error');
      return;
    }

    updateProgress(45, 'Menyiapkan rendering...');
    processedBlob = await renderVideoWithSFX(video, detectedPoints);

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

// ================= RENDER VIDEO + SFX =================
// DIPERBAIKI: tunggu event 'playing' sebelum menghitung startTime, agar SFX
// tidak bergeser karena latency play().
async function renderVideoWithSFX(sourceVideo, points) {
  const sfxVolume = parseInt($('sfxVolume').value) / 100;

  const video = document.createElement('video');
  video.src = sourceVideo.src;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';

  await new Promise((res, rej) => {
    video.onloadedmetadata = res;
    video.onerror = () => rej(new Error('Gagal load video untuk render'));
  });

  // Canvas untuk video track
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext('2d');

  // Audio context
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.resume();

  const videoSourceNode = audioCtx.createMediaElementSource(video);
  const dest = audioCtx.createMediaStreamDestination();
  const originalGain = audioCtx.createGain();
  originalGain.gain.value = 1.0;

  videoSourceNode.connect(originalGain);
  originalGain.connect(dest);
  originalGain.connect(audioCtx.destination); // monitor

  // Video stream dari canvas
  const canvasStream = canvas.captureStream(30);

  // Gabung video + audio
  const combined = new MediaStream();
  combined.addTrack(canvasStream.getVideoTracks()[0]);
  combined.addTrack(dest.stream.getAudioTracks()[0]);

  // Preload SFX
  showLoading('Memuat SFX...');
  const sfxBuffers = [];
  for (const f of sfxFiles) {
    const ab = await f.arrayBuffer();
    const buf = await audioCtx.decodeAudioData(ab.slice(0));
    sfxBuffers.push(buf);
  }
  hideLoading();

  // MediaRecorder
  let mimeType = 'video/webm';
  if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')) {
    mimeType = 'video/webm;codecs=vp9,opus';
  } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) {
    mimeType = 'video/webm;codecs=vp8,opus';
  }

  const recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: 3000000 });
  const chunks = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  const recordingDone = new Promise(resolve => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
  });

  // Reset video ke awal
  video.currentTime = 0;
  await new Promise(r => {
    const onSeeked = () => { video.removeEventListener('seeked', onSeeked); r(); };
    video.addEventListener('seeked', onSeeked);
    setTimeout(r, 500);
  });

  // Draw loop
  let drawActive = true;
  const draw = () => {
    if (!drawActive) return;
    if (!video.paused && !video.ended) {
      try { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); } catch (e) {}
    }
    requestAnimationFrame(draw);
  };

  // ============ TIMING YANG DIPERBAIKI ============
  // Mulai recorder DULU, lalu play video, tunggu event 'playing' baru
  // hitung startTime dengan kompensasi latency.
  recorder.start(100);
  await video.play();

  await new Promise(resolve => {
    if (video.currentTime > 0) return resolve();
    video.addEventListener('playing', resolve, { once: true });
  });

  const startTime = audioCtx.currentTime - video.currentTime; // kompensasi latency start
  draw();

  // Jadwalkan SFX SETELAH startTime diketahui
  points.forEach((p, i) => {
    const buf = sfxBuffers[i % sfxBuffers.length];
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const gain = audioCtx.createGain();
    gain.gain.value = sfxVolume;
    src.connect(gain);
    gain.connect(dest);
    const when = startTime + Math.max(0, p.time);
    try { src.start(when); } catch (e) { console.warn('SFX start err', e); }
  });
  // ================================================

  // Progress
  const duration = video.duration;
  const t0 = performance.now();
  const interval = setInterval(() => {
    const elapsed = (performance.now() - t0) / 1000;
    const pct = 45 + Math.min(50, (elapsed / duration) * 50);
    updateProgress(pct, 'Merekam video + SFX...');
    if (elapsed >= duration) clearInterval(interval);
  }, 200);

  // Tunggu selesai
  await new Promise(resolve => {
    video.onended = resolve;
    setTimeout(resolve, (duration + 2) * 1000);
  });

  clearInterval(interval);
  drawActive = false;
  recorder.stop();
  video.pause();

  const blob = await recordingDone;
  try { audioCtx.close(); } catch (e) {}
  return blob;
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
  const a = document.createElement('a');
  a.href = URL.createObjectURL(processedBlob);
  a.download = `video_with_sfx_${Date.now()}.webm`;
  a.click();
  showAlert('📥 Download dimulai...', 'success');
}
