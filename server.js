const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use('/asura', express.static('asura'));
app.use(express.static('public'));

/* ─── 10 Characters ─── */
const FAMILY = [
  { id: 0, name: 'Dronacharya',  avatar: '/avatars/1.png',  weapon: '/weapons/1.png',  weaponName: 'Staff',       dmg: 10 },
  { id: 1, name: 'Shakti',       avatar: '/avatars/2.png',  weapon: '/weapons/2.png',  weaponName: 'Crossbow',    dmg: 18 },
  { id: 2, name: 'Bheem',        avatar: '/avatars/3.png',  weapon: '/weapons/3.png',  weaponName: 'War Hammer',  dmg: 24 },
  { id: 3, name: 'Durga',        avatar: '/avatars/4.png',  weapon: '/weapons/4.png',  weaponName: 'Sword',       dmg: 20 },
  { id: 4, name: 'Arjun',        avatar: '/avatars/5.png',  weapon: '/weapons/5.png',  weaponName: 'Gun',         dmg: 25 },
  { id: 5, name: 'Meera',        avatar: '/avatars/6.png',  weapon: '/weapons/6.png',  weaponName: 'Bow & Arrow', dmg: 16 },
  { id: 6, name: 'Chintu',       avatar: '/avatars/7.png',  weapon: '/weapons/7.png',  weaponName: 'Slingshot',   dmg: 8 },
  { id: 7, name: 'Veer',         avatar: '/avatars/8.png',  weapon: '/weapons/8.png',  weaponName: 'Battle Axe',  dmg: 22 },
  { id: 8, name: 'Agni',         avatar: '/avatars/9.png',  weapon: '/weapons/9.png',  weaponName: 'Spear',       dmg: 20 },
  { id: 9, name: 'Rudra',        avatar: '/avatars/10.png', weapon: '/weapons/10.png', weaponName: 'Trident',     dmg: 18 },
];

const MAX_HP = 300;

/* ─── Lobby ─── */
const lobby = {
  players: {},
  nextNum: 1,
  timerSec: 120,
  timerInt: null,
  status: 'waiting',
};

/* ─── Game ─── */
const game = {
  fighterIds: [],
  fighters: {},
  spectators: [],
  hitIds: new Set(),
  startedAt: null,
  status: 'idle', // idle | playing | finished
};

function lobbyList() {
  return Object.values(lobby.players).sort((a, b) => a.num - b.num);
}

function pubLobby() {
  return { players: lobbyList(), timerSec: lobby.timerSec, status: lobby.status, count: Object.keys(lobby.players).length };
}

/* ─── Timer ─── */
function startTimer() {
  if (lobby.timerInt) clearInterval(lobby.timerInt);
  lobby.timerSec = 120;
  lobby.status = 'waiting';
  lobby.timerInt = setInterval(() => {
    lobby.timerSec--;
    io.emit('timerTick', lobby.timerSec);
    if (lobby.timerSec <= 0) { clearInterval(lobby.timerInt); lobby.timerInt = null; tryStart(); }
  }, 1000);
}

function resetTimer() {
  lobby.timerSec = 120;
  if (!lobby.timerInt) startTimer();
}

/* ─── Start Game ─── */
function tryStart() {
  const ids = Object.keys(lobby.players);
  if (ids.length < 2) { io.emit('lobbyMsg', 'Need 2+ players. Timer reset.'); resetTimer(); return; }

  const [a, b] = [...ids].sort(() => Math.random() - 0.5);
  const c1 = characterForPlayer(lobby.players[a].num);
  const c2 = characterForPlayer(lobby.players[b].num);

  game.fighters = {};
  game.fighters[a] = { id: a, username: lobby.players[a].username, num: lobby.players[a].num, char: c1, hp: MAX_HP, maxHp: MAX_HP };
  game.fighters[b] = { id: b, username: lobby.players[b].username, num: lobby.players[b].num, char: c2, hp: MAX_HP, maxHp: MAX_HP };
  game.fighterIds = [a, b];
  game.spectators = ids.filter(x => x !== a && x !== b);
  game.hitIds = new Set();
  game.startedAt = Date.now();
  game.status = 'playing';

  lobby.status = 'playing';
  if (lobby.timerInt) { clearInterval(lobby.timerInt); lobby.timerInt = null; }

  io.emit('gameStart', pubGame());
}

function pubGame() {
  return { fighters: game.fighters, fighterIds: game.fighterIds, status: game.status, startedAt: game.startedAt };
}

function characterForPlayer(num) {
  const index = ((num - 1) % FAMILY.length + FAMILY.length) % FAMILY.length;
  const base = FAMILY[index];
  return { ...base, assetIndex: index + 1 };
}

function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function damageForMove(baseDmg, move) {
  const multipliers = {
    normal: 1,
    double: 1.3,
    power: 1.8,
    split: 1.05,
    spread: 1.15,
    heavy: 1.6,
    rapid: 0.7,
    pierce: 1.4,
  };
  return Math.max(1, Math.round(baseDmg * (multipliers[move] || 1)));
}

