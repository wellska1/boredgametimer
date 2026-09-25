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
let turnHistory = [];
let longPressTimer = 0;
let holdSourceIndex = -1;
let holdTargetIndex = -1;
let holdStartX = 0;
let holdStartY = 0;
let reorderActive = false;
let dragGhost = null;
let dropIndicator = null;
let timersSelectionGuarded = false;

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
      <label for="player-name-${index}">Player ${index + 1}</label>
      <input id="player-name-${index}" data-player-name data-index="${index}" type="text" inputmode="text" autocomplete="off" maxlength="18" value="${escapeHtml(player.name)}">
      <div class="name-row-actions" aria-label="Reorder player ${index + 1}">
        <button type="button" class="order-btn" data-move="up" data-index="${index}" ${index === 0 ? 'disabled' : ''} aria-label="Move ${escapeHtml(player.name)} up">Up</button>
        <button type="button" class="order-btn" data-move="down" data-index="${index}" ${index === players.length - 1 ? 'disabled' : ''} aria-label="Move ${escapeHtml(player.name)} down">Down</button>
      </div>
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

  ui.names.querySelectorAll('button.order-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.index);
      const direction = button.dataset.move === 'up' ? -1 : 1;
      reorderPlayers(index, index + direction);
    });
  });
}

function formatMs(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((ms % 1000) / 100);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  return `${String(totalMinutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
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
    const avg = p.turns > 0 ? formatMs(playerAverageMs(p)) : '--:--:--.-';
    const name = escapeHtml(p.name);
    const currentTurn = isActive ? p.turns + 1 : p.turns;
    return `
      <article class="timer-card ${isActive ? 'active' : ''}" style="--meeple:${p.color};" data-index="${idx}" title="Hold for 1 second to reorder turn order">
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
  wireTimerReorder();
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

  renderNameFields();
  renderTimers();
  renderResults();
  updateStatus(`Turn order updated. ${running ? `Current turn: ${players[activeIndex].name}` : 'Ready. Press Start First Turn.'}`);
}

