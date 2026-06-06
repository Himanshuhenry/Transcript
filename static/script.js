/**
 * TranscriptAI - Frontend JavaScript
 * Handles file uploads, transcription polling, and UI updates
 */

// ==================== State Management ====================

let appState = {
    sessionId: null,
    isTranscribing: false,
    currentFile: null,
    transcript: [],
    statusCheckInterval: null
};

// ==================== DOM Elements ====================

const elements = {
    // Upload elements
    fileInput: document.getElementById('fileInput'),
    filePickerBtn: document.getElementById('filePickerBtn'),
    dropZone: document.getElementById('dropZone'),
    uploadCard: document.getElementById('uploadCard'),
    fileInfo: document.getElementById('fileInfo'),
    fileName: document.getElementById('fileName'),
    fileSize: document.getElementById('fileSize'),
    changeFileBtn: document.getElementById('changeFileBtn'),
    
    // Progress elements
    progressSection: document.getElementById('progressSection'),
    progressFill: document.getElementById('progressFill'),
    progressPercent: document.getElementById('progressPercent'),
    statusBadge: document.getElementById('statusBadge'),
    statusMessage: document.getElementById('statusMessage'),
    elapsedTime: document.getElementById('elapsedTime'),
    
    // Transcript elements
    transcriptSection: document.getElementById('transcriptSection'),
    transcriptWindow: document.getElementById('transcriptWindow'),
    segmentCount: document.getElementById('segmentCount'),
    
    // Download elements
    downloadSection: document.getElementById('downloadSection'),
    downloadTxt: document.getElementById('downloadTxt'),
    downloadSrt: document.getElementById('downloadSrt'),
    downloadVtt: document.getElementById('downloadVtt'),
    newTranscriptionBtn: document.getElementById('newTranscriptionBtn'),
    
    // Error elements
    errorSection: document.getElementById('errorSection'),
    errorMessage: document.getElementById('errorMessage'),
    retryBtn: document.getElementById('retryBtn'),
    
    // Status elements
    modelStatus: document.getElementById('modelStatus'),
    statusText: document.getElementById('statusText')
};

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    checkModelStatus();
});

function initializeEventListeners() {
    // File upload events
    elements.filePickerBtn.addEventListener('click', () => elements.fileInput.click());
    elements.fileInput.addEventListener('change', handleFileSelect);
    elements.changeFileBtn.addEventListener('click', resetUpload);
    elements.newTranscriptionBtn.addEventListener('click', resetUpload);
    elements.retryBtn.addEventListener('click', resetUpload);
    
    // Drag and drop events
    elements.dropZone.addEventListener('dragover', handleDragOver);
    elements.dropZone.addEventListener('dragleave', handleDragLeave);
    elements.dropZone.addEventListener('drop', handleDrop);
    
    // Download buttons
    elements.downloadTxt.addEventListener('click', () => downloadTranscript('txt'));
    elements.downloadSrt.addEventListener('click', () => downloadTranscript('srt'));
    elements.downloadVtt.addEventListener('click', () => downloadTranscript('vtt'));
}

// ==================== File Handling ====================

function handleFileSelect(event) {
    const file = event.target.files?.[0];
    if (file) {
        processFile(file);
    }
}

function handleDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    elements.dropZone.classList.add('drag-over');
}

function handleDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    elements.dropZone.classList.remove('drag-over');
}

function handleDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    elements.dropZone.classList.remove('drag-over');
    
    const file = event.dataTransfer?.files?.[0];
    if (file) {
        processFile(file);
    }
}

function processFile(file) {
    // Validate file
    const allowedTypes = ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-m4a', 'video/mp4', 'video/quicktime', 'audio/flac', 'audio/aac'];
    const maxSize = 500 * 1024 * 1024; // 500MB
    
    if (!allowedTypes.includes(file.type) && !file.name.match(/\.(mp3|mp4|wav|m4a|mov|flac|aac)$/i)) {
        showError('Unsupported file type. Please upload MP3, MP4, WAV, M4A, MOV, FLAC, or AAC.');
        return;
    }
    
    if (file.size > maxSize) {
        showError('File is too large. Maximum size is 500MB.');
        return;
    }
    
    // Store file and show info
    appState.currentFile = file;
    elements.fileName.textContent = file.name;
    elements.fileSize.textContent = `${(file.size / (1024 * 1024)).toFixed(2)} MB`;
    
    // Hide drop zone, show file info
    elements.dropZone.style.display = 'none';
    elements.fileInfo.style.display = 'flex';
    
    // Auto-start upload
    uploadFile(file);
}

