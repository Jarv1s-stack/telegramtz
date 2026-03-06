require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const db = require('./database');
const { startReminders } = require('./utils/reminders');

const token = process.env.BOT_TOKEN || '8690013421:AAGeZRKnDcO5GJ4Rfe5A9AgR_GZYWTUw6vE';
const groupId = process.env.GROUP_ID || -1003669989505;

const bot = new TelegramBot(token, { polling: true });

// Делаем groupId глобально доступным
global.groupId = groupId;

// Подключаем обработчики
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

// Запускаем cron-задачи
startReminders(bot);

console.log('Бот успешно запущен!');