/* Anvil chat — turn-based continuous conversation */
;(function () {
  const vscode = acquireVsCodeApi()
  const isMain = document.documentElement.getAttribute('data-layout') === 'main'

  const state = {
    mode: 'agent',
    model: '',
    models: [],
    running: false,
    turns: [],
    empty: true,
    userPinnedScroll: false,
    openActs: {},
    expandActs: {},
    renderTimer: null
  }

  const feed = document.getElementById('feed')
  const input = document.getElementById('input')
  const chips = document.getElementById('chips')
  const modeBtn = document.getElementById('modeBtn')
  const modelBtn = document.getElementById('modelBtn')
  const sendBtn = document.getElementById('sendBtn')
  const emptyTpl = document.getElementById('emptyTpl')
  const agentsHint = document.getElementById('agentsHint')
  const jumpLatest = document.getElementById('jumpLatest')
  const changesBar = document.getElementById('changesBar')
  const changesCount = document.getElementById('changesCount')
  const bgTerm = document.getElementById('bgTerm')

  feed.addEventListener('scroll', () => {
    const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 72
    state.userPinnedScroll = !nearBottom
    jumpLatest.hidden = !(state.userPinnedScroll && (state.running || !nearBottom))
  })
  jumpLatest.onclick = () => {
    state.userPinnedScroll = false
    jumpLatest.hidden = true
    scrollBottom(true)
  }

  function setRunning(running) {
    state.running = running
    sendBtn.classList.toggle('stop', running)
    sendBtn.title = running ? 'Stop' : 'Send'
    sendBtn.setAttribute('aria-label', running ? 'Stop' : 'Send')
    sendBtn.innerHTML = running
      ? '<span class="stop-sq" aria-hidden="true"></span>'
      : '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 2.5 7.3 3.2 11.6 7.5H2v1h9.6L7.3 12.8 8 13.5 14 7.5 8 2.5z"/></svg>'
  }

  function submit() {
    if (state.running) {
      vscode.postMessage({ type: 'abort' })
      return
    }
    const text = input.value.trim()
    if (!text) return
    vscode.postMessage({ type: 'submit', text, mode: state.mode })
    input.value = ''
    autosize()
  }

  sendBtn.onclick = submit
  document.getElementById('newChat').onclick = () => vscode.postMessage({ type: 'newChat' })
  document.getElementById('historyBtn').onclick = () => vscode.postMessage({ type: 'history' })
  document.getElementById('settingsBtn').onclick = () => vscode.postMessage({ type: 'openSettings' })
  document.getElementById('ctxBtn').onclick = () => vscode.postMessage({ type: 'pickContext' })
  document.getElementById('undoAll').onclick = () => vscode.postMessage({ type: 'revertTask' })
  document.getElementById('keepAll').onclick = () => vscode.postMessage({ type: 'acceptAll' })
  document.getElementById('reviewAll').onclick = () => vscode.postMessage({ type: 'viewChanges' })
  document.getElementById('bgTermBtn').onclick = () => vscode.postMessage({ type: 'showTerminal' })

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
    if (e.key === '@' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      setTimeout(() => vscode.postMessage({ type: 'atTrigger' }), 0)
    }
    if (e.key === 'Escape') closeMenus()
  })
  input.addEventListener('input', autosize)
  function autosize() {
    input.style.height = 'auto'
    input.style.height = Math.min(input.scrollHeight, isMain ? 160 : 120) + 'px'
  }

  modeBtn.onclick = (e) => {
    e.stopPropagation()
    openModeMenu()
  }
  modelBtn.onclick = (e) => {
    e.stopPropagation()
    openModelMenu()
  }

  function closeMenus() {
    document.querySelectorAll('.menu-backdrop, .menu').forEach((n) => n.remove())
  }
  function placeMenu(anchor, el) {
    const r = anchor.getBoundingClientRect()
    el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 260)) + 'px'
    el.style.bottom = window.innerHeight - r.top + 6 + 'px'
  }

  function openModeMenu() {
    closeMenus()
    const backdrop = document.createElement('div')
    backdrop.className = 'menu-backdrop'
    backdrop.onclick = closeMenus
    const menu = document.createElement('div')
    menu.className = 'menu'
    ;[
      { id: 'agent', label: 'Agent', desc: 'Search, edit, run approved commands.' },
      { id: 'plan', label: 'Plan', desc: 'Inspect and plan. No edits.' },
      { id: 'ask', label: 'Ask', desc: 'Read-only questions.' }
    ].forEach((m) => {
      const b = document.createElement('button')
      b.className = 'item' + (state.mode === m.id ? ' active' : '')
      b.innerHTML =
        '<strong>' + escapeHtml(m.label) + '</strong><span class="desc">' + escapeHtml(m.desc) + '</span>'
      b.onclick = () => {
        state.mode = m.id
        modeBtn.textContent = m.label + ' ▾'
        vscode.postMessage({ type: 'setMode', mode: m.id })
        closeMenus()
      }
      menu.appendChild(b)
    })
    document.body.appendChild(backdrop)
    document.body.appendChild(menu)
    placeMenu(modeBtn, menu)
  }

  function openModelMenu() {
    closeMenus()
    const backdrop = document.createElement('div')
    backdrop.className = 'menu-backdrop'
    backdrop.onclick = closeMenus
    const menu = document.createElement('div')
    menu.className = 'menu'
    const search = document.createElement('input')
    search.type = 'search'
    search.placeholder = 'Search models'
    menu.appendChild(search)
    const render = (q) => {
      ;[...menu.querySelectorAll('.sec, .item')].forEach((n) => n.remove())
      const autoSec = document.createElement('div')
      autoSec.className = 'sec'
      autoSec.textContent = 'Auto'
      menu.appendChild(autoSec)
      const auto = document.createElement('button')
      auto.className = 'item'
      auto.innerHTML = '<strong>Auto</strong><span class="desc">Configured default</span>'
      auto.onclick = () => {
        vscode.postMessage({ type: 'selectModel', model: '__auto__' })
        closeMenus()
      }
      menu.appendChild(auto)
      const sec = document.createElement('div')
      sec.className = 'sec'
      sec.textContent = 'Models'
      menu.appendChild(sec)
      ;(state.models || [])
        .filter((n) => !q || n.toLowerCase().includes(q.toLowerCase()))
        .forEach((n) => {
          const b = document.createElement('button')
          b.className = 'item' + (n === state.model ? ' active' : '')
          b.innerHTML = '<strong>' + escapeHtml(shortModel(n)) + '</strong>'
          b.title = n
          b.onclick = () => {
            vscode.postMessage({ type: 'selectModel', model: n })
            closeMenus()
          }
          menu.appendChild(b)
        })
    }
    search.oninput = () => render(search.value)
    render('')
    document.body.appendChild(backdrop)
    document.body.appendChild(menu)
    placeMenu(modelBtn, menu)
    search.focus()
  }

  function shortModel(name) {
    if (!name) return 'Auto'
    const limit = isMain ? 28 : 16
    return name.length > limit ? name.slice(0, limit - 1) + '…' : name
  }

  window.addEventListener('message', (event) => {
    const msg = event.data
    if (!msg || !msg.type) return

    if (msg.type === 'focusComposer') {
      input.focus()
      return
    }
    if (msg.type === 'reset') {
      state.turns = []
      state.openActs = {}
      state.expandActs = {}
      setRunning(false)
      changesBar.hidden = true
      bgTerm.hidden = true
      renderAll()
    }
    if (msg.type === 'meta' && agentsHint) {
      agentsHint.style.display = msg.agentsMd ? 'inline-block' : 'none'
    }
    if (msg.type === 'composer') {
      if (msg.mode) {
        state.mode = msg.mode
        modeBtn.textContent = modeLabel(msg.mode) + ' ▾'
      }
      if (msg.model != null) {
        state.model = msg.model
        modelBtn.textContent = shortModel(msg.model || 'Auto') + ' ▾'
        modelBtn.title = msg.modelStatus || msg.model || 'Model'
      }
      if (msg.models) state.models = msg.models
      if (typeof msg.running === 'boolean') setRunning(msg.running)
    }
    if (msg.type === 'attachments') {
      chips.innerHTML = ''
      ;(msg.items || []).forEach((item) => {
        const el = document.createElement('span')
        el.className = 'chip'
        el.innerHTML = '<span>' + escapeHtml(item.label) + '</span>'
        const x = document.createElement('button')
        x.setAttribute('aria-label', 'Remove')
        x.textContent = '×'
        x.onclick = () => vscode.postMessage({ type: 'removeAttachment', id: item.id })
        el.appendChild(x)
        chips.appendChild(el)
      })
    }
    if (msg.type === 'sync') {
      state.turns = msg.turns || []
      if (typeof msg.running === 'boolean') setRunning(msg.running)
      renderAll()
      if (msg.scrollToTurnId) {
        const el = feed.querySelector('[data-turn="' + cssEsc(msg.scrollToTurnId) + '"]')
        if (el) {
          state.userPinnedScroll = false
          el.scrollIntoView({ block: 'start', behavior: 'smooth' })
        } else scrollBottom(true)
      } else {
        scrollBottom()
      }
    }
    if (msg.type === 'turn_upsert') {
      const turn = msg.turn
      if (!turn) return
      if (typeof msg.running === 'boolean') setRunning(msg.running)
      const idx = state.turns.findIndex((t) => t.id === turn.id)
      if (idx >= 0) state.turns[idx] = turn
      else state.turns.push(turn)
      scheduleRender(turn.id)
    }
    if (msg.type === 'taskSummary') {
      const n = msg.filesChanged || 0
      changesBar.hidden = n <= 0
      if (n > 0) changesCount.textContent = n + ' File' + (n === 1 ? '' : 's')
    }
    if (msg.type === 'bgTerminal') {
      bgTerm.hidden = !(msg.count > 0)
      const label = document.getElementById('bgTermLabel')
      if (label) label.textContent = (msg.count || 1) + ' background terminal' + ((msg.count || 1) === 1 ? '' : 's')
    }
    if (msg.type === 'permission') {
      // Attach to active turn DOM if present
      const last = feed.querySelector('.turn:last-child .assistant')
      if (!last) return
      const card = document.createElement('div')
      card.className = 'permission-card'
      card.innerHTML =
        '<div class="t">Anvil wants to run</div><pre class="cmd">' +
        escapeHtml(msg.command || msg.reason || msg.toolName) +
        '</pre>'
      const row = document.createElement('div')
      row.className = 'perm-actions'
      ;[
        ['Allow once', 'true'],
        ['Deny', 'false']
      ].forEach(([label, allowed]) => {
        const b = document.createElement('button')
        b.textContent = label
        b.onclick = () => {
          vscode.postMessage({ type: 'resolvePermission', id: msg.id, allowed })
          card.remove()
        }
        row.appendChild(b)
      })
      card.appendChild(row)
      last.appendChild(card)
      scrollBottom(true)
    }
    if (msg.type === 'error') {
      /* turn.complete already carries error; soft toast via turn render */
    }
    if (msg.type === 'status' && msg.message === 'Stopped') setRunning(false)
  })

  function scheduleRender(turnId) {
    if (state.renderTimer) return
    state.renderTimer = setTimeout(() => {
      state.renderTimer = null
      patchTurn(turnId)
      scrollBottom()
    }, 32)
  }

  function renderAll() {
    if (!state.turns.length) {
      feed.innerHTML = ''
      feed.appendChild(emptyTpl.content.cloneNode(true))
      state.empty = true
      feed.querySelectorAll('[data-suggest]').forEach((btn) => {
        btn.onclick = () => {
          input.value = btn.getAttribute('data-suggest') || ''
          input.focus()
        }
      })
      return
    }
    state.empty = false
    feed.innerHTML = ''
    state.turns.forEach((t) => feed.appendChild(buildTurnEl(t)))
  }

  function patchTurn(turnId) {
    if (state.empty) {
      renderAll()
      return
    }
    const turn = state.turns.find((t) => t.id === turnId)
    if (!turn) return
    const existing = feed.querySelector('[data-turn="' + cssEsc(turnId) + '"]')
    const next = buildTurnEl(turn)
    if (existing) existing.replaceWith(next)
    else {
      // remove empty state if present
      const empty = feed.querySelector('.empty')
      if (empty) feed.innerHTML = ''
      feed.appendChild(next)
      state.empty = false
    }
  }

  function buildTurnEl(turn) {
    const root = document.createElement('div')
    root.className = 'turn'
    root.dataset.turn = turn.id

    const user = document.createElement('div')
    user.className = 'user-card'
    user.textContent = turn.userMessage
    root.appendChild(user)

    const asst = document.createElement('div')
    asst.className = 'assistant'
    root.appendChild(asst)

    const done =
      turn.status === 'completed' || turn.status === 'failed' || turn.status === 'stopped'
    const expanded = state.expandActs[turn.id] === true

    if (done && turn.collapsedSummary && !expanded) {
      const bar = document.createElement('button')
      bar.type = 'button'
      bar.className = 'collapse-bar'
      bar.innerHTML =
        '<span class="ok">✓</span> ' + escapeHtml(turn.collapsedSummary) + ' <span class="chev">▾</span>'
      bar.onclick = () => {
        state.expandActs[turn.id] = true
        patchTurn(turn.id)
      }
      asst.appendChild(bar)
    } else {
      if (done && turn.collapsedSummary && expanded) {
        const bar = document.createElement('button')
        bar.type = 'button'
        bar.className = 'collapse-bar'
        bar.innerHTML = '<span class="ok">✓</span> Hide investigation <span class="chev">▴</span>'
        bar.onclick = () => {
          state.expandActs[turn.id] = false
          patchTurn(turn.id)
        }
        asst.appendChild(bar)
      }
      const stream = document.createElement('div')
      stream.className = 'act-stream'
      ;(turn.activities || []).forEach((a) => stream.appendChild(buildActivity(a)))
      asst.appendChild(stream)
    }

    if (turn.answer) {
      const ans = document.createElement('div')
      ans.className = 'answer' + (turn.status === 'answering' ? ' streaming' : '')
      if (turn.status === 'answering') {
        ans.textContent = turn.answer
      } else {
        ans.innerHTML = renderMarkdown(turn.answer)
        bindFileRefs(ans)
      }
      asst.appendChild(ans)
    } else if (turn.status === 'submitted' || turn.status === 'investigating' || turn.status === 'reasoning') {
      // no answer yet — activities show progress
    }

    if (done && turn.sources && turn.sources.length) {
      asst.appendChild(buildSources(turn.sources))
    }

    if (turn.error) {
      const err = document.createElement('div')
      err.className = 'turn-error'
      err.innerHTML = '<div class="t">Something went wrong</div><div>' + escapeHtml(turn.error) + '</div>'
      const row = document.createElement('div')
      row.className = 'perm-actions'
      const retry = document.createElement('button')
      retry.textContent = 'Retry'
      retry.onclick = () => vscode.postMessage({ type: 'retryLast' })
      row.appendChild(retry)
      err.appendChild(row)
      asst.appendChild(err)
    }

    if (turn.status === 'completed' && state.mode === 'plan' && turn.answer) {
      const b = document.createElement('button')
      b.className = 'implement-plan'
      b.textContent = 'Implement Plan'
      b.onclick = () => vscode.postMessage({ type: 'implementPlan', plan: turn.answer })
      asst.appendChild(b)
    }

    return root
  }

  function buildActivity(a) {
    const el = document.createElement('div')
    el.className = 'act ' + a.kind
    el.dataset.aid = a.id

    if (a.kind === 'thinking') {
      if (a.status === 'running' && !a.detail) {
        el.innerHTML = '<span class="spin"></span>Thinking'
        return el
      }
      const label =
        a.status === 'running'
          ? 'Thinking'
          : a.seconds != null && a.seconds <= 2
            ? 'Thought briefly'
            : a.seconds != null
              ? 'Thought for ' + a.seconds + 's'
              : a.label || 'Thought briefly'
      const open = state.openActs[a.id] ? ' open' : ''
      el.innerHTML =
        '<details' +
        open +
        '><summary>' +
        escapeHtml(label) +
        ' <span class="chev">▾</span></summary>' +
        (a.detail ? '<div class="body">' + escapeHtml(a.detail) + '</div>' : '') +
        '</details>'
      const d = el.querySelector('details')
      if (d) d.addEventListener('toggle', () => (state.openActs[a.id] = d.open))
      return el
    }

    if (a.kind === 'search') {
      const open = state.openActs[a.id] ? ' open' : ''
      el.innerHTML =
        '<details' +
        open +
        '><summary>› Searched codebase <span class="chev">▾</span></summary><div class="body"></div></details>'
      const body = el.querySelector('.body')
      if (a.query) body.appendChild(textDiv('"' + a.query + '"'))
      if (a.matches != null) body.appendChild(textDiv(a.matches + ' matches'))
      ;(a.files || []).slice(0, 6).forEach((f) => body.appendChild(fileRow(f.path)))
      const more = (a.files || []).length - 6
      if (more > 0) body.appendChild(textDiv('+' + more))
      const d = el.querySelector('details')
      if (d) d.addEventListener('toggle', () => (state.openActs[a.id] = d.open))
      return el
    }

    if (a.kind === 'read') {
      const n = (a.files || []).length
      const open = state.openActs[a.id] ? ' open' : ''
      el.innerHTML =
        '<details' +
        open +
        '><summary>› Read ' +
        n +
        ' file' +
        (n === 1 ? '' : 's') +
        ' <span class="chev">▾</span></summary><div class="body"></div></details>'
      const body = el.querySelector('.body')
      ;(a.files || []).forEach((f) => body.appendChild(fileRow(f.path, 'Read')))
      const d = el.querySelector('details')
      if (d) d.addEventListener('toggle', () => (state.openActs[a.id] = d.open))
      return el
    }

    if (a.kind === 'edit') {
      const f = (a.files || [])[0]
      if (!f) return el
      const card = document.createElement('div')
      card.className = 'card'
      const ext = (f.path.split('.').pop() || '').toUpperCase().slice(0, 3)
      card.innerHTML =
        '<div class="card-head"><span class="lang">' +
        escapeHtml(ext || 'FILE') +
        '</span><span class="card-name">' +
        escapeHtml(basename(f.path)) +
        '</span><span class="stats">' +
        (f.additions != null
          ? '<span class="add">+' + f.additions + '</span><span class="del">−' + (f.deletions || 0) + '</span>'
          : '') +
        '</span></div>'
      card.querySelector('.card-head').onclick = () =>
        vscode.postMessage({ type: 'viewDiff', path: f.path })
      el.appendChild(card)
      return el
    }

    if (a.kind === 'terminal') {
      const card = document.createElement('div')
      card.className = 'card'
      const mark =
        a.status === 'running' ? '<span class="spin"></span>' : a.status === 'failed' ? '✕' : '✓'
      const open = state.openActs[a.id] || a.status === 'running'
      card.innerHTML =
        '<div class="card-head"><span>' +
        mark +
        '</span><span class="card-name">' +
        escapeHtml(a.label || 'Ran') +
        '</span></div>' +
        (open
          ? '<div class="card-body">' +
            escapeHtml(a.command || '') +
            (a.summary ? '\n' + escapeHtml(a.summary) : '') +
            '</div>'
          : '')
      card.querySelector('.card-head').onclick = () => {
        state.openActs[a.id] = !state.openActs[a.id]
        patchTurn(
          state.turns.find((t) => t.activities && t.activities.some((x) => x.id === a.id))?.id
        )
      }
      el.appendChild(card)
      return el
    }

    el.textContent = '› ' + (a.label || a.kind) + (a.detail ? ' — ' + a.detail : '')
    return el
  }

  function textDiv(s) {
    const d = document.createElement('div')
    d.textContent = s
    return d
  }

  function fileRow(path, verb) {
    const row = document.createElement('div')
    row.className = 'row'
    if (verb) {
      const v = document.createElement('span')
      v.className = 'verb'
      v.textContent = verb
      row.appendChild(v)
    }
    const a = document.createElement('a')
    a.className = 'path'
    a.href = '#'
    a.textContent = path
    a.title = 'Open File'
    a.onclick = (e) => {
      e.preventDefault()
      vscode.postMessage({ type: 'openFile', path, line: '' })
    }
    row.appendChild(a)
    return row
  }

  function buildSources(files) {
    const wrap = document.createElement('div')
    wrap.className = 'sources'
    const d = document.createElement('details')
    d.innerHTML =
      '<summary>Sources · ' +
      files.length +
      ' file' +
      (files.length === 1 ? '' : 's') +
      ' <span class="chev">▾</span></summary>'
    const ul = document.createElement('ul')
    files.forEach((f) => {
      const li = document.createElement('li')
      const a = document.createElement('a')
      a.className = 'file-ref'
      a.href = '#'
      a.textContent = f
      a.title = 'Open File'
      a.onclick = (e) => {
        e.preventDefault()
        vscode.postMessage({ type: 'openFile', path: f, line: '' })
      }
      li.appendChild(a)
      ul.appendChild(li)
    })
    d.appendChild(ul)
    wrap.appendChild(d)
    return wrap
  }

  function modeLabel(m) {
    return ({ agent: 'Agent', plan: 'Plan', ask: 'Ask' })[m] || 'Agent'
  }

  function basename(p) {
    const parts = String(p).split('/')
    return parts[parts.length - 1] || p
  }

  function cssEsc(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  }

  function scrollBottom(force) {
    if (!force && state.userPinnedScroll) {
      jumpLatest.hidden = false
      return
    }
    feed.scrollTop = feed.scrollHeight
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    )
  }

  function renderMarkdown(src) {
    let text = String(src || '')
    // Soft normalize glued headings from small models
    text = text.replace(/^(#{1,6})(\d+)/gm, '$1 $2')
    text = text.replace(/^(#{1,6})([A-Za-z*])/gm, '$1 $2')
    const parts = []
    const re = /```([\w+-]*)\n?([\s\S]*?)```/g
    let m
    let last = 0
    while ((m = re.exec(text))) {
      parts.push({ type: 'md', value: text.slice(last, m.index) })
      parts.push({ type: 'code', lang: m[1] || '', value: m[2] })
      last = m.index + m[0].length
    }
    parts.push({ type: 'md', value: text.slice(last) })
    return parts
      .map((p) => {
        if (p.type === 'code') {
          const id = 'c' + Math.random().toString(36).slice(2)
          return (
            '<pre><div class="code-head"><span>' +
            escapeHtml(p.lang || 'code') +
            '</span><button type="button" data-copy="' +
            id +
            '">Copy</button></div><code id="' +
            id +
            '">' +
            escapeHtml(p.value.replace(/\n$/, '')) +
            '</code></pre>'
          )
        }
        return formatPlain(p.value)
      })
      .join('')
  }

  function formatPlain(md) {
    let html = escapeHtml(md)
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
    html = html.replace(/^(\d+)\. (.+)$/gm, '<li value="$1">$2</li>')
    html = html.replace(/^(?:- |\* )(.+)$/gm, '<li>$1</li>')
    html = html.replace(/(?:<li[^>]*>.*<\/li>\n?)+/g, (block) => {
      if (/value=/.test(block)) return '<ol>' + block + '</ol>'
      return '<ul>' + block + '</ul>'
    })
    html = html
      .split(/\n{2,}/)
      .map((block) => {
        if (/^<(h\d|ul|ol|li|pre|div)/.test(block.trim())) return block
        return '<p>' + block.replace(/\n/g, '<br>') + '</p>'
      })
      .join('')
    html = html.replace(
      /(?<![\w/])((?:[\w.-]+\/)+[\w.-]+\.[a-zA-Z0-9]+)(?::(\d+)(?:-(\d+))?)?/g,
      (_, path, line, end) =>
        '<a class="file-ref" href="#" data-path="' +
        escapeHtml(path) +
        '"' +
        (line ? ' data-line="' + line + '"' : '') +
        ' title="Open File">' +
        escapeHtml(path) +
        (line ? ':' + line + (end ? '-' + end : '') : '') +
        '</a>'
    )
    return html
  }

  function bindFileRefs(root) {
    root.querySelectorAll('.file-ref').forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault()
        vscode.postMessage({
          type: 'openFile',
          path: a.getAttribute('data-path'),
          line: a.getAttribute('data-line') || ''
        })
      }
    })
    root.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.onclick = () => {
        const code = document.getElementById(btn.getAttribute('data-copy'))
        if (code) {
          navigator.clipboard.writeText(code.textContent || '')
          btn.textContent = 'Copied'
          setTimeout(() => (btn.textContent = 'Copy'), 1200)
        }
      }
    })
  }

  renderAll()
  vscode.postMessage({ type: 'ready' })
})()
