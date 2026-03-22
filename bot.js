require('dotenv').config();
const TelegramBot=require('node-telegram-bot-api');
const db=require('./database');
const{startReminders}=require('./utils/reminders');

const token = process.env.BOT_TOKEN || '8690013421:AAGeZRKnDcO5GJ4Rfe5A9AgR_GZYWTUw6vE';
const groupId = process.env.GROUP_ID || -1003669989505;

const bot=new TelegramBot(token,{polling:true});
global.groupId=groupId;

// ===== ПРОВЕРКА ЧАТА =====
const isPrivate=(msg)=>msg.chat.type==='private';

// ===== МЕНЮ =====
const mainMenu={
reply_markup:{
keyboard:[
['📋 Профиль','📅 Мои записи'],
['➕ Записаться','❌ Отменить'],
['⚙️ Настройки','ℹ️ Помощь']
],
resize_keyboard:true
}
};

const backMenu={
reply_markup:{
keyboard:[
['⬅️ Назад']
],
resize_keyboard:true
}
};

// ===== СТАРТ =====
bot.onText(/\/start/,(msg)=>{
if(!isPrivate(msg))return;

bot.sendMessage(msg.chat.id,
'👋 Добро пожаловать!\n https://t.me/+K7ExNKp7UUs5MDYy\n\n\nВыбирай 👇',
mainMenu);
});

// ===== MENU =====
bot.onText(/\/menu/,(msg)=>{
if(!isPrivate(msg))return;
bot.sendMessage(msg.chat.id,'📲 Главное меню',mainMenu);
});

// ===== HELP =====
bot.onText(/\/help/,(msg)=>{
bot.sendMessage(msg.chat.id,
'📖 Команды:\n\n'+
'/start — запуск\n'+
'/menu — меню\n'+
'/help — помощь\n\n'+
'Или просто жми кнопки 👇'
);
});

// ===== ОБРАБОТКА КНОПОК =====
bot.on('message',async(msg)=>{
if(!msg.text)return;
if(!isPrivate(msg))return;

const chatId=msg.chat.id;
const text=msg.text;

// === НАЗАД ===
if(text==='⬅️ Назад'){
return bot.sendMessage(chatId,'🔙 Главное меню',mainMenu);
}

// === ПРОФИЛЬ ===
if(text==='📋 Профиль'){
return bot.sendMessage(chatId,
'👤 Профиль:\n\n'+
`ID: ${msg.from.id}\n`+
`Имя: ${msg.from.first_name || ''}\n`+
`Username: @${msg.from.username || 'нет'}`
,backMenu);
}

// === МОИ ЗАПИСИ ===
if(text==='📅 Мои записи'){
return bot.sendMessage(chatId,
'📅 Твои записи:\n\nПока пусто 😢',
backMenu);
}

// === ЗАПИСАТЬСЯ ===
if(text==='➕ Записаться'){
return bot.sendMessage(chatId,
'📝 Запись:\n\nНапиши дату в формате:\n👉 25.03 18:00',
backMenu);
}

// === ОТМЕНА ===
if(text==='❌ Отменить'){
return bot.sendMessage(chatId,
'❌ Отмена записи:\n\nНапиши ID записи',
backMenu);
}

// === НАСТРОЙКИ ===
if(text==='⚙️ Настройки'){
return bot.sendMessage(chatId,
'⚙️ Настройки:\n\n(скоро будет)',
backMenu);
}

// === HELP ===
if(text==='ℹ️ Помощь'){
return bot.sendMessage(chatId,
'ℹ️ Просто используй кнопки\n\nЕсли сломается — /start'
);
}

});

// ===== INLINE CALLBACK (если пригодится потом) =====
bot.on('callback_query',(query)=>{
bot.answerCallbackQuery(query.id);
});

// ===== ПОДКЛЮЧЕНИЕ ХЕНДЛЕРОВ =====
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

console.log('🔥 Бот с норм UI запущен');