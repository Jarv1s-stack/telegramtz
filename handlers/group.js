const db = require('../database');
const checks = require('../utils/checks');

function register(bot) {
  bot.on('callback_query', (query) => {
    const data = query.data;
    if (!data.startsWith('take_')) return;

    const requestId = data.split('_')[1];
    const masterId = query.from.id;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    const master = db.prepare("SELECT * FROM users WHERE telegram_id = ? AND status = 'active'").get(masterId);
    if (!master) {
      return bot.answerCallbackQuery(query.id, {
        text: '❌ Вы не активны или не зарегистрированы.',
        show_alert: true
      });
    }

    db.exec('BEGIN');
    try {
      const request = db.prepare("SELECT * FROM requests WHERE id = ? AND status = 'NEW'").get(requestId);
      if (!request) throw new Error('❌ Заявка уже забрана другим мастером');

      const dailyCount = checks.getMasterDailyCount(masterId, request.date);
      if (dailyCount >= 4) throw new Error('❌ Лимит 4 заявки в день достигнут');
      if (checks.hasUnpaidRequest(masterId)) throw new Error('❌ У вас есть неоплаченная заявка — сначала завершите её');
      if (checks.hasPendingRescheduleOrCancel(masterId)) throw new Error('❌ У вас есть ожидающий перенос или отказ');
      if (checks.hasTimeConflict(masterId, request.date, request.time)) throw new Error('❌ Время пересекается с другой вашей заявкой');

      db.prepare(`
        UPDATE requests SET status = 'TAKEN', master_id = ?, taken_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(masterId, requestId);

      db.exec('COMMIT');

      // Красивое сообщение мастеру
      const fullInfo =
        `✅ *Вы взяли заявку №${request.id}*\n\n` +
        `🔧 Услуга: ${request.service_type}\n` +
        `🏠 Адрес: ${request.address}\n` +
        `📍 Район: ${request.district}\n` +
        `📅 Дата: ${request.date} в ${request.time}\n` +
        `📞 Клиент: ${request.client_phone}\n` +
        (request.comment && request.comment !== 'нет' ? `💬 Коммент: ${request.comment}\n` : '') +
        `💵 Комиссия: ${request.commission} тг`;

      const privateKeyboard = {
        inline_keyboard: [
          [{ text: '✅ Я завершил работу', callback_data: `complete_${request.id}` }],
          [
            { text: '⏳ Запросить перенос', callback_data: `reqresched_${request.id}` },
            { text: '❌ Отказаться', callback_data: `reqcancel_${request.id}` }
          ]
        ]
      };
      bot.sendMessage(masterId, fullInfo, { parse_mode: 'Markdown', reply_markup: privateKeyboard });

      // Уведомляем админов
      const admins = db.prepare("SELECT telegram_id FROM users WHERE role = 'admin'").all();
      for (const admin of admins) {
        bot.sendMessage(admin.telegram_id,
          `🔧 *Мастер взял заявку №${request.id}*\n\n` +
          `👤 Мастер: ${master.name}\n` +
          `⭐ Рейтинг: ${(master.rating || 0).toFixed(1)}\n` +
          `📊 Заявок на ${request.date}: ${dailyCount + 1}/4`,
          {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔍 Детали заявки', callback_data: `view_full_${request.id}` }]] }
          }
        );
      }

      // Обновляем сообщение в группе
      bot.editMessageText(
        query.message.text + `\n\n🔧 *Забрал:* ${master.name}`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } }
      );

      bot.answerCallbackQuery(query.id, { text: '✅ Заявка успешно взята!' });

    } catch (err) {
      db.exec('ROLLBACK');
      bot.answerCallbackQuery(query.id, { text: err.message, show_alert: true });
    }
  });
}

module.exports = { register };
