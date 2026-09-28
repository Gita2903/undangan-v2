const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { initDatabase } = require('./database');
const authRoutes = require('./routes/auth');
const commentRoutes = require('./routes/comment');
const checkinRoutes = require('./routes/checkin');

const app = express();
const PORT = process.env.PORT || 3000;
app.disable('x-powered-by');
app.use(helmet());

const allowedOrigins = new Set(
    (process.env.CORS_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
);

if (process.env.TRUST_PROXY_HOPS) {
    const proxyHops = Number(process.env.TRUST_PROXY_HOPS);
    if (!Number.isInteger(proxyHops) || proxyHops < 1) {
        throw new Error('TRUST_PROXY_HOPS must be a positive integer.');
    }
    app.set('trust proxy', proxyHops);
} else {
    // Default to 1 proxy hop for platforms like Vercel
    app.set('trust proxy', 1);
}

// Initialize SQLite database
initDatabase();

// CORS middleware
app.use(cors({
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-access-key', 'Accept'],
    exposedHeaders: ['Content-Disposition'],
}));

// Body parsers
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: true, limit: '32kb' }));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
});

app.use('/api', apiLimiter);
app.use('/api/session', loginLimiter);

// Request logger for development
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (req.path.startsWith('/api')) {
            console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
        }
    });
    next();
});

// API Routes
app.use('/api', authRoutes);
app.use('/api', commentRoutes);
app.use('/api/checkin', checkinRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', time: new Date().toISOString() });
});

// Serve only the built public directory; never expose source or backend files.
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// Return explicit 404s for unknown API and static paths.
app.use((req, res) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: ['Endpoint not found'] });
    }
    return res.status(404).send('Not Found');
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled Server Error:', err);
    res.status(500).json({
        code: 500,
        error: ['Internal Server Error'],
    });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log('\n=======================================================');
        console.log(`🚀 Undangan Backend Server running on http://localhost:${PORT}`);
        console.log(`🌐 Frontend Invitation : http://localhost:${PORT}/`);
        console.log(`⚙️ Admin Dashboard     : http://localhost:${PORT}/dashboard.html`);
        console.log('=======================================================\n');
    });
}

module.exports = app;
