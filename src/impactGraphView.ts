import { basename, relative } from "node:path";
import * as vscode from "vscode";
import { TxtJetJavaWorkspaceDependency } from "./javaWorkspaceIntelligence";
import { TxtJetWorkspaceModel } from "./workspaceModel";

export interface JetForgeImpactNode {
  id: string;
  fileName: string;
  label: string;
  detail: string;
  kind: "source" | "template" | "include" | "skeleton" | "generated" | "java-class";
}

export interface JetForgeImpactEdge {
  source: string;
  target: string;
  kind: "include" | "skeleton" | "generated" | "java-class";
  label: string;
}

export interface JetForgeImpactGraph {
  title: string;
  sourceId: string;
  nodes: JetForgeImpactNode[];
  edges: JetForgeImpactEdge[];
  unresolved: Array<{ source: string; reference: string; kind: string }>;
}

export function createImpactGraphData(
  model: TxtJetWorkspaceModel,
  fileName: string,
  classDependencies: TxtJetJavaWorkspaceDependency[]
): JetForgeImpactGraph {
  const impact = model.impactedBy(fileName);
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(fileName))?.uri.fsPath;
  const fileNames = new Set(impact.affectedEntries.map((entry) => entry.fileName));
  fileNames.add(fileName);
  for (const dependency of classDependencies) {
    fileNames.add(dependency.sourceClass.fileName);
    fileNames.add(dependency.targetClass.fileName);
  }
  const idByFile = new Map(Array.from(fileNames).sort().map((name, index) => [name, `node-${index}`]));
  const nodes = Array.from(fileNames).sort().map((name): JetForgeImpactNode => {
    const entry = model.entry(name);
    const javaClass = classDependencies.flatMap((dependency) => [dependency.sourceClass, dependency.targetClass])
      .find((candidate) => candidate.fileName === name);
    const kind = name === fileName
      ? "source"
      : javaClass && !entry ? "java-class"
        : entry?.kind === "include" ? "include"
          : entry?.kind === "skeleton" ? "skeleton" : "template";
    return {
      id: idByFile.get(name)!,
      fileName: name,
      label: javaClass?.className ?? basename(name),
      detail: workspaceRoot ? relative(workspaceRoot, name) : name,
      kind
    };
  });
  const edges: JetForgeImpactEdge[] = [];
  for (const reference of impact.references) {
    if (!reference.resolvedFileName) {
      continue;
    }
    const source = idByFile.get(reference.resolvedFileName);
    const target = idByFile.get(reference.sourceFileName);
    if (source && target) {
      edges.push({ source, target, kind: reference.kind, label: reference.referenceFile });
    }
  }
  for (const template of impact.generatedTargets) {
    const source = idByFile.get(template.fileName);
    if (!source) {
      continue;
    }
    const generatedId = `generated-${source}`;
    const extension = generatedExtension(template.targetLanguage);
    nodes.push({
      id: generatedId,
      fileName: template.fileName,
      label: `${basename(template.fileName)}.${extension}`,
      detail: "Generated output target",
      kind: "generated"
    });
    edges.push({ source, target: generatedId, kind: "generated", label: extension });
  }
  for (const dependency of classDependencies) {
    const source = idByFile.get(dependency.sourceClass.fileName);
    const target = idByFile.get(dependency.targetClass.fileName);
    if (source && target) {
      edges.push({ source, target, kind: "java-class", label: dependency.targetClass.className });
    }
  }
  const uniqueEdges = Array.from(new Map(edges.map((edge) => [`${edge.source}:${edge.target}:${edge.kind}`, edge])).values());
  return {
    title: workspaceRoot ? relative(workspaceRoot, fileName) : basename(fileName),
    sourceId: idByFile.get(fileName)!,
    nodes,
    edges: uniqueEdges,
    unresolved: impact.references.filter((entry) => !entry.resolvedFileName).map((entry) => ({
      source: workspaceRoot ? relative(workspaceRoot, entry.sourceFileName) : entry.sourceFileName,
      reference: entry.referenceFile,
      kind: entry.kind
    }))
  };
}

