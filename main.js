// 迷宮程式戰 (Grid Coder)
// ------------------------------------
// 核心邏輯：5x5 網格、指令隊列、逐步執行與動畫呈現

// === 遊戲常數 ===
const GRID_SIZE = 5;
const STEP_DELAY = 600; // 每個指令執行間隔 (ms)

// 方向編碼：0=上, 1=右, 2=下, 3=左
const DIRS = [
  { dx: 0, dy: -1, rotation: 0 },
  { dx: 1, dy: 0, rotation: 90 },
  { dx: 0, dy: 1, rotation: 180 },
  { dx: -1, dy: 0, rotation: 270 },
];

// 指令枚舉
const COMMAND_LABELS = {
  F: "前進",
  L: "左轉",
  R: "右轉",
  LOOP2: "重複 x2",
  IFBLUE_R: "If Blue ↪️ Right",
  IFBLUE_L: "If Blue ↩️ Left",
};

// === 狀態 ===
let grid = []; // 2D: 'empty' | 'wall' | 'blue' | 'goal'
let startPos = { x: 0, y: 0 };
let goalPos = { x: 4, y: 4 };
let agentState = {
  x: 0,
  y: 0,
  dir: 1, // 初始向右
};

let commandQueue = []; // 指令序列，例如 ["F","LOOP2","F"]
let isRunning = false;
let currentHighlightIndex = null;

// DOM 快取
const gridEl = document.getElementById("grid");
const agentEl = document.getElementById("agent");
const statusTextEl = document.getElementById("status-text");
const queueListEl = document.getElementById("queue-list");

const btnRun = document.getElementById("btn-run");
const btnClear = document.getElementById("btn-clear");
const btnUndo = document.getElementById("btn-undo");
const btnResetMap = document.getElementById("btn-reset-map");

const overlaySuccess = document.getElementById("overlay-success");
const overlayFail = document.getElementById("overlay-fail");
const btnSuccessOk = document.getElementById("btn-success-ok");
const btnFailClose = document.getElementById("btn-fail-close");

// === 初始化 ===
init();

function init() {
  bindUIEvents();
  generateRandomMap();
  resetAgentToStart();
  renderGrid();
  updateAgentVisual();
  updateStatus("準備規劃你的演算法…");
}

// 綁定 UI 事件
function bindUIEvents() {
  // 指令按鈕
  document.querySelectorAll(".cmd-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (isRunning) return;
      const cmd = btn.dataset.cmd;
      commandQueue.push(cmd);
      renderQueue();
    });
  });

  btnUndo.addEventListener("click", () => {
    if (isRunning) return;
    commandQueue.pop();
    renderQueue();
  });

  btnClear.addEventListener("click", () => {
    if (isRunning) return;
    commandQueue = [];
    renderQueue();
    updateStatus("指令已清除，重新規劃路徑。");
  });

  btnRun.addEventListener("click", () => {
    if (isRunning) return;
    if (!commandQueue.length) {
      updateStatus("尚未加入任何指令。");
      pulseStatus();
      return;
    }
    startExecution();
  });

  btnResetMap.addEventListener("click", () => {
    if (isRunning) return;
    generateRandomMap();
    resetAgentToStart();
    renderGrid();
    updateAgentVisual();
    updateStatus("地圖已重置，試著設計新的解法。");
  });

  btnSuccessOk.addEventListener("click", () => {
    overlaySuccess.classList.add("overlay-hidden");
    generateRandomMap();
    resetAgentToStart();
    renderGrid();
    updateAgentVisual();
    commandQueue = [];
    renderQueue();
    updateStatus("新地圖已載入，挑戰下一關！");
  });

  btnFailClose.addEventListener("click", () => {
    overlayFail.classList.add("overlay-hidden");
  });
}

// === 地圖與主角 ===

