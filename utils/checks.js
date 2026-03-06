const db = require('../database');

// Количество активных заявок мастера на указанную дату
function getMasterDailyCount(masterId, date) {
  const stmt = db.prepare(`
    SELECT COUNT(*) as cnt FROM requests
    WHERE master_id = ? AND date = ? AND status NOT IN ('PAID', 'CANCELLED')
  `);
  return stmt.get(masterId, date).cnt;
}

// Есть ли у мастера неоплаченная заявка
function hasUnpaidRequest(masterId) {
  const stmt = db.prepare('SELECT id FROM requests WHERE master_id = ? AND status = ? LIMIT 1');
  return !!stmt.get(masterId, 'WAIT_PAYMENT');
}

// Есть ли у мастера неподтверждённый перенос или отказ
function hasPendingRescheduleOrCancel(masterId) {
  const stmt = db.prepare(`
    SELECT id FROM requests
    WHERE master_id = ? AND status IN ('REQUEST_RESCHEDULE', 'REQUEST_CANCEL')
    LIMIT 1
  `);
  return !!stmt.get(masterId);
}

// Проверка пересечения времени (заявки длятся 1 час)
function hasTimeConflict(masterId, date, time) {
  const targetStart = new Date(`${date}T${time}:00`);
  const targetEnd = new Date(targetStart.getTime() + 60 * 60 * 1000);

  const requests = db.prepare(`
    SELECT date, time FROM requests
    WHERE master_id = ? AND date = ? AND status NOT IN ('PAID', 'CANCELLED')
  `).all(masterId, date);

  for (const req of requests) {
    const reqStart = new Date(`${req.date}T${req.time}:00`);
    const reqEnd = new Date(reqStart.getTime() + 60 * 60 * 1000);
    if (targetStart < reqEnd && targetEnd > reqStart) return true;
  }
  return false;
}

// Обновление рейтинга мастера (простая формула)
function updateMasterRating(masterId) {
  const master = db.prepare('SELECT total_completed, total_cancelled FROM users WHERE telegram_id = ?').get(masterId);
  if (!master) return;
  const total = master.total_completed + master.total_cancelled;
  const rating = total === 0 ? 0 : (master.total_completed * 5) / total;
  db.prepare('UPDATE users SET rating = ? WHERE telegram_id = ?').run(rating, masterId);
}

module.exports = {
  getMasterDailyCount,
  hasUnpaidRequest,
  hasPendingRescheduleOrCancel,
  hasTimeConflict,
  updateMasterRating
};