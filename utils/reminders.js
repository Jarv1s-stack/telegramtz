const cron = require('node-cron');
const db = require('../database');

function startReminders(bot) {
  // Каждую минуту проверяем
  cron.schedule('* * * * *', () => {
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
    const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    // Напоминания за 1-2 часа до заявки
    const upcoming = db.prepare(`
      SELECT r.*, u.telegram_id as master_telegram
      FROM requests r
      JOIN users u ON r.master_id = u.telegram_id
      WHERE r.status = 'TAKEN'
        AND datetime(r.date || ' ' || r.time) BETWEEN datetime(?) AND datetime(?)
    `).all(
      oneHourLater.toISOString().slice(0, 16).replace('T', ' '),
      twoHoursLater.toISOString().slice(0, 16).replace('T', ' ')
    );

    for (const req of upcoming) {
      bot.sendMessage(req.master_telegram, `🔔 Напоминание: заявка №${req.id} через 1-2 часа (${req.date} ${req.time})`);
    }

    // Просроченные завершения (3 часа после окончания)
    const overdue = db.prepare(`
      SELECT r.*, u.telegram_id as master_telegram
      FROM requests r
      JOIN users u ON r.master_id = u.telegram_id
      WHERE r.status = 'TAKEN'
        AND datetime(r.date || ' ' || r.time, '+1 hour') < datetime('now', '-3 hours')
    `).all();

    for (const req of overdue) {
      const admins = db.prepare('SELECT telegram_id FROM users WHERE role = ?').all('admin');
      for (const admin of admins) {
        bot.sendMessage(admin.telegram_id, `⚠️ Заявка №${req.id} не завершена спустя 3 часа после окончания. Мастер: ${req.master_telegram}`);
      }
    }

    // Неоплаченные заявки старше 24 часов
    const unpaid = db.prepare(`
      SELECT r.*, u.telegram_id as master_telegram
      FROM requests r
      JOIN users u ON r.master_id = u.telegram_id
      WHERE r.status = 'WAIT_PAYMENT'
        AND julianday('now') - julianday(r.completed_at) > 1
    `).all();

    for (const req of unpaid) {
      const admins = db.prepare('SELECT telegram_id FROM users WHERE role = ?').all('admin');
      for (const admin of admins) {
        bot.sendMessage(admin.telegram_id, `⚠️ Заявка №${req.id} ожидает оплаты более 24 часов. Мастер: ${req.master_telegram}`);
      }
    }
  });
}

module.exports = { startReminders };