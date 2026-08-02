const defaultCode = `использовать Робот
алг
нач
  | команды Робота
кон`;

const defaultField = {
  cols: 8,
  rows: 7,
  start: { x: 1, y: 3 },
  goals: [],
  walls: [],
};

const elements = {
  board: document.querySelector("#board"),
  editor: document.querySelector("#codeEditor"),
  syntaxHighlight: document.querySelector("#syntaxHighlight"),
  lineNumbers: document.querySelector("#lineNumbers"),
  cursorPosition: document.querySelector("#cursorPosition"),
  runButton: document.querySelector("#runButton"),
  stepButton: document.querySelector("#stepButton"),
  resetButton: document.querySelector("#resetButton"),
  clearCodeButton: document.querySelector("#clearCodeButton"),
  clearFieldButton: document.querySelector("#clearFieldButton"),
  columnsInput: document.querySelector("#columnsInput"),
  rowsInput: document.querySelector("#rowsInput"),
  toolButtons: [...document.querySelectorAll(".tool-button")],
  speedRange: document.querySelector("#speedRange"),
  consoleBox: document.querySelector("#consoleBox"),
  consoleIcon: document.querySelector("#consoleIcon"),
  consoleText: document.querySelector("#consoleText"),
  helpButton: document.querySelector("#helpButton"),
  closeHelpButton: document.querySelector("#closeHelpButton"),
  helpDialog: document.querySelector("#helpDialog"),
  themeButton: document.querySelector("#themeButton"),
};

const storage = {
  get(key, fallback = null) {
    try {
      const value = localStorage.getItem(`robot-kumir:${key}`);
      return value === null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`robot-kumir:${key}`, JSON.stringify(value));
    } catch {
      // Приложение остаётся рабочим, даже если localStorage недоступен.
    }
  },
};

function sanitizeField(value) {
  const source = value && typeof value === "object" ? value : defaultField;
  const cols = Math.max(3, Math.min(30, Number(source.cols) || defaultField.cols));
  const rows = Math.max(3, Math.min(24, Number(source.rows) || defaultField.rows));
  const inBounds = ([x, y]) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < cols && y < rows;
  return {
    cols,
    rows,
    start: {
      x: Math.max(0, Math.min(cols - 1, Number(source.start?.x) || 0)),
      y: Math.max(0, Math.min(rows - 1, Number(source.start?.y) || 0)),
    },
    goals: Array.isArray(source.goals) ? source.goals.filter(inBounds) : [],
    walls: Array.isArray(source.walls)
      ? source.walls.filter((wall) => wall && Number.isInteger(wall.x) && Number.isInteger(wall.y) && ["right", "bottom"].includes(wall.side))
      : [],
  };
}

const state = {
  field: sanitizeField(storage.get("field", defaultField)),
  position: { x: 0, y: 0 },
  painted: new Set(),
  program: null,
  isRunning: false,
  runToken: 0,
  tool: "robot",
};

const editorHistory = {
  undo: [],
  redo: [],
  previous: null,
  lastInputAt: 0,
  lastInputType: "",
  applying: false,
};

function cellKey(x, y) {
  return `${x},${y}`;
}

