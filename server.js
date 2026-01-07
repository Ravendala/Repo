const express = require('express');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const cors = require('cors'); // ←←← Новая строка

const adapter = new FileSync('db.json');
const db = low(adapter);

const app = express();

app.use(express.json());

// ←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←
// НОВЫЙ CORS — автоматически обрабатывает OPTIONS и preflight
app.use(cors());
// Если хочешь быть более строгим (рекомендую для будущего):
// app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
// ←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←

// Инициализация БД
db.defaults({
  keys: {},
  adminPass: 'accesstranslation' // ←←← Твой текущий пароль (можно сменить)
}).write();

// Пинг для проверки / keep-alive
app.get('/ping', (req, res) => res.send('ok'));

const API = '/api';

// Регистрация нового устройства
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

// Валидация
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
    body {font-family: Arial, sans-serif; background:#111; color:#eee; padding:20px; max-width:1000px; margin:auto;}
    table {border-collapse:collapse; width:100%; margin-top:20px;}
    th, td {border:1px solid #555; padding:12px; text-align:left;}
    th {background:#333;}
    tr:nth-child(even) {background:#222;}
    button {background:#c00; color:#fff; border:none; padding:8px 16px; cursor:pointer; border-radius:4px;}
    button:hover {background:#f00;}
    input[type=text] {padding:8px; width:300px; background:#333; color:#fff; border:1px solid #555;}
    a {color:#0f0;}
    form {margin:20px 0;}
  </style>
</head>
<body>
  <h1>🔑 License Dashboard</h1>
 
  <form action="/admin/add" method="POST">
    <input type="hidden" name="pass" value="${pass}">
    <input type="text" name="key" placeholder="Новый ключ (например PATRON001)" required>
    <button type="submit">Добавить ключ (макс. 2 устройства)</button>
  </form>
 
  <table>
    <tr><th>Ключ</th><th>Устройств</th><th>Список устройств</th><th>Действия</th></tr>`;

  const keys = db.get('keys').value() || {};
  Object.entries(keys).forEach(([key, data]) => {
    const count = data.devices.length;
    const color = count > 2 ? 'red' : (count === data.max ? 'orange' : '#0f0');
    html += `
    <tr>
      <td><b>${key}</b></td>
      <td style="color:${color};font-weight:bold;">${count}/${data.max}</td>
      <td>${data.devices.map(d => d.slice(0,16) + '...').join('<br>') || '—'}</td>
      <td>
        <form action="/admin/revoke" method="POST" style="display:inline;">
          <input type="hidden" name="pass" value="${pass}">
          <input type="hidden" name="key" value="${key}">
          <button type="submit">🚫 Revoke + Ban</button>
        </form>
      </td>
    </tr>`;
  });

  html += `</table>
  <p><a href="/admin?pass=${pass}">↻ Обновить страницу</a></p>
  <p style="opacity:0.7;font-size:0.9em;margin-top:40px;">Сервер работает автономно. Последнее обновление: ${new Date().toLocaleString('ru-RU')}</p>
</body>
</html>`;

  res.send(html);
});

// Admin: добавить ключ
app.post('/admin/add', express.urlencoded({ extended: true }), (req, res) => {
  const pass = req.body.pass;
  if (pass !== db.get('adminPass').value()) {
    return res.send('<h1>🚫 Доступ запрещён</h1>');
  }
  const key = req.body.key?.trim();
  if (key) {
    db.set(`keys.${key}`, { devices: [], max: 2 }).write();
  }
  res.redirect(`/admin?pass=${pass}`);
});

// Admin: revoke ключ
app.post('/admin/revoke', express.urlencoded({ extended: true }), (req, res) => {
  const pass = req.body.pass;
  if (pass !== db.get('adminPass').value()) {
    return res.send('<h1>🚫 Доступ запрещён</h1>');
  }
  const key = req.body.key;
  if (key) {
    db.unset(`keys.${key}`).write();
  }
  res.redirect(`/admin?pass=${pass}`);
});

// Запуск
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`License server running on port ${PORT}`);
});
