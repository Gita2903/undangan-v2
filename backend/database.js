const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'undangan.db');
const DEFAULT_ACCESS_KEY = '4eaf6356471a486becad049482cc9f0130ec225c59e586fcf1bc096e93e43f57';

let db;

/**
 * Initialize database with tables and default admin user.
 */
function initDatabase() {
    db = new Database(DB_PATH);

    // Enable WAL mode for better concurrent read/write performance
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL DEFAULT 'Admin',
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            access_key TEXT UNIQUE NOT NULL,
            tz TEXT NOT NULL DEFAULT 'Asia/Jakarta',
            is_filter INTEGER NOT NULL DEFAULT 1,
            is_confetti_animation INTEGER NOT NULL DEFAULT 1,
            can_reply INTEGER NOT NULL DEFAULT 1,
            can_edit INTEGER NOT NULL DEFAULT 1,
            can_delete INTEGER NOT NULL DEFAULT 1,
            tenor_key TEXT DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL,
            own TEXT UNIQUE NOT NULL,
            user_id INTEGER NOT NULL,
            parent_id INTEGER DEFAULT NULL,
            name TEXT NOT NULL,
            presence INTEGER NOT NULL DEFAULT 1,
            comment TEXT DEFAULT NULL,
            gif_url TEXT DEFAULT NULL,
            is_admin INTEGER NOT NULL DEFAULT 0,
            ip TEXT DEFAULT NULL,
            user_agent TEXT DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS likes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL,
            comment_id INTEGER NOT NULL,
            ip TEXT DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS invited_guests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            group_name TEXT NOT NULL DEFAULT '',
            token_hash TEXT UNIQUE NOT NULL,
            revoked_at DATETIME DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS check_ins (
            guest_id INTEGER PRIMARY KEY,
            staff_username TEXT NOT NULL,
            checked_in_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (guest_id) REFERENCES invited_guests(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id);
        CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);
        CREATE INDEX IF NOT EXISTS idx_likes_comment_id ON likes(comment_id);
        CREATE INDEX IF NOT EXISTS idx_invited_guests_name ON invited_guests(name);
    `);

    // Seed default admin user if none exists
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    if (userCount.count === 0) {
        const isProduction = process.env.NODE_ENV === 'production';
        const email = process.env.ADMIN_EMAIL || (isProduction ? '' : 'admin@undangan.com');
        const password = process.env.ADMIN_PASSWORD || (isProduction ? '' : 'admin123');
        const accessKey = process.env.ADMIN_ACCESS_KEY || (isProduction ? '' : DEFAULT_ACCESS_KEY);

        if (isProduction && (!email || password.length < 12 || accessKey.length < 32)) {
            throw new Error('Production database bootstrap requires ADMIN_EMAIL, ADMIN_PASSWORD (12+ chars), and ADMIN_ACCESS_KEY (32+ chars).');
        }

        const hashedPassword = bcrypt.hashSync(password, 10);
        const userUuid = uuidv4();

        db.prepare(`
            INSERT INTO users (uuid, name, email, password, access_key)
            VALUES (?, ?, ?, ?, ?)
        `).run(userUuid, process.env.ADMIN_NAME || 'Admin', email, hashedPassword, accessKey);

        console.log(`Admin account initialized for ${email}.`);
    } else if (process.env.NODE_ENV === 'production') {
        const defaultAdmin = db.prepare('SELECT * FROM users WHERE email = ? OR access_key = ? LIMIT 1')
            .get('admin@undangan.com', DEFAULT_ACCESS_KEY);
        const usesDefaultCredentials = defaultAdmin && (
            bcrypt.compareSync('admin123', defaultAdmin.password) || defaultAdmin.access_key === DEFAULT_ACCESS_KEY
        );

        if (usesDefaultCredentials) {
            const email = process.env.ADMIN_EMAIL || '';
            const password = process.env.ADMIN_PASSWORD || '';
            const accessKey = process.env.ADMIN_ACCESS_KEY || '';

            if (!email || password.length < 12 || accessKey.length < 32) {
                throw new Error('The existing database still has demo admin credentials. Set ADMIN_EMAIL, ADMIN_PASSWORD (12+ chars), and ADMIN_ACCESS_KEY (32+ chars) in backend/.env to rotate them.');
            }

            if (password === 'admin123' || accessKey === DEFAULT_ACCESS_KEY) {
                throw new Error('ADMIN_PASSWORD and ADMIN_ACCESS_KEY must both differ from the demo credentials.');
            }

            const emailOwner = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
            if (emailOwner && emailOwner.id !== defaultAdmin.id) {
                throw new Error('ADMIN_EMAIL already belongs to another account; resolve the duplicate before rotating demo credentials.');
            }

            const hashedPassword = bcrypt.hashSync(password, 10);
            db.prepare(`
                UPDATE users
                SET name = ?, email = ?, password = ?, access_key = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(process.env.ADMIN_NAME || defaultAdmin.name, email, hashedPassword, accessKey, defaultAdmin.id);

            console.log(`Demo admin credentials rotated for ${email}.`);
        }
    }

    return db;
}

/**
 * Generate a random access key.
 * @returns {string}
 */
function generateAccessKey() {
    return crypto.randomBytes(25).toString('hex');
}

/**
 * Get database instance.
 * @returns {Database}
 */
function getDb() {
    if (!db) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return db;
}

function closeDatabase() {
    if (db) {
        db.close();
        db = null;
    }
}

module.exports = {
    initDatabase,
    getDb,
    closeDatabase,
    generateAccessKey,
};