function edgeKey(x1, y1, x2, y2) {
  const first = `${x1},${y1}`;
  const second = `${x2},${y2}`;
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function wallEdge(wall) {
  return wall.side === "right"
    ? edgeKey(wall.x, wall.y, wall.x + 1, wall.y)
    : edgeKey(wall.x, wall.y, wall.x, wall.y + 1);
}

function saveField() {
  storage.set("field", state.field);
}

function showMessage(message, type = "info") {
  elements.consoleBox.classList.remove("success", "error");
  if (type !== "info") elements.consoleBox.classList.add(type);
  elements.consoleIcon.textContent = type === "success" ? "✓" : type === "error" ? "!" : "›";
  elements.consoleText.textContent = message;
}

function renderBoard() {
  const { cols, rows, goals, walls } = state.field;
  elements.board.style.setProperty("--cols", cols);
  elements.board.style.setProperty("--rows", rows);
  elements.board.classList.toggle("editable", !state.isRunning);
  elements.board.setAttribute("aria-label", `Поле ${cols} на ${rows}. Робот в клетке ${state.position.x + 1}, ${state.position.y + 1}.`);
  elements.board.replaceChildren();
  const goalKeys = new Set(goals.map(([x, y]) => cellKey(x, y)));

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = x;
      cell.dataset.y = y;
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label", `Столбец ${x + 1}, строка ${y + 1}`);
      if (x === cols - 1) cell.style.borderRight = "0";
      if (y === rows - 1) cell.style.borderBottom = "0";
      if (goalKeys.has(cellKey(x, y))) cell.classList.add("goal");
      if (state.painted.has(cellKey(x, y))) cell.classList.add("painted");
      cell.addEventListener("pointerdown", (event) => editCell(event, x, y));
      elements.board.append(cell);
    }
  }

  walls.forEach((wall) => {
    const marker = document.createElement("span");
    marker.className = `wall ${wall.side === "right" ? "vertical" : "horizontal"}`;
    if (wall.side === "right") {
      marker.style.left = `${((wall.x + 1) / cols) * 100}%`;
      marker.style.top = `${(wall.y / rows) * 100}%`;
      marker.style.height = `${100 / rows}%`;
    } else {
      marker.style.left = `${(wall.x / cols) * 100}%`;
      marker.style.top = `${((wall.y + 1) / rows) * 100}%`;
      marker.style.width = `${100 / cols}%`;
    }
    elements.board.append(marker);
  });

  const robot = document.createElement("div");
  robot.className = "robot";
  robot.id = "robot";
  robot.style.setProperty("--x", state.position.x);
  robot.style.setProperty("--y", state.position.y);
  robot.innerHTML = '<div class="robot-body"><span class="robot-face"><i class="robot-eye"></i><i class="robot-eye"></i></span></div>';
  elements.board.append(robot);
}

function nearestWall(event, x, y) {
  const rect = event.currentTarget.getBoundingClientRect();
  const distances = [
    { edge: "left", value: event.clientX - rect.left },
    { edge: "right", value: rect.right - event.clientX },
    { edge: "top", value: event.clientY - rect.top },
    { edge: "bottom", value: rect.bottom - event.clientY },
  ].sort((a, b) => a.value - b.value);
  const edge = distances[0].edge;
  if (edge === "left" && x > 0) return { x: x - 1, y, side: "right" };
  if (edge === "right" && x < state.field.cols - 1) return { x, y, side: "right" };
  if (edge === "top" && y > 0) return { x, y: y - 1, side: "bottom" };
  if (edge === "bottom" && y < state.field.rows - 1) return { x, y, side: "bottom" };
  return null;
}

function sameWall(left, right) {
  return left.x === right.x && left.y === right.y && left.side === right.side;
}

function editCell(event, x, y) {
  if (state.isRunning) return;
  stopRunning();
  state.program = null;
  const key = cellKey(x, y);

  if (state.tool === "robot") {
    state.field.start = { x, y };
    state.position = { x, y };
  } else if (state.tool === "goal") {
    const index = state.field.goals.findIndex(([goalX, goalY]) => goalX === x && goalY === y);
    if (index >= 0) state.field.goals.splice(index, 1);
    else state.field.goals.push([x, y]);
  } else if (state.tool === "wall") {
    const wall = nearestWall(event, x, y);
    if (!wall) {
      showMessage("Внешняя граница поля уже является стеной.");
      return;
    }
    const index = state.field.walls.findIndex((item) => sameWall(item, wall));
    if (index >= 0) state.field.walls.splice(index, 1);
    else state.field.walls.push(wall);
  } else if (state.tool === "eraser") {
    state.field.goals = state.field.goals.filter(([goalX, goalY]) => goalX !== x || goalY !== y);
    state.painted.delete(key);
    state.field.walls = state.field.walls.filter((wall) => {
      const touchesLeft = wall.side === "right" && ((wall.x === x && wall.y === y) || (wall.x + 1 === x && wall.y === y));
      const touchesBottom = wall.side === "bottom" && ((wall.x === x && wall.y === y) || (wall.x === x && wall.y + 1 === y));
      return !touchesLeft && !touchesBottom;
    });
  }

  saveField();
  renderBoard();
  showMessage("Поле изменено и сохранено в браузере.");
}

