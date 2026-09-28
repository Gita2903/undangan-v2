const jwt = require('jsonwebtoken');
const { getDb } = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'undangan-secret-key-change-in-production';
const JWT_EXPIRES_IN = '24h';

/**
 * Middleware: Authenticate admin via JWT Bearer token.
 */
function authAdmin(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: ['Unauthorized'] });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        req.isAdmin = true;
        next();
    } catch {
        return res.status(401).json({ error: ['Token expired or invalid'] });
    }
}

/**
 * Middleware: Authenticate guest via x-access-key header or Bearer token.
 * If Bearer token → admin context.
 * If x-access-key → guest context.
 */
function authGuestOrAdmin(req, res, next) {
    const authHeader = req.headers['authorization'];
    const accessKey = req.headers['x-access-key'];

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = decoded;
            req.isAdmin = true;
            return next();
        } catch {
            return res.status(401).json({ error: ['Token expired or invalid'] });
        }
    }

    if (accessKey) {
        const db = getDb();
        const user = db.prepare('SELECT id, uuid FROM users WHERE access_key = ?').get(accessKey);
        if (!user) {
            return res.status(401).json({ error: ['Invalid access key'] });
        }
        req.user = { id: user.id, uuid: user.uuid };
        req.isAdmin = false;
        return next();
    }

    return res.status(401).json({ error: ['Unauthorized'] });
}

/**
 * Generate JWT token for admin user.
 * @param {object} user
 * @returns {string}
 */
function generateToken(user) {
    return jwt.sign(
        { id: user.id, uuid: user.uuid, email: user.email },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

module.exports = {
    authAdmin,
    authGuestOrAdmin,
    generateToken,
    JWT_SECRET,
};
