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

/* ─── Rooms Architecture ─── */
const rooms = {};

function getRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      id: roomId,
      players: {}, // Maps socket.id -> { id, userId, username, num }
      users: {},   // Maps userId -> { wins, username } (Persistence)
      nextNum: 1,
      timerSec: 120,
      timerInt: null,
      status: 'waiting',
      
      // Game State
      fighterIds: [],
      fighters: {},
      spectators: [],
      hitIds: new Set(),
      startedAt: null,
      
      // Rotation logic
      charDeck: [],
      playerCounts: {} // userId -> matches played
    };
  }
  return rooms[roomId];
}

function getCharFromDeck(room) {
  if (room.charDeck.length === 0) {
    room.charDeck = FAMILY.map((_, i) => i).sort(() => Math.random() - 0.5);
  }
  const index = room.charDeck.pop();
  return { ...FAMILY[index], assetIndex: index + 1 };
}

function lobbyList(room) {
  return Object.values(room.players).sort((a, b) => a.num - b.num).map(p => {
    return { ...p, wins: room.users[p.userId] ? room.users[p.userId].wins : 0 };
  });
}

function pubLobby(room) {
  return { players: lobbyList(room), timerSec: room.timerSec, status: room.status, count: Object.keys(room.players).length };
}

function pubGame(room) {
  return { fighters: room.fighters, fighterIds: room.fighterIds, status: room.status, startedAt: room.startedAt };
}

/* ─── Timer ─── */
function startTimer(room) {
  if (room.timerInt) clearInterval(room.timerInt);
  room.timerSec = 120;
  room.status = 'waiting';
  room.timerInt = setInterval(() => {
    room.timerSec--;
    io.to(room.id).emit('timerTick', room.timerSec);
    if (room.timerSec <= 0) { clearInterval(room.timerInt); room.timerInt = null; tryStart(room); }
  }, 1000);
}

function resetTimer(room) {
  room.timerSec = 120;
  if (!room.timerInt) startTimer(room);
}

/* ─── Start Game ─── */
function tryStart(room) {
  const ids = Object.keys(room.players);
  if (ids.length < 2) { io.to(room.id).emit('lobbyMsg', 'Need 2+ players. Timer reset.'); resetTimer(room); return; }

  // Select least played users
  const candidates = [...ids].sort((a, b) => {
    const pA = room.players[a].userId;
    const pB = room.players[b].userId;
    const countA = room.playerCounts[pA] || 0;
    const countB = room.playerCounts[pB] || 0;
    if (countA === countB) return Math.random() - 0.5;
    return countA - countB;
  });

  const [a, b] = [candidates[0], candidates[1]];
  
  room.playerCounts[room.players[a].userId] = (room.playerCounts[room.players[a].userId] || 0) + 1;
  room.playerCounts[room.players[b].userId] = (room.playerCounts[room.players[b].userId] || 0) + 1;

  const c1 = getCharFromDeck(room);
  const c2 = getCharFromDeck(room);

  room.fighters = {};
  room.fighters[a] = { id: a, username: room.players[a].username, num: room.players[a].num, char: c1, hp: MAX_HP, maxHp: MAX_HP };
  room.fighters[b] = { id: b, username: room.players[b].username, num: room.players[b].num, char: c2, hp: MAX_HP, maxHp: MAX_HP };
  room.fighterIds = [a, b];
  room.spectators = ids.filter(x => x !== a && x !== b);
  room.hitIds = new Set();
  room.startedAt = Date.now();
  room.status = 'playing';

  if (room.timerInt) { clearInterval(room.timerInt); room.timerInt = null; }

  io.to(room.id).emit('gameStart', pubGame(room));
}

function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function damageForMove(baseDmg, move) {
  const multipliers = { normal: 1, double: 1.3, power: 1.8, split: 1.05, spread: 1.15, heavy: 1.6, rapid: 0.7, pierce: 1.4 };
  return Math.max(1, Math.round(baseDmg * (multipliers[move] || 1)));
}

