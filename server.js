/**
 * YTGrab - YouTube Video & Shorts Downloader
 * Express Server using Public Cobalt Instances (No auth required!)
 * Enhanced with Advanced Security Features & Spam Protection
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Public Cobalt API instances (no auth required)
// Source: https://instances.cobalt.best
const COBALT_INSTANCES = [
    'https://cobalt-backend.canine.tools',
    'https://cobalt-api.meowing.de',
    'https://capi.3kh0.net'
];

// ============================================
// Advanced Spam Protection System
// ============================================

const clickTracker = new Map();
const blockedIPs = new Map();

const SPAM_CONFIG = {
    maxClicks: 10,
    timeWindow: 60 * 1000,
    blockDuration: 60 * 60 * 1000,
    cleanupInterval: 5 * 60 * 1000
};

function cleanupTracker() {
    const now = Date.now();
    for (const [ip, data] of clickTracker.entries()) {
        if (now - data.firstClick > SPAM_CONFIG.timeWindow) {
            clickTracker.delete(ip);
        }
    }
    for (const [ip, unblockTime] of blockedIPs.entries()) {
        if (now >= unblockTime) {
            blockedIPs.delete(ip);
            console.log(`✅ Unblocked IP: ${ip.substring(0, 20)}...`);
        }
    }
}
setInterval(cleanupTracker, SPAM_CONFIG.cleanupInterval);

function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.headers['x-real-ip']
        || req.connection?.remoteAddress
        || req.ip
        || 'unknown';
}

function spamProtection(req, res, next) {
    const ip = getClientIP(req);
    const now = Date.now();

    if (blockedIPs.has(ip)) {
        const unblockTime = blockedIPs.get(ip);
        if (now < unblockTime) {
            const remainingMinutes = Math.ceil((unblockTime - now) / 60000);
            return res.status(429).json({
                success: false,
                error: `You have been temporarily blocked. Please try again in ${remainingMinutes} minutes.`,
                remainingMinutes
            });
        }
        blockedIPs.delete(ip);
    }

    if (!clickTracker.has(ip)) {
        clickTracker.set(ip, { clicks: 1, firstClick: now });
    } else {
        const data = clickTracker.get(ip);
        if (now - data.firstClick > SPAM_CONFIG.timeWindow) {
            clickTracker.set(ip, { clicks: 1, firstClick: now });
        } else {
            data.clicks++;
            if (data.clicks > SPAM_CONFIG.maxClicks) {
                const unblockTime = now + SPAM_CONFIG.blockDuration;
                blockedIPs.set(ip, unblockTime);
                clickTracker.delete(ip);
                return res.status(429).json({
                    success: false,
                    error: 'Too many requests! Blocked for 1 hour.',
                    remainingMinutes: 60
                });
            }
        }
    }
    next();
}

// ============================================
// Security & Middleware
// ============================================

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests. Please wait.' },
    skip: (req) => req.path === '/' || req.path.endsWith('.css') || req.path.endsWith('.js')
});

const downloadLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { success: false, error: 'Download limit reached. Please wait.' }
});

app.set('trust proxy', 1);
app.use(cors({ origin: true, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ limit: '100kb', extended: true }));
app.use('/api/', apiLimiter);
app.use('/api/download', downloadLimiter);
app.use('/api/', spamProtection);
app.use(express.static(path.join(__dirname)));

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url.substring(0, 100)}`);
    next();
});

// ============================================
// Utilities
// ============================================

function isValidYouTubeUrl(url) {
    if (!url || typeof url !== 'string' || url.length > 200) return false;
    const patterns = [
        /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=[\w-]{11}/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/shorts\/[\w-]{11}/,
        /^(https?:\/\/)?(www\.)?youtu\.be\/[\w-]{11}/,
        /^(https?:\/\/)?(m\.)?youtube\.com\/watch\?v=[\w-]{11}/
    ];
    return patterns.some(pattern => pattern.test(url));
}

function extractVideoId(url) {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/);
    return match ? match[1] : null;
}

function sanitizeFilename(filename) {
    return filename
        .replace(/[\u{1F600}-\u{1F9FF}]/gu, '')
        .replace(/[\u{2600}-\u{27BF}]/gu, '')
        .replace(/[<>:"/\\|?*#@]/g, '')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .substring(0, 60) || 'video';
}

// ============================================
// YouTube oEmbed API for video info
// ============================================

async function getVideoInfo(url) {
    const videoId = extractVideoId(url);
    if (!videoId) throw new Error('Invalid YouTube URL');

    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const response = await fetch(oembedUrl);
    if (!response.ok) throw new Error('Failed to fetch video info');

    const data = await response.json();
    return {
        videoId,
        title: data.title || 'Unknown Title',
        channel: data.author_name || 'Unknown Channel',
        channelUrl: data.author_url || '',
        thumbnail: data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
        duration: 0,
        views: 0,
        likes: 0,
        description: '',
        isShort: url.includes('/shorts/')
    };
}

// ============================================
// Cobalt API - Try multiple instances
// ============================================

async function getCobaltDownloadUrl(url, quality = 'highest', isAudio = false) {
    const requestBody = {
        url: url,
        downloadMode: isAudio ? 'audio' : 'auto',
        audioFormat: isAudio ? 'mp3' : 'best',
        videoQuality: quality === 'highest' ? 'max' : quality.replace('p', ''),
        filenameStyle: 'basic'
    };

    let lastError = null;

    // Try each instance until one works
    for (const instance of COBALT_INSTANCES) {
        try {
            console.log(`📡 Trying Cobalt instance: ${instance}`);

            const response = await fetch(instance, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            const data = await response.json();
            console.log(`📡 Response from ${instance}:`, JSON.stringify(data).substring(0, 200));

            if (data.status === 'error') {
                lastError = data.error?.code || data.text || 'Unknown error';
                continue;
            }

            if (data.status === 'redirect' || data.status === 'tunnel' || data.status === 'stream') {
                return { url: data.url, filename: data.filename || 'video.mp4' };
            }

            if (data.status === 'picker' && data.picker?.[0]?.url) {
                return { url: data.picker[0].url, filename: 'video.mp4' };
            }

            // If we got a URL directly
            if (data.url) {
                return { url: data.url, filename: data.filename || 'video.mp4' };
            }

            lastError = 'No download URL in response';
        } catch (err) {
            console.error(`❌ Instance ${instance} failed:`, err.message);
            lastError = err.message;
        }
    }

    throw new Error(lastError || 'All Cobalt instances failed');
}

// ============================================
// API Routes
// ============================================

app.get('/api/info', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url || !isValidYouTubeUrl(url)) {
            return res.status(400).json({ success: false, error: 'Invalid YouTube URL' });
        }
        console.log(`⚡ Info: ${url}`);
        const info = await getVideoInfo(url);
        res.json({ success: true, ...info });
    } catch (error) {
        console.error('Info error:', error.message);
        res.status(500).json({ success: false, error: error.message || 'Failed to fetch video info' });
    }
});

app.get('/api/download', async (req, res) => {
    try {
        const { url, quality = 'highest', format = 'mp4' } = req.query;
        if (!url || !isValidYouTubeUrl(url)) {
            return res.status(400).json({ success: false, error: 'Invalid YouTube URL' });
        }

        console.log(`⚡ DOWNLOAD: ${url} | ${quality} | ${format}`);
        const isAudio = format === 'mp3';

        // Get download URL from Cobalt
        const downloadInfo = await getCobaltDownloadUrl(url, quality, isAudio);
        console.log(`📥 Got URL: ${downloadInfo.url.substring(0, 80)}...`);

        // Get video info for filename
        let filename = `video_${Date.now()}.${format}`;
        try {
            const info = await getVideoInfo(url);
            filename = `${sanitizeFilename(info.title)}.${format}`;
        } catch (e) { }

        // Fetch and stream the video
        const videoResponse = await fetch(downloadInfo.url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (!videoResponse.ok) {
            throw new Error(`Failed to download: ${videoResponse.status}`);
        }

        const contentType = isAudio ? 'audio/mpeg' : 'video/mp4';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

        const contentLength = videoResponse.headers.get('content-length');
        if (contentLength) {
            res.setHeader('Content-Length', contentLength);
        }

        // Stream the response
        const stream = require('stream');
        const readable = stream.Readable.fromWeb(videoResponse.body);
        readable.pipe(res);

    } catch (error) {
        console.error('Download error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: error.message || 'Download failed' });
        }
    }
});

app.get('/api/status', (req, res) => {
    const ip = getClientIP(req);
    const clickData = clickTracker.get(ip);
    res.json({
        success: true,
        isBlocked: blockedIPs.has(ip),
        clicksInWindow: clickData?.clicks || 0,
        maxClicks: SPAM_CONFIG.maxClicks
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        mode: 'cobalt-public-instances',
        uptime: process.uptime(),
        instances: COBALT_INSTANCES.length
    });
});

// ============================================
// Admin Routes (simplified)
// ============================================

const stats = { totalRequests: 0, totalDownloads: 0, totalInfoRequests: 0, serverStartTime: Date.now() };

app.use('/api/info', (req, res, next) => { stats.totalRequests++; stats.totalInfoRequests++; next(); });
app.use('/api/download', (req, res, next) => { stats.totalRequests++; stats.totalDownloads++; next(); });

app.get('/api/admin/stats', (req, res) => {
    res.json({
        success: true,
        stats: {
            uptime: process.uptime(),
            ...stats,
            blockedIPs: blockedIPs.size,
            activeSessions: clickTracker.size
        }
    });
});

app.get('/api/admin/blocked', (req, res) => {
    const blocked = [];
    for (const [ip, unblockTime] of blockedIPs.entries()) {
        blocked.push({ ip, remainingMinutes: Math.ceil((unblockTime - Date.now()) / 60000) });
    }
    res.json({ success: true, blocked });
});

app.post('/api/admin/unblock', (req, res) => {
    const { ip } = req.body;
    if (blockedIPs.has(ip)) {
        blockedIPs.delete(ip);
        res.json({ success: true, message: 'IP unblocked' });
    } else {
        res.status(404).json({ success: false, error: 'IP not found' });
    }
});

app.post('/api/admin/clear-blocks', (req, res) => {
    const count = blockedIPs.size;
    blockedIPs.clear();
    res.json({ success: true, message: `Cleared ${count} blocked IPs` });
});

// Fallback routes
app.use('/api/*', (req, res) => res.status(404).json({ success: false, error: 'Not found' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ============================================
// Server
// ============================================

app.listen(PORT, () => {
    console.log('╔════════════════════════════════════════════════╗');
    console.log('║     🎬 YTGrab - YouTube Video Downloader       ║');
    console.log('║        ⚡ Using Public Cobalt Instances         ║');
    console.log(`║     Server running at http://localhost:${PORT}     ║`);
    console.log('╚════════════════════════════════════════════════╝');
    console.log('');
    console.log('📡 Cobalt instances:', COBALT_INSTANCES.join(', '));
    console.log('');
});

process.on('SIGINT', () => { console.log('\nShutting down...'); process.exit(0); });
process.on('uncaughtException', (err) => console.error('Uncaught:', err));
process.on('unhandledRejection', (err) => console.error('Rejection:', err));

module.exports = app;