function handleGameOver(winnerId) {
  game.status = 'finished';
  const winner = game.fighters[winnerId] || null;
  io.emit('gameOver', { ...pubGame(), winner });

  setTimeout(() => {
    game.status = 'idle'; game.fighters = {}; game.fighterIds = []; game.spectators = []; game.hitIds = new Set(); game.startedAt = null;
    if (Object.keys(lobby.players).length >= 2) {
      lobby.status = 'waiting';
      let cd = 5;
      io.emit('nextCountdown', cd);
      const iv = setInterval(() => { cd--; io.emit('nextCountdown', cd); if (cd <= 0) { clearInterval(iv); tryStart(); } }, 1000);
    } else { lobby.status = 'waiting'; io.emit('lobbyUpdate', pubLobby()); resetTimer(); }
  }, 6000);
}

/* ─── Sockets ─── */
io.on('connection', (socket) => {

  socket.on('joinLobby', ({ username }, cb) => {
    if (!username || !username.trim()) return cb({ ok: false, msg: 'Enter a name.' });
    const name = username.trim().slice(0, 12);
    const num = lobby.nextNum++;
    lobby.players[socket.id] = { id: socket.id, username: name, num };
    if (Object.keys(lobby.players).length === 1 && !lobby.timerInt) startTimer();
    cb({ ok: true, num });
    io.emit('lobbyUpdate', pubLobby());
    if (game.status === 'playing') { game.spectators.push(socket.id); socket.emit('gameStart', pubGame()); }
  });

  socket.on('forceStart', () => {
    if (lobby.status === 'playing') return;
    if (lobby.timerInt) { clearInterval(lobby.timerInt); lobby.timerInt = null; }
    tryStart();
  });

  /* ─── Real-Time Combat Events ─── */

  // Player fires an arrow from a lane
  socket.on('fire', (payload = {}) => {
    if (game.status !== 'playing' || !game.fighters[socket.id]) return;
    const me = game.fighters[socket.id];
    const opId = game.fighterIds.find(x => x !== socket.id);
    const lane = Math.round(clampNum(payload.lane, 0, 4, 0));
    const move = typeof payload.move === 'string' ? payload.move.slice(0, 20) : (payload.power ? 'power' : 'normal');
    const shotId = typeof payload.shotId === 'string' ? payload.shotId.slice(0, 80) : `${socket.id}:${Date.now()}:${Math.random()}`;
    const shot = {
      fromId: socket.id,
      lane,
      dmg: damageForMove(me.char.dmg, move),
      move,
      big: !!payload.big || move === 'power' || move === 'heavy',
      shotId,
      speed: clampNum(payload.speed, 220, 760, 420),
      offset: clampNum(payload.offset, -70, 70, 0),
      vx: clampNum(payload.vx, -160, 160, 0),
      scale: clampNum(payload.scale, 0.6, 2.8, 1),
    };
    // Relay to opponent: an enemy arrow appears on their screen
    if (opId) io.to(opId).emit('enemyFire', shot);
    // Also relay to spectators so they see the action
    game.spectators.forEach(sid => io.to(sid).emit('specFire', shot));
  });

  // Player reports taking damage (enemy arrow hit their zone)
  socket.on('takeDamage', ({ dmg, hitId } = {}) => {
    if (game.status !== 'playing' || !game.fighters[socket.id]) return;
    const id = typeof hitId === 'string' ? hitId.slice(0, 80) : `${socket.id}:${Date.now()}:${Math.random()}`;
    if (game.hitIds.has(id)) return;
    game.hitIds.add(id);
    const me = game.fighters[socket.id];
    const safeDmg = clampNum(dmg, 1, 120, 1);
    me.hp = Math.max(0, me.hp - safeDmg);
    io.emit('hpUpdate', { id: socket.id, hp: me.hp, maxHp: me.maxHp });
    if (me.hp <= 0) {
      const winnerId = game.fighterIds.find(x => x !== socket.id);
      handleGameOver(winnerId);
    }
  });

  // Player reports hitting their opponent (ally arrow hit opponent avatar)
  socket.on('hitOpponent', ({ dmg, hitId } = {}) => {
    if (game.status !== 'playing' || !game.fighters[socket.id]) return;
    const id = typeof hitId === 'string' ? hitId.slice(0, 80) : `${socket.id}:hit:${Date.now()}:${Math.random()}`;
    if (game.hitIds.has(id)) return;
    game.hitIds.add(id);
    const opId = game.fighterIds.find(x => x !== socket.id);
    if (!opId || !game.fighters[opId]) return;
    const opponent = game.fighters[opId];
    const safeDmg = clampNum(dmg, 1, 120, 1);
    opponent.hp = Math.max(0, opponent.hp - safeDmg);
    io.emit('hpUpdate', { id: opId, hp: opponent.hp, maxHp: opponent.maxHp });
    if (opponent.hp <= 0) {
      handleGameOver(socket.id);
    }
  });

  socket.on('disconnect', () => {
    delete lobby.players[socket.id];
    if (game.fighters[socket.id] && game.status === 'playing') {
      const winnerId = game.fighterIds.find(x => x !== socket.id);
      handleGameOver(winnerId);
      return;
    }
    game.spectators = game.spectators.filter(x => x !== socket.id);
    io.emit('lobbyUpdate', pubLobby());
  });
});

const PORT = process.env.PORT || 8080;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.error('Port ' + PORT + ' in use.'); process.exit(1); }
  throw e;
});
server.listen(PORT, '0.0.0.0', () => console.log('ADI - FG : AI Developer India Family Game running at http://localhost:' + PORT));
