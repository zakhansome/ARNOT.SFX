// ================= STATE =================
let videoFile = null;
let sfxFiles = [];
let placementMode = 'transition';
let processedBlob = null;
let detectedTransitions = [];
let detectedTexts = [];
let combinedPoints = [];
let isProcessing = false;
let ffmpeg = null;
let ffmpegLoaded = false;

// ================= DOM =================
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
const loadingDetail = $('loadingDetail');
const downloadVideoBtn = $('downloadVideoBtn');
const downloadSFXBtn = $('downloadSFXBtn');
const statTransitions = $('statTransitions');
const statTexts = $('statTexts');
const statSFX = $('statSFX');
const statDuration = $('statDuration');

// ================= INIT =================
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  updateSensitivityValue();
  updateVolumeValue();
  // Preload FFmpeg di background
  initFFmpeg().catch(err => console.warn('FFmpeg tidak bisa dimuat:', err));
});

function setupEventListeners() {
  videoBox.addEventListener('click', () => videoInput.click());
  sfxBox.addEventListener('click', () => sfxInput.click());

  videoInput.addEventListener('change', handleVideoUpload);
  sfxInput.addEventListener('change', handleSFXUpload);

  // Drag & drop
  [videoBox, sfxBox].forEach(box => {
    box.addEventListener('dragover', e => { e.preventDefault(); box.classList.add('active'); });
    box.addEventListener('dragleave', () => box.classList.remove('active'));
    box.addEventListener('drop', e => {
      e.preventDefault();
      box.classList.remove('active');
      const files = e.dataTransfer.files;
      if (box === videoBox && files[0]?.type.startsWith('video/')) {
        videoFile = files[0];
        updateVideoInfo();
      } else if (box === sfxBox) {
        const audios = Array.from(files).filter(f => f.type.startsWith('audio/'));
        if (audios.length) {
          sfxFiles = [...sfxFiles, ...audios];
          updateSFXInfo();
        }
      }
      updateProcessButton();
    });
  });

  // Opsi mode
  document.querySelectorAll('.option-card').forEach(card => {
    card.addEventListener('click', () => selectPlacementMode(card.dataset.mode));
  });

  // Slider
  $('transitionSensitivity').addEventListener('input', updateSensitivityValue);
  $('sfxVolume').addEventListener('input', updateVolumeValue);
  $('previewVolume').addEventListener('input', updatePreviewVolume);

  // Tombol
  processBtn.addEventListener('click', processVideo);
  downloadVideoBtn.addEventListener('click', downloadVideo);
  downloadSFXBtn.addEventListener('click', downloadSFXList);
}

// ================= UPLOAD HANDLERS =================
function handleVideoUpload(e) {
  if (e.target.files[0]) {
    videoFile = e.target.files[0];
    updateVideoInfo();
  }
}

function handleSFXUpload(e) {
  if (e.target.files.length) {
    sfxFiles = Array.from(e.target.files);
    updateSFXInfo();
  }
}

function updateVideoInfo() {
  videoInfo.textContent = `📁 ${videoFile.name} (${formatSize(videoFile.size)})`;
  videoInfo.classList.add('show');
  videoBox.classList.add('has-file');
  updateProcessButton();
  showAlert('✅ Video diupload', 'success');
}

function updateSFXInfo() {
  sfxInfo.textContent = `📁 ${sfxFiles.length} SFX: ${sfxFiles.map(f => f.name).join(', ')}`;
  sfxInfo.classList.add('show');
  sfxBox.classList.add('has-file');
  updateProcessButton();
  showAlert(`✅ ${sfxFiles.length} SFX diupload`, 'success');
}

function updateProcessButton() {
  processBtn.disabled = !(videoFile && sfxFiles.length > 0);
}

// ================= UI HELPERS =================
function selectPlacementMode(mode) {
  placementMode = mode;
  document.querySelectorAll('.option-card').forEach(c => c.classList.remove('selected'));
  document.querySelector(`[data-mode="${mode}"]`).classList.add('selected');
}

function updateSensitivityValue() {
  $('sensitivityValue').textContent = $('transitionSensitivity').value;
}

function updateVolumeValue() {
  $('volumeValue').textContent = $('sfxVolume').value + '%';
}

