require('dotenv').config();
const TelegramBot=require('node-telegram-bot-api');
const{startReminders}=require('./utils/reminders');

const bot=new TelegramBot(process.env.BOT_TOKEN,{polling:true});

// ===== ПРОВЕРКА ЧАТА =====
const isPrivate=(msg)=>msg.chat.type==='private';

// ===== ГЛАВНОЕ МЕНЮ (ВСЕГДА У ИНПУТА) =====
const mainMenu={
reply_markup:{
keyboard:[
['📋 Профиль','📅 Записи'],
['➕ Записаться','❌ Отмена'],
['⚙️ Настройки','ℹ️ Помощь']
],
resize_keyboard:true,
persistent:true
}
};

// ===== КОМАНДЫ В МЕНЮ "/" =====
bot.setMyCommands([
{command:'/start',description:'🚀 Запуск'},
{command:'/menu',description:'📲 Меню'},
{command:'/profile',description:'📋 Профиль'},
{command:'/help',description:'ℹ️ Помощь'}
]);

// ===== СТАРТ =====
bot.onText(/\/start/,msg=>{
if(!isPrivate(msg))return;

bot.sendMessage(msg.chat.id,
'👋 Добро пожаловать\n\n🔥 У тебя теперь нормальный интерфейс',
mainMenu);
});

// ===== МЕНЮ =====
bot.onText(/\/menu/,msg=>{
if(!isPrivate(msg))return;
bot.sendMessage(msg.chat.id,'📲 Главное меню',mainMenu);
});

// ===== ПРОФИЛЬ =====
bot.onText(/\/profile/,msg=>{
bot.sendMessage(msg.chat.id,
`👤 Профиль\n\nID: ${msg.from.id}\nИмя: ${msg.from.first_name || ''}\n@${msg.from.username || 'нет'}`,
mainMenu);
});

// ===== HELP =====
bot.onText(/\/help/,msg=>{
bot.sendMessage(msg.chat.id,
'ℹ️ Используй кнопки снизу\n\nЭто быстрее чем команды',
mainMenu);
});

// ===== КНОПКИ =====
bot.on('message',msg=>{
if(!msg.text)return;
if(!isPrivate(msg))return;

const chatId=msg.chat.id;
const text=msg.text;

// ПРОФИЛЬ
if(text==='📋 Профиль'){
return bot.sendMessage(chatId,
`👤 Профиль\n\nID: ${msg.from.id}\nИмя: ${msg.from.first_name || ''}`,
mainMenu);
}

// ЗАПИСИ
if(text==='📅 Записи'){
return bot.sendMessage(chatId,
'📅 У тебя пока нет записей',
mainMenu);
}

// ЗАПИСАТЬСЯ
if(text==='➕ Записаться'){
return bot.sendMessage(chatId,
'📝 Введи дату:\nНапример: 25.03 18:00',
mainMenu);
}

// ОТМЕНА
if(text==='❌ Отмена'){
return bot.sendMessage(chatId,
'❌ Введи ID записи',
mainMenu);
}

// НАСТРОЙКИ
if(text==='⚙️ Настройки'){
return bot.sendMessage(chatId,
'⚙️ Настройки (скоро)',
mainMenu);
}

// ПОМОЩЬ
if(text==='ℹ️ Помощь'){
return bot.sendMessage(chatId,
'ℹ️ Просто жми кнопки снизу 👇',
mainMenu);
}
});

// ===== ХЕНДЛЕРЫ =====
const registration=require('./handlers/registration');
const admin=require('./handlers/admin');
const master=require('./handlers/master');
const group=require('./handlers/group');
const callbacks=require('./handlers/callbacks');

registration.register(bot);
admin.register(bot);
master.register(bot);
group.register(bot);
callbacks.register(bot);

// ===== CRON =====
startReminders(bot);

console.log('✅ UI готов (кнопки у инпута + команды)');