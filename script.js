/* ============================================
   YTGrab - YouTube Video Downloader
   Client-Side JavaScript
   ============================================ */

// DOM Elements
const urlInput = document.getElementById('urlInput');
const pasteBtn = document.getElementById('pasteBtn');
const fetchBtn = document.getElementById('fetchBtn');
const videoPreview = document.getElementById('videoPreview');
const videoThumbnail = document.getElementById('videoThumbnail');
const videoTitle = document.getElementById('videoTitle');
const videoChannel = document.getElementById('videoChannel');
const videoDuration = document.getElementById('videoDuration');
const videoViews = document.getElementById('videoViews');
const videoLikes = document.getElementById('videoLikes');
const qualitySelect = document.getElementById('qualitySelect');
const formatSelect = document.getElementById('formatSelect');
const downloadBtn = document.getElementById('downloadBtn');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressPercent = document.getElementById('progressPercent');
const progressStatus = document.getElementById('progressStatus');
const errorContainer = document.getElementById('errorContainer');
const errorMessage = document.getElementById('errorMessage');
const errorDismiss = document.getElementById('errorDismiss');
const successContainer = document.getElementById('successContainer');
const successDismiss = document.getElementById('successDismiss');

// Blocked Modal Elements
const blockedModal = document.getElementById('blockedModal');
const blockedTimeRemaining = document.getElementById('blockedTimeRemaining');
const blockedModalClose = document.getElementById('blockedModalClose');

// API Base URL
const API_BASE = window.location.origin;

// Current video data
let currentVideoInfo = null;

// Blocked status
let isUserBlocked = false;

// ============================================
// Storage Manager - Local Storage with Weekly Cleanup
// ============================================
const StorageManager = {
    KEYS: {
        HISTORY: 'ytgrab_history',
        PREFERENCES: 'ytgrab_prefs',
        LAST_CLEANUP: 'ytgrab_last_cleanup'
    },
    MAX_HISTORY: 20, // Keep last 20 downloads

    // Initialize storage and check for weekly cleanup
    init() {
        this.checkWeeklyCleanup();
        this.loadPreferences();
    },

    // Save download to history
    saveToHistory(videoInfo) {
        try {
            const history = this.getHistory();
            const entry = {
                id: videoInfo.videoId,
                title: videoInfo.title,
                channel: videoInfo.channel,
                thumbnail: videoInfo.thumbnail,
                duration: videoInfo.duration,
                downloadedAt: new Date().toISOString()
            };

            // Remove duplicate if exists
            const filtered = history.filter(h => h.id !== entry.id);

            // Add to beginning and limit size
            filtered.unshift(entry);
            const trimmed = filtered.slice(0, this.MAX_HISTORY);

            localStorage.setItem(this.KEYS.HISTORY, JSON.stringify(trimmed));
            console.log('📦 Saved to history:', entry.title);
        } catch (e) {
            console.warn('Failed to save history:', e);
        }
    },

    // Get download history
    getHistory() {
        try {
            const data = localStorage.getItem(this.KEYS.HISTORY);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            return [];
        }
    },

    // Save user preferences
    savePreferences(prefs) {
        try {
            const current = this.getPreferences();
            const updated = { ...current, ...prefs };
            localStorage.setItem(this.KEYS.PREFERENCES, JSON.stringify(updated));
        } catch (e) {
            console.warn('Failed to save preferences:', e);
        }
    },

    // Get user preferences
    getPreferences() {
        try {
            const data = localStorage.getItem(this.KEYS.PREFERENCES);
            return data ? JSON.parse(data) : {
                quality: 'highest',
                format: 'mp4'
            };
        } catch (e) {
            return { quality: 'highest', format: 'mp4' };
        }
    },

    // Load preferences into UI
    loadPreferences() {
        const prefs = this.getPreferences();
        if (qualitySelect && prefs.quality) {
            qualitySelect.value = prefs.quality;
        }
        if (formatSelect && prefs.format) {
            formatSelect.value = prefs.format;
        }
    },

    // Check if it's time for weekly cleanup (every Saturday)
    checkWeeklyCleanup() {
        try {
            const lastCleanup = localStorage.getItem(this.KEYS.LAST_CLEANUP);
            const now = new Date();
            const dayOfWeek = now.getDay(); // 0 = Sunday, 6 = Saturday

            // Check if it's Saturday (day 6)
            if (dayOfWeek === 6) {
                const today = now.toDateString();

                // Only cleanup once per Saturday
                if (lastCleanup !== today) {
                    this.performWeeklyCleanup();
                    localStorage.setItem(this.KEYS.LAST_CLEANUP, today);
                }
            }
        } catch (e) {
            console.warn('Cleanup check failed:', e);
        }
    },

    // Perform weekly cleanup - clear all stored data
    performWeeklyCleanup() {
        try {
            console.log('🧹 Performing weekly cleanup...');
            localStorage.removeItem(this.KEYS.HISTORY);
            // Keep preferences as they are useful
            console.log('✅ Weekly cleanup complete - history cleared');
        } catch (e) {
            console.warn('Weekly cleanup failed:', e);
        }
    },

    // Manual clear all data
    clearAllData() {
        try {
            localStorage.removeItem(this.KEYS.HISTORY);
            localStorage.removeItem(this.KEYS.PREFERENCES);
            localStorage.removeItem(this.KEYS.LAST_CLEANUP);
            console.log('🗑️ All data cleared');
        } catch (e) {
            console.warn('Failed to clear data:', e);
        }
    },

    // Get storage info
    getStorageInfo() {
        const history = this.getHistory();
        return {
            historyCount: history.length,
            preferences: this.getPreferences(),
            storageUsed: this.calculateStorageSize()
        };
    },

    // Calculate approximate storage size
    calculateStorageSize() {
        try {
            let total = 0;
            for (const key in localStorage) {
                if (key.startsWith('ytgrab_')) {
                    total += localStorage[key].length * 2; // UTF-16 = 2 bytes per char
                }
            }
            return (total / 1024).toFixed(2) + ' KB';
        } catch (e) {
            return '0 KB';
        }
    }
};

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    StorageManager.init();
    initParticles();
    initFAQ();
    initEventListeners();
    checkBlockedStatus(); // Check if user is blocked on page load
});

