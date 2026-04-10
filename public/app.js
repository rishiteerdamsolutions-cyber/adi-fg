var socket = io();

/* ═══ SCREENS ═══ */
var $login = document.getElementById('screenLogin');
var $lobby = document.getElementById('screenLobby');
var $battle = document.getElementById('screenBattle');

function showLogin() { $login.classList.add('active-overlay'); $lobby.classList.remove('active-overlay'); $battle.style.display = 'none'; }
function showLobby() { $login.classList.remove('active-overlay'); $lobby.classList.add('active-overlay'); $battle.style.display = 'none'; }
function showBattle() { $login.classList.remove('active-overlay'); $lobby.classList.remove('active-overlay'); $battle.style.display = 'flex'; }

var myNum = null;
var amFighter = false;
var gameData = null;
var myFighter = null;
var opFighter = null;

/* ═══ AUDIO TOGGLE ═══ */
var $btnAudio = document.getElementById('btnAudioToggle');
if ($btnAudio) {
  $btnAudio.dataset.muted = sfx.isMuted;
  $btnAudio.addEventListener('click', function() {
    var muted = sfx.toggleMute();
    this.dataset.muted = muted;
    sfx.playClick();
    if (!muted && $lobby.classList.contains('active-overlay')) sfx.playLobbyBgm();
  });
}

/* ═══ LOGIN ═══ */
document.getElementById('btnJoin').addEventListener('click', function () {
  sfx.init();
  sfx.playClick();
  var name = document.getElementById('inputName').value.trim();
  var room = document.getElementById('inputRoom') ? document.getElementById('inputRoom').value.trim() : 'PUBLIC';
  if (!name) { document.getElementById('loginErr').innerText = 'Enter a name.'; return; }
  if (document.getElementById('inputRoom') && !room) { document.getElementById('loginErr').innerText = 'Enter a room code.'; return; }
  
  var uid = localStorage.getItem('asura_uid');
  if (!uid) { uid = 'u_' + Date.now() + Math.random().toString(36).substring(2); localStorage.setItem('asura_uid', uid); }

  var btn = document.getElementById('btnJoin');
  btn.disabled = true; btn.innerText = 'Joining...';
  socket.emit('joinLobby', { username: name, roomId: room, userId: uid }, function (res) {
    btn.disabled = false; btn.innerText = 'Join Game';
    if (!res.ok) { document.getElementById('loginErr').innerText = res.msg; return; }
    myNum = res.num;
    document.getElementById('youBadge').innerText = 'You #' + myNum + (res.wins > 0 ? ' (🏆 ' + res.wins + ')' : '');
    sfx.playJoin();
    sfx.playLobbyBgm();
    showLobby();
  });
});
document.getElementById('inputName').addEventListener('keydown', function (e) { if (e.key === 'Enter') document.getElementById('btnJoin').click(); });
if (document.getElementById('inputRoom')) document.getElementById('inputRoom').addEventListener('keydown', function (e) { if (e.key === 'Enter') document.getElementById('btnJoin').click(); });

/* ═══ LOBBY ═══ */
socket.on('lobbyUpdate', function (d) {
  document.getElementById('lobbyN').innerText = d.count;
  var ul = document.getElementById('pList'); ul.innerHTML = '';
  var leaderUl = document.getElementById('leaderboardList');
  if (leaderUl) leaderUl.innerHTML = '';
  
  // Sort for leaderboard
  var sortedPlayers = d.players.slice().sort(function(a, b) { return b.wins - a.wins; });
  
  d.players.forEach(function (p) {
    var winStr = p.wins > 0 ? ' <span class="win-pill">🏆 ' + p.wins + ' Wins</span>' : '';
    var youStr = p.id === socket.id ? ' <span class="you-badge sm">YOU</span>' : '';
    var li = document.createElement('li'); li.className = 'p-item';
    li.innerHTML = '<span class="pn">#' + p.num + '</span> <span class="pnm">' + p.username + '</span>' + winStr + youStr;
    ul.appendChild(li);
  });
  
  if (leaderUl) {
    sortedPlayers.forEach(function(p, i) {
      if (p.wins > 0) {
        var li = document.createElement('li'); li.className = 'p-item';
        li.innerHTML = '<span class="pn">#' + (i+1) + '</span> <span class="pnm">' + p.username + '</span> <span class="win-pill">🏆 ' + p.wins + '</span>';
        leaderUl.appendChild(li);
      }
    });
  }

  var btnForce = document.getElementById('btnForce');
  if (btnForce) btnForce.style.display = d.count >= 2 ? 'block' : 'none';
});

socket.on('timerTick', function (s) {
  var m = Math.floor(s / 60), sec = s % 60;
  document.getElementById('timerText').innerText = m + ':' + String(sec).padStart(2, '0');
  var c = document.getElementById('timerCircle');
  c.style.strokeDashoffset = 326.73 * (1 - s / 120);
});

socket.on('lobbyMsg', function (msg) {
  var el = document.getElementById('lobbyMsg'); el.innerText = msg;
  setTimeout(function () { el.innerText = ''; }, 4000);
});

document.getElementById('btnForce').addEventListener('click', function () { sfx.playClick(); socket.emit('forceStart'); });

var btnLeader = document.getElementById('btnLeaderboardToggle');
var modLeader = document.getElementById('modalLeaderboard');
var btnClsLeader = document.getElementById('btnCloseLeaderboard');
if (btnLeader && modLeader && btnClsLeader) {
  btnLeader.addEventListener('click', function() { sfx.playClick(); modLeader.classList.remove('hidden'); });
  btnClsLeader.addEventListener('click', function() { sfx.playClick(); modLeader.classList.add('hidden'); });
}

/* ═══ EMOTES ═══ */
document.querySelectorAll('.emote-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    socket.emit('emote', this.dataset.emote);
    sfx.playClick();
  });
});

