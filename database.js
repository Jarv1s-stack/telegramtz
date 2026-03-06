const sqlite = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// Создаём папку db, если её нет
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'bot.db');
const db = new sqlite.DatabaseSync(dbPath);

// Включаем поддержку внешних ключей
db.exec('PRAGMA foreign_keys = ON;');

// Создаём таблицы
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    role TEXT DEFAULT 'master',
    name TEXT,
    phone TEXT,
    city TEXT,
    specialization TEXT,
    status TEXT DEFAULT 'pending',
    rating REAL DEFAULT 0,
    total_completed INTEGER DEFAULT 0,
    total_cancelled INTEGER DEFAULT 0,
    total_reschedules INTEGER DEFAULT 0,
    total_overdue INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_type TEXT,
    address TEXT,
    district TEXT,
    date TEXT,                -- YYYY-MM-DD
    time TEXT,                -- HH:MM
    wall_material TEXT,
    client_phone TEXT,
    comment TEXT,
    commission INTEGER,
    status TEXT DEFAULT 'NEW',
    master_id INTEGER,
    created_by INTEGER,
    taken_at DATETIME,
    completed_at DATETIME,
    paid_at DATETIME,
    cancelled_at DATETIME,
    cancel_reason TEXT,
    reschedule_date TEXT,
    reschedule_time TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(master_id) REFERENCES users(telegram_id),
    FOREIGN KEY(created_by) REFERENCES users(telegram_id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Устанавливаем пароль администратора по умолчанию
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
insertSetting.run('admin_password', 'admin123');

module.exports = db;