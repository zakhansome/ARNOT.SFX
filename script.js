// State Management
let videoFile = null;
let sfxFiles = [];
let placementMode = 'transition';
let processedVideoUrl = null;
let detectedSFXPoints = [];
let processedBlob = null;
let audioContext = null;
let ffmpeg = null;

// DOM Elements
const videoInput = document.getElementById('videoInput');
const sfxInput = document.getElementById('sfxInput');
const videoUploadBox = document.getElementById('videoUploadBox');
const sfxUploadBox = document.getElementById('sfxUploadBox');
const videoInfo = document.getElementById('videoInfo');
const sfxInfo = document.getElementById('sfxInfo');
const processBtn = document.getElementById('processBtn');
const progressSection = document.getElementById('progressSection');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const previewSection = document.getElementById('previewSection');
const videoPreview = document.getElementById('videoPreview');
const sfxList = document.getElementById('sfxList');
const alertBox = document.getElementById('alertBox');
const loadingOverlay = document.getElementById('loadingOverlay');

// Initialize FFmpeg
async function initFFmpeg() {
    if (!ffmpeg) {
        showLoading();
        try {
            const { createFFmpeg, fetchFile } = FFmpeg;
            ffmpeg = createFFmpeg({ 
                log: true,
                corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.4/dist/ffmpeg-core.js',
                progress: ({ ratio }) => {
                    if (ratio) {
                        updateProgress(70 + ratio * 15, 'Processing dengan FFmpeg...');
                    }
                }
            });
            await ffmpeg.load();
            hideLoading();
            return ffmpeg;
        } catch (error) {
            hideLoading();
            console.error('FFmpeg initialization error:', error);
            throw new Error('Gagal menginisialisasi FFmpeg: ' + error.message);
        }
    }
    return ffmpeg;
}

// File Upload Handlers
videoInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        videoFile = e.target.files[0];
        videoInfo.textContent = `📁 ${videoFile.name}\nUkuran: ${formatFileSize(videoFile.size)}`;
        videoInfo.classList.add('show');
        videoUploadBox.classList.add('has-file');
        updateProcessButton();
        showAlert('✅ Video berhasil diupload!', 'success');
    }
});

sfxInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        sfxFiles = Array.from(e.target.files);
        sfxInfo.textContent = `📁 ${sfxFiles.length} file SFX dipilih:\n${sfxFiles.map(f => f.name).join('\n')}`;
        sfxInfo.classList.add('show');
        sfxUploadBox.classList.add('has-file');
        updateProcessButton();
        showAlert(`✅ ${sfxFiles.length} file SFX berhasil diupload!`, 'success');
    }
});

// Drag and Drop Support
[videoUploadBox, sfxUploadBox].forEach(box => {
    box.addEventListener('dragover', (e) => {
        e.preventDefault();
        box.classList.add('active');
    });

    box.addEventListener('dragleave', () => {
        box.classList.remove('active');
    });

    box.addEventListener('drop', (e) => {
        e.preventDefault();
        box.classList.remove('active');
        
        const files = e.dataTransfer.files;
        if (box === videoUploadBox && files.length > 0) {
            const file = files[0];
            if (file.type.startsWith('video/')) {
                videoFile = file;
                videoInfo.textContent = `📁 ${videoFile.name}\nUkuran: ${formatFileSize(videoFile.size)}`;
                videoInfo.classList.add('show');
                videoUploadBox.classList.add('has-file');
                updateProcessButton();
                showAlert('✅ Video berhasil diupload!', 'success');
            } else {
                showAlert('Mohon upload file video yang valid', 'error');
            }
        } else if (box === sfxUploadBox && files.length > 0) {
            const audioFiles = Array.from(files).filter(f => f.type.startsWith('audio/'));
            if (audioFiles.length > 0) {
                sfxFiles = [...sfxFiles, ...audioFiles];
                sfxInfo.textContent = `📁 ${sfxFiles.length} file SFX dipilih:\n${sfxFiles.map(f => f.name).join('\n')}`;
                sfxInfo.classList.add('show');
                sfxUploadBox.classList.add('has-file');
                updateProcessButton();
                showAlert(`✅ ${audioFiles.length} file SFX berhasil ditambahkan!`, 'success');
            }
        }
    });
});