function wireTimerReorder() {
  const cards = [...ui.timers.querySelectorAll('.timer-card')];
  if (cards.length === 0) return;

  if (!timersSelectionGuarded) {
    ui.timers.addEventListener('selectstart', (event) => {
      event.preventDefault();
    });
    timersSelectionGuarded = true;
  }

  const ensureDropIndicator = () => {
    if (dropIndicator) return dropIndicator;
    dropIndicator = document.createElement('div');
    dropIndicator.className = 'drop-indicator';
    return dropIndicator;
  };

  const removeDropIndicator = () => {
    if (dropIndicator && dropIndicator.parentNode) {
      dropIndicator.parentNode.removeChild(dropIndicator);
    }
  };

  const removeDragGhost = () => {
    if (dragGhost && dragGhost.parentNode) {
      dragGhost.parentNode.removeChild(dragGhost);
    }
    dragGhost = null;
  };

  const buildDragGhost = (card, x, y) => {
    removeDragGhost();
    const rect = card.getBoundingClientRect();
    dragGhost = card.cloneNode(true);
    dragGhost.classList.add('drag-ghost');
    dragGhost.style.width = `${rect.width}px`;
    dragGhost.style.left = `${x - rect.width / 2}px`;
    dragGhost.style.top = `${y - rect.height / 2}px`;
    document.body.appendChild(dragGhost);
  };

  const moveDragGhost = (x, y) => {
    if (!dragGhost) return;
    const rect = dragGhost.getBoundingClientRect();
    dragGhost.style.left = `${x - rect.width / 2}px`;
    dragGhost.style.top = `${y - rect.height / 2}px`;
  };

  const getDropSlotIndex = (pointerY) => {
    const otherCards = [...ui.timers.querySelectorAll('.timer-card')]
      .filter((card) => Number(card.dataset.index) !== holdSourceIndex);

    if (otherCards.length === 0) return 0;

    for (let slot = 0; slot < otherCards.length; slot += 1) {
      const rect = otherCards[slot].getBoundingClientRect();
      if (pointerY < rect.top + rect.height / 2) {
        return slot;
      }
    }

    return otherCards.length;
  };

  const placeDropIndicator = (slotIndex) => {
    const indicator = ensureDropIndicator();
    const otherCards = [...ui.timers.querySelectorAll('.timer-card')]
      .filter((card) => Number(card.dataset.index) !== holdSourceIndex);

    if (otherCards.length === 0) {
      ui.timers.appendChild(indicator);
      return;
    }

    if (slotIndex <= 0) {
      ui.timers.insertBefore(indicator, otherCards[0]);
      return;
    }

    if (slotIndex >= otherCards.length) {
      const lastCard = otherCards[otherCards.length - 1];
      ui.timers.insertBefore(indicator, lastCard.nextSibling);
      return;
    }

    ui.timers.insertBefore(indicator, otherCards[slotIndex]);
  };

  const clearLongPressTimer = () => {
    if (longPressTimer) {
      window.clearTimeout(longPressTimer);
      longPressTimer = 0;
    }
  };

  const clearDragClasses = () => {
    cards.forEach((card) => {
      card.classList.remove('pressing');
      card.classList.remove('dragging');
      card.classList.remove('drag-over');
    });
  };

  const clearState = () => {
    clearLongPressTimer();
    clearDragClasses();
    removeDragGhost();
    removeDropIndicator();
    holdSourceIndex = -1;
    holdTargetIndex = -1;
    holdStartX = 0;
    holdStartY = 0;
    reorderActive = false;
  };

  const removeDocumentListeners = () => {
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerCancel);
  };

  const highlightTargetAtPoint = (x, y) => {
    clearDragClasses();
    const sourceCard = ui.timers.querySelector(`.timer-card[data-index="${holdSourceIndex}"]`);
    if (sourceCard) sourceCard.classList.add(reorderActive ? 'dragging' : 'pressing');

    const slotIndex = getDropSlotIndex(y);
    holdTargetIndex = slotIndex;
    placeDropIndicator(slotIndex);
    moveDragGhost(x, y);
  };

  const onPointerMove = (event) => {
    if (holdSourceIndex < 0) return;

    if (!reorderActive) {
      const movedX = Math.abs(event.clientX - holdStartX);
      const movedY = Math.abs(event.clientY - holdStartY);
      if (movedX > 10 || movedY > 10) {
        removeDocumentListeners();
        clearState();
      }
      return;
    }

    event.preventDefault();
    highlightTargetAtPoint(event.clientX, event.clientY);
  };

  const finishReorder = () => {
    removeDocumentListeners();
    const fromIndex = holdSourceIndex;
    const toIndex = holdTargetIndex;
    const shouldReorder = reorderActive && fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex;
    clearState();
    if (shouldReorder) {
      reorderPlayers(fromIndex, toIndex);
    }
  };

  const onPointerUp = () => {
    finishReorder();
  };

  const onPointerCancel = () => {
    finishReorder();
  };

  cards.forEach((card) => {
    card.addEventListener('contextmenu', (event) => {
      event.preventDefault();
    });

    card.addEventListener('pointerdown', (event) => {
      if (event.button !== undefined && event.button !== 0) return;

      removeDocumentListeners();
      clearState();

      holdSourceIndex = Number(card.dataset.index);
      holdTargetIndex = holdSourceIndex;
      holdStartX = event.clientX;
      holdStartY = event.clientY;
      card.classList.add('pressing');

      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
      document.addEventListener('pointercancel', onPointerCancel);

      longPressTimer = window.setTimeout(() => {
        reorderActive = true;
        card.classList.remove('pressing');
        card.classList.add('dragging');
        buildDragGhost(card, holdStartX, holdStartY);
        highlightTargetAtPoint(holdStartX, holdStartY);
        updateStatus('Reorder mode: drag to another player and release.');
      }, 1000);
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
        <td>${p.turns > 0 ? formatMs(avg) : '--:--:--.-'}</td>
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
renderTimers();
renderResults();
startTick();
