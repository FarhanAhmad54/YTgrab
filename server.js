/**
 * YTGrab - YouTube Video & Shorts Downloader
 * Express Server using Cobalt API (Reliable, no sign-in required!)
 * Enhanced with Advanced Security Features & Spam Protection
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Cobalt API endpoint (public instance)
const COBALT_API = 'https://api.cobalt.tools';

// ============================================
// Advanced Spam Protection System
// ============================================

// Store for tracking IP clicks and blocked IPs
const clickTracker = new Map();  // IP -> { clicks: number, firstClick: timestamp }
const blockedIPs = new Map();    // IP -> unblockTime

// Configuration
const SPAM_CONFIG = {
    maxClicks: 10,              // Maximum clicks allowed
    timeWindow: 60 * 1000,      // Time window in ms (1 minute)
    blockDuration: 60 * 60 * 1000, // Block duration (1 hour)
    cleanupInterval: 5 * 60 * 1000  // Cleanup old entries every 5 minutes
};

// Cleanup old tracking entries
function cleanupTracker() {
    const now = Date.now();

    // Clean click tracker
    for (const [ip, data] of clickTracker.entries()) {
        if (now - data.firstClick > SPAM_CONFIG.timeWindow) {
            clickTracker.delete(ip);
        }
    }

    // Clean expired blocks
    for (const [ip, unblockTime] of blockedIPs.entries()) {
        if (now >= unblockTime) {
            blockedIPs.delete(ip);
            console.log(`✅ Unblocked IP: ${ip.substring(0, 20)}...`);
        }
    }
}
setInterval(cleanupTracker, SPAM_CONFIG.cleanupInterval);

// Get client IP
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.headers['x-real-ip']
        || req.connection?.remoteAddress
        || req.ip
        || 'unknown';
}

// Spam protection middleware
function spamProtection(req, res, next) {
    const ip = getClientIP(req);
    const now = Date.now();

    // Check if IP is blocked
    if (blockedIPs.has(ip)) {
        const unblockTime = blockedIPs.get(ip);
        if (now < unblockTime) {
            const remainingMinutes = Math.ceil((unblockTime - now) / 60000);
            console.log(`🚫 Blocked IP attempted access: ${ip.substring(0, 20)}...`);
            return res.status(429).json({
                success: false,
                error: `You have been temporarily blocked due to suspicious activity. Please try again in ${remainingMinutes} minutes.`,
                blockedUntil: new Date(unblockTime).toISOString(),
                remainingMinutes
            });
        } else {
            blockedIPs.delete(ip);
        }
    }

    // Track clicks
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

                console.log(`⛔ BLOCKED IP for spam: ${ip.substring(0, 20)}...`);

                return res.status(429).json({
                    success: false,
                    error: 'Too many requests! You have been blocked for 1 hour due to suspicious activity.',
                    blockedUntil: new Date(unblockTime).toISOString(),
                    remainingMinutes: 60
                });
            }
        }
    }

    next();
}

// ============================================
// Security Configuration
// ============================================

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many requests. Please wait a moment and try again.'
    },
    skip: (req) => req.path === '/' || req.path.endsWith('.css') || req.path.endsWith('.js') || req.path.endsWith('.html')
});

const downloadLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: {
        success: false,
        error: 'Download limit reached. Please wait before downloading more videos.'
    }
});

const infoLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    message: {
        success: false,
        error: 'Too many video info requests. Please slow down.'
    }
});

// ============================================
// Middleware
// ============================================

app.set('trust proxy', 1);

app.use(cors({
    origin: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ limit: '100kb', extended: true }));

app.use('/api/', apiLimiter);
app.use('/api/info', infoLimiter);
app.use('/api/download', downloadLimiter);
app.use('/api/', spamProtection);

app.use(express.static(path.join(__dirname)));

app.use((req, res, next) => {
    const sanitizedUrl = req.url.substring(0, 200);
    const ip = getClientIP(req).substring(0, 20);
    console.log(`[${new Date().toISOString()}] ${req.method} ${sanitizedUrl} (IP: ${ip}...)`);
    next();
});

// ============================================
// Utilities
// ============================================

function isValidYouTubeUrl(url) {
    if (!url || typeof url !== 'string' || url.length > 200) {
        return false;
    }

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
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

function sanitizeFilename(filename) {
    return filename
        .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
        .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
        .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
        .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
        .replace(/[\u{2600}-\u{26FF}]/gu, '')
        .replace(/[\u{2700}-\u{27BF}]/gu, '')
        .replace(/[<>:"/\\|?*#@]/g, '')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .substring(0, 60) || 'video';
}

// ============================================
// YouTube oEmbed API for video info (no auth needed)
// ============================================

async function getVideoInfo(url) {
    const videoId = extractVideoId(url);
    if (!videoId) {
        throw new Error('Invalid YouTube URL');
    }

    // Use YouTube's oEmbed API (public, no auth required)
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

    const response = await fetch(oembedUrl);
    if (!response.ok) {
        throw new Error('Failed to fetch video info');
    }

    const data = await response.json();

    return {
        videoId,
        title: data.title || 'Unknown Title',
        channel: data.author_name || 'Unknown Channel',
        channelUrl: data.author_url || '',
        thumbnail: data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
        duration: 0, // oEmbed doesn't provide duration
        views: 0,
        likes: 0,
        description: '',
        isShort: url.includes('/shorts/')
    };
}

// ============================================
// Cobalt API Functions
// ============================================

async function getCobaltDownloadUrl(url, quality = 'highest', isAudio = false) {
    const requestBody = {
        url: url,
        downloadMode: isAudio ? 'audio' : 'auto',
        audioFormat: isAudio ? 'mp3' : 'best',
        videoQuality: quality === 'highest' ? 'max' : quality.replace('p', ''),
        filenameStyle: 'basic'
    };

    console.log(`📡 Cobalt API request:`, JSON.stringify(requestBody));

    const response = await fetch(`${COBALT_API}/`, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    console.log(`📡 Cobalt API response:`, JSON.stringify(data));

    if (data.status === 'error') {
        throw new Error(data.error?.code || data.text || 'Download failed');
    }

    if (data.status === 'redirect' || data.status === 'tunnel') {
        return {
            url: data.url,
            filename: data.filename || 'video.mp4'
        };
    }

    if (data.status === 'picker') {
        // Multiple options available, pick the first one
        const firstOption = data.picker?.[0] || data.audio;
        if (firstOption?.url) {
            return {
                url: firstOption.url,
                filename: 'video.mp4'
            };
        }
    }

    throw new Error('No download URL received');
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
            return res.status(400).json({
                success: false,
                error: 'Invalid YouTube URL'
            });
        }

        console.log(`⚡ Info: ${url}`);

        const info = await getVideoInfo(url);

        res.json({
            success: true,
            ...info
        });

    } catch (error) {
        console.error('Info error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch video info'
        });
    }
});

/**
 * GET /api/download - Get download URL using Cobalt API
 */
