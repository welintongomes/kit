/*  SERVICE WORKER — Hub Agenda  v4
    Arquivo: sw.js  — mesma pasta que index.html
*/
const VERSION = 'hub-sw-v5';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

/* ════════════════════════════════════════════
   PERSISTÊNCIA — salva eventos no Cache API
   para sobreviver ao restart do SW
════════════════════════════════════════════ */
const CACHE_KEY = 'agenda-events-v1';

async function _saveEvents(events) {
  const cache = await caches.open(CACHE_KEY);
  await cache.put('events', new Response(JSON.stringify(events)));
}

async function _loadEvents() {
  try {
    const cache = await caches.open(CACHE_KEY);
    const res = await cache.match('events');
    if (!res) return [];
    return await res.json();
  } catch (e) { return []; }
}

/* ════════════════════════════════════════════
   CONTROLE DE DISPAROS
   Chave: id + data + minutos — reseta à meia-noite
   Guarda o TIMESTAMP do disparo para não repetir
   na mesma janela, mas permite reeditar/recriar
════════════════════════════════════════════ */
const _fired = new Map();   /* key → timestamp do disparo */

function _firedKey(ev, today) {
  /* inclui título+data+hora no hash: se editar qualquer campo, chave muda */
  return `${ev.id}_${today}_${ev.notifBefore}_${ev.timeStart}_${(ev.title || '').slice(0, 20)}`;
}

function _canFire(key) {
  const last = _fired.get(key);
  if (!last) return true;
  /* permite disparar de novo se passaram mais de 2 minutos
     (evita duplicata no mesmo ciclo, mas permite re-agendamento) */
  return (Date.now() - last) > 120_000;
}

/* ════════════════════════════════════════════
   MENSAGENS DO APP
════════════════════════════════════════════ */
let _events = [];

self.addEventListener('message', async e => {
  if (e.data?.type === 'AGENDA_SYNC') {
    _events = e.data.events || [];
    await _saveEvents(_events);   /* persiste no Cache API */
    _scheduleNext();
  }
  if (e.data?.type === 'TEST_NOTIF') {
    await _show(
      '📅 Hub — Teste',
      'Notificações funcionando! Alertas aparecerão aqui.',
      'test_' + Date.now()   /* tag única → acumula na bandeja */
    );
  }
});

/* ════════════════════════════════════════════
   PERIODIC BACKGROUND SYNC
════════════════════════════════════════════ */
self.addEventListener('periodicsync', async e => {
  if (e.tag === 'agenda-check') {
    /* recarrega eventos persistidos caso SW tenha reiniciado */
    if (!_events.length) _events = await _loadEvents();
    e.waitUntil(_checkAll());
  }
});

/* ════════════════════════════════════════════
   ALARME VIA setTimeout
   Recalcula a cada vez que recebe novos eventos
════════════════════════════════════════════ */
let _alarmTimer = null;

async function _scheduleNext() {
  if (_alarmTimer) { clearTimeout(_alarmTimer); _alarmTimer = null; }

  /* garante que temos eventos mesmo após restart */
  if (!_events.length) _events = await _loadEvents();
  if (!_events.length) return;

  const now = Date.now();
  const today = _dateKey(new Date());
  let nearest = Infinity;

  for (const ev of _events) {
    if (!ev.timeStart || !ev.notifBefore || ev.notifBefore === 'none') continue;
    if (!_occursOn(ev, today)) continue;

    const mins = parseInt(ev.notifBefore) || 0;
    const [h, m] = ev.timeStart.split(':').map(Number);
    const alertMs = new Date().setHours(h, m, 0, 0) - mins * 60_000;
    const diff = alertMs - now;

    if (diff > 0 && diff < nearest) nearest = diff;
  }

  if (nearest < Infinity) {
    _alarmTimer = setTimeout(async () => {
      if (!_events.length) _events = await _loadEvents();
      await _checkAll();
      setTimeout(_scheduleNext, 3000);   /* reagenda para o próximo */
    }, nearest + 1500);
  }
}

/* ════════════════════════════════════════════
   CHECAGEM — dispara notificações vencidas
════════════════════════════════════════════ */
async function _checkAll() {
  if (!_events.length) _events = await _loadEvents();

  const now = new Date();
  const today = _dateKey(now);
  const nowMs = now.getTime();

  for (const ev of _events) {
    if (!ev.timeStart || !ev.notifBefore || ev.notifBefore === 'none') continue;
    if (!_occursOn(ev, today)) continue;

    const mins = parseInt(ev.notifBefore) || 0;
    const [h, m] = ev.timeStart.split(':').map(Number);
    const alertMs = new Date().setHours(h, m, 0, 0) - mins * 60_000;
    const diff = nowMs - alertMs;

    /* janela de 2 minutos após o horário do alerta */
    const key = _firedKey(ev, today);
    if (diff >= 0 && diff < 120_000 && _canFire(key)) {
      _fired.set(key, Date.now());

      const cats = { trabalho: '💼', pessoal: '🙂', saude: '❤️', estudo: '📚', lazer: '🎉', outro: '📌' };
      const icon = cats[ev.cat] || '📌';
      const when = mins > 0 ? `Em ${mins} min` : 'Agora!';
      const body = [when, `⏰ ${ev.timeStart}`, ev.desc].filter(Boolean).join('  ·  ');

      /* tag ÚNICA por evento+data+hora → notificações se ACUMULAM na bandeja */
      const tag = `hub_${ev.id}_${today}_${ev.timeStart.replace(':', '')}`;
      await _show(`${icon} ${ev.title}`, body, tag);
    }
  }
}

/* ════════════════════════════════════════════
   EXIBE NOTIFICAÇÃO
   requireInteraction: true → fica na bandeja
   até o usuário dispensar manualmente
════════════════════════════════════════════ */
async function _show(title, body, tag) {
  try {
    await self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      requireInteraction: true,    /* ← fica na bandeja até dispensar */
      silent: false,
      vibrate: [300, 150, 300, 150, 600],
    });
  } catch (e) { console.warn('SW notif:', e); }
}

/* ════════════════════════════════════════════
   CLIQUE NA NOTIFICAÇÃO → abre o app
════════════════════════════════════════════ */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(cs => {
        const open = cs.find(c => c.url.includes('index.html') || c.url.endsWith('/'));
        return open ? open.focus() : self.clients.openWindow('./');
      })
  );
});

/* ════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════ */
function _dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _occursOn(ev, key) {
  if (ev.date === key) return true;
  if (!ev.repeat || ev.repeat === 'none') return false;
  const base = new Date(ev.date + 'T12:00:00');
  const tgt = new Date(key + 'T12:00:00');
  if (tgt < base) return false;
  if (ev.repeat === 'daily') return true;
  if (ev.repeat === 'weekly') return base.getDay() === tgt.getDay();
  if (ev.repeat === 'monthly') return base.getDate() === tgt.getDate();
  return false;
}