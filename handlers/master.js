const db = require('../database');

const masterState = new Map();

function register(bot) {
  bot.on('callback_query', (query) => {
    const data = query.data;
    const masterId = query.from.id;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    // Завершение заявки
    if (data.startsWith('complete_')) {
      const requestId = data.split('_')[1];
      const request = db.prepare("SELECT * FROM requests WHERE id = ? AND master_id = ? AND status = 'TAKEN'").get(requestId, masterId);
      if (!request) {
        return bot.answerCallbackQuery(query.id, { text: '❌ Заявка не найдена или уже завершена.', show_alert: true });
      }

      db.prepare('UPDATE requests SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?').run('WAIT_PAYMENT', requestId);

      bot.editMessageText(
        query.message.text + `\n\n⏳ *Ожидает подтверждения оплаты...*`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } }
      );

      const admins = db.prepare("SELECT telegram_id FROM users WHERE role = 'admin'").all();
      for (const admin of admins) {
        bot.sendMessage(admin.telegram_id,
          `💰 *Мастер завершил заявку №${requestId}*\n\n` +
          `👤 Мастер ID: ${masterId}\n` +
          `💵 Комиссия к оплате: *${request.commission} тг*`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Подтвердить оплату', callback_data: `pay_${requestId}` },
                  { text: '💬 Напомнить мастеру', callback_data: `askpay_${requestId}` }
                ],
                [{ text: '🚫 Заблокировать', callback_data: `block_${masterId}` }]
              ]
            }
          }
        );
      }
      bot.answerCallbackQuery(query.id, { text: '✅ Отлично! Ожидайте подтверждения оплаты.' });
    }

    // Запрос отказа
    else if (data.startsWith('reqcancel_')) {
      const requestId = data.split('_')[1];
      masterState.set(chatId, { step: 'cancel_reason', requestId });
      bot.sendMessage(chatId,
        `❌ *Запрос на отказ от заявки №${requestId}*\n\nУкажите причину — администратор рассмотрит ваш запрос:`,
        { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } }
      );
      bot.answerCallbackQuery(query.id);
    }

    // Запрос переноса
    else if (data.startsWith('reqresched_')) {
      const requestId = data.split('_')[1];
      masterState.set(chatId, { step: 'resched_date', requestId });
      bot.sendMessage(chatId,
        `🔄 *Запрос переноса заявки №${requestId}*\n\nВведите новую дату (*ГГГГ-ММ-ДД*):`,
        { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } }
      );
      bot.answerCallbackQuery(query.id);
    }
  });

  // Текстовые ответы мастера
  bot.on('message', (msg) => {
    if (msg.chat.type !== 'private') return;
    const chatId = msg.chat.id;
    const state = masterState.get(chatId);
    if (!state || !msg.text) return;

    const text = msg.text;
    const requestId = state.requestId;

    if (state.step === 'cancel_reason') {
      db.prepare('UPDATE requests SET status = ?, cancel_reason = ? WHERE id = ?').run('REQUEST_CANCEL', text, requestId);

      const master = db.prepare('SELECT name FROM users WHERE telegram_id = ?').get(msg.from.id);
      const admins = db.prepare("SELECT telegram_id FROM users WHERE role = 'admin'").all();

      for (const admin of admins) {
        bot.sendMessage(admin.telegram_id,
          `⏸ *Мастер запрашивает отказ*\n\nЗаявка №${requestId}\n👤 Мастер: ${master ? master.name : msg.from.id}\n📝 Причина: ${text}`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Подтвердить отказ', callback_data: `confirm_cancel_${requestId}` },
                { text: '❌ Отклонить', callback_data: `reject_cancel_${requestId}` }
              ]]
            }
          }
        );
      }
      bot.sendMessage(chatId, '✅ *Запрос на отказ отправлен.*\n\nАдминистратор рассмотрит его в ближайшее время.', { parse_mode: 'Markdown' });
      masterState.delete(chatId);
    }

    else if (state.step === 'resched_date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return bot.sendMessage(chatId, '❌ Неверный формат. Используйте: *ГГГГ-ММ-ДД*', { parse_mode: 'Markdown' });
      }
      state.resched_date = text;
      state.step = 'resched_time';
      bot.sendMessage(chatId, `✅ Дата: *${text}*\n\nВведите новое время (*ЧЧ:ММ*):`, { parse_mode: 'Markdown' });
    }

    else if (state.step === 'resched_time') {
      if (!/^\d{2}:\d{2}$/.test(text)) {
        return bot.sendMessage(chatId, '❌ Неверный формат. Используйте: *ЧЧ:ММ*', { parse_mode: 'Markdown' });
      }
      db.prepare('UPDATE requests SET status = ?, reschedule_date = ?, reschedule_time = ? WHERE id = ?')
        .run('REQUEST_RESCHEDULE', state.resched_date, text, requestId);

      const master = db.prepare('SELECT name FROM users WHERE telegram_id = ?').get(msg.from.id);
      const admins = db.prepare("SELECT telegram_id FROM users WHERE role = 'admin'").all();

      for (const admin of admins) {
        bot.sendMessage(admin.telegram_id,
          `🔄 *Мастер запрашивает перенос*\n\nЗаявка №${requestId}\n👤 Мастер: ${master ? master.name : msg.from.id}\n📅 Новая дата: ${state.resched_date} в ${text}`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Подтвердить перенос', callback_data: `confirm_resched_${requestId}` },
                { text: '❌ Отклонить', callback_data: `reject_resched_${requestId}` }
              ]]
            }
          }
        );
      }
      bot.sendMessage(chatId, '✅ *Запрос на перенос отправлен.*\n\nАдминистратор рассмотрит его в ближайшее время.', { parse_mode: 'Markdown' });
      masterState.delete(chatId);
    }
  });
}

module.exports = { register, masterState };