app.get('/api/download', async (req, res) => {
    try {
        const { url, quality = 'highest', format = 'mp4' } = req.query;

        if (!url || !isValidYouTubeUrl(url)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid YouTube URL'
            });
        }

        console.log(`⚡ DOWNLOAD: ${url} | ${quality} | ${format}`);

        const isAudio = format === 'mp3';

        // Get download URL from Cobalt API
        const downloadInfo = await getCobaltDownloadUrl(url, quality, isAudio);

        console.log(`📥 Got download URL: ${downloadInfo.url.substring(0, 50)}...`);

        // Fetch the video from Cobalt's URL and stream to client
        const videoResponse = await fetch(downloadInfo.url);

        if (!videoResponse.ok) {
            throw new Error('Failed to download from source');
        }

        // Get video info for filename
        const videoId = extractVideoId(url);
        let filename = downloadInfo.filename || `video_${videoId}.${format}`;

        try {
            const info = await getVideoInfo(url);
            filename = `${sanitizeFilename(info.title)}.${format}`;
        } catch (e) {
            // Use default filename if info fails
        }

        // Set headers
        const contentType = isAudio ? 'audio/mpeg' : 'video/mp4';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

        const contentLength = videoResponse.headers.get('content-length');
        if (contentLength) {
            res.setHeader('Content-Length', contentLength);
        }

        // Stream the response
        const reader = videoResponse.body.getReader();

        const stream = new ReadableStream({
            async start(controller) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    controller.enqueue(value);
                }
                controller.close();
            }
        });

        // Convert to Node stream and pipe
        const nodeStream = require('stream');
        const readable = nodeStream.Readable.fromWeb(stream);
        readable.pipe(res);

    } catch (error) {
        console.error('Download error:', error.message);

        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: error.message || 'Download failed'
            });
        }
    }
});

/**
 * GET /api/status - Get rate limit status for current IP
 */
app.get('/api/status', (req, res) => {
    const ip = getClientIP(req);
    const isBlocked = blockedIPs.has(ip);
    const clickData = clickTracker.get(ip);

    res.json({
        success: true,
        ip: ip.substring(0, 10) + '***',
        isBlocked,
        blockedUntil: isBlocked ? new Date(blockedIPs.get(ip)).toISOString() : null,
        clicksInWindow: clickData?.clicks || 0,
        maxClicks: SPAM_CONFIG.maxClicks
    });
});

/**
 * Health check
 */
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        mode: 'cobalt-api',
        uptime: process.uptime(),
        blockedIPs: blockedIPs.size,
        trackedSessions: clickTracker.size
    });
});

// ============================================
// Admin API Routes
// ============================================

const activityLog = [];
const MAX_ACTIVITY_LOG = 100;

