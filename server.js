/**
 * YTGrab - YouTube Video & Shorts Downloader
 * Express Server - Video Info + Redirect to Download Services
 * Enhanced with Advanced Security Features & Spam Protection
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// Spam Protection System
// ============================================

const clickTracker = new Map();
const blockedIPs = new Map();

const SPAM_CONFIG = {
    maxClicks: 15,
    timeWindow: 60 * 1000,
    blockDuration: 60 * 60 * 1000,
    cleanupInterval: 5 * 60 * 1000
};

function cleanupTracker() {
    const now = Date.now();
    for (const [ip, data] of clickTracker.entries()) {
        if (now - data.firstClick > SPAM_CONFIG.timeWindow) clickTracker.delete(ip);
    }
    for (const [ip, unblockTime] of blockedIPs.entries()) {
        if (now >= unblockTime) blockedIPs.delete(ip);
    }
}
setInterval(cleanupTracker, SPAM_CONFIG.cleanupInterval);

function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.headers['x-real-ip']
        || req.connection?.remoteAddress
        || req.ip || 'unknown';
}

function spamProtection(req, res, next) {
    const ip = getClientIP(req);
    const now = Date.now();

    if (blockedIPs.has(ip)) {
        const unblockTime = blockedIPs.get(ip);
        if (now < unblockTime) {
            return res.status(429).json({
                success: false,
                error: `Blocked. Try again in ${Math.ceil((unblockTime - now) / 60000)} minutes.`,
                remainingMinutes: Math.ceil((unblockTime - now) / 60000)
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
                blockedIPs.set(ip, now + SPAM_CONFIG.blockDuration);
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
// Middleware
// ============================================

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests.' },
    skip: (req) => !req.path.startsWith('/api/')
});

app.set('trust proxy', 1);
app.use(cors({ origin: true }));
app.use(express.json({ limit: '100kb' }));
app.use('/api/', apiLimiter);
app.use('/api/', spamProtection);
app.use(express.static(path.join(__dirname)));

// ============================================
// Utilities
// ============================================

function isValidYouTubeUrl(url) {
    if (!url || typeof url !== 'string' || url.length > 200) return false;
    return /^(https?:\/\/)?(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]{11}/.test(url);
}

function extractVideoId(url) {
    const match = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{11})/);
    return match ? match[1] : null;
}

// ============================================
// YouTube oEmbed API for video info (FREE, no auth)
// ============================================

async function getVideoInfo(url) {
    const videoId = extractVideoId(url);
    if (!videoId) throw new Error('Invalid YouTube URL');

    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const response = await fetch(oembedUrl);

    if (!response.ok) {
        throw new Error('Video not found or is private');
    }

    const data = await response.json();

    return {
        videoId,
        title: data.title || 'Unknown Title',
        channel: data.author_name || 'Unknown Channel',
        channelUrl: data.author_url || '',
        thumbnail: data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
        thumbnailHQ: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
        duration: 0,
        views: 0,
        likes: 0,
        isShort: url.includes('/shorts/')
    };
}

// ============================================
// API Routes
// ============================================

/**
 * GET /api/info - Fetch video info using YouTube oEmbed
 */
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
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/download-url - Get redirect URL to download service
 */
app.get('/api/download-url', async (req, res) => {
    try {
        const { url, quality = 'highest', format = 'mp4' } = req.query;

        if (!url || !isValidYouTubeUrl(url)) {
            return res.status(400).json({ success: false, error: 'Invalid YouTube URL' });
        }

        const videoId = extractVideoId(url);
        console.log(`⚡ Download URL: ${videoId} | ${quality} | ${format}`);

        // Generate download URLs using various services
        const downloadServices = [
            {
                name: 'Y2Mate',
                url: `https://www.y2mate.com/youtube/${videoId}`
            },
            {
                name: 'SaveFrom',
                url: `https://en.savefrom.net/1-youtube-video-downloader-4/?url=https://www.youtube.com/watch?v=${videoId}`
            },
            {
                name: 'SSYouTube',
                url: `https://ssyoutube.com/watch?v=${videoId}`
            }
        ];

        res.json({
            success: true,
            videoId,
            downloadServices,
            message: 'Click on any service below to download the video'
        });

    } catch (error) {
        console.error('Download URL error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/status - Check user status
 */
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

/**
 * GET /api/health - Health check
 */
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        uptime: process.uptime()
    });
});

// Admin routes
const stats = { totalRequests: 0, totalDownloads: 0, serverStartTime: Date.now() };

app.get('/api/admin/stats', (req, res) => {
    res.json({ success: true, stats: { ...stats, blockedIPs: blockedIPs.size } });
});

app.get('/api/admin/blocked', (req, res) => {
    const blocked = [];
    for (const [ip, time] of blockedIPs.entries()) {
        blocked.push({ ip, remainingMinutes: Math.ceil((time - Date.now()) / 60000) });
    }
    res.json({ success: true, blocked });
});

app.post('/api/admin/clear-blocks', (req, res) => {
    blockedIPs.clear();
    res.json({ success: true, message: 'All blocks cleared' });
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
    console.log(`║     Server running at http://localhost:${PORT}     ║`);
    console.log('╚════════════════════════════════════════════════╝');
});

process.on('uncaughtException', (err) => console.error('Error:', err));
process.on('unhandledRejection', (err) => console.error('Error:', err));

module.exports = app;
