const express = require('express');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const cors = require('cors');

const adapter = new FileSync('db.json');
const db = low(adapter);

const app = express();

app.use(express.json());
app.use(cors()); // CORS уже настроен — всё работает на itch.io

// Инициализация БД
db.defaults({
  keys: {},           // ключи: { KEY123: { nicks: ["@nik1", "nik2"], max: 2 } }
  bannedNicks: [],    // глобально забаненные ники
  adminPass: 'accesstranslation'
}).write();

app.get('/ping', (req, res) => res.send('ok'));

const API = '/api';

// Регистрация / активация: ключ + ник
app.post(API + '/register', (req, res) => {
  const { key, nick } = req.body;
  if (!key || !nick) return res.json({ valid: false, err: 'missing data' });

  const normalizedNick = nick.trim().toLowerCase();

  // Глобальный бан ника
  if (db.get('bannedNicks').value().includes(normalizedNick)) {
    return res.json({ valid: false, err: 'nick banned' });
  }

  let kdata = db.get(`keys.${key}`).value();
  if (!kdata) return res.json({ valid: false, err: 'invalid key' });

  const currentNicks = kdata.nicks.map(n => n.toLowerCase());

  // Если ник уже есть под этим ключом — просто ок
  if (currentNicks.includes(normalizedNick)) {
    return res.json({ valid: true });
  }

  // Лимит по никам (2 человека на ключ)
  if (kdata.nicks.length >= kdata.max) {
    return res.json({ valid: false, err: 'max users reached' });
  }

  // Добавляем новый ник
  db.get(`keys.${key}.nicks`).push(nick.trim()).write(); // сохраняем как ввёл пользователь
  res.json({ valid: true });
});

// Валидация: ключ + ник
app.post(API + '/validate', (req, res) => {
  const { key, nick } = req.body;
  if (!key || !nick) return res.json({ valid: false });

  const normalizedNick = nick.trim().toLowerCase();

  // Глобальный бан
  if (db.get('bannedNicks').value().includes(normalizedNick)) {
    return res.json({ valid: false });
  }

  const kdata = db.get(`keys.${key}`).value();
  if (!kdata) return res.json({ valid: false });

  const hasNick = kdata.nicks.some(n => n.toLowerCase() === normalizedNick);
  res.json({ valid: hasNick });
});

// ========== АДМИНКА ==========
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
    button {background:#c00; color:#fff; border:none; padding:8px 16px; cursor:pointer; border-radius:4px; margin:5px;}
    button:hover {background:#f00;}
    .greenbtn {background:#0c0;}
    input[type=text] {padding:8px; width:300px; background:#333; color:#fff; border:1px solid #555;}
    form {margin:15px 0;}
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
  <form action="/admin/ban-nick" method="POST">
    <input type="hidden" name="pass" value="${pass}">
    <input type="text" name="nick" placeholder="@baduser или baduser">
    <button type="submit">Забанить ник</button>
  </form>
  <ul>
    ${db.get('bannedNicks').value().map(n => `
      <li>${n}
        <form action="/admin/unban-nick" method="POST" style="display:inline;margin-left:10px;">
          <input type="hidden" name="pass" value="${pass}">
          <input type="hidden" name="nick" value="${n}">
          <button type="submit">Разбанить</button>
        </form>
      </li>
    `).join('') || '<li>Нет забаненных</li>'}
  </ul>

  <table>
    <tr><th>Ключ</th><th>Людей</th><th>Ники</th><th>Действия</th></tr>`;

  const keys = db.get('keys').value() || {};
  Object.entries(keys).forEach(([key, data]) => {
    const count = data.nicks.length;
    const color = count >= data.max ? 'orange' : '#0f0';
    const nickList = data.nicks.map(nick => `
      <div>• ${nick}
        <form action="/admin/remove-nick" method="POST" style="display:inline;margin-left:10px;">
          <input type="hidden" name="pass" value="${pass}">
          <input type="hidden" name="key" value="${key}">
          <input type="hidden" name="nick" value="${nick}">
          <button type="submit" style="background:#f80;font-size:0.9em;">Удалить</button>
        </form>
      </div>
    `).join('');

    html += `
    <tr>
      <td><b>${key}</b></td>
      <td style="color:${color};">${count}/${data.max}</td>
      <td>${nickList || '—'}</td>
      <td>
        <form action="/admin/revoke" method="POST">
          <input type="hidden" name="pass" value="${pass}">
          <input type="hidden" name="key" value="${key}">
          <button type="submit">Revoke весь ключ</button>
        </form>
      </td>
    </tr>`;
  });

  html += `</table>
  <p><a href="/admin?pass=${pass}">↻ Обновить</a></p>
</body>
</html>`;
  res.send(html);
});

// Админ: добавить ключ
app.post('/admin/add', express.urlencoded({ extended: true }), (req, res) => {
  const pass = req.body.pass;
  if (pass !== db.get('adminPass').value()) return res.send('Доступ запрещён');
  const key = req.body.key?.trim().toUpperCase();
  if (key) db.set(`keys.${key}`, { nicks: [], max: 2 }).write();
  res.redirect(`/admin?pass=${pass}`);
});

// Revoke ключ
app.post('/admin/revoke', express.urlencoded({ extended: true }), (req, res) => {
  const pass = req.body.pass;
  if (pass !== db.get('adminPass').value()) return res.send('Доступ запрещён');
  const key = req.body.key;
  if (key) db.unset(`keys.${key}`).write();
  res.redirect(`/admin?pass=${pass}`);
});

// Удалить конкретный ник с ключа
app.post('/admin/remove-nick', express.urlencoded({ extended: true }), (req, res) => {
  const pass = req.body.pass;
  if (pass !== db.get('adminPass').value()) return res.send('Доступ запрещён');
  const key = req.body.key;
  const nick = req.body.nick;
  if (key && nick) {
    db.get(`keys.${key}.nicks`).remove(n => n === nick).write();
  }
  res.redirect(`/admin?pass=${pass}`);
});

// Бан / разбан ника
app.post('/admin/ban-nick', express.urlencoded({ extended: true }), (req, res) => {
  const pass = req.body.pass;
  if (pass !== db.get('adminPass').value()) return res.send('Доступ запрещён');
  let nick = req.body.nick?.trim().toLowerCase();
  if (nick) {
    if (!nick.startsWith('@')) nick = '@' + nick;
    db.get('bannedNicks').push(nick).uniq().write();
  }
  res.redirect(`/admin?pass=${pass}`);
});

app.post('/admin/unban-nick', express.urlencoded({ extended: true }), (req, res) => {
  const pass = req.body.pass;
  if (pass !== db.get('adminPass').value()) return res.send('Доступ запрещён');
  const nick = req.body.nick;
  if (nick) db.get('bannedNicks').remove(n => n === nick).write();
  res.redirect(`/admin?pass=${pass}`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