const stats = {
    totalRequests: 0,
    totalDownloads: 0,
    totalInfoRequests: 0,
    serverStartTime: Date.now()
};

function logActivity(type, message, ip = null) {
    activityLog.unshift({
        type,
        message,
        ip: ip ? ip.substring(0, 15) + '***' : null,
        timestamp: new Date().toISOString()
    });

    if (activityLog.length > MAX_ACTIVITY_LOG) {
        activityLog.pop();
    }
}

app.use('/api/info', (req, res, next) => {
    stats.totalRequests++;
    stats.totalInfoRequests++;
    logActivity('info', `Video info requested`, getClientIP(req));
    next();
});

app.use('/api/download', (req, res, next) => {
    stats.totalRequests++;
    stats.totalDownloads++;
    logActivity('download', `Download started`, getClientIP(req));
    next();
});

app.get('/api/admin/stats', (req, res) => {
    try {
        const memUsage = process.memoryUsage();
        res.json({
            success: true,
            stats: {
                uptime: process.uptime(),
                totalRequests: stats.totalRequests,
                totalDownloads: stats.totalDownloads,
                totalInfoRequests: stats.totalInfoRequests,
                blockedIPs: blockedIPs.size,
                activeSessions: clickTracker.size,
                memoryUsage: memUsage.heapUsed,
                serverStartTime: new Date(stats.serverStartTime).toISOString()
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/admin/blocked', (req, res) => {
    try {
        const blocked = [];
        const now = Date.now();

        for (const [ip, unblockTime] of blockedIPs.entries()) {
            blocked.push({
                ip,
                unblockTime: new Date(unblockTime).toISOString(),
                remainingMinutes: Math.ceil((unblockTime - now) / 60000)
            });
        }

        blocked.sort((a, b) => new Date(a.unblockTime) - new Date(b.unblockTime));
        res.json({ success: true, blocked });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/unblock', (req, res) => {
    try {
        const { ip } = req.body;

        if (!ip) {
            return res.status(400).json({ success: false, error: 'IP address required' });
        }

        if (blockedIPs.has(ip)) {
            blockedIPs.delete(ip);
            logActivity('unblock', `IP manually unblocked: ${ip.substring(0, 15)}***`);
            res.json({ success: true, message: 'IP unblocked successfully' });
        } else {
            res.status(404).json({ success: false, error: 'IP not found in blocked list' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/admin/sessions', (req, res) => {
    try {
        const sessions = [];

        for (const [ip, data] of clickTracker.entries()) {
            sessions.push({
                ip,
                clicks: data.clicks,
                firstClick: new Date(data.firstClick).toISOString(),
                timeInWindow: Math.round((Date.now() - data.firstClick) / 1000)
            });
        }

        sessions.sort((a, b) => b.clicks - a.clicks);
        res.json({ success: true, sessions });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/admin/activity', (req, res) => {
    try {
        res.json({ success: true, activity: activityLog.slice(0, 50) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/block', (req, res) => {
    try {
        const { ip, duration = 60 } = req.body;

        if (!ip) {
            return res.status(400).json({ success: false, error: 'IP address required' });
        }

        const unblockTime = Date.now() + (duration * 60 * 1000);
        blockedIPs.set(ip, unblockTime);
        logActivity('block', `IP manually blocked for ${duration} min: ${ip.substring(0, 15)}***`);

        res.json({
            success: true,
            message: `IP blocked for ${duration} minutes`,
            unblockTime: new Date(unblockTime).toISOString()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/clear-blocks', (req, res) => {
    try {
        const count = blockedIPs.size;
        blockedIPs.clear();
        logActivity('unblock', `All ${count} blocked IPs cleared by admin`);
        res.json({ success: true, message: `Cleared ${count} blocked IPs` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Fallback routes
app.use('/api/*', (req, res) => {
    res.status(404).json({ success: false, error: 'Not found' });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================
// Server
// ============================================

app.listen(PORT, () => {
    console.log('╔════════════════════════════════════════════════╗');
    console.log('║                                                ║');
    console.log('║     🎬 YTGrab - YouTube Video Downloader       ║');
    console.log('║        ⚡ Using Cobalt API                      ║');
    console.log('║        🛡️  Advanced Spam Protection Active      ║');
    console.log(`║     Server running at http://localhost:${PORT}     ║`);
    console.log('║                                                ║');
    console.log('╚════════════════════════════════════════════════╝');
    console.log('');
    console.log('✨ Reliable downloads - No sign-in required!');
    console.log('🔒 Spam protection active');
    console.log('');
});

process.on('SIGINT', () => {
    console.log('\nShutting down...');
    process.exit(0);
});

process.on('uncaughtException', (err) => console.error('Uncaught:', err));
process.on('unhandledRejection', (err) => console.error('Rejection:', err));

module.exports = app;
