require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { startReminders } = require('./utils/reminders');
const db = require('./database');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// ===== ГЛОБАЛЬНЫЕ =====
global.groupId = process.env.GROUP_ID;
global.bot = bot;

// ===== ХЕЛПЕРЫ =====
const isPrivate = (msg) => msg.chat.type === 'private';
const isGroup = (msg) => msg.chat.type === 'group' || msg.chat.type === 'supergroup';

function getUser(telegramId) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
}

// ===== КЛАВИАТУРЫ =====

const guestMenu = {
  reply_markup: {
    keyboard: [
      ['📝 Зарегистрироваться'],
      ['ℹ️ Помощь']
    ],
    resize_keyboard: true,
    persistent: true
  }
};

const masterMenu = {
  reply_markup: {
    keyboard: [
      ['📋 Мой профиль', '📊 Мои заявки'],
      ['⭐ Мой рейтинг', '📅 График'],
      ['ℹ️ Помощь']
    ],
    resize_keyboard: true,
    persistent: true
  }
};

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

function getMenuForUser(user) {
  if (!user || user.status === 'pending') return guestMenu;
  if (user.role === 'admin') return adminMenu;
  if (user.status === 'active') return masterMenu;
  return guestMenu;
}

// ===== ФОРМАТИРОВАНИЕ =====
function formatRequest(req, full = false) {
  const statusEmoji = {
    'NEW': '🆕', 'TAKEN': '🔧', 'WAIT_PAYMENT': '💰',
    'PAID': '✅', 'CANCELLED': '❌', 'REQUEST_CANCEL': '⏸', 'REQUEST_RESCHEDULE': '🔄'
  };
  const statusText = {
    'NEW': 'Новая', 'TAKEN': 'В работе', 'WAIT_PAYMENT': 'Ожидает оплаты',
    'PAID': 'Оплачено', 'CANCELLED': 'Отменена', 'REQUEST_CANCEL': 'Запрос отмены', 'REQUEST_RESCHEDULE': 'Запрос переноса'
  };

  const emoji = statusEmoji[req.status] || '📋';
  const status = statusText[req.status] || req.status;

  let text = `${emoji} *Заявка №${req.id}*\n`;
  text += `├ 🔧 Услуга: ${req.service_type}\n`;
  text += `├ 📍 Район: ${req.district}\n`;
  text += `├ 📅 Дата: ${req.date} в ${req.time}\n`;

  if (full) {
    text += `├ 🏠 Адрес: ${req.address}\n`;
    if (req.wall_material) text += `├ 🧱 Материал: ${req.wall_material}\n`;
    text += `├ 📞 Клиент: ${req.client_phone}\n`;
    if (req.comment && req.comment !== 'нет') text += `├ 💬 Коммент: ${req.comment}\n`;
    text += `├ 💵 Комиссия: ${req.commission} тг\n`;
  }

  text += `└ 📊 Статус: ${status}`;
  return text;
}

function formatMaster(master) {
  const rating = master.rating || 0;
  const stars = '⭐'.repeat(Math.round(rating));
  const starsEmpty = '☆'.repeat(Math.max(0, 5 - Math.round(rating)));
  return `👤 *${master.name}*\n` +
    `├ 📞 ${master.phone || 'не указан'}\n` +
    `├ 🏙 ${master.city || 'не указан'}\n` +
    `├ 🔧 ${master.specialization || 'не указана'}\n` +
    `├ ${stars}${starsEmpty} Рейтинг: ${rating.toFixed(1)}/5\n` +
    `├ ✅ Выполнено: ${master.total_completed}\n` +
    `└ ❌ Отменено: ${master.total_cancelled}`;
}

// ===== КОМАНДЫ =====
bot.setMyCommands([
  { command: '/start', description: '🚀 Запуск / Главное меню' },
  { command: '/profile', description: '📋 Мой профиль' },
  { command: '/myorders', description: '📊 Мои заявки' },
  { command: '/help', description: 'ℹ️ Помощь' }
]);

