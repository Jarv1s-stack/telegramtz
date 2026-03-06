const db = require('../database');
const checks = require('../utils/checks');

// Состояния для запроса отказа и переноса
const masterState = new Map();

function register(bot) {
  // Обработка кнопок в личке мастера
  bot.on('callback_query', (query) => {
    const data = query.data;
    const masterId = query.from.id;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    // Завершение заявки
    if (data.startsWith('complete_')) {
      const requestId = data.split('_')[1];
      const request = db.prepare('SELECT * FROM requests WHERE id = ? AND master_id = ? AND status = ?').get(requestId, masterId, 'TAKEN');
      if (!request) {
        return bot.answerCallbackQuery(query.id, { text: '❌ Заявка не найдена или уже завершена.' });
      }

      db.prepare('UPDATE requests SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?').run('WAIT_PAYMENT', requestId);
      bot.editMessageText(`${query.message.text}\n\n✅ Заявка завершена. Ожидайте подтверждения оплаты.`, { chat_id: chatId, message_id: messageId });

      // Уведомляем админов
      const admins = db.prepare('SELECT telegram_id FROM users WHERE role = ?').all('admin');
      const adminKeyboard = {
        inline_keyboard: [
          [
            { text: '✅ Подтвердить оплату', callback_data: `pay_${requestId}` },
            { text: '💰 Запросить оплату', callback_data: `askpay_${requestId}` },
            { text: '🚫 Блокировать', callback_data: `block_${masterId}` }
          ]
        ]
      };
for (const admin of admins) {
  bot.sendMessage(admin.telegram_id,
    `💰 Мастер завершил заявку №${requestId}\nКомиссия: ${request.commission} тг`,
    { reply_markup: adminKeyboard }
  );
}
      bot.answerCallbackQuery(query.id);
    }

    // Запрос отказа
    else if (data.startsWith('reqcancel_')) {
      const requestId = data.split('_')[1];
      masterState.set(chatId, { step: 'cancel_reason', requestId });
      bot.sendMessage(chatId, '📝 Укажите причину отказа:');
      bot.answerCallbackQuery(query.id);
    }

    // Запрос переноса
    else if (data.startsWith('reqresched_')) {
      const requestId = data.split('_')[1];
      masterState.set(chatId, { step: 'resched_date', requestId });
      bot.sendMessage(chatId, '📅 Введите новую дату (ГГГГ-ММ-ДД):');
      bot.answerCallbackQuery(query.id);
    }
  });

  // Обработка текстовых сообщений от мастера (причина отказа, новая дата/время)
  bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const state = masterState.get(chatId);
    if (!state) return;

    const text = msg.text;
    const requestId = state.requestId;

    if (state.step === 'cancel_reason') {
      db.prepare('UPDATE requests SET status = ?, cancel_reason = ? WHERE id = ?').run('REQUEST_CANCEL', text, requestId);
      const admins = db.prepare('SELECT telegram_id FROM users WHERE role = ?').all('admin');
      const keyboard = {
        inline_keyboard: [
          [
            { text: '✅ Подтвердить отказ', callback_data: `confirm_cancel_${requestId}` },
            { text: '❌ Отклонить', callback_data: `reject_cancel_${requestId}` }
          ]
        ]
      };
      for (const admin of admins) {
        bot.sendMessage(admin.telegram_id,
  `🔄 Мастер запросил отказ по заявке №${requestId}\nПричина: ${text}`,
  { reply_markup: keyboard }
);
      }
      bot.sendMessage(chatId, '✅ Запрос на отказ отправлен администратору.');
      masterState.delete(chatId);
    }
    else if (state.step === 'resched_date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return bot.sendMessage(chatId, '❌ Неверный формат. Используйте ГГГГ-ММ-ДД');
      }
      state.resched_date = text;
      state.step = 'resched_time';
      bot.sendMessage(chatId, '⏰ Введите новое время (ЧЧ:ММ):');
    }
    else if (state.step === 'resched_time') {
      if (!/^\d{2}:\d{2}$/.test(text)) {
        return bot.sendMessage(chatId, '❌ Неверный формат. Используйте ЧЧ:ММ');
      }
      const newTime = text;
      db.prepare('UPDATE requests SET status = ?, reschedule_date = ?, reschedule_time = ? WHERE id = ?')
        .run('REQUEST_RESCHEDULE', state.resched_date, newTime, requestId);
      const admins = db.prepare('SELECT telegram_id FROM users WHERE role = ?').all('admin');
      const keyboard = {
        inline_keyboard: [
          [
            { text: '✅ Подтвердить перенос', callback_data: `confirm_resched_${requestId}` },
            { text: '❌ Отклонить', callback_data: `reject_resched_${requestId}` }
          ]
        ]
      };
      for (const admin of admins) {
        bot.sendMessage(admin.telegram_id,
  `🔄 Мастер запросил перенос заявки №${requestId}\nНовая дата: ${state.resched_date} ${newTime}`,
  { reply_markup: keyboard }
);
      }
      bot.sendMessage(chatId, '✅ Запрос на перенос отправлен администратору.');
      masterState.delete(chatId);
    }
  });
}

module.exports = { register, masterState };