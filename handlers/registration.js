const db = require('../database');

const registrationState = new Map();

function register(bot) {
  bot.onText(/\/start/, (msg) => {
    // Handled in bot.js
  });

  bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    if (msg.chat.type !== 'private') return;
    const state = registrationState.get(chatId);
    if (!state) return;

    const text = msg.text;
    const userId = msg.from.id;
    const data = state.data;

    const steps = {
      name: () => {
        if (!text || text.startsWith('/')) return;
        data.name = text;
        state.step = 'phone';
        bot.sendMessage(chatId,
          `📝 *Регистрация*\n\n✅ Имя: *${text}*\n\n*Шаг 2 из 4* — Отправьте номер телефона:`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              keyboard: [[{ text: '📱 Отправить мой номер', request_contact: true }]],
              resize_keyboard: true,
              one_time_keyboard: true
            }
          }
        );
      },
      phone: () => {
        if (msg.contact) {
          data.phone = msg.contact.phone_number;
          state.step = 'city';
          bot.sendMessage(chatId,
            `📝 *Регистрация*\n\n✅ Имя: *${data.name}*\n✅ Телефон: *${data.phone}*\n\n*Шаг 3 из 4* — Введите ваш город:`,
            { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } }
          );
        } else {
          bot.sendMessage(chatId, '👆 Пожалуйста, используйте кнопку для отправки контакта.');
        }
      },
      city: () => {
        if (!text || text.startsWith('/')) return;
        data.city = text;
        state.step = 'specialization';
        bot.sendMessage(chatId,
          `📝 *Регистрация*\n\n✅ Имя: *${data.name}*\n✅ Телефон: *${data.phone}*\n✅ Город: *${data.city}*\n\n*Шаг 4 из 4* — Специализация:\n(например: установка, ремонт, чистка)`,
          { parse_mode: 'Markdown' }
        );
      },
      specialization: () => {
        if (!text || text.startsWith('/')) return;
        data.specialization = text;

        db.prepare(`
          INSERT INTO users (telegram_id, name, phone, city, specialization, status)
          VALUES (?, ?, ?, ?, ?, 'pending')
        `).run(userId, data.name, data.phone, data.city, data.specialization);

        const admins = db.prepare("SELECT telegram_id FROM users WHERE role = 'admin'").all();
        const keyboard = {
          inline_keyboard: [[
            { text: '✅ Одобрить', callback_data: `approve_${userId}` },
            { text: '❌ Отклонить', callback_data: `reject_${userId}` }
          ]]
        };

        for (const admin of admins) {
          bot.sendMessage(admin.telegram_id,
            `🆕 *Новая заявка на регистрацию*\n\n👤 Имя: ${data.name}\n📞 Телефон: ${data.phone}\n🏙 Город: ${data.city}\n🔧 Специализация: ${data.specialization}`,
            { parse_mode: 'Markdown', reply_markup: keyboard }
          );
        }

        bot.sendMessage(chatId,
          `✅ *Заявка отправлена!*\n\nОжидайте подтверждения администратора.\nМы уведомим вас, как только решение будет принято.`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              keyboard: [['ℹ️ Помощь']],
              resize_keyboard: true,
              persistent: true
            }
          }
        );
        registrationState.delete(chatId);
      }
    };

    if (steps[state.step]) steps[state.step]();
  });
}

module.exports = { register, registrationState };