socket.on('showEmote', function(data) {
  var battleDiv = document.getElementById('screenBattle');
  if (battleDiv.style.display === 'none') return;
  var words = { '😂': 'Haha!', '😡': 'Grrr!', '🔥': 'Epic!', '👏': 'GG!' };
  var el = document.createElement('div');
  el.className = 'floating-emote';
  el.innerText = data.emoji + ' ' + (words[data.emoji] || '') + ' — ' + data.username;
  el.style.left = (20 + Math.random() * 60) + 'vw';
  el.style.bottom = (20 + Math.random() * 40) + 'vh';
  battleDiv.appendChild(el);
  setTimeout(function() { el.remove(); }, 2000);
});

/* ═══ GAME START ═══ */
var vsPhase = false;
var vsStartTime = 0;
var VS_DURATION = 3000; /* ms */

socket.on('gameStart', function (data) {
  gameData = data;
  amFighter = !!data.fighters[socket.id];

  document.getElementById('modalGO').classList.add('hidden');
  document.getElementById('nextOv').classList.add('hidden');

  var banner = document.getElementById('specBanner');
  banner.classList.toggle('hidden', amFighter);

  var emotesPanel = document.querySelector('.emotes-panel');
  if (emotesPanel) emotesPanel.style.display = amFighter ? 'none' : 'flex';

  if (amFighter) {
    myFighter = data.fighters[socket.id];
    var opId = data.fighterIds.find(function (x) { return x !== socket.id; });
    opFighter = data.fighters[opId];
  } else {
    myFighter = data.fighters[data.fighterIds[0]];
    opFighter = data.fighters[data.fighterIds[1]];
  }

  setupBattle();
  showBattle();
  startVsIntro();
});

function startVsIntro() {
  vsPhase = true;
  vsStartTime = performance.now();
  if (amFighter) sfx.playStomp();
}

function drawVsScreen(now) {
  var elapsed = now - vsStartTime;
  var progress = Math.min(1, elapsed / VS_DURATION);
  var w = cv.width, h = cv.height;

  /* Dark background */
  ctx.clearRect(0, 0, w, h);
  var grd = ctx.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#1a0a2e');
  grd.addColorStop(0.5, '#2d1b4e');
  grd.addColorStop(1, '#1e1033');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);

  /* Stomp effect: scale from 3x down to 1x with bounce */
  var stompT = Math.min(1, elapsed / 600);
  var bounce = stompT < 1 ? 3 - 2 * stompT + 0.3 * Math.sin(stompT * Math.PI * 3) * (1 - stompT) : 1;
  var avatarScale = bounce;

  var avatarH = h * 0.35;
  var avatarW;
  var gap = w * 0.12;

  /* Left avatar (my fighter) */
  if (myAvatarLoaded) {
    avatarW = avatarH * (myAvatarImg.width / myAvatarImg.height);
    var lx = w * 0.28;
    var ly = h * 0.45;
    ctx.save();
    ctx.translate(lx, ly);
    ctx.scale(avatarScale, avatarScale);
    ctx.shadowColor = 'rgba(34, 197, 94, 0.8)';
    ctx.shadowBlur = 30 * dpr;
    ctx.drawImage(myAvatarImg, -avatarW / 2, -avatarH / 2, avatarW, avatarH);
    ctx.restore();
  }

  /* Right avatar (opponent) */
  if (opAvatarLoaded) {
    avatarW = avatarH * (opAvatarImg.width / opAvatarImg.height);
    var rx = w * 0.72;
    var ry = h * 0.45;
    ctx.save();
    ctx.translate(rx, ry);
    ctx.scale(avatarScale, avatarScale);
    ctx.shadowColor = 'rgba(239, 68, 68, 0.8)';
    ctx.shadowBlur = 30 * dpr;
    ctx.drawImage(opAvatarImg, -avatarW / 2, -avatarH / 2, avatarW, avatarH);
    ctx.restore();
  }

  /* VS text — pulse in after stomp */
  if (elapsed > 400) {
    var vsT = Math.min(1, (elapsed - 400) / 400);
    var vsScale = 0.5 + vsT * 0.5 + Math.sin(vsT * Math.PI) * 0.3;
    ctx.save();
    ctx.translate(w / 2, h * 0.45);
    ctx.scale(vsScale, vsScale);
    ctx.fillStyle = '#fbbf24';
    ctx.shadowColor = '#fbbf24';
    ctx.shadowBlur = 40 * dpr;
    ctx.font = 'bold ' + Math.round(48 * dpr) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('VS', 0, 0);
    ctx.restore();
  }

  /* Player names — show only user-entered names */
  if (elapsed > 600) {
    var nameAlpha = Math.min(1, (elapsed - 600) / 400);
    ctx.globalAlpha = nameAlpha;
    ctx.font = 'bold ' + Math.round(16 * dpr) + 'px sans-serif';
    ctx.textAlign = 'center';
    /* My name (left) */
    ctx.fillStyle = '#86efac';
    ctx.fillText(myFighter.username, w * 0.28, h * 0.75);
    /* Opponent name (right) */
    ctx.fillStyle = '#fca5a5';
    ctx.fillText(opFighter.username, w * 0.72, h * 0.75);
    ctx.globalAlpha = 1;
  }

  /* Fade out at end */
  if (progress > 0.8) {
    var fadeAlpha = (progress - 0.8) / 0.2;
    ctx.fillStyle = 'rgba(26, 10, 46, ' + fadeAlpha + ')';
    ctx.fillRect(0, 0, w, h);
  }

  if (elapsed >= VS_DURATION) {
    if (vsPhase && amFighter) sfx.playGameStart();
    vsPhase = false;
  }
}

/* ═══ GAME OVER ═══ */
socket.on('gameOver', function (data) {
  gameData = data;
  if (amFighter) {
    if (data.winner && data.winner.id === socket.id) sfx.playVictory();
    else sfx.playDefeat();
  }
  var modal = document.getElementById('modalGO');
  document.getElementById('winText').innerText = data.winner ? '🏆 ' + data.winner.username + ' wins!' : 'Draw!';
  modal.classList.remove('hidden');
  gameRunning = false;
  launchConfetti();
});

socket.on('nextCountdown', function (s) {
  if (s > 0) sfx.playCountdownTick();
  var ov = document.getElementById('nextOv');
  ov.classList.remove('hidden');
  document.getElementById('nextTimer').innerText = s;
  document.getElementById('modalGO').classList.add('hidden');
  if (s <= 0) ov.classList.add('hidden');
});