// Placement Mode Selection
function selectPlacementMode(mode) {
    placementMode = mode;
    document.querySelectorAll('.option-card').forEach(card => {
        card.classList.remove('selected');
    });
    document.querySelector(`[data-mode="${mode}"]`).classList.add('selected');
}

// Sensitivity Update
function updateSensitivityValue() {
    const sensitivity = document.getElementById('transitionSensitivity').value;
    document.getElementById('sensitivityValue').textContent = sensitivity;
}

// Volume Update
function updateVolumeValue() {
    const volume = document.getElementById('sfxVolume').value;
    document.getElementById('volumeValue').textContent = volume + '%';
}

// Process Button Update
function updateProcessButton() {
    processBtn.disabled = !(videoFile && sfxFiles.length > 0);
}

// Main Processing Function
async function processVideo() {
    if (!videoFile || sfxFiles.length === 0) {
        showAlert('Mohon upload video dan minimal satu file SFX', 'error');
        return;
    }

    // Show progress
    progressSection.classList.add('show');
    previewSection.classList.remove('show');
    processBtn.disabled = true;
    document.getElementById('statistics').style.display = 'grid';

    try {
        // Step 1: Initialize FFmpeg
        updateProgress(5, 'Menginisialisasi FFmpeg...');
        await initFFmpeg();

        // Step 2: Extract video frames
        updateProgress(10, 'Mengekstrak frame video...');
        const videoData = await extractVideoData(videoFile);
        
        // Step 3: Detect transitions using pixel analysis
        updateProgress(30, 'Mendeteksi transisi frame dengan AI...');
        const transitions = await detectTransitions(videoData);
        
        // Step 4: Detect text using OCR
        updateProgress(50, 'Mendeteksi teks dengan OCR...');
        const textAppearances = await detectText(videoData);
        
        // Step 5: Map SFX to detected points
        updateProgress(70, 'Menempatkan SFX pada titik yang terdeteksi...');
        detectedSFXPoints = mapSFXToPoints(transitions, textAppearances);
        
        // Step 6: Process video with FFmpeg
        updateProgress(85, 'Menggabungkan video dengan SFX...');
        processedBlob = await processWithFFmpeg(videoData, detectedSFXPoints);
        
        // Step 7: Create preview URL
        processedVideoUrl = URL.createObjectURL(processedBlob);
        
        // Step 8: Update statistics
        updateStatistics(transitions.length, textAppearances.length, detectedSFXPoints.length, videoData.duration);
        
        // Step 9: Show preview
        updateProgress(100, 'Selesai!');
        showPreview();
        
        showAlert('✅ Video berhasil diproses! SFX telah ditempatkan secara otomatis.', 'success');
    } catch (error) {
        console.error('Processing error:', error);
        showAlert('❌ Gagal memproses video: ' + error.message, 'error');
    } finally {
        progressSection.classList.remove('show');
        processBtn.disabled = false;
    }
}

// Extract Video Data
async function extractVideoData(videoFile) {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        video.onloadedmetadata = () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            
            const duration = video.duration;
            const frameInterval = 0.5; // Extract frame every 0.5 seconds
            const frameCount = Math.floor(duration / frameInterval);
            const frames = [];
            
            let currentFrame = 0;
            
            video.onseeked = () => {
                ctx.drawImage(video, 0, 0);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                frames.push({
                    time: video.currentTime,
                    data: imageData,
                    canvas: canvas.cloneNode(true)
                });
                
                currentFrame++;
                if (currentFrame < frameCount) {
                    video.currentTime = currentFrame * frameInterval;
                } else {
                    URL.revokeObjectURL(video.src);
                    resolve({
                        frames,
                        duration,
                        width: video.videoWidth,
                        height: video.videoHeight,
                        videoUrl: URL.createObjectURL(videoFile)
                    });
                }
            };
            
            video.onerror = reject;
            video.currentTime = 0;
        };
        
        video.onerror = reject;
        video.src = URL.createObjectURL(videoFile);
    });
}

