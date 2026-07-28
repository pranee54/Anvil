import * as vscode from 'vscode'

export function buildChatHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  layout: 'side' | 'main'
): string {
  const css = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'chat.css'))
  const js = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'chat.js'))
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource}`
  ].join('; ')
  return `<!DOCTYPE html>
<html lang="en" data-layout="${layout}">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="${css}" />
</head>
<body class="layout-${layout}">
  <div id="app">
    <header class="topbar" role="banner">
      <div class="brand">Anvil</div>
      <div id="agentsHint" class="agents-hint" style="display:none" title="AGENTS.md active">Instructions</div>
      <div class="actions">
        <button type="button" class="icon" id="newChat" title="New Chat" aria-label="New Chat">＋</button>
        <button type="button" class="icon" id="historyBtn" title="History" aria-label="History">☰</button>
        <button type="button" class="icon" id="settingsBtn" title="Settings" aria-label="Settings">⋯</button>
      </div>
    </header>

    <main id="feed" class="feed feed-${layout}" role="log" aria-live="polite" aria-relevant="additions"></main>

    <button type="button" id="jumpLatest" class="jump-latest" hidden title="Jump to latest" aria-label="Jump to latest">↓ Latest</button>

    <footer class="composer-wrap" role="contentinfo">
      <div id="changesBar" class="changes-bar" hidden>
        <span class="ch-glyph">›</span>
        <span id="changesCount" class="ch-count">0 Files</span>
        <span class="spacer"></span>
        <button type="button" id="undoAll" class="ch-btn">Undo All</button>
        <button type="button" id="keepAll" class="ch-btn">Keep All</button>
        <button type="button" id="reviewAll" class="ch-btn">Review</button>
      </div>
      <div id="bgTerm" class="bg-term" hidden>
        <button type="button" id="bgTermBtn" class="bg-term-btn" aria-label="Show background terminal">
          <span class="ch-glyph">›</span>
          <span id="bgTermLabel">1 background terminal</span>
        </button>
      </div>
      <div id="chips" class="chips" aria-label="Attached context"></div>
      <div class="composer">
        <textarea id="input" rows="1" placeholder="Ask Anvil, / for commands, @ for context" aria-label="Message Anvil"></textarea>
        <div class="composer-bar">
          <button type="button" id="modeBtn" class="pill-btn" aria-haspopup="menu" aria-label="Mode">Agent ▾</button>
          <button type="button" id="modelBtn" class="pill-btn" aria-haspopup="menu" aria-label="Model">Auto ▾</button>
          <button type="button" id="ctxBtn" class="icon-attach" title="Add context" aria-label="Add context">@</button>
          <span class="spacer"></span>
          <button type="button" id="sendBtn" class="send-btn" title="Send" aria-label="Send">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 2.5 7.3 3.2 11.6 7.5H2v1h9.6L7.3 12.8 8 13.5 14 7.5 8 2.5z"/></svg>
          </button>
        </div>
      </div>
    </footer>
  </div>
  <template id="emptyTpl">
    <div class="empty">
      <div class="brand-lg">ANVIL</div>
      <h2>What are we building?</h2>
      <p>Ask about this workspace. Anvil investigates the repo, then answers from evidence.</p>
      <div class="suggestions">
        <button type="button" data-suggest="ee project em chestundi?">What does this project do?</button>
        <button type="button" data-suggest="how to use this project">How to use this project</button>
        <button type="button" data-suggest="login flow explain cheyyi">Explain the login flow</button>
      </div>
    </div>
  </template>
  <script src="${js}"></script>
</body>
</html>`
}