/* ═══════════════════════════════════════════════
   CANVAS GAME — 2 PLAYER REAL-TIME LANE SHOOTER
   ═══════════════════════════════════════════════ */

var cv, ctx;
var HOLE_COUNT = 5;
var HOLE_TOP_FRAC = 0.05;    /* holes at top edge (unit 0.5 out of 10) */
var HOLE_BOTTOM_FRAC = 0.95; /* holes at bottom edge (unit 9.5 out of 10) */
var AVATAR_TOP_FRAC = 0.2;   /* opponent avatar at unit 2 */
var AVATAR_BOTTOM_FRAC = 0.8; /* player avatar at unit 8 */
var dpr = Math.min(window.devicePixelRatio || 1, 2);

/* Images */
var opAvatarImg = new Image();
var opAvatarLoaded = false;
var myAvatarImg = new Image();
var myAvatarLoaded = false;
var myWeaponImg = new Image();
var myWeaponLoaded = false;
var opWeaponImg = new Image();
var opWeaponLoaded = false;

var myHp = 300, myMaxHp = 300;
var opHp = 300, opMaxHp = 300;
var myDmg = 20;

var projectiles = [];
var gameRunning = false;
var loopRafId = null;
var shotSeq = 0;
var floatingTexts = [];

/* Secret Mechanic Vars */
var clickBuffer = [];
var activeSmokes = [];
var cloneRushes = [];

/* ─── AVATAR SIZES ─── */
var AVATAR_SCALE = 0.10; /* 1 unit out of 10 = 10% of canvas height */

function loadTransparentAvatar(targetImg, src, onReady) {
  var raw = new Image();
  raw.onload = function () {
    try {
      var c = document.createElement('canvas');
      c.width = raw.naturalWidth || raw.width;
      c.height = raw.naturalHeight || raw.height;
      var cctx = c.getContext('2d');
      cctx.drawImage(raw, 0, 0);
      var img = cctx.getImageData(0, 0, c.width, c.height);
      removeConnectedFlatBackground(img.data, c.width, c.height);
      cctx.putImageData(img, 0, 0);
      targetImg.onload = onReady;
      targetImg.src = c.toDataURL('image/png');
    } catch (e) {
      targetImg.onload = onReady;
      targetImg.src = src;
    }
  };
  raw.onerror = function () {
    targetImg.onload = onReady;
    targetImg.src = src;
  };
  raw.src = src;
}

function removeConnectedFlatBackground(data, w, h) {
  var seen = new Uint8Array(w * h);
  var queue = new Uint32Array(w * h);
  var head = 0, tail = 0;

  function isBg(idx) {
    var p = idx * 4;
    var r = data[p], g = data[p + 1], b = data[p + 2];
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var sat = max - min;
    var bright = (r + g + b) / 3;
    return sat < 30 || bright > 238 || bright < 28;
  }

  function add(x, y) {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    var idx = y * w + x;
    if (seen[idx] || !isBg(idx)) return;
    seen[idx] = 1;
    queue[tail++] = idx;
  }

  for (var x = 0; x < w; x++) {
    add(x, 0);
    add(x, h - 1);
  }
  for (var y = 0; y < h; y++) {
    add(0, y);
    add(w - 1, y);
  }

  while (head < tail) {
    var idx = queue[head++];
    data[idx * 4 + 3] = 0;
    var cx = idx % w;
    var cy = (idx / w) | 0;
    add(cx + 1, cy);
    add(cx - 1, cy);
    add(cx, cy + 1);
    add(cx, cy - 1);
  }
}

function moveDamage(baseDmg, move) {
  var multipliers = { normal: 1, double: 1.5, power: 2.5, split: 1.1, spread: 1.25, heavy: 2.4, rapid: 0.85, pierce: 1.8 };
  return Math.max(1, Math.round(baseDmg * (multipliers[move] || 1)));
}

function nextShotId() {
  return socket.id + ':' + Date.now() + ':' + (shotSeq++);
}

function battleClockSec() {
  return gameData && gameData.startedAt ? Math.max(0, (Date.now() - gameData.startedAt) / 1000) : 0;
}

function phaseForFighter(fighter) {
  var n = fighter && fighter.char && fighter.char.assetIndex ? fighter.char.assetIndex : 1;
  return n * 0.73 + battleClockSec() * (0.65 + (n % 3) * 0.08);
}

function uniqueSortedLanes(lanes) {
  var seen = {}, out = [];
  for (var i = 0; i < lanes.length; i++) {
    var lane = Math.max(0, Math.min(HOLE_COUNT - 1, lanes[i] | 0));
    if (!seen[lane]) { seen[lane] = true; out.push(lane); }
  }
  return out.sort(function (a, b) { return a - b; });
}

function shotSpec(lane, move, opts) {
  opts = opts || {};
  return {
    lane: lane,
    move: move || 'normal',
    big: !!opts.big,
    scale: opts.scale || 1,
    speed: opts.speed || 420,
    offset: opts.offset || 0,
    vx: opts.vx || 0,
  };
}

function buildComboShots(lanes) {
  lanes = uniqueSortedLanes(lanes);
  if (lanes.length >= 3) return buildPowerShots(lanes);
  if (lanes.length === 2) {
    return [
      shotSpec(lanes[0], 'double', { scale: 1.15, speed: 455 }),
      shotSpec(lanes[1], 'double', { scale: 1.15, speed: 455 }),
    ];
  }
  if (lanes.length === 1) return [shotSpec(lanes[0], 'normal')];
  return [];
}

