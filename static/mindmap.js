/* ═══════════════════════════════════════════════════════════════
   학습 마인드맵 - 캔버스 엔진
   대규모 최적화 + 터치 지원 + 자동 저장
   ═══════════════════════════════════════════════════════════════ */

// ── 상수 ──
const COLORS = [
  "#4FC3F7","#81C784","#FFB74D","#E57373",
  "#BA68C8","#4DB6AC","#FFD54F","#F06292",
  "#7986CB","#A1887F","#90A4AE","#AED581"
];
const DPR = window.devicePixelRatio || 1;

// ── 앱 상태 ──
let mapId = null;
let nodes = {};
let edges = {};
let zoom = 1.0;
let panX = 0, panY = 0;
let colorIdx = 0;

// 인터랙션
let mode = "select"; // select | add | connect
let selectedNode = null;
let selectedEdge = null;
let connectingFrom = null;
let draggingNode = null;
let dragOffset = {x:0, y:0};
let isPanning = false;
let panStart = {x:0, y:0};
let lastPanX = 0, lastPanY = 0;

// 터치 (핀치줌)
let touches = {};
let pinchStartDist = 0;
let pinchStartZoom = 1;

// 검색
let searchResults = [];
let searchIdx = 0;

// 자동 저장
let dirty = false;
let saveTimer = null;
let lastSaveTime = 0;

// 캔버스
let canvas, ctx;
let canvasW = 800, canvasH = 600;
let drawnNodes = new Set();

// ═══════════════════════════════════════
// ── 초기화 ──
// ═══════════════════════════════════════

function init() {
  canvas = document.getElementById("mindmap");
  ctx = canvas.getContext("2d");

  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  // 마우스 이벤트
  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("dblclick", onDblClick);
  canvas.addEventListener("wheel", onWheel, {passive: false});
  canvas.addEventListener("contextmenu", e => e.preventDefault());

  // 터치 이벤트
  canvas.addEventListener("touchstart", onTouchStart, {passive: false});
  canvas.addEventListener("touchmove", onTouchMove, {passive: false});
  canvas.addEventListener("touchend", onTouchEnd);

  // 키보드
  document.addEventListener("keydown", onKeyDown);

  // 버튼 바인딩
  bindButtons();

  // 자동 저장 루프
  setInterval(autoSave, 3000);

  // 맵 목록 불러오기
  showMapList();
}

function resizeCanvas() {
  const wrap = document.getElementById("canvas-wrap");
  canvasW = wrap.clientWidth;
  canvasH = wrap.clientHeight;
  canvas.width = canvasW * DPR;
  canvas.height = canvasH * DPR;
  canvas.style.width = canvasW + "px";
  canvas.style.height = canvasH + "px";
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  redraw();
}

function bindButtons() {
  document.getElementById("btn-select").onclick = () => setMode("select");
  document.getElementById("btn-add").onclick = () => setMode("add");
  document.getElementById("btn-connect").onclick = () => setMode("connect");
  document.getElementById("btn-delete").onclick = deleteSelected;
  document.getElementById("btn-zoom-in").onclick = () => applyZoom(zoom * 1.3);
  document.getElementById("btn-zoom-out").onclick = () => applyZoom(zoom / 1.3);
  document.getElementById("btn-zoom-fit").onclick = zoomFit;
  document.getElementById("btn-search-toggle").onclick = toggleSearch;
  document.getElementById("btn-panel-toggle").onclick = toggleDetailPanel;
  document.getElementById("btn-maps").onclick = showMapList;
  document.getElementById("btn-new-map").onclick = createNewMap;
  document.getElementById("btn-save-now").onclick = () => saveToServer(true);
  document.getElementById("btn-layout-radial").onclick = () => autoLayout("radial");
  document.getElementById("btn-layout-tree").onclick = () => autoLayout("tree_v");
  document.getElementById("btn-layout-htree").onclick = () => autoLayout("tree_h");
  document.getElementById("btn-layout-grid").onclick = () => autoLayout("grid");

  // 세부 패널
  document.getElementById("detail-title").addEventListener("input", onDetailTitleChange);
  document.getElementById("detail-text").addEventListener("input", onDetailTextChange);
  document.getElementById("detail-size").addEventListener("input", onDetailSizeChange);

  // 검색
  document.getElementById("search-input").addEventListener("input", doSearch);
  document.getElementById("btn-search-prev").onclick = searchPrev;
  document.getElementById("btn-search-next").onclick = searchNext;

  // 모바일 FAB
  document.getElementById("fab-add").onclick = () => setMode(mode === "add" ? "select" : "add");
  document.getElementById("fab-panel").onclick = toggleDetailPanel;
}

// ═══════════════════════════════════════
// ── 좌표 변환 ──
// ═══════════════════════════════════════

function w2s(wx, wy) {
  return { x: (wx + panX) * zoom, y: (wy + panY) * zoom };
}