function stopRunning() {
  state.isRunning = false;
  state.runToken += 1;
  elements.stepButton.disabled = false;
  setRunButtonLabel(false);
}

function resetSimulation(message = true) {
  stopRunning();
  state.position = { ...state.field.start };
  state.painted = new Set();
  state.program = null;
  renderBoard();
  if (message) showMessage("Робот возвращён в начальную позицию.");
}

function resizeField() {
  stopRunning();
  const cols = Math.max(3, Math.min(30, Number(elements.columnsInput.value) || 8));
  const rows = Math.max(3, Math.min(24, Number(elements.rowsInput.value) || 7));
  state.field.cols = cols;
  state.field.rows = rows;
  state.field.start.x = Math.min(state.field.start.x, cols - 1);
  state.field.start.y = Math.min(state.field.start.y, rows - 1);
  state.field.goals = state.field.goals.filter(([x, y]) => x < cols && y < rows);
  state.field.walls = state.field.walls.filter((wall) => wall.x < cols && wall.y < rows && !(wall.side === "right" && wall.x >= cols - 1) && !(wall.side === "bottom" && wall.y >= rows - 1));
  elements.columnsInput.value = cols;
  elements.rowsInput.value = rows;
  saveField();
  resetSimulation(false);
  showMessage(`Размер поля изменён: ${cols} × ${rows}.`);
}

function normalize(text) {
  return text.toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/\s+/g, " ").replace(/;$/, "").trim();
}

function parseCondition(source, lineNumber) {
  let text = normalize(source);
  let inverted = false;
  if (text.startsWith("не ")) {
    inverted = true;
    text = text.slice(3);
  }
  const conditions = new Map([
    ["справа свободно", "RIGHT_FREE"], ["слева свободно", "LEFT_FREE"],
    ["сверху свободно", "UP_FREE"], ["снизу свободно", "DOWN_FREE"],
    ["клетка чистая", "CELL_CLEAR"], ["клетка закрашена", "CELL_PAINTED"],
  ]);
  if (!conditions.has(text)) throw new Error(`Строка ${lineNumber}: неизвестное условие «${source.trim()}».`);
  return { type: conditions.get(text), inverted };
}

function compile(source) {
  const sourceLines = source.split(/\r?\n/);
  const instructions = [];
  const blocks = [];
  const ignored = /^(использовать\s+робот|алг(?:\s|$)|нач$|кон$)/;
  const primitives = new Map([["вверх", "UP"], ["вниз", "DOWN"], ["влево", "LEFT"], ["вправо", "RIGHT"], ["закрасить", "PAINT"]]);

  for (let index = 0; index < sourceLines.length; index += 1) {
    const lineNumber = index + 1;
    const text = normalize(sourceLines[index].split("|")[0]);
    if (!text || ignored.test(text)) continue;
    if (primitives.has(text)) {
      instructions.push({ op: primitives.get(text), line: lineNumber });
      continue;
    }
    const repeat = text.match(/^нц\s+(\d+)\s+раз$/);
    if (repeat) {
      const count = Number(repeat[1]);
      if (count > 10000) throw new Error(`Строка ${lineNumber}: слишком большое число повторений.`);
      const start = instructions.length;
      instructions.push({ op: "REPEAT", count, end: null, line: lineNumber });
      blocks.push({ type: "loop", start, line: lineNumber });
      continue;
    }
    const whileMatch = text.match(/^нц\s+пока\s+(.+)$/);
    if (whileMatch) {
      const start = instructions.length;
      instructions.push({ op: "WHILE", condition: parseCondition(whileMatch[1], lineNumber), end: null, line: lineNumber });
      blocks.push({ type: "loop", start, line: lineNumber });
      continue;
    }
    if (text === "кц") {
      const block = blocks.pop();
      if (!block || block.type !== "loop") throw new Error(`Строка ${lineNumber}: лишняя команда «кц».`);
      const end = instructions.length;
      instructions.push({ op: "LOOP_END", start: block.start, line: lineNumber });
      instructions[block.start].end = end;
      continue;
    }
    const ifMatch = text.match(/^если\s+(.+?)\s+то$/);
    if (ifMatch) {
      const start = instructions.length;
      instructions.push({ op: "IF", condition: parseCondition(ifMatch[1], lineNumber), jump: null, line: lineNumber });
      blocks.push({ type: "if", start, elseIndex: null, line: lineNumber });
      continue;
    }
    if (text === "иначе") {
      const block = blocks.at(-1);
      if (!block || block.type !== "if" || block.elseIndex !== null) throw new Error(`Строка ${lineNumber}: команда «иначе» находится вне условия.`);
      block.elseIndex = instructions.length;
      instructions.push({ op: "ELSE", jump: null, line: lineNumber });
      instructions[block.start].jump = block.elseIndex + 1;
      continue;
    }
    if (text === "все") {
      const block = blocks.pop();
      if (!block || block.type !== "if") throw new Error(`Строка ${lineNumber}: лишняя команда «все».`);
      if (block.elseIndex === null) instructions[block.start].jump = instructions.length;
      else instructions[block.elseIndex].jump = instructions.length;
      continue;
    }
    throw new Error(`Строка ${lineNumber}: неизвестная команда «${text}».`);
  }
  if (blocks.length) {
    const block = blocks.at(-1);
    throw new Error(`После строки ${block.line} ожидается команда «${block.type === "loop" ? "кц" : "все"}».`);
  }
  if (!instructions.length) throw new Error("В алгоритме нет исполняемых команд.");
  return { instructions, pc: 0, counters: new Map(), operations: 0, source };
}