function updatePreviewVolume() {
  videoPreview.volume = $('previewVolume').value / 100;
  $('previewVolumeValue').textContent = $('previewVolume').value + '%';
}

function showAlert(msg, type) {
  alertBox.textContent = msg;
  alertBox.className = `alert alert-${type} show`;
  setTimeout(() => alertBox.classList.remove('show'), 5000);
}

function showLoading(msg) {
  loadingDetail.textContent = msg || 'Memproses...';
  loadingOverlay.classList.add('show');
}

function hideLoading() {
  loadingOverlay.classList.remove('show');
}

function updateProgress(percent, msg) {
  progressFill.style.width = percent + '%';
  progressText.textContent = `${msg} (${Math.round(percent)}%)`;
}

// ================= UTIL =================
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 100);
  return `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}.${ms.toString().padStart(2,'0')}`;
}

// ================= FFMPEG INIT =================
async function initFFmpeg() {
  if (ffmpegLoaded && ffmpeg) return ffmpeg;

  showLoading('Menginisialisasi FFmpeg...');
  try {
    if (typeof FFmpeg === 'undefined') {
      throw new Error('Library FFmpeg tidak ditemukan. Periksa koneksi internet.');
    }

    const { createFFmpeg, fetchFile } = FFmpeg;
    ffmpeg = createFFmpeg({
      log: true,
      corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js',
      wasmPath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/ffmpeg-core.wasm',
      workerPath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/ffmpeg-core.worker.js',
      progress: ({ ratio }) => {
        if (ratio) {
          const percent = Math.round(ratio * 100);
          updateProgress(70 + (percent * 0.2), `Processing FFmpeg... ${percent}%`);
        }
      }
    });

    showLoading('Mengunduh FFmpeg core...');
    await ffmpeg.load();
    ffmpegLoaded = true;
    hideLoading();
    console.log('✅ FFmpeg siap');
    return ffmpeg;
  } catch (err) {
    hideLoading();
    console.error('❌ Gagal init FFmpeg:', err);
    throw err;
  }
}

// ================= EKSTRAKSI FRAME & DETEKSI TRANSISI =================
async function extractFrames(videoElement, fps = 5) {
  return new Promise(async (resolve, reject) => {
    const frames = [];
    const duration = videoElement.duration;
    const interval = 1 / fps;
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const seekTo = (time) => new Promise((res, rej) => {
      const onSeeked = () => {
        videoElement.removeEventListener('seeked', onSeeked);
        res();
      };
      videoElement.addEventListener('seeked', onSeeked);
      videoElement.currentTime = time;
      // Timeout pengaman 500ms
      setTimeout(() => {
        videoElement.removeEventListener('seeked', onSeeked);
        res();
      }, 500);
    });

    try {
      for (let t = 0; t <= duration; t += interval) {
        await seekTo(t);
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        frames.push({ time: t, data: imageData.data });
        updateProgress(15 + (t / duration) * 15, 'Ekstraksi frame...');
      }
      resolve(frames);
    } catch (err) {
      reject(err);
    }
  });
}

function computeFrameDifference(frame1, frame2) {
  const d1 = frame1.data;
  const d2 = frame2.data;
  let diff = 0;
  const step = 4;
  const len = d1.length;
  for (let i = 0; i < len; i += step) {
    const g1 = 0.299 * d1[i] + 0.587 * d1[i+1] + 0.114 * d1[i+2];
    const g2 = 0.299 * d2[i] + 0.587 * d2[i+1] + 0.114 * d2[i+2];
    diff += Math.abs(g1 - g2);
  }
  const pixelCount = len / step;
  return (diff / pixelCount) * (100 / 255);
}

