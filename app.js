/**
 * 简易待办清单
 * 原生 JavaScript，无依赖，数据保存在 localStorage。
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'todo-app.items.v1';
  var MAX_LENGTH = 120;

  var form = document.getElementById('todo-form');
  var input = document.getElementById('todo-input');
  var hint = document.getElementById('form-hint');
  var list = document.getElementById('todo-list');
  var emptyEl = document.getElementById('empty-state');
  var summary = document.getElementById('summary');
  var clearBtn = document.getElementById('clear-done');
  var filterBtns = Array.prototype.slice.call(document.querySelectorAll('.filters__btn'));

  var todos = load();
  var filter = 'all';
  var editingId = null;

  /* ---------------- 存储 ---------------- */

  function load() {
    var raw;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return [];
    }
    if (!raw) return [];
    try {
      var data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data
        .filter(function (item) {
          return item && typeof item.text === 'string' && item.text.trim() !== '';
        })
        .map(function (item) {
          return {
            id: String(item.id || createId()),
            text: String(item.text).slice(0, MAX_LENGTH),
            done: item.done === true,
            createdAt: Number(item.createdAt) || Date.now()
          };
        });
    } catch (err) {
      return [];
    }
  }

  function save() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
      return true;
    } catch (err) {
      showHint('无法写入 localStorage，数据可能无法保存（浏览器隐私模式或空间不足）。');
      return false;
    }
  }

  function createId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ---------------- 操作 ---------------- */

  function addTodo(text) {
    var value = String(text || '').trim();
    if (!value) return false;
    todos.push({
      id: createId(),
      text: value.slice(0, MAX_LENGTH),
      done: false,
      createdAt: Date.now()
    });
    save();
    render();
    return true;
  }

  function toggleTodo(id) {
    var todo = findTodo(id);
    if (!todo) return;
    todo.done = !todo.done;
    save();

    var staysVisible =
      filter === 'all' || (filter === 'done' && todo.done) || (filter === 'active' && !todo.done);

    if (staysVisible) {
      var row = list.querySelector('[data-id="' + id + '"]');
      if (row) {
        row.classList.toggle('is-done', todo.done);
        row.setAttribute('data-done', String(todo.done));
        var box = row.querySelector('.item__check');
        if (box) box.checked = todo.done;
      }
      updateMeta();
    } else {
      render();
    }
  }

  function deleteTodo(id) {
    var index = indexOf(id);
    if (index === -1) return;
    todos.splice(index, 1);
    save();
    render();
    input.focus();
  }

  function updateText(id, text) {
    var todo = findTodo(id);
    var value = String(text || '').trim();
    if (!todo || !value) return;
    todo.text = value.slice(0, MAX_LENGTH);
    save();
  }

  function clearDone() {
    todos = todos.filter(function (todo) {
      return !todo.done;
    });
    save();
    render();
  }

  function findTodo(id) {
    for (var i = 0; i < todos.length; i++) {
      if (todos[i].id === id) return todos[i];
    }
    return null;
  }

  function indexOf(id) {
    for (var i = 0; i < todos.length; i++) {
      if (todos[i].id === id) return i;
    }
    return -1;
  }

  /* ---------------- 渲染 ---------------- */

  function visibleTodos() {
    return todos.filter(function (todo) {
      if (filter === 'done') return todo.done;
      if (filter === 'active') return !todo.done;
      return true;
    });
  }

  function createRow(todo) {
    var li = document.createElement('li');
    li.className = 'item' + (todo.done ? ' is-done' : '');
    li.setAttribute('data-id', todo.id);
    li.setAttribute('data-done', String(todo.done));

    var box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'item__check';
    box.checked = todo.done;
    box.setAttribute('aria-label', '标记完成：' + todo.text);

    var text = document.createElement('span');
    text.className = 'item__text';
    text.textContent = todo.text;
    text.title = '双击编辑';

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'item__delete';
    del.textContent = '×';
    del.setAttribute('aria-label', '删除：' + todo.text);
    del.title = '删除';

    li.appendChild(box);
    li.appendChild(text);
    li.appendChild(del);
    return li;
  }

  function render() {
    var items = visibleTodos();
    list.textContent = '';
    items.forEach(function (todo) {
      list.appendChild(createRow(todo));
    });

    emptyEl.hidden = items.length > 0;
    if (!emptyEl.hidden) {
      if (todos.length === 0) emptyEl.textContent = '还没有待办，先添加一条吧。';
      else if (filter === 'active') emptyEl.textContent = '没有未完成的待办，全部搞定了。';
      else emptyEl.textContent = '还没有已完成的待办。';
    }

    filterBtns.forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-filter') === filter);
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-filter') === filter));
    });

    updateMeta();
  }

  function updateMeta() {
    var doneCount = todos.filter(function (todo) {
      return todo.done;
    }).length;
    summary.textContent = '共 ' + todos.length + ' 项 · 已完成 ' + doneCount + ' 项';
    clearBtn.disabled = doneCount === 0;
  }

  /* ---------------- 行内编辑 ---------------- */

  function startEdit(id) {
    if (editingId) return;
    var todo = findTodo(id);
    var row = list.querySelector('[data-id="' + id + '"]');
    if (!todo || !row) return;

    var span = row.querySelector('.item__text');
    if (!span) return;

    editingId = id;
    var editor = document.createElement('input');
    editor.type = 'text';
    editor.className = 'item__edit';
    editor.maxLength = MAX_LENGTH;
    editor.value = todo.text;
    editor.setAttribute('aria-label', '编辑待办内容');
    span.replaceWith(editor);
    editor.focus();
    editor.select();

    var settled = false;
    function finish(cancel) {
      if (settled) return;
      settled = true;
      editingId = null;
      if (!cancel) updateText(id, editor.value);
      render();
    }

    editor.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(false);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(true);
      }
    });
    editor.addEventListener('blur', function () {
      finish(false);
    });
  }

  /* ---------------- 提示 ---------------- */

  var hintTimer = null;
  function showHint(message) {
    hint.textContent = message;
    if (hintTimer) window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(function () {
      hint.textContent = '';
    }, 2600);
  }

  /* ---------------- 事件绑定 ---------------- */

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var value = input.value.trim();
    if (!value) {
      showHint('请输入待办内容。');
      input.focus();
      return;
    }
    addTodo(value);
    input.value = '';
    input.focus();
  });

  input.addEventListener('input', function () {
    if (hint.textContent) hint.textContent = '';
  });

  list.addEventListener('change', function (event) {
    var box = event.target.closest('.item__check');
    if (!box) return;
    var row = box.closest('.item');
    if (row) toggleTodo(row.getAttribute('data-id'));
  });

  list.addEventListener('click', function (event) {
    var del = event.target.closest('.item__delete');
    if (!del) return;
    var row = del.closest('.item');
    if (row) deleteTodo(row.getAttribute('data-id'));
  });

  list.addEventListener('dblclick', function (event) {
    var text = event.target.closest('.item__text');
    if (!text) return;
    var row = text.closest('.item');
    if (row) startEdit(row.getAttribute('data-id'));
  });

  clearBtn.addEventListener('click', clearDone);

  filterBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      filter = btn.getAttribute('data-filter');
      render();
    });
  });

  render();
})();