// Detect Transitions
async function detectTransitions(videoData) {
    const sensitivity = parseInt(document.getElementById('transitionSensitivity').value);
    const threshold = parseInt(document.getElementById('transitionThreshold').value);
    const transitions = [];
    
    for (let i = 1; i < videoData.frames.length; i++) {
        const prevFrame = videoData.frames[i - 1];
        const currFrame = videoData.frames[i];
        
        const difference = calculateFrameDifference(prevFrame.data, currFrame.data);
        const adjustedThreshold = threshold / (sensitivity * 0.5);
        
        if (difference > adjustedThreshold) {
            transitions.push({
                time: currFrame.time,
                confidence: Math.min(difference / 100, 1),
                type: 'transition',
                difference: difference
            });
        }
    }
    
    return transitions;
}

// Calculate Frame Difference
function calculateFrameDifference(frame1Data, frame2Data) {
    const data1 = frame1Data.data;
    const data2 = frame2Data.data;
    let totalDifference = 0;
    const sampleSize = Math.min(data1.length, 10000); // Sample for performance
    
    for (let i = 0; i < sampleSize; i += 4) {
        const rDiff = Math.abs(data1[i] - data2[i]);
        const gDiff = Math.abs(data1[i + 1] - data2[i + 1]);
        const bDiff = Math.abs(data1[i + 2] - data2[i + 2]);
        totalDifference += (rDiff + gDiff + bDiff) / 3;
    }
    
    return (totalDifference / (sampleSize / 4)) * (100 / 255);
}

// Detect Text using OCR
async function detectText(videoData) {
    const textAppearances = [];
    const sensitivity = parseInt(document.getElementById('transitionSensitivity').value);
    const frameInterval = Math.max(1, Math.floor(10 / sensitivity)); // Check every N frames
    
    for (let i = 0; i < videoData.frames.length; i += frameInterval) {
        const frame = videoData.frames[i];
        
        try {
            // Use Tesseract.js for OCR
            const result = await Tesseract.recognize(
                frame.canvas,
                'eng',
                { 
                    logger: m => {
                        if (m.status === 'recognizing text') {
                            updateProgress(50 + (m.progress * 0.2), 'Mendeteksi teks dengan OCR...');
                        }
                    }
                }
            );
            
            if (result.data.text && result.data.text.trim().length > 0) {
                textAppearances.push({
                    time: frame.time,
                    confidence: result.data.confidence / 100,
                    type: 'text',
                    text: result.data.text.trim().substring(0, 50)
                });
            }
        } catch (error) {
            console.warn('OCR error:', error);
        }
    }
    
    return textAppearances;
}

// Map SFX to Points
function mapSFXToPoints(transitions, textAppearances) {
    const points = [];
    let detectionPoints = [];
    
    if (placementMode === 'transition') {
        detectionPoints = transitions;
    } else if (placementMode === 'text') {
        detectionPoints = textAppearances;
    } else if (placementMode === 'both') {
        detectionPoints = [...transitions, ...textAppearances];
    }
    
    detectionPoints.sort((a, b) => a.time - b.time);
    
    detectionPoints.forEach((point, index) => {
        if (point.confidence > 0.3) {
            const sfxFile = sfxFiles[index % sfxFiles.length];
            points.push({
                time: point.time,
                sfxFile: sfxFile,
                sfxName: sfxFile.name,
                type: point.type,
                confidence: point.confidence,
                text: point.text || ''
            });
        }
    });
    
    return points;
}