// ===== СТАРТ =====
bot.onText(/\/start/, (msg) => {
  if (!isPrivate(msg)) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const user = getUser(userId);

  if (!user) {
    return bot.sendMessage(chatId,
      `👋 *Добро пожаловать!*\n\nЭто бот для управления заявками.\n\nДля работы нужно *зарегистрироваться* — ваша анкета уйдёт на проверку администратору.`,
      { parse_mode: 'Markdown', ...guestMenu }
    );
  }
  if (user.status === 'pending') {
    return bot.sendMessage(chatId,
      `⏳ *Заявка на рассмотрении*\n\nАдминистратор ещё не подтвердил вашу регистрацию.`,
      { parse_mode: 'Markdown', ...guestMenu }
    );
  }
  if (user.status === 'blocked') {
    return bot.sendMessage(chatId, `⛔ *Вы заблокированы.*\n\nОбратитесь к администратору.`, { parse_mode: 'Markdown' });
  }

  const menu = getMenuForUser(user);
  const greeting = user.role === 'admin'
    ? `🛡 *Добро пожаловать, Администратор!*\n\nВыберите действие из меню ниже 👇`
    : `👋 *Добро пожаловать, ${user.name}!*\n\n⭐ Рейтинг: ${(user.rating || 0).toFixed(1)}/5  ✅ Выполнено: ${user.total_completed}\n\nВыберите действие 👇`;

  bot.sendMessage(chatId, greeting, { parse_mode: 'Markdown', ...menu });
});

bot.onText(/\/profile/, (msg) => {
  if (!isPrivate(msg)) return;
  handleProfile(msg.chat.id, msg.from.id);
});

bot.onText(/\/myorders/, (msg) => {
  if (!isPrivate(msg)) return;
  const user = getUser(msg.from.id);
  handleMyOrders(msg.chat.id, msg.from.id, user);
});

bot.onText(/\/help/, (msg) => {
  if (!isPrivate(msg)) return;
  const user = getUser(msg.from.id);
  handleHelp(msg.chat.id, user);
});

// ===== ОБРАБОТКА КНОПОК =====
bot.on('message', (msg) => {
  if (!msg.text || !isPrivate(msg)) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  if (text.startsWith('/')) return;

  const user = getUser(userId);

  if (text === '📝 Зарегистрироваться') {
    const { registrationState } = require('./handlers/registration');
    if (user) {
      return bot.sendMessage(chatId,
        user.status === 'pending' ? '⏳ Ваша заявка уже на рассмотрении.' : '✅ Вы уже зарегистрированы!',
        getMenuForUser(user)
      );
    }
    registrationState.set(chatId, { step: 'name', data: {} });
    return bot.sendMessage(chatId,
      `📝 *Регистрация*\n\n*Шаг 1 из 4* — Введите ваше полное имя:`,
      { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } }
    );
  }

  if (text === '📋 Мой профиль') return handleProfile(chatId, userId);
  if (text === '📊 Мои заявки') return handleMyOrders(chatId, userId, user);
  if (text === '⭐ Мой рейтинг') return handleRating(chatId, userId, user);
  if (text === '📅 График') return handleSchedule(chatId, userId, user);
  if (text === '➕ Создать заявку') return handleCreateRequest(chatId, userId, user);
  if (text === '📋 Все заявки') return handleAllRequests(chatId, userId, user);
  if (text === '👥 Мастера') return handleMasters(chatId, userId, user);
  if (text === '🕐 Свободное время') return handleFreeTime(chatId, userId, user);
  if (text === '📊 Статистика') return handleStats(chatId, userId, user);
  if (text === '⚙️ Настройки') return handleSettings(chatId, userId, user);
  if (text === 'ℹ️ Помощь') return handleHelp(chatId, user);
});