async function detectTransitions(videoElement) {
  const sensitivity = parseInt($('transitionSensitivity').value);
  const minThreshold = parseInt($('transitionThreshold').value);
  const fps = 5;

  showLoading('Mengekstrak frame...');
  const frames = await extractFrames(videoElement, fps);
  console.log(`📊 Frame diekstrak: ${frames.length}`);

  if (frames.length < 2) throw new Error('Gagal mengekstrak frame');

  const diffs = [];
  for (let i = 1; i < frames.length; i++) {
    diffs.push({
      index: i,
      time: frames[i].time,
      diff: computeFrameDifference(frames[i-1], frames[i])
    });
  }

  const mean = diffs.reduce((s, d) => s + d.diff, 0) / diffs.length;
  const variance = diffs.reduce((s, d) => s + (d.diff - mean) ** 2, 0) / diffs.length;
  const stdDev = Math.sqrt(variance);
  const adaptiveThreshold = Math.max(minThreshold, mean + sensitivity * 0.5 * stdDev);

  console.log(`📈 Mean diff: ${mean.toFixed(2)}, StdDev: ${stdDev.toFixed(2)}, Threshold: ${adaptiveThreshold.toFixed(2)}`);

  let transitions = diffs.filter(d => d.diff > adaptiveThreshold);

  // Gabungkan yang berdekatan (<0.5 detik)
  const merged = [];
  for (const t of transitions) {
    if (merged.length === 0 || (t.time - merged[merged.length-1].time) > 0.5) {
      merged.push(t);
    } else if (t.diff > merged[merged.length-1].diff) {
      merged[merged.length-1] = t;
    }
  }

  console.log(`🎯 Transisi terdeteksi: ${merged.length}`);
  return merged.map(t => ({ time: t.time, confidence: Math.min(t.diff / 50, 1), type: 'transition' }));
}

// ================= DETEKSI TEKS =================
async function detectTexts(videoElement) {
  // Placeholder: implementasi OCR tidak diaktifkan karena berat
  return [];
}

// ================= PROSES UTAMA =================
async function processVideo() {
  if (isProcessing) return;
  isProcessing = true;
  processBtn.disabled = true;

  detectedTransitions = [];
  detectedTexts = [];
  combinedPoints = [];
  processedBlob = null;

  try {
    progressSection.classList.add('show');
    previewSection.classList.remove('show');

    // Buat elemen video sementara
    const tempVideo = document.createElement('video');
    tempVideo.src = URL.createObjectURL(videoFile);
    tempVideo.muted = true;
    tempVideo.playsInline = true;
    await new Promise((res, rej) => {
      tempVideo.onloadedmetadata = res;
      tempVideo.onerror = () => rej(new Error('Gagal memuat metadata video'));
    });

    // Deteksi transisi
    updateProgress(20, 'Mendeteksi transisi...');
    if (placementMode === 'transition' || placementMode === 'both') {
      detectedTransitions = await detectTransitions(tempVideo);
    }

    // Deteksi teks (jika diperlukan)
    if (placementMode === 'text' || placementMode === 'both') {
      updateProgress(40, 'Mendeteksi teks...');
      detectedTexts = await detectTexts(tempVideo);
    }

    // Gabungkan titik deteksi
    combinedPoints = [...detectedTransitions, ...detectedTexts].sort((a,b) => a.time - b.time);

    // Update statistik
    $('statistics').style.display = 'grid';
    statTransitions.textContent = detectedTransitions.length;
    statTexts.textContent = detectedTexts.length;
    statSFX.textContent = combinedPoints.length;
    statDuration.textContent = Math.round(tempVideo.duration) + 's';

    if (combinedPoints.length === 0) {
      showAlert('⚠️ Tidak ada transisi/teks terdeteksi. Coba turunkan threshold atau naikkan sensitivitas.', 'error');
      return;
    }

    // Proses dengan FFmpeg
    updateProgress(60, 'Menggabungkan audio dengan FFmpeg...');
    await initFFmpeg(); // pastikan sudah siap
    processedBlob = await addSFXWithFFmpeg(tempVideo.duration, combinedPoints);

    // Tampilkan preview
    updateProgress(90, 'Menyiapkan preview...');
    const processedUrl = URL.createObjectURL(processedBlob);
    videoPreview.src = processedUrl;
    previewSection.classList.add('show');
    renderSFXList();

    showAlert('✅ Berhasil! Video dengan SFX siap diunduh.', 'success');

  } catch (err) {
    console.error(err);
    showAlert('❌ Gagal: ' + err.message, 'error');
  } finally {
    isProcessing = false;
    processBtn.disabled = false;
    progressSection.classList.remove('show');
    hideLoading();
    if (tempVideo) URL.revokeObjectURL(tempVideo.src);
  }
}