// ============================================
// Particle Animation Background
// ============================================
function initParticles() {
    const particlesContainer = document.getElementById('particles');
    const particleCount = 30;

    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.left = Math.random() * 100 + '%';
        particle.style.animationDelay = Math.random() * 15 + 's';
        particle.style.animationDuration = (15 + Math.random() * 10) + 's';
        particle.style.width = (2 + Math.random() * 4) + 'px';
        particle.style.height = particle.style.width;

        // Random colors
        const colors = ['#ff0055', '#00d4ff', '#a855f7', '#00ff96'];
        particle.style.background = colors[Math.floor(Math.random() * colors.length)];

        particlesContainer.appendChild(particle);
    }
}

// ============================================
// FAQ Accordion
// ============================================
function initFAQ() {
    const faqItems = document.querySelectorAll('.faq-item');

    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');

        question.addEventListener('click', () => {
            const isActive = item.classList.contains('active');

            // Close all FAQs
            faqItems.forEach(faq => faq.classList.remove('active'));

            // Open clicked one if it wasn't active
            if (!isActive) {
                item.classList.add('active');
            }
        });
    });
}

// ============================================
// Event Listeners
// ============================================
function initEventListeners() {
    // Paste button
    pasteBtn.addEventListener('click', handlePaste);

    // Fetch video info
    fetchBtn.addEventListener('click', handleFetchVideo);

    // URL input enter key
    urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleFetchVideo();
        }
    });

    // Download button
    downloadBtn.addEventListener('click', handleDownload);

    // Save preferences when changed
    qualitySelect.addEventListener('change', () => {
        StorageManager.savePreferences({ quality: qualitySelect.value });
    });
    formatSelect.addEventListener('change', () => {
        StorageManager.savePreferences({ format: formatSelect.value });
    });

    // Error dismiss
    errorDismiss.addEventListener('click', () => {
        hideElement(errorContainer);
        urlInput.value = '';
        urlInput.focus();
    });

    // Success dismiss
    successDismiss.addEventListener('click', () => {
        hideElement(successContainer);
        hideElement(videoPreview);
        hideElement(progressContainer);
        urlInput.value = '';
        currentVideoInfo = null;
        urlInput.focus();
    });

    // Smooth scroll for navigation links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Blocked modal close button
    if (blockedModalClose) {
        blockedModalClose.addEventListener('click', () => {
            hideBlockedModal();
        });
    }

    // Close modal on overlay click
    if (blockedModal) {
        blockedModal.addEventListener('click', (e) => {
            if (e.target === blockedModal) {
                hideBlockedModal();
            }
        });
    }
}

