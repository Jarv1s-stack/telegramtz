const cron = require('node-cron');
const db = require('../database');

// Трекинг уже отправленных напоминаний (чтобы не спамить)
const sentReminders = new Set();

function startReminders(bot) {
  // Каждую минуту
  cron.schedule('* * * * *', () => {
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
    const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    // ===== Напоминания мастерам (за 1-2 часа до заявки) =====
    const upcoming = db.prepare(`
      SELECT r.*, u.telegram_id as master_telegram, u.name as master_name
      FROM requests r
      JOIN users u ON r.master_id = u.telegram_id
      WHERE r.status = 'TAKEN'
        AND datetime(r.date || ' ' || r.time) BETWEEN datetime(?) AND datetime(?)
    `).all(
      oneHourLater.toISOString().slice(0, 16).replace('T', ' '),
      twoHoursLater.toISOString().slice(0, 16).replace('T', ' ')
    );

    for (const req of upcoming) {
      const key = `reminder_${req.id}_1h`;
      if (!sentReminders.has(key)) {
        sentReminders.add(key);
        bot.sendMessage(req.master_telegram,
          `🔔 *Напоминание о заявке №${req.id}*\n\n` +
          `📅 Дата: ${req.date} в ${req.time}\n` +
          `🔧 Услуга: ${req.service_type}\n` +
          `📍 Район: ${req.district}\n` +
          `📞 Клиент: ${req.client_phone}\n\n` +
          `⏰ До начала: ~1 час`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[{ text: '✅ Завершить после работы', callback_data: `complete_${req.id}` }]]
            }
          }
        );
      }
    }

    // ===== Просроченные завершения =====
    const overdue = db.prepare(`
      SELECT r.*, u.telegram_id as master_telegram, u.name as master_name
      FROM requests r
      JOIN users u ON r.master_id = u.telegram_id
      WHERE r.status = 'TAKEN'
        AND datetime(r.date || ' ' || r.time, '+2 hours') < datetime('now')
    `).all();

    for (const req of overdue) {
      const key = `overdue_${req.id}`;
      if (!sentReminders.has(key)) {
        sentReminders.add(key);
        const admins = db.prepare("SELECT telegram_id FROM users WHERE role = 'admin'").all();
        for (const admin of admins) {
          bot.sendMessage(admin.telegram_id,
            `⚠️ *Заявка №${req.id} не завершена!*\n\n` +
            `👤 Мастер: ${req.master_name}\n` +
            `📅 Была: ${req.date} в ${req.time}\n` +
            `🔧 Услуга: ${req.service_type}`,
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [[{ text: '🚫 Заблокировать мастера', callback_data: `block_${req.master_telegram}` }]]
              }
            }
          );
        }
        // Предупреждаем мастера
        bot.sendMessage(req.master_telegram,
          `⚠️ *Заявка №${req.id} не отмечена как завершённая!*\n\nАдминистратор уведомлён. Пожалуйста, нажмите кнопку завершения.`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[{ text: '✅ Завершить сейчас', callback_data: `complete_${req.id}` }]]
            }
          }
        );
      }
    }

    // ===== Неоплаченные заявки >24ч =====
    const unpaid = db.prepare(`
      SELECT r.*, u.telegram_id as master_telegram, u.name as master_name
      FROM requests r
      JOIN users u ON r.master_id = u.telegram_id
      WHERE r.status = 'WAIT_PAYMENT'
        AND julianday('now') - julianday(r.completed_at) > 1
    `).all();

    for (const req of unpaid) {
      const key = `unpaid_${req.id}`;
      if (!sentReminders.has(key)) {
        sentReminders.add(key);
        const admins = db.prepare("SELECT telegram_id FROM users WHERE role = 'admin'").all();
        for (const admin of admins) {
          bot.sendMessage(admin.telegram_id,
            `💰 *Комиссия не оплачена более 24 часов!*\n\n` +
            `Заявка №${req.id}\n` +
            `👤 Мастер: ${req.master_name}\n` +
            `💵 Сумма: ${req.commission} тг`,
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '✅ Подтвердить оплату', callback_data: `pay_${req.id}` },
                    { text: '💬 Напомнить', callback_data: `askpay_${req.id}` }
                  ],
                  [{ text: '🚫 Заблокировать', callback_data: `block_${req.master_telegram}` }]
                ]
              }
            }
          );
        }
      }
    }
  });

  // Чистим старые ключи раз в час (чтобы не накапливались в памяти)
  cron.schedule('0 * * * *', () => {
    sentReminders.clear();
    console.log('🗑 Кэш напоминаний очищен');
  });
}

module.exports = { startReminders };
