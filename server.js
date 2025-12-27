/**
 * YTGrab - YouTube Video & Shorts Downloader
 * Express Server using @distube/ytdl-core (No external binaries needed!)
 * Enhanced with Advanced Security Features & Spam Protection
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const ytdl = require('@distube/ytdl-core');

const app = express();
const PORT = process.env.PORT || 3000;

// Temp directory
const TEMP_DIR = path.join(os.tmpdir(), 'ytgrab');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

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
            // Block expired, remove it
            blockedIPs.delete(ip);
        }
    }

    // Track clicks
    if (!clickTracker.has(ip)) {
        clickTracker.set(ip, { clicks: 1, firstClick: now });
    } else {
        const data = clickTracker.get(ip);

        // Reset if outside time window
        if (now - data.firstClick > SPAM_CONFIG.timeWindow) {
            clickTracker.set(ip, { clicks: 1, firstClick: now });
        } else {
            data.clicks++;

            // Check if exceeds limit
            if (data.clicks > SPAM_CONFIG.maxClicks) {
                const unblockTime = now + SPAM_CONFIG.blockDuration;
                blockedIPs.set(ip, unblockTime);
                clickTracker.delete(ip);

                console.log(`⛔ BLOCKED IP for spam: ${ip.substring(0, 20)}... (${data.clicks} clicks in ${Math.round((now - data.firstClick) / 1000)}s)`);

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

// Helmet security headers (XSS protection, content-type sniffing, etc.)
app.use(helmet({
    contentSecurityPolicy: false, // Allow inline scripts for our SPA
    crossOriginEmbedderPolicy: false
}));

// Rate limiting - prevent abuse (30 requests per minute per IP)
const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many requests. Please wait a moment and try again.'
    },
    skip: (req) => req.path === '/' || req.path.endsWith('.css') || req.path.endsWith('.js') || req.path.endsWith('.html')
});

// Download rate limiting - stricter (10 downloads per minute)
const downloadLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 downloads per minute
    message: {
        success: false,
        error: 'Download limit reached. Please wait before downloading more videos.'
    }
});

// Strict limiter for info endpoint (prevents rapid scanning)
const infoLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 15, // 15 info requests per minute
    message: {
        success: false,
        error: 'Too many video info requests. Please slow down.'
    }
});

// ============================================
// Middleware
// ============================================

// Trust proxy (for accurate IP detection behind reverse proxy)
app.set('trust proxy', 1);

// CORS - restrict to same origin in production
app.use(cors({
    origin: process.env.NODE_ENV === 'production'
        ? process.env.ALLOWED_ORIGIN || true
        : '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

// Request size limits (prevent DoS)
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ limit: '100kb', extended: true }));

// Apply rate limiting to API routes
app.use('/api/', apiLimiter);
app.use('/api/info', infoLimiter);
app.use('/api/download', downloadLimiter);

// Apply spam protection to API routes
app.use('/api/', spamProtection);

// Static files
app.use(express.static(path.join(__dirname)));

// Request logging (sanitized)
app.use((req, res, next) => {
    const sanitizedUrl = req.url.substring(0, 200); // Limit log length
    const ip = getClientIP(req).substring(0, 20);
    console.log(`[${new Date().toISOString()}] ${req.method} ${sanitizedUrl} (IP: ${ip}...)`);
    next();
});

// ============================================
// Utilities
// ============================================

function isValidYouTubeUrl(url) {
    // Sanitize input first
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

function sanitizeFilename(filename) {
    return filename
        // Remove emojis and special unicode characters
        .replace(/[\u{1F600}-\u{1F64F}]/gu, '')  // Emoticons
        .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')  // Symbols
        .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')  // Transport
        .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')  // Supplemental
        .replace(/[\u{2600}-\u{26FF}]/gu, '')    // Misc symbols
        .replace(/[\u{2700}-\u{27BF}]/gu, '')    // Dingbats
        // Remove illegal filename characters and hashtags
        .replace(/[<>:"/\\|?*#@]/g, '')
        // Replace multiple spaces/underscores
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        // Remove leading/trailing underscores
        .replace(/^_|_$/g, '')
        // Limit length
        .substring(0, 60) || 'video';
}

// Cleanup old temp files (older than 10 minutes)
function cleanupTempFiles() {
    try {
        const files = fs.readdirSync(TEMP_DIR);
        const now = Date.now();
        files.forEach(file => {
            const filePath = path.join(TEMP_DIR, file);
            try {
                const stat = fs.statSync(filePath);
                if (now - stat.mtimeMs > 600000) {
                    fs.unlinkSync(filePath);
                    console.log(`Cleaned: ${file}`);
                }
            } catch (e) { }
        });
    } catch (e) { }
}
setInterval(cleanupTempFiles, 300000);

// ============================================
// API Routes
// ============================================

/**
 * GET /api/info - Fetch video info using ytdl-core
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

        // Use ytdl-core to get video info
        const info = await ytdl.getInfo(url);
        const videoDetails = info.videoDetails;

        res.json({
            success: true,
            videoId: videoDetails.videoId,
            title: videoDetails.title,
            channel: videoDetails.author?.name || videoDetails.ownerChannelName || 'Unknown',
            channelUrl: videoDetails.author?.channel_url || '',
            duration: parseInt(videoDetails.lengthSeconds) || 0,
            views: parseInt(videoDetails.viewCount) || 0,
            likes: 0, // ytdl-core doesn't provide likes
            thumbnail: videoDetails.thumbnails?.[videoDetails.thumbnails.length - 1]?.url ||
                `https://img.youtube.com/vi/${videoDetails.videoId}/maxresdefault.jpg`,
            description: (videoDetails.description || '').substring(0, 300),
            isShort: (parseInt(videoDetails.lengthSeconds) || 0) <= 60
        });

    } catch (error) {
        console.error('Info error:', error.message);

        // Provide more helpful error messages
        let errorMsg = 'Failed to fetch video info';
        if (error.message.includes('Video unavailable')) {
            errorMsg = 'This video is unavailable or private';
        } else if (error.message.includes('Sign in')) {
            errorMsg = 'This video requires sign-in to view';
        } else if (error.message.includes('age')) {
            errorMsg = 'This video is age-restricted';
        }

        res.status(500).json({
            success: false,
            error: errorMsg
        });
    }
});

/**
 * GET /api/download - Download video using ytdl-core
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

        // Get video info first
        const info = await ytdl.getInfo(url);
        const videoDetails = info.videoDetails;
        const sanitizedTitle = sanitizeFilename(videoDetails.title || 'video');

        // Set content type based on format
        const isAudio = format === 'mp3';
        const contentType = isAudio ? 'audio/mpeg' : 'video/mp4';
        const fileExtension = isAudio ? 'mp3' : 'mp4';
        const filename = `${sanitizedTitle}.${fileExtension}`;

        // Configure download options
        let downloadOptions = {};

        if (isAudio) {
            // Audio only
            downloadOptions = {
                quality: 'highestaudio',
                filter: 'audioonly'
            };
        } else {
            // Video with audio
            if (quality === 'highest') {
                downloadOptions = {
                    quality: 'highest',
                    filter: (format) => format.container === 'mp4' && format.hasAudio && format.hasVideo
                };
            } else {
                const qualityNum = parseInt(quality);
                downloadOptions = {
                    quality: 'highest',
                    filter: (format) => {
                        if (format.container !== 'mp4') return false;
                        if (!format.hasAudio || !format.hasVideo) return false;
                        if (qualityNum && format.height > qualityNum) return false;
                        return true;
                    }
                };
            }
        }

        // Try to find a suitable format, fallback to any available
        let selectedFormat = ytdl.chooseFormat(info.formats, downloadOptions);

        if (!selectedFormat) {
            // Fallback: get any format with video and audio
            selectedFormat = ytdl.chooseFormat(info.formats, {
                quality: 'highest',
                filter: 'audioandvideo'
            });
        }

        if (!selectedFormat && !isAudio) {
            // Second fallback: get highest quality video-only (no audio)
            console.log('⚠️ No combined format found, using video-only');
            selectedFormat = ytdl.chooseFormat(info.formats, {
                quality: 'highestvideo',
                filter: 'videoonly'
            });
        }

        if (!selectedFormat) {
            throw new Error('No suitable format found for download');
        }

        console.log(`📥 Using format: ${selectedFormat.qualityLabel || selectedFormat.quality} (${selectedFormat.container})`);

        // Set response headers
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

        if (selectedFormat.contentLength) {
            res.setHeader('Content-Length', selectedFormat.contentLength);
        }

        // Stream the video
        const stream = ytdl.downloadFromInfo(info, { format: selectedFormat });

        stream.on('error', (err) => {
            console.error('Stream error:', err.message);
            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    error: 'Download failed: ' + err.message
                });
            }
        });

        stream.pipe(res);

    } catch (error) {
        console.error('Download error:', error.message);

        if (!res.headersSent) {
            let errorMsg = 'Download failed';
            if (error.message.includes('Video unavailable')) {
                errorMsg = 'This video is unavailable or private';
            } else if (error.message.includes('Sign in')) {
                errorMsg = 'This video requires sign-in to view';
            } else if (error.message.includes('No suitable format')) {
                errorMsg = 'No downloadable format available for this video';
            }

            res.status(500).json({
                success: false,
                error: errorMsg
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
        mode: 'ytdl-core',
        uptime: process.uptime(),
        blockedIPs: blockedIPs.size,
        trackedSessions: clickTracker.size
    });
});

// ============================================
// Admin API Routes
// ============================================

// Activity log storage (in-memory, last 100 entries)
const activityLog = [];
const MAX_ACTIVITY_LOG = 100;

// Statistics counters
const stats = {
    totalRequests: 0,
    totalDownloads: 0,
    totalInfoRequests: 0,
    serverStartTime: Date.now()
};

// Log activity helper
function logActivity(type, message, ip = null) {
    activityLog.unshift({
        type,
        message,
        ip: ip ? ip.substring(0, 15) + '***' : null,
        timestamp: new Date().toISOString()
    });

    // Keep only last 100 entries
    if (activityLog.length > MAX_ACTIVITY_LOG) {
        activityLog.pop();
    }
}

// Track requests middleware (add after other middleware)
app.use('/api/info', (req, res, next) => {
    stats.totalRequests++;
    stats.totalInfoRequests++;
    const ip = getClientIP(req);
    logActivity('info', `Video info requested`, ip);
    next();
});

app.use('/api/download', (req, res, next) => {
    stats.totalRequests++;
    stats.totalDownloads++;
    const ip = getClientIP(req);
    logActivity('download', `Download started`, ip);
    next();
});

/**
 * GET /api/admin/stats - Get dashboard statistics
 */
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

