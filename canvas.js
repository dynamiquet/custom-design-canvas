/**
 * Standalone Infinite Canvas Core Application
 */
(function() {
  // --- STATE MANAGEMENT ---
  const state = {
    elements: [],
    selectedIds: [],
    tool: 'select',
    color: '#1f2430',
    arrow: false,
    strokeWidth: 2,
    fontSize: 16,
    panX: 0,
    panY: 0,
    zoom: 1,
    isPanning: false,
    spacePressed: false,
    isLasso: false,
    activeEmbedId: null,
    lassoStart: { x: 0, y: 0 },
    history: [],
    historyIdx: -1,
    user: { id: '', name: 'Anonymous', color: '#4f63d2' },
    boardName: 'My Whiteboard',
    peer: null,
    connections: [],
    remoteUsers: {},
    aiConfig: { provider: 'openrouter', apiKey: '' },
    aiMessages: []
  };

  const DEFAULT_AI_MESSAGE = 'Hi! I can directly read and modify elements on your canvas. Ask me to draw shapes, place sticky notes, clean up layout, or drop custom HTML widgets!';
  const EMBED_TEMPLATES = {
    button: `<button style="padding:10px 14px;border:none;border-radius:999px;background:#4f63d2;color:white;font:600 14px system-ui;cursor:pointer" onclick="this.textContent='Clicked'">Click me</button>`,
    timer: `<div style="font:600 28px system-ui;padding:24px;text-align:center"><span id="t">0</span>s</div><script>let n=0;setInterval(()=>document.getElementById('t').textContent=++n,1000)<\/script>`,
    chart: [
      '<div style="display:flex;align-items:flex-end;gap:10px;height:100%;padding:20px;background:#fff">',
      '<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:8px"><div style="height:48%;background:#4f63d2;border-radius:10px 10px 4px 4px"></div></div>',
      '<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:8px"><div style="height:72%;background:#22c55e;border-radius:10px 10px 4px 4px"></div></div>',
      '<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:8px"><div style="height:36%;background:#f59e0b;border-radius:10px 10px 4px 4px"></div></div>',
      '<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:8px"><div style="height:84%;background:#ef4444;border-radius:10px 10px 4px 4px"></div></div>',
      '</div>'
    ].join('')
  };
  const EMBED_SIZE_PRESETS = {
    desktop: { w: 1440, h: 900 },
    laptop: { w: 1280, h: 800 },
    tablet: { w: 768, h: 1024 },
    phone: { w: 390, h: 844 },
    'phone-small': { w: 375, h: 667 }
  };

  // DOM Handles
  const viewport = document.getElementById('viewport');
  const world = document.getElementById('canvas-world');
  const svgOverlay = document.getElementById('svg-overlay');
  const boardTitleInput = document.getElementById('board-title');
  const colorPicker = document.getElementById('color-picker');
  const fillPicker = document.getElementById('fill-picker');
  const opacitySlider = document.getElementById('opacity-slider');
  const strokeWidthInput = document.getElementById('stroke-width');
  const fontSizeInput = document.getElementById('font-size');
  const arrowToggle = document.getElementById('arrow-toggle');
  const presenceContainer = document.getElementById('presence-avatars');
  const contextMenu = document.getElementById('context-menu');
  const fabAi = document.getElementById('fab-ai');
  const zoomDisplay = document.getElementById('zoom-display');

  // --- INITIALIZATION ---
  function init() {
    setupUserIdentity();
    setupEventListeners();
    setupStorage();
    setupWebRTC();
    render();
    saveHistory();

    // Auto-center viewport
    state.panX = window.innerWidth / 2;
    state.panY = window.innerHeight / 2;
    applyTransform();
    applyToolCursor();
  }

  function ensureArrowMarker() {
    if (!svgOverlay.querySelector('#arrowhead')) {
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttribute('id', 'arrowhead');
      marker.setAttribute('markerWidth', '10');
      marker.setAttribute('markerHeight', '7');
      marker.setAttribute('refX', '9');
      marker.setAttribute('refY', '3.5');
      marker.setAttribute('orient', 'auto');
      marker.setAttribute('markerUnits', 'strokeWidth');
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      poly.setAttribute('points', '0 0, 10 3.5, 0 7');
      marker.appendChild(poly);
      defs.appendChild(marker);
      svgOverlay.appendChild(defs);
    }
  }

  function setupUserIdentity() {
    const saved = localStorage.getItem('canvas_identity');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        state.user = parsed;
      } catch(e) {}
    } else {
      state.user.id = 'usr_' + Math.random().toString(36).substr(2, 9);
      state.user.color = '#' + Math.floor(Math.random()*16777215).toString(16);
      document.getElementById('modal-join').classList.add('active');
    }

    const savedAi = localStorage.getItem('canvas_ai_config');
    if (savedAi) {
      try { state.aiConfig = JSON.parse(savedAi); } catch(e) {}
    }
  }

  // --- PERSISTENCE (localStorage + IndexedDB / Memory fallback) ---
  function setupStorage() {
    const savedElements = localStorage.getItem(`board_${state.boardName}`);
    if (savedElements) {
      try { state.elements = JSON.parse(savedElements); } catch(e) {}
    } else {
      state.elements = [];
    }
    loadAiMessages();
    renderAiMessages();
  }

  function getAiMessagesStorageKey() {
    return `board_${state.boardName}_ai_messages`;
  }

  function loadAiMessages() {
    const savedAiMessages = localStorage.getItem(getAiMessagesStorageKey());
    if (savedAiMessages) {
      try {
        const parsed = JSON.parse(savedAiMessages);
        if (Array.isArray(parsed) && parsed.length > 0) {
          state.aiMessages = parsed.filter(msg => msg && typeof msg.text === 'string' && typeof msg.type === 'string');
          if (state.aiMessages.length > 0) return;
        }
      } catch(e) {}
    }
    state.aiMessages = [{ type: 'ai', text: DEFAULT_AI_MESSAGE }];
  }

  function saveAiMessages() {
    try {
      localStorage.setItem(getAiMessagesStorageKey(), JSON.stringify(state.aiMessages));
    } catch(e) {
      console.warn('Unable to save AI messages. Continuing without chat persistence for this session.');
    }
  }

  function renderAiMessages() {
    const msgs = document.getElementById('ai-messages');
    msgs.innerHTML = '';
    state.aiMessages.forEach((msg) => {
      const div = document.createElement('div');
      div.className = `msg msg-${msg.type}`;
      div.innerText = msg.text;
      msgs.appendChild(div);
    });
    msgs.scrollTop = msgs.scrollHeight;
  }

  function saveBoard() {
    try {
      localStorage.setItem(`board_${state.boardName}`, JSON.stringify(state.elements));
    } catch(e) {
      console.warn('Storage full or restricted. Operations continuing in-memory.');
    }
    broadcastMessage({ type: 'SYNC_BOARD', elements: state.elements });
  }

  function saveHistory() {
    if (state.historyIdx < state.history.length - 1) {
      state.history = state.history.slice(0, state.historyIdx + 1);
    }
    state.history.push(JSON.stringify(state.elements));
    if (state.history.length > 50) state.history.shift();
    else state.historyIdx++;
  }

  function undo() {
    if (state.historyIdx > 0) {
      state.historyIdx--;
      state.elements = JSON.parse(state.history[state.historyIdx]);
      render();
      saveBoard();
    }
  }

  function redo() {
    if (state.historyIdx < state.history.length - 1) {
      state.historyIdx++;
      state.elements = JSON.parse(state.history[state.historyIdx]);
      render();
      saveBoard();
    }
  }

  // --- PEER-TO-PEER WEBRTC COLLABORATION (PeerJS) ---
  function setupWebRTC() {
    const hash = window.location.hash.substring(1);
    const urlParams = new URLSearchParams(hash);
    const roomId = urlParams.get('room');

    state.peer = new Peer();

    state.peer.on('open', (id) => {
      if (roomId && roomId !== id) {
        connectToPeer(roomId);
      }
    });

    state.peer.on('connection', (conn) => {
      registerConnection(conn);
    });
  }

  function connectToPeer(peerId) {
    const conn = state.peer.connect(peerId);
    registerConnection(conn);
  }

  function registerConnection(conn) {
    conn.on('open', () => {
      state.connections.push(conn);
      // Request initial board payload
      conn.send({ type: 'USER_JOIN', user: state.user });
      conn.send({ type: 'SYNC_BOARD', elements: state.elements });
      updatePresenceUI();
    });

    conn.on('data', (data) => {
      handlePeerMessage(data, conn);
    });

    conn.on('close', () => {
      state.connections = state.connections.filter(c => c !== conn);
      updatePresenceUI();
    });
  }

  function handlePeerMessage(data, conn) {
    if (data.type === 'SYNC_BOARD') {
      state.elements = data.elements;
      render();
    } else if (data.type === 'CURSOR_MOVE') {
      state.remoteUsers[data.user.id] = data;
      renderRemoteCursors();
    } else if (data.type === 'USER_JOIN') {
      state.remoteUsers[data.user.id] = { user: data.user, x: 0, y: 0 };
      updatePresenceUI();
    }
  }

  function broadcastMessage(msg) {
    state.connections.forEach(conn => {
      if (conn.open) conn.send(msg);
    });
  }

  function updatePresenceUI() {
    presenceContainer.innerHTML = '';
    // Add current self
    const selfBadge = document.createElement('div');
    selfBadge.className = 'cursor-dot';
    selfBadge.style.background = state.user.color;
    selfBadge.title = `${state.user.name} (You)`;
    presenceContainer.appendChild(selfBadge);

    // Remote users
    Object.values(state.remoteUsers).forEach(u => {
      const badge = document.createElement('div');
      badge.className = 'cursor-dot';
      badge.style.background = u.user.color || '#888';
      badge.title = u.user.name || 'Collaborator';
      presenceContainer.appendChild(badge);
    });
  }

  function renderRemoteCursors() {
    document.querySelectorAll('.remote-cursor').forEach(e => e.remove());
    Object.values(state.remoteUsers).forEach(u => {
      if (!u.x || !u.y) return;
      const el = document.createElement('div');
      el.className = 'remote-cursor';
      const screenPos = worldToScreen(u.x, u.y);
      el.style.left = screenPos.x + 'px';
      el.style.top = screenPos.y + 'px';
      const dot = document.createElement('div');
      dot.className = 'cursor-dot';
      dot.style.background = u.user.color || '#888';

      const label = document.createElement('div');
      label.className = 'cursor-label';
      label.innerText = u.user.name || 'Collaborator';

      el.appendChild(dot);
      el.appendChild(label);
      viewport.appendChild(el);
    });
  }

  // --- CANVAS MATH & COORDINATE CONVERSION ---
  function screenToWorld(sx, sy) {
    const rect = viewport.getBoundingClientRect();
    return {
      x: (sx - rect.left - state.panX) / state.zoom,
      y: (sy - rect.top - state.panY) / state.zoom
    };
  }

  function worldToScreen(wx, wy) {
    return {
      x: wx * state.zoom + state.panX,
      y: wy * state.zoom + state.panY
    };
  }

  function applyTransform() {
    world.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    zoomDisplay.textContent = Math.round(state.zoom * 100) + '%';
    renderMinimap();
  }

  function setZoom(newZoom, centerX, centerY) {
    const rect = viewport.getBoundingClientRect();
    const cx = centerX ?? rect.left + rect.width / 2;
    const cy = centerY ?? rect.top + rect.height / 2;
    const mouseWorld = screenToWorld(cx, cy);
    state.zoom = Math.max(0.1, Math.min(5, newZoom));
    state.panX = cx - rect.left - mouseWorld.x * state.zoom;
    state.panY = cy - rect.top - mouseWorld.y * state.zoom;
    applyTransform();
  }

  function getEmbedDraft() {
    const mode = document.getElementById('embed-type-select').value;
    const url = document.getElementById('embed-url-input').value.trim();
    const html = document.getElementById('embed-code-input').value.trim();
    const w = Math.max(120, parseInt(document.getElementById('embed-width-input').value, 10) || 1440);
    const h = Math.max(120, parseInt(document.getElementById('embed-height-input').value, 10) || 900);
    return { mode, url, html, w, h };
  }

  function applyEmbedSizePreset(preset) {
    const size = EMBED_SIZE_PRESETS[preset];
    if (!size) return;
    document.getElementById('embed-width-input').value = size.w;
    document.getElementById('embed-height-input').value = size.h;
  }

  function applySizePresetToSelection(preset) {
    const size = EMBED_SIZE_PRESETS[preset];
    if (!size || state.selectedIds.length !== 1) return false;
    const el = state.elements.find(item => item.id === state.selectedIds[0]);
    if (!el || el.type === 'line' || el.type === 'path') return false;
    const left = Math.min(el.x, el.x + (el.w || 0));
    const top = Math.min(el.y, el.y + (el.h || 0));
    const cx = left + Math.abs(el.w || 0) / 2;
    const cy = top + Math.abs(el.h || 0) / 2;
    el.w = size.w;
    el.h = size.h;
    el.x = cx - size.w / 2;
    el.y = cy - size.h / 2;
    render();
    saveBoard();
    saveHistory();
    return true;
  }

  function toggleCanvasFullscreen() {
    const app = document.getElementById('app');
    if (document.fullscreenElement === app) document.exitFullscreen();
    else app.requestFullscreen?.();
  }

  function fullscreenSelectedElement() {
    if (state.selectedIds.length !== 1) return false;
    const el = state.elements.find(item => item.id === state.selectedIds[0]);
    if (!el || el.type === 'line' || el.type === 'path') return false;
    const elementNode = world.querySelector(`.element[data-id="${el.id}"]`);
    if (!elementNode) return false;
    if (document.fullscreenElement === elementNode) document.exitFullscreen();
    else elementNode.requestFullscreen?.();
    return true;
  }

  function updateEmbedModalVisibility() {
    const mode = document.getElementById('embed-type-select').value;
    document.getElementById('embed-url-group').style.display = mode === 'url' ? 'block' : 'none';
    document.getElementById('embed-code-group').style.display = mode === 'html' ? 'block' : 'none';
  }

  function updateEmbedPreview() {
    const preview = document.getElementById('embed-preview');
    const { mode, url, html } = getEmbedDraft();
    preview.removeAttribute('src');
    preview.removeAttribute('srcdoc');
    if (mode === 'url') {
      if (!url) {
        preview.srcdoc = '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:#64748b;font:13px system-ui">Paste a URL to preview it here.</div>';
        return;
      }
      preview.src = url;
      return;
    }
    preview.srcdoc = html || '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:#64748b;font:13px system-ui">Paste HTML or pick a starter template.</div>';
  }

  function closeEmbedModal() {
    document.getElementById('modal-embed').classList.remove('active');
  }

  function setActiveEmbed(embedId) {
    state.activeEmbedId = embedId;
    state.elements.forEach(el => {
      if (el.type === 'embed') el.interactive = el.id === embedId;
    });
    render();
  }

  // --- EVENT HANDLERS ---
  let isDrawing = false;
  let currentElement = null;
  let dragStart = { x: 0, y: 0 };
  let elementStart = { x: 0, y: 0, w: 0, h: 0 };
  let multiStart = {};
  let isResizing = false;
  let resizeHandle = '';
  let smartGuides = [];
  let dimLabel = null;

  function setupEventListeners() {
    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

      if (e.code === 'Space' && !state.isPanning) {
        e.preventDefault();
        state.spacePressed = true;
        viewport.style.cursor = 'grab';
      }
      if (e.key === 'v' || e.key === 'V') setTool('select');
      if (e.key === 'r' || e.key === 'R') setTool('rect');
      if (e.key === 'o' || e.key === 'O') setTool('ellipse');
      if (e.key === 'l' || e.key === 'L') setTool('line');
      if (e.key === 'p' || e.key === 'P') setTool('path');
      if (e.key === 't' || e.key === 'T') setTool('text');
      if (e.key === 's' || e.key === 'S') setTool('sticky');
      if (e.key === 'i' || e.key === 'I') { e.preventDefault(); document.getElementById('file-input').click(); }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault(); if (e.shiftKey) redo(); else undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); duplicateSelection(); }
      if ((e.ctrlKey || e.metaKey) && e.key === ']') { e.preventDefault(); bringToFront(); }
      if ((e.ctrlKey || e.metaKey) && e.key === '[') { e.preventDefault(); sendToBack(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); state.selectedIds = state.elements.map(el => el.id); render(); }
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection();
      if (e.key === 'Escape') { state.selectedIds = []; cleanSmartGuides(); setActiveEmbed(null); render(); }
      // Zoom shortcuts
      if (e.key === '=' || e.key === '+') { e.preventDefault(); setZoom(state.zoom * 1.15); }
      if (e.key === '-') { e.preventDefault(); setZoom(state.zoom / 1.15); }
      if (e.key === '0') { e.preventDefault(); setZoom(1); }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        state.spacePressed = false;
        applyToolCursor();
      }
    });

    // Zoom & Pan Wheel Logic
    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        setZoom(state.zoom * (e.deltaY < 0 ? 1.08 : 0.92), e.clientX, e.clientY);
      } else {
        // Trackpad / Scroll Pan
        state.panX -= e.deltaX;
        state.panY -= e.deltaY;
        applyTransform();
      }
    }, { passive: false });

    // Prevent context menu on canvas
    viewport.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const mouse = screenToWorld(e.clientX, e.clientY);
      const clickedEl = state.elements.slice().reverse().find(el => hitTest(el, mouse.x, mouse.y));
      if (clickedEl) {
        if (!state.selectedIds.includes(clickedEl.id)) state.selectedIds = [clickedEl.id];
        render();
      }
      showContextMenu(e.clientX, e.clientY);
    });

    // Pointer Pointer Actions
    viewport.addEventListener('pointerdown', (e) => {
      if (e.target.closest('#minimap-container') || e.target.closest('#ai-sidebar') || e.target.closest('header')) return;
      if (state.activeEmbedId && !e.target.closest('.element-embed')) setActiveEmbed(null);

      // Right-click is handled by contextmenu event, not pointerdown
      if (e.button === 2) return;

      const mouse = screenToWorld(e.clientX, e.clientY);

      // Spacebar Drag Panning
      if (state.spacePressed || e.button === 1) {
        state.isPanning = true;
        dragStart = { x: e.clientX, y: e.clientY };
        viewport.style.cursor = 'grabbing';
        return;
      }

      // Check if clicking resize handle
      if (e.target.classList.contains('resize-handle')) {
        isResizing = true;
        resizeHandle = e.target.dataset.handle || 'se';
        dragStart = mouse;
        const sel = state.elements.find(el => el.id === state.selectedIds[0]);
        if (sel) elementStart = { ...sel };
        render();
        return;
      }

      cleanSmartGuides();

      if (state.tool === 'select') {
        const clickedEl = state.elements.slice().reverse().find(el => hitTest(el, mouse.x, mouse.y));
        if (clickedEl) {
          if (!e.shiftKey && !e.ctrlKey) state.selectedIds = [clickedEl.id];
          else if (e.shiftKey && !state.selectedIds.includes(clickedEl.id)) state.selectedIds.push(clickedEl.id);
          else if (e.shiftKey && state.selectedIds.includes(clickedEl.id)) state.selectedIds = state.selectedIds.filter(id => id !== clickedEl.id);

          isDrawing = true;
          dragStart = mouse;
          multiStart = {};
          state.selectedIds.forEach(id => {
            const el = state.elements.find(e => e.id === id);
            if (el) multiStart[id] = { x: el.x, y: el.y };
          });
        } else {
          state.selectedIds = [];
          if (e.shiftKey) {
            state.isLasso = true;
            state.lassoStart = mouse;
            dragStart = mouse;
            isDrawing = true;
          } else {
            state.isPanning = true;
            dragStart = { x: e.clientX, y: e.clientY };
            viewport.style.cursor = 'grabbing';
          }
        }
        render();
      } else {
        // Creating new shapes
        isDrawing = true;
        const id = 'el_' + Math.random().toString(36).substr(2, 9);
        currentElement = {
          id, type: state.tool, x: mouse.x, y: mouse.y, w: 0, h: 0,
          color: state.color, fill: fillPicker.value, opacity: parseFloat(opacitySlider.value) / 100,
          strokeWidth: state.strokeWidth, fontSize: state.fontSize,
          text: '', points: [[mouse.x, mouse.y]], arrow: state.arrow, z: state.elements.length
        };

        if (state.tool === 'sticky') {
          currentElement.w = 132; currentElement.h = 132;
        } else if (state.tool === 'text') {
          currentElement.w = 120; currentElement.h = 32;
        }

        state.elements.push(currentElement);
        state.selectedIds = [id];
        ensureArrowMarker();
        render();
      }
    });

    viewport.addEventListener('pointermove', (e) => {
      const mouse = screenToWorld(e.clientX, e.clientY);

      // Broadcast mouse cursor to peers
      broadcastMessage({ type: 'CURSOR_MOVE', user: state.user, x: mouse.x, y: mouse.y });

      if (state.isPanning) {
        state.panX += e.clientX - dragStart.x;
        state.panY += e.clientY - dragStart.y;
        dragStart = { x: e.clientX, y: e.clientY };
        applyTransform();
        return;
      }

      if (!isDrawing && !isResizing) return;

      if (isResizing && state.selectedIds.length === 1) {
        const sel = state.elements.find(el => el.id === state.selectedIds[0]);
        if (sel) {
          const dx = mouse.x - dragStart.x;
          const dy = mouse.y - dragStart.y;

          let newX = elementStart.x;
          let newY = elementStart.y;
          let newW = elementStart.w;
          let newH = elementStart.h;

          if (resizeHandle.includes('e')) newW = elementStart.w + dx;
          if (resizeHandle.includes('s')) newH = elementStart.h + dy;
          if (resizeHandle.includes('w')) { newX = elementStart.x + dx; newW = elementStart.w - dx; }
          if (resizeHandle.includes('n')) { newY = elementStart.y + dy; newH = elementStart.h - dy; }

          // Shift = lock aspect ratio
          if (e.shiftKey && (resizeHandle.includes('e') || resizeHandle.includes('w'))) {
            const ratio = Math.abs(elementStart.h / elementStart.w);
            newH = Math.sign(newH) * Math.abs(newW) * ratio;
          }
          if (e.shiftKey && (resizeHandle.includes('n') || resizeHandle.includes('s'))) {
            const ratio = Math.abs(elementStart.w / elementStart.h);
            newW = Math.sign(newW) * Math.abs(newH) * ratio;
          }

          // Normalize negative dimensions
          if (newW < 0) { newX = newX + newW; newW = Math.abs(newW); }
          if (newH < 0) { newY = newY + newH; newH = Math.abs(newH); }

          // Min size
          newW = Math.max(20, newW);
          newH = Math.max(20, newH);

          sel.x = newX; sel.y = newY; sel.w = newW; sel.h = newH;

          renderDimLabel(sel);
          render();
        }
        return;
      }

      if (state.tool === 'select' && state.isLasso) {
        renderLasso(state.lassoStart, mouse);
      } else if (state.tool === 'select' && state.selectedIds.length > 0) {
        const dx = mouse.x - dragStart.x;
        const dy = mouse.y - dragStart.y;
        state.selectedIds.forEach(id => {
          const el = state.elements.find(e => e.id === id);
          if (el && multiStart[id]) {
            el.x = multiStart[id].x + dx;
            el.y = multiStart[id].y + dy;
          }
        });
        updateSmartGuides();
        render();
      } else if (currentElement) {
        if (state.tool === 'rect' || state.tool === 'ellipse') {
          currentElement.w = mouse.x - currentElement.x;
          currentElement.h = mouse.y - currentElement.y;
        } else if (state.tool === 'line') {
          currentElement.points = [[currentElement.x, currentElement.y], [mouse.x, mouse.y]];
        } else if (state.tool === 'path') {
          currentElement.points.push([mouse.x, mouse.y]);
        }
        render();
      }
    });

    viewport.addEventListener('pointerup', (e) => {
      if (state.isPanning) {
        state.isPanning = false;
        applyToolCursor();
      }
      if (state.isLasso) {
        const mouse = screenToWorld(e.clientX, e.clientY);
        const x1 = Math.min(state.lassoStart.x, mouse.x);
        const x2 = Math.max(state.lassoStart.x, mouse.x);
        const y1 = Math.min(state.lassoStart.y, mouse.y);
        const y2 = Math.max(state.lassoStart.y, mouse.y);
        state.selectedIds = state.elements.filter(el => {
          const ex1 = Math.min(el.x, el.x + (el.w || 0));
          const ex2 = Math.max(el.x, el.x + (el.w || 0));
          const ey1 = Math.min(el.y, el.y + (el.h || 0));
          const ey2 = Math.max(el.y, el.y + (el.h || 0));
          return ex2 >= x1 && ex1 <= x2 && ey2 >= y1 && ey1 <= y2;
        }).map(el => el.id);
        state.isLasso = false;
        isDrawing = false;
        removeLasso();
        render();
        return;
      }
      if (isDrawing || isResizing) {
        isDrawing = false;
        isResizing = false;
        resizeHandle = '';
        cleanSmartGuides();
        removeDimLabel();
        let focusNewElementId = '';
        if (currentElement) {
          if (state.tool === 'line') {
            const [start, end] = currentElement.points || [];
            if (start && end && Math.hypot(end[0] - start[0], end[1] - start[1]) < 3) {
              currentElement.points = [start, [start[0] + 140, start[1]]];
            }
          }
          if (['rect', 'ellipse', 'line'].includes(state.tool)) setTool('select');
          if (['sticky', 'text'].includes(state.tool)) {
            setTool('select');
            focusNewElementId = currentElement.id;
          }
          if (state.tool === 'path' && currentElement.points && currentElement.points.length > 2) {
            currentElement.points = smoothPath(currentElement.points, 2);
          }
          ensureArrowMarker();
          currentElement = null;
        }
        render();
        saveBoard();
        saveHistory();
        if (focusNewElementId) focusEditableElement(focusNewElementId);
      }
    });

    // Tool Button Binding
    document.querySelectorAll('#tool-buttons .btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => setTool(btn.dataset.tool));
    });

    colorPicker.addEventListener('input', (e) => {
      state.color = e.target.value;
      state.selectedIds.forEach(id => {
        const el = state.elements.find(e => e.id === id);
        if (el) el.color = state.color;
      });
      render();
      saveBoard();
    });

    fillPicker.addEventListener('input', (e) => {
      state.selectedIds.forEach(id => {
        const el = state.elements.find(e => e.id === id);
        if (el && (el.type === 'rect' || el.type === 'ellipse' || el.type === 'sticky')) {
          el.fill = e.target.value;
        }
      });
      render();
      saveBoard();
    });

    opacitySlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value) / 100;
      state.selectedIds.forEach(id => {
        const el = state.elements.find(e => e.id === id);
        if (el) el.opacity = val;
      });
      render();
      saveBoard();
    });

    arrowToggle.addEventListener('change', (e) => { state.arrow = e.target.checked; });

    strokeWidthInput.addEventListener('input', (e) => {
      state.strokeWidth = Math.max(1, parseInt(e.target.value) || 2);
      state.selectedIds.forEach(id => {
        const el = state.elements.find(el => el.id === id);
        if (el) el.strokeWidth = state.strokeWidth;
      });
      render(); saveBoard();
    });

    fontSizeInput.addEventListener('input', (e) => {
      state.fontSize = Math.max(8, parseInt(e.target.value) || 16);
      state.selectedIds.forEach(id => {
        const el = state.elements.find(el => el.id === id);
        if (el && (el.type === 'text' || el.type === 'sticky')) el.fontSize = state.fontSize;
      });
      render(); saveBoard();
    });

    document.getElementById('btn-zoom-in').addEventListener('click', () => setZoom(state.zoom * 1.2));
    document.getElementById('btn-zoom-out').addEventListener('click', () => setZoom(state.zoom / 1.2));
    zoomDisplay.addEventListener('click', () => setZoom(1));

    boardTitleInput.addEventListener('change', (e) => {
      state.boardName = e.target.value || 'My Whiteboard';
      cleanSmartGuides();
      removeDimLabel();
      setupStorage();
      render();
    });

    // Action Buttons
    document.getElementById('btn-delete').addEventListener('click', deleteSelection);
    document.getElementById('btn-undo').addEventListener('click', undo);
    document.getElementById('btn-redo').addEventListener('click', redo);
    document.getElementById('btn-front').addEventListener('click', () => changeZOrder(1));
    document.getElementById('btn-back').addEventListener('click', () => changeZOrder(-1));
    document.getElementById('btn-fullscreen-canvas').addEventListener('click', toggleCanvasFullscreen);
    document.getElementById('btn-fullscreen-element').addEventListener('click', () => {
      if (!fullscreenSelectedElement()) alert('Select one rectangular element, image, text block, sticky note, or embed first.');
    });
    document.getElementById('btn-apply-size').addEventListener('click', () => {
      const applied = applySizePresetToSelection(document.getElementById('size-preset-toolbar').value);
      if (!applied) alert('Select one rectangular element, image, text block, sticky note, or embed first.');
    });

    document.getElementById('btn-clear').addEventListener('click', () => {
      if (confirm('Clear the entire whiteboard canvas?')) {
        state.elements = [];
        state.selectedIds = [];
        cleanSmartGuides();
        removeDimLabel();
        render();
        saveBoard();
        saveHistory();
      }
    });

    // Image Upload
    const fileInput = document.getElementById('file-input');
    document.getElementById('btn-img').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        const img = new Image();
        img.onload = () => {
          const id = 'el_' + Math.random().toString(36).substr(2, 9);
          // Scale image max 320px
          let w = img.width, h = img.height;
          if (w > 320) { h = (320 / w) * h; w = 320; }
          const center = screenToWorld(window.innerWidth/2, window.innerHeight/2);
          state.elements.push({
            id, type: 'image', x: center.x - w/2, y: center.y - h/2, w, h, src: evt.target.result, z: state.elements.length,
            opacity: parseFloat(opacitySlider.value) / 100
          });
          render(); saveBoard(); saveHistory();
        };
        img.src = evt.target.result;
      };
      reader.readAsDataURL(file);
    });

    // HTML Embed Modal
    const embedModal = document.getElementById('modal-embed');
    const embedTypeSelect = document.getElementById('embed-type-select');
    const embedUrlInput = document.getElementById('embed-url-input');
    const embedCodeInput = document.getElementById('embed-code-input');
    const embedSizePreset = document.getElementById('embed-size-preset');
    const embedWidthInput = document.getElementById('embed-width-input');
    const embedHeightInput = document.getElementById('embed-height-input');
    document.getElementById('btn-embed').addEventListener('click', () => {
      embedModal.classList.add('active');
      updateEmbedModalVisibility();
      updateEmbedPreview();
    });
    document.getElementById('btn-embed-close').addEventListener('click', closeEmbedModal);
    embedTypeSelect.addEventListener('change', () => {
      updateEmbedModalVisibility();
      updateEmbedPreview();
    });
    embedSizePreset.addEventListener('change', () => {
      applyEmbedSizePreset(embedSizePreset.value);
    });
    [embedWidthInput, embedHeightInput].forEach(input => {
      input.addEventListener('input', () => {
        embedSizePreset.value = 'custom';
      });
    });
    embedUrlInput.addEventListener('input', updateEmbedPreview);
    embedCodeInput.addEventListener('input', updateEmbedPreview);
    document.querySelectorAll('[data-embed-template]').forEach(btn => {
      btn.addEventListener('click', () => {
        embedTypeSelect.value = 'html';
        embedCodeInput.value = EMBED_TEMPLATES[btn.dataset.embedTemplate] || '';
        updateEmbedModalVisibility();
        updateEmbedPreview();
      });
    });
    document.getElementById('btn-embed-confirm').addEventListener('click', () => {
      const { mode, url, html, w, h } = getEmbedDraft();
      if (mode === 'url' ? url : html) {
        const center = screenToWorld(window.innerWidth/2, window.innerHeight/2);
        state.elements.push({
          id: 'el_' + Math.random().toString(36).substr(2, 9),
          type: 'embed', x: center.x - w / 2, y: center.y - h / 2, w, h, html, src: url, embedMode: mode, interactive: false, z: state.elements.length,
          opacity: parseFloat(opacitySlider.value) / 100
        });
        render(); saveBoard(); saveHistory();
        closeEmbedModal();
        embedUrlInput.value = '';
        embedCodeInput.value = '';
        embedSizePreset.value = 'desktop';
        applyEmbedSizePreset('desktop');
        updateEmbedPreview();
      }
    });

    // Live Share Link Generation
    document.getElementById('btn-share').addEventListener('click', () => {
      if (state.peer && state.peer.id) {
        const shareUrl = `${window.location.origin}${window.location.pathname}#room=${state.peer.id}`;
        navigator.clipboard.writeText(shareUrl);
        alert('🌐 Peer-to-Peer Live Share link copied to your clipboard!\nSend this link to anyone to edit live together.');
      }
    });

    // Profile Join Modal
    document.getElementById('btn-join-confirm').addEventListener('click', () => {
      const name = document.getElementById('join-name').value || 'Anonymous';
      state.user.name = name;
      localStorage.setItem('canvas_identity', JSON.stringify(state.user));
      document.getElementById('modal-join').classList.remove('active');
      updatePresenceUI();
    });

    // Export Handlers
    document.getElementById('btn-export-json').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ boardName: state.boardName, elements: state.elements }, null, 2)], {type : 'application/json'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${state.boardName}.json`;
      a.click();
    });

    document.getElementById('btn-export-png').addEventListener('click', () => {
      html2canvas(viewport, { ignoreElements: (el) => el.id === 'minimap-container' || el.id === 'ai-sidebar' || el.id === 'hint-banner' }).then(canvas => {
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `${state.boardName}.png`;
        a.click();
      });
    });

    // AI Panel Handlers
    const aiSidebar = document.getElementById('ai-sidebar');
    const aiModal = document.getElementById('modal-ai');
    document.getElementById('btn-ai-toggle').addEventListener('click', () => aiSidebar.classList.toggle('open'));
    document.getElementById('btn-ai-config').addEventListener('click', () => {
      document.getElementById('ai-api-key').value = state.aiConfig.apiKey || '';
      document.getElementById('ai-provider-select').value = state.aiConfig.provider || 'openrouter';
      aiModal.classList.add('active');
    });

    document.getElementById('ai-provider-select').addEventListener('change', (e) => {
      const val = e.target.value;
      document.getElementById('key-link-openrouter').style.display = val === 'openrouter' ? 'inline-block' : 'none';
      document.getElementById('key-link-groq').style.display = val === 'groq' ? 'inline-block' : 'none';
      document.getElementById('key-link-gemini').style.display = val === 'gemini' ? 'inline-block' : 'none';
    });

    document.getElementById('btn-ai-modal-close').addEventListener('click', () => aiModal.classList.remove('active'));
    document.getElementById('btn-ai-save').addEventListener('click', () => {
      state.aiConfig.provider = document.getElementById('ai-provider-select').value;
      state.aiConfig.apiKey = document.getElementById('ai-api-key').value.trim();
      localStorage.setItem('canvas_ai_config', JSON.stringify(state.aiConfig));
      aiModal.classList.remove('active');
    });

    document.getElementById('btn-ai-send').addEventListener('click', sendAiPrompt);
    document.getElementById('ai-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendAiPrompt();
    });

    // Floating AI Button
    fabAi.addEventListener('click', () => {
      const aiSidebar = document.getElementById('ai-sidebar');
      aiSidebar.classList.toggle('open');
    });

    // Context Menu
    contextMenu.addEventListener('click', (e) => {
      const item = e.target.closest('.ctx-item');
      if (!item) return;
      const action = item.dataset.action;
      const sel = state.elements.find(el => el.id === state.selectedIds[0]);
      if (action === 'duplicate') duplicateSelection();
      else if (action === 'front' && sel) { sel.z = Math.max(...state.elements.map(e => e.z || 0)) + 1; state.elements.sort((a,b) => (a.z||0)-(b.z||0)); render(); saveBoard(); }
      else if (action === 'back' && sel) { sel.z = 0; state.elements.sort((a,b) => (a.z||0)-(b.z||0)); render(); saveBoard(); }
      else if (action === 'delete') deleteSelection();
      hideContextMenu();
    });

    document.addEventListener('mousedown', (e) => {
      if (!contextMenu.contains(e.target)) hideContextMenu();
    });

    // Minimap click-to-navigate
    document.getElementById('minimap-container').addEventListener('click', (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      let minX = -1000, maxX = 1000, minY = -1000, maxY = 1000;
      state.elements.forEach(el => {
        minX = Math.min(minX, el.x || 0); maxX = Math.max(maxX, (el.x || 0) + (el.w || 0));
        minY = Math.min(minY, el.y || 0); maxY = Math.max(maxY, (el.y || 0) + (el.h || 0));
      });
      const scale = Math.min(160 / (maxX - minX), 110 / (maxY - minY));
      const worldX = minX + mx / scale;
      const worldY = minY + my / scale;
      const vpRect = viewport.getBoundingClientRect();
      state.panX = vpRect.left + vpRect.width / 2 - worldX * state.zoom;
      state.panY = vpRect.top + vpRect.height / 2 - worldY * state.zoom;
      applyTransform();
    });
  }

  function setTool(toolName) {
    state.tool = toolName;
    document.querySelectorAll('#tool-buttons .btn[data-tool]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === toolName);
    });
    applyToolCursor();
  }

  function applyToolCursor() {
    if (state.spacePressed || state.isPanning) { viewport.style.cursor = 'grab'; return; }
    viewport.className = `tool-${state.tool}`;
    viewport.style.cursor = '';
    if (state.tool === 'select') viewport.style.cursor = 'default';
  }

  function focusEditableElement(elementId) {
    requestAnimationFrame(() => {
      const node = world.querySelector(`.element[data-id="${elementId}"]`);
      if (!node || !node.isContentEditable) return;
      node.focus();
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    });
  }

  function deleteSelection() {
    if (state.selectedIds.length > 0) {
      state.elements = state.elements.filter(el => !state.selectedIds.includes(el.id));
      state.selectedIds = [];
      render(); saveBoard(); saveHistory();
    }
  }

  function duplicateSelection() {
    if (state.selectedIds.length === 0) return;
    const newIds = [];
    state.selectedIds.forEach(id => {
      const old = state.elements.find(e => e.id === id);
      if (old) {
        const newEl = JSON.parse(JSON.stringify(old));
        newEl.id = 'el_' + Math.random().toString(36).substr(2, 9);
        newEl.x += 20; newEl.y += 20;
        newEl.z = state.elements.length;
        state.elements.push(newEl);
        newIds.push(newEl.id);
      }
    });
    state.selectedIds = newIds;
    render(); saveBoard(); saveHistory();
  }

  function bringToFront() {
    if (state.selectedIds.length === 0) return;
    const maxZ = Math.max(...state.elements.map(e => e.z || 0));
    state.selectedIds.forEach(id => {
      const el = state.elements.find(e => e.id === id);
      if (el) el.z = maxZ + 1;
    });
    state.elements.sort((a,b) => (a.z||0)-(b.z||0));
    render(); saveBoard();
  }

  function sendToBack() {
    if (state.selectedIds.length === 0) return;
    state.selectedIds.forEach(id => {
      const el = state.elements.find(e => e.id === id);
      if (el) el.z = 0;
    });
    state.elements.sort((a,b) => (a.z||0)-(b.z||0));
    render(); saveBoard();
  }

  function changeZOrder(delta) {
    state.selectedIds.forEach(id => {
      const el = state.elements.find(e => e.id === id);
      if (el) el.z = Math.max(0, el.z + delta);
    });
    state.elements.sort((a,b) => a.z - b.z);
    render(); saveBoard();
  }

  function showContextMenu(x, y) {
    contextMenu.style.display = 'block';
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    // Keep within viewport
    const rect = contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) contextMenu.style.left = (x - rect.width) + 'px';
    if (rect.bottom > window.innerHeight) contextMenu.style.top = (y - rect.height) + 'px';
  }

  function hideContextMenu() {
    contextMenu.style.display = 'none';
  }

  // --- SMART GUIDES ---
  function renderLasso(start, end) {
    let lasso = document.getElementById('lasso-rect');
    if (!lasso) { lasso = document.createElement('div'); lasso.id = 'lasso-rect'; viewport.appendChild(lasso); }
    const s1 = worldToScreen(start.x, start.y);
    const s2 = worldToScreen(end.x, end.y);
    lasso.style.left = Math.min(s1.x, s2.x) + 'px';
    lasso.style.top = Math.min(s1.y, s2.y) + 'px';
    lasso.style.width = Math.abs(s2.x - s1.x) + 'px';
    lasso.style.height = Math.abs(s2.y - s1.y) + 'px';
  }

  function removeLasso() {
    const lasso = document.getElementById('lasso-rect');
    if (lasso) lasso.remove();
  }

  function cleanSmartGuides() {
    smartGuides.forEach(g => g.remove());
    smartGuides = [];
  }

  function renderDimLabel(el) {
    removeDimLabel();
    const screen = worldToScreen(el.x, el.y);
    const dimEl = document.createElement('div');
    dimEl.className = 'dim-label';
    dimEl.innerText = `${Math.round(el.w)} × ${Math.round(el.h)}`;
    dimEl.style.left = (screen.x + Math.abs(el.w) * state.zoom / 2 - 20) + 'px';
    dimEl.style.top = (screen.y - 24) + 'px';
    viewport.appendChild(dimEl);
    dimLabel = dimEl;
  }

  function removeDimLabel() {
    if (dimLabel && dimLabel.parentNode) dimLabel.parentNode.removeChild(dimLabel);
    dimLabel = null;
  }

  function updateSmartGuides() {
    cleanSmartGuides();
    if (state.selectedIds.length !== 1) return;

    const el = state.elements.find(e => e.id === state.selectedIds[0]);
    if (!el) return;

    const snapThreshold = 12 / state.zoom;
    const elLeft = el.x, elRight = el.x + el.w, elTop = el.y, elBottom = el.y + el.h;
    const elCx = el.x + el.w / 2, elCy = el.y + el.h / 2;

    state.elements.forEach(other => {
      if (!other || state.selectedIds.includes(other.id)) return;
      const oLeft = other.x, oRight = other.x + other.w, oTop = other.y, oBottom = other.y + other.h;
      const oCx = other.x + other.w / 2, oCy = other.y + other.h / 2;

      // Vertical center align
      if (Math.abs(elCx - oCx) < snapThreshold) {
        const screen = worldToScreen(oCx, 0);
        const g = document.createElement('div');
        g.className = 'smart-guide vertical';
        g.style.left = screen.x + 'px';
        viewport.appendChild(g);
        smartGuides.push(g);
        el.x = oCx - el.w / 2;
        multiStart[el.id].x = el.x;
      }
      // Horizontal center align
      if (Math.abs(elCy - oCy) < snapThreshold) {
        const screen = worldToScreen(0, oCy);
        const g = document.createElement('div');
        g.className = 'smart-guide horizontal';
        g.style.top = screen.y + 'px';
        viewport.appendChild(g);
        smartGuides.push(g);
        el.y = oCy - el.h / 2;
        multiStart[el.id].y = el.y;
      }
      // Left edge align
      if (Math.abs(elLeft - oLeft) < snapThreshold) {
        const screen = worldToScreen(oLeft, 0);
        const g = document.createElement('div');
        g.className = 'smart-guide vertical';
        g.style.left = screen.x + 'px';
        viewport.appendChild(g);
        smartGuides.push(g);
        el.x = oLeft;
        multiStart[el.id].x = el.x;
      }
      // Top edge align
      if (Math.abs(elTop - oTop) < snapThreshold) {
        const screen = worldToScreen(0, oTop);
        const g = document.createElement('div');
        g.className = 'smart-guide horizontal';
        g.style.top = screen.y + 'px';
        viewport.appendChild(g);
        smartGuides.push(g);
        el.y = oTop;
        multiStart[el.id].y = el.y;
      }
    });
  }

  function hitTest(el, wx, wy) {
    if (el.type === 'sticky') {
      const inset = Math.min(8, Math.abs(el.w || 0) / 6, Math.abs(el.h || 0) / 6);
      const minX = Math.min(el.x, el.x + el.w) + inset;
      const maxX = Math.max(el.x, el.x + el.w) - inset;
      const minY = Math.min(el.y, el.y + el.h) + inset;
      const maxY = Math.max(el.y, el.y + el.h) - inset;
      return wx >= minX && wx <= maxX && wy >= minY && wy <= maxY;
    }
    if (el.type === 'rect' || el.type === 'image' || el.type === 'embed' || el.type === 'text') {
      const minX = Math.min(el.x, el.x + el.w);
      const maxX = Math.max(el.x, el.x + el.w);
      const minY = Math.min(el.y, el.y + el.h);
      const maxY = Math.max(el.y, el.y + el.h);
      return wx >= minX && wx <= maxX && wy >= minY && wy <= maxY;
    }
    if (el.type === 'ellipse') {
      const rx = el.w / 2, ry = el.h / 2;
      const cx = el.x + rx, cy = el.y + ry;
      return (Math.pow(wx - cx, 2) / (rx * rx) + Math.pow(wy - cy, 2) / (ry * ry)) <= 1;
    }
    if (el.type === 'line' || el.type === 'path') {
      if (!el.points || el.points.length < 2) return false;
      const tolerance = 10 / state.zoom;
      for (let i = 0; i < el.points.length - 1; i++) {
        const p1 = el.points[i], p2 = el.points[i + 1];
        if (pointToLineDistance(wx, wy, p1[0], p1[1], p2[0], p2[1]) < tolerance) return true;
      }
      return false;
    }
    return false;
  }

  function pointToLineDistance(px, py, x1, y1, x2, y2) {
    const A = px - x1, B = py - y1;
    const C = x2 - x1, D = y2 - y1;
    const len_sq = C * C + D * D;
    let param = len_sq === 0 ? -1 : (A * C + B * D) / len_sq;
    let xx = param < 0 ? x1 : (param > 1 ? x2 : x1 + param * C);
    let yy = param < 0 ? y1 : (param > 1 ? y2 : y1 + param * D);
    return Math.sqrt((px - xx) ** 2 + (py - yy) ** 2);
  }

  function smoothPath(points, factor) {
    if (points.length < 3) return points;
    let result = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const last = result[result.length - 1];
      const dist = Math.hypot(points[i][0] - last[0], points[i][1] - last[1]);
      if (dist > 2) result.push(points[i]);
    }
    result.push(points[points.length - 1]);
    for (let iter = 0; iter < factor; iter++) {
      const smoothed = [result[0]];
      for (let j = 0; j < result.length - 1; j++) {
        const p1 = result[j], p2 = result[j + 1];
        smoothed.push([(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]);
        smoothed.push([p2[0], p2[1]]);
      }
      result = smoothed;
    }
    return result;
  }

  // --- RENDERING ENGINE ---
  function render() {
    const svg = svgOverlay;
    svg.innerHTML = '';
    ensureArrowMarker();

    // Keep element DOM nodes stable so selecting/editing doesn't flash or drop fullscreen.
    document.querySelectorAll('.selection-box').forEach(e => e.remove());
    const existingNodes = new Map(
      Array.from(world.querySelectorAll('.element')).map(node => [node.dataset.id, node])
    );
    const seenIds = new Set();

    // Sort elements by Z index
    state.elements.sort((a,b) => (a.z || 0) - (b.z || 0));

    state.elements.forEach(el => {
      if (el.type === 'rect' || el.type === 'ellipse' || el.type === 'sticky' || el.type === 'text' || el.type === 'image' || el.type === 'embed') {
        let div = existingNodes.get(el.id);
        if (!div) {
          div = document.createElement('div');
          div.dataset.id = el.id;
        }
        seenIds.add(el.id);
        div.className = `element element-${el.type}`;
        div.dataset.id = el.id;
        if (div.dataset.renderType !== el.type) div.replaceChildren();
        div.dataset.renderType = el.type;
        div.style.left = Math.min(el.x, el.x + el.w) + 'px';
        div.style.top = Math.min(el.y, el.y + el.h) + 'px';
        div.style.width = Math.abs(el.w) + 'px';
        div.style.height = Math.abs(el.h) + 'px';
        if (el.opacity != null) div.style.opacity = el.opacity;
        div.style.backgroundColor = '';
        div.style.borderColor = '';
        div.style.borderWidth = '';
        div.style.color = '';
        div.style.fontSize = '';
        div.contentEditable = false;
        div.oninput = null;
        div.ondblclick = null;

        if (el.type === 'rect') {
          if (div.firstChild) div.replaceChildren();
          div.style.borderColor = el.color || '#1f2430';
          div.style.borderWidth = (el.strokeWidth || 2) + 'px';
          if (el.fill != null) div.style.backgroundColor = el.fill;
        }
        if (el.type === 'ellipse') {
          if (div.firstChild) div.replaceChildren();
          div.style.borderColor = el.color || '#1f2430';
          div.style.borderWidth = (el.strokeWidth || 2) + 'px';
          if (el.fill != null) div.style.backgroundColor = el.fill;
        }
        if (el.type === 'sticky') {
          div.contentEditable = true;
          if (document.activeElement !== div && div.innerText !== (el.text || '')) div.innerText = el.text || '';
          div.style.fontSize = (el.fontSize || 14) + 'px';
          div.oninput = (e) => { el.text = e.target.innerText; saveBoard(); };
          if (el.fill != null) div.style.backgroundColor = el.fill;
        }
        if (el.type === 'text') {
          div.contentEditable = true;
          if (document.activeElement !== div && div.innerText !== (el.text || 'Click to edit')) div.innerText = el.text || 'Click to edit';
          div.style.color = el.color || '#1f2430';
          div.style.fontSize = (el.fontSize || 16) + 'px';
          div.oninput = (e) => { el.text = e.target.innerText; saveBoard(); };
        }
        if (el.type === 'image') {
          let img = div.querySelector('img');
          if (!img) {
            div.replaceChildren();
            img = document.createElement('img');
            div.appendChild(img);
          }
          if (img.src !== el.src) img.src = el.src;
        }
        if (el.type === 'embed') {
          div.classList.toggle('is-interactive', !!el.interactive);
          div.ondblclick = () => setActiveEmbed(el.id);
          let iframe = div.querySelector('iframe');
          let empty = div.querySelector('.embed-empty');
          const hasEmbedContent = (el.embedMode === 'url' && el.src) || el.html;
          if (hasEmbedContent) {
            if (empty) empty.remove();
            if (!iframe) {
              iframe = document.createElement('iframe');
              iframe.setAttribute('sandbox', 'allow-scripts allow-forms');
              iframe.setAttribute('title', 'Embedded widget');
              div.prepend(iframe);
            }
            if (el.embedMode === 'url' && el.src) {
              if (iframe.src !== el.src) iframe.src = el.src;
              iframe.removeAttribute('srcdoc');
            } else {
              if (iframe.srcdoc !== el.html) iframe.srcdoc = el.html;
              iframe.removeAttribute('src');
            }
          } else {
            if (iframe) iframe.remove();
            if (!empty) {
              empty = document.createElement('div');
              empty.className = 'embed-empty';
              div.prepend(empty);
            }
            empty.textContent = 'Empty embed';
          }

          let shield = div.querySelector('.embed-shield');
          if (!shield) {
            shield = document.createElement('div');
            div.appendChild(shield);
          }
          shield.className = `embed-shield${el.interactive ? ' hidden' : ''}`;
          const hint = document.createElement('div');
          hint.className = 'embed-chip';
          hint.textContent = 'Canvas mode';
          const enterBtn = document.createElement('button');
          enterBtn.className = 'embed-chip embed-chip-btn';
          enterBtn.textContent = 'Enter embed';
          enterBtn.type = 'button';
          const enterEmbed = (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            setActiveEmbed(el.id);
          };
          enterBtn.addEventListener('pointerdown', enterEmbed);
          enterBtn.addEventListener('click', (evt) => evt.preventDefault());
          shield.replaceChildren(hint, enterBtn);

          const oldControls = div.querySelector('.embed-controls');
          if (oldControls) oldControls.remove();
          if (el.interactive) {
            const controls = document.createElement('div');
            controls.className = 'embed-controls';
            const exitBtn = document.createElement('button');
            exitBtn.className = 'embed-chip embed-chip-btn';
            exitBtn.textContent = 'Exit embed';
            exitBtn.type = 'button';
            const exitEmbed = (evt) => {
              evt.preventDefault();
              evt.stopPropagation();
              setActiveEmbed(null);
            };
            exitBtn.addEventListener('pointerdown', exitEmbed);
            exitBtn.addEventListener('click', (evt) => evt.preventDefault());
            controls.appendChild(exitBtn);
            div.appendChild(controls);
          }
        }

        world.appendChild(div);
      } else if (el.type === 'line' || el.type === 'path') {
        if (!el.points || el.points.length < 2) return;
        if (el.type === 'line') {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', el.points[0][0]);
          line.setAttribute('y1', el.points[0][1]);
          line.setAttribute('x2', el.points[1][0]);
          line.setAttribute('y2', el.points[1][1]);
          line.setAttribute('stroke', el.color || '#1f2430');
          line.setAttribute('stroke-width', el.strokeWidth || 2.5);
          line.setAttribute('stroke-linecap', 'round');
          if (el.arrow) line.setAttribute('marker-end', 'url(#arrowhead)');
          if (el.opacity != null) line.style.opacity = el.opacity;
          svg.appendChild(line);
        } else if (el.type === 'path') {
          const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          const pts = el.points.map(p => `${p[0]},${p[1]}`).join(' ');
          poly.setAttribute('points', pts);
          poly.setAttribute('stroke', el.color || '#1f2430');
          poly.setAttribute('stroke-width', el.strokeWidth || 2.5);
          poly.setAttribute('fill', 'none');
          poly.setAttribute('stroke-linecap', 'round');
          poly.setAttribute('stroke-linejoin', 'round');
          if (el.opacity != null) poly.style.opacity = el.opacity;
          svg.appendChild(poly);
        }
      }
    });

    existingNodes.forEach((node, id) => {
      if (!seenIds.has(id)) node.remove();
    });

    // Render Selection Box & Resize Handles
    if (state.selectedIds.length === 1) {
      const sel = state.elements.find(e => e.id === state.selectedIds[0]);
      if (sel && sel.w && sel.h) {
        const box = document.createElement('div');
        box.className = 'selection-box';
        box.style.left = Math.min(sel.x, sel.x + sel.w) + 'px';
        box.style.top = Math.min(sel.y, sel.y + sel.h) + 'px';
        box.style.width = Math.abs(sel.w) + 'px';
        box.style.height = Math.abs(sel.h) + 'px';

        if (sel.type !== 'line' && sel.type !== 'path') {
          ['nw','n','ne','e','se','s','sw','w'].forEach(h => {
            const handle = document.createElement('div');
            handle.className = `resize-handle resize-handle-${h}`;
            handle.dataset.handle = h;
            box.appendChild(handle);
          });
        }
        world.appendChild(box);
      }
    } else if (state.selectedIds.length > 1) {
      // Multi-select bounding box
      const selected = state.elements.filter(e => state.selectedIds.includes(e.id) && e.w && e.h);
      if (selected.length > 0) {
        const bx1 = Math.min(...selected.map(e => Math.min(e.x, e.x + e.w)));
        const by1 = Math.min(...selected.map(e => Math.min(e.y, e.y + e.h)));
        const bx2 = Math.max(...selected.map(e => Math.max(e.x, e.x + e.w)));
        const by2 = Math.max(...selected.map(e => Math.max(e.y, e.y + e.h)));
        const box = document.createElement('div');
        box.className = 'selection-box';
        box.style.left = bx1 + 'px';
        box.style.top = by1 + 'px';
        box.style.width = (bx2 - bx1) + 'px';
        box.style.height = (by2 - by1) + 'px';
        world.appendChild(box);
      }
    }

    // Sync toolbar to selected element's properties
    if (state.selectedIds.length === 1) {
      const sel = state.elements.find(e => e.id === state.selectedIds[0]);
      if (sel) {
        if (sel.color) colorPicker.value = sel.color;
        if (sel.fill) fillPicker.value = sel.fill;
        if (sel.opacity != null) opacitySlider.value = Math.round(sel.opacity * 100);
        if (sel.strokeWidth != null) strokeWidthInput.value = sel.strokeWidth;
        if (sel.fontSize != null) fontSizeInput.value = sel.fontSize;
      }
    }

    renderMinimap();
  }

  // --- MINIMAP RENDERING ---
  function renderMinimap() {
    const canvas = document.getElementById('minimap-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 160; canvas.height = 110;
    ctx.clearRect(0,0,160,110);

    if (state.elements.length === 0) return;

    // Determine bounding bounds
    let minX = -1000, maxX = 1000, minY = -1000, maxY = 1000;
    state.elements.forEach(e => {
      minX = Math.min(minX, e.x || 0); maxX = Math.max(maxX, (e.x || 0) + (e.w || 0));
      minY = Math.min(minY, e.y || 0); maxY = Math.max(maxY, (e.y || 0) + (e.h || 0));
    });

    const scaleX = 160 / (maxX - minX);
    const scaleY = 110 / (maxY - minY);
    const scale = Math.min(scaleX, scaleY);

    ctx.fillStyle = '#4f63d2';
    state.elements.forEach(e => {
      const mx = (e.x - minX) * scale;
      const my = (e.y - minY) * scale;
      const mw = Math.max(3, (e.w || 10) * scale);
      const mh = Math.max(3, (e.h || 10) * scale);
      ctx.fillRect(mx, my, mw, mh);
    });

    // Viewport Overlay Rect
    const vpRect = document.getElementById('minimap-viewport-rect');
    const vScreen = screenToWorld(0, 0);
    const vScreenEnd = screenToWorld(window.innerWidth, window.innerHeight);

    const vx = (vScreen.x - minX) * scale;
    const vy = (vScreen.y - minY) * scale;
    const vw = (vScreenEnd.x - vScreen.x) * scale;
    const vh = (vScreenEnd.y - vScreen.y) * scale;

    vpRect.style.left = Math.max(0, vx) + 'px';
    vpRect.style.top = Math.max(0, vy) + 'px';
    vpRect.style.width = Math.min(160, vw) + 'px';
    vpRect.style.height = Math.min(110, vh) + 'px';
  }

  // --- AI ASSISTANT EXECUTION ENGINE ---
  async function sendAiPrompt() {
    const input = document.getElementById('ai-input');
    const sendButton = document.getElementById('btn-ai-send');
    const prompt = input.value.trim();
    if (!prompt) return;

    if (!state.aiConfig.apiKey) {
      alert('Please click the ⚙️ Key button inside the AI panel to set up your free API key!');
      return;
    }

    appendAiMsg(prompt, 'user');
    input.value = '';

    // Create JSON Context Summary
    const boardContext = state.elements.map(e => ({
      id: e.id, type: e.type, x: Math.round(e.x), y: Math.round(e.y),
      w: Math.round(e.w), h: Math.round(e.h), text: e.text || '',
      color: e.color, fill: e.fill, opacity: e.opacity, z: e.z
    }));

    const systemPrompt = `You are a canvas assistant that directly reads and modifies elements on an infinite whiteboard.
Output ONLY a JSON array of commands inside a \`\`\`json code block, followed by a brief explanation.
Supported actions:
- { "action": "add", "type": "sticky"|"rect"|"ellipse"|"text"|"line"|"embed", "x": number, "y": number, "w": number, "h": number, "text": "string", "color": "#hex", "fill": "#hex", "opacity": float, "arrow": boolean }
- { "action": "delete", "id": "el_xxx" }
- { "action": "move", "id": "el_xxx", "x": number, "y": number }
- { "action": "update", "id": "el_xxx", "color": "#hex", "fill": "#hex", "opacity": float, "text": "string", "w": number, "h": number }
- { "action": "clear" }

Canvas is infinite, coordinates are in world space (0,0 = canvas center). Element IDs look like "el_random".
Current Board Context (z-index sorted): ${JSON.stringify(boardContext)}`;

    let loadingState = null;
    input.disabled = true;
    sendButton.disabled = true;

    try {
      loadingState = startAiLoadingIndicator(state.aiConfig.provider);

      let endpoint = '';
      let headers = { 'Content-Type': 'application/json' };
      let body = {};

      if (state.aiConfig.provider === 'openrouter') {
        endpoint = 'https://openrouter.ai/api/v1/chat/completions';
        headers['Authorization'] = `Bearer ${state.aiConfig.apiKey}`;
        body = {
          model: 'openrouter/free',
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }]
        };
      } else if (state.aiConfig.provider === 'groq') {
        endpoint = 'https://api.groq.com/openai/v1/chat/completions';
        headers['Authorization'] = `Bearer ${state.aiConfig.apiKey}`;
        body = {
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }]
        };
      } else if (state.aiConfig.provider === 'gemini') {
        endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${state.aiConfig.apiKey}`;
        body = { contents: [{ parts: [{ text: systemPrompt + '\n\n' + prompt }] }] };
      }

      const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
      const data = await res.json();

      if (!res.ok) {
        const apiErrorMessage =
          data?.error?.message ||
          data?.message ||
          (typeof data?.error === 'string' ? data.error : '') ||
          res.statusText ||
          'Unknown error';

        console.error('AI API request failed', {
          provider: state.aiConfig.provider,
          endpoint,
          status: res.status,
          statusText: res.statusText,
          response: data
        });

        throw new Error(`AI request failed (${res.status}): ${apiErrorMessage}`);
      }

      let replyText = '';
      if (state.aiConfig.provider === 'gemini') {
        replyText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } else {
        replyText = data?.choices?.[0]?.message?.content || '';
      }

      if (!replyText) {
        console.error('AI API response missing assistant content', {
          provider: state.aiConfig.provider,
          endpoint,
          response: data
        });
        throw new Error('AI response missing expected message content. Check console for full response payload.');
      }

      // Parse JSON commands out of AI response
      const match = replyText.match(/```json\s*([\s\S]*?)\s*```/);
      if (match) {
        try {
          const cmds = JSON.parse(match[1]);
          cmds.forEach(cmd => {
            if (cmd.action === 'add') {
              const newEl = {
                id: 'el_' + Math.random().toString(36).substr(2, 9),
                type: cmd.type || 'sticky',
                x: cmd.x || 0, y: cmd.y || 0,
                w: cmd.w || (cmd.type === 'text' ? 120 : cmd.type === 'sticky' ? 132 : 160),
                h: cmd.h || (cmd.type === 'text' ? 32 : cmd.type === 'sticky' ? 132 : 160),
                text: cmd.text || '',
                color: cmd.color || '#1f2430',
                fill: cmd.fill || undefined,
                opacity: cmd.opacity != null ? cmd.opacity : 1,
                arrow: cmd.arrow || false,
                points: cmd.points || null,
                strokeWidth: cmd.strokeWidth || 2,
                fontSize: cmd.fontSize || 16,
                z: state.elements.length
              };
              if (cmd.type === 'sticky' && !cmd.w) { newEl.w = 132; newEl.h = 132; }
              state.elements.push(newEl);
            } else if (cmd.action === 'delete') {
              state.elements = state.elements.filter(e => e.id !== cmd.id);
            } else if (cmd.action === 'move') {
              const el = state.elements.find(e => e.id === cmd.id);
              if (el) { el.x = cmd.x; el.y = cmd.y; }
            } else if (cmd.action === 'update') {
              const el = state.elements.find(e => e.id === cmd.id);
              if (el) {
                if (cmd.color != null) el.color = cmd.color;
                if (cmd.fill != null) el.fill = cmd.fill;
                if (cmd.opacity != null) el.opacity = cmd.opacity;
                if (cmd.text != null) el.text = cmd.text;
                if (cmd.w != null) el.w = cmd.w;
                if (cmd.h != null) el.h = cmd.h;
                if (cmd.arrow != null) el.arrow = cmd.arrow;
              }
            } else if (cmd.action === 'clear') {
              state.elements = [];
            }
          });
          render(); saveBoard(); saveHistory();
        } catch(e) { console.error('Failed to parse AI action commands', e); }
      }

      appendAiMsg(replyText.replace(/```json[\s\S]*?```/g, ''), 'ai');
    } catch(err) {
      console.error('AI request error', err);
      const errMsg = err && err.message
        ? err.message
        : 'Error connecting to AI service. Please verify your API key settings.';
      appendAiMsg(errMsg, 'system');
    } finally {
      stopAiLoadingIndicator(loadingState);
      input.disabled = false;
      sendButton.disabled = false;
      input.focus();
    }
  }

  function startAiLoadingIndicator(provider) {
    const providerName = provider === 'openrouter'
      ? 'OpenRouter'
      : provider === 'groq'
        ? 'Groq'
        : 'Gemini';

    const steps = [
      `Preparing ${providerName} request...`,
      `Sending prompt to ${providerName}...`,
      `Waiting for model output from ${providerName}...`,
      `Still waiting. If this takes too long, check rate limits and model availability.`
    ];

    const loadingEl = appendAiMsg('', 'system', { persist: false });
    const startedAt = Date.now();
    let stepIndex = 0;

    const renderStep = () => {
      const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
      loadingEl.innerText = `${steps[Math.min(stepIndex, steps.length - 1)]} (${elapsedSec}s)`;
      if (stepIndex < steps.length - 1) stepIndex += 1;
    };

    renderStep();
    const intervalId = setInterval(renderStep, 2500);
    return { loadingEl, intervalId };
  }

  function stopAiLoadingIndicator(loadingState) {
    if (!loadingState) return;
    clearInterval(loadingState.intervalId);
    if (loadingState.loadingEl && loadingState.loadingEl.parentNode) {
      loadingState.loadingEl.parentNode.removeChild(loadingState.loadingEl);
    }
  }

  function appendAiMsg(text, type, options = {}) {
    const shouldPersist = options.persist !== false;
    const msgs = document.getElementById('ai-messages');
    const div = document.createElement('div');
    div.className = `msg msg-${type}`;
    div.innerText = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;

    if (shouldPersist) {
      state.aiMessages.push({ type, text });
      saveAiMessages();
    }

    return div;
  }

  // Run initial setup
  window.addEventListener('DOMContentLoaded', init);
})();