export function showInteractiveImpactGraph(graph: JetForgeImpactGraph): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    "jetforgeImpactGraph",
    `JetForge Impact · ${basename(graph.title)}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel.webview.html = impactGraphHtml(panel.webview, graph);
  panel.webview.onDidReceiveMessage(async (message: unknown) => {
    if (!isOpenFileMessage(message)) {
      return;
    }
    const node = graph.nodes.find((candidate) => candidate.id === message.nodeId);
    if (!node) {
      return;
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(node.fileName));
    await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.One });
  });
  return panel;
}

function impactGraphHtml(webview: vscode.Webview, graph: JetForgeImpactGraph): string {
  const nonce = randomNonce();
  const data = JSON.stringify(graph).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
      --jf-bg: var(--vscode-editor-background);
      --jf-fg: var(--vscode-editor-foreground);
      --jf-muted: var(--vscode-descriptionForeground);
      --jf-rule: var(--vscode-panel-border);
      --jf-surface: var(--vscode-sideBar-background);
      --jf-input: var(--vscode-input-background);
      --jf-accent: var(--vscode-charts-orange, #c76d2c);
      --jf-focus: var(--vscode-focusBorder, #c76d2c);
      --jf-danger: var(--vscode-errorForeground);
      --jf-space-xs: .25rem;
      --jf-space-sm: .5rem;
      --jf-space-md: 1rem;
      --jf-space-lg: 1.5rem;
      --jf-space-xl: 2rem;
      --jf-ease: cubic-bezier(.25, 1, .5, 1);
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--jf-bg); color: var(--jf-fg); font: 400 1rem/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; overflow: hidden; }
    button, input { font: inherit; }
    .skip { position: fixed; left: var(--jf-space-md); top: -4rem; z-index: 20; background: var(--jf-accent); color: var(--jf-bg); padding: var(--jf-space-sm) var(--jf-space-md); }
    .skip:focus { top: var(--jf-space-md); }
    .shell { display: grid; grid-template-rows: auto 1fr; height: 100vh; min-height: 24rem; }
    header { display: grid; grid-template-columns: minmax(14rem, 1fr) auto; align-items: end; gap: var(--jf-space-lg); padding: var(--jf-space-lg) clamp(1rem, 3vw, 2rem) var(--jf-space-md); border-bottom: 1px solid var(--jf-rule); }
    .eyebrow { color: var(--jf-accent); font-size: .75rem; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: var(--jf-space-xs) 0 0; font-size: clamp(1.5rem, 1rem + 1.7vw, 2.5rem); line-height: 1.08; letter-spacing: -.03em; }
    .summary { margin: var(--jf-space-sm) 0 0; color: var(--jf-muted); font-variant-numeric: tabular-nums; }
    .toolbar { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: var(--jf-space-sm); }
    label.search { display: grid; gap: var(--jf-space-xs); color: var(--jf-muted); font-size: .75rem; }
    input[type="search"] { width: min(19rem, 42vw); min-height: 2.75rem; border: 1px solid var(--vscode-input-border, var(--jf-rule)); background: var(--jf-input); color: var(--jf-fg); padding: .6rem .75rem; }
    button { min-height: 2.75rem; border: 1px solid var(--jf-rule); background: var(--jf-surface); color: var(--jf-fg); padding: .55rem .8rem; cursor: pointer; transition: transform 120ms var(--jf-ease), background 120ms var(--jf-ease); }
    button:hover { background: var(--vscode-toolbar-hoverBackground); }
    button:active { transform: translateY(1px); }
    button:focus-visible, input:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--jf-focus); outline-offset: 2px; }
    main { display: grid; grid-template-columns: minmax(0, 1fr) clamp(15rem, 25vw, 23rem); min-height: 0; }
    .stage { position: relative; overflow: hidden; background-image: linear-gradient(var(--jf-rule) 1px, transparent 1px), linear-gradient(90deg, var(--jf-rule) 1px, transparent 1px); background-size: 32px 32px; }
    #graph { width: 100%; height: 100%; min-height: 22rem; touch-action: none; }
    .edge { fill: none; stroke: var(--jf-muted); stroke-width: 1.5; opacity: .55; vector-effect: non-scaling-stroke; }
    .edge.generated { stroke-dasharray: 5 5; }
    .edge.java-class { stroke: var(--jf-accent); }
    .node { cursor: pointer; transition: opacity 180ms var(--jf-ease); }
    .node rect { fill: var(--jf-surface); stroke: var(--jf-rule); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
    .node.source rect { stroke: var(--jf-accent); stroke-width: 3; }
    .node.generated rect { stroke-dasharray: 4 4; }
    .node text { fill: var(--jf-fg); font-size: 13px; pointer-events: none; }
    .node .kind { fill: var(--jf-muted); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
    .node.selected rect { fill: var(--vscode-list-activeSelectionBackground); stroke: var(--jf-focus); }
    .dim { opacity: .12 !important; }
    .stage-controls { position: absolute; left: var(--jf-space-md); bottom: var(--jf-space-md); display: flex; gap: var(--jf-space-xs); }
    .stage-controls button { width: 2.75rem; padding: 0; font-weight: 700; }
    aside { border-left: 1px solid var(--jf-rule); background: var(--jf-surface); padding: var(--jf-space-lg); overflow: auto; }
    aside section + section { border-top: 1px solid var(--jf-rule); margin-top: var(--jf-space-xl); padding-top: var(--jf-space-lg); }
    aside h2 { margin: 0 0 var(--jf-space-md); font-size: 1rem; letter-spacing: -.01em; }
    .filters { display: grid; gap: .7rem; }
    .filters label { display: grid; grid-template-columns: 1.25rem 1fr auto; align-items: center; gap: var(--jf-space-sm); min-height: 2.25rem; }
    .filters output { color: var(--jf-muted); font-variant-numeric: tabular-nums; }
    .inspector-empty { color: var(--jf-muted); max-width: 26ch; }
    .inspector-kind { color: var(--jf-accent); font-size: .75rem; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; }
    .inspector-name { margin: var(--jf-space-xs) 0; font-size: 1.25rem; overflow-wrap: anywhere; }
    .inspector-path { margin: 0 0 var(--jf-space-md); color: var(--jf-muted); overflow-wrap: anywhere; }
    .open-file { width: 100%; background: var(--jf-accent); border-color: var(--jf-accent); color: var(--jf-bg); font-weight: 700; }
    .unresolved { color: var(--jf-danger); padding-left: 1.1rem; }
    .unresolved li + li { margin-top: var(--jf-space-sm); }
    @media (max-width: 760px) {
      header { grid-template-columns: 1fr; align-items: start; }
      .toolbar { justify-content: flex-start; }
      input[type="search"] { width: min(100%, 26rem); }
      main { grid-template-columns: 1fr; grid-template-rows: minmax(18rem, 60vh) auto; overflow: auto; }
      aside { border-left: 0; border-top: 1px solid var(--jf-rule); overflow: visible; }
    }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: .01ms !important; scroll-behavior: auto !important; } }
  </style>
</head>
<body>
  <a class="skip" href="#inspector">Skip to graph details</a>
  <div class="shell">
    <header>
      <div>
        <div class="eyebrow">Blast radius / live workspace model</div>
        <h1>${escapeHtml(graph.title)}</h1>
        <p class="summary"><span id="visible-count">${graph.nodes.length}</span> files · ${graph.edges.length} dependency edges · ${graph.unresolved.length} unresolved</p>
      </div>
      <div class="toolbar">
        <label class="search">Find a file<input id="search" type="search" placeholder="Type a class, include, or path" autocomplete="off"></label>
        <button id="focus-source" type="button">Focus source</button>
        <button id="reset" type="button">Show all</button>
      </div>
    </header>
    <main>
      <section class="stage" aria-label="Interactive dependency graph">
        <svg id="graph" role="img" aria-labelledby="graph-title graph-desc" viewBox="0 0 1000 700">
          <title id="graph-title">JetForge dependency impact graph</title>
          <desc id="graph-desc">Select a file to isolate its immediate dependencies. Press Enter on a file to open it.</desc>
          <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--jf-muted)"/></marker></defs>
          <g id="viewport"><g id="edges"></g><g id="nodes"></g></g>
        </svg>
        <div class="stage-controls" aria-label="Graph zoom controls"><button id="zoom-out" type="button" aria-label="Zoom out">−</button><button id="zoom-in" type="button" aria-label="Zoom in">+</button></div>
      </section>
      <aside id="inspector" tabindex="-1">
        <section><h2>Edge layers</h2><div id="filters" class="filters"></div></section>
        <section><h2>Selection</h2><div id="selection"><p class="inspector-empty">Choose a file to isolate its incoming and outgoing edges.</p></div></section>
        <section id="unresolved-section"><h2>Unresolved references</h2><div id="unresolved"></div></section>
      </aside>
    </main>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const data = ${data};
    const svg = document.getElementById('graph');
    const viewport = document.getElementById('viewport');
    const edgeLayer = document.getElementById('edges');
    const nodeLayer = document.getElementById('nodes');
    const selection = document.getElementById('selection');
    const search = document.getElementById('search');
    const kinds = ['include', 'skeleton', 'java-class', 'generated'];
    const enabledKinds = new Set(kinds);
    const positions = new Map();
    let selectedId;
    let scale = 1;
    let translateX = 0;
    let translateY = 0;
    let dragging = false;
    let lastPoint;

    const columns = { source: 110, include: 320, skeleton: 320, 'java-class': 550, template: 720, generated: 920 };
    const buckets = new Map();
    for (const node of data.nodes) {
      const key = node.kind;
      const bucket = buckets.get(key) || [];
      bucket.push(node);
      buckets.set(key, bucket);
    }
    for (const [kind, bucket] of buckets) {
      bucket.sort((a, b) => a.label.localeCompare(b.label));
      bucket.forEach((node, index) => {
        const step = Math.min(112, 580 / Math.max(1, bucket.length));
        positions.set(node.id, { x: columns[kind] || 520, y: 70 + index * step + (kind === 'source' ? 245 : 0) });
      });
    }

    for (const edge of data.edges) {
      const from = positions.get(edge.source);
      const to = positions.get(edge.target);
      if (!from || !to) continue;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const bend = Math.max(50, Math.abs(to.x - from.x) * .48);
      path.setAttribute('d', 'M ' + (from.x + 76) + ' ' + from.y + ' C ' + (from.x + bend) + ' ' + from.y + ', ' + (to.x - bend) + ' ' + to.y + ', ' + (to.x - 76) + ' ' + to.y);
      path.setAttribute('class', 'edge ' + edge.kind);
      path.setAttribute('marker-end', 'url(#arrow)');
      path.dataset.source = edge.source;
      path.dataset.target = edge.target;
      path.dataset.kind = edge.kind;
      edgeLayer.append(path);
    }

    for (const node of data.nodes) {
      const position = positions.get(node.id);
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', 'node ' + node.kind);
      group.setAttribute('transform', 'translate(' + (position.x - 76) + ' ' + (position.y - 27) + ')');
      group.setAttribute('tabindex', '0');
      group.setAttribute('role', 'button');
      group.setAttribute('aria-label', node.label + ', ' + node.kind + '. Press Enter to open.');
      group.dataset.id = node.id;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('width', '152'); rect.setAttribute('height', '54'); rect.setAttribute('rx', '3');
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', '10'); label.setAttribute('y', '23'); label.textContent = truncate(node.label, 20);
      const kind = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      kind.setAttribute('class', 'kind'); kind.setAttribute('x', '10'); kind.setAttribute('y', '42'); kind.textContent = node.kind.replace('-', ' ');
      group.append(rect, label, kind);
      group.addEventListener('click', () => selectNode(node.id));
      group.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') openNode(node.id);
        if (event.key === ' ') { event.preventDefault(); selectNode(node.id); }
      });
      nodeLayer.append(group);
    }

    const filters = document.getElementById('filters');
    for (const kind of kinds) {
      const count = data.edges.filter(edge => edge.kind === kind).length;
      const label = document.createElement('label');
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = true; input.value = kind;
      const name = document.createElement('span'); name.textContent = kind.replace('-', ' ');
      const output = document.createElement('output'); output.textContent = count;
      input.addEventListener('change', () => { input.checked ? enabledKinds.add(kind) : enabledKinds.delete(kind); applyVisibility(); });
      label.append(input, name, output); filters.append(label);
    }

    const unresolved = document.getElementById('unresolved');
    if (data.unresolved.length === 0) {
      unresolved.innerHTML = '<p class="inspector-empty">No broken edges in this impact slice.</p>';
    } else {
      const list = document.createElement('ul'); list.className = 'unresolved';
      for (const item of data.unresolved) { const li = document.createElement('li'); li.textContent = item.source + ' → ' + item.reference; list.append(li); }
      unresolved.append(list);
    }

    function selectNode(id) {
      selectedId = id;
      const node = data.nodes.find(candidate => candidate.id === id);
      if (!node) return;
      for (const element of nodeLayer.querySelectorAll('.node')) element.classList.toggle('selected', element.dataset.id === id);
      selection.replaceChildren();
      const kind = document.createElement('div'); kind.className = 'inspector-kind'; kind.textContent = node.kind.replace('-', ' ');
      const name = document.createElement('h3'); name.className = 'inspector-name'; name.textContent = node.label;
      const path = document.createElement('p'); path.className = 'inspector-path'; path.textContent = node.detail;
      const degree = document.createElement('p');
      const connected = data.edges.filter(edge => enabledKinds.has(edge.kind) && (edge.source === id || edge.target === id));
      degree.textContent = connected.length + ' visible direct connection' + (connected.length === 1 ? '' : 's') + '.';
      const open = document.createElement('button'); open.className = 'open-file'; open.type = 'button'; open.textContent = node.kind === 'generated' ? 'Open source template' : 'Open file'; open.addEventListener('click', () => openNode(id));
      selection.append(kind, name, path, degree, open);
      applyVisibility();
    }

    function applyVisibility() {
      const query = search.value.trim().toLowerCase();
      const visibleEdges = data.edges.filter(edge => enabledKinds.has(edge.kind));
      const neighbors = new Set(selectedId ? [selectedId] : []);
      if (selectedId) for (const edge of visibleEdges) if (edge.source === selectedId || edge.target === selectedId) { neighbors.add(edge.source); neighbors.add(edge.target); }
      let visible = 0;
      for (const element of edgeLayer.querySelectorAll('.edge')) {
        const enabled = enabledKinds.has(element.dataset.kind);
        const related = !selectedId || element.dataset.source === selectedId || element.dataset.target === selectedId;
        element.classList.toggle('dim', !enabled || !related);
      }
      for (const element of nodeLayer.querySelectorAll('.node')) {
        const node = data.nodes.find(candidate => candidate.id === element.dataset.id);
        const matches = !query || node.label.toLowerCase().includes(query) || node.detail.toLowerCase().includes(query);
        const related = !selectedId || neighbors.has(node.id);
        element.classList.toggle('dim', !matches || !related);
        if (matches && related) visible++;
      }
      document.getElementById('visible-count').textContent = visible;
    }

    function openNode(id) { vscode.postMessage({ type: 'openFile', nodeId: id }); }
    function reset() { selectedId = undefined; search.value = ''; for (const input of filters.querySelectorAll('input')) input.checked = true; kinds.forEach(kind => enabledKinds.add(kind)); selection.innerHTML = '<p class="inspector-empty">Choose a file to isolate its incoming and outgoing edges.</p>'; applyVisibility(); }
    function setTransform() { viewport.setAttribute('transform', 'translate(' + translateX + ' ' + translateY + ') scale(' + scale + ')'); }
    function zoom(factor) { scale = Math.min(2.5, Math.max(.45, scale * factor)); setTransform(); }
    function truncate(value, max) { return value.length > max ? value.slice(0, max - 1) + '…' : value; }

    search.addEventListener('input', applyVisibility);
    document.getElementById('focus-source').addEventListener('click', () => selectNode(data.sourceId));
    document.getElementById('reset').addEventListener('click', reset);
    document.getElementById('zoom-in').addEventListener('click', () => zoom(1.2));
    document.getElementById('zoom-out').addEventListener('click', () => zoom(1 / 1.2));
    svg.addEventListener('wheel', event => { event.preventDefault(); zoom(event.deltaY < 0 ? 1.08 : 1 / 1.08); }, { passive: false });
    svg.addEventListener('pointerdown', event => { if (event.target.closest('.node')) return; dragging = true; lastPoint = { x: event.clientX, y: event.clientY }; svg.setPointerCapture(event.pointerId); });
    svg.addEventListener('pointermove', event => { if (!dragging) return; translateX += event.clientX - lastPoint.x; translateY += event.clientY - lastPoint.y; lastPoint = { x: event.clientX, y: event.clientY }; setTransform(); });
    svg.addEventListener('pointerup', () => { dragging = false; });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') reset(); });
    applyVisibility();
  </script>
</body>
</html>`;
}

function isOpenFileMessage(value: unknown): value is { type: "openFile"; nodeId: string } {
  return Boolean(value && typeof value === "object" && (value as { type?: unknown }).type === "openFile" && typeof (value as { nodeId?: unknown }).nodeId === "string");
}

function generatedExtension(language: string): string {
  switch (language) {
    case "txtjet-java": return "java";
    case "txtjet-html": return "html";
    case "txtjet-xml": return "xml";
    case "txtjet-c": return "c";
    case "txtjet-python": return "py";
    case "txtjet-latex": return "tex";
    default: return "txt";
  }
}

function randomNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