function isMoveFree(dx, dy) {
  const nextX = state.position.x + dx;
  const nextY = state.position.y + dy;
  if (nextX < 0 || nextY < 0 || nextX >= state.field.cols || nextY >= state.field.rows) return false;
  const walls = new Set(state.field.walls.map(wallEdge));
  return !walls.has(edgeKey(state.position.x, state.position.y, nextX, nextY));
}

function evaluateCondition(condition) {
  const checks = {
    RIGHT_FREE: () => isMoveFree(1, 0), LEFT_FREE: () => isMoveFree(-1, 0),
    UP_FREE: () => isMoveFree(0, -1), DOWN_FREE: () => isMoveFree(0, 1),
    CELL_CLEAR: () => !state.painted.has(cellKey(state.position.x, state.position.y)),
    CELL_PAINTED: () => state.painted.has(cellKey(state.position.x, state.position.y)),
  };
  const result = checks[condition.type]();
  return condition.inverted ? !result : result;
}

function performPrimitive(instruction) {
  const movement = { UP: [0, -1, "вверх"], DOWN: [0, 1, "вниз"], LEFT: [-1, 0, "влево"], RIGHT: [1, 0, "вправо"] };
  if (instruction.op === "PAINT") {
    state.painted.add(cellKey(state.position.x, state.position.y));
    return;
  }
  const [dx, dy, title] = movement[instruction.op];
  if (!isMoveFree(dx, dy)) {
    document.querySelector("#robot")?.classList.add("crashed");
    throw new Error(`Строка ${instruction.line}: Робот разбился — путь ${title} закрыт.`);
  }
  state.position.x += dx;
  state.position.y += dy;
}

function ensureProgram() {
  if (state.program?.source === elements.editor.value) return true;
  try {
    state.program = compile(elements.editor.value);
    showMessage(`Алгоритм проверен. Команд: ${state.program.instructions.length}.`);
    return true;
  } catch (error) {
    state.program = null;
    showMessage(error.message, "error");
    return false;
  }
}

function finishProgram() {
  const goals = state.field.goals;
  const allGoalsPainted = goals.length > 0 && goals.every(([x, y]) => state.painted.has(cellKey(x, y)));
  const operations = state.program?.operations ?? 0;
  stopRunning();
  showMessage(allGoalsPainted ? `Алгоритм завершён. Все цели закрашены. Действий: ${operations}.` : `Алгоритм завершён. Действий: ${operations}.`, "success");
}