function buildPowerShots(lanes) {
  var weaponNo = myFighter && myFighter.char && myFighter.char.assetIndex ? myFighter.char.assetIndex : 1;
  var center = lanes[Math.floor(lanes.length / 2)] == null ? 2 : lanes[Math.floor(lanes.length / 2)];
  var all = [0, 1, 2, 3, 4];
  var shots = [];

  if (weaponNo === 1) {
    shots.push(shotSpec(center, 'power', { big: true, scale: 2.1, speed: 380 }));
    lanes.forEach(function (lane) { shots.push(shotSpec(lane, 'split', { scale: 0.9, speed: 470 })); });
  } else if (weaponNo === 2) {
    lanes.forEach(function (lane) {
      shots.push(shotSpec(lane, 'rapid', { scale: 0.75, speed: 640, offset: -14 }));
      shots.push(shotSpec(lane, 'rapid', { scale: 0.75, speed: 640, offset: 14 }));
    });
  } else if (weaponNo === 3) {
    shots.push(shotSpec(center, 'heavy', { big: true, scale: 2.5, speed: 330 }));
  } else if (weaponNo === 4) {
    all.forEach(function (lane) { shots.push(shotSpec(lane, 'spread', { scale: 1.05, speed: 430 })); });
  } else if (weaponNo === 5) {
    lanes.forEach(function (lane) {
      shots.push(shotSpec(lane, 'rapid', { scale: 0.72, speed: 700, offset: -18 }));
      shots.push(shotSpec(lane, 'rapid', { scale: 0.72, speed: 700 }));
      shots.push(shotSpec(lane, 'rapid', { scale: 0.72, speed: 700, offset: 18 }));
    });
  } else if (weaponNo === 6) {
    lanes.forEach(function (lane) {
      [lane - 1, lane, lane + 1].forEach(function (nextLane) {
        if (nextLane >= 0 && nextLane < HOLE_COUNT) shots.push(shotSpec(nextLane, 'split', { scale: 0.95, speed: 520 }));
      });
    });
  } else if (weaponNo === 7) {
    lanes.forEach(function (lane, index) { shots.push(shotSpec(lane, 'rapid', { scale: 1, speed: 560, vx: index % 2 ? 70 : -70 })); });
  } else if (weaponNo === 8) {
    lanes.forEach(function (lane) { shots.push(shotSpec(lane, 'heavy', { big: true, scale: 1.9, speed: 360 })); });
  } else if (weaponNo === 9) {
    lanes.forEach(function (lane) { shots.push(shotSpec(lane, 'pierce', { scale: 1.25, speed: 660 })); });
  } else {
    lanes.forEach(function (lane) {
      [lane - 1, lane, lane + 1].forEach(function (nextLane) {
        if (nextLane >= 0 && nextLane < HOLE_COUNT) shots.push(shotSpec(nextLane, 'spread', { scale: 0.95, speed: 500 }));
      });
    });
  }

  return shots.length ? shots : [shotSpec(center, 'power', { big: true, scale: 2, speed: 420 })];
}

function sendPlayerShot(shot) {
  shot.shotId = nextShotId();
  shot.dmg = moveDamage(myDmg, shot.move);
  spawnPlayerShot(shot);
  socket.emit('fire', shot);
}

