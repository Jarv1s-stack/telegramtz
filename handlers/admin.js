const db = require('../database');
const { registrationState } = require('./registration'); // для доступа к состояниям (не обязательно)

// Состояния для создания заявки
const createRequestState = new Map();

function register(bot) {
  // Аутентификация администратора по паролю
  bot.onText(/\/admin (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const password = match[1];

    const stored = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_password');
    if (password === stored.value) {
      const existing = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId);
      if (existing) {
        db.prepare('UPDATE users SET role = ? WHERE telegram_id = ?').run('admin', userId);
      } else {
        db.prepare('INSERT INTO users (telegram_id, role, name) VALUES (?, ?, ?)').run(userId, 'admin', 'Admin');
      }
      bot.sendMessage(chatId, '✅ Вы стали администратором!');
    } else {
      bot.sendMessage(chatId, '❌ Неверный пароль.');
    }
  });

  // Команда создания заявки
  bot.onText(/\/create/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const user = db.prepare('SELECT role FROM users WHERE telegram_id = ?').get(userId);
    if (!user || user.role !== 'admin') {
      return bot.sendMessage(chatId, '❌ Только администратор может создавать заявки.');
    }

    createRequestState.set(chatId, { step: 'service', data: { created_by: userId } });
    bot.sendMessage(chatId, '🆕 Создание новой заявки.\nВведите тип услуги (установка/ремонт/заправка/чистка):');
  });

  // Обработка шагов создания заявки
  bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const state = createRequestState.get(chatId);
    if (!state) return;

    const text = msg.text;
    const data = state.data;

    const steps = {
      service: () => {
        data.service_type = text;
        state.step = 'address';
        bot.sendMessage(chatId, 'Введите полный адрес:');
      },
      address: () => {
        data.address = text;
        state.step = 'district';
        bot.sendMessage(chatId, 'Введите район:');
      },
      district: () => {
        data.district = text;
        state.step = 'date';
        bot.sendMessage(chatId, 'Введите дату (ГГГГ-ММ-ДД):');
      },
      date: () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
          return bot.sendMessage(chatId, '❌ Неверный формат. Используйте ГГГГ-ММ-ДД');
        }
        data.date = text;
        state.step = 'time';
        bot.sendMessage(chatId, 'Введите время (ЧЧ:ММ):');
      },
time: () => {
  if (!/^\d{2}:\d{2}$/.test(text)) {
    return bot.sendMessage(chatId, '❌ Неверный формат. Используйте ЧЧ:ММ');
  }
  data.time = text;
  state.step = 'phone';  // ← сразу переходим к телефону
  bot.sendMessage(chatId, 'Телефон клиента:');
},
phone: () => {
  data.client_phone = text;
  state.step = 'comment';
  bot.sendMessage(chatId, 'Комментарий:');
},
comment: () => {
  data.comment = text;
  state.step = 'commission';
  bot.sendMessage(chatId, 'Размер комиссии (в тенге):');
},
commission: () => {
  const commission = parseInt(text);
  if (isNaN(commission)) {
    return bot.sendMessage(chatId, '❌ Введите число.');
  }
  data.commission = commission;

  // Сохраняем заявку в БД (без wall_material)
  const insert = db.prepare(`
    INSERT INTO requests
      (service_type, address, district, date, time, client_phone, comment, commission, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = insert.run(
    data.service_type, data.address, data.district, data.date, data.time,
    data.client_phone, data.comment, data.commission, 'NEW', data.created_by
  );
  const requestId = result.lastInsertRowid;

  // Отправляем в группу (без материала стены)
  const groupId = global.groupId;
  const groupMessage = `🆕 Заявка №${requestId}
Услуга: ${data.service_type}
Район: ${data.district}
Дата: ${data.date} ${data.time}`; // строка о материале стены удалена

  const keyboard = {
    inline_keyboard: [
      [{ text: '✅ Забрать', callback_data: `take_${requestId}` }]
    ]
  };
  bot.sendMessage(groupId, groupMessage, { reply_markup: keyboard });

  bot.sendMessage(chatId, `✅ Заявка №${requestId} создана и опубликована в группе.`);
  createRequestState.delete(chatId);
}
    };

    if (steps[state.step]) steps[state.step]();
  });

  // Команда /free для просмотра свободного времени (упрощённо)
  bot.onText(/\/free/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const user = db.prepare('SELECT role FROM users WHERE telegram_id = ?').get(userId);
    if (!user || user.role !== 'admin') return;

    // Запрашиваем дату
    createRequestState.set(chatId, { step: 'free_date' }); // переиспользуем временное хранилище
    bot.sendMessage(chatId, 'Введите дату для проверки (ГГГГ-ММ-ДД):');
  });

  // Продолжение /free
  bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const state = createRequestState.get(chatId);
    if (!state || state.step !== 'free_date') return;

    const date = msg.text;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return bot.sendMessage(chatId, '❌ Неверный формат. Используйте ГГГГ-ММ-ДД');
    }

    // Запрашиваем время
    state.step = 'free_time';
    state.data = { date };
    bot.sendMessage(chatId, 'Введите время (ЧЧ:ММ):');
  });

  bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const state = createRequestState.get(chatId);
    if (!state || state.step !== 'free_time') return;

    const time = msg.text;
    if (!/^\d{2}:\d{2}$/.test(time)) {
      return bot.sendMessage(chatId, '❌ Неверный формат. Используйте ЧЧ:ММ');
    }

    const date = state.data.date;
    // Получаем всех активных мастеров
    const masters = db.prepare('SELECT telegram_id, name, rating FROM users WHERE role = ? AND status = ?').all('master', 'active');

    let response = `📅 Свободные мастера на ${date} ${time}:\n\n`;
    for (const master of masters) {
      const dailyCount = db.prepare(`
        SELECT COUNT(*) as cnt FROM requests
        WHERE master_id = ? AND date = ? AND status NOT IN ('PAID', 'CANCELLED')
      `).get(master.telegram_id, date).cnt;

      // Проверка на пересечение времени
      const conflict = db.prepare(`
        SELECT id FROM requests
        WHERE master_id = ? AND date = ? AND status NOT IN ('PAID', 'CANCELLED')
      `).all(master.telegram_id, date).some(req => {
        const reqStart = new Date(`${req.date}T${req.time}:00`);
        const reqEnd = new Date(reqStart.getTime() + 60 * 60 * 1000);
        const targetStart = new Date(`${date}T${time}:00`);
        const targetEnd = new Date(targetStart.getTime() + 60 * 60 * 1000);
        return targetStart < reqEnd && targetEnd > reqStart;
      });

      const status = conflict ? '❌ Занят' : '✅ Свободен';
      const rating = master.rating ? master.rating.toFixed(1) : '0.0';
      response += `${master.name} (рейтинг: ${rating}) ...`;
    }

    bot.sendMessage(chatId, response);
    createRequestState.delete(chatId);
  });
}

module.exports = { register, createRequestState };