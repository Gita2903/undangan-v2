const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');

const DB_PATH = path.join(__dirname, 'undangan.db');
const DEFAULT_ACCESS_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef012';

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

        CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id);
        CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);
        CREATE INDEX IF NOT EXISTS idx_likes_comment_id ON likes(comment_id);
    `);

    // Seed default admin user if none exists
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    if (userCount.count === 0) {
        const hashedPassword = bcrypt.hashSync('admin123', 10);
        const userUuid = uuidv4();

        db.prepare(`
            INSERT INTO users (uuid, name, email, password, access_key)
            VALUES (?, ?, ?, ?, ?)
        `).run(userUuid, 'Admin', 'admin@undangan.com', hashedPassword, DEFAULT_ACCESS_KEY);

        console.log('='.repeat(55));
        console.log('📧 Default Admin Account Initialized:');
        console.log(`   Email      : admin@undangan.com`);
        console.log(`   Password   : admin123`);
        console.log(`   Access Key : ${DEFAULT_ACCESS_KEY}`);
        console.log('='.repeat(55));
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

module.exports = {
    initDatabase,
    getDb,
    generateAccessKey,
    DEFAULT_ACCESS_KEY,
};