function executeOneAction() {
  const program = state.program;
  let controlSteps = 0;
  while (program.pc < program.instructions.length) {
    if (program.operations > 10000 || controlSteps > 20000) throw new Error("Выполнение остановлено: возможно, в алгоритме бесконечный цикл.");
    controlSteps += 1;
    const instruction = program.instructions[program.pc];
    if (["UP", "DOWN", "LEFT", "RIGHT", "PAINT"].includes(instruction.op)) {
      performPrimitive(instruction);
      program.operations += 1;
      program.pc += 1;
      renderBoard();
      showMessage(`Выполнена строка ${instruction.line}. Действий: ${program.operations}.`);
      return "action";
    }
    if (instruction.op === "REPEAT") {
      if (!program.counters.has(program.pc)) program.counters.set(program.pc, instruction.count);
      if (program.counters.get(program.pc) <= 0) {
        program.counters.delete(program.pc);
        program.pc = instruction.end + 1;
      } else program.pc += 1;
      continue;
    }
    if (instruction.op === "WHILE") {
      program.pc = evaluateCondition(instruction.condition) ? program.pc + 1 : instruction.end + 1;
      continue;
    }
    if (instruction.op === "LOOP_END") {
      const start = program.instructions[instruction.start];
      if (start.op === "REPEAT") program.counters.set(instruction.start, (program.counters.get(instruction.start) ?? 1) - 1);
      program.pc = instruction.start;
      continue;
    }
    if (instruction.op === "IF") {
      program.pc = evaluateCondition(instruction.condition) ? program.pc + 1 : instruction.jump;
      continue;
    }
    if (instruction.op === "ELSE") program.pc = instruction.jump;
  }
  finishProgram();
  return "halt";
}

function stepProgram() {
  if (state.isRunning) return;
  if (state.program && state.program.pc >= state.program.instructions.length) resetSimulation(false);
  if (!ensureProgram()) return;
  try {
    const result = executeOneAction();
    if (result === "action" && state.program.pc >= state.program.instructions.length) finishProgram();
  } catch (error) {
    stopRunning();
    showMessage(error.message, "error");
  }
}

function setRunButtonLabel(running) {
  [...elements.runButton.childNodes].forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE && /Запустить|Остановить/.test(node.textContent)) node.textContent = running ? " Остановить " : " Запустить ";
  });
}

async function runProgram() {
  if (state.isRunning) {
    stopRunning();
    renderBoard();
    showMessage("Выполнение остановлено.");
    return;
  }
  if (state.program && state.program.pc >= state.program.instructions.length) resetSimulation(false);
  if (!ensureProgram()) return;
  state.isRunning = true;
  const token = ++state.runToken;
  elements.stepButton.disabled = true;
  setRunButtonLabel(true);
  renderBoard();
  const delays = { 1: 700, 2: 460, 3: 270, 4: 140, 5: 55 };
  try {
    while (state.isRunning && state.runToken === token) {
      const result = executeOneAction();
      if (result === "halt") break;
      await new Promise((resolve) => setTimeout(resolve, delays[elements.speedRange.value] ?? 270));
    }
  } catch (error) {
    stopRunning();
    showMessage(error.message, "error");
  } finally {
    if (state.runToken === token) stopRunning();
    renderBoard();
  }
}