// ===== ФУНКЦИИ МАСТЕРА =====
function handleProfile(chatId, userId) {
  const user = getUser(userId);
  if (!user) return bot.sendMessage(chatId, '❌ Вы не зарегистрированы. Нажмите /start');
  const menu = getMenuForUser(user);

  if (user.role === 'admin') {
    const totalRequests = db.prepare('SELECT COUNT(*) as cnt FROM requests').get().cnt;
    const newRequests = db.prepare("SELECT COUNT(*) as cnt FROM requests WHERE status = 'NEW'").get().cnt;
    const activeRequests = db.prepare("SELECT COUNT(*) as cnt FROM requests WHERE status = 'TAKEN'").get().cnt;
    const pendingMasters = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE status = 'pending'").get().cnt;
    return bot.sendMessage(chatId,
      `🛡 *Панель Администратора*\n\n📊 *Статистика:*\n├ 📋 Всего заявок: ${totalRequests}\n├ 🆕 Новых: ${newRequests}\n├ 🔧 В работе: ${activeRequests}\n└ ⏳ Ожидают подтверждения: ${pendingMasters} мастеров`,
      { parse_mode: 'Markdown', ...menu }
    );
  }
  bot.sendMessage(chatId, formatMaster(user), { parse_mode: 'Markdown', ...menu });
}

function handleMyOrders(chatId, userId, user) {
  if (!user) return;
  const menu = getMenuForUser(user);
  const orders = db.prepare(`
    SELECT * FROM requests WHERE master_id = ? AND status NOT IN ('PAID', 'CANCELLED')
    ORDER BY date ASC, time ASC LIMIT 10
  `).all(userId);

  if (orders.length === 0) {
    return bot.sendMessage(chatId,
      `📭 *Активных заявок нет*\n\nСледите за новыми в группе!`,
      { parse_mode: 'Markdown', ...menu }
    );
  }

  bot.sendMessage(chatId, `📊 *Ваши активные заявки (${orders.length}):*`, { parse_mode: 'Markdown', ...menu });

  for (const order of orders) {
    const btns = [];
    if (order.status === 'TAKEN') {
      btns.push([{ text: '✅ Завершить', callback_data: `complete_${order.id}` }, { text: '⏳ Перенос', callback_data: `reqresched_${order.id}` }]);
      btns.push([{ text: '❌ Запросить отказ', callback_data: `reqcancel_${order.id}` }]);
    }
    bot.sendMessage(chatId, formatRequest(order, true), {
      parse_mode: 'Markdown',
      reply_markup: btns.length ? { inline_keyboard: btns } : undefined
    });
  }
}

function handleRating(chatId, userId, user) {
  if (!user) return;
  const menu = getMenuForUser(user);
  const rating = user.rating || 0;
  const stars = '⭐'.repeat(Math.round(rating));
  const starsEmpty = '☆'.repeat(Math.max(0, 5 - Math.round(rating)));
  const total = user.total_completed + user.total_cancelled;

  const topMasters = db.prepare(`
    SELECT name, rating, total_completed FROM users WHERE role = 'master' AND status = 'active'
    ORDER BY rating DESC, total_completed DESC LIMIT 5
  `).all();

  let topText = '\n\n🏆 *Топ мастеров:*\n';
  topMasters.forEach((m, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    const isMe = m.name === user.name ? ' ← вы' : '';
    topText += `${medal} ${m.name} — ${(m.rating || 0).toFixed(1)}⭐ (${m.total_completed} заявок)${isMe}\n`;
  });

  bot.sendMessage(chatId,
    `⭐ *Ваш рейтинг*\n\n${stars}${starsEmpty} *${rating.toFixed(1)}/5.0*\n\n📊 Статистика:\n├ ✅ Выполнено: ${user.total_completed}\n├ ❌ Отменено: ${user.total_cancelled}\n├ 🔄 Переносов: ${user.total_reschedules || 0}\n└ 📋 Всего: ${total}${topText}`,
    { parse_mode: 'Markdown', ...menu }
  );
}

