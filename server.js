const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Подключение к Postgres (Render добавит DATABASE_URL автоматически)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Создаём таблицы при старте
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS keys (
      key TEXT PRIMARY KEY,
      max_users INTEGER DEFAULT 2,
      nicks TEXT[] DEFAULT '{}'
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS banned_nicks (
      nick TEXT PRIMARY KEY
    )
  `);
})().catch(err => console.error('DB init error:', err));

app.get('/ping', (req, res) => res.send('ok'));

const API = '/api';

app.post(API + '/register', async (req, res) => {
  try {
    const { key, nick } = req.body;
    if (!key || !nick) return res.json({ valid: false, err: 'missing data' });

    const normNick = nick.trim().toLowerCase();

    // Бан ников
    const banCheck = await pool.query('SELECT 1 FROM banned_nicks WHERE LOWER(nick) = $1', [normNick]);
    if (banCheck.rowCount > 0) return res.json({ valid: false, err: 'nick banned' });

    const keyRow = await pool.query('SELECT nicks, max_users FROM keys WHERE key = $1', [key]);
    if (keyRow.rowCount === 0) return res.json({ valid: false, err: 'invalid key' });

    const currentNicks = keyRow.rows[0].nicks.map(n => n.toLowerCase());
    if (currentNicks.includes(normNick)) return res.json({ valid: true });

    if (keyRow.rows[0].nicks.length >= keyRow.rows[0].max_users) {
      return res.json({ valid: false, err: 'max users reached' });
    }

    await pool.query(
      'UPDATE keys SET nicks = array_append(nicks, $1) WHERE key = $2',
      [nick.trim(), key]
    );
    res.json({ valid: true });
  } catch (e) {
    console.error(e);
    res.json({ valid: false, err: 'server error' });
  }
});

app.post(API + '/validate', async (req, res) => {
  try {
    const { key, nick } = req.body;
    if (!key || !nick) return res.json({ valid: false });

    const normNick = nick.trim().toLowerCase();

    const banCheck = await pool.query('SELECT 1 FROM banned_nicks WHERE LOWER(nick) = $1', [normNick]);
    if (banCheck.rowCount > 0) return res.json({ valid: false });

    const keyRow = await pool.query('SELECT nicks FROM keys WHERE key = $1', [key]);
    if (keyRow.rowCount === 0) return res.json({ valid: false });

    const hasNick = keyRow.rows[0].nicks.some(n => n.toLowerCase() === normNick);
    res.json({ valid: hasNick });
  } catch (e) {
    res.json({ valid: false });
  }
});

// ========= АДМИНКА (простая версия) =========
app.get('/admin', async (req, res) => {
  const pass = req.query.pass;
  const correctPass = 'accesstranslation'; // ← можно изменить
  if (pass !== correctPass) return res.send('<h1>🚫 Доступ запрещён</h1>');

  const keysRes = await pool.query('SELECT * FROM keys ORDER BY key');
  const bannedRes = await pool.query('SELECT nick FROM banned_nicks');

  let html = `
<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>License Dashboard</title>
<style>body{font-family:Arial;background:#111;color:#eee;padding:20px;} table{border-collapse:collapse;width:100%;} th,td{border:1px solid #555;padding:10px;} th{background:#333;} button{padding:8px 16px;margin:5px;}</style>
</head><body>
<h1>🔑 License Dashboard</h1>

<form action="/admin/add" method="POST"><input type="hidden" name="pass" value="${pass}">
<input type="text" name="key" placeholder="Новый ключ" required>
<button type="submit">Добавить ключ</button></form>

<h2>Забаненные ники</h2>
<form action="/admin/ban" method="POST"><input type="hidden" name="pass" value="${pass}">
<input type="text" name="nick" placeholder="@nick"><button>Забанить</button></form>

<table><tr><th>Ключ</th><th>Люди</th><th>Ники</th><th>Действия</th></tr>`;

  for (const row of keysRes.rows) {
    html += `<tr><td><b>${row.key}</b></td><td>${row.nicks.length}/${row.max_users}</td>
    <td>${row.nicks.map(n => `
      • ${n}<br>
      <form action="/admin/remove-nick" method="POST" style="display:inline;">
        <input type="hidden" name="pass" value="${pass}">
        <input type="hidden" name="key" value="${row.key}">
        <input type="hidden" name="nick" value="${n}">
        <button style="font-size:0.8em;">Удалить</button>
      </form>
    `).join('') || '—'}</td>
    <td><form action="/admin/revoke" method="POST">
      <input type="hidden" name="pass" value="${pass}">
      <input type="hidden" name="key" value="${row.key}">
      <button>Revoke</button>
    </form></td></tr>`;
  }

  html += `</table><p><a href="/admin?pass=${pass}">Обновить</a></p></body></html>`;
  res.send(html);
});

// Админ действия
app.post('/admin/add', express.urlencoded({extended:true}), async (req, res) => {
  if (req.body.pass !== 'accesstranslation') return res.send('Доступ запрещён');
  const key = req.body.key?.trim().toUpperCase();
  if (key) await pool.query('INSERT INTO keys (key) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
  res.redirect(`/admin?pass=${req.body.pass}`);
});

app.post('/admin/revoke', express.urlencoded({extended:true}), async (req, res) => {
  if (req.body.pass !== 'accesstranslation') return res.send('Доступ запрещён');
  await pool.query('DELETE FROM keys WHERE key = $1', [req.body.key]);
  res.redirect(`/admin?pass=${req.body.pass}`);
});

app.post('/admin/remove-nick', express.urlencoded({extended:true}), async (req, res) => {
  if (req.body.pass !== 'accesstranslation') return res.send('Доступ запрещён');
  await pool.query(
    `UPDATE keys SET nicks = array_remove(nicks, $1) WHERE key = $2`,
    [req.body.nick, req.body.key]
  );
  res.redirect(`/admin?pass=${req.body.pass}`);
});

app.post('/admin/ban', express.urlencoded({extended:true}), async (req, res) => {
  if (req.body.pass !== 'accesstranslation') return res.send('Доступ запрещён');
  const nick = req.body.nick?.trim().toLowerCase();
  if (nick) await pool.query('INSERT INTO banned_nicks (nick) VALUES ($1) ON CONFLICT DO NOTHING', [nick]);
  res.redirect(`/admin?pass=${req.body.pass}`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
