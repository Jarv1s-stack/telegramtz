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

    // Проверяем, активен ли мастер
    const master = db.prepare('SELECT * FROM users WHERE telegram_id = ? AND status = ?').get(masterId, 'active');
    if (!master) {
      return bot.answerCallbackQuery(query.id, { text: '❌ Вы не активны или не зарегистрированы.' });
    }

    // Транзакция
    db.exec('BEGIN');
    try {
      // Получаем заявку и проверяем, что она ещё NEW
      const request = db.prepare('SELECT * FROM requests WHERE id = ? AND status = ?').get(requestId, 'NEW');
      if (!request) {
        throw new Error('❌ Заявка уже забрана');
      }

      // Проверки лимитов
      const dailyCount = checks.getMasterDailyCount(masterId, request.date);
      if (dailyCount >= 4) throw new Error('❌ Лимит 4 заявки в день');
      if (checks.hasUnpaidRequest(masterId)) throw new Error('❌ У вас есть неоплаченная заявка');
      if (checks.hasPendingRescheduleOrCancel(masterId)) throw new Error('❌ У вас есть неподтверждённый перенос/отказ');
      if (checks.hasTimeConflict(masterId, request.date, request.time)) throw new Error('❌ Пересечение времени с другой заявкой');

      // Назначаем мастера
      db.prepare(`
        UPDATE requests SET status = 'TAKEN', master_id = ?, taken_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(masterId, requestId);

      db.exec('COMMIT');

      // Отправляем мастеру полную информацию в личку
      const fullInfo = `✅ Вы взяли заявку №${request.id}
Услуга: ${request.service_type}
Полный адрес: ${request.address}
Дата/время: ${request.date} ${request.time}
Телефон клиента: ${request.client_phone}
Материал стены: ${request.wall_material}
Комментарий: ${request.comment}
Комиссия: ${request.commission} тг`;

      const privateKeyboard = {
        inline_keyboard: [
          [{ text: '✅ Завершил заявку', callback_data: `complete_${request.id}` }],
          [{ text: '❌ Запросить отказ', callback_data: `reqcancel_${request.id}` }],
          [{ text: '⏳ Запросить перенос', callback_data: `reqresched_${request.id}` }]
        ]
      };
      bot.sendMessage(masterId, fullInfo, { reply_markup: privateKeyboard });

      // Уведомляем всех админов
      const admins = db.prepare('SELECT telegram_id FROM users WHERE role = ?').all('admin');
      const adminKeyboard = {
        inline_keyboard: [
          [{ text: '👀 Посмотреть', callback_data: `view_${request.id}` }]
        ]
      };
      for (const admin of admins) {
        bot.sendMessage(admin.telegram_id,
            `👤 Мастер ${master.name} принял заявку №${request.id}\nРейтинг: ${master.rating}\nЗаявок на эту дату: ${dailyCount + 1}/4`,
            { reply_markup: adminKeyboard }
        );
      }

      // Редактируем сообщение в группе
      bot.editMessageText(`${query.message.text}\n\n✅ Забрал: ${master.name}`, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] }
      });

      bot.answerCallbackQuery(query.id, { text: '✅ Заявка взята!' });

    } catch (err) {
      db.exec('ROLLBACK');
      bot.answerCallbackQuery(query.id, { text: err.message });
    }
  });
}

module.exports = { register };