// 路徑優先地圖生成：先畫路徑，再放障礙物
function generateRandomMap() {
  grid = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => "empty")
  );

  // 起點固定左上 (0,0)
  startPos = { x: 0, y: 0 };
  agentState.x = startPos.x;
  agentState.y = startPos.y;

  // 確保終點與起點的曼哈頓距離 >= 6
  let attempts = 0;
  do {
    goalPos = {
      x: randInt(0, GRID_SIZE - 1),
      y: randInt(0, GRID_SIZE - 1),
    };
    attempts++;
    // 防止無限迴圈，如果嘗試太多次就放寬條件
    if (attempts > 50) break;
  } while (
    (goalPos.x === startPos.x && goalPos.y === startPos.y) ||
    Math.abs(goalPos.x - startPos.x) + Math.abs(goalPos.y - startPos.y) < 6
  );

  grid[goalPos.y][goalPos.x] = "goal";

  // === 步驟 1：生成一條從起點到終點的路徑（包含 1-2 個轉彎）===
  const solutionPath = generateSolutionPath(startPos, goalPos);
  
  // 標記路徑上的格子（用於後續判斷）
  const pathCells = new Set();
  solutionPath.forEach(({ x, y }) => {
    pathCells.add(`${x},${y}`);
  });

  // === 步驟 2：找出路徑上的轉彎處，放置藍色格子 ===
  const corners = findCorners(solutionPath);
  // 至少放置 1 個藍色格子，最多 2 個（如果轉彎處足夠）
  const blueCount = Math.min(randInt(1, 2), corners.length);
  const selectedCorners = shuffleArray([...corners]).slice(0, blueCount);
  
  selectedCorners.forEach(({ x, y }) => {
    // 確保不是起點或終點
    if (!(x === startPos.x && y === startPos.y) && 
        !(x === goalPos.x && y === goalPos.y)) {
      grid[y][x] = "blue";
    }
  });

  // === 步驟 3：在路徑外的空白處放置障礙物 ===
  const wallCount = randInt(3, 5);
  let placedWalls = 0;
  let wallAttempts = 0;
  
  while (placedWalls < wallCount && wallAttempts < 100) {
    const x = randInt(0, GRID_SIZE - 1);
    const y = randInt(0, GRID_SIZE - 1);
    const cellKey = `${x},${y}`;
    
    // 不在路徑上，且不是起點、終點、已放置的藍色格子
    if (
      !pathCells.has(cellKey) &&
      !(x === startPos.x && y === startPos.y) &&
      !(x === goalPos.x && y === goalPos.y) &&
      grid[y][x] === "empty"
    ) {
      grid[y][x] = "wall";
      placedWalls++;
    }
    wallAttempts++;
  }
}

// 生成一條從起點到終點的解決路徑（包含轉彎）
function generateSolutionPath(start, goal) {
  const path = [{ x: start.x, y: start.y }];
  
  // 策略：先水平移動，再垂直移動（或相反），確保有轉彎
  const useHorizontalFirst = Math.random() > 0.5;
  
  if (useHorizontalFirst) {
    // 先水平移動到目標 x，再垂直移動到目標 y
    const midX = goal.x;
    const midY = start.y;
    if (midX !== start.x) {
      path.push({ x: midX, y: midY });
    }
    if (midY !== goal.y) {
      path.push({ x: goal.x, y: goal.y });
    }
  } else {
    // 先垂直移動到目標 y，再水平移動到目標 x
    const midX = start.x;
    const midY = goal.y;
    if (midY !== start.y) {
      path.push({ x: midX, y: midY });
    }
    if (midX !== goal.x) {
      path.push({ x: goal.x, y: goal.y });
    }
  }
  
  // 確保終點在路徑中
  if (path[path.length - 1].x !== goal.x || path[path.length - 1].y !== goal.y) {
    path.push({ x: goal.x, y: goal.y });
  }
  
  // 展開路徑：將相鄰兩點之間的所有格子都加入
  const expandedPath = [];
  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i];
    const to = path[i + 1];
    
    // 加入起點
    expandedPath.push({ x: from.x, y: from.y });
    
    // 填充中間的格子
    if (from.x === to.x) {
      // 垂直移動
      const step = from.y < to.y ? 1 : -1;
      for (let y = from.y + step; y !== to.y; y += step) {
        expandedPath.push({ x: from.x, y });
      }
    } else if (from.y === to.y) {
      // 水平移動
      const step = from.x < to.x ? 1 : -1;
      for (let x = from.x + step; x !== to.x; x += step) {
        expandedPath.push({ x, y: from.y });
      }
    }
  }
  // 加入終點
  expandedPath.push({ x: goal.x, y: goal.y });
  
  return expandedPath;
}

// 找出路徑中的轉彎處（方向改變的點）
function findCorners(path) {
  const corners = [];
  
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1];
    const curr = path[i];
    const next = path[i + 1];
    
    // 檢查是否轉彎：前一段和後一段的方向不同
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    
    // 如果方向改變（不是純水平或純垂直），就是轉彎
    if ((dx1 !== 0 && dy2 !== 0) || (dy1 !== 0 && dx2 !== 0)) {
      corners.push({ x: curr.x, y: curr.y });
    }
  }
  
  return corners;
}

// 陣列洗牌（Fisher-Yates）
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// 將 agent 狀態重置到起點，方向向右
function resetAgentToStart() {
  agentState.x = startPos.x;
  agentState.y = startPos.y;
  agentState.dir = 1;
}

