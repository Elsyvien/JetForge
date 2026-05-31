const samples = {
  java: {
    label: "Java preview",
    source: [
      ['<%@ jet package="demo.codegen" class="ModelWriter" %>', "token-muted"],
      ['<% for (Field field : model.fields()) { %>', "token-java"],
      ['private <%= field.type() %> <%= field.name() %>;', "token-out"],
      ['<% } %>', "token-java"],
      ['<%@ include file="partials/accessors.txtjet" %>', "token-muted"]
    ],
    output: [
      ["// package demo.codegen", "token-muted"],
      ["private String title;", "token-out"],
      ["private int revision;", "token-out"],
      ["// include partials/accessors.txtjet", "token-muted"],
      ["public String getTitle() { return title; }", "token-java"]
    ],
    mode: `class ModelWriter {
    void generate() {
        stringBuffer.append("private String title;");
    }
}`
  },
  html: {
    label: "HTML preview",
    source: [
      ['<%@ jet class="CardWriter" %>', "token-muted"],
      ['<article class="model-card">', "token-out"],
      ['<h2><%= model.name() %></h2>', "token-java"],
      ['<%@ include file="partials/actions.txtjet" %>', "token-muted"],
      ['</article>', "token-out"]
    ],
    output: [
      ['<article class="model-card">', "token-out"],
      ['  <h2>Invoice</h2>', "token-out"],
      ['  <button>Edit</button>', "token-out"],
      ['</article>', "token-out"]
    ],
    mode: `<article class="model-card">
    <h2><%= model.name() %></h2>
    <%@ include file="partials/actions.txtjet" %>
</article>`
  },
  xml: {
    label: "XML preview",
    source: [
      ['<entity name="<%= model.name() %>">', "token-out"],
      ['<% for (Field field : model.fields()) { %>', "token-java"],
      ['<field name="<%= field.name() %>" />', "token-out"],
      ['<% } %>', "token-java"],
      ['</entity>', "token-out"]
    ],
    output: [
      ['<entity name="Invoice">', "token-out"],
      ['  <field name="title" />', "token-out"],
      ['  <field name="revision" />', "token-out"],
      ['</entity>', "token-out"]
    ],
    mode: `<entity name="<%= model.name() %>">
    <% for (Field field : model.fields()) { %>
    <field name="<%= field.name() %>" />
    <% } %>
</entity>`
  },
  c: {
    label: "C preview",
    source: [
      ['typedef struct {', "token-out"],
      ['<% for (Field field : fields) { %>', "token-java"],
      ['    <%= cType(field) %> <%= field.name() %>;', "token-out"],
      ['<% } %>', "token-java"],
      ['} GeneratedModel;', "token-out"]
    ],
    output: [
      ['typedef struct {', "token-out"],
      ['    char *title;', "token-out"],
      ['    int revision;', "token-out"],
      ['} GeneratedModel;', "token-out"]
    ],
    mode: `typedef struct {
    char *title;
    int revision;
} GeneratedModel;`
  },
  python: {
    label: "Python preview",
    source: [
      ['class <%= model.name() %>:', "token-out"],
      ['<% for (Field field : model.fields()) { %>', "token-java"],
      ['    <%= field.name() %> = None', "token-out"],
      ['<% } %>', "token-java"],
      ['# generated locally', "token-muted"]
    ],
    output: [
      ['class Invoice:', "token-out"],
      ['    title = None', "token-out"],
      ['    revision = None', "token-out"],
      ['# generated locally', "token-muted"]
    ],
    mode: `class GeneratedModel:
    def __init__(self, title, revision):
        self.title = title
        self.revision = revision`
  }
};

const modeOrder = ["java", "html", "xml", "c", "python"];
let activeIndex = 0;
let activeLine = 0;
let autoCycle = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? null : window.setInterval(nextMode, 4600);

const sourceCode = document.querySelector("#source-code");
const outputCode = document.querySelector("#output-code");
const modeCode = document.querySelector("#mode-code");
const modePanel = document.querySelector("[role='tabpanel']");
const sourceLabel = document.querySelector("#active-source-label");
const statusText = document.querySelector("#status-text");
const tabs = document.querySelectorAll(".mode-tab");
const flowCards = document.querySelectorAll(".flow-card");
const flowSection = document.querySelector(".flow");
const progressBar = document.querySelector("#scroll-progress");
const workbench = document.querySelector(".workbench");
const modeConsole = document.querySelector(".mode-console");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let flowCycle = null;