function handleSchedule(chatId, userId, user) {
  if (!user) return;
  const menu = getMenuForUser(user);
  const today = new Date().toISOString().split('T')[0];
  const orders = db.prepare(`
    SELECT * FROM requests WHERE master_id = ? AND date >= ? AND status IN ('TAKEN', 'REQUEST_RESCHEDULE', 'REQUEST_CANCEL')
    ORDER BY date ASC, time ASC LIMIT 10
  `).all(userId, today);

  if (orders.length === 0) {
    return bot.sendMessage(chatId, `📅 *График пуст*\n\nНа ближайшие дни заявок нет.`, { parse_mode: 'Markdown', ...menu });
  }

  let text = `📅 *Ваш график:*\n`;
  let currentDate = '';
  for (const order of orders) {
    if (order.date !== currentDate) {
      currentDate = order.date;
      const d = new Date(order.date);
      const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
      text += `\n📆 *${order.date}* (${days[d.getDay()]})\n`;
    }
    const e = { 'TAKEN': '🔧', 'REQUEST_RESCHEDULE': '🔄', 'REQUEST_CANCEL': '⏸' };
    text += `  ${e[order.status] || '📋'} ${order.time} — ${order.service_type} (${order.district})\n`;
  }
  bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...menu });
}

// ===== ФУНКЦИИ АДМИНИСТРАТОРА =====
function handleCreateRequest(chatId, userId, user) {
  if (!user || user.role !== 'admin') return;
  const { createRequestState } = require('./handlers/admin');

  createRequestState.set(chatId, { step: 'service', data: { created_by: userId } });
  bot.sendMessage(chatId,
    `🆕 *Создание заявки*\n\n*Шаг 1 из 7 — Тип услуги:*`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '❄️ Установка', callback_data: 'svc_установка' }, { text: '🔧 Ремонт', callback_data: 'svc_ремонт' }],
          [{ text: '🌡️ Заправка', callback_data: 'svc_заправка' }, { text: '🧹 Чистка', callback_data: 'svc_чистка' }]
        ]
      }
    }
  );
}

function handleAllRequests(chatId, userId, user) {
  if (!user || user.role !== 'admin') return;
  bot.sendMessage(chatId, `📋 *Заявки — выберите фильтр:*`, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🆕 Новые', callback_data: 'admin_list_NEW' }, { text: '🔧 В работе', callback_data: 'admin_list_TAKEN' }],
        [{ text: '💰 Ожид. оплаты', callback_data: 'admin_list_WAIT_PAYMENT' }, { text: '✅ Оплаченные', callback_data: 'admin_list_PAID' }],
        [{ text: '📋 Все активные', callback_data: 'admin_list_ALL' }]
      ]
    }
  });
}

function handleMasters(chatId, userId, user) {
  if (!user || user.role !== 'admin') return;
  bot.sendMessage(chatId, `👥 *Мастера — выберите фильтр:*`, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ Активные', callback_data: 'masters_active' }, { text: '⏳ На подтверждении', callback_data: 'masters_pending' }],
        [{ text: '🚫 Заблокированные', callback_data: 'masters_blocked' }]
      ]
    }
  });
}

function handleFreeTime(chatId, userId, user) {
  if (!user || user.role !== 'admin') return;
  const { createRequestState } = require('./handlers/admin');
  createRequestState.set(chatId, { step: 'free_date', data: {} });
  bot.sendMessage(chatId,
    `🕐 *Проверка свободного времени*\n\nВведите дату (*ГГГГ-ММ-ДД*):`,
    { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } }
  );
}