// ================= PROSES FFMPEG =================
async function addSFXWithFFmpeg(videoDuration, sfxPoints) {
  const { fetchFile } = FFmpeg;
  const volume = parseInt($('sfxVolume').value) / 100;

  // Bersihkan filesystem
  await cleanFFmpegFS();

  // Tulis video input
  const videoExt = videoFile.name.split('.').pop().toLowerCase() || 'mp4';
  const inputVideoName = `input.${videoExt}`;
  ffmpeg.FS('writeFile', inputVideoName, await fetchFile(videoFile));

  // Siapkan command
  let cmd = ['-i', inputVideoName];
  const filterParts = [];

  // Tulis SFX files dan tambahkan input
  for (let i = 0; i < sfxPoints.length; i++) {
    const sfxExt = sfxFiles[i % sfxFiles.length].name.split('.').pop().toLowerCase();
    const sfxName = `sfx_${i}.${sfxExt}`;
    ffmpeg.FS('writeFile', sfxName, await fetchFile(sfxFiles[i % sfxFiles.length]));
    cmd.push('-i', sfxName);

    const delayMs = Math.round(sfxPoints[i].time * 1000);
    filterParts.push(`[${i+1}:a]volume=${volume},adelay=${delayMs}|${delayMs}[a${i}]`);
  }

  // Buat filter untuk audio asli (jika ada)
  filterParts.push(`[0:a]anull[original]`);

  // Mix semua audio SFX
  const sfxInputs = sfxPoints.map((_, i) => `[a${i}]`).join('');
  filterParts.push(`${sfxInputs}amix=inputs=${sfxPoints.length}:duration=longest:normalize=0[sfx_mixed]`);

  // Mix dengan audio asli
  filterParts.push(`[original][sfx_mixed]amix=inputs=2:duration=first:normalize=0[outa]`);

  cmd.push('-filter_complex', filterParts.join(';'));
  cmd.push('-map', '0:v:0');
  cmd.push('-map', '[outa]');
  cmd.push('-c:v', 'libx264');
  cmd.push('-preset', 'fast');
  cmd.push('-crf', '23');
  cmd.push('-c:a', 'aac');
  cmd.push('-b:a', '192k');
  cmd.push('-shortest');
  cmd.push('output.mp4');

  console.log('🎬 FFmpeg command:', cmd.join(' '));
  showLoading('Menjalankan FFmpeg...');

  try {
    await ffmpeg.run(...cmd);
    const data = ffmpeg.FS('readFile', 'output.mp4');
    const blob = new Blob([data.buffer], { type: 'video/mp4' });
    await cleanFFmpegFS();
    return blob;
  } catch (err) {
    console.error('FFmpeg error:', err);
    await cleanFFmpegFS();
    throw new Error('FFmpeg gagal memproses: ' + err.message);
  }
}

async function cleanFFmpegFS() {
  if (!ffmpeg) return;
  try {
    const files = ffmpeg.FS('readdir', '/');
    for (const file of files) {
      if (file !== '.' && file !== '..') {
        try { ffmpeg.FS('unlink', '/' + file); } catch (e) {}
      }
    }
  } catch (err) {
    console.warn('Pembersihan FS gagal:', err);
  }
}

// ================= RENDER SFX LIST =================
function renderSFXList() {
  sfxList.innerHTML = '';
  combinedPoints.forEach((point, i) => {
    const div = document.createElement('div');
    div.className = 'sfx-item';
    div.innerHTML = `
      <span class="sfx-time">${formatTime(point.time)}</span>
      <span class="sfx-type">${point.type === 'transition' ? '🔄 Transisi' : '📝 Teks'}</span>
      <span class="sfx-name">${sfxFiles[i % sfxFiles.length].name}</span>
      <span class="sfx-confidence">Confidence: ${Math.round(point.confidence * 100)}%</span>
    `;
    sfxList.appendChild(div);
  });
}

// ================= DOWNLOAD =================
function downloadVideo() {
  if (processedBlob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(processedBlob);
    a.download = `video_sfx_${Date.now()}.mp4`;
    a.click();
  }
}

function downloadSFXList() {
  if (!combinedPoints.length) return;
  const text = combinedPoints.map((p, i) =>
    `${i+1}. ${formatTime(p.time)} - ${p.type} - ${sfxFiles[i % sfxFiles.length].name}`
  ).join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sfx_timeline.txt';
  a.click();
}