// ==================== File Upload ====================

async function uploadFile(file) {
    try {
        // Show progress section
        elements.progressSection.style.display = 'block';
        updateStatus('uploading', 0, 'Uploading your file...');
        
        // Create form data
        const formData = new FormData();
        formData.append('file', file);
        
        // Upload file
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Upload failed');
        }
        
        const data = await response.json();
        appState.sessionId = data.session_id;
        appState.isTranscribing = true;
        
        // Start polling status
        elements.transcriptSection.style.display = 'block';
        pollStatus();
        appState.statusCheckInterval = setInterval(pollStatus, 500);
        
    } catch (error) {
        console.error('Upload error:', error);
        showError(error.message);
    }
}

// ==================== Status Polling ====================

let pollStartTime = Date.now();

async function pollStatus() {
    if (!appState.sessionId) return;
    
    try {
        const response = await fetch(`/api/status/${appState.sessionId}`);
        
        if (!response.ok) {
            throw new Error('Status check failed');
        }
        
        const data = await response.json();
        
        // Update UI with status
        updateUIWithStatus(data);
        
        // Check if transcription is done
        if (data.status === 'completed') {
            appState.isTranscribing = false;
            clearInterval(appState.statusCheckInterval);
            showDownloadSection();
        } else if (data.status === 'error') {
            appState.isTranscribing = false;
            clearInterval(appState.statusCheckInterval);
            showError(data.error);
        }
        
    } catch (error) {
        console.error('Poll error:', error);
    }
}

function updateUIWithStatus(data) {
    // Update progress
    updateStatus(data.status, data.progress, getStatusMessage(data.status));
    
    // Update transcript
    if (data.transcript && data.transcript.length > 0) {
        updateTranscript(data.transcript);
    }
    
    // Update elapsed time
    if (data.elapsed_time !== undefined) {
        elements.elapsedTime.textContent = formatTime(data.elapsed_time);
    }
}

function updateStatus(status, progress, message) {
    // Update progress bar
    elements.progressFill.style.width = `${progress}%`;
    elements.progressPercent.textContent = `${progress}%`;
    
    // Update status badge
    elements.statusBadge.textContent = status;
    
    // Update status message
    elements.statusMessage.textContent = message;
}

function getStatusMessage(status) {
    const messages = {
        'uploading': '📤 Uploading your file...',
        'transcribing': '🎵 Transcribing audio to text...',
        'processing': '⚙️ Processing transcript...',
        'completed': '✅ Transcription complete!',
        'error': '❌ An error occurred',
        'ready': '👋 Ready to upload'
    };
    return messages[status] || 'Processing...';
}

// ==================== Transcript Management ====================

function updateTranscript(segments) {
    appState.transcript = segments;
    
    // Check if we need to update the display
    if (segments.length > 0 && elements.transcriptWindow.children.length === 1 && 
        elements.transcriptWindow.querySelector('.transcript-empty')) {
        // Clear empty state and add segments
        elements.transcriptWindow.innerHTML = '';
        renderTranscriptSegments(segments);
    } else if (segments.length > 0) {
        // Just render new segments
        const currentSegmentCount = elements.transcriptWindow.querySelectorAll('.transcript-segment').length;
        if (segments.length > currentSegmentCount) {
            const newSegments = segments.slice(currentSegmentCount);
            renderTranscriptSegments(newSegments);
        }
    }
    
    // Update segment count
    elements.segmentCount.textContent = `${segments.length} segments`;
    
    // Auto-scroll to bottom
    elements.transcriptWindow.scrollTop = elements.transcriptWindow.scrollHeight;
}