function handleStats(chatId, userId, user) {
  if (!user || user.role !== 'admin') return;
  const menu = getMenuForUser(user);
  const total = db.prepare('SELECT COUNT(*) as cnt FROM requests').get().cnt;
  const paid = db.prepare("SELECT COUNT(*) as cnt FROM requests WHERE status = 'PAID'").get().cnt;
  const cancelled = db.prepare("SELECT COUNT(*) as cnt FROM requests WHERE status = 'CANCELLED'").get().cnt;
  const waitPayment = db.prepare("SELECT COUNT(*) as cnt FROM requests WHERE status = 'WAIT_PAYMENT'").get().cnt;
  const active = db.prepare("SELECT COUNT(*) as cnt FROM requests WHERE status = 'TAKEN'").get().cnt;
  const newReqs = db.prepare("SELECT COUNT(*) as cnt FROM requests WHERE status = 'NEW'").get().cnt;
  const totalMasters = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'master' AND status = 'active'").get().cnt;
  const totalCommission = db.prepare("SELECT SUM(commission) as sum FROM requests WHERE status = 'PAID'").get().sum || 0;

  bot.sendMessage(chatId,
    `📊 *Общая статистика*\n\n📋 *Заявки:*\n├ 🆕 Новые: ${newReqs}\n├ 🔧 В работе: ${active}\n├ 💰 Ожид. оплаты: ${waitPayment}\n├ ✅ Оплачено: ${paid}\n├ ❌ Отменено: ${cancelled}\n└ 📋 Всего: ${total}\n\n👥 *Мастера:* ${totalMasters} активных\n💵 *Комиссий получено:* ${totalCommission.toLocaleString()} тг`,
    { parse_mode: 'Markdown', ...menu }
  );
}

function handleSettings(chatId, userId, user) {
  if (!user || user.role !== 'admin') return;
  bot.sendMessage(chatId, `⚙️ *Настройки*\n\nГруппа: \`${process.env.GROUP_ID || 'не задана'}\``, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔑 Сменить пароль', callback_data: 'settings_password' }],
        [{ text: '🔄 Перезапустить бота', callback_data: 'settings_restart' }]
      ]
    }
  });
}

function handleHelp(chatId, user) {
  const menu = getMenuForUser(user);
  let text;
  if (!user || user.status === 'pending') {
    text = `ℹ️ *Помощь*\n\nНажмите *📝 Зарегистрироваться* и заполните анкету.\nПосле одобрения администратором вы сможете брать заявки в группе.`;
  } else if (user.role === 'admin') {
    text = `ℹ️ *Помощь — Администратор*\n\n➕ *Создать заявку* — публикует новую заявку в группу\n📋 *Все заявки* — просмотр по статусам\n👥 *Мастера* — управление мастерами\n🕐 *Свободное время* — кто доступен\n📊 *Статистика* — общая сводка\n\nВход в admin: /admin <пароль>`;
  } else {
    text = `ℹ️ *Помощь — Мастер*\n\n📋 *Мой профиль* — ваши данные и контакты\n📊 *Мои заявки* — активные заявки с кнопками\n⭐ *Мой рейтинг* — статистика и топ мастеров\n📅 *График* — расписание на ближайшие дни\n\n💡 Новые заявки появляются в группе — нажмите *✅ Забрать*.`;
  }
  bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...menu });
}

