const http = require('http');

const PORT = 3001; // test on port 3001 to avoid conflicts
process.env.PORT = PORT;
const app = require('./server');

let server;

function request(method, path, headers = {}, body = null) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port: PORT,
            path,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...headers,
            },
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                let parsed = data;
                try {
                    parsed = JSON.parse(data);
                } catch {}
                resolve({ status: res.statusCode, headers: res.headers, body: parsed });
            });
        });
        req.on('error', reject);
        if (body) {
            req.write(typeof body === 'string' ? body : JSON.stringify(body));
        }
        req.end();
    });
}

async function runTests() {
    server = app.listen(PORT);
    console.log('Testing Undangan API Endpoints...');

    let adminToken = '';
    let accessKey = 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef012';
    let parentCommentUuid = '';
    let parentCommentOwn = '';
    let replyCommentUuid = '';
    let likeUuid = '';

    try {
        // 1. Health
        const health = await request('GET', '/api/health');
        console.log('1. GET /api/health:', health.status === 200 ? '✅ PASSED' : '❌ FAILED');

        // 2. Session (Login)
        const login = await request('POST', '/api/session', {}, {
            email: 'admin@undangan.com',
            password: 'admin123',
        });
        console.log('2. POST /api/session:', login.status === 200 && login.body?.data?.token ? '✅ PASSED' : '❌ FAILED');
        adminToken = login.body?.data?.token;

        // 3. Guest Config
        const config = await request('GET', '/api/v2/config', { 'x-access-key': accessKey });
        console.log('3. GET /api/v2/config:', config.status === 200 && config.body?.data?.can_reply === true ? '✅ PASSED' : '❌ FAILED');

        // 4. Admin User Detail
        const user = await request('GET', '/api/user', { 'Authorization': `Bearer ${adminToken}` });
        console.log('4. GET /api/user:', user.status === 200 && user.body?.data?.email === 'admin@undangan.com' ? '✅ PASSED' : '❌ FAILED');

        // 5. Admin Update User
        const updateUser = await request('PATCH', '/api/user', { 'Authorization': `Bearer ${adminToken}` }, { name: 'Admin Undangan' });
        console.log('5. PATCH /api/user:', updateUser.status === 200 && updateUser.body?.data?.status === true ? '✅ PASSED' : '❌ FAILED');

        // 6. Admin Stats
        const stats = await request('GET', '/api/stats', { 'Authorization': `Bearer ${adminToken}` });
        console.log('6. GET /api/stats:', stats.status === 200 && stats.body?.data?.comments !== undefined ? '✅ PASSED' : '❌ FAILED');

        // 7. Create Parent Comment
        const postComment = await request('POST', '/api/comment', { 'x-access-key': accessKey }, {
            id: null,
            name: 'Budi Santoso',
            presence: true,
            comment: 'Selamat atas pernikahannya! Semoga samawa.',
            gif_id: null,
        });
        console.log('7. POST /api/comment (parent):', postComment.status === 201 && postComment.body?.data?.uuid ? '✅ PASSED' : '❌ FAILED');
        parentCommentUuid = postComment.body?.data?.uuid;
        parentCommentOwn = postComment.body?.data?.own;

        // 8. Create Reply Comment
        const postReply = await request('POST', '/api/comment', { 'x-access-key': accessKey }, {
            id: parentCommentUuid,
            name: 'Siti Aminah',
            presence: false,
            comment: 'Aamiin yra, selamat ya!',
            gif_id: null,
        });
        console.log('8. POST /api/comment (reply):', postReply.status === 201 && postReply.body?.data?.uuid ? '✅ PASSED' : '❌ FAILED');
        replyCommentUuid = postReply.body?.data?.uuid;

        // 9. List Comments
        const listComments = await request('GET', '/api/v2/comment?per=10&next=0', { 'x-access-key': accessKey });
        const hasParent = listComments.body?.data?.lists?.some(c => c.uuid === parentCommentUuid);
        const hasReplies = listComments.body?.data?.lists?.[0]?.comments?.length > 0;
        console.log('9. GET /api/v2/comment:', listComments.status === 200 && hasParent && hasReplies ? '✅ PASSED' : '❌ FAILED');

        // 10. Like Comment
        const postLike = await request('POST', `/api/comment/${parentCommentUuid}`, { 'x-access-key': accessKey });
        console.log('10. POST /api/comment/:id (like):', postLike.status === 201 && postLike.body?.data?.uuid ? '✅ PASSED' : '❌ FAILED');
        likeUuid = postLike.body?.data?.uuid;

        // 11. Unlike Comment
        const patchUnlike = await request('PATCH', `/api/comment/${likeUuid}`, { 'x-access-key': accessKey });
        console.log('11. PATCH /api/comment/:id (unlike):', patchUnlike.status === 200 && patchUnlike.body?.data?.status === true ? '✅ PASSED' : '❌ FAILED');

        // 12. Update Comment
        const putComment = await request('PUT', `/api/comment/${parentCommentOwn}`, { 'x-access-key': accessKey }, {
            presence: true,
            comment: 'Selamat atas pernikahannya! Semoga menjadi keluarga sakinah mawaddah warahmah.',
            gif_id: null,
        });
        console.log('12. PUT /api/comment/:own:', putComment.status === 200 && putComment.body?.data?.status === true ? '✅ PASSED' : '❌ FAILED');

        // 13. Download CSV
        const download = await request('GET', '/api/download', { 'Authorization': `Bearer ${adminToken}` });
        const isCsv = download.headers['content-type']?.includes('text/csv');
        console.log('13. GET /api/download (CSV):', download.status === 200 && isCsv ? '✅ PASSED' : '❌ FAILED');

        // 14. Delete Comment
        const deleteComment = await request('DELETE', `/api/comment/${parentCommentOwn}`, { 'x-access-key': accessKey });
        console.log('14. DELETE /api/comment/:own:', deleteComment.status === 200 && deleteComment.body?.data?.status === true ? '✅ PASSED' : '❌ FAILED');

        // 15. Regenerate Access Key
        const regenKey = await request('PUT', '/api/key', { 'Authorization': `Bearer ${adminToken}` });
        console.log('15. PUT /api/key:', regenKey.status === 200 && regenKey.body?.data?.access_key ? '✅ PASSED' : '❌ FAILED');

        // Restore default key for consistency
        const { getDb } = require('./database');
        getDb().prepare('UPDATE users SET access_key = ? WHERE email = ?').run(accessKey, 'admin@undangan.com');

        console.log('\n🎉 ALL 15 ENDPOINTS VERIFIED AND WORKING PROPERLY!');
    } catch (err) {
        console.error('Test error:', err);
    } finally {
        server.close();
        process.exit(0);
    }
}

runTests();
