'use strict';

const $ = (id) => document.getElementById(id);

const ui = {
  count: $('player-count'),
  apply: $('apply-count'),
  names: $('name-fields'),
  turnBuckets: $('turn-buckets'),
  toggleConfig: $('toggle-config'),
  configSection: $('config-section'),
  next: $('next-turn'),
  endAll: $('end-all'),
  status: $('status'),
  timers: $('timers'),
  results: $('results'),
  bars: $('bars'),
  body: $('results-body'),
  globalSummary: $('global-summary')
};

const meepleColors = [
  '#d24d57', '#4682b4', '#4aa96c', '#e39d3d', '#8f63d5',
  '#db6fba', '#2f9d8f', '#c46a37', '#a74f7f', '#5e7f3b'
];

let players = [];
let activeIndex = -1;
let running = false;
let paused = false;
let activeStartMs = 0;
let pausedAtMs = 0;
let tickHandle = 0;
let turnCount = 0;
let turnHistory = [];

function createPlayers(count, previousNames = []) {
  players = [];
  for (let i = 0; i < count; i += 1) {
    const fallbackName = `Player ${i + 1}`;
    players.push({
      id: i,
      name: (previousNames[i] || fallbackName).trim() || fallbackName,
      color: meepleColors[i % meepleColors.length],
      totalMs: 0,
      turns: 0
    });
  }
}

function syncNamesFromFields() {
  const inputs = [...ui.names.querySelectorAll('input[data-player-name]')];
  inputs.forEach((input, index) => {
    if (!players[index]) return;
    const fallbackName = `Player ${index + 1}`;
    players[index].name = input.value.trim() || fallbackName;
    input.value = players[index].name;
  });
}

function renderNameFields() {
  ui.names.innerHTML = players.map((player, index) => `
    <div class="name-row">
      <label for="player-name-${index}">Timer ${index + 1}</label>
      <input id="player-name-${index}" data-player-name data-index="${index}" type="text" inputmode="text" autocomplete="off" maxlength="18" value="${escapeHtml(player.name)}">
    </div>
  `).join('');

  ui.names.querySelectorAll('input[data-player-name]').forEach((input) => {
    input.addEventListener('input', () => {
      const index = Number(input.dataset.index);
      if (!players[index]) return;
      const fallbackName = `Player ${index + 1}`;
      players[index].name = input.value.trim() || fallbackName;
      renderTimers();
      renderTurnBuckets();
      if (ui.results && !ui.results.classList.contains('hidden')) {
        renderResults();
      }
    });
    input.addEventListener('blur', () => {
      const index = Number(input.dataset.index);
      if (!players[index]) return;
      const fallbackName = `Player ${index + 1}`;
      players[index].name = input.value.trim() || fallbackName;
      input.value = players[index].name;
      renderTimers();
      renderTurnBuckets();
      if (ui.results && !ui.results.classList.contains('hidden')) {
        renderResults();
      }
    });
  });
}

