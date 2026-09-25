'use strict';

const $ = (id) => document.getElementById(id);

const ui = {
  count: $('player-count'),
  apply: $('apply-count'),
  names: $('name-fields'),
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
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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
}

function stopCurrentTimer() {
  if (!running || activeIndex < 0) return;
  const now = Date.now();
  const elapsed = Math.max(0, now - activeStartMs);
  players[activeIndex].totalMs += elapsed;
  players[activeIndex].turns += 1;
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
  const totalAll = players.reduce((sum, p) => sum + p.totalMs, 0);
  const turnsAll = players.reduce((sum, p) => sum + p.turns, 0);
  const groupAvg = turnsAll > 0 ? totalAll / turnsAll : 0;
  const maxTotal = Math.max(...players.map((p) => p.totalMs), 1);

  ui.globalSummary.textContent = `Total game turn time: ${formatMs(totalAll)} across ${turnsAll} turns. Group average per turn: ${formatMs(groupAvg)}.`;

  ui.bars.innerHTML = players.map((p) => {
    const width = Math.max(8, Math.round((p.totalMs / maxTotal) * 100));
    return `
      <div class="bar-row">
        <div class="bar-label">${escapeHtml(p.name)}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${width}%; background:${p.color};">${formatMs(p.totalMs)}</div>
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

  ui.results.classList.remove('hidden');
}

function rebuildWithCount() {
  const count = Number(ui.count.value);
  const previousNames = players.map((player) => player.name);
  createPlayers(count, previousNames);
  resetRunningState();
  turnCount = 0;
  ui.results.classList.add('hidden');
  updateStatus('Ready. Press Start First Turn.');
  renderNameFields();
  renderTimers();
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
createPlayers(Number(ui.count.value));
renderNameFields();
renderTimers();
renderResults();
startTick();