function replayClass(targets, className) {
  if (reduceMotion) {
    return;
  }

  targets.forEach(target => {
    target?.classList.remove(className);
    void target?.offsetWidth;
    target?.classList.add(className);
  });
}

function renderLines(target, lines) {
  if (!target) {
    return;
  }

  target.innerHTML = lines
    .map((line, index) => `<span class="code-line ${line[1]}" data-line="${index}"></span>`)
    .join("");

  const renderedLines = target.querySelectorAll(".code-line");
  renderedLines.forEach((line, index) => {
    line.textContent = lines[index][0];
  });
}

function setMode(mode, manual = false) {
  const sample = samples[mode];
  if (!sample) {
    return;
  }

  activeIndex = modeOrder.indexOf(mode);
  activeLine = 0;
  sourceLabel.textContent = sample.label;
  modeCode.textContent = sample.mode;
  renderLines(sourceCode, sample.source);
  renderLines(outputCode, sample.output);
  animateModeSwap();

  tabs.forEach(tab => {
    const selected = tab.dataset.mode === mode;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;

    if (selected && tab.id) {
      modePanel?.setAttribute("aria-labelledby", tab.id);
    }
  });

  highlightLine();

  if (manual && autoCycle) {
    window.clearInterval(autoCycle);
    autoCycle = window.setInterval(nextMode, 7000);
  }
}

function animateModeSwap() {
  if (reduceMotion) {
    return;
  }

  replayClass([sourceCode?.closest(".code-pane"), outputCode?.closest(".code-pane")], "is-swapping");

  modeConsole?.classList.remove("is-changing");
  void modeConsole?.offsetWidth;
  modeConsole?.classList.add("is-changing");

  workbench?.classList.remove("is-reacting");
  void workbench?.offsetWidth;
  workbench?.classList.add("is-reacting");
}

function nextMode() {
  activeIndex = (activeIndex + 1) % modeOrder.length;
  setMode(modeOrder[activeIndex]);
}

function highlightLine() {
  const sourceLines = sourceCode?.querySelectorAll(".code-line") || [];
  const outputLines = outputCode?.querySelectorAll(".code-line") || [];
  const allLines = [...sourceLines, ...outputLines];
  allLines.forEach(line => line.classList.remove("is-hot"));

  const sourceHot = sourceLines[activeLine % sourceLines.length];
  const outputHot = outputLines[activeLine % outputLines.length];
  sourceHot?.classList.add("is-hot");
  outputHot?.classList.add("is-hot");
  replayClass([sourceCode?.closest(".code-pane"), outputCode?.closest(".code-pane")], "is-tracing");
  replayClass([workbench], "is-mapping");

  const mode = modeOrder[activeIndex];
  const labels = [
    `Highlighting the source behind this ${samples[mode].label}`,
    "Showing Java hover inside the template",
    "Finding includes and skeleton files",
    "Preparing a preview diff"
  ];
  statusText.textContent = labels[activeLine % labels.length];
  activeLine += 1;
}

tabs.forEach(tab => {
  tab.addEventListener("click", () => setMode(tab.dataset.mode, true));
  tab.addEventListener("keydown", event => {
    const currentIndex = modeOrder.indexOf(tab.dataset.mode);
    const keyDirection = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1
    }[event.key];

    if (!keyDirection) {
      return;
    }

    event.preventDefault();
    const nextIndex = (currentIndex + keyDirection + modeOrder.length) % modeOrder.length;
    const nextTab = document.querySelector(`[data-mode="${modeOrder[nextIndex]}"]`);
    nextTab?.focus();
    setMode(modeOrder[nextIndex], true);
  });
});

setMode("java");

if (!reduceMotion) {
  window.setInterval(highlightLine, 1200);
}

const flowObserver = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        startFlowCycle();
      } else {
        stopFlowCycle();
      }
    });
  },
  { threshold: 0.28 }
);

