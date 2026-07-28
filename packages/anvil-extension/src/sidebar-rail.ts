import * as vscode from 'vscode'
import type { ChatController } from './chat-controller'

/** Lightweight Activity Bar surface — not the primary conversation. */
export class AnvilRailProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'anvil.agentView'
  private view?: vscode.WebviewView

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: ChatController
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    }
    webviewView.webview.html = this.html(webviewView.webview)

    this.controller.registerSurface({
      id: 'rail',
      post: (msg) => {
        if (msg.type === 'rail' || msg.type === 'status' || msg.type === 'composer' || msg.type === 'meta') {
          void webviewView.webview.postMessage(msg)
        }
      }
    })

    webviewView.webview.onDidReceiveMessage(async (msg: Record<string, string>) => {
      if (msg.type === 'ready') {
        webviewView.webview.postMessage({
          type: 'rail',
          sessions: this.controller.railSessions(),
          status: 'Idle'
        })
      }
      if (msg.type === 'openChat') await AnvilChatOpen(this.controller)
      if (msg.type === 'newChat') {
        await AnvilChatOpen(this.controller)
        await this.controller.newChat()
      }
      if (msg.type === 'history') await this.controller.showHistory()
      if (msg.type === 'openSession' && msg.id) {
        await AnvilChatOpen(this.controller)
        const s = this.controller.sessions.get(msg.id)
        if (s) await this.controller.openSession(s)
      }
      if (msg.type === 'quick' && msg.prompt) {
        await AnvilChatOpen(this.controller)
        await this.controller.startRun(msg.prompt)
      }
    })
  }

  private html(webview: vscode.Webview): string {
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'unsafe-inline';`
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  :root {
    --fg: var(--vscode-foreground);
    --muted: var(--vscode-descriptionForeground);
    --border: var(--vscode-widget-border, rgba(127,127,127,.35));
    --bg: var(--vscode-sideBar-background);
    --link: var(--vscode-textLink-foreground);
    --btn: var(--vscode-button-background);
    --btnFg: var(--vscode-button-foreground);
    font-family: var(--vscode-font-family);
    font-size: 12px;
  }
  body { margin: 0; padding: 10px; color: var(--fg); background: var(--bg); }
  .brand { font-weight: 600; letter-spacing: .12em; font-size: 11px; margin-bottom: 10px; }
  button {
    width: 100%; text-align: left; margin: 0 0 6px; padding: 8px 10px;
    border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--fg); cursor: pointer;
  }
  button.primary { background: var(--btn); color: var(--btnFg); border-color: transparent; text-align: center; font-weight: 600; }
  button:hover { border-color: var(--link); }
  .sec { font-size: 10px; letter-spacing: .06em; color: var(--muted); text-transform: uppercase; margin: 12px 0 6px; }
  .status { color: var(--muted); font-size: 11px; margin-top: 10px; }
  .chat-item { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
</head>
<body>
  <div class="brand">ANVIL</div>
  <button class="primary" id="open">Open Chat</button>
  <button id="new">New Chat</button>
  <button id="hist">History</button>
  <div class="sec">Quick</div>
  <button data-q="Explain how this project works">Explain codebase</button>
  <button data-q="Fix current errors using @problems">Fix problems</button>
  <div class="sec">Recent</div>
  <div id="recent"></div>
  <div class="status" id="status">Idle</div>
<script>
  const vscode = acquireVsCodeApi();
  document.getElementById('open').onclick = () => vscode.postMessage({ type: 'openChat' });
  document.getElementById('new').onclick = () => vscode.postMessage({ type: 'newChat' });
  document.getElementById('hist').onclick = () => vscode.postMessage({ type: 'history' });
  document.querySelectorAll('[data-q]').forEach(b => {
    b.onclick = () => vscode.postMessage({ type: 'quick', prompt: b.getAttribute('data-q') });
  });
  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'rail') {
      const host = document.getElementById('recent');
      host.innerHTML = '';
      (msg.sessions || []).slice(0, 8).forEach(s => {
        const b = document.createElement('button');
        b.className = 'chat-item';
        b.textContent = s.title;
        b.onclick = () => vscode.postMessage({ type: 'openSession', id: s.id });
        host.appendChild(b);
      });
      if (msg.status) document.getElementById('status').textContent = msg.status;
    }
    if (msg.type === 'status') document.getElementById('status').textContent = msg.message || '';
  });
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`
  }
}

async function AnvilChatOpen(_controller: ChatController): Promise<void> {
  await vscode.commands.executeCommand('anvil.openChat')
}
