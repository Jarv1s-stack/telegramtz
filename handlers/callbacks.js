const db = require('../database');
const checks = require('../utils/checks');

function register(bot) {
  bot.on('callback_query', (query) => {
    const data = query.data;
    const adminId = query.from.id;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    // Пропускаем callback'и обработанные в других файлах
    if (data.startsWith('take_') || data.startsWith('complete_') ||
        data.startsWith('reqcancel_') || data.startsWith('reqresched_') ||
        data.startsWith('svc_') || data.startsWith('admin_list_') ||
        data.startsWith('view_full_') || data.startsWith('masters_') ||
        data.startsWith('unblock_') || data === 'settings_restart') return;

    const admin = db.prepare('SELECT role FROM users WHERE telegram_id = ?').get(adminId);
    if (!admin || admin.role !== 'admin') {
      return bot.answerCallbackQuery(query.id, { text: '❌ Только администратор может это сделать.', show_alert: true });
    }

    try {
      // Одобрение мастера
      if (data.startsWith('approve_')) {
        const userId = parseInt(data.split('_')[1]);
        db.prepare('UPDATE users SET status = ? WHERE telegram_id = ?').run('active', userId);
        bot.editMessageText(
          query.message.text + '\n\n✅ *Мастер одобрен.*',
          { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } }
        );
        bot.sendMessage(userId,
          `✅ *Регистрация подтверждена!*\n\nТеперь вы можете брать заявки в группе.\n\nНажмите /start для перехода в главное меню.`,
          { parse_mode: 'Markdown' }
        );
        bot.answerCallbackQuery(query.id, { text: '✅ Мастер одобрен' });
      }

      // Отклонение мастера
      else if (data.startsWith('reject_')) {
        const userId = parseInt(data.split('_')[1]);
        const hasRequests = db.prepare('SELECT id FROM requests WHERE master_id = ? LIMIT 1').get(userId);
        if (hasRequests) {
          return bot.answerCallbackQuery(query.id, { text: '❌ У мастера есть заявки. Сначала заблокируйте его.', show_alert: true });
        }
        db.prepare('DELETE FROM users WHERE telegram_id = ?').run(userId);
        bot.editMessageText(
          query.message.text + '\n\n❌ *Мастер отклонён.*',
          { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } }
        );
        bot.sendMessage(userId, '❌ *Ваша заявка на регистрацию отклонена.*\n\nОбратитесь к администратору за подробностями.', { parse_mode: 'Markdown' });
        bot.answerCallbackQuery(query.id, { text: 'Мастер отклонён' });
      }

      // Подтверждение оплаты
      else if (data.startsWith('pay_')) {
        const requestId = data.split('_')[1];
        const req = db.prepare("SELECT * FROM requests WHERE id = ? AND status = 'WAIT_PAYMENT'").get(requestId);
        if (!req) {
          return bot.answerCallbackQuery(query.id, { text: '❌ Заявка не найдена или оплата уже подтверждена.', show_alert: true });
        }
        db.prepare('UPDATE requests SET status = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?').run('PAID', requestId);
        db.prepare('UPDATE users SET total_completed = total_completed + 1 WHERE telegram_id = ?').run(req.master_id);
        checks.updateMasterRating(req.master_id);

        bot.editMessageText(
          query.message.text + '\n\n✅ *Оплата подтверждена.*',
          { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } }
        );
        bot.sendMessage(req.master_id,
          `✅ *Оплата по заявке №${requestId} подтверждена!*\n\n💵 Комиссия: ${req.commission} тг\n\nМожете брать новые заявки.`,
          { parse_mode: 'Markdown' }
        );
        bot.answerCallbackQuery(query.id, { text: '✅ Оплата подтверждена' });
      }

      // Напомнить об оплате
      else if (data.startsWith('askpay_')) {
        const requestId = data.split('_')[1];
        const req = db.prepare('SELECT master_id, commission FROM requests WHERE id = ?').get(requestId);
        if (!req) return bot.answerCallbackQuery(query.id, { text: '❌ Заявка не найдена.', show_alert: true });

        bot.sendMessage(req.master_id,
          `💰 *Напоминание об оплате*\n\nПожалуйста, оплатите комиссию по заявке №${requestId}.\nСумма: *${req.commission} тг*`,
          { parse_mode: 'Markdown' }
        );
        bot.answerCallbackQuery(query.id, { text: '💬 Напоминание отправлено мастеру' });
      }

      // Подтверждение отказа
      else if (data.startsWith('confirm_cancel_')) {
        const requestId = data.split('_')[2];
        const req = db.prepare("SELECT * FROM requests WHERE id = ? AND status = 'REQUEST_CANCEL'").get(requestId);
        if (!req) {
          return bot.answerCallbackQuery(query.id, { text: '❌ Заявка не в статусе запроса отказа.', show_alert: true });
        }
        db.prepare('UPDATE requests SET status = ?, cancelled_at = CURRENT_TIMESTAMP WHERE id = ?').run('CANCELLED', requestId);
        db.prepare('UPDATE users SET total_cancelled = total_cancelled + 1 WHERE telegram_id = ?').run(req.master_id);
        checks.updateMasterRating(req.master_id);

        // Возвращаем заявку в группу
        const groupId = global.groupId;
        const groupMessage =
          `♻️ *Заявка №${req.id} снова доступна*\n\n` +
          `🔧 Услуга: ${req.service_type}\n` +
          `📍 Район: ${req.district}\n` +
          `📅 Дата: ${req.date} в ${req.time}\n` +
          `💵 Комиссия: ${req.commission} тг`;

        // Ставим обратно в NEW
        db.prepare("UPDATE requests SET status = 'NEW', master_id = NULL WHERE id = ?").run(requestId);

        bot.sendMessage(groupId, groupMessage, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '✅ Забрать заявку', callback_data: `take_${req.id}` }]] }
        });

        bot.editMessageText(query.message.text + '\n\n✅ *Отказ подтверждён. Заявка возвращена в группу.*', {
          chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] }
        });
        bot.sendMessage(req.master_id, `✅ *Ваш отказ от заявки №${requestId} подтверждён.*`, { parse_mode: 'Markdown' });
        bot.answerCallbackQuery(query.id, { text: 'Отказ подтверждён' });
      }

      // Отклонение отказа
      else if (data.startsWith('reject_cancel_')) {
        const requestId = data.split('_')[2];
        const req = db.prepare("SELECT id, master_id FROM requests WHERE id = ? AND status = 'REQUEST_CANCEL'").get(requestId);
        if (!req) {
          return bot.answerCallbackQuery(query.id, { text: '❌ Заявка не в статусе запроса отказа.', show_alert: true });
        }
        db.prepare("UPDATE requests SET status = 'TAKEN' WHERE id = ?").run(requestId);
        bot.editMessageText(query.message.text + '\n\n❌ *Отказ отклонён, заявка возвращена мастеру.*', {
          chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] }
        });
        bot.sendMessage(req.master_id,
          `❌ *Ваш запрос на отказ от заявки №${requestId} отклонён.*\n\nЗаявка остаётся за вами.`,
          { parse_mode: 'Markdown' }
        );
        bot.answerCallbackQuery(query.id, { text: 'Отказ отклонён' });
      }

      // Подтверждение переноса
      else if (data.startsWith('confirm_resched_')) {
        const requestId = data.split('_')[2];
        const req = db.prepare("SELECT * FROM requests WHERE id = ? AND status = 'REQUEST_RESCHEDULE'").get(requestId);
        if (!req) {
          return bot.answerCallbackQuery(query.id, { text: '❌ Заявка не в статусе запроса переноса.', show_alert: true });
        }
        db.prepare('UPDATE requests SET date = ?, time = ?, status = ?, reschedule_date = NULL, reschedule_time = NULL WHERE id = ?')
          .run(req.reschedule_date, req.reschedule_time, 'TAKEN', requestId);

        bot.editMessageText(query.message.text + `\n\n✅ *Перенос подтверждён: ${req.reschedule_date} в ${req.reschedule_time}*`, {
          chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] }
        });
        bot.sendMessage(req.master_id,
          `✅ *Перенос заявки №${requestId} подтверждён!*\n\n📅 Новая дата: *${req.reschedule_date} в ${req.reschedule_time}*`,
          { parse_mode: 'Markdown' }
        );
        bot.answerCallbackQuery(query.id, { text: 'Перенос подтверждён' });
      }

      // Отклонение переноса
      else if (data.startsWith('reject_resched_')) {
        const requestId = data.split('_')[2];
        const req = db.prepare("SELECT id, master_id FROM requests WHERE id = ? AND status = 'REQUEST_RESCHEDULE'").get(requestId);
        if (!req) {
          return bot.answerCallbackQuery(query.id, { text: '❌ Заявка не в статусе запроса переноса.', show_alert: true });
        }
        db.prepare("UPDATE requests SET status = 'TAKEN', reschedule_date = NULL, reschedule_time = NULL WHERE id = ?").run(requestId);
        bot.editMessageText(query.message.text + '\n\n❌ *Перенос отклонён.*', {
          chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] }
        });
        bot.sendMessage(req.master_id,
          `❌ *Запрос на перенос заявки №${requestId} отклонён.*\n\nСтарая дата остаётся в силе.`,
          { parse_mode: 'Markdown' }
        );
        bot.answerCallbackQuery(query.id, { text: 'Перенос отклонён' });
      }

      // Блокировка мастера
      else if (data.startsWith('block_')) {
        const masterId = data.split('_')[1];
        db.prepare("UPDATE users SET status = 'blocked' WHERE telegram_id = ?").run(masterId);
        bot.editMessageText(query.message.text + '\n\n🚫 *Мастер заблокирован.*', {
          chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] }
        });
        bot.sendMessage(masterId,
          `⛔ *Вы заблокированы администратором.*\n\nОбратитесь к администратору за подробностями.`,
          { parse_mode: 'Markdown' }
        );
        bot.answerCallbackQuery(query.id, { text: '🚫 Мастер заблокирован' });
      }

      // Просмотр заявки (заглушка — уже обрабатывается в bot.js)
      else if (data.startsWith('view_')) {
        bot.answerCallbackQuery(query.id, { text: 'ℹ️ Используйте кнопку "Подробнее" под заявкой.' });
      }

    } catch (error) {
      console.error('Ошибка в callbacks:', error);
      bot.answerCallbackQuery(query.id, { text: '❌ Внутренняя ошибка. Попробуйте снова.' });
    }
  });
}

module.exports = { register };
