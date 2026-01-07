const express = require('express');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const adapter = new FileSync('db.json');
const db = low(adapter);

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST');
  next();
});

db.defaults({ 
  keys: {}, 
  adminPass: 'accesstranslation'
}).write();

app.get('/ping', (req, res) => res.send('ok'));

const API = '/api';

app.post(API + '/register', (req, res) => {
  const { key, device } = req.body;
  if (!key || !device) return res.json({ valid: false, err: 'missing data' });

  let kdata = db.get(`keys.${key}`).value();
  if (!kdata) return res.json({ valid: false, err: 'invalid key' });

  if (kdata.devices.includes(device)) {
    return res.json({ valid: true });
  }

  if (kdata.devices.length >= kdata.max) {
    return res.json({ valid: false, err: 'max devices reached' });
  }

  db.get(`keys.${key}.devices`).push(device).write();
  res.json({ valid: true });
});

app.post(API + '/validate', (req, res) => {
  const { key, device } = req.body;
  if (!key || !device) return res.json({ valid: false });

  const kdata = db.get(`keys.${key}`).value();
  const valid = !!kdata && kdata.devices.includes(device);
  res.json({ valid });
});

// Admin Dashboard
app.get('/admin', (req, res) => {
  const pass = req.query.pass;
  if (pass !== db.get('adminPass').value()) {
    return res.send('<h1>🚫 Доступ запрещён</h1>');
  }

  let html = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>License Dashboard</title>
  <style>
    body {font-family: Arial; background:#111; color:#eee; padding:20px;}
    table {border-collapse:collapse; width:100%; margin-top:20px;}
    th, td {border:1px solid #555; padding:12px; text-align:left;}
    th {background:#333;}
    tr:nth-child(even) {background:#222;}
    button {background:#c00; color:#fff; border:none; padding:8px 16px; cursor:pointer;}
    button:hover {background:#f00;}
    input {padding:8px; width:200px;}
    a {color:#0f0;}
  </style>
</head>
<body>
  <h1>🔑 License Dashboard</h1>
  <form action="/admin/add" method="POST">
    <input name="key" placeholder="Новый ключ (например PATRON001)" required>
    <button type="submit">Добавить ключ (макс. 2 устройства)</button>
  </form>
  <table>
    <tr><th>Ключ</th><th>Устройств</th><th>Список устройств</th><th>Действия</th></tr>`;

  Object.entries(db.get('keys').value() || {}).forEach(([key, data]) => {
    const count = data.devices.length;
    const color = count > 2 ? 'red' : '#0f0';
    html += `
    <tr>
      <td>${key}</td>
      <td style="color:${color};font-weight:bold;">${count}/${data.max}</td>
      <td>${data.devices.join('<br>')}</td>
      <td>
        <form action="/admin/revoke" method="POST" style="display:inline;">
          <input type="hidden" name="key" value="${key}">
          <button type="submit">🚫 Revoke + Ban</button>
        </form>
      </td>
    </tr>`;
  });

  html += `</table>
  <p><a href="/admin?pass=${pass}">Обновить</a></p>
</body>
</html>`;
  res.send(html);
});

// Admin: добавить ключ
app.post('/admin/add', express.urlencoded({ extended: true }), (req, res) => {
  if (req.body.pass !== db.get('adminPass').value()) return res.redirect('/admin');
  const key = req.body.key.trim();
  if (key) {
    db.set(`keys.${key}`, { devices: [], max: 2 }).write();
  }
  res.redirect(`/admin?pass=${req.body.pass}`);
});

// Admin: revoke ключ
app.post('/admin/revoke', express.urlencoded({ extended: true }), (req, res) => {
  if (req.body.pass !== db.get('adminPass').value()) return res.redirect('/admin');
  db.unset(`keys.${req.body.key}`).write();
  res.redirect(`/admin?pass=${req.body.pass}`);
});

// Запуск на Render (PORT из env)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

});