function formatMs(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function updateStatus(message) {
  ui.status.textContent = message;
}

function elapsedForPlayer(index) {
  if (!running || activeIndex !== index) return 0;
  const now = paused ? pausedAtMs : Date.now();
  return Math.max(0, now - activeStartMs);
}

function playerAverageMs(player) {
  if (player.turns === 0) return 0;
  return player.totalMs / player.turns;
}

function renderTimers() {
  const cards = players.map((p, idx) => {
    const isActive = running && idx === activeIndex;
    const liveTotal = p.totalMs + elapsedForPlayer(idx);
    const avg = p.turns > 0 ? formatMs(playerAverageMs(p)) : '--:--.-';
    const name = escapeHtml(p.name);
    const currentTurn = isActive ? p.turns + 1 : p.turns;
    return `
      <article class="timer-card ${isActive ? 'active' : ''}" style="--meeple:${p.color};">
        <div class="timer-row">
          <span class="player-chip"><span class="meeple" aria-hidden="true"></span>${name}</span>
          <div class="timer-info">
            ${isActive ? `<div class="current-turn">Turn ${currentTurn}</div>` : ''}
            <span class="live-time">${formatMs(liveTotal)}</span>
          </div>
        </div>
        <div class="substats">
          <span>Turns: ${p.turns}</span>
          <span>Avg: ${avg}</span>
        </div>
      </article>
    `;
  }).join('');

  ui.timers.innerHTML = cards;
}

function renderTurnBuckets() {
  if (!ui.turnBuckets) return;

  ui.turnBuckets.innerHTML = players.map((player, index) => `
    <div class="turn-bucket" data-slot="${index}">
      <div class="bucket-label">Turn ${index + 1}</div>
      <button type="button" class="turn-token" draggable="true" data-slot="${index}" aria-label="Turn ${index + 1}: ${escapeHtml(player.name)}">
        <span class="meeple token-meeple" style="--meeple:${player.color};" aria-hidden="true"></span>
        ${escapeHtml(player.name)}
      </button>
    </div>
  `).join('');

  wireTurnBucketReorder();
}

function reorderPlayers(fromIndex, toIndex) {
  if (fromIndex === toIndex) return;
  if (fromIndex < 0 || toIndex < 0) return;
  if (fromIndex >= players.length || toIndex >= players.length) return;

  const activePlayerId = running && activeIndex >= 0 ? players[activeIndex].id : null;
  const [moved] = players.splice(fromIndex, 1);
  players.splice(toIndex, 0, moved);

  if (activePlayerId !== null) {
    activeIndex = players.findIndex((player) => player.id === activePlayerId);
  }

  renderTurnBuckets();
  renderTimers();
  renderResults();
  updateStatus(`Turn order updated. ${running ? `Current turn: ${players[activeIndex].name}` : 'Ready. Press Start First Turn.'}`);
}

function wireTurnBucketReorder() {
  if (!ui.turnBuckets) return;

  const tokens = [...ui.turnBuckets.querySelectorAll('.turn-token')];
  const buckets = [...ui.turnBuckets.querySelectorAll('.turn-bucket')];
  let dragFromSlot = -1;
  let selectedSlot = -1;

  const clearBucketStates = () => {
    buckets.forEach((bucket) => bucket.classList.remove('bucket-over'));
    tokens.forEach((token) => token.classList.remove('token-selected'));
  };

  const moveFromSlotToSlot = (fromSlot, toSlot) => {
    if (!Number.isInteger(fromSlot) || !Number.isInteger(toSlot)) return;
    if (fromSlot < 0 || toSlot < 0) return;
    if (fromSlot >= players.length || toSlot >= players.length) return;
    if (fromSlot === toSlot) return;
    reorderPlayers(fromSlot, toSlot);
  };

  tokens.forEach((token) => {
    token.addEventListener('dragstart', (event) => {
      dragFromSlot = Number(token.dataset.slot);
      token.classList.add('token-selected');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(dragFromSlot));
      }
    });

    token.addEventListener('dragend', () => {
      dragFromSlot = -1;
      clearBucketStates();
    });

    // Mobile fallback when drag-and-drop is unavailable.
    token.addEventListener('click', (event) => {
      event.stopPropagation();
      clearBucketStates();
      selectedSlot = Number(token.dataset.slot);
      token.classList.add('token-selected');
      updateStatus(`Selected ${players[selectedSlot].name}. Tap a turn bucket to place.`);
    });
  });

  buckets.forEach((bucket) => {
    bucket.addEventListener('dragover', (event) => {
      event.preventDefault();
      clearBucketStates();
      bucket.classList.add('bucket-over');
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
    });

    bucket.addEventListener('dragleave', () => {
      bucket.classList.remove('bucket-over');
    });

    bucket.addEventListener('drop', (event) => {
      event.preventDefault();
      const toSlot = Number(bucket.dataset.slot);
      const fromSlot = dragFromSlot >= 0
        ? dragFromSlot
        : Number(event.dataTransfer?.getData('text/plain'));

      dragFromSlot = -1;
      selectedSlot = -1;
      clearBucketStates();
      moveFromSlotToSlot(fromSlot, toSlot);
    });

    bucket.addEventListener('click', () => {
      if (selectedSlot < 0) return;
      const toSlot = Number(bucket.dataset.slot);
      const fromSlot = selectedSlot;
      selectedSlot = -1;
      clearBucketStates();
      moveFromSlotToSlot(fromSlot, toSlot);
    });
  });
}

function selectTimer(index) {
  if (!running || index < 0 || index >= players.length || index === activeIndex) return;
  stopCurrentTimer();
  activeIndex = index;
  activeStartMs = Date.now();
  paused = false;
  updateStatus(`Turn running: ${players[activeIndex].name}`);
  renderTimers();
  renderResults();
}

function resetRunningState() {
  running = false;
  paused = false;
  activeIndex = -1;
  activeStartMs = 0;
  pausedAtMs = 0;
  ui.next.textContent = 'Start First Turn';
  turnHistory = [];
}

function stopCurrentTimer() {
  if (!running || activeIndex < 0) return;
  const now = Date.now();
  const elapsed = Math.max(0, now - activeStartMs);
  players[activeIndex].totalMs += elapsed;
  players[activeIndex].turns += 1;
  // Log the turn
  turnHistory.push({
    playerName: players[activeIndex].name,
    turnNumber: players[activeIndex].turns,
    timeMs: elapsed
  });
}

function pauseResumeTimers() {
  if (!running) return;

  if (paused) {
    // Resume
    const elapsed = Math.max(0, pausedAtMs - activeStartMs);
    activeStartMs = Date.now() - elapsed;
    pausedAtMs = 0;
    paused = false;
    updateStatus(`Turn resumed: ${players[activeIndex].name}`);
  } else {
    // Pause
    pausedAtMs = Date.now();
    paused = true;
    updateStatus(`Turn paused: ${players[activeIndex].name}`);
  }
  renderTimers();
  renderResults();
}