function renderTranscriptSegments(segments) {
    segments.forEach(segment => {
        const segmentEl = document.createElement('div');
        segmentEl.className = 'transcript-segment';
        
        const timestamp = document.createElement('div');
        timestamp.className = 'transcript-timestamp';
        timestamp.textContent = `[${segment.start.toFixed(2)}s → ${segment.end.toFixed(2)}s]`;
        
        const text = document.createElement('div');
        text.className = 'transcript-text';
        text.textContent = segment.text;
        
        segmentEl.appendChild(timestamp);
        segmentEl.appendChild(text);
        
        elements.transcriptWindow.appendChild(segmentEl);
    });
}

// ==================== Download Management ====================

function showDownloadSection() {
    elements.downloadSection.style.display = 'block';
}

async function downloadTranscript(format) {
    try {
        if (!appState.sessionId) {
            showError('No transcription session found');
            return;
        }
        
        const response = await fetch(`/api/download/${appState.sessionId}/${format}`);
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Download failed');
        }
        
        // Get filename from response headers
        const contentDisposition = response.headers.get('content-disposition');
        let filename = `transcript.${format}`;
        
        if (contentDisposition) {
            const match = contentDisposition.match(/filename="(.+)"/);
            if (match) filename = match[1];
        }
        
        // Create blob and download
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
    } catch (error) {
        console.error('Download error:', error);
        showError(error.message);
    }
}

// ==================== UI Helpers ====================

function updateStatus(status, progress, message) {
    elements.progressFill.style.width = `${progress}%`;
    elements.progressPercent.textContent = `${progress}%`;
    elements.statusBadge.textContent = capitalizeFirst(status);
    elements.statusMessage.textContent = message;
}

function showError(message) {
    elements.errorSection.style.display = 'block';
    elements.errorMessage.textContent = message;
    
    // Hide other sections
    elements.progressSection.style.display = 'none';
    elements.downloadSection.style.display = 'none';
    
    // Stop transcription if in progress
    if (appState.statusCheckInterval) {
        clearInterval(appState.statusCheckInterval);
        appState.isTranscribing = false;
    }
}

function resetUpload() {
    // Clear state
    appState.sessionId = null;
    appState.isTranscribing = false;
    appState.currentFile = null;
    appState.transcript = [];
    
    // Clear intervals
    if (appState.statusCheckInterval) {
        clearInterval(appState.statusCheckInterval);
    }
    
    // Reset UI
    elements.dropZone.style.display = 'flex';
    elements.fileInfo.style.display = 'none';
    elements.progressSection.style.display = 'none';
    elements.transcriptSection.style.display = 'none';
    elements.downloadSection.style.display = 'none';
    elements.errorSection.style.display = 'none';
    elements.fileInput.value = '';
    elements.dropZone.classList.remove('drag-over');
    
    // Reset transcript window
    elements.transcriptWindow.innerHTML = `
        <div class="transcript-empty">
            <span class="empty-icon">📝</span>
            <p>Waiting for transcription to start...</p>
        </div>
    `;
    elements.segmentCount.textContent = '0 segments';
}

function checkModelStatus() {
    fetch('/api/health')
        .then(response => response.json())
        .then(data => {
            if (data.model_loaded) {
                elements.statusText.textContent = 'Ready';
                document.querySelector('.status-dot').style.backgroundColor = '#10b981';
            } else {
                elements.statusText.textContent = 'Loading...';
                document.querySelector('.status-dot').style.backgroundColor = '#f59e0b';
            }
        })
        .catch(error => {
            console.error('Health check error:', error);
            elements.statusText.textContent = 'Error';
            document.querySelector('.status-dot').style.backgroundColor = '#ef4444';
        });
}

// ==================== Utility Functions ====================

function formatTime(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hrs > 0) {
        return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${mins}:${String(secs).padStart(2, '0')}`;
}

function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// ==================== Event Listeners for UI Updates ====================

// Prevent default drag behavior on the entire document
document.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
});

document.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
});

// Refresh model status periodically
setInterval(checkModelStatus, 30000);