// ============================================
// Clipboard Paste
// ============================================
async function handlePaste() {
    try {
        const text = await navigator.clipboard.readText();
        urlInput.value = text;
        urlInput.focus();

        // Add visual feedback
        pasteBtn.style.color = '#00ff96';
        setTimeout(() => {
            pasteBtn.style.color = '';
        }, 500);
    } catch (err) {
        console.error('Failed to read clipboard:', err);
        showError('Unable to access clipboard. Please paste manually.');
    }
}

// ============================================
// YouTube URL Validation
// ============================================
function isValidYouTubeUrl(url) {
    const patterns = [
        /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=[\w-]{11}/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/shorts\/[\w-]{11}/,
        /^(https?:\/\/)?(www\.)?youtu\.be\/[\w-]{11}/,
        /^(https?:\/\/)?(m\.)?youtube\.com\/watch\?v=[\w-]{11}/
    ];

    return patterns.some(pattern => pattern.test(url));
}

function extractVideoId(url) {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
        /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

// ============================================
// Fetch Video Information
// ============================================
async function handleFetchVideo() {
    const url = urlInput.value.trim();

    // Check if blocked
    if (isUserBlocked) {
        showBlockedModal();
        return;
    }

    // Validation
    if (!url) {
        showError('Please enter a YouTube video URL');
        return;
    }

    if (!isValidYouTubeUrl(url)) {
        showError('Please enter a valid YouTube video or shorts URL');
        return;
    }

    // Hide previous states
    hideElement(videoPreview);
    hideElement(errorContainer);
    hideElement(successContainer);
    hideElement(progressContainer);

    // Show loading state
    fetchBtn.classList.add('loading');
    fetchBtn.disabled = true;

    try {
        const response = await fetch(`${API_BASE}/api/info?url=${encodeURIComponent(url)}`);
        const data = await response.json();

        // Check if blocked (429 status)
        if (response.status === 429) {
            handleBlockedResponse(data);
            return;
        }

        if (!response.ok) {
            throw new Error(data.error || 'Failed to fetch video information');
        }

        // Store video info
        currentVideoInfo = data;

        // Update UI
        displayVideoInfo(data);

    } catch (err) {
        console.error('Fetch error:', err);
        showError(err.message || 'Failed to fetch video information. Please try again.');
    } finally {
        fetchBtn.classList.remove('loading');
        fetchBtn.disabled = false;
    }
}

// ============================================
// Display Video Information
// ============================================
function displayVideoInfo(data) {
    // Set thumbnail
    videoThumbnail.src = data.thumbnail || `https://img.youtube.com/vi/${data.videoId}/maxresdefault.jpg`;
    videoThumbnail.alt = data.title;

    // Set title and channel
    videoTitle.textContent = data.title || 'Unknown Title';
    videoChannel.textContent = data.channel || 'Unknown Channel';

    // Set duration
    videoDuration.textContent = formatDuration(data.duration || 0);

    // Set views and likes
    videoViews.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none"><path d="M1 12S5 4 12 4S23 12 23 12S19 20 12 20S1 12 1 12Z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></svg>
        ${formatNumber(data.views || 0)} views
    `;

    videoLikes.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none"><path d="M14 9V5C14 4.20435 13.6839 3.44129 13.1213 2.87868C12.5587 2.31607 11.7956 2 11 2L7 10V22H18.28C18.7623 22.0055 19.2304 21.8364 19.5979 21.524C19.9654 21.2116 20.2077 20.7769 20.28 20.3L21.66 11.3C21.7035 11.0134 21.6842 10.7207 21.6033 10.4423C21.5225 10.1638 21.3821 9.90629 21.1919 9.68751C21.0016 9.46873 20.7661 9.29393 20.5016 9.17522C20.2371 9.0565 19.9499 8.99672 19.66 9H14Z" stroke="currentColor" stroke-width="2"/><path d="M7 22H4C3.46957 22 2.96086 21.7893 2.58579 21.4142C2.21071 21.0391 2 20.5304 2 20V12C2 11.4696 2.21071 10.9609 2.58579 10.5858C2.96086 10.2107 3.46957 10 4 10H7" stroke="currentColor" stroke-width="2"/></svg>
        ${formatNumber(data.likes || 0)} likes
    `;

    // Populate quality options based on available formats
    populateQualityOptions(data.formats || []);

    // Show the preview
    showElement(videoPreview);
}

// ============================================
// Populate Quality Options
// ============================================
function populateQualityOptions(formats) {
    // Keep default options if no formats available
    if (!formats || formats.length === 0) return;

    // Filter unique quality options
    const qualities = new Set();
    formats.forEach(f => {
        if (f.quality) {
            qualities.add(f.quality);
        }
    });

    // Sort qualities (highest first)
    const sortedQualities = Array.from(qualities).sort((a, b) => {
        const numA = parseInt(a) || 0;
        const numB = parseInt(b) || 0;
        return numB - numA;
    });

    // Update select if we have quality options
    if (sortedQualities.length > 0) {
        qualitySelect.innerHTML = '<option value="highest">Highest Available</option>';
        sortedQualities.forEach(quality => {
            const option = document.createElement('option');
            option.value = quality;
            option.textContent = quality + 'p';
            qualitySelect.appendChild(option);
        });
    }
}

// ============================================
// Handle Download
// ============================================
async function handleDownload() {
    // Check if blocked
    if (isUserBlocked) {
        showBlockedModal();
        return;
    }

    if (!currentVideoInfo) {
        showError('Please fetch video information first');
        return;
    }

    const quality = qualitySelect.value;
    const format = formatSelect.value;
    const url = urlInput.value.trim();

    // Hide other states
    hideElement(errorContainer);
    hideElement(successContainer);

    // Show progress
    showElement(progressContainer);
    updateProgress(0, 'Starting download...');

    // Disable download button
    downloadBtn.disabled = true;
    downloadBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" class="spin">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-dasharray="31.416" stroke-dashoffset="10"/>
        </svg>
        <span>Downloading...</span>
    `;

    try {
        // Create download URL
        const downloadUrl = `${API_BASE}/api/download?url=${encodeURIComponent(url)}&quality=${quality}&format=${format}`;

        // Start download
        const response = await fetch(downloadUrl);

        // Check if blocked (429 status)
        if (response.status === 429) {
            const errorData = await response.json();
            handleBlockedResponse(errorData);
            hideElement(progressContainer);
            return;
        }

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Download failed');
        }

        // Get filename from Content-Disposition header
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = `${currentVideoInfo.title || 'video'}.${format}`;
        if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (filenameMatch && filenameMatch[1]) {
                filename = filenameMatch[1].replace(/['"]/g, '');
            }
        }

        // Simulate progress (since we don't have streaming progress for simple fetch)
        simulateProgress();

        // Get the blob
        const blob = await response.blob();

        // Complete progress
        updateProgress(100, 'Download complete!');

        // Create download link
        const downloadLink = document.createElement('a');
        downloadLink.href = URL.createObjectURL(blob);
        downloadLink.download = sanitizeFilename(filename);
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(downloadLink.href);

        // Save to download history
        StorageManager.saveToHistory(currentVideoInfo);

        // Show success
        setTimeout(() => {
            hideElement(progressContainer);
            showElement(successContainer);
        }, 500);

    } catch (err) {
        console.error('Download error:', err);
        hideElement(progressContainer);
        showError(err.message || 'Download failed. Please try again.');
    } finally {
        // Reset download button
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none">
                <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M7 10L12 15L17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>Download Now</span>
        `;
    }
}