// 將網格渲染到 DOM
function renderGrid() {
  gridEl.innerHTML = "";
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cellType = grid[y][x];
      const cell = document.createElement("div");
      cell.classList.add("cell");
      cell.dataset.x = x;
      cell.dataset.y = y;

      if (x === startPos.x && y === startPos.y) {
        cell.classList.add("cell-start");
      }
      if (cellType === "goal") {
        cell.classList.add("cell-goal");
      } else if (cellType === "wall") {
        cell.classList.add("cell-wall");
      } else if (cellType === "blue") {
        cell.classList.add("cell-blue");
      }

      gridEl.appendChild(cell);
    }
  }
}

// 更新主角箭頭在畫面中的位置與朝向
function updateAgentVisual() {
  const cellRect = gridEl.getBoundingClientRect();
  const cellWidth = cellRect.width / GRID_SIZE;
  const cellHeight = cellRect.height / GRID_SIZE;

  const centerX = cellRect.left + cellWidth * (agentState.x + 0.5);
  const centerY = cellRect.top + cellHeight * (agentState.y + 0.5);

  // 注意：agent 是絕對定位在 viewport，上層 wrapper 也是 relative
  const wrapperRect = gridEl.parentElement.getBoundingClientRect();

  const localX = centerX - wrapperRect.left;
  const localY = centerY - wrapperRect.top;

  agentEl.style.left = `${localX - 14}px`; // 14 = 半個三角形寬
  agentEl.style.top = `${localY - 18}px`; // 微調高度

  const dirInfo = DIRS[agentState.dir];
  agentEl.style.transform = `rotate(${dirInfo.rotation}deg)`;
}

// === 指令隊列 ===

function renderQueue() {
  queueListEl.innerHTML = "";

  commandQueue.forEach((cmd, index) => {
    const li = document.createElement("li");
    if (index === currentHighlightIndex) {
      li.classList.add("queue-item-active");
    }
    const badge = document.createElement("span");
    badge.classList.add("queue-badge");
    badge.textContent = index + 1;

    const opSpan = document.createElement("span");
    opSpan.classList.add("queue-op");
    opSpan.textContent = COMMAND_LABELS[cmd] || cmd;

    li.appendChild(badge);
    li.appendChild(opSpan);
    queueListEl.appendChild(li);
  });
}

function setQueueHighlight(idx) {
  currentHighlightIndex = idx;
  renderQueue();
}

// === 執行邏輯 ===

// 展開指令：處理 LOOP2 與 IFBLUE_R/L 的語意
// 回傳一個「步驟陣列」，每一步都知道：
// - 來源指令索引 (for highlight)
// - 實際動作: "F" | "L" | "R" | "NOOP"
function expandCommandsForExecution() {
  const steps = [];

  for (let i = 0; i < commandQueue.length; i++) {
    const cmd = commandQueue[i];

    if (cmd === "LOOP2") {
      // LOOP2 自己不做事，只是重複下一個指令
      const next = commandQueue[i + 1];
      if (!next) {
        // 沒有下一個指令，就當成無效 NOOP
        steps.push({ fromIndex: i, action: "NOOP" });
      } else {
        steps.push({ fromIndex: i, action: next });
        steps.push({ fromIndex: i, action: next });
      }
    } else if (cmd === "IFBLUE_R") {
      // If Blue Right：如果腳下是藍色就右轉
      steps.push({
        fromIndex: i,
        action: "IFBLUE_R",
      });
    } else if (cmd === "IFBLUE_L") {
      // If Blue Left：如果腳下是藍色就左轉
      steps.push({
        fromIndex: i,
        action: "IFBLUE_L",
      });
    } else {
      // 一般指令 (F, L, R)
      steps.push({ fromIndex: i, action: cmd });
    }
  }

  return steps;
}

// 開始執行整個隊列
function startExecution() {
  isRunning = true;
  disableCommandInputs(true);
  updateStatus("開始執行演算法…");
  setQueueHighlight(null);

  // 還原主角狀態 (從起點開始跑)
  resetAgentToStart();
  updateAgentVisual();

  const steps = expandCommandsForExecution();
  if (!steps.length) {
    updateStatus("沒有可執行的有效指令。");
    isRunning = false;
    disableCommandInputs(false);
    return;
  }

  let stepIndex = 0;

  const timer = setInterval(() => {
    if (stepIndex >= steps.length) {
      clearInterval(timer);
      endExecutionCheck();
      return;
    }

    const step = steps[stepIndex];
    setQueueHighlight(step.fromIndex);

    const continueRun = performStep(step);
    stepIndex++;

    if (!continueRun) {
      // 發生失敗或終點，停止後續指令
      clearInterval(timer);
      setTimeout(() => {
        endExecutionCheck();
      }, STEP_DELAY * 0.4);
    }
  }, STEP_DELAY);
}