/**
 * GET /api/admin/blocked - Get list of blocked IPs
 */
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

        // Sort by remaining time
        blocked.sort((a, b) => new Date(a.unblockTime) - new Date(b.unblockTime));

        res.json({ success: true, blocked });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/admin/unblock - Unblock an IP address
 */
app.post('/api/admin/unblock', (req, res) => {
    try {
        const { ip } = req.body;

        if (!ip) {
            return res.status(400).json({ success: false, error: 'IP address required' });
        }

        if (blockedIPs.has(ip)) {
            blockedIPs.delete(ip);
            logActivity('unblock', `IP manually unblocked: ${ip.substring(0, 15)}***`);
            console.log(`✅ Admin manually unblocked IP: ${ip.substring(0, 20)}...`);
            res.json({ success: true, message: 'IP unblocked successfully' });
        } else {
            res.status(404).json({ success: false, error: 'IP not found in blocked list' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/admin/sessions - Get active sessions
 */
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

        // Sort by clicks (highest first)
        sessions.sort((a, b) => b.clicks - a.clicks);

        res.json({ success: true, sessions });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/admin/activity - Get recent activity log
 */
app.get('/api/admin/activity', (req, res) => {
    try {
        res.json({ success: true, activity: activityLog.slice(0, 50) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/admin/block - Manually block an IP
 */
app.post('/api/admin/block', (req, res) => {
    try {
        const { ip, duration = 60 } = req.body; // duration in minutes

        if (!ip) {
            return res.status(400).json({ success: false, error: 'IP address required' });
        }

        const unblockTime = Date.now() + (duration * 60 * 1000);
        blockedIPs.set(ip, unblockTime);
        logActivity('block', `IP manually blocked for ${duration} min: ${ip.substring(0, 15)}***`);
        console.log(`⛔ Admin manually blocked IP: ${ip.substring(0, 20)}... for ${duration} minutes`);

        res.json({
            success: true,
            message: `IP blocked for ${duration} minutes`,
            unblockTime: new Date(unblockTime).toISOString()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/admin/clear-blocks - Clear all blocked IPs
 */
app.post('/api/admin/clear-blocks', (req, res) => {
    try {
        const count = blockedIPs.size;
        blockedIPs.clear();
        logActivity('unblock', `All ${count} blocked IPs cleared by admin`);
        console.log(`✅ Admin cleared all ${count} blocked IPs`);
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
    console.log('║        ⚡ Using @distube/ytdl-core              ║');
    console.log('║        🛡️  Advanced Spam Protection Active      ║');
    console.log(`║     Server running at http://localhost:${PORT}     ║`);
    console.log('║                                                ║');
    console.log('╚════════════════════════════════════════════════╝');
    console.log('');
    console.log('✨ No external binaries needed - pure JavaScript!');
    console.log('🔒 Spam protection: Block IPs with >10 clicks/min for 1 hour');
    console.log('');
});

process.on('SIGINT', () => {
    console.log('\nShutting down...');
    cleanupTempFiles();
    process.exit(0);
});

process.on('uncaughtException', (err) => console.error('Uncaught:', err));
process.on('unhandledRejection', (err) => console.error('Rejection:', err));

module.exports = app;
