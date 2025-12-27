/**
 * YTGrab - YouTube Video & Shorts Downloader
 * Express Server with OPTIMIZED Downloads using yt-dlp
 * Enhanced with Advanced Security Features & Spam Protection
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ytdlp = require('yt-dlp-exec');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

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
        ? process.env.ALLOWED_ORIGIN || false
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
 * GET /api/info - Fetch video info FAST
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

        const info = await ytdlp(url, {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            skipDownload: true,
            flatPlaylist: true
        });

        res.json({
            success: true,
            videoId: info.id,
            title: info.title,
            channel: info.uploader || info.channel || 'Unknown',
            channelUrl: info.uploader_url || info.channel_url || '',
            duration: info.duration || 0,
            views: info.view_count || 0,
            likes: info.like_count || 0,
            thumbnail: info.thumbnail || `https://img.youtube.com/vi/${info.id}/maxresdefault.jpg`,
            description: (info.description || '').substring(0, 300),
            isShort: (info.duration || 0) <= 60
        });

    } catch (error) {
        console.error('Info error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch video info'
        });
    }
});

/**
 * GET /api/download - FAST Optimized Download
 * Uses pre-muxed formats (no merging = much faster!)
 */
app.get('/api/download', async (req, res) => {
    let tempFile = null;

    try {
        const { url, quality = 'highest', format = 'mp4' } = req.query;

        if (!url || !isValidYouTubeUrl(url)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid YouTube URL'
            });
        }

        console.log(`⚡ DOWNLOAD: ${url} | ${quality} | ${format}`);
        const startTime = Date.now();

        // Get info for filename
        const info = await ytdlp(url, {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            skipDownload: true
        });

        const sanitizedTitle = sanitizeFilename(info.title || 'video');
        const tempId = Date.now();

        let fileExtension, contentType, formatSpec;

        if (format === 'mp3') {
            fileExtension = 'mp3';
            contentType = 'audio/mpeg';
            formatSpec = 'bestaudio[ext=m4a]/bestaudio';
        } else {
            fileExtension = 'mp4';
            contentType = 'video/mp4';
            // KEY OPTIMIZATION: Use pre-muxed formats (no merging needed!)
            // These formats already have video+audio combined
            if (quality === 'highest') {
                // best with both video and audio, preferring mp4
                formatSpec = 'best[ext=mp4][vcodec*=avc]/best[ext=mp4]/best';
            } else {
                formatSpec = `best[height<=${quality}][ext=mp4]/best[height<=${quality}]/best`;
            }
        }

        tempFile = path.join(TEMP_DIR, `${tempId}_${sanitizedTitle}`);
        const outputTemplate = `${tempFile}.%(ext)s`;

        // Download with optimized settings
        const ytdlpOptions = {
            noCheckCertificates: true,
            noWarnings: true,
            noPlaylist: true,
            format: formatSpec,
            output: outputTemplate
        };

        if (format === 'mp3') {
            ytdlpOptions.extractAudio = true;
            ytdlpOptions.audioFormat = 'mp3';
            ytdlpOptions.audioQuality = 0;
        }

        console.log(`Downloading with format: ${formatSpec}`);

        // Try download - handle non-critical yt-dlp errors gracefully
        let ytdlpError = null;
        try {
            await ytdlp(url, ytdlpOptions);
        } catch (err) {
            ytdlpError = err;
            console.log(`yt-dlp warning (checking if file exists): ${err.message.substring(0, 100)}`);
        }

        // Find the downloaded file (may exist even if yt-dlp reported error)
        const files = fs.readdirSync(TEMP_DIR);
        const downloadedFile = files.find(f => f.startsWith(`${tempId}_`));

        if (!downloadedFile) {
            // File truly doesn't exist - throw the original error
            throw ytdlpError || new Error('Download failed - file not found');
        }

        const finalPath = path.join(TEMP_DIR, downloadedFile);
        const actualExt = path.extname(downloadedFile).substring(1);
        const stats = fs.statSync(finalPath);

        const downloadTime = ((Date.now() - startTime) / 1000).toFixed(1);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        console.log(`✅ Complete in ${downloadTime}s: ${downloadedFile} (${sizeMB} MB)`);

        // Send file
        const downloadFilename = `${sanitizedTitle}.${actualExt}`;
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadFilename)}"`);

        const readStream = fs.createReadStream(finalPath);

        readStream.on('end', () => {
            setTimeout(() => {
                try { fs.unlinkSync(finalPath); } catch (e) { }
            }, 2000);
        });

        readStream.pipe(res);

    } catch (error) {
        console.error('Download error:', error.message);

        // Cleanup temp file on error
        if (tempFile) {
            try {
                const files = fs.readdirSync(TEMP_DIR);
                files.filter(f => f.includes(path.basename(tempFile))).forEach(f => {
                    try { fs.unlinkSync(path.join(TEMP_DIR, f)); } catch (e) { }
                });
            } catch (e) { }
        }

        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: 'Download failed: ' + (error.message || 'Unknown error')
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
        mode: 'optimized',
        uptime: process.uptime(),
        blockedIPs: blockedIPs.size,
        trackedSessions: clickTracker.size
    });
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
    console.log('║        ⚡ OPTIMIZED MODE (Fast Downloads)       ║');
    console.log('║        🛡️  Advanced Spam Protection Active      ║');
    console.log(`║     Server running at http://localhost:${PORT}     ║`);
    console.log('║                                                ║');
    console.log('╚════════════════════════════════════════════════╝');
    console.log('');
    console.log('✨ Using pre-muxed formats for fastest downloads!');
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