// 執行一個步驟，回傳是否繼續
function performStep(step) {
  const type = step.action;

  if (type === "NOOP" || type === "NOOP_COND") {
    return true;
  }

  // If Blue Right：如果腳下是藍色就右轉
  if (type === "IFBLUE_R") {
    const currentCellType = grid[agentState.y][agentState.x];
    if (currentCellType === "blue") {
      // 在藍色格子上，執行右轉
      agentState.dir = (agentState.dir + 1) % 4;
      updateAgentVisual();
    }
    // 非藍色則忽略（Pass）
    return true;
  }

  // If Blue Left：如果腳下是藍色就左轉
  if (type === "IFBLUE_L") {
    const currentCellType = grid[agentState.y][agentState.x];
    if (currentCellType === "blue") {
      // 在藍色格子上，執行左轉
      agentState.dir = (agentState.dir + 3) % 4;
      updateAgentVisual();
    }
    // 非藍色則忽略（Pass）
    return true;
  }

  if (type === "L") {
    agentState.dir = (agentState.dir + 3) % 4; // 左轉: -1
    updateAgentVisual();
    return true;
  }

  if (type === "R") {
    agentState.dir = (agentState.dir + 1) % 4; // 右轉: +1
    updateAgentVisual();
    return true;
  }

  if (type === "F") {
    const dirInfo = DIRS[agentState.dir];
    const nextX = agentState.x + dirInfo.dx;
    const nextY = agentState.y + dirInfo.dy;

    // 邊界檢查
    if (
      nextX < 0 ||
      nextX >= GRID_SIZE ||
      nextY < 0 ||
      nextY >= GRID_SIZE
    ) {
      triggerFailAnimation(agentState.x, agentState.y);
      updateStatus("走出邊界，演算法失敗。");
      showFailOverlay();
      return false;
    }

    const cellType = grid[nextY][nextX];
    if (cellType === "wall") {
      triggerFailAnimation(nextX, nextY);
      updateStatus("撞到牆壁，演算法失敗。");
      showFailOverlay();
      return false;
    }

    // 合法移動
    agentState.x = nextX;
    agentState.y = nextY;
    updateAgentVisual();

    // 若走到終點，可以提早視為成功，後續指令不再執行
    if (cellType === "goal") {
      triggerGoalEffect(nextX, nextY);
      updateStatus("成功抵達終點！");
      showSuccessOverlay();
      return false;
    }

    return true;
  }

  // 其他未知指令
  return true;
}

// 當所有步驟跑完，檢查是否成功 / 失敗
function endExecutionCheck() {
  isRunning = false;
  disableCommandInputs(false);
  setQueueHighlight(null);

  if (agentState.x === goalPos.x && agentState.y === goalPos.y) {
    // 已在 goal (通常會在 performStep 內提早觸發)
    updateStatus("成功抵達終點！");
    showSuccessOverlay();
  } else {
    updateStatus("指令結束，但尚未抵達終點。");
    showFailOverlay();
  }
}

// 啟用 / 停用操作按鈕 & 指令鍵
function disableCommandInputs(disabled) {
  btnRun.disabled = disabled;
  btnClear.disabled = disabled;
  btnUndo.disabled = disabled;
  btnResetMap.disabled = disabled;
  document.querySelectorAll(".cmd-btn").forEach((btn) => {
    btn.disabled = disabled;
  });
}

// === 視覺特效 ===

function triggerFailAnimation(x, y) {
  const cell = findCellEl(x, y);
  if (!cell) return;
  cell.classList.remove("cell-hit");
  // 重新觸發 animation
  void cell.offsetWidth;
  cell.classList.add("cell-hit");
}

function triggerGoalEffect(x, y) {
  const cell = findCellEl(x, y);
  if (!cell) return;
  cell.style.boxShadow =
    "0 0 0 2px rgba(227, 201, 148, 0.9), 0 0 32px rgba(227, 201, 148, 0.8)";
  setTimeout(() => {
    cell.style.boxShadow = "";
  }, 900);
}

function showSuccessOverlay() {
  overlayFail.classList.add("overlay-hidden");
  overlaySuccess.classList.remove("overlay-hidden");
}

function showFailOverlay() {
  overlaySuccess.classList.add("overlay-hidden");
  overlayFail.classList.remove("overlay-hidden");
}

// 更新狀態文字
function updateStatus(text) {
  statusTextEl.textContent = text;
}

// 簡單的狀態亮一下
function pulseStatus() {
  statusTextEl.style.transition = "color 0.15s ease-out";
  const original = statusTextEl.style.color || "#a1a4ae";
  statusTextEl.style.color = "#e3c994";
  setTimeout(() => {
    statusTextEl.style.color = original;
  }, 260);
}

// === 工具函式 ===

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function findCellEl(x, y) {
  return gridEl.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
}

// 確保在視窗尺寸改變時，主角位置仍然對齊格子
window.addEventListener("resize", () => {
  updateAgentVisual();
});