function setupBattle() {
  if (amFighter) sfx.playBattleBgm();
  cv = document.getElementById('cv');
  ctx = cv.getContext('2d');
  resize();

  /* Load opponent avatar */
  opAvatarLoaded = false;
  loadTransparentAvatar(opAvatarImg, opFighter.char.avatar + '?v=mp3', function () { opAvatarLoaded = true; });

  /* Load MY avatar */
  myAvatarLoaded = false;
  loadTransparentAvatar(myAvatarImg, myFighter.char.avatar + '?v=mp3', function () { myAvatarLoaded = true; });

  /* Load MY weapon (used as my projectile image) */
  myWeaponLoaded = false;
  myWeaponImg.onload = function () { myWeaponLoaded = true; };
  myWeaponImg.src = myFighter.char.weapon + '?v=mp3';

  /* Load OPPONENT weapon (used as enemy projectile image) */
  opWeaponLoaded = false;
  opWeaponImg.onload = function () { opWeaponLoaded = true; };
  opWeaponImg.src = opFighter.char.weapon + '?v=mp3';

  /* Header — show only user-entered names, NOT character names */
  document.getElementById('gameH1').innerText = myFighter.username + ' vs ' + opFighter.username;
  document.getElementById('opponentTitle').innerText = opFighter.username + ' — ' + opFighter.char.weaponName;
  document.getElementById('opHpLabel').innerText = opFighter.username;

  /* Weapon row (visual display only — single weapon) */
  var wRow = document.getElementById('weaponRow');
  wRow.innerHTML = '';
  var wBtn = document.createElement('button');
  wBtn.type = 'button';
  wBtn.className = 'weapon-btn active';
  wBtn.title = myFighter.char.weaponName + ' · ' + myFighter.char.dmg + ' dmg';
  var wImg = document.createElement('img');
  wImg.src = myFighter.char.weapon;
  wImg.alt = myFighter.char.weaponName;
  wImg.style.width = '100%'; wImg.style.height = '100%'; wImg.style.objectFit = 'contain';
  wBtn.appendChild(wImg);
  wRow.appendChild(wBtn);

  // Weapon Zoom listener
  wRow.onclick = function() {
    sfx.playClick();
    document.getElementById('zoomName').innerText = myFighter.char.weaponName;
    document.getElementById('zoomImg').src = myFighter.char.weapon;
    document.getElementById('modalZoom').classList.remove('hidden');
  };
  
  var btnCloseZoom = document.getElementById('btnCloseZoom');
  if (btnCloseZoom) {
    btnCloseZoom.onclick = function() { sfx.playClick(); document.getElementById('modalZoom').classList.add('hidden'); };
  }

  // Buttons visibility & limits
  var smokeBtn = document.getElementById('btnSmoke');
  var clonesBtn = document.getElementById('btnClones');
  if (smokeBtn && clonesBtn) {
    smokeBtn.classList.remove('hidden');
    clonesBtn.classList.remove('hidden');
    smokeBtn.disabled = false;  // Ensure reset on new match
    clonesBtn.disabled = false;
    
    smokeBtn.onclick = function(e) {
      if(e) e.preventDefault();
      sfx.playPowerMove();
      smokeBtn.disabled = true; // Perm disable for this match
      socket.emit('triggerSmoke');
    };
    clonesBtn.onclick = function(e) {
      if(e) e.preventDefault();
      sfx.playPowerMove();
      clonesBtn.disabled = true; // Perm disable for this match
      socket.emit('triggerCloneRush');
    };
  }

  /* Damage label */
  var dmgLabel = document.createElement('span');
  dmgLabel.className = 'dmg-label';
  dmgLabel.innerText = myFighter.char.dmg + ' dmg';
  wRow.appendChild(dmgLabel);

  myDmg = myFighter.char.dmg;

  /* ─── POWER MOVE COMBO SYSTEM ─── */
  /*
   * 1 lane = normal weapon throw.
   * 2 lanes within the window = double shot.
   * 3+ lanes within the window = weapon-specific power move.
   */
  var comboWindow = 250; /* ms to detect near-simultaneous presses */
  var pendingLanes = [];
  var comboTimer = null;

  function fireCombo() {
    if (!gameRunning || !amFighter) return;

    var lanes = uniqueSortedLanes(pendingLanes);
    pendingLanes = [];
    comboTimer = null;

    if (lanes.length >= 3) {
      sfx.playPowerMove();
      showPowerEffect(myFighter.char.weaponName + ' POWER MOVE!');
    } else if (lanes.length === 2) {
      sfx.playDoubleShot();
      showPowerEffect('DOUBLE SHOT!');
    }

    buildComboShots(lanes).forEach(sendPlayerShot);
  }

  function showPowerEffect(text) {
    /* Screen flash */
    var flash = document.createElement('div');
    document.body.appendChild(flash);
    setTimeout(function () { flash.remove(); }, 500);

    /* Text popup */
    var pop = document.createElement('div');
    pop.className = 'power-indicator';
    pop.innerText = text;
    document.body.appendChild(pop);
    setTimeout(function () { pop.remove(); }, 900);
  }

  /* Fire hole buttons */
  var holesEl = document.getElementById('holes');
  holesEl.innerHTML = '';
  for (var i = 0; i < HOLE_COUNT; i++) {
    (function (hi) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'hole-btn';
      b.textContent = '↑ ' + (hi + 1);
      function queueLane(e) {
        if (e) e.preventDefault();
        if (!gameRunning || !amFighter || vsPhase) return;
        sfx.playClick();

        /* Add to combo buffer */
        if (pendingLanes.indexOf(hi) === -1) pendingLanes.push(hi);

        /* If only 1 lane so far, fire instantly AND start combo timer */
        if (pendingLanes.length === 1) {
          sfx.playWeapon((myFighter && myFighter.char && myFighter.char.assetIndex) ? myFighter.char.assetIndex : 1, false);
          /* Fire single shot immediately */
          var singleLanes = uniqueSortedLanes(pendingLanes.slice());
          buildComboShots(singleLanes).forEach(sendPlayerShot);
        }

        /* Reset timer — wait for more presses for combo */
        if (comboTimer) clearTimeout(comboTimer);
        comboTimer = setTimeout(function() {
          if (pendingLanes.length >= 2) {
            /* Fire combo (multi-lane) */
            fireCombo();
          } else {
            /* Single already fired, just clear */
            pendingLanes = [];
            comboTimer = null;
          }
        }, comboWindow);
      }
      if (window.PointerEvent) b.addEventListener('pointerdown', queueLane);
      else b.addEventListener('click', queueLane);
      holesEl.appendChild(b);
    })(i);
  }

  /* Disable for spectators */
  if (!amFighter) {
    document.querySelectorAll('.hole-btn').forEach(function (b) { b.disabled = true; });
  }

  /* Reset state */
  myHp = myFighter.hp || 100; myMaxHp = myFighter.maxHp || 100;
  opHp = opFighter.hp || 100; opMaxHp = opFighter.maxHp || 100;
  projectiles = [];
  floatingTexts = [];
  shotSeq = 0;
  gameRunning = true;
  lastT = performance.now();

  updateHpBars();
  if (loopRafId) cancelAnimationFrame(loopRafId);
  loopRafId = requestAnimationFrame(loop);
}

