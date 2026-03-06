const db = require('../database');
const checks = require('../utils/checks');

function register(bot) {
  bot.on('callback_query', (query) => {
    const data = query.data;
    const adminId = query.from.id;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    // Проверка прав администратора (кроме случая просмотра, но оставим общую)
    const admin = db.prepare('SELECT role FROM users WHERE telegram_id = ?').get(adminId);
    if (!admin || admin.role !== 'admin') {
      return bot.answerCallbackQuery(query.id, { text: '❌ Только админ может это сделать.' });
    }

    try {
      // Одобрение регистрации мастера
      if (data.startsWith('approve_')) {
        const userId = data.split('_')[1];
        db.prepare('UPDATE users SET status = ? WHERE telegram_id = ?').run('active', userId);
        bot.editMessageText('✅ Мастер одобрен.', { chat_id: chatId, message_id: messageId });
        bot.sendMessage(userId, '✅ Ваша регистрация одобрена! Теперь вы можете брать заявки.');
        bot.answerCallbackQuery(query.id, { text: 'Готово' });
      }

      // Отклонение регистрации (мастер ещё не активен, можно удалить)
      else if (data.startsWith('reject_')) {
        const userId = data.split('_')[1];
        // Проверяем, нет ли у мастера заявок (на всякий случай)
        const hasRequests = db.prepare('SELECT id FROM requests WHERE master_id = ? LIMIT 1').get(userId);
        if (hasRequests) {
          return bot.answerCallbackQuery(query.id, { text: '❌ У мастера есть заявки, сначала заблокируйте.' });
        }
        db.prepare('DELETE FROM users WHERE telegram_id = ?').run(userId);
        bot.editMessageText('❌ Мастер отклонён.', { chat_id: chatId, message_id: messageId });
        bot.sendMessage(userId, '❌ К сожалению, ваша регистрация отклонена.');
        bot.answerCallbackQuery(query.id, { text: 'Готово' });
      }

      // Подтверждение оплаты
      else if (data.startsWith('pay_')) {
        const requestId = data.split('_')[1];
        const req = db.prepare('SELECT * FROM requests WHERE id = ? AND status = ?').get(requestId, 'WAIT_PAYMENT');
        if (!req) {
          return bot.answerCallbackQuery(query.id, { text: '❌ Заявка не найдена или не ожидает оплаты.' });
        }

        db.prepare('UPDATE requests SET status = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?').run('PAID', requestId);
        db.prepare('UPDATE users SET total_completed = total_completed + 1 WHERE telegram_id = ?').run(req.master_id);
        checks.updateMasterRating(req.master_id);

        bot.editMessageText(`${query.message.text}\n\n✅ Оплата подтверждена.`, { chat_id: chatId, message_id: messageId });
        bot.sendMessage(req.master_id, '✅ Оплата подтверждена! Вы снова можете брать заявки.');
        bot.answerCallbackQuery(query.id, { text: 'Готово' });
      }

      // Запросить оплату (напоминание мастеру)
      else if (data.startsWith('askpay_')) {
        const requestId = data.split('_')[1];
        const req = db.prepare('SELECT master_id FROM requests WHERE id = ?').get(requestId);
        if (!req) return bot.answerCallbackQuery(query.id, { text: '❌ Заявка не найдена.' });

        bot.sendMessage(req.master_id, `💰 Напоминание: пожалуйста, оплатите комиссию по заявке №${requestId}.`);
        bot.answerCallbackQuery(query.id, { text: 'Уведомление отправлено мастеру.' });
      }

      // Подтверждение отказа
      else if (data.startsWith('confirm_cancel_')) {
        const requestId = data.split('_')[2];
        const req = db.prepare('SELECT * FROM requests WHERE id = ? AND status = ?').get(requestId, 'REQUEST_CANCEL');
        if (!req) {
          return bot.answerCallbackQuery(query.id, { text: '❌ Заявка не найдена или не в статусе запроса отказа.' });
        }

        db.prepare('UPDATE requests SET status = ? WHERE id = ?').run('CANCELLED', requestId);
        db.prepare('UPDATE users SET total_cancelled = total_cancelled + 1 WHERE telegram_id = ?').run(req.master_id);
        checks.updateMasterRating(req.master_id);
        bot.editMessageText(`${query.message.text}\n\n✅ Отказ подтверждён.`, { chat_id: chatId, message_id: messageId });
        bot.sendMessage(req.master_id, '✅ Ваш отказ подтверждён.');
        bot.answerCallbackQuery(query.id, { text: 'Готово' });
      }

      // Отклонение отказа (возврат в TAKEN)
      else if (data.startsWith('reject_cancel_')) {
        const requestId = data.split('_')[2];
        const req = db.prepare('SELECT id FROM requests WHERE id = ? AND status = ?').get(requestId, 'REQUEST_CANCEL');
        if (!req) {
          return bot.answerCallbackQuery(query.id, { text: '❌ Заявка не в статусе запроса отказа.' });
        }
        db.prepare('UPDATE requests SET status = ? WHERE id = ?').run('TAKEN', requestId);
        bot.editMessageText(`${query.message.text}\n\n❌ Отказ отклонён.`, { chat_id: chatId, message_id: messageId });
        bot.answerCallbackQuery(query.id, { text: 'Готово' });
      }

      // Подтверждение переноса
      else if (data.startsWith('confirm_resched_')) {
        const requestId = data.split('_')[2];
        const req = db.prepare('SELECT * FROM requests WHERE id = ? AND status = ?').get(requestId, 'REQUEST_RESCHEDULE');
        if (!req) {
          return bot.answerCallbackQuery(query.id, { text: '❌ Заявка не найдена или не в статусе запроса переноса.' });
        }
        if (!req.reschedule_date || !req.reschedule_time) {
          return bot.answerCallbackQuery(query.id, { text: '❌ Данные переноса не указаны.' });
        }

        db.prepare('UPDATE requests SET date = ?, time = ?, status = ? WHERE id = ?')
          .run(req.reschedule_date, req.reschedule_time, 'TAKEN', requestId);
        bot.editMessageText(`${query.message.text}\n\n✅ Перенос подтверждён.`, { chat_id: chatId, message_id: messageId });
        bot.sendMessage(req.master_id, `✅ Ваш перенос подтверждён. Новая дата: ${req.reschedule_date} ${req.reschedule_time}`);
        bot.answerCallbackQuery(query.id, { text: 'Готово' });
      }

      // Отклонение переноса
      else if (data.startsWith('reject_resched_')) {
        const requestId = data.split('_')[2];
        const req = db.prepare('SELECT id FROM requests WHERE id = ? AND status = ?').get(requestId, 'REQUEST_RESCHEDULE');
        if (!req) {
          return bot.answerCallbackQuery(query.id, { text: '❌ Заявка не в статусе запроса переноса.' });
        }
        db.prepare('UPDATE requests SET status = ? WHERE id = ?').run('TAKEN', requestId);
        bot.editMessageText(`${query.message.text}\n\n❌ Перенос отклонён.`, { chat_id: chatId, message_id: messageId });
        bot.answerCallbackQuery(query.id, { text: 'Готово' });
      }

      // Блокировка мастера
      else if (data.startsWith('block_')) {
        const masterId = data.split('_')[1];
        db.prepare('UPDATE users SET status = ? WHERE telegram_id = ?').run('blocked', masterId);
        bot.editMessageText(`${query.message.text}\n\n🚫 Мастер заблокирован.`, { chat_id: chatId, message_id: messageId });
        bot.sendMessage(masterId, '⛔ Вы были заблокированы администратором.');
        bot.answerCallbackQuery(query.id, { text: 'Готово' });
      }

      // Просмотр заявки (заглушка)
      else if (data.startsWith('view_')) {
        bot.answerCallbackQuery(query.id, { text: 'Функция просмотра в разработке.' });
      }
    } catch (error) {
      console.error('Ошибка в callback обработчике:', error);
      bot.answerCallbackQuery(query.id, { text: '❌ Произошла внутренняя ошибка.' });
      // Дополнительно можно уведомить админа об ошибке
    }
  });
}

module.exports = { register };