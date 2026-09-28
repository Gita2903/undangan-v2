const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const DEFAULT_ACCESS_KEY = '4eaf6356471a486becad049482cc9f0130ec225c59e586fcf1bc096e93e43f57';

let pool;
let initPromise = null;

/**
 * Replace SQLite ? placeholders with PostgreSQL $1, $2 placeholders
 */
function replacePlaceholders(sql) {
    let index = 1;
    return sql.replace(/\?/g, () => `$${index++}`);
}

async function runInitQueries() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
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
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS comments (
                id SERIAL PRIMARY KEY,
                uuid TEXT UNIQUE NOT NULL,
                own TEXT UNIQUE NOT NULL,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                parent_id INTEGER DEFAULT NULL REFERENCES comments(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                presence INTEGER NOT NULL DEFAULT 1,
                comment TEXT DEFAULT NULL,
                gif_url TEXT DEFAULT NULL,
                is_admin INTEGER NOT NULL DEFAULT 0,
                ip TEXT DEFAULT NULL,
                user_agent TEXT DEFAULT NULL,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS likes (
                id SERIAL PRIMARY KEY,
                uuid TEXT UNIQUE NOT NULL,
                comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
                ip TEXT DEFAULT NULL,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS invited_guests (
                id SERIAL PRIMARY KEY,
                uuid TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                group_name TEXT NOT NULL DEFAULT '',
                token_hash TEXT UNIQUE NOT NULL,
                revoked_at TIMESTAMPTZ DEFAULT NULL,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS check_ins (
                guest_id INTEGER PRIMARY KEY REFERENCES invited_guests(id) ON DELETE CASCADE,
                staff_username TEXT NOT NULL,
                checked_in_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id);
            CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);
            CREATE INDEX IF NOT EXISTS idx_likes_comment_id ON likes(comment_id);
            CREATE INDEX IF NOT EXISTS idx_invited_guests_name ON invited_guests(name);
        `);

        // Seed default admin user if none exists
        const userCountRes = await pool.query('SELECT COUNT(*) as count FROM users');
        const userCount = parseInt(userCountRes.rows[0].count, 10);
        
        if (userCount === 0) {
            const isProduction = process.env.NODE_ENV === 'production';
            const email = process.env.ADMIN_EMAIL || (isProduction ? '' : 'admin@undangan.com');
            const password = process.env.ADMIN_PASSWORD || (isProduction ? '' : 'admin123');
            const accessKey = process.env.ADMIN_ACCESS_KEY || (isProduction ? '' : DEFAULT_ACCESS_KEY);

            if (isProduction && (!email || password.length < 12 || accessKey.length < 32)) {
                console.error('Production database bootstrap requires ADMIN_EMAIL, ADMIN_PASSWORD (12+ chars), and ADMIN_ACCESS_KEY (32+ chars).');
                return;
            }

            const hashedPassword = bcrypt.hashSync(password, 10);
            const userUuid = uuidv4();

            await pool.query(`
                INSERT INTO users (uuid, name, email, password, access_key)
                VALUES ($1, $2, $3, $4, $5)
            `, [userUuid, process.env.ADMIN_NAME || 'Admin', email, hashedPassword, accessKey]);

            console.log(`Admin account initialized for ${email}.`);
        }
    } catch (err) {
        console.error('Failed to initialize database tables:', err);
    }
}

function initDatabase() {
    // In Vercel or production, DATABASE_URL should be set in environment variables
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.warn('DATABASE_URL is not set. Database operations will fail if not using a placeholder.');
    }

    pool = new Pool({
        connectionString: connectionString || 'postgresql://placeholder:placeholder@localhost:5432/placeholder',
        ssl: connectionString && connectionString.includes('supabase') ? { rejectUnauthorized: false } : false
    });

    // Kick off table creation + admin seed. The promise is kept so requests
    // can wait for it via whenReady() (matters on serverless cold starts).
    initPromise = runInitQueries();

    return pool;
}

const dbWrapper = {
    prepare: (sql) => ({
        get: async (...params) => {
            if (params.length === 1 && Array.isArray(params[0])) params = params[0];
            const res = await pool.query(replacePlaceholders(sql), params);
            return res.rows[0] || null;
        },
        all: async (...params) => {
            if (params.length === 1 && Array.isArray(params[0])) params = params[0];
            const res = await pool.query(replacePlaceholders(sql), params);
            return res.rows;
        },
        run: async (...params) => {
            if (params.length === 1 && Array.isArray(params[0])) params = params[0];
            const res = await pool.query(replacePlaceholders(sql), params);
            return { changes: res.rowCount };
        }
    }),
    transaction: async (callback) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const txWrapper = {
                prepare: (sql) => ({
                    get: async (...params) => {
                        if (params.length === 1 && Array.isArray(params[0])) params = params[0];
                        const res = await client.query(replacePlaceholders(sql), params);
                        return res.rows[0] || null;
                    },
                    all: async (...params) => {
                        if (params.length === 1 && Array.isArray(params[0])) params = params[0];
                        const res = await client.query(replacePlaceholders(sql), params);
                        return res.rows;
                    },
                    run: async (...params) => {
                        if (params.length === 1 && Array.isArray(params[0])) params = params[0];
                        const res = await client.query(replacePlaceholders(sql), params);
                        return { changes: res.rowCount };
                    }
                })
            };
            const result = await callback(txWrapper);
            await client.query('COMMIT');
            return result;
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }
};

/**
 * Resolves once table creation and admin seeding have finished.
 * runInitQueries() catches its own errors, so this never rejects.
 */
function whenReady() {
    return initPromise || Promise.resolve();
}

function getDb() {
    if (!pool) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return dbWrapper;
}

function closeDatabase() {
    if (pool) {
        pool.end();
        pool = null;
        initPromise = null;
    }
}

function generateAccessKey() {
    return crypto.randomBytes(25).toString('hex');
}

module.exports = {
    initDatabase,
    whenReady,
    getDb,
    closeDatabase,
    generateAccessKey,
};