function updateCursorPosition() {
  const lines = elements.editor.value.slice(0, elements.editor.selectionStart).split("\n");
  elements.cursorPosition.textContent = `Строка ${lines.length}, столбец ${lines.at(-1).length + 1}`;
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function isKnownCondition(value) {
  const condition = normalize(value).replace(/^не\s+/, "");
  return [
    "справа свободно", "слева свободно", "сверху свободно", "снизу свободно",
    "клетка чистая", "клетка закрашена",
  ].includes(condition);
}

function highlightCodePart(code) {
  const normalized = normalize(code);
  const escaped = escapeHtml(code);
  const commands = ["вверх", "вниз", "влево", "вправо", "закрасить"];
  const singleKeywords = ["нач", "кон", "кц", "иначе", "все"];

  if (commands.includes(normalized)) return `<span class="syntax-command">${escaped}</span>`;
  if (singleKeywords.includes(normalized)) return `<span class="syntax-keyword">${escaped}</span>`;
  if (/^использовать\s+робот$/u.test(normalized)) return `<span class="syntax-keyword">${escaped}</span>`;

  let match = code.match(/^(\s*)(алг)(.*)$/iu);
  if (match) {
    return `${escapeHtml(match[1])}<span class="syntax-keyword">${escapeHtml(match[2])}</span><span class="syntax-plain">${escapeHtml(match[3])}</span>`;
  }

  match = code.match(/^(\s*)(нц)(\s+)(\d+)(\s+)(раз)\s*$/iu);
  if (match) {
    return `${escapeHtml(match[1])}<span class="syntax-keyword">${escapeHtml(match[2])}</span>${escapeHtml(match[3])}<span class="syntax-number">${match[4]}</span>${escapeHtml(match[5])}<span class="syntax-keyword">${escapeHtml(match[6])}</span>`;
  }

  match = code.match(/^(\s*)(нц)(\s+)(пока)(\s+)(.+?)\s*$/iu);
  if (match && isKnownCondition(match[6])) {
    return `${escapeHtml(match[1])}<span class="syntax-keyword">${escapeHtml(match[2])}</span>${escapeHtml(match[3])}<span class="syntax-keyword">${escapeHtml(match[4])}</span>${escapeHtml(match[5])}<span class="syntax-condition">${escapeHtml(match[6])}</span>`;
  }

  match = code.match(/^(\s*)(если)(\s+)(.+?)(\s+)(то)\s*$/iu);
  if (match && isKnownCondition(match[4])) {
    return `${escapeHtml(match[1])}<span class="syntax-keyword">${escapeHtml(match[2])}</span>${escapeHtml(match[3])}<span class="syntax-condition">${escapeHtml(match[4])}</span>${escapeHtml(match[5])}<span class="syntax-keyword">${escapeHtml(match[6])}</span>`;
  }

  return escaped;
}

function updateSyntaxHighlight() {
  elements.syntaxHighlight.innerHTML = elements.editor.value.split("\n").map((line) => {
    const commentIndex = line.indexOf("|");
    if (commentIndex < 0) return highlightCodePart(line);
    const code = line.slice(0, commentIndex);
    const comment = line.slice(commentIndex);
    return `${highlightCodePart(code)}<span class="syntax-comment">${escapeHtml(comment)}</span>`;
  }).join("\n");
  elements.syntaxHighlight.scrollTop = elements.editor.scrollTop;
  elements.syntaxHighlight.scrollLeft = elements.editor.scrollLeft;
}

function updateEditorChrome() {
  const count = Math.max(1, elements.editor.value.split("\n").length);
  elements.lineNumbers.textContent = Array.from({ length: count }, (_, index) => index + 1).join("\n");
  updateSyntaxHighlight();
  updateCursorPosition();
}

function editorSnapshot() {
  return {
    value: elements.editor.value,
    start: elements.editor.selectionStart,
    end: elements.editor.selectionEnd,
  };
}

function restoreEditorSnapshot(snapshot) {
  editorHistory.applying = true;
  elements.editor.value = snapshot.value;
  elements.editor.setSelectionRange(snapshot.start, snapshot.end);
  editorHistory.previous = editorSnapshot();
  editorHistory.lastInputAt = 0;
  editorHistory.lastInputType = "";
  editorHistory.applying = false;
  storage.set("code", elements.editor.value);
  state.program = null;
  updateEditorChrome();
}

function undoEditor() {
  const snapshot = editorHistory.undo.pop();
  if (!snapshot) return;
  editorHistory.redo.push(editorSnapshot());
  restoreEditorSnapshot(snapshot);
}

function redoEditor() {
  const snapshot = editorHistory.redo.pop();
  if (!snapshot) return;
  editorHistory.undo.push(editorSnapshot());
  restoreEditorSnapshot(snapshot);
}

function replaceEditorValue(value) {
  if (value === elements.editor.value) return;
  editorHistory.undo.push(editorSnapshot());
  if (editorHistory.undo.length > 150) editorHistory.undo.shift();
  editorHistory.redo = [];
  elements.editor.value = value;
  elements.editor.setSelectionRange(value.length, value.length);
  editorHistory.previous = editorSnapshot();
  editorHistory.lastInputAt = 0;
  storage.set("code", value);
  state.program = null;
  updateEditorChrome();
}

elements.editor.value = storage.get("code", defaultCode);
editorHistory.previous = editorSnapshot();
elements.columnsInput.value = state.field.cols;
elements.rowsInput.value = state.field.rows;

elements.editor.addEventListener("input", (event) => {
  if (!editorHistory.applying) {
    const now = Date.now();
    const inputType = event.inputType || "programmatic";
    const groupable = ["insertText", "deleteContentBackward", "deleteContentForward"].includes(inputType);
    const canMerge = groupable && inputType === editorHistory.lastInputType && now - editorHistory.lastInputAt < 700;
    if (!canMerge && editorHistory.previous && editorHistory.previous.value !== elements.editor.value) {
      editorHistory.undo.push(editorHistory.previous);
      if (editorHistory.undo.length > 150) editorHistory.undo.shift();
    }
    editorHistory.redo = [];
    editorHistory.previous = editorSnapshot();
    editorHistory.lastInputAt = now;
    editorHistory.lastInputType = inputType;
  }
  storage.set("code", elements.editor.value);
  state.program = null;
  updateEditorChrome();
});
elements.editor.addEventListener("scroll", () => {
  elements.lineNumbers.scrollTop = elements.editor.scrollTop;
  elements.syntaxHighlight.scrollTop = elements.editor.scrollTop;
  elements.syntaxHighlight.scrollLeft = elements.editor.scrollLeft;
});
elements.editor.addEventListener("click", updateCursorPosition);
elements.editor.addEventListener("keyup", updateCursorPosition);
elements.editor.addEventListener("keydown", (event) => {
  const modifier = event.ctrlKey || event.metaKey;
  const isUndoKey = event.code === "KeyZ" || event.key.toLocaleLowerCase() === "z";
  const isRedoKey = event.code === "KeyY" || event.key.toLocaleLowerCase() === "y";
  if (modifier && isUndoKey) {
    event.preventDefault();
    if (event.shiftKey) redoEditor();
    else undoEditor();
    return;
  }
  if (modifier && isRedoKey) {
    event.preventDefault();
    redoEditor();
    return;
  }
  if (event.key !== "Tab") return;
  event.preventDefault();
  elements.editor.setRangeText("  ", elements.editor.selectionStart, elements.editor.selectionEnd, "end");
  elements.editor.dispatchEvent(new Event("input"));
});

elements.runButton.addEventListener("click", runProgram);
elements.stepButton.addEventListener("click", stepProgram);
elements.resetButton.addEventListener("click", () => resetSimulation());
elements.columnsInput.addEventListener("change", resizeField);
elements.rowsInput.addEventListener("change", resizeField);
elements.toolButtons.forEach((button) => button.addEventListener("click", () => {
  state.tool = button.dataset.tool;
  elements.toolButtons.forEach((item) => item.classList.toggle("active", item === button));
}));
elements.clearFieldButton.addEventListener("click", () => {
  if ((state.field.goals.length || state.field.walls.length) && !window.confirm("Удалить все цели и стены с поля?")) return;
  state.field.goals = [];
  state.field.walls = [];
  saveField();
  resetSimulation(false);
  showMessage("Поле очищено.");
});
elements.clearCodeButton.addEventListener("click", () => {
  if (elements.editor.value.trim() && !window.confirm("Очистить редактор кода?")) return;
  replaceEditorValue("");
  elements.editor.focus();
});

elements.helpButton.addEventListener("click", () => elements.helpDialog.showModal());
elements.closeHelpButton.addEventListener("click", () => elements.helpDialog.close());
elements.helpDialog.addEventListener("click", (event) => { if (event.target === elements.helpDialog) elements.helpDialog.close(); });
elements.themeButton.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  storage.set("theme", next);
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    runProgram();
  }
});

const storedTheme = storage.get("theme");
if (storedTheme === "dark" || (!storedTheme && matchMedia("(prefers-color-scheme: dark)").matches)) document.documentElement.dataset.theme = "dark";

state.position = { ...state.field.start };
updateEditorChrome();
renderBoard();
showMessage("Свободная среда готова. Настройте поле и напишите алгоритм.");