function s2w(sx, sy) {
  return { x: sx / zoom - panX, y: sy / zoom - panY };
}

function getViewport() {
  const tl = s2w(0, 0);
  const br = s2w(canvasW, canvasH);
  return { xMin: tl.x, yMin: tl.y, xMax: br.x, yMax: br.y };
}

// ═══════════════════════════════════════
// ── 렌더링 (뷰포트 컬링 + LOD) ──
// ═══════════════════════════════════════

function getLOD() {
  if (zoom < 0.08) return 0;
  if (zoom < 0.2) return 1;
  if (zoom < 0.5) return 2;
  return 3;
}

function getVisibleNodes() {
  const vp = getViewport();
  const margin = 200;
  const visible = [];
  for (const nid in nodes) {
    const n = nodes[nid];
    const r = n.radius || 45;
    if (n.x + r >= vp.xMin - margin && n.x - r <= vp.xMax + margin &&
        n.y + r >= vp.yMin - margin && n.y - r <= vp.yMax + margin) {
      visible.push(nid);
    }
  }
  return visible;
}

function redraw() {
  ctx.clearRect(0, 0, canvasW, canvasH);
  const lod = getLOD();
  const visNodes = new Set(getVisibleNodes());
  drawnNodes = visNodes;

  // 보이는 노드의 엣지
  const visEdges = [];
  for (const eid in edges) {
    const e = edges[eid];
    if ((visNodes.has(e.from_id) || visNodes.has(e.to_id)) &&
        nodes[e.from_id] && nodes[e.to_id]) {
      visEdges.push(eid);
    }
  }

  // 엣지 먼저
  for (const eid of visEdges) drawEdge(eid, lod);
  // 노드
  for (const nid of visNodes) drawNode(nid, lod);
  // 선택 하이라이트
  drawHighlight();

  // 상태 표시
  updateBadges(visNodes.size);
}

