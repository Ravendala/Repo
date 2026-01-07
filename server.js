const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.urlencoded({ extended: true })); // для форм админки

// Подключение к Postgres (Render добавляет DATABASE_URL)
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

// ========= ПОЛНАЯ АДМИНКА С РАЗБАНОМ =========
app.get('/admin', async (req, res) => {
  const pass = req.query.pass;
  const correctPass = 'accesstranslation'; // ← сменить здесь, если нужно
  if (pass !== correctPass) return res.send('<h1>🚫 Доступ запрещён</h1>');

  const keysRes = await pool.query('SELECT * FROM keys ORDER BY key');
  const bannedRes = await pool.query('SELECT nick FROM banned_nicks ORDER BY nick');

  let html = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>License Dashboard</title>
  <style>
    body{font-family:Arial;background:#111;color:#eee;padding:20px;max-width:1000px;margin:auto;}
    table{border-collapse:collapse;width:100%;margin-top:20px;}
    th,td{border:1px solid #555;padding:10px;text-align:left;}
    th{background:#333;}
    button{padding:8px 16px;margin:5px;background:#c00;color:#fff;border:none;border-radius:4px;cursor:pointer;}
    button:hover{background:#f00;}
    .unban{background:#0c0;}
    .unban:hover{background:#0f0;}
    .remove{background:#f80;}
    input[type=text]{padding:8px;width:300px;background:#333;color:#fff;border:1px solid #555;}
    form{margin:15px 0;display:inline-block;}
    ul{margin:10px 0;padding-left:20px;}
    li{margin:5px 0;}
    a{color:#0f0;}
  </style>
</head>
<body>
  <h1>🔑 License Dashboard</h1>

  <form action="/admin/add" method="POST">
    <input type="hidden" name="pass" value="${pass}">
    <input type="text" name="key" placeholder="Новый ключ (например PATRON001)" required>
    <button type="submit">Добавить ключ (макс. 2 человека)</button>
  </form>

  <h2>Забаненные ники</h2>
  <form action="/admin/ban" method="POST">
    <input type="hidden" name="pass" value="${pass}">
    <input type="text" name="nick" placeholder="@baduser или baduser">
    <button type="submit">Забанить ник</button>
  </form>

  <ul>
    ${bannedRes.rows.map(row => `
      <li>${row.nick}
        <form action="/admin/unban" method="POST">
          <input type="hidden" name="pass" value="${pass}">
          <input type="hidden" name="nick" value="${row.nick}">
          <button type="submit" class="unban">Разбанить</button>
        </form>
      </li>
    `).join('') || '<li style="opacity:0.6;">Нет забаненных ников</li>'}
  </ul>

  <table>
    <tr><th>Ключ</th><th>Люди</th><th>Ники</th><th>Действия</th></tr>
    ${keysRes.rows.map(row => `
      <tr>
        <td><b>${row.key}</b></td>
        <td>${row.nicks.length}/${row.max_users}</td>
        <td>
          ${row.nicks.map(n => `
            <div>• ${n}
              <form action="/admin/remove-nick" method="POST">
                <input type="hidden" name="pass" value="${pass}">
                <input type="hidden" name="key" value="${row.key}">
                <input type="hidden" name="nick" value="${n}">
                <button type="submit" class="remove">Удалить ник</button>
              </form>
            </div>
          `).join('') || '—'}
        </td>
        <td>
          <form action="/admin/revoke" method="POST">
            <input type="hidden" name="pass" value="${pass}">
            <input type="hidden" name="key" value="${row.key}">
            <button type="submit">Revoke весь ключ</button>
          </form>
        </td>
      </tr>
    `).join('')}
  </table>

  <p style="margin-top:30px;"><a href="/admin?pass=${pass}">↻ Обновить страницу</a></p>
</body>
</html>`;

  res.send(html);
});

// Админ действия
app.post('/admin/add', async (req, res) => {
  if (req.body.pass !== 'accesstranslation') return res.send('Доступ запрещён');
  const key = req.body.key?.trim().toUpperCase();
  if (key) await pool.query('INSERT INTO keys (key) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
  res.redirect(`/admin?pass=${req.body.pass}`);
});

app.post('/admin/revoke', async (req, res) => {
  if (req.body.pass !== 'accesstranslation') return res.send('Доступ запрещён');
  await pool.query('DELETE FROM keys WHERE key = $1', [req.body.key]);
  res.redirect(`/admin?pass=${req.body.pass}`);
});

app.post('/admin/remove-nick', async (req, res) => {
  if (req.body.pass !== 'accesstranslation') return res.send('Доступ запрещён');
  await pool.query(
    `UPDATE keys SET nicks = array_remove(nicks, $1) WHERE key = $2`,
    [req.body.nick, req.body.key]
  );
  res.redirect(`/admin?pass=${req.body.pass}`);
});

app.post('/admin/ban', async (req, res) => {
  if (req.body.pass !== 'accesstranslation') return res.send('Доступ запрещён');
  let nick = req.body.nick?.trim();
  if (!nick) return res.redirect(`/admin?pass=${req.body.pass}`);
  if (!nick.startsWith('@')) nick = nick.toLowerCase(); // нормализуем
  await pool.query('INSERT INTO banned_nicks (nick) VALUES ($1) ON CONFLICT DO NOTHING', [nick]);
  res.redirect(`/admin?pass=${req.body.pass}`);
});

app.post('/admin/unban', async (req, res) => {
  if (req.body.pass !== 'accesstranslation') return res.send('Доступ запрещён');
  const nick = req.body.nick;
  if (nick) {
    await pool.query('DELETE FROM banned_nicks WHERE nick = $1', [nick]);
  }
  res.redirect(`/admin?pass=${req.body.pass}`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`License server running on port ${PORT}`));
