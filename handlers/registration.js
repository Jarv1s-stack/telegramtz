const db = require('../database');

// Хранилище состояний регистрации (chatId -> {step, data})
const registrationState = new Map();

function register(bot) {
  // Обработка /start
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId);
    if (user) {
      if (user.role === 'admin') {
        return bot.sendMessage(chatId, 'Вы администратор. Используйте /create для создания заявки или /admin для меню.');
      }
      return bot.sendMessage(chatId, 'Вы уже зарегистрированы. Ожидайте новых заявок в группе.');
    }

    registrationState.set(chatId, { step: 'name', data: {} });
    bot.sendMessage(chatId, 'Добро пожаловать! Для регистрации введите ваше имя:');
  });

  // Обработка шагов регистрации
  bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const state = registrationState.get(chatId);
    if (!state) return;

    const text = msg.text;
    const userId = msg.from.id;
    const data = state.data;

    const steps = {
      name: () => {
        data.name = text;
        state.step = 'phone';
        bot.sendMessage(chatId, 'Отправьте ваш номер телефона, нажав кнопку ниже.', {
          reply_markup: {
            keyboard: [[{ text: '📱 Отправить телефон', request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true
          }
        });
      },
      phone: () => {
        if (msg.contact) {
          data.phone = msg.contact.phone_number;
          state.step = 'city';
          bot.sendMessage(chatId, 'Введите ваш город:', { reply_markup: { remove_keyboard: true } });
        } else {
          bot.sendMessage(chatId, 'Пожалуйста, используйте кнопку для отправки контакта.');
        }
      },
      city: () => {
        data.city = text;
        state.step = 'specialization';
        bot.sendMessage(chatId, 'Введите вашу специализацию (например, установка, ремонт):');
      },
      specialization: () => {
        data.specialization = text;

        // Сохраняем мастера со статусом pending
        db.prepare(`
          INSERT INTO users (telegram_id, name, phone, city, specialization, status)
          VALUES (?, ?, ?, ?, ?, 'pending')
        `).run(userId, data.name, data.phone, data.city, data.specialization);

        // Уведомляем всех админов
        const admins = db.prepare('SELECT telegram_id FROM users WHERE role = ?').all('admin');
        const keyboard = {
          inline_keyboard: [
            [
              { text: '✅ Одобрить', callback_data: `approve_${userId}` },
              { text: '❌ Отклонить', callback_data: `reject_${userId}` }
            ]
          ]
        };
        for (const admin of admins) {
            bot.sendMessage(admin.telegram_id,
                `🆕 Новая заявка на регистрацию:\nИмя: ${data.name}\nТелефон: ${data.phone}\nГород: ${data.city}\nСпециализация: ${data.specialization}`,
                { reply_markup: keyboard }
            );
        }

        bot.sendMessage(chatId, '✅ Заявка отправлена администратору. Ожидайте подтверждения.');
        registrationState.delete(chatId);
      }
    };

    if (steps[state.step]) steps[state.step]();
  });
}

module.exports = { register, registrationState };