// Process with FFmpeg
async function processWithFFmpeg(videoData, sfxPoints) {
    const { fetchFile } = FFmpeg;
    const volume = parseInt(document.getElementById('sfxVolume').value) / 100;
    
    // Write video file
    ffmpeg.FS('writeFile', 'input.mp4', await fetchFile(videoFile));
    
    // Build FFmpeg command
    let command = ['-i', 'input.mp4'];
    
    // Add SFX files
    sfxPoints.forEach((point, index) => {
        const data = new Uint8Array(point.sfxFile);
        ffmpeg.FS('writeFile', `sfx_${index}.mp3`, data);
        command.push('-i', `sfx_${index}.mp3`);
    });
    
    // Build filter complex
    let filterComplex = [];
    sfxPoints.forEach((point, index) => {
        filterComplex.push(`[${index + 1}:a]volume=${volume}[a${index}]`);
    });
    
    // Mix audio
    if (sfxPoints.length > 0) {
        const mixInputs = sfxPoints.map((_, index) => `[a${index}]`).join('');
        filterComplex.push(`${mixInputs}amix=inputs=${sfxPoints.length}:duration=longest[mixed]`);
        filterComplex.push(`[0:a][mixed]amix=inputs=2:duration=first[outa]`);
    } else {
        filterComplex.push(`[0:a]anull[outa]`);
    }
    
    command.push('-filter_complex', filterComplex.join(';'));
    command.push('-map', '0:v');
    command.push('-map', '[outa]');
    command.push('-c:v', 'libx264');
    command.push('-c:a', 'aac');
    command.push('-shortest');
    command.push('output.mp4');
    
    // Run FFmpeg
    await ffmpeg.run(...command);
    
    // Read output
    const data = ffmpeg.FS('readFile', 'output.mp4');
    return new Blob([data.buffer], { type: 'video/mp4' });
}

// Update Statistics
function updateStatistics(transitionCount, textCount, sfxCount, duration) {
    document.getElementById('statTransitions').textContent = transitionCount;
    document.getElementById('statTexts').textContent = textCount;
    document.getElementById('statSFX').textContent = sfxCount;
    document.getElementById('statDuration').textContent = Math.round(duration) + 's';
}

// Show Preview
function showPreview() {
    previewSection.classList.add('show');
    
    if (processedVideoUrl) {
        videoPreview.src = processedVideoUrl;
    }
    
    // Display SFX timeline
    sfxList.innerHTML = '';
    detectedSFXPoints.forEach((point, index) => {
        const sfxItem = document.createElement('div');
        sfxItem.className = 'sfx-item';
        sfxItem.innerHTML = `
            <span class="sfx-time">${formatTime(point.time)}</span>
            <span class="sfx-type">${point.type === 'transition' ? '🔄 Transisi' : '📝 Teks'}</span>
            <span class="sfx-name">${point.sfxName}</span>
            <span class="sfx-confidence">Confidence: ${Math.round(point.confidence * 100)}%</span>
            ${point.text ? `<span class="sfx-confidence">Text: "${point.text}"</span>` : ''}
        `;
        sfxList.appendChild(sfxItem);
    });
}

// Adjust Preview Volume
function adjustPreviewVolume() {
    const volume = document.getElementById('previewVolume').value / 100;
    videoPreview.volume = volume;
    document.getElementById('previewVolumeValue').textContent = Math.round(volume * 100) + '%';
}

// Download Functions
function downloadVideo() {
    if (processedBlob) {
        const url = URL.createObjectURL(processedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `video_with_sfx_${Date.now()}.mp4`;
        a.click();
        URL.revokeObjectURL(url);
        showAlert('📥 Video sedang didownload...', 'success');
    }
}

function downloadSFXList() {
    if (detectedSFXPoints.length > 0) {
        const sfxListText = detectedSFXPoints.map((point, index) => {
            return `${index + 1}. Waktu: ${formatTime(point.time)} | Tipe: ${point.type} | SFX: ${point.sfxName} | Confidence: ${Math.round(point.confidence * 100)}%${point.text ? ` | Teks: "${point.text}"` : ''}`;
        }).join('\n');
        
        const blob = new Blob([sfxListText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sfx_timeline_${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        showAlert('📋 Daftar SFX didownload!', 'success');
    }
}

// Utility Functions
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

function updateProgress(percent, message) {
    progressFill.style.width = percent + '%';
    progressText.textContent = message + ` (${percent}%)`;
}

function showAlert(message, type) {
    alertBox.textContent = message;
    alertBox.className = `alert alert-${type} show`;
    setTimeout(() => {
        alertBox.classList.remove('show');
    }, 5000);
}

function showLoading() {
    loadingOverlay.classList.add('show');
}

function hideLoading() {
    loadingOverlay.classList.remove('show');
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    console.log('AI Auto SFX Video Tool - Production Version');
    console.log('Aplikasi siap digunakan!');
    
    // Set initial values
    updateSensitivityValue();
    updateVolumeValue();
});