if (flowSection) {
  flowObserver.observe(flowSection);
}

flowCards.forEach((card, index) => {
  card.addEventListener("pointerenter", () => {
    if (reduceMotion) {
      return;
    }

    flowCards.forEach((item, itemIndex) => item.classList.toggle("is-active", itemIndex === index));
  });
});

const revealObserver = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.16, rootMargin: "0px 0px -8% 0px" }
);

document.querySelectorAll(".ticker, .flow, .capabilities, .modes, .install").forEach(section => {
  section.classList.add("reveal-on-scroll");
  revealObserver.observe(section);
});

function startFlowCycle() {
  if (reduceMotion || flowCycle || !flowCards.length) {
    return;
  }

  flowCycle = window.setInterval(() => {
    const current = [...flowCards].findIndex(card => card.classList.contains("is-active"));
    const next = (current + 1 + flowCards.length) % flowCards.length;
    flowCards.forEach((card, index) => card.classList.toggle("is-active", index === next));
  }, 2600);
}

function stopFlowCycle() {
  if (!flowCycle) {
    return;
  }

  window.clearInterval(flowCycle);
  flowCycle = null;
}

function updateScrollProgress() {
  if (!progressBar) {
    return;
  }

  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const progress = scrollable > 0 ? window.scrollY / scrollable : 0;
  progressBar.style.transform = `scaleX(${Math.min(1, Math.max(0, progress))})`;
}

function addRipple(event) {
  if (reduceMotion) {
    return;
  }

  const target = event.currentTarget;
  const rect = target.getBoundingClientRect();
  const ripple = document.createElement("span");
  ripple.className = "interaction-ripple";
  ripple.style.left = `${event.clientX - rect.left}px`;
  ripple.style.top = `${event.clientY - rect.top}px`;
  target.append(ripple);
  ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
}

document.querySelectorAll(".button, .mode-tab, .nav-action").forEach(control => {
  control.addEventListener("pointerdown", addRipple);
});

window.addEventListener("scroll", updateScrollProgress, { passive: true });
updateScrollProgress();

const canvas = document.querySelector("#forge-field");
const ctx = canvas.getContext("2d");
const nodes = [];
let width = 0;
let height = 0;
let pointerX = 0.5;
let pointerY = 0.5;

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  nodes.length = 0;
  const count = Math.min(72, Math.max(34, Math.floor(width / 22)));
  for (let index = 0; index < count; index += 1) {
    nodes.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.45,
      vy: (Math.random() - 0.5) * 0.45,
      r: 1.2 + Math.random() * 2.4
    });
  }
}

function drawField() {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(5, 7, 11, 0.18)";
  ctx.fillRect(0, 0, width, height);

  nodes.forEach(node => {
    node.x += node.vx + (pointerX - 0.5) * 0.12;
    node.y += node.vy + (pointerY - 0.5) * 0.12;

    if (node.x < -20) node.x = width + 20;
    if (node.x > width + 20) node.x = -20;
    if (node.y < -20) node.y = height + 20;
    if (node.y > height + 20) node.y = -20;
  });

  for (let a = 0; a < nodes.length; a += 1) {
    for (let b = a + 1; b < nodes.length; b += 1) {
      const first = nodes[a];
      const second = nodes[b];
      const dx = first.x - second.x;
      const dy = first.y - second.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 150) {
        ctx.strokeStyle = `rgba(85, 230, 165, ${0.13 * (1 - distance / 150)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(first.x, first.y);
        ctx.lineTo(second.x, second.y);
        ctx.stroke();
      }
    }
  }

  nodes.forEach((node, index) => {
    ctx.fillStyle = index % 5 === 0 ? "rgba(255, 122, 47, 0.8)" : "rgba(104, 167, 255, 0.62)";
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
    ctx.fill();
  });

  requestAnimationFrame(drawField);
}

window.addEventListener("resize", resizeCanvas);
window.addEventListener("pointermove", event => {
  pointerX = event.clientX / Math.max(1, width);
  pointerY = event.clientY / Math.max(1, height);
});

resizeCanvas();

if (!reduceMotion) {
  drawField();
}