// ============================================
// Progress Simulation
// ============================================
function simulateProgress() {
    let progress = 0;
    const interval = setInterval(() => {
        if (progress >= 90) {
            clearInterval(interval);
            return;
        }
        progress += Math.random() * 15;
        progress = Math.min(progress, 90);
        updateProgress(progress, 'Downloading video...');
    }, 300);
}

function updateProgress(percent, status) {
    progressFill.style.width = percent + '%';
    progressPercent.textContent = Math.round(percent) + '%';
    progressStatus.textContent = status;
}

// ============================================
// Error Handling
// ============================================
function showError(message) {
    errorMessage.textContent = message;
    showElement(errorContainer);
}

// ============================================
// Blocked Modal Functions
// ============================================
function showBlockedModal(remainingMinutes) {
    if (blockedModal && blockedTimeRemaining) {
        blockedTimeRemaining.textContent = remainingMinutes || 60;
        blockedModal.classList.add('show');
        isUserBlocked = true;

        // Store blocked state in localStorage
        const unblockTime = Date.now() + (remainingMinutes * 60 * 1000);
        localStorage.setItem('ytgrab_blocked_until', unblockTime.toString());

        // Disable input and buttons
        if (urlInput) urlInput.disabled = true;
        if (fetchBtn) fetchBtn.disabled = true;
        if (downloadBtn) downloadBtn.disabled = true;
    }
}

