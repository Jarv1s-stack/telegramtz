const db = require('../database');

const createRequestState = new Map();

function register(bot) {
  // Аутентификация администратора
  bot.onText(/\/admin (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const password = match[1];

    const stored = db.prepare("SELECT value FROM settings WHERE key = 'admin_password'").get();
    if (!stored || password !== stored.value) {
      return bot.sendMessage(chatId, '❌ Неверный пароль.');
    }

    const existing = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId);
    if (existing) {
      db.prepare('UPDATE users SET role = ?, status = ? WHERE telegram_id = ?').run('admin', 'active', userId);
    } else {
      db.prepare('INSERT INTO users (telegram_id, role, name, status) VALUES (?, ?, ?, ?)').run(userId, 'admin', 'Admin', 'active');
    }

    const adminMenu = {
      reply_markup: {
        keyboard: [
          ['➕ Создать заявку', '📋 Все заявки'],
          ['👥 Мастера', '🕐 Свободное время'],
          ['📊 Статистика', '⚙️ Настройки'],
          ['ℹ️ Помощь']
        ],
        resize_keyboard: true,
        persistent: true
      }
    };

    bot.sendMessage(chatId, '🛡 *Вы стали администратором!*\n\nТеперь у вас есть доступ к полному меню управления.', {
      parse_mode: 'Markdown',
      ...adminMenu
    });
  });

  // Обработка шагов создания заявки
  bot.on('message', (msg) => {
    if (msg.chat.type !== 'private') return;
    const chatId = msg.chat.id;
    const state = createRequestState.get(chatId);
    if (!state) return;

    const text = msg.text;
    const data = state.data;

    // Пропускаем команды
    if (text && text.startsWith('/')) return;

    const steps = {
      service: () => {
        if (!text) return;
        data.service_type = text;
        state.step = 'address';
        bot.sendMessage(chatId,
          `🆕 *Создание заявки*\n\n✅ Услуга: *${text}*\n\n*Шаг 2 из 7 — Введите полный адрес:*`,
          { parse_mode: 'Markdown' }
        );
      },
      address: () => {
        if (!text) return;
        data.address = text;
        state.step = 'district';
        bot.sendMessage(chatId,
          `🆕 *Создание заявки*\n\n✅ Адрес: *${text}*\n\n*Шаг 3 из 7 — Введите район:*`,
          { parse_mode: 'Markdown' }
        );
      },
      district: () => {
        if (!text) return;
        data.district = text;
        state.step = 'date';
        bot.sendMessage(chatId,
          `🆕 *Создание заявки*\n\n✅ Район: *${text}*\n\n*Шаг 4 из 7 — Введите дату:*\nФормат: ГГГГ-ММ-ДД`,
          { parse_mode: 'Markdown' }
        );
      },
      date: () => {
        if (!text) return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
          return bot.sendMessage(chatId, '❌ Неверный формат. Используйте: *ГГГГ-ММ-ДД*\nНапример: 2025-06-15', { parse_mode: 'Markdown' });
        }
        data.date = text;
        state.step = 'time';
        bot.sendMessage(chatId,
          `🆕 *Создание заявки*\n\n✅ Дата: *${text}*\n\n*Шаг 5 из 7 — Введите время:*\nФормат: ЧЧ:ММ`,
          { parse_mode: 'Markdown' }
        );
      },
      time: () => {
        if (!text) return;
        if (!/^\d{2}:\d{2}$/.test(text)) {
          return bot.sendMessage(chatId, '❌ Неверный формат. Используйте: *ЧЧ:ММ*\nНапример: 14:30', { parse_mode: 'Markdown' });
        }
        data.time = text;
        state.step = 'phone';
        bot.sendMessage(chatId,
          `🆕 *Создание заявки*\n\n✅ Время: *${text}*\n\n*Шаг 6 из 7 — Телефон клиента:*`,
          { parse_mode: 'Markdown' }
        );
      },
      phone: () => {
        if (!text) return;
        data.client_phone = text;
        state.step = 'comment';
        bot.sendMessage(chatId,
          `🆕 *Создание заявки*\n\n✅ Телефон: *${text}*\n\n*Шаг 7 из 7 — Комментарий и комиссия*\n\nВведите комментарий (или напишите "нет"):`,
          { parse_mode: 'Markdown' }
        );
      },
      comment: () => {
        if (!text) return;
        data.comment = text;
        state.step = 'commission';
        bot.sendMessage(chatId,
          `💵 *Размер комиссии в тенге:*\n(только число, например: 5000)`,
          { parse_mode: 'Markdown' }
        );
      },
      commission: () => {
        if (!text) return;
        const commission = parseInt(text);
        if (isNaN(commission) || commission < 0) {
          return bot.sendMessage(chatId, '❌ Введите корректную сумму числом.');
        }
        data.commission = commission;

        // Сохраняем заявку
        const result = db.prepare(`
          INSERT INTO requests (service_type, address, district, date, time, client_phone, comment, commission, status, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?)
        `).run(data.service_type, data.address, data.district, data.date, data.time, data.client_phone, data.comment, data.commission, data.created_by);

        const requestId = result.lastInsertRowid;
        const groupId = global.groupId;

        // Красивое сообщение в группу
        const groupMessage =
          `🆕 *Новая заявка №${requestId}*\n\n` +
          `🔧 Услуга: ${data.service_type}\n` +
          `📍 Район: ${data.district}\n` +
          `📅 Дата: ${data.date} в ${data.time}\n` +
          `💵 Комиссия: ${data.commission} тг`;

        const keyboard = {
          inline_keyboard: [[{ text: '✅ Забрать заявку', callback_data: `take_${requestId}` }]]
        };

        bot.sendMessage(groupId, groupMessage, { parse_mode: 'Markdown', reply_markup: keyboard });

        // Подтверждение администратору
        bot.sendMessage(chatId,
          `✅ *Заявка №${requestId} создана!*\n\nОна опубликована в группе. Мастера уже видят её.`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              keyboard: [
                ['➕ Создать заявку', '📋 Все заявки'],
                ['👥 Мастера', '🕐 Свободное время'],
                ['📊 Статистика', '⚙️ Настройки'],
                ['ℹ️ Помощь']
              ],
              resize_keyboard: true,
              persistent: true
            }
          }
        );
        createRequestState.delete(chatId);
      },

      // Шаги проверки свободного времени
      free_date: () => {
        if (!text) return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
          return bot.sendMessage(chatId, '❌ Неверный формат. Используйте: *ГГГГ-ММ-ДД*', { parse_mode: 'Markdown' });
        }
        state.step = 'free_time';
        state.data = { date: text };
        bot.sendMessage(chatId,
          `✅ Дата: *${text}*\n\nВведите время (*ЧЧ:ММ*):`,
          { parse_mode: 'Markdown' }
        );
      },
      free_time: () => {
        if (!text) return;
        if (!/^\d{2}:\d{2}$/.test(text)) {
          return bot.sendMessage(chatId, '❌ Неверный формат. Используйте: *ЧЧ:ММ*', { parse_mode: 'Markdown' });
        }
        const { date } = state.data;
        const masters = db.prepare("SELECT * FROM users WHERE role = 'master' AND status = 'active'").all();

        let response = `📅 *Доступность на ${date} в ${text}:*\n\n`;

        for (const master of masters) {
          const dailyCount = db.prepare(`
            SELECT COUNT(*) as cnt FROM requests
            WHERE master_id = ? AND date = ? AND status NOT IN ('PAID', 'CANCELLED')
          `).get(master.telegram_id, date).cnt;

          const targetStart = new Date(`${date}T${text}:00`);
          const targetEnd = new Date(targetStart.getTime() + 60 * 60 * 1000);
          const reqs = db.prepare(`
            SELECT time FROM requests WHERE master_id = ? AND date = ? AND status NOT IN ('PAID', 'CANCELLED')
          `).all(master.telegram_id, date);

          const conflict = reqs.some(req => {
            const s = new Date(`${date}T${req.time}:00`);
            const e = new Date(s.getTime() + 60 * 60 * 1000);
            return targetStart < e && targetEnd > s;
          });

          const status = conflict ? '🔴 Занят' : dailyCount >= 4 ? '🟡 Лимит' : '🟢 Свободен';
          const rating = (master.rating || 0).toFixed(1);
          response += `${status} *${master.name}* ⭐${rating} (${dailyCount}/4 заявок)\n`;
        }

        if (masters.length === 0) response += '_Нет активных мастеров_';

        bot.sendMessage(chatId, response, {
          parse_mode: 'Markdown',
          reply_markup: {
            keyboard: [
              ['➕ Создать заявку', '📋 Все заявки'],
              ['👥 Мастера', '🕐 Свободное время'],
              ['📊 Статистика', '⚙️ Настройки'],
              ['ℹ️ Помощь']
            ],
            resize_keyboard: true,
            persistent: true
          }
        });
        createRequestState.delete(chatId);
      }
    };

    if (steps[state.step]) steps[state.step]();
  });
}

module.exports = { register, createRequestState };