function advanceTurn() {
  if (players.length === 0) return;

  if (!running) {
    activeIndex = 0;
    running = true;
    paused = false;
    activeStartMs = Date.now();
    updateStatus(`Turn running: ${players[activeIndex].name}`);
    ui.next.textContent = 'End Turn / Next Player';
    turnCount += 1;
    renderTimers();
    renderResults();
    return;
  }

  stopCurrentTimer();
  activeIndex = (activeIndex + 1) % players.length;
  activeStartMs = Date.now();
  paused = false;
  turnCount += 1;
  updateStatus(`Turn running: ${players[activeIndex].name}`);
  renderTimers();
  renderResults();
}

function endAllTimers() {
  if (!running && players.every((p) => p.turns === 0 && p.totalMs === 0)) {
    updateStatus('No turns have been recorded yet.');
    return;
  }

  if (running) {
    stopCurrentTimer();
  }

  resetRunningState();
  renderTimers();
  renderResults();
  updateStatus('Session ended. Results are shown below.');
}

function pctDelta(playerAvg, groupAvg) {
  if (groupAvg === 0) return 0;
  return ((playerAvg - groupAvg) / groupAvg) * 100;
}

function renderResults() {
  ui.results.classList.remove('hidden');

  const playerTotals = players.map((player, index) => ({
    player,
    totalMs: player.totalMs + elapsedForPlayer(index)
  }));

  const totalAll = playerTotals.reduce((sum, entry) => sum + entry.totalMs, 0);
  const turnsAll = players.reduce((sum, p) => sum + p.turns, 0);
  const groupAvg = turnsAll > 0 ? totalAll / turnsAll : 0;
  const maxTotal = Math.max(...playerTotals.map((entry) => entry.totalMs), 1);

  ui.globalSummary.textContent = `Total game turn time: ${formatMs(totalAll)} across ${turnsAll} turns. Group average per turn: ${formatMs(groupAvg)}.`;

  ui.bars.innerHTML = playerTotals.map(({ player, totalMs }) => {
    const width = Math.max(8, Math.round((totalMs / maxTotal) * 100));
    return `
      <div class="bar-row">
        <div class="bar-label">${escapeHtml(player.name)}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${width}%; background:${player.color};">${formatMs(totalMs)}</div>
        </div>
      </div>
    `;
  }).join('');

  ui.body.innerHTML = players.map((p) => {
    const avg = playerAverageMs(p);
    const delta = pctDelta(avg, groupAvg);
    const cls = delta > 0 ? 'positive' : 'negative';
    const deltaLabel = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
    return `
      <tr>
        <td>${escapeHtml(p.name)}</td>
        <td>${formatMs(p.totalMs)}</td>
        <td>${p.turns}</td>
        <td>${p.turns > 0 ? formatMs(avg) : '--:--.-'}</td>
        <td class="${p.turns > 0 ? cls : ''}">${p.turns > 0 ? deltaLabel : 'n/a'}</td>
      </tr>
    `;
  }).join('');

  renderTurnLog();
}

function renderTurnLog() {
  const turnLogBody = document.getElementById('turn-log-body');
  if (!turnLogBody) return;

  if (turnHistory.length === 0) {
    turnLogBody.innerHTML = '';
    return;
  }
  
  turnLogBody.innerHTML = turnHistory.map((turn, idx) => `
    <tr>
      <td>${turn.playerName}</td>
      <td>${turn.turnNumber}</td>
      <td>${formatMs(turn.timeMs)}</td>
    </tr>
  `).join('');
}

function rebuildWithCount() {
  const count = Number(ui.count.value);
  const previousNames = players.map((player) => player.name);
  createPlayers(count, previousNames);
  resetRunningState();
  turnCount = 0;
  updateStatus('Ready. Press Start First Turn.');
  renderNameFields();
  renderTurnBuckets();
  renderTimers();
  renderResults();
}

function startTick() {
  if (tickHandle) return;
  tickHandle = window.setInterval(() => {
    if (running) {
      renderTimers();
    }
  }, 100);
}

// Attach event listeners
ui.apply.addEventListener('click', rebuildWithCount);

ui.next.addEventListener('touchend', function(e) {
  e.preventDefault();
  advanceTurn();
});
ui.next.addEventListener('click', function(e) {
  advanceTurn();
});

ui.endAll.addEventListener('touchend', function(e) {
  e.preventDefault();
  pauseResumeTimers();
});
ui.endAll.addEventListener('click', pauseResumeTimers);

ui.toggleConfig.addEventListener('touchend', function(e) {
  e.preventDefault();
  ui.configSection.classList.toggle('collapsed');
  ui.toggleConfig.textContent = ui.configSection.classList.contains('collapsed') ? '+' : '−';
});
ui.toggleConfig.addEventListener('click', () => {
  ui.configSection.classList.toggle('collapsed');
  ui.toggleConfig.textContent = ui.configSection.classList.contains('collapsed') ? '+' : '−';
});

// Initialize the app
ui.configSection.classList.remove('collapsed');
ui.toggleConfig.textContent = '−';
createPlayers(Number(ui.count.value));
renderNameFields();
renderTurnBuckets();
renderTimers();
renderResults();
startTick();
