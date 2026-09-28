const assert = require('assert');
const { formatCommentDate, toDate } = require('./utils/date');
const { isValidGifInput, resolveGifUrl } = require('./utils/gif');

(async () => {
  // --- date
  const d = new Date('2026-09-28T03:12:44.000Z');
  assert.strictEqual(formatCommentDate(d, 'Asia/Jakarta'), '28 Sep 2026, 10:12');   // Date object (pg)
  assert.strictEqual(formatCommentDate('2026-09-28 03:12:44', 'Asia/Jakarta'), '28 Sep 2026, 10:12'); // legacy string
  assert.strictEqual(formatCommentDate('2026-09-28T03:12:44.000Z', 'Asia/Jakarta'), '28 Sep 2026, 10:12');
  assert.strictEqual(formatCommentDate(d, 'Not/AZone'), '28 Sep 2026, 10:12');       // bad tz falls back
  assert.strictEqual(formatCommentDate(null), '');
  console.log('date OK ->', formatCommentDate(d, 'Asia/Jakarta'));

  // --- gif validation
  const bad = ['x" onerror="alert(1)', '<img src=x>', 'javascript:alert(1)', 'http://media.tenor.com/a.gif',
               'https://evil.com/a.gif', 'https://media.tenor.com.evil.com/a.gif', 'https://user:pw@media.tenor.com/a.gif',
               'a'.repeat(65), 'foo bar', '../../etc/passwd', ''];
  bad.forEach(v => assert.strictEqual(isValidGifInput(v), false, 'should reject: ' + v));
  ['1234567890123456789', 'AbC_-123', 'https://media.tenor.com/abc/tenor.gif', 'https://c.tenor.com/x.gif']
    .forEach(v => assert.strictEqual(isValidGifInput(v), true, 'should accept: ' + v));
  console.log('gif validation OK');

  // --- resolve never echoes raw input
  assert.strictEqual(await resolveGifUrl('123', null), null);                                   // no key -> null
  assert.strictEqual(await resolveGifUrl('123', 'k', async () => ({ ok: false })), null);        // API fail -> null
  assert.strictEqual(await resolveGifUrl('123', 'k', async () => { throw new Error('net'); }), null);
  assert.strictEqual(await resolveGifUrl('123', 'k', async () => ({ ok: true, json: async () => ({ results: [] }) })), null);
  assert.strictEqual(await resolveGifUrl('123', 'k', async () => ({ ok: true, json: async () => ({ results: [{ media_formats: { tinygif: { url: 'https://evil.com/x.gif' } } }] }) })), null);
  assert.strictEqual(await resolveGifUrl('123', 'k', async () => ({ ok: true, json: async () => ({ results: [{ media_formats: { tinygif: { url: 'https://media.tenor.com/ok.gif' } } }] }) })), 'https://media.tenor.com/ok.gif');
  assert.strictEqual(await resolveGifUrl('https://media.tenor.com/a.gif', null), 'https://media.tenor.com/a.gif');
  console.log('gif resolve OK');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