function resize() {
  if (!cv) return;
  var rect = cv.getBoundingClientRect();
  var w = Math.max(200, Math.floor(rect.width * dpr));
  var h = Math.max(260, Math.floor(rect.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
}

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(function () { resize(); }).observe(document.body);
} else {
  window.addEventListener('resize', resize);
}

function updateHpBars() {
  document.getElementById('hpOpponent').style.transform = 'scaleX(' + Math.max(0, opHp / opMaxHp) + ')';
  document.getElementById('hpPlayer').style.transform = 'scaleX(' + Math.max(0, myHp / myMaxHp) + ')';
}

function holeXs(w, n) {
  var margin = w * 0.1, usable = w - 2 * margin, xs = [];
  for (var i = 0; i < n; i++) xs.push(margin + (usable * i) / (n - 1 || 1));
  return xs;
}

/* ─── Opponent layout (avatar at unit 2, moves side to side) ─── */
function opLayout() {
  var w = cv.width, h = cv.height;
  var unitH = h / 10;
  var imgH = unitH; /* 1 unit tall */
  var imgW = opAvatarLoaded ? (imgH * opAvatarImg.width / opAvatarImg.height) : imgH * 0.7;
  var maxW = w * 0.3;
  if (imgW > maxW) { var sc = maxW / imgW; imgW = maxW; imgH *= sc; }
  var marginX = 10 * dpr;
  var panRange = Math.max(0, w / 2 - imgW / 2 - marginX);
  var cx = w / 2 + Math.sin(phaseForFighter(opFighter)) * panRange;
  var cy = h * AVATAR_TOP_FRAC; /* unit 2 */
  return { cx: cx, cy: cy, iw: imgW, ih: imgH, footY: cy + imgH / 2 };
}

/* ─── My layout (avatar at unit 8, moves side to side) ─── */
function myLayout() {
  var w = cv.width, h = cv.height;
  var unitH = h / 10;
  var imgH = unitH; /* 1 unit tall */
  var imgW = myAvatarLoaded ? (imgH * myAvatarImg.width / myAvatarImg.height) : imgH * 0.7;
  var maxW = w * 0.3;
  if (imgW > maxW) { var sc = maxW / imgW; imgW = maxW; imgH *= sc; }
  var marginX = 10 * dpr;
  var panRange = Math.max(0, w / 2 - imgW / 2 - marginX);
  var cx = w / 2 + Math.sin(phaseForFighter(myFighter)) * panRange;
  var cy = h * AVATAR_BOTTOM_FRAC; /* unit 8 */
  return { cx: cx, cy: cy, iw: imgW, ih: imgH, headY: cy - imgH / 2 };
}

/* ─── Spawn projectiles ─── */
function spawnPlayerShot(shot, dmg, big) {
  if (typeof shot === 'number') shot = { lane: shot, dmg: dmg, big: big };
  shot = shot || {};
  var w = cv.width, h = cv.height;
  var xs = holeXs(w, HOLE_COUNT);
  var lane = Math.max(0, Math.min(HOLE_COUNT - 1, shot.lane | 0));
  var x = (xs[lane] != null ? xs[lane] : w / 2) + (shot.offset || 0) * dpr;
  var y = h * HOLE_BOTTOM_FRAC; /* spawn at player holes (unit 8) */
  var spd = (shot.speed || 420) * dpr;
  projectiles.push({
    id: shot.shotId || nextShotId(),
    x: x,
    y: y,
    vx: (shot.vx || 0) * dpr,
    vy: -spd,
    ally: true,
    dmg: shot.dmg || dmg || myDmg,
    big: !!shot.big,
    scale: shot.scale || (shot.big ? 1.8 : 1),
    move: shot.move || 'normal',
  });
}

function spawnEnemyShot(shot, dmg) {
  if (typeof shot === 'number') shot = { lane: shot, dmg: dmg };
  shot = shot || {};
  var w = cv.width, h = cv.height;
  var xs = holeXs(w, HOLE_COUNT);
  var lane = Math.max(0, Math.min(HOLE_COUNT - 1, shot.lane | 0));
  var x = (xs[lane] != null ? xs[lane] : w / 2) + (shot.offset || 0) * dpr;
  var y = h * HOLE_TOP_FRAC; /* spawn at opponent holes (unit 2) */
  var spd = (shot.speed || 420) * dpr;
  projectiles.push({
    id: shot.shotId || nextShotId(),
    x: x,
    y: y,
    vx: (shot.vx || 0) * dpr,
    vy: spd,
    ally: false,
    dmg: shot.dmg || dmg || myDmg,
    big: !!shot.big,
    scale: shot.scale || (shot.big ? 1.8 : 1),
    move: shot.move || 'normal',
  });
}

/* ─── Receive fire events from server ─── */
socket.on('enemyFire', function (data) {
  if (!gameRunning) return;
  spawnEnemyShot(data);
  if (opFighter && opFighter.char) sfx.playWeapon(opFighter.char.assetIndex || 1, true);
});

socket.on('specFire', function (data) {
  if (!gameRunning || !gameData) return;
  var isFirstPlayer = data.fromId === gameData.fighterIds[0];
  if (isFirstPlayer) {
    spawnPlayerShot(data);
  } else {
    spawnEnemyShot(data);
  }
});

socket.on('hpUpdate', function (data) {
  if (!gameData) return;
  var isMe = false, isTop = false;
  if (amFighter) {
    if (data.id === socket.id) { myHp = data.hp; myMaxHp = data.maxHp || myMaxHp; isMe = true; }
    else { opHp = data.hp; opMaxHp = data.maxHp || opMaxHp; isTop = true; }
  } else {
    if (data.id === gameData.fighterIds[0]) { myHp = data.hp; myMaxHp = data.maxHp || myMaxHp; isMe = true; }
    else { opHp = data.hp; opMaxHp = data.maxHp || opMaxHp; isTop = true; }
  }
  
  if (data.dmg) {
    floatingTexts.push({
      txt: '-' + data.dmg,
      x: cv.width / 2 + (Math.random() * 40 - 20) * dpr,
      y: (isTop ? cv.height * HOLE_TOP_FRAC : cv.height * HOLE_BOTTOM_FRAC) + (Math.random() * 20 - 10) * dpr,
      alpha: 1.0,
      color: '#ef4444'
    });
    // Screen shake
    var arenaOuter = document.querySelector('.arena-outer');
    if (arenaOuter) {
      arenaOuter.classList.remove('shaking');
      void arenaOuter.offsetWidth; // trigger reflow
      arenaOuter.classList.add('shaking');
    }
  }
  
  updateHpBars();
});

/* ─── Secret Events ─── */
socket.on('smokeEffect', function(data) {
  if (!gameRunning) return;
  var isMe = amFighter && (socket.id === data.sourceId);
  var smokeObj = { isPlayerSource: isMe, particles: [], alpha: 0, active: true };
  activeSmokes.push(smokeObj);
  setTimeout(function() { smokeObj.active = false; }, 30000); // Clear after 30s
});

socket.on('cloneRushEffect', function(data) {
  if (!gameRunning) return;
  var isPlayerSource = amFighter && (socket.id === data.sourceId);
  var rushStartY = isPlayerSource ? cv.height - 40 : 40;
  var targetY = isPlayerSource ? 40 : cv.height - 40;
  
  var lxs = holeXs(cv.width, HOLE_COUNT);
  for(var i of [0, 2, 4]) {
    cloneRushes.push({
      start: lxs[i], x: lxs[i], y: rushStartY, targetY: targetY, 
      img: (isPlayerSource ? myAvatarImg : opAvatarImg), 
      vy: 60 * dpr, // Extremely slow: roughly 8 seconds to cross screen
      isUp: isPlayerSource
    });
  }
});

/* ─── Arrow vs arrow collision ─── */
function resolveCollisions() {
  var n = projectiles.length;
  if (n < 2) return;
  var dead = [];
  for (var z = 0; z < n; z++) dead[z] = false;
  var rr = 12 * dpr, rr2 = rr * rr;
  var colSound = false;
  for (var i = 0; i < n; i++) {
    if (dead[i]) continue;
    for (var j = i + 1; j < n; j++) {
      if (dead[j]) continue;
      if (projectiles[i].ally === projectiles[j].ally) continue;
      var dx = projectiles[i].x - projectiles[j].x, dy = projectiles[i].y - projectiles[j].y;
      if (dx * dx + dy * dy <= rr2) { dead[i] = true; dead[j] = true; colSound = true; }
    }
  }
  if (colSound) sfx.playCollision();
  var out = [];
  for (var k = 0; k < n; k++) if (!dead[k]) out.push(projectiles[k]);
  projectiles = out;
}

function projectileRadius(p) {
  return (p.big ? 18 : 12) * (p.scale || 1) * dpr;
}

function projectileTouchesAvatar(p, layout) {
  var r = projectileRadius(p);
  var hitW = layout.iw * 0.72;
  var hitH = layout.ih * 0.72;
  return Math.abs(p.x - layout.cx) <= hitW / 2 + r && Math.abs(p.y - layout.cy) <= hitH / 2 + r;
}

/* ═══ GAME LOOP ═══ */
function loop(now) {
  if (!gameRunning) return;
  var dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  /* VS intro phase — draw VS screen instead of gameplay */
  if (vsPhase) {
    drawVsScreen(now);
    loopRafId = requestAnimationFrame(loop);
    return;
  }

  var w = cv.width, h = cv.height;

  /* Screen resize dynamically per frame to avoid blur */
  resize();

  /* Collisions */
  resolveCollisions();

  /* Move & collide projectiles */
  var OL = opLayout();
  var ML = myLayout();

  for (var i = projectiles.length - 1; i >= 0; i--) {
    var p = projectiles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    /* Out of bounds */
    if (p.x < 0 || p.x > w || p.y < -30 || p.y > h + 30) {
      projectiles.splice(i, 1);
      continue;
    }

    /* Ally projectile hitting OPPONENT avatar (top) — damage only on avatar touch */
    if (p.ally && opHp > 0) {
      if (projectileTouchesAvatar(p, OL)) {
        projectiles.splice(i, 1);
        /* Actually reduce opponent HP and tell server */
        if (amFighter) {
          sfx.playHitOpponent();
          opHp = Math.max(0, opHp - p.dmg);
          updateHpBars();
          socket.emit('hitOpponent', { dmg: p.dmg, hitId: p.id });
        }
        continue;
      }
    }

    /* Enemy projectile hitting MY avatar (bottom) — damage only on avatar touch */
    if (!p.ally && myHp > 0) {
      if (projectileTouchesAvatar(p, ML)) {
        projectiles.splice(i, 1);
        if (amFighter) {
          sfx.playTakeDamage();
          myHp = Math.max(0, myHp - p.dmg);
          if (myHp > 0 && myHp < myMaxHp * 0.25) sfx.playLowHpWarning();
          updateHpBars();
          socket.emit('takeDamage', { dmg: p.dmg, hitId: p.id });
        }
        continue;
      }
    }

    /* Remove projectiles that pass beyond the avatar zones without hitting */
    if (p.ally && p.y < 0) { projectiles.splice(i, 1); continue; }
    if (!p.ally && p.y > cv.height) { projectiles.splice(i, 1); continue; }
  }

  /* ═══ DRAW ═══ */
  ctx.clearRect(0, 0, w, h);

  /* Draw transparent mystical gradient to lightly tint the underlying CSS environment image */
  var grd = ctx.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, 'rgba(60, 30, 90, 0.25)');
  grd.addColorStop(0.5, 'rgba(30, 15, 50, 0.15)');
  grd.addColorStop(1, 'rgba(20, 40, 35, 0.35)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);

  /* Draw lane lines (subtle) */
  var laneXs = holeXs(w, HOLE_COUNT);
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.08)';
  ctx.lineWidth = 1 * dpr;
  for (var ln = 0; ln < HOLE_COUNT; ln++) {
    ctx.beginPath();
    ctx.moveTo(laneXs[ln], 0);
    ctx.lineTo(laneXs[ln], h);
    ctx.stroke();
  }

  /* ─── Draw OPPONENT avatar (top) ─── */
  /* Opponent name label — only user-entered name, NOT character names */
  ctx.fillStyle = '#fca5a5';
  ctx.font = 'bold ' + Math.round(10 * dpr) + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(opFighter.username, OL.cx, OL.cy - OL.ih / 2 - 4 * dpr);

  if (opAvatarLoaded) {
    ctx.save();
    ctx.shadowColor = 'rgba(185, 28, 28, 0.7)';
    ctx.shadowBlur = 22 * dpr;
    /* source-over: renders avatar fully visible on the canvas */
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(opAvatarImg, OL.cx - OL.iw / 2, OL.cy - OL.ih / 2, OL.iw, OL.ih);
    ctx.restore();
  } else {
    ctx.fillStyle = 'rgba(180, 80, 80, 0.4)';
    ctx.fillRect(OL.cx - OL.iw / 2, OL.cy - OL.ih / 2, OL.iw, OL.ih);
  }

  /* ─── Draw MY avatar (bottom) ─── */
  /* My name label — only user-entered name */
  ctx.fillStyle = '#86efac';
  ctx.font = 'bold ' + Math.round(10 * dpr) + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(myFighter.username, ML.cx, ML.cy + ML.ih / 2 + 12 * dpr);

  if (myAvatarLoaded) {
    ctx.save();
    ctx.shadowColor = 'rgba(34, 197, 94, 0.6)';
    ctx.shadowBlur = 22 * dpr;
    /* source-over: renders avatar fully visible on the canvas */
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(myAvatarImg, ML.cx - ML.iw / 2, ML.cy - ML.ih / 2, ML.iw, ML.ih);
    ctx.restore();
  } else {
    ctx.fillStyle = 'rgba(80, 180, 80, 0.4)';
    ctx.fillRect(ML.cx - ML.iw / 2, ML.cy - ML.ih / 2, ML.iw, ML.ih);
  }

  /* ─── Draw PROJECTILES as weapon images ─── */
  var PROJ_SIZE = 22 * dpr;
  for (var j = 0; j < projectiles.length; j++) {
    var q = projectiles[j];
    var pSize = PROJ_SIZE * (q.scale || 1) * (q.big ? 1.25 : 1);
    ctx.save();
    ctx.translate(q.x, q.y);

    /* Glow for power blast projectiles */
    if (q.big) {
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 20 * dpr;
    }

    var weaponImg = q.ally ? myWeaponImg : opWeaponImg;
    var weaponLoaded = q.ally ? myWeaponLoaded : opWeaponLoaded;
    /* source-over: render weapon projectiles fully visible */
    ctx.globalCompositeOperation = 'source-over';
    if (weaponLoaded) {
      var aw = pSize;
      var ah = pSize * (weaponImg.height / weaponImg.width);
      ctx.drawImage(weaponImg, -aw / 2, -ah / 2, aw, ah);
    } else {
      /* Fallback triangle */
      ctx.rotate(q.ally ? 0 : Math.PI);
      ctx.fillStyle = q.ally ? '#fbbf24' : '#f87171';
      ctx.beginPath();
      ctx.moveTo(0, -8 * dpr);
      ctx.lineTo(6 * dpr, 8 * dpr);
      ctx.lineTo(-6 * dpr, 8 * dpr);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  /* ─── Draw hole markers at unit 2 (top) and unit 8 (bottom) ─── */
  var topXs = holeXs(w, HOLE_COUNT);
  var botXs = holeXs(w, HOLE_COUNT);
  var topHoleY = h * HOLE_TOP_FRAC;
  var botHoleY = h * HOLE_BOTTOM_FRAC;
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
  ctx.lineWidth = 2 * dpr;
  for (var t = 0; t < HOLE_COUNT; t++) {
    /* Top holes (unit 2) */
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.arc(topXs[t], topHoleY, 5 * dpr, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(topXs[t], topHoleY, 6 * dpr, 0, Math.PI * 2); ctx.stroke();
    /* Bottom holes (unit 8) */
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.arc(botXs[t], botHoleY, 5 * dpr, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(botXs[t], botHoleY, 6 * dpr, 0, Math.PI * 2); ctx.stroke();
  }

  /* ─── Floating Damage Texts ─── */
  for (var f = floatingTexts.length - 1; f >= 0; f--) {
    var ft = floatingTexts[f];
    ft.y -= 100 * dt * dpr;
    ft.alpha -= 0.8 * dt;
    if (ft.alpha <= 0) { floatingTexts.splice(f, 1); continue; }
    ctx.fillStyle = 'rgba(239, 68, 68, ' + ft.alpha + ')';
    ctx.font = 'bold ' + 24 * dpr + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
    ctx.fillText(ft.txt, ft.x, ft.y);
    ctx.shadowBlur = 0; /* reset */
  }

  /* ─── CLONE RUSH ANIMATION ─── */
  for (var i = cloneRushes.length - 1; i >= 0; i--) {
    var c = cloneRushes[i];
    
    if (c.isUp) c.y -= c.vy * (dt||0.016);
    else c.y += c.vy * (dt||0.016);
    
    // Zig-zag weave (slow horizontal sway)
    c.x = c.start + Math.sin(c.y / 15) * 40 * dpr;
    
    ctx.globalAlpha = 0.6;
    if (c.img) {
      try {
        ctx.drawImage(c.img, c.x - 20*dpr, c.y - 20*dpr, 40*dpr, 40*dpr);
      } catch(e) {
        // Fallback or ignore broken image to prevent loop crash
      }
    }
    ctx.globalAlpha = 1.0;
    
    if ((c.isUp && c.y <= c.targetY) || (!c.isUp && c.y >= c.targetY)) {
      cloneRushes.splice(i, 1);
      // Let the server push HP update via hpUpdate event, no local math!
    }
  }

  /* ─── SMOKE STEALTH RENDER ─── */
  for (var i = activeSmokes.length - 1; i >= 0; i--) {
    var smk = activeSmokes[i];
    if (smk.active) {
      smk.alpha = Math.min(1, smk.alpha + (dt||0.016) * 2);
      if (smk.particles.length < 250) {
        // If my side, bottom 25%. If opponent, top 25%.
        var yZone = smk.isPlayerSource ? (h - Math.random()*(h*0.25)) : (Math.random()*(h*0.25));
        
        smk.particles.push({
          x: Math.random() * w, y: yZone,
          r: (20 + Math.random() * 40) * dpr,
          vx: (Math.random() - 0.5) * 20 * dpr, vy: (Math.random() - 0.5) * 10 * dpr
        });
      }
    } else {
      smk.alpha = Math.max(0, smk.alpha - (dt||0.016) * 2);
    }
    
    if (smk.alpha > 0) {
      ctx.globalAlpha = smk.alpha;
      for (var p = 0; p < smk.particles.length; p++) {
        var sp = smk.particles[p];
        sp.x += sp.vx * (dt||0.016); sp.y += sp.vy * (dt||0.016);
        if(sp.x < -100) sp.x = w+100; if(sp.x > w+100) sp.x = -100;
        var radGrad = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, sp.r);
        radGrad.addColorStop(0, 'rgba(100,105,110,0.95)');
        radGrad.addColorStop(1, 'rgba(80,85,90,0)');
        ctx.fillStyle = radGrad;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, sp.r, 0, Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha = 1.0;
    } else {
      activeSmokes.splice(i, 1);
    }
  }

  /* ─── End state overlay ─── */
  if (opHp <= 0 && amFighter) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fde68a'; ctx.font = 'bold ' + 20 * dpr + 'px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('🏆 You won!', w / 2, h * 0.48);
  }
  if (myHp <= 0 && amFighter) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fca5a5'; ctx.font = 'bold ' + 20 * dpr + 'px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('You were defeated', w / 2, h * 0.48);
  }

  loopRafId = requestAnimationFrame(loop);
}

/* ═══ CONFETTI ═══ */
function launchConfetti() {
  var colors = ['#fbbf24', '#fb7185', '#38bdf8', '#34d399', '#c084fc'];
  for (var i = 0; i < 40; i++) {
    var s = document.createElement('span');
    s.className = 'confetti';
    s.style.left = Math.random() * 100 + '%';
    s.style.background = colors[i % colors.length];
    s.style.animationDelay = Math.random() * 0.4 + 's';
    document.body.appendChild(s);
    setTimeout(function (el) { el.remove(); }, 2200, s);
  }
}