// ===== CALLBACKS ДЛЯ НОВЫХ КНОПОК =====
bot.on('callback_query', (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  // Выбор типа услуги
  if (data.startsWith('svc_')) {
    const { createRequestState } = require('./handlers/admin');
    const state = createRequestState.get(chatId);
    if (!state || state.step !== 'service') return bot.answerCallbackQuery(query.id);
    const service = data.replace('svc_', '');
    state.data.service_type = service;
    state.step = 'address';
    createRequestState.set(chatId, state);
    bot.editMessageText(
      `🆕 *Создание заявки*\n\n✅ Услуга: *${service}*\n\n*Шаг 2 из 7 — Введите полный адрес:*`,
      { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }
    );
    return bot.answerCallbackQuery(query.id);
  }

  // Список заявок по статусу
  if (data.startsWith('admin_list_')) {
    const user = getUser(userId);
    if (!user || user.role !== 'admin') return bot.answerCallbackQuery(query.id, { text: '❌ Нет доступа' });
    const status = data.replace('admin_list_', '');
    let requests;
    if (status === 'ALL') {
      requests = db.prepare("SELECT * FROM requests WHERE status NOT IN ('PAID','CANCELLED') ORDER BY date ASC LIMIT 10").all();
    } else {
      requests = db.prepare("SELECT * FROM requests WHERE status = ? ORDER BY date ASC LIMIT 10").all(status);
    }
    bot.answerCallbackQuery(query.id);
    if (requests.length === 0) return bot.sendMessage(chatId, '📭 Заявок не найдено.');
    for (const req of requests) {
      let masterName = 'Не назначен';
      if (req.master_id) {
        const m = db.prepare('SELECT name FROM users WHERE telegram_id = ?').get(req.master_id);
        masterName = m ? m.name : 'Неизвестен';
      }
      bot.sendMessage(chatId,
        formatRequest(req) + `\n└ 👤 Мастер: ${masterName}`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔍 Подробнее', callback_data: `view_full_${req.id}` }]] }
        }
      );
    }
    return;
  }

  // Полная информация о заявке
  if (data.startsWith('view_full_')) {
    const reqId = data.replace('view_full_', '');
    const req = db.prepare('SELECT * FROM requests WHERE id = ?').get(reqId);
    if (!req) return bot.answerCallbackQuery(query.id, { text: '❌ Не найдено' });
    let masterName = 'Не назначен';
    if (req.master_id) {
      const m = db.prepare('SELECT name FROM users WHERE telegram_id = ?').get(req.master_id);
      masterName = m ? m.name : 'Неизвестен';
    }
    bot.answerCallbackQuery(query.id);
    return bot.sendMessage(chatId,
      formatRequest(req, true) + `\n└ 👤 Мастер: ${masterName}`,
      { parse_mode: 'Markdown' }
    );
  }

  // Список мастеров по статусу
  if (data.startsWith('masters_')) {
    const user = getUser(userId);
    if (!user || user.role !== 'admin') return bot.answerCallbackQuery(query.id, { text: '❌ Нет доступа' });
    const status = data.replace('masters_', '');
    const masters = db.prepare("SELECT * FROM users WHERE role = 'master' AND status = ? ORDER BY rating DESC").all(status);
    bot.answerCallbackQuery(query.id);
    if (masters.length === 0) return bot.sendMessage(chatId, '📭 Мастеров нет.');

    for (const master of masters) {
      let btns = [];
      if (status === 'pending') btns = [[{ text: '✅ Одобрить', callback_data: `approve_${master.telegram_id}` }, { text: '❌ Отклонить', callback_data: `reject_${master.telegram_id}` }]];
      else if (status === 'active') btns = [[{ text: '🚫 Заблокировать', callback_data: `block_${master.telegram_id}` }]];
      else btns = [[{ text: '✅ Разблокировать', callback_data: `unblock_${master.telegram_id}` }]];

      bot.sendMessage(chatId, formatMaster(master), {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: btns }
      });
    }
    return;
  }

  // Разблокировка
  if (data.startsWith('unblock_')) {
    const user = getUser(userId);
    if (!user || user.role !== 'admin') return bot.answerCallbackQuery(query.id, { text: '❌' });
    const masterId = data.split('_')[1];
    db.prepare('UPDATE users SET status = ? WHERE telegram_id = ?').run('active', masterId);
    bot.sendMessage(masterId, '✅ Вы разблокированы! Снова можете брать заявки.');
    bot.editMessageText(query.message.text + '\n\n✅ Разблокирован.', {
      chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown'
    });
    return bot.answerCallbackQuery(query.id, { text: 'Разблокировано' });
  }

  // Настройки
  if (data === 'settings_restart') {
    const user = getUser(userId);
    if (!user || user.role !== 'admin') return bot.answerCallbackQuery(query.id);
    bot.answerCallbackQuery(query.id, { text: '🔄 Перезапуск не поддерживается через бота.' });
  }
});

// ===== ХЕНДЛЕРЫ =====
const registration = require('./handlers/registration');
const admin = require('./handlers/admin');
const master = require('./handlers/master');
const group = require('./handlers/group');
const callbacks = require('./handlers/callbacks');

registration.register(bot);
admin.register(bot);
master.register(bot);
group.register(bot);
callbacks.register(bot);

// ===== CRON =====
startReminders(bot);

console.log('✅ Бот запущен — улучшенный интерфейс готов!');
