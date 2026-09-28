const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase, DEFAULT_ACCESS_KEY } = require('./database');
const authRoutes = require('./routes/auth');
const commentRoutes = require('./routes/comment');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize SQLite database
initDatabase();

// CORS middleware
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-access-key', 'Accept'],
    exposedHeaders: ['Content-Disposition'],
}));

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', time: new Date().toISOString() });
});

// Serve frontend static files from root directory
const publicDir = path.join(__dirname, '..');
app.use(express.static(publicDir));

// Fallback to index.html for non-API routes
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: ['Endpoint not found'] });
    }
    return res.sendFile(path.join(publicDir, 'index.html'));
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
        console.log(`🔑 Default Admin Email : admin@undangan.com`);
        console.log(`🔑 Default Password    : admin123`);
        console.log(`🔑 Default Access Key  : ${DEFAULT_ACCESS_KEY}`);
        console.log('=======================================================\n');
    });
}

module.exports = app;
