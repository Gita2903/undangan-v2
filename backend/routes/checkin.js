const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { rateLimit } = require('express-rate-limit');
const { getDb } = require('../database');
const { authAdmin, authCheckinStaff, generateCheckinToken } = require('../middleware/auth');

const router = express.Router();
const staffUsername = process.env.CHECKIN_USERNAME || '';
const staffPasswordHash = (() => {
    const pw = process.env.CHECKIN_PASSWORD || '';
    return pw ? bcrypt.hashSync(pw, 10) : null;
})();

const staffLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
});

function createQrToken() {
    return crypto.randomBytes(32).toString('hex');
}

function hashQrToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

router.post('/staff/session', staffLoginLimiter, (req, res) => {
    const { username, password } = req.body || {};
    if (!staffPasswordHash) {
        return res.status(503).json({ error: ['Check-in staff credentials are not configured'] });
    }
    if (typeof username !== 'string' || typeof password !== 'string' || username !== staffUsername || !bcrypt.compareSync(password, staffPasswordHash)) {
        return res.status(401).json({ error: ['Invalid username or password'] });
    }

    return res.status(200).json({
        code: 200,
        data: { token: generateCheckinToken(staffUsername), username: staffUsername },
        error: null,
    });
});

router.get('/invitations', authAdmin, async (req, res) => {
    const db = getDb();
    const guests = await db.prepare(`
        SELECT g.uuid, g.name, g.group_name, g.created_at, g.revoked_at,
               c.checked_in_at, c.staff_username
        FROM invited_guests g
        LEFT JOIN check_ins c ON c.guest_id = g.id
        ORDER BY g.name, g.id
    `).all(); // PostgreSQL doesn't support COLLATE NOCASE natively like SQLite, removed it.

    return res.status(200).json({ code: 200, data: { guests }, error: null });
});

router.post('/invitations', authAdmin, async (req, res) => {
    const { name, group_name = '' } = req.body || {};
    if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 100) {
        return res.status(400).json({ error: ['Name is required and must be at most 100 characters'] });
    }
    if (typeof group_name !== 'string' || group_name.trim().length > 100) {
        return res.status(400).json({ error: ['Group name must be at most 100 characters'] });
    }

    const token = createQrToken();
    const uuid = uuidv4();
    await getDb().prepare(`
        INSERT INTO invited_guests (uuid, name, group_name, token_hash)
        VALUES (?, ?, ?, ?)
    `).run(uuid, name.trim(), group_name.trim(), hashQrToken(token));

    return res.status(201).json({
        code: 201,
        data: {
            guest: { uuid, name: name.trim(), group_name: group_name.trim(), revoked_at: null, checked_in_at: null },
            token,
        },
        error: null,
    });
});

router.post('/invitations/:uuid/rotate', authAdmin, async (req, res) => {
    const db = getDb();
    const guest = await db.prepare(`
        SELECT g.id, g.uuid, g.name, g.group_name, g.revoked_at, c.checked_in_at
        FROM invited_guests g
        LEFT JOIN check_ins c ON c.guest_id = g.id
        WHERE g.uuid = ?
    `).get(req.params.uuid);

    if (!guest) {
        return res.status(404).json({ error: ['Invitation not found'] });
    }
    if (guest.checked_in_at) {
        return res.status(409).json({ error: ['A checked-in invitation cannot be reissued'] });
    }

    const token = createQrToken();
    await db.prepare(`
        UPDATE invited_guests SET token_hash = ?, revoked_at = NULL WHERE id = ?
    `).run(hashQrToken(token), guest.id);

    return res.status(200).json({
        code: 200,
        data: { guest: { uuid: guest.uuid, name: guest.name, group_name: guest.group_name }, token },
        error: null,
    });
});

router.delete('/invitations/:uuid', authAdmin, async (req, res) => {
    const result = await getDb().prepare(`
        UPDATE invited_guests SET revoked_at = CURRENT_TIMESTAMP
        WHERE uuid = ? AND revoked_at IS NULL
    `).run(req.params.uuid);

    if (result.changes === 0) {
        return res.status(404).json({ error: ['Active invitation not found'] });
    }
    return res.status(200).json({ code: 200, data: { status: true }, error: null });
});

router.post('/scan', authCheckinStaff, async (req, res) => {
    const { token } = req.body || {};
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) {
        return res.status(400).json({ error: ['QR token is invalid'] });
    }

    try {
        const db = getDb();
        const scanResult = await db.transaction(async (tx) => {
            const guest = await tx.prepare(`
                SELECT id, uuid, name, group_name, revoked_at
                FROM invited_guests WHERE token_hash = ?
            `).get(hashQrToken(token));

            if (!guest) {
                return { status: 'invalid' };
            }
            if (guest.revoked_at) {
                return { status: 'revoked', guest };
            }

            // Atomic claim: the PRIMARY KEY on guest_id makes concurrent scans safe,
            // and ON CONFLICT turns the loser into a normal 'already_checked_in'
            // instead of a unique-violation -> 500.
            const inserted = await tx.prepare(`
                INSERT INTO check_ins (guest_id, staff_username) VALUES (?, ?)
                ON CONFLICT (guest_id) DO NOTHING
                RETURNING checked_in_at, staff_username
            `).get(guest.id, req.staff.username);

            if (inserted) {
                return { status: 'checked_in', guest, ...inserted };
            }

            const existing = await tx.prepare(`
                SELECT checked_in_at, staff_username FROM check_ins WHERE guest_id = ?
            `).get(guest.id);
            return { status: 'already_checked_in', guest, ...existing };
        });

        return res.status(200).json({ code: 200, data: scanResult, error: null });
    } catch (err) {
        console.error('Scan error:', err);
        return res.status(500).json({ error: ['Internal server error'] });
    }
});

module.exports = router;