function handleGameOver(room, winnerId) {
  room.status = 'finished';
  const winner = room.fighters[winnerId] || null;
  
  if (winner) {
    const winnerUid = room.players[winnerId].userId;
    room.users[winnerUid].wins = (room.users[winnerUid].wins || 0) + 1;
  }
  
  io.to(room.id).emit('gameOver', { ...pubGame(room), winner });
  io.to(room.id).emit('lobbyUpdate', pubLobby(room)); // Update wins

  setTimeout(() => {
    room.status = 'idle'; room.fighters = {}; room.fighterIds = []; room.spectators = []; room.hitIds = new Set(); room.startedAt = null;
    if (Object.keys(room.players).length >= 2) {
      room.status = 'waiting';
      let cd = 5;
      io.to(room.id).emit('nextCountdown', cd);
      room.timerInt = setInterval(() => { cd--; io.to(room.id).emit('nextCountdown', cd); if (cd <= 0) { clearInterval(room.timerInt); room.timerInt = null; tryStart(room); } }, 1000);
    } else { room.status = 'waiting'; io.to(room.id).emit('lobbyUpdate', pubLobby(room)); resetTimer(room); }
  }, 6000);
}

/* ─── Sockets ─── */
io.on('connection', (socket) => {
  let myRoomId = null;

  socket.on('joinLobby', ({ username, roomId, userId }, cb) => {
    if (!username || !username.trim()) return cb({ ok: false, msg: 'Enter a name.' });
    if (!roomId || !roomId.trim()) return cb({ ok: false, msg: 'Enter a room.' });
    if (!userId) return cb({ ok: false, msg: 'Error identifying user session.' });
    
    myRoomId = roomId.trim().toUpperCase();
    socket.join(myRoomId);
    
    const name = username.trim().slice(0, 12);
    const room = getRoom(myRoomId);
    
    // Setup persistence
    if (!room.users[userId]) room.users[userId] = { wins: 0, username: name };

    const num = room.nextNum++;
    room.players[socket.id] = { id: socket.id, userId, username: name, num };
    
    if (Object.keys(room.players).length === 1 && !room.timerInt) startTimer(room);
    
    cb({ ok: true, num, wins: room.users[userId].wins });
    io.to(myRoomId).emit('lobbyUpdate', pubLobby(room));
    
    if (room.status === 'playing') {
      room.spectators.push(socket.id);
      socket.emit('gameStart', pubGame(room));
    }
  });

  socket.on('forceStart', () => {
    if (!myRoomId) return;
    const room = getRoom(myRoomId);
    if (room.status === 'playing') return;
    if (room.timerInt) { clearInterval(room.timerInt); room.timerInt = null; }
    tryStart(room);
  });

  /* ─── Emotes ─── */
  socket.on('emote', (emoji) => {
    if (!myRoomId) return;
    const room = getRoom(myRoomId);
    if (room.players[socket.id]) {
      io.to(myRoomId).emit('showEmote', { id: socket.id, emoji, username: room.players[socket.id].username });
    }
  });

  /* ─── Real-Time Combat Events ─── */
  socket.on('triggerSmoke', () => {
    if (!myRoomId) return;
    const room = getRoom(myRoomId);
    if (room.status !== 'playing' || !room.fighters[socket.id]) return;
    const opId = room.fighterIds.find(x => x !== socket.id);
    if (opId) io.to(opId).emit('enemySmoke');
    room.spectators.forEach(sid => io.to(sid).emit('enemySmoke'));
  });

  socket.on('triggerCloneRush', () => {
    if (!myRoomId) return;
    const room = getRoom(myRoomId);
    if (room.status !== 'playing' || !room.fighters[socket.id]) return;
    
    // Broadcast effect
    io.to(myRoomId).emit('cloneRushEffect', { sourceId: socket.id });

    // Luck calculation (40% hit chance to deal 20% max hp)
    setTimeout(() => {
      if (room.status !== 'playing') return;
      if (Math.random() <= 0.40) {
        const opId = room.fighterIds.find(x => x !== socket.id);
        if (!opId || !room.fighters[opId]) return;
        const opponent = room.fighters[opId];
        const rawDmg = Math.round(opponent.maxHp * 0.20);
        
        const id = `${socket.id}:clone:${Date.now()}`;
        if (room.hitIds.has(id)) return;
        room.hitIds.add(id);

        opponent.hp = Math.max(0, opponent.hp - rawDmg);
        io.to(myRoomId).emit('hpUpdate', { id: opId, hp: opponent.hp, maxHp: opponent.maxHp, dmg: rawDmg });
        
        if (opponent.hp <= 0) handleGameOver(room, socket.id);
      }
    }, 1200); // 1.2s flight time match
  });

  socket.on('fire', (payload = {}) => {
    if (!myRoomId) return;
    const room = getRoom(myRoomId);
    if (room.status !== 'playing' || !room.fighters[socket.id]) return;
    
    const me = room.fighters[socket.id];
    const opId = room.fighterIds.find(x => x !== socket.id);
    const lane = Math.round(clampNum(payload.lane, 0, 4, 0));
    const move = typeof payload.move === 'string' ? payload.move.slice(0, 20) : (payload.power ? 'power' : 'normal');
    const shotId = typeof payload.shotId === 'string' ? payload.shotId.slice(0, 80) : `${socket.id}:${Date.now()}:${Math.random()}`;
    
    const shot = {
      fromId: socket.id, lane, dmg: damageForMove(me.char.dmg, move), move,
      big: !!payload.big || move === 'power' || move === 'heavy', shotId,
      speed: clampNum(payload.speed, 220, 760, 420), offset: clampNum(payload.offset, -70, 70, 0),
      vx: clampNum(payload.vx, -160, 160, 0), scale: clampNum(payload.scale, 0.6, 2.8, 1),
    };
    
    if (opId) io.to(opId).emit('enemyFire', shot);
    room.spectators.forEach(sid => io.to(sid).emit('specFire', shot));
  });

  socket.on('takeDamage', ({ dmg, hitId } = {}) => {
    if (!myRoomId) return;
    const room = getRoom(myRoomId);
    if (room.status !== 'playing' || !room.fighters[socket.id]) return;
    
    const id = typeof hitId === 'string' ? hitId.slice(0, 80) : `${socket.id}:${Date.now()}:${Math.random()}`;
    if (room.hitIds.has(id)) return;
    room.hitIds.add(id);
    
    const me = room.fighters[socket.id];
    const safeDmg = clampNum(dmg, 1, 120, 1);
    me.hp = Math.max(0, me.hp - safeDmg);
    
    io.to(myRoomId).emit('hpUpdate', { id: socket.id, hp: me.hp, maxHp: me.maxHp, dmg: safeDmg });
    
    if (me.hp <= 0) {
      const winnerId = room.fighterIds.find(x => x !== socket.id);
      handleGameOver(room, winnerId);
    }
  });

  socket.on('hitOpponent', ({ dmg, hitId } = {}) => {
    if (!myRoomId) return;
    const room = getRoom(myRoomId);
    if (room.status !== 'playing' || !room.fighters[socket.id]) return;
    
    const id = typeof hitId === 'string' ? hitId.slice(0, 80) : `${socket.id}:hit:${Date.now()}:${Math.random()}`;
    if (room.hitIds.has(id)) return;
    room.hitIds.add(id);
    
    const opId = room.fighterIds.find(x => x !== socket.id);
    if (!opId || !room.fighters[opId]) return;
    
    const opponent = room.fighters[opId];
    const safeDmg = clampNum(dmg, 1, 120, 1);
    opponent.hp = Math.max(0, opponent.hp - safeDmg);
    
    io.to(myRoomId).emit('hpUpdate', { id: opId, hp: opponent.hp, maxHp: opponent.maxHp, dmg: safeDmg });
    
    if (opponent.hp <= 0) {
      handleGameOver(room, socket.id);
    }
  });

  socket.on('disconnect', () => {
    if (!myRoomId) return;
    const room = getRoom(myRoomId);
    delete room.players[socket.id];
    
    if (room.fighters[socket.id] && room.status === 'playing') {
      const winnerId = room.fighterIds.find(x => x !== socket.id);
      handleGameOver(room, winnerId);
      return;
    }
    room.spectators = room.spectators.filter(x => x !== socket.id);
    io.to(myRoomId).emit('lobbyUpdate', pubLobby(room));
    
    // Optional: Clean up empty rooms after 5 minutes
    if (Object.keys(room.players).length === 0 && !room.timerInt) {
      setTimeout(() => { if (Object.keys(room.players).length === 0) delete rooms[myRoomId]; }, 300000);
    }
  });
});

const PORT = process.env.PORT || 8080;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.error('Port ' + PORT + ' in use.'); process.exit(1); }
  throw e;
});
server.listen(PORT, '0.0.0.0', () => console.log('ADI - FG : AI Developer India Family Game running at http://localhost:' + PORT));