function hideBlockedModal() {
    if (blockedModal) {
        blockedModal.classList.remove('show');
    }
}

function checkBlockedStatus() {
    const blockedUntil = localStorage.getItem('ytgrab_blocked_until');
    if (blockedUntil) {
        const unblockTime = parseInt(blockedUntil);
        const now = Date.now();

        if (now < unblockTime) {
            // Still blocked
            const remainingMinutes = Math.ceil((unblockTime - now) / 60000);
            isUserBlocked = true;

            // Disable inputs
            if (urlInput) urlInput.disabled = true;
            if (fetchBtn) fetchBtn.disabled = true;
            if (downloadBtn) downloadBtn.disabled = true;

            // Show modal after a brief delay
            setTimeout(() => showBlockedModal(remainingMinutes), 500);
        } else {
            // Block expired, clear it
            localStorage.removeItem('ytgrab_blocked_until');
            isUserBlocked = false;
        }
    }
}

// Handle 429 (blocked) responses
function handleBlockedResponse(data) {
    const remainingMinutes = data.remainingMinutes || 60;
    showBlockedModal(remainingMinutes);
}

// ============================================
// Utility Functions
// ============================================
function showElement(element) {
    element.classList.add('show');
}

function hideElement(element) {
    element.classList.remove('show');
}

function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function formatNumber(num) {
    if (!num || isNaN(num)) return '0';

    if (num >= 1000000000) {
        return (num / 1000000000).toFixed(1) + 'B';
    }
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

function sanitizeFilename(filename) {
    // Remove or replace invalid characters for filenames
    return filename.replace(/[<>:"/\\|?*]/g, '_').substring(0, 200);
}

// ============================================
// Add spin animation for loading
// ============================================
const style = document.createElement('style');
style.textContent = `
    .spin {
        animation: spin 1s linear infinite;
    }
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
`;
document.head.appendChild(style);