function drawNode(nid, lod) {
  const n = nodes[nid];
  const s = w2s(n.x, n.y);
  const sr = (n.radius || 45) * zoom;
  const c = n.color || "#4FC3F7";

  if (sr < 1.5) {
    ctx.fillStyle = c;
    ctx.fillRect(s.x - 1, s.y - 1, 2, 2);
    return;
  }

  if (lod === 0) {
    const sz = Math.max(2, sr * 0.5);
    ctx.fillStyle = c;
    ctx.fillRect(s.x - sz, s.y - sz, sz * 2, sz * 2);
    return;
  }

  // 그림자 (LOD3)
  if (lod >= 3 && sr > 8) {
    ctx.beginPath();
    ctx.arc(s.x + 3, s.y + 3, sr, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fill();
  }

  // 원
  ctx.beginPath();
  ctx.arc(s.x, s.y, sr, 0, Math.PI * 2);
  ctx.fillStyle = c;
  ctx.fill();

  // 테두리
  const isSearch = searchResults.includes(nid);
  ctx.strokeStyle = isSearch ? "#FF4444" : "rgba(255,255,255,0.8)";
  ctx.lineWidth = isSearch ? 3 : 1.5;
  ctx.stroke();

  // 텍스트 (LOD2+)
  if (lod >= 2 && sr > 10) {
    const fontSize = Math.max(8, Math.min(16, 12 * zoom));
    ctx.font = `bold ${fontSize}px -apple-system, sans-serif`;
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const title = n.title || "";
    const maxW = sr * 1.6;
    const lines = wrapText(title, maxW, ctx);
    const lineH = fontSize * 1.25;
    const startY = s.y - ((lines.length - 1) * lineH) / 2;
    for (let i = 0; i < Math.min(lines.length, 3); i++) {
      ctx.fillText(lines[i], s.x, startY + i * lineH, maxW);
    }
  }

  // 세부내용 표시 점 (LOD3)
  if (lod >= 3 && sr > 15 && n.detail && n.detail.trim()) {
    ctx.beginPath();
    const dr = Math.max(3, 4 * zoom);
    ctx.arc(s.x + sr - dr * 2, s.y - sr + dr * 1.5, dr, 0, Math.PI * 2);
    ctx.fillStyle = "#FFD700";
    ctx.fill();
  }
}

function drawEdge(eid, lod) {
  const e = edges[eid];
  const fn = nodes[e.from_id], tn = nodes[e.to_id];
  if (!fn || !tn) return;

  const dx = tn.x - fn.x, dy = tn.y - fn.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return;

  const r1 = fn.radius || 45, r2 = tn.radius || 45;
  const sx = fn.x + (dx / dist) * r1, sy = fn.y + (dy / dist) * r1;
  const ex = tn.x - (dx / dist) * r2, ey = tn.y - (dy / dist) * r2;

  const ss = w2s(sx, sy), se = w2s(ex, ey);

  ctx.beginPath();
  ctx.moveTo(ss.x, ss.y);
  ctx.lineTo(se.x, se.y);
  ctx.strokeStyle = lod <= 1 ? "#555577" : "#AAAACC";
  ctx.lineWidth = Math.max(1, 2 * zoom);
  ctx.stroke();

  // 화살표
  if (lod >= 2) {
    const angle = Math.atan2(se.y - ss.y, se.x - ss.x);
    const aSize = Math.max(6, 12 * zoom);
    ctx.beginPath();
    ctx.moveTo(se.x, se.y);
    ctx.lineTo(se.x - aSize * Math.cos(angle - 0.35), se.y - aSize * Math.sin(angle - 0.35));
    ctx.lineTo(se.x - aSize * Math.cos(angle + 0.35), se.y - aSize * Math.sin(angle + 0.35));
    ctx.closePath();
    ctx.fillStyle = "#AAAACC";
    ctx.fill();
  }

  // 라벨
  if (lod >= 2 && e.label && zoom > 0.3) {
    const mx = (ss.x + se.x) / 2, my = (ss.y + se.y) / 2;
    const fs = Math.max(8, 10 * zoom);
    ctx.font = `bold ${fs}px -apple-system, sans-serif`;
    ctx.fillStyle = "#FFD54F";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(e.label, mx, my - 5 * zoom);
  }

  // 세부내용 점
  if (lod >= 3 && e.detail && e.detail.trim() && zoom > 0.4) {
    const mx = (ss.x + se.x) / 2, my = (ss.y + se.y) / 2;
    ctx.beginPath();
    const dr = Math.max(2, 3 * zoom);
    ctx.arc(mx, my + 6 * zoom, dr, 0, Math.PI * 2);
    ctx.fillStyle = "#FFD700";
    ctx.fill();
  }
}

function drawHighlight() {
  if (selectedNode && nodes[selectedNode]) {
    const n = nodes[selectedNode];
    const s = w2s(n.x, n.y);
    const sr = (n.radius || 45) * zoom;
    ctx.beginPath();
    ctx.arc(s.x, s.y, sr + 4, 0, Math.PI * 2);
    ctx.strokeStyle = "#FFD700";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (selectedEdge && edges[selectedEdge]) {
    const e = edges[selectedEdge];
    const fn = nodes[e.from_id], tn = nodes[e.to_id];
    if (fn && tn) {
      const ss = w2s(fn.x, fn.y), se = w2s(tn.x, tn.y);
      ctx.beginPath();
      ctx.moveTo(ss.x, ss.y);
      ctx.lineTo(se.x, se.y);
      ctx.strokeStyle = "#FFD700";
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function wrapText(text, maxWidth, context) {
  if (!text) return [""];
  if (context.measureText(text).width <= maxWidth) return [text];

  const lines = [];
  let line = "";
  for (const ch of text) {
    const test = line + ch;
    if (context.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function updateBadges(visCount) {
  const zb = document.getElementById("zoom-badge");
  if (zb) zb.textContent = `${Math.round(zoom * 100)}%`;

  const sb = document.getElementById("stats-badge");
  if (sb) sb.textContent = `노드 ${Object.keys(nodes).length.toLocaleString()} | 화면 ${visCount.toLocaleString()}`;
}

// ═══════════════════════════════════════
// ── 마우스 이벤트 ──
// ═══════════════════════════════════════

function onMouseDown(e) {
  if (e.button === 2 || e.button === 1 || (e.button === 0 && e.altKey)) {
    isPanning = true;
    panStart = {x: e.offsetX, y: e.offsetY};
    lastPanX = panX; lastPanY = panY;
    canvas.style.cursor = "grabbing";
    return;
  }

  const w = s2w(e.offsetX, e.offsetY);

  if (mode === "add") {
    const title = prompt("노드 제목:");
    if (title) {
      addNode(w.x, w.y, title);
      redraw();
    }
    return;
  }

  const hit = findNodeAt(e.offsetX, e.offsetY);

  if (mode === "connect") {
    if (hit) {
      if (!connectingFrom) {
        connectingFrom = hit;
        selectNode(hit);
        showToast("연결할 대상 노드를 클릭하세요");
      } else {
        if (hit !== connectingFrom) {
          const label = prompt("화살표 라벨 (빈칸 가능):", "") || "";
          addEdge(connectingFrom, hit, label);
        }
        connectingFrom = null;
        redraw();
      }
    }
    return;
  }

  // select mode
  if (hit) {
    selectNode(hit);
    draggingNode = hit;
    const n = nodes[hit];
    dragOffset = {x: w.x - n.x, y: w.y - n.y};
    canvas.style.cursor = "move";
  } else {
    const hitEdge = findEdgeAt(e.offsetX, e.offsetY);
    if (hitEdge) {
      selectEdge(hitEdge);
    } else {
      deselectAll();
    }
  }
}

function onMouseMove(e) {
  if (isPanning) {
    const dx = (e.offsetX - panStart.x) / zoom;
    const dy = (e.offsetY - panStart.y) / zoom;
    panX = lastPanX + dx;
    panY = lastPanY + dy;
    redraw();
    return;
  }

  if (draggingNode && nodes[draggingNode]) {
    const w = s2w(e.offsetX, e.offsetY);
    nodes[draggingNode].x = w.x - dragOffset.x;
    nodes[draggingNode].y = w.y - dragOffset.y;
    markDirty();
    redraw();
  }
}

function onMouseUp(e) {
  isPanning = false;
  draggingNode = null;
  canvas.style.cursor = mode === "add" ? "crosshair" : mode === "connect" ? "pointer" : "default";
}

function onDblClick(e) {
  const hit = findNodeAt(e.offsetX, e.offsetY);
  if (hit) {
    selectNode(hit);
    document.getElementById("detail-title").focus();
  } else {
    const w = s2w(e.offsetX, e.offsetY);
    const title = prompt("노드 제목:");
    if (title) {
      addNode(w.x, w.y, title);
      redraw();
    }
  }
}

function onWheel(e) {
  e.preventDefault();
  const mx = e.offsetX, my = e.offsetY;
  const oldW = s2w(mx, my);
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  zoom = Math.max(0.02, Math.min(10, zoom * factor));
  panX = mx / zoom - oldW.x;
  panY = my / zoom - oldW.y;
  redraw();
}

// ═══════════════════════════════════════
// ── 터치 이벤트 (모바일) ──
// ═══════════════════════════════════════

function getTouchPos(e) {
  const rect = canvas.getBoundingClientRect();
  const t = e.touches[0] || e.changedTouches[0];
  return { x: t.clientX - rect.left, y: t.clientY - rect.top };
}

function getTouchDist(e) {
  if (e.touches.length < 2) return 0;
  const dx = e.touches[0].clientX - e.touches[1].clientX;
  const dy = e.touches[0].clientY - e.touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function getTouchCenter(e) {
  const rect = canvas.getBoundingClientRect();
  if (e.touches.length < 2) return getTouchPos(e);
  return {
    x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left,
    y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top
  };
}

let touchStartTime = 0;
let touchStartPos = null;
let touchMoved = false;

function onTouchStart(e) {
  e.preventDefault();

  if (e.touches.length === 2) {
    // 핀치 줌 시작
    pinchStartDist = getTouchDist(e);
    pinchStartZoom = zoom;
    draggingNode = null;
    return;
  }

  if (e.touches.length === 1) {
    const pos = getTouchPos(e);
    touchStartTime = Date.now();
    touchStartPos = pos;
    touchMoved = false;

    const w = s2w(pos.x, pos.y);
    const hit = findNodeAt(pos.x, pos.y);

    if (mode === "add") {
      const title = prompt("노드 제목:");
      if (title) { addNode(w.x, w.y, title); redraw(); }
      return;
    }

    if (mode === "connect") {
      if (hit) {
        if (!connectingFrom) {
          connectingFrom = hit;
          selectNode(hit);
          showToast("연결할 대상 노드를 탭하세요");
        } else {
          if (hit !== connectingFrom) {
            const label = prompt("화살표 라벨:", "") || "";
            addEdge(connectingFrom, hit, label);
          }
          connectingFrom = null;
          redraw();
        }
      }
      return;
    }

    if (hit) {
      selectNode(hit);
      draggingNode = hit;
      dragOffset = {x: w.x - nodes[hit].x, y: w.y - nodes[hit].y};
    } else {
      isPanning = true;
      panStart = pos;
      lastPanX = panX;
      lastPanY = panY;
    }
  }
}

function onTouchMove(e) {
  e.preventDefault();
  touchMoved = true;

  if (e.touches.length === 2) {
    // 핀치 줌
    const dist = getTouchDist(e);
    const center = getTouchCenter(e);
    if (pinchStartDist > 0) {
      const oldW = s2w(center.x, center.y);
      zoom = Math.max(0.02, Math.min(10, pinchStartZoom * (dist / pinchStartDist)));
      panX = center.x / zoom - oldW.x;
      panY = center.y / zoom - oldW.y;
      redraw();
    }
    return;
  }

  if (e.touches.length === 1) {
    const pos = getTouchPos(e);

    if (draggingNode && nodes[draggingNode]) {
      const w = s2w(pos.x, pos.y);
      nodes[draggingNode].x = w.x - dragOffset.x;
      nodes[draggingNode].y = w.y - dragOffset.y;
      markDirty();
      redraw();
    } else if (isPanning) {
      const dx = (pos.x - panStart.x) / zoom;
      const dy = (pos.y - panStart.y) / zoom;
      panX = lastPanX + dx;
      panY = lastPanY + dy;
      redraw();
    }
  }
}

function onTouchEnd(e) {
  e.preventDefault();
  isPanning = false;
  draggingNode = null;
  pinchStartDist = 0;

  // 탭 감지 (움직임 없이 짧은 터치)
  if (!touchMoved && touchStartPos && Date.now() - touchStartTime < 300) {
    const pos = touchStartPos;
    const hit = findNodeAt(pos.x, pos.y);
    if (!hit) {
      const hitEdge = findEdgeAt(pos.x, pos.y);
      if (hitEdge) selectEdge(hitEdge);
      else deselectAll();
    }
  }
}

// ═══════════════════════════════════════
// ── 키보드 ──
// ═══════════════════════════════════════

function onKeyDown(e) {
  const tag = e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;

  if ((e.metaKey || e.ctrlKey) && e.key === "f") {
    e.preventDefault();
    toggleSearch();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    e.preventDefault();
    saveToServer(true);
    return;
  }

  if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
  if (e.key === "Escape") { connectingFrom = null; setMode("select"); deselectAll(); }
  if (e.key === "s") setMode("select");
  if (e.key === "a") setMode("add");
  if (e.key === "c") setMode("connect");
  if (e.key === "=" || e.key === "+") applyZoom(zoom * 1.2);
  if (e.key === "-") applyZoom(zoom / 1.2);
  if (e.key === "0") { zoom = 1; panX = 0; panY = 0; redraw(); }
}

// ═══════════════════════════════════════
// ── 노드/엣지 탐색 ──
// ═══════════════════════════════════════

function findNodeAt(sx, sy) {
  const w = s2w(sx, sy);
  let best = null, bestD = Infinity;

  for (const nid of drawnNodes) {
    const n = nodes[nid];
    if (!n) continue;
    const dx = w.x - n.x, dy = w.y - n.y;
    const d2 = dx * dx + dy * dy;
    const r = n.radius || 45;
    if (d2 <= r * r && d2 < bestD) {
      best = nid;
      bestD = d2;
    }
  }
  return best;
}

function findEdgeAt(sx, sy, threshold = 14) {
  for (const eid in edges) {
    const e = edges[eid];
    const fn = nodes[e.from_id], tn = nodes[e.to_id];
    if (!fn || !tn) continue;
    const fs = w2s(fn.x, fn.y), ts = w2s(tn.x, tn.y);
    if (ptLineDist(sx, sy, fs.x, fs.y, ts.x, ts.y) < threshold) {
      const minX = Math.min(fs.x, ts.x) - threshold;
      const maxX = Math.max(fs.x, ts.x) + threshold;
      const minY = Math.min(fs.y, ts.y) - threshold;
      const maxY = Math.max(fs.y, ts.y) + threshold;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) return eid;
    }
  }
  return null;
}

function ptLineDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// ═══════════════════════════════════════
// ── 데이터 조작 ──
// ═══════════════════════════════════════

function addNode(x, y, title, detail, color, radius) {
  const nid = genId();
  nodes[nid] = {
    x, y,
    title: title || "새 노드",
    detail: detail || "",
    color: color || COLORS[colorIdx++ % COLORS.length],
    radius: radius || 45
  };
  markDirty();
  selectNode(nid);
  redraw();
  return nid;
}

function addEdge(fromId, toId, label, detail) {
  if (fromId === toId) return null;
  for (const eid in edges) {
    if (edges[eid].from_id === fromId && edges[eid].to_id === toId) return null;
  }
  const eid = genId();
  edges[eid] = { from_id: fromId, to_id: toId, label: label || "", detail: detail || "" };
  markDirty();
  return eid;
}

function deleteSelected() {
  if (selectedNode) {
    // 관련 엣지 삭제
    for (const eid in edges) {
      if (edges[eid].from_id === selectedNode || edges[eid].to_id === selectedNode) {
        delete edges[eid];
      }
    }
    delete nodes[selectedNode];
    deselectAll();
    markDirty();
    redraw();
  } else if (selectedEdge) {
    delete edges[selectedEdge];
    deselectAll();
    markDirty();
    redraw();
  }
}

function genId() {
  return Math.random().toString(36).substr(2, 8);
}

function markDirty() { dirty = true; }

// ═══════════════════════════════════════
// ── 선택/편집 ──
// ═══════════════════════════════════════

function selectNode(nid) {
  selectedNode = nid;
  selectedEdge = null;
  const n = nodes[nid];
  if (!n) return;

  showDetailPanel();
  const hdr = document.querySelector("#detail-panel .panel-header h3");
  hdr.textContent = `노드: ${n.title}`;

  document.getElementById("detail-title").value = n.title;
  document.getElementById("detail-text").value = n.detail || "";
  document.getElementById("detail-size").value = n.radius || 45;
  document.getElementById("detail-size-val").textContent = n.radius || 45;
  document.getElementById("size-row").style.display = "flex";
  document.getElementById("color-row").style.display = "flex";

  // 색상 버튼
  const cRow = document.getElementById("color-buttons");
  cRow.innerHTML = "";
  COLORS.forEach(c => {
    const btn = document.createElement("button");
    btn.style.cssText = `width:24px;height:24px;border-radius:50%;border:2px solid ${c === n.color ? '#fff' : 'transparent'};background:${c};cursor:pointer;`;
    btn.onclick = () => {
      nodes[nid].color = c;
      markDirty();
      selectNode(nid);  // 색상 표시 업데이트
      redraw();
    };
    cRow.appendChild(btn);
  });

  redraw();
}

function selectEdge(eid) {
  selectedEdge = eid;
  selectedNode = null;
  const e = edges[eid];
  if (!e) return;

  showDetailPanel();
  const fromT = nodes[e.from_id] ? nodes[e.from_id].title : "?";
  const toT = nodes[e.to_id] ? nodes[e.to_id].title : "?";
  const hdr = document.querySelector("#detail-panel .panel-header h3");
  hdr.textContent = `연결: ${fromT} → ${toT}`;

  document.getElementById("detail-title").value = e.label || "";
  document.getElementById("detail-text").value = e.detail || "";
  document.getElementById("size-row").style.display = "none";
  document.getElementById("color-row").style.display = "none";

  redraw();
}

function deselectAll() {
  selectedNode = null;
  selectedEdge = null;
  redraw();
}

function onDetailTitleChange() {
  const val = document.getElementById("detail-title").value;
  if (selectedNode && nodes[selectedNode]) {
    nodes[selectedNode].title = val;
    document.querySelector("#detail-panel .panel-header h3").textContent = `노드: ${val}`;
    markDirty();
    redraw();
  } else if (selectedEdge && edges[selectedEdge]) {
    edges[selectedEdge].label = val;
    markDirty();
    redraw();
  }
}

function onDetailTextChange() {
  const val = document.getElementById("detail-text").value;
  if (selectedNode && nodes[selectedNode]) {
    nodes[selectedNode].detail = val;
    markDirty();
  } else if (selectedEdge && edges[selectedEdge]) {
    edges[selectedEdge].detail = val;
    markDirty();
  }
}

function onDetailSizeChange() {
  const val = parseInt(document.getElementById("detail-size").value);
  document.getElementById("detail-size-val").textContent = val;
  if (selectedNode && nodes[selectedNode]) {
    nodes[selectedNode].radius = val;
    markDirty();
    redraw();
  }
}

// ═══════════════════════════════════════
// ── 모드/UI ──
// ═══════════════════════════════════════

function setMode(m) {
  mode = m;
  connectingFrom = null;
  document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
  const btn = document.getElementById("btn-" + m);
  if (btn) btn.classList.add("active");

  canvas.style.cursor = m === "add" ? "crosshair" : m === "connect" ? "pointer" : "default";

  // FAB 상태
  const fab = document.getElementById("fab-add");
  if (fab) {
    fab.textContent = m === "add" ? "✓" : "+";
    fab.classList.toggle("primary", m !== "add");
  }
}

function applyZoom(z) {
  zoom = Math.max(0.02, Math.min(10, z));
  redraw();
}

function zoomFit() {
  const nids = Object.keys(nodes);
  if (!nids.length) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const nid of nids) {
    const n = nodes[nid];
    const r = n.radius || 45;
    minX = Math.min(minX, n.x - r);
    maxX = Math.max(maxX, n.x + r);
    minY = Math.min(minY, n.y - r);
    maxY = Math.max(maxY, n.y + r);
  }

  const ww = maxX - minX + 100, wh = maxY - minY + 100;
  const zx = canvasW / ww, zy = canvasH / wh;
  zoom = Math.max(0.05, Math.min(3, Math.min(zx, zy)));

  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  panX = (canvasW / (2 * zoom)) - cx;
  panY = (canvasH / (2 * zoom)) - cy;
  redraw();
}

function toggleDetailPanel() {
  const panel = document.getElementById("detail-panel");
  panel.classList.toggle("hidden");
  setTimeout(resizeCanvas, 300);
}

function showDetailPanel() {
  const panel = document.getElementById("detail-panel");
  panel.classList.remove("hidden");
  setTimeout(resizeCanvas, 300);
}

// ═══════════════════════════════════════
// ── 검색 ──
// ═══════════════════════════════════════

function toggleSearch() {
  const bar = document.getElementById("search-bar");
  bar.classList.toggle("hidden");
  if (!bar.classList.contains("hidden")) {
    document.getElementById("search-input").focus();
  } else {
    searchResults = [];
    redraw();
  }
}

function doSearch() {
  const q = document.getElementById("search-input").value.trim().toLowerCase();
  if (!q) { searchResults = []; document.getElementById("search-count").textContent = ""; redraw(); return; }

  searchResults = [];
  for (const nid in nodes) {
    const n = nodes[nid];
    if (n.title.toLowerCase().includes(q) || (n.detail || "").toLowerCase().includes(q)) {
      searchResults.push(nid);
    }
  }
  searchIdx = 0;
  document.getElementById("search-count").textContent =
    searchResults.length ? `${searchResults.length}개` : "없음";
  if (searchResults.length) navigateToResult();
  else redraw();
}

function searchPrev() {
  if (!searchResults.length) return;
  searchIdx = (searchIdx - 1 + searchResults.length) % searchResults.length;
  navigateToResult();
}
function searchNext() {
  if (!searchResults.length) return;
  searchIdx = (searchIdx + 1) % searchResults.length;
  navigateToResult();
}

function navigateToResult() {
  const nid = searchResults[searchIdx];
  const n = nodes[nid];
  if (!n) return;
  panX = (canvasW / (2 * zoom)) - n.x;
  panY = (canvasH / (2 * zoom)) - n.y;
  selectNode(nid);
  document.getElementById("search-count").textContent =
    `${searchIdx + 1}/${searchResults.length}`;
}

// ═══════════════════════════════════════
// ── 자동 레이아웃 ──
// ═══════════════════════════════════════

function buildTree() {
  const childMap = {};
  const hasParent = new Set();
  for (const eid in edges) {
    const e = edges[eid];
    if (nodes[e.from_id] && nodes[e.to_id]) {
      if (!childMap[e.from_id]) childMap[e.from_id] = [];
      childMap[e.from_id].push(e.to_id);
      hasParent.add(e.to_id);
    }
  }
  const roots = Object.keys(nodes).filter(n => !hasParent.has(n));
  if (!roots.length && Object.keys(nodes).length) roots.push(Object.keys(nodes)[0]);

  const visited = new Set();
  const treeChildren = {};
  const queue = [...roots];
  roots.forEach(r => visited.add(r));

  while (queue.length) {
    const cur = queue.shift();
    treeChildren[cur] = [];
    for (const kid of (childMap[cur] || [])) {
      if (!visited.has(kid)) {
        visited.add(kid);
        treeChildren[cur].push(kid);
        queue.push(kid);
      }
    }
  }
  const isolated = Object.keys(nodes).filter(n => !visited.has(n));
  return { roots, treeChildren, isolated };
}

function subtreeSize(nid, tc) {
  const kids = tc[nid] || [];
  if (!kids.length) return 1;
  return kids.reduce((s, k) => s + subtreeSize(k, tc), 0);
}

function autoLayout(type) {
  showToast(`자동 정렬 중... (${Object.keys(nodes).length.toLocaleString()}개)`);

  if (type === "grid") layoutGrid();
  else if (type === "radial") layoutRadial();
  else if (type === "tree_v") layoutTree(false);
  else if (type === "tree_h") layoutTree(true);

  markDirty();
  zoomFit();
  showToast("정렬 완료!");
}

function layoutGrid() {
  const ids = Object.keys(nodes);
  const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
  ids.forEach((nid, i) => {
    nodes[nid].x = (i % cols) * 180 + 200;
    nodes[nid].y = Math.floor(i / cols) * 160 + 200;
  });
}

function layoutRadial() {
  const { roots, treeChildren, isolated } = buildTree();
  if (!roots.length) { layoutGrid(); return; }

  const cx = 500, cy = 400;
  const levels = {};
  const visited = new Set();
  const queue = [];

  roots.forEach((r, i) => {
    visited.add(r);
    queue.push([r, 0]);
  });

  while (queue.length) {
    const [nid, lv] = queue.shift();
    if (!levels[lv]) levels[lv] = [];
    levels[lv].push(nid);
    for (const kid of (treeChildren[nid] || [])) {
      if (!visited.has(kid)) {
        visited.add(kid);
        queue.push([kid, lv + 1]);
      }
    }
  }

  for (const lv in levels) {
    const arr = levels[lv];
    const radius = lv == 0 ? 0 : parseInt(lv) * 200;
    arr.forEach((nid, i) => {
      const angle = (2 * Math.PI * i / arr.length) - Math.PI / 2;
      nodes[nid].x = cx + radius * Math.cos(angle);
      nodes[nid].y = cy + radius * Math.sin(angle);
    });
  }

  isolated.forEach((nid, i) => {
    nodes[nid].x = cx + 500 + (i % 3) * 150;
    nodes[nid].y = cy + Math.floor(i / 3) * 150;
  });
}

function layoutTree(horizontal) {
  const { roots, treeChildren, isolated } = buildTree();
  if (!roots.length) { layoutGrid(); return; }

  const sizes = {};
  function calcSize(nid) {
    const kids = treeChildren[nid] || [];
    sizes[nid] = kids.length ? kids.reduce((s, k) => s + calcSize(k), 0) : 1;
    return sizes[nid];
  }
  roots.forEach(r => calcSize(r));

  const gap = 180, sib = 130;
  let offset = 100;

  for (const rid of roots) {
    const stack = [[rid, 0, offset]];
    while (stack.length) {
      const [nid, depth, off] = stack.pop();
      const span = (sizes[nid] || 1) * sib;
      if (horizontal) {
        nodes[nid].x = 400 + depth * gap;
        nodes[nid].y = off + span / 2;
      } else {
        nodes[nid].x = off + span / 2;
        nodes[nid].y = 100 + depth * gap;
      }
      let childOff = off;
      for (const kid of [...(treeChildren[nid] || [])].reverse()) {
        stack.push([kid, depth + 1, childOff]);
        childOff += (sizes[kid] || 1) * sib;
      }
    }
    offset += (sizes[rid] || 1) * sib + 100;
  }

  isolated.forEach((nid, i) => {
    if (horizontal) {
      nodes[nid].x = 400;
      nodes[nid].y = offset + i * 130;
    } else {
      nodes[nid].x = offset + i * 130;
      nodes[nid].y = 100;
    }
  });
}

// ═══════════════════════════════════════
// ── 서버 통신 (자동 저장) ──
// ═══════════════════════════════════════

async function autoSave() {
  if (!dirty || !mapId) return;
  await saveToServer(false);
}

async function saveToServer(manual) {
  if (!mapId) return;

  const ind = document.getElementById("save-indicator");
  ind.className = "saving";
  ind.textContent = "저장 중...";

  try {
    const resp = await fetch(`/api/maps/${mapId}`, {
      method: "PUT",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ nodes, edges })
    });

    if (resp.ok) {
      dirty = false;
      lastSaveTime = Date.now();
      ind.className = "saved";
      ind.textContent = "저장 완료";
      setTimeout(() => ind.className = "", 2000);
    } else {
      throw new Error("save failed");
    }
  } catch (e) {
    ind.className = "";
    if (manual) showToast("저장 실패! 네트워크를 확인하세요.");
  }
}

async function loadFromServer(id) {
  try {
    const resp = await fetch(`/api/maps/${id}`);
    if (!resp.ok) throw new Error("not found");
    const data = await resp.json();

    mapId = id;
    nodes = data.nodes || {};
    edges = data.edges || {};
    colorIdx = Object.keys(nodes).length;
    dirty = false;

    document.getElementById("map-title").textContent = data.title || "마인드맵";
    closeMapList();
    zoomFit();
    showToast(`"${data.title}" 불러옴 (${Object.keys(nodes).length.toLocaleString()}개 노드)`);
  } catch (e) {
    showToast("맵을 불러올 수 없습니다.");
  }
}

// ═══════════════════════════════════════
// ── 맵 목록 ──
// ═══════════════════════════════════════

async function showMapList() {
  const overlay = document.getElementById("map-list-overlay");
  overlay.classList.remove("hidden");

  const body = document.querySelector("#map-list-modal .modal-body");
  body.innerHTML = '<p style="text-align:center;color:#888;padding:20px;">불러오는 중...</p>';

  try {
    const resp = await fetch("/api/maps");
    const maps = await resp.json();

    if (!maps.length) {
      body.innerHTML = '<p style="text-align:center;color:#888;padding:20px;">저장된 마인드맵이 없습니다.<br>새로 만들어 보세요!</p>';
      return;
    }

    body.innerHTML = "";
    for (const m of maps) {
      const div = document.createElement("div");
      div.className = "map-item";
      const date = m.updated_at ? new Date(m.updated_at * 1000).toLocaleString("ko-KR") : "";
      div.innerHTML = `
        <div class="info" style="flex:1;cursor:pointer;" data-id="${m.id}">
          <h4>${m.title}</h4>
          <div class="meta">노드 ${(m.node_count || 0).toLocaleString()}개 · ${date}</div>
        </div>
        <div class="actions">
          <button class="btn sm danger" data-delete="${m.id}" title="삭제">✕</button>
        </div>
      `;
      div.querySelector(".info").onclick = () => loadFromServer(m.id);
      div.querySelector("[data-delete]").onclick = async (e) => {
        e.stopPropagation();
        if (confirm(`"${m.title}" 맵을 삭제하시겠습니까?`)) {
          await fetch(`/api/maps/${m.id}`, {method: "DELETE"});
          showMapList();
        }
      };
      body.appendChild(div);
    }
  } catch (e) {
    body.innerHTML = '<p style="text-align:center;color:#f77;padding:20px;">서버에 연결할 수 없습니다.</p>';
  }
}

function closeMapList() {
  document.getElementById("map-list-overlay").classList.add("hidden");
}

async function createNewMap() {
  const title = prompt("새 마인드맵 이름:", "새 마인드맵");
  if (!title) return;

  try {
    const resp = await fetch("/api/maps", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({title})
    });
    const data = await resp.json();
    mapId = data.id;
    nodes = {};
    edges = {};
    colorIdx = 0;
    dirty = false;
    document.getElementById("map-title").textContent = title;
    closeMapList();

    // 환영 노드
    addNode(400, 300, title, "여기에 메모를 작성하세요!");
    redraw();
    showToast(`"${title}" 생성 완료!`);
  } catch (e) {
    showToast("맵 생성 실패");
  }
}

// ── 토스트 ──

let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2500);
}

// ── 시작 ──
document.addEventListener("DOMContentLoaded", init);
