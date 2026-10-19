/**
 * 待办清单自动化验证脚本
 *
 * 做法：启动一个本地静态服务器 + Edge/Chrome 无头浏览器，
 * 通过 CDP（Chrome DevTools Protocol）在真实浏览器里执行点击、输入、刷新，
 * 断言 DOM 与 localStorage 的实际状态。
 *
 * 依赖：Node.js >= 22（使用内置 fetch / WebSocket，无需 npm install）
 *
 * 用法：
 *   node tests/verify.mjs
 *   EDGE_PATH="C:\\path\\to\\msedge.exe" node tests/verify.mjs
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

const BROWSER_CANDIDATES = [
  process.env.EDGE_PATH,
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean);

/* ------------------------- 断言收集 ------------------------- */

const results = [];

function check(id, title, passed, detail) {
  results.push({ id, title, passed, detail });
  const tag = passed ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${id} ${title}${detail ? ` — ${detail}` : ''}`);
}

function equal(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

/* ------------------------- 静态服务器 ------------------------- */

function startServer() {
  const server = createServer(async (req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const filePath = resolve(join(ROOT, rel));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    try {
      const body = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not Found');
    }
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => done(server));
  });
}

/* ------------------------- CDP 客户端 ------------------------- */

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.handlers = new Map();
  }

  ready() {
    return new Promise((done, fail) => {
      this.ws.addEventListener('open', () => done());
      this.ws.addEventListener('error', (e) => fail(new Error('WebSocket 连接失败: ' + (e.message || 'unknown'))));
      this.ws.addEventListener('message', (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
          return;
        }
        const list = this.handlers.get(msg.method);
        if (list) list.forEach((fn) => fn(msg.params));
      });
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时: ${method}`));
        }
      }, 15000);
    });
  }

  once(method) {
    return new Promise((resolve) => {
      const fn = (params) => {
        const list = this.handlers.get(method) || [];
        this.handlers.set(
          method,
          list.filter((h) => h !== fn)
        );
        resolve(params);
      };
      this.handlers.set(method, [...(this.handlers.get(method) || []), fn]);
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHttp(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      /* 还没起来 */
    }
    await sleep(200);
  }
  throw new Error(`等待 ${url} 超时`);
}

/* ------------------------- 主流程 ------------------------- */

async function main() {
  const browserPath = BROWSER_CANDIDATES.find((p) => existsSync(p));
  if (!browserPath) {
    throw new Error(
      '未找到 Edge / Chrome。请通过 EDGE_PATH 或 CHROME_PATH 环境变量指定浏览器路径。'
    );
  }

  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.address().port}/`;
  const debugPort = 9333;
  const userDataDir = join(tmpdir(), `todo-verify-${Date.now()}`);

  const child = spawn(
    browserPath,
    [
      '--headless=new',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-gpu',
      '--disable-background-networking',
      'about:blank'
    ],
    { stdio: 'ignore' }
  );

  let cdp;
  try {
    const version = await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`);
    console.log(`浏览器：${version.Browser}`);
    console.log(`服务器：${baseUrl}`);
    console.log('');

    cdp = new CDP(version.webSocketDebuggerUrl);
    await cdp.ready();

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);

    async function evaluate(expression) {
      const res = await cdp.send(
        'Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise: true },
        sessionId
      );
      if (res.exceptionDetails) {
        throw new Error('页面执行出错: ' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
      }
      return res.result.value;
    }

    async function waitFor(expression, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await evaluate(`Boolean(${expression})`)) return true;
        await sleep(100);
      }
      throw new Error('等待页面条件超时: ' + expression);
    }

    async function goto(url) {
      const loaded = cdp.once('Page.loadEventFired');
      await cdp.send('Page.navigate', { url }, sessionId);
      await loaded;
      await waitFor(`document.readyState === 'complete' && document.getElementById('todo-list')`);
      await sleep(120);
    }

    /** 通过真实点击「添加」按钮提交 */
    async function addByClick(text) {
      await evaluate(`(() => {
        const input = document.getElementById('todo-input');
        input.focus();
        input.value = ${JSON.stringify(text)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('.composer__submit').click();
      })()`);
      await sleep(60);
    }

    /** 通过真实键盘 Enter 提交 */
    async function addByEnter(text) {
      await evaluate(`(() => {
        const input = document.getElementById('todo-input');
        input.focus();
        input.value = ${JSON.stringify(text)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await cdp.send(
        'Input.dispatchKeyEvent',
        {
          type: 'keyDown',
          key: 'Enter',
          code: 'Enter',
          text: '\r',
          unmodifiedText: '\r',
          windowsVirtualKeyCode: 13,
          nativeVirtualKeyCode: 13
        },
        sessionId
      );
      await cdp.send(
        'Input.dispatchKeyEvent',
        { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 },
        sessionId
      );
      await sleep(60);
    }

    const texts = () => evaluate(`Array.from(document.querySelectorAll('.item__text')).map(n => n.textContent)`);
    const doneFlags = () => evaluate(`Array.from(document.querySelectorAll('.item')).map(n => n.dataset.done)`);
    const stored = () => evaluate(`JSON.parse(localStorage.getItem('todo-app.items.v1') || '[]')`);
    const summaryText = () => evaluate(`document.getElementById('summary').textContent`);

    /** 双击第 index 条的文字，进入行内编辑 */
    async function dblclickTextAt(index) {
      await evaluate(`(() => {
        const el = document.querySelectorAll('.item__text')[${index}];
        el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      })()`);
      await sleep(100);
    }

    /** 用真实鼠标事件点击坐标点（会产生真实 blur / focus 流转） */
    async function mouseClickAt(selector, index) {
      const point = await evaluate(`(() => {
        const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' }, sessionId);
      await cdp.send(
        'Input.dispatchMouseEvent',
        { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 },
        sessionId
      );
      await cdp.send(
        'Input.dispatchMouseEvent',
        { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 },
        sessionId
      );
      await sleep(120);
    }

    /** 在编辑框上派发键盘事件；isComposing 用于模拟输入法组合期间的按键 */
    async function pressInEditor(key, isComposing) {
      return evaluate(`(() => {
        const editor = document.querySelector('.item__edit');
        if (!editor) return { dispatched: false, isComposing: false };
        const event = new KeyboardEvent('keydown', {
          key: ${JSON.stringify(key)},
          bubbles: true,
          cancelable: true,
          isComposing: ${Boolean(isComposing)}
        });
        editor.dispatchEvent(event);
        return { dispatched: true, isComposing: event.isComposing === true };
      })()`);
    }

    async function setEditorValue(value) {
      await evaluate(`(() => {
        const editor = document.querySelector('.item__edit');
        editor.value = ${JSON.stringify(value)};
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await sleep(40);
    }

    const isEditorOpen = () => evaluate(`Boolean(document.querySelector('.item__edit'))`);

    /* ---------- T1 初始状态 ---------- */
    await goto(baseUrl);
    const emptyInitial = await evaluate(`({
      rows: document.querySelectorAll('.item').length,
      emptyHidden: document.getElementById('empty-state').hidden,
      emptyText: document.getElementById('empty-state').textContent,
      summary: document.getElementById('summary').textContent,
      clearDisabled: document.getElementById('clear-done').disabled
    })`);
    check(
      'T1',
      '首次打开为空状态',
      emptyInitial.rows === 0 &&
        emptyInitial.emptyHidden === false &&
        emptyInitial.summary === '共 0 项 · 已完成 0 项' &&
        emptyInitial.clearDisabled === true,
      `列表 0 行，空态文案「${emptyInitial.emptyText}」，统计「${emptyInitial.summary}」`
    );

    /* ---------- T2 添加（点击按钮） ---------- */
    await addByClick('写周报');
    await addByClick('买牛奶');
    await addByClick('预约牙医');
    const afterAdd = await texts();
    check(
      'T2',
      '点击「添加」按钮添加 3 条待办',
      equal(afterAdd, ['写周报', '买牛奶', '预约牙医']),
      `实际：${JSON.stringify(afterAdd)}`
    );

    /* ---------- T3 拒绝空白输入 ---------- */
    const beforeBlank = (await texts()).length;
    await addByClick('   ');
    await sleep(100);
    const afterBlank = await texts();
    const blankHint = await evaluate(`document.getElementById('form-hint').textContent`);
    check(
      'T3',
      '空白内容不会被添加，并给出提示',
      afterBlank.length === beforeBlank && blankHint.length > 0,
      `条数 ${beforeBlank} → ${afterBlank.length}，提示「${blankHint}」`
    );

    /* ---------- T4 键盘 Enter 添加 ---------- */
    await addByEnter('整理书架');
    const afterEnter = await texts();
    const inputCleared = await evaluate(`document.getElementById('todo-input').value === ''`);
    check(
      'T4',
      '按 Enter 键添加并清空输入框',
      equal(afterEnter, ['写周报', '买牛奶', '预约牙医', '整理书架']) && inputCleared === true,
      `实际：${JSON.stringify(afterEnter)}，输入框已清空：${inputCleared}`
    );

    /* ---------- T5 勾选完成 ---------- */
    await evaluate(`document.querySelectorAll('.item__check')[1].click()`);
    await sleep(100);
    const afterToggle = await evaluate(`({
      done: Array.from(document.querySelectorAll('.item')).map(n => n.dataset.done),
      struck: document.querySelectorAll('.item')[1].classList.contains('is-done'),
      lineThrough: getComputedStyle(document.querySelectorAll('.item__text')[1]).textDecorationLine,
      summary: document.getElementById('summary').textContent,
      clearDisabled: document.getElementById('clear-done').disabled
    })`);
    check(
      'T5',
      '勾选后标记为已完成（样式与统计同步）',
      equal(afterToggle.done, ['false', 'true', 'false', 'false']) &&
        afterToggle.struck === true &&
        afterToggle.lineThrough.includes('line-through') &&
        afterToggle.summary === '共 4 项 · 已完成 1 项' &&
        afterToggle.clearDisabled === false,
      `data-done=${JSON.stringify(afterToggle.done)}，text-decoration=${afterToggle.lineThrough}，统计「${afterToggle.summary}」`
    );

    /* ---------- T6 删除 ---------- */
    await evaluate(`document.querySelectorAll('.item__delete')[0].click()`);
    await sleep(100);
    const afterDelete = await texts();
    check(
      'T6',
      '点击 × 删除指定待办',
      equal(afterDelete, ['买牛奶', '预约牙医', '整理书架']),
      `实际：${JSON.stringify(afterDelete)}`
    );

    /* ---------- T7 写入 localStorage ---------- */
    const storeAfterDelete = await stored();
    check(
      'T7',
      'localStorage 与界面状态一致',
      Array.isArray(storeAfterDelete) &&
        storeAfterDelete.length === 3 &&
        equal(
          storeAfterDelete.map((t) => [t.text, t.done]),
          [
            ['买牛奶', true],
            ['预约牙医', false],
            ['整理书架', false]
          ]
        ),
      `key=todo-app.items.v1，${storeAfterDelete.length} 条：${JSON.stringify(
        storeAfterDelete.map((t) => `${t.text}:${t.done}`)
      )}`
    );

    /* ---------- T8 刷新后持久化 ---------- */
    await goto(baseUrl);
    const afterReload = await texts();
    const afterReloadDone = await doneFlags();
    const afterReloadSummary = await summaryText();
    check(
      'T8',
      '刷新页面后数据与完成状态仍在（localStorage 生效）',
      equal(afterReload, ['买牛奶', '预约牙医', '整理书架']) &&
        equal(afterReloadDone, ['true', 'false', 'false']) &&
        afterReloadSummary === '共 3 项 · 已完成 1 项',
      `刷新后：${JSON.stringify(afterReload)}，done=${JSON.stringify(afterReloadDone)}`
    );

    /* ---------- T9 筛选视图 ---------- */
    await evaluate(`document.querySelector('[data-filter="active"]').click()`);
    await sleep(80);
    const activeView = await texts();
    await evaluate(`document.querySelector('[data-filter="done"]').click()`);
    await sleep(80);
    const doneView = await texts();
    await evaluate(`document.querySelector('[data-filter="all"]').click()`);
    await sleep(80);
    const allView = await texts();
    check(
      'T9',
      '筛选「未完成 / 已完成 / 全部」结果正确',
      equal(activeView, ['预约牙医', '整理书架']) &&
        equal(doneView, ['买牛奶']) &&
        equal(allView, ['买牛奶', '预约牙医', '整理书架']),
      `未完成=${JSON.stringify(activeView)}，已完成=${JSON.stringify(doneView)}`
    );

    /* ---------- T10 行内编辑 ---------- */
    await evaluate(`(() => {
      const text = document.querySelectorAll('.item__text')[1];
      text.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    })()`);
    await sleep(80);
    const editorOpen = await evaluate(`Boolean(document.querySelector('.item__edit'))`);
    await evaluate(`(() => {
      const editor = document.querySelector('.item__edit');
      editor.value = '预约牙医（改到周五）';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    await sleep(120);
    const afterEdit = await texts();
    const storeAfterEdit = await stored();
    check(
      'T10',
      '双击编辑文字并保存',
      editorOpen === true &&
        equal(afterEdit, ['买牛奶', '预约牙医（改到周五）', '整理书架']) &&
        storeAfterEdit.some((t) => t.text === '预约牙医（改到周五）'),
      `编辑框已打开：${editorOpen}，实际：${JSON.stringify(afterEdit)}`
    );

    /* ---------- T11 清除已完成 ---------- */
    await evaluate(`document.getElementById('clear-done').click()`);
    await sleep(100);
    const afterClear = await texts();
    const storeAfterClear = await stored();
    check(
      'T11',
      '「清除已完成」只移除已完成项',
      equal(afterClear, ['预约牙医（改到周五）', '整理书架']) &&
        storeAfterClear.length === 2 &&
        storeAfterClear.every((t) => t.done === false),
      `实际：${JSON.stringify(afterClear)}`
    );

    /* ---------- T12 清空后回到空状态 ---------- */
    // 每次删除都会重新渲染列表，因此逐条点击直到为空
    for (let guard = 0; guard < 20; guard++) {
      const remaining = await evaluate(`document.querySelectorAll('.item__delete').length`);
      if (remaining === 0) break;
      await evaluate(`document.querySelector('.item__delete').click()`);
      await sleep(60);
    }
    await sleep(100);
    const finalState = await evaluate(`({
      rows: document.querySelectorAll('.item').length,
      emptyHidden: document.getElementById('empty-state').hidden,
      emptyText: document.getElementById('empty-state').textContent,
      summary: document.getElementById('summary').textContent,
      stored: localStorage.getItem('todo-app.items.v1')
    })`);
    check(
      'T12',
      '全部删除后回到空状态且存储同步清空',
      finalState.rows === 0 &&
        finalState.emptyHidden === false &&
        finalState.summary === '共 0 项 · 已完成 0 项' &&
        finalState.stored === '[]',
      `行数 ${finalState.rows}，空态「${finalState.emptyText}」，存储 ${finalState.stored}`
    );

    /* ---------- T13 编辑中点击其他条目删除按钮（回归：首次点击失效） ---------- */
    await addByClick('甲');
    await addByClick('乙');
    await addByClick('丙');
    await dblclickTextAt(0);
    await setEditorValue('甲（改）');
    const editingBeforeClick = await isEditorOpen();
    // 真实鼠标点击「乙」的删除按钮：mousedown 会先让编辑框 blur
    await mouseClickAt('.item__delete', 1);
    const afterDeleteWhileEditing = await texts();
    const editorAfterClick = await isEditorOpen();
    check(
      'T13',
      '编辑中点击其他条目删除按钮，一次点击即生效（回归 #1）',
      editingBeforeClick === true &&
        equal(afterDeleteWhileEditing, ['甲（改）', '丙']) &&
        editorAfterClick === false,
      `点击前编辑框=${editingBeforeClick}，一次点击后列表=${JSON.stringify(
        afterDeleteWhileEditing
      )}，编辑框仍打开=${editorAfterClick}`
    );

    /* ---------- T14 输入法组合期间 Enter / Escape 不结束编辑 ---------- */
    await dblclickTextAt(0);
    await setEditorValue('甲（输入中）');
    await evaluate(`(() => {
      document.querySelector('.item__edit').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    })()`);
    const enterWhileComposing = await pressInEditor('Enter', true);
    const stillOpenAfterEnter = await isEditorOpen();
    const valueAfterEnter = await evaluate(
      `document.querySelector('.item__edit') ? document.querySelector('.item__edit').value : null`
    );
    const escapeWhileComposing = await pressInEditor('Escape', true);
    const stillOpenAfterEscape = await isEditorOpen();
    const countDuringComposition = await evaluate(`document.querySelectorAll('.item').length`);
    const inputUntouched = await evaluate(`document.getElementById('todo-input').value === ''`);
    check(
      'T14',
      '输入法组合期间 Enter / Escape 不结束编辑、不误提交（回归 #2）',
      enterWhileComposing.isComposing === true &&
        stillOpenAfterEnter === true &&
        valueAfterEnter === '甲（输入中）' &&
        escapeWhileComposing.isComposing === true &&
        stillOpenAfterEscape === true &&
        countDuringComposition === 2 &&
        inputUntouched === true,
      `isComposing 已生效=${enterWhileComposing.isComposing}，Enter 后仍编辑=${stillOpenAfterEnter}，Escape 后仍编辑=${stillOpenAfterEscape}，条目数=${countDuringComposition}`
    );

    /* ---------- T15 候选词确认不结束编辑，之后的 Enter 才提交 ---------- */
    // compositionend 与确认候选词的 Enter 发生在同一按键序列（同一任务）里
    await evaluate(`(() => {
      const editor = document.querySelector('.item__edit');
      editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', bubbles: true, cancelable: true, isComposing: false
      }));
    })()`);
    await sleep(80);
    const openAfterConfirmEnter = await isEditorOpen();
    // 组合真正结束后，用户再按一次 Enter 才应提交
    await sleep(120);
    const enterAfterComposition = await pressInEditor('Enter', false);
    await sleep(120);
    const textAfterComposition = await texts();
    const storedAfterComposition = await stored();
    const editorAfterComposition = await isEditorOpen();
    check(
      'T15',
      '确认候选词的 Enter 被忽略，随后按 Enter 正常提交',
      openAfterConfirmEnter === true &&
        enterAfterComposition.dispatched === true &&
        editorAfterComposition === false &&
        equal(textAfterComposition, ['甲（输入中）', '丙']) &&
        storedAfterComposition.some((t) => t.text === '甲（输入中）'),
      `确认 Enter 后仍编辑=${openAfterConfirmEnter}，再次 Enter 后列表=${JSON.stringify(
        textAfterComposition
      )}，存储=${JSON.stringify(storedAfterComposition.map((t) => t.text))}`
    );
  } finally {
    try {
      if (cdp) {
        await cdp.send('Browser.close').catch(() => {});
        cdp.close();
      }
    } catch {
      /* ignore */
    }
    child.kill();
    server.close();
    await sleep(300);
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }

  const passed = results.filter((r) => r.passed).length;
  console.log('');
  console.log(`结果：${passed}/${results.length} 项通过`);
  if (passed !== results.length) {
    console.log('失败项：');
    results.filter((r) => !r.passed).forEach((r) => console.log(`  - ${r.id} ${r.title}（${r.detail}）`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('验证脚本执行失败：', err.message);
  process.exitCode = 1;
});
