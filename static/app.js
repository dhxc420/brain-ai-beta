import { Brain3D } from "./brain3d.js?v=32";

let workflows = [];
let selectedId = null;
let sessionHistory = [];
let streamingAssistant = "";
let defaultModel = "qwen2.5-coder:7b";
let brain3d = null;
let activeNeuronContext = null;
let cachedMemories = [];
let memorySearchTimer = null;

const modelSelect = document.getElementById("modelSelect");
const runBtn = document.getElementById("runBtn");
const refreshBtn = document.getElementById("refreshBtn");
const chatBtn = document.getElementById("chatBtn");
const clearChatBtn = document.getElementById("clearChatBtn");
const chatInput = document.getElementById("chatInput");
const output = document.getElementById("output");
const sources = document.getElementById("sources");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const workflowStrip = document.getElementById("workflowStrip");
const fwRole = document.getElementById("fwRole");
const fwTools = document.getElementById("fwTools");
const fwTrigger = document.getElementById("fwTrigger");
const fwOutput = document.getElementById("fwOutput");
const wfTitle = document.getElementById("wfTitle");
const wfDesc = document.getElementById("wfDesc");
const safeBanner = document.getElementById("safeBanner");
const brain3dContainer = document.getElementById("brain3dContainer");
const brainStage = document.getElementById("brainStage");
const brainZoomIn = document.getElementById("brainZoomIn");
const brainZoomOut = document.getElementById("brainZoomOut");
const brainZoomReset = document.getElementById("brainZoomReset");
const brainZoomLevel = document.getElementById("brainZoomLevel");
const brainZoomThumb = document.getElementById("brainZoomThumb");
const brainClusterStrip = document.getElementById("brainClusterStrip");
const neuronTooltip = document.getElementById("neuronTooltip");
const neuronModal = document.getElementById("neuronModal");
const neuronModalBackdrop = document.getElementById("neuronModalBackdrop");
const neuronPanel = document.getElementById("neuronPanel");
const neuronPanelTitle = document.getElementById("neuronPanelTitle");
const neuronPanelType = document.getElementById("neuronPanelType");
const neuronPanelContent = document.getElementById("neuronPanelContent");
const neuronPanelClose = document.getElementById("neuronPanelClose");
const neuronPanelPin = document.getElementById("neuronPanelPin");
const neuronPanelDelete = document.getElementById("neuronPanelDelete");
const memoryList = document.getElementById("memoryList");
const memorySearchInput = document.getElementById("memorySearchInput");
const memorySearchClear = document.getElementById("memorySearchClear");
const searchResults = document.getElementById("searchResults");
const memoryCount = document.getElementById("memoryCount");
const memoryInput = document.getElementById("memoryInput");
const memoryTypeSelect = document.getElementById("memoryTypeSelect");
const addMemoryBtn = document.getElementById("addMemoryBtn");
const refreshMemoriesBtn = document.getElementById("refreshMemoriesBtn");
const consolidateBtn = document.getElementById("consolidateBtn");
const forgetStaleBtn = document.getElementById("forgetStaleBtn");
const vaultNoteCount = document.getElementById("vaultNoteCount");
const vaultStatus = document.getElementById("vaultStatus");
const vaultOnboardBtn = document.getElementById("vaultOnboardBtn");
const vaultMaintainBtn = document.getElementById("vaultMaintainBtn");
const refreshVaultBtn = document.getElementById("refreshVaultBtn");
const vaultNoteList = document.getElementById("vaultNoteList");
const onboardingBox = document.getElementById("onboardingBox");
const onboardingQuestion = document.getElementById("onboardingQuestion");
const onboardingAnswer = document.getElementById("onboardingAnswer");
const onboardingSubmitBtn = document.getElementById("onboardingSubmitBtn");
const projectNameInput = document.getElementById("projectNameInput");
const createProjectBtn = document.getElementById("createProjectBtn");
const repoList = document.getElementById("repoList");
const reposPanel = document.getElementById("reposPanel");
const repoCount = document.getElementById("repoCount");
const syncReposBtn = document.getElementById("syncReposBtn");
const refreshReposBtn = document.getElementById("refreshReposBtn");
const llmLoading = document.getElementById("llmLoading");
const llmLoadingLabel = document.getElementById("llmLoadingLabel");
const llmLoadingHint = document.getElementById("llmLoadingHint");

let llmBusy = false;
let llmLoadingTimer = null;
const LLM_LOADING_HINTS = [
  "Cerebro 3D en pausa · GPU libre para el modelo",
  "Ollama generando tokens…",
  "No cierres la pestaña · puede tardar 1–2 min",
];

function setStatus(ok, text) {
  statusDot.className = "dot " + (ok ? "ok" : "bad");
  statusText.textContent = text;
}

function currentWorkflow() {
  return workflows.find((w) => w.id === selectedId);
}

const REPO_QUERY_HINT =
  "Pregunta sobre Vuela RCOL, World Runner, una nota del vault o pega una ruta local permitida.";

function updateFramework() {
  const wf = currentWorkflow();
  if (!wf) return;
  wfTitle.textContent = wf.name;
  wfDesc.textContent =
    wf.id === "repo_query" ? `${wf.description} ${REPO_QUERY_HINT}` : wf.description;
  fwRole.textContent = wf.role;
  fwTools.textContent = wf.tools.join(", ");
  fwTrigger.textContent = wf.trigger;
  fwOutput.textContent = wf.output;
}

function renderStrip() {
  workflowStrip.innerHTML = "";
  workflows.forEach((wf) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "wf-chip hud-interactive" + (wf.id === selectedId ? " active" : "");
    chip.textContent = wf.node_label || wf.name;
    chip.dataset.id = wf.id;
    chip.addEventListener("pointerdown", (e) => e.stopPropagation());
    chip.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectWorkflow(wf.id);
    });
    workflowStrip.appendChild(chip);
  });
}

function selectWorkflow(id) {
  if (selectedId !== id) clearSessionHistory();
  selectedId = id;
  if (brain3d) brain3d.setSelected(`workflow_${id}`);
  renderStrip();
  updateFramework();
  hideNeuronPanel();
  const wf = currentWorkflow();
  if (wf) {
    output.className = "output-box";
    output.textContent = workflowChatHint(wf);
  }
}

function setRunning(id) {
  document.querySelectorAll(".wf-chip").forEach((el) => {
    el.classList.toggle("running", el.dataset.id === id);
  });
  if (brain3d) brain3d.setActive(`workflow_${id}`);
}

function clearRunning() {
  document.querySelectorAll(".wf-chip").forEach((el) => el.classList.remove("running"));
  if (brain3d) brain3d.setActive(null);
}

function normalizeModalWheel(e) {
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 16;
  else if (e.deltaMode === 2) dy *= 400;
  return Math.max(-240, Math.min(240, dy));
}

function bindInvertedModalScroll(el) {
  if (!el || el.dataset.invertScroll === "1") return;
  el.dataset.invertScroll = "1";
  el.addEventListener(
    "wheel",
    (e) => {
      e.stopPropagation();
      if (el.scrollHeight <= el.clientHeight + 1) return;
      e.preventDefault();
      el.scrollTop -= normalizeModalWheel(e);
    },
    { passive: false }
  );
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function memoryNeuronId(memoryId) {
  return `memory_${memoryId}`;
}

function memoryNeuronType(memType) {
  if (memType === "fact") return "memory";
  if (memType === "source") return "source";
  return "conversation";
}

function parseConversationText(text) {
  const raw = (text || "").trim();
  if (!raw) return { isChat: false, raw: "" };

  const mdUser = raw.match(/##\s*Usuario\s*\n([\s\S]*?)(?=\n##\s*(?:Asistente|Brain AI)|$)/i);
  const mdAssistant = raw.match(/##\s*(?:Asistente|Brain AI)\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (mdUser || mdAssistant) {
    return {
      isChat: true,
      user: (mdUser?.[1] || "").trim(),
      assistant: (mdAssistant?.[1] || "").trim(),
      raw,
    };
  }

  const legacyUser = raw.match(/(?:^|\n)Usuario:\s*([\s\S]*?)(?=\nAsistente:|$)/i);
  const legacyAssistant = raw.match(/(?:^|\n)Asistente:\s*([\s\S]*?)$/i);
  if (legacyUser || legacyAssistant) {
    return {
      isChat: true,
      user: (legacyUser?.[1] || "").trim(),
      assistant: (legacyAssistant?.[1] || "").trim(),
      raw,
    };
  }

  return { isChat: false, raw };
}

function renderSessionTranscript(partialAssistant = "") {
  const blocks = sessionHistory.map((turn) => {
    const cls = turn.role === "user" ? "chat-msg-user" : "chat-msg-assistant";
    const label = turn.role === "user" ? "Usuario" : "Asistente";
    return `
      <div class="chat-msg ${cls}">
        <span class="chat-msg-label">${label}</span>
        <div class="chat-msg-body">${escapeHtml(turn.content)}</div>
      </div>
    `;
  });
  if (partialAssistant) {
    blocks.push(`
      <div class="chat-msg chat-msg-assistant chat-msg-streaming">
        <span class="chat-msg-label">Asistente</span>
        <div class="chat-msg-body">${escapeHtml(partialAssistant)}</div>
      </div>
    `);
  }
  if (!blocks.length) {
    output.className = "output-box";
    output.textContent = "Escribe en el chat — el historial de la sesión aparece aquí.";
    return;
  }
  output.className = "output-box chat-session-view";
  output.innerHTML = `<div class="chat-transcript">${blocks.join("")}</div>`;
  output.scrollTop = output.scrollHeight;
}

function clearSessionHistory() {
  sessionHistory = [];
  streamingAssistant = "";
  renderSessionTranscript();
}

function workflowChatHint(wf) {
  if (!wf) return "Escribe en el chat.";
  if (wf.id === "repo_query") {
    return "Repo / Archivo: repos, vault o rutas locales (ej. F:\\#isos).";
  }
  if (wf.id === "web_ask") {
    return "Web / General: búsquedas, curiosidades, matemáticas básicas.";
  }
  return `${wf.node_label || wf.name}: chat con el rol de este workflow (+ web si aplica).`;
}

function renderWebSources(webResults) {
  if (!webResults?.length) {
    sources.textContent = "";
    return;
  }
  sources.innerHTML = "<strong>Fuentes:</strong><br>" + webResults
    .map((r) => `• <a href="${r.url}" target="_blank" rel="noopener">${escapeHtml(r.title || r.url)}</a>`)
    .join("<br>");
}

async function consumeChatStream(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";
    for (const chunk of chunks) {
      const line = chunk.trim();
      if (!line.startsWith("data: ")) continue;
      try {
        onEvent(JSON.parse(line.slice(6)));
      } catch {
        /* ignore malformed SSE */
      }
    }
  }
}

function renderChatTranscript(chat) {
  const blocks = [];
  if (chat.user) {
    blocks.push(`
      <div class="chat-msg chat-msg-user">
        <span class="chat-msg-label">Usuario</span>
        <div class="chat-msg-body">${escapeHtml(chat.user)}</div>
      </div>
    `);
  }
  if (chat.assistant) {
    blocks.push(`
      <div class="chat-msg chat-msg-assistant">
        <span class="chat-msg-label">Asistente</span>
        <div class="chat-msg-body">${escapeHtml(chat.assistant)}</div>
      </div>
    `);
  }
  if (!blocks.length) {
    return `<div class="chat-msg chat-msg-empty">Sin mensajes parseables en esta conversación.</div>`;
  }
  return `<div class="chat-transcript">${blocks.join("")}</div>`;
}

function bindNeuronContentTabs(container, initialTab = "conversation") {
  const tabs = container.querySelectorAll(".neuron-tab");
  const panels = container.querySelectorAll(".neuron-tab-panel");
  if (!tabs.length) return;

  const activate = (tabName) => {
    tabs.forEach((btn) => {
      const active = btn.dataset.tab === tabName;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    panels.forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.panel !== tabName);
    });
  };

  tabs.forEach((btn) => {
    btn.onclick = () => activate(btn.dataset.tab);
  });

  const hasConversation = [...panels].some((p) => p.dataset.panel === "conversation");
  activate(initialTab === "content" || !hasConversation ? "content" : "conversation");
}

function showNeuronPanel(neuron, extra = {}, viewOpts = {}) {
  const initialTab = viewOpts.initialTab || "auto";
  neuronModal.classList.remove("hidden");
  neuronModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  neuronPanelTitle.textContent = neuron.label || "Neurona";
  const typeLabels = {
    workflow: "Workflow",
    memory: "Memoria",
    conversation: "Conversación",
    source: "Fuente",
    tool: "Herramienta",
    note: "Nota vault",
    repository: "Repositorio",
  };
  neuronPanelType.textContent = typeLabels[neuron.type] || neuron.type;

  if (neuronPanelPin) {
    const canPin = neuron.id?.startsWith("memory_") || neuron.id?.startsWith("vault_");
    neuronPanelPin.classList.toggle("hidden", !canPin);
    neuronPanelPin.dataset.neuronId = canPin ? neuron.id : "";
  }

  if (neuronPanelDelete) {
    const deletable = neuron.id?.startsWith("memory_") || neuron.id?.startsWith("vault_");
    neuronPanelDelete.classList.toggle("hidden", !deletable);
  }

  const rows = [
    ["ID", neuron.id || "—"],
    ["Tipo", typeLabels[neuron.type] || neuron.type],
    ["Importancia", neuron.importance != null ? `${Math.round(neuron.importance * 100)}%` : "—"],
    ["Conexiones", (neuron.connections || []).length ? (neuron.connections || []).join(", ") : "Ninguna"],
    ["Creado", neuron.created_at ? new Date(neuron.created_at).toLocaleString("es") : "—"],
  ];

  if (extra.memory_type) rows.splice(2, 0, ["Tipo memoria", extra.memory_type]);
  if (extra.recall_count != null) rows.push(["Veces recordada", String(extra.recall_count)]);
  if (extra.distance != null) rows.push(["Relevancia RAG", extra.distance.toFixed(4)]);

  const content = neuron.full_content || neuron.content_preview || "—";
  const contentLen = content === "—" ? 0 : content.length;
  const chat = parseConversationText(content === "—" ? "" : content);
  const showChatTab = chat.isChat || neuron.type === "conversation" || extra.memory_type === "conversation" || extra.memory_type === "workflow_run";

  let contentSection;
  if (showChatTab) {
    const tabDefault = initialTab === "auto"
      ? (neuron.type === "conversation" ? "conversation" : "conversation")
      : initialTab;
    contentSection = `
      <div class="neuron-content-block neuron-content-block-tabs">
        <div class="neuron-content-header">
          <div class="neuron-content-tabs" role="tablist">
            <button type="button" class="neuron-tab" data-tab="conversation" role="tab">Conversación</button>
            <button type="button" class="neuron-tab" data-tab="content" role="tab">Contenido</button>
          </div>
          ${contentLen ? `<span class="neuron-content-meta">${contentLen.toLocaleString("es")} caracteres</span>` : ""}
        </div>
        <div class="neuron-tab-panel" data-panel="conversation" role="tabpanel">
          <div class="neuron-content-scroll chat-scroll" tabindex="0">${renderChatTranscript(chat)}</div>
        </div>
        <div class="neuron-tab-panel hidden" data-panel="content" role="tabpanel">
          <div class="neuron-content-scroll" tabindex="0">${escapeHtml(String(content))}</div>
        </div>
      </div>
    `;
    viewOpts._tabDefault = tabDefault;
  } else {
    contentSection = `
      <div class="neuron-content-block">
        <div class="neuron-content-header">
          <strong>Contenido</strong>
          ${contentLen ? `<span class="neuron-content-meta">${contentLen.toLocaleString("es")} caracteres</span>` : ""}
        </div>
        <div class="neuron-content-scroll" tabindex="0">${escapeHtml(String(content))}</div>
      </div>
    `;
  }

  neuronPanelContent.innerHTML = `
    <table class="neuron-info-table">
      ${rows
        .map(
          ([k, v]) => `
        <tr>
          <th>${escapeHtml(k)}</th>
          <td>${escapeHtml(String(v))}</td>
        </tr>
      `
        )
        .join("")}
    </table>
    ${contentSection}
  `;

  neuronPanelContent.querySelectorAll(".neuron-content-scroll").forEach((el) => bindInvertedModalScroll(el));
  bindInvertedModalScroll(neuronPanel);
  if (showChatTab) bindNeuronContentTabs(neuronPanelContent, viewOpts._tabDefault || initialTab);
}

function hideNeuronPanel() {
  neuronModal.classList.add("hidden");
  neuronModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  neuronTooltip.classList.add("hidden");
  activeNeuronContext = null;
  if (brain3d) brain3d.clearSelection();
}

async function openNeuronDetail(neuron, viewOpts = {}) {
  showNeuronPanel({ ...neuron, full_content: "Cargando contenido completo…" }, {}, viewOpts);

  let extra = {};

  if (neuron.id?.startsWith("memory_")) {
    const memoryId = neuron.id.replace("memory_", "");
    try {
      const mRes = await fetch(`/api/memories/${encodeURIComponent(memoryId)}`);
      if (mRes.ok) {
        const mem = await mRes.json();
        neuron = { ...neuron, full_content: mem.text || neuron.full_content, type: neuron.type || mem.type };
        extra = {
          memory_type: mem.type,
          recall_count: mem.metadata?.recall_count,
        };
      }
    } catch (_) {
      /* fallback abajo */
    }
  }

  try {
    const res = await fetch(`/api/neurons/${encodeURIComponent(neuron.id)}`);
    if (res.ok) {
      const fromApi = await res.json();
      neuron = { ...fromApi, ...neuron, full_content: neuron.full_content || fromApi.full_content };
    }
  } catch (_) {
    /* keep preview */
  }

  if (neuron.id?.startsWith("repo_")) {
    const repoId = neuron.id.replace("repo_", "");
    try {
      const rRes = await fetch(`/api/repos/${encodeURIComponent(repoId)}`);
      if (rRes.ok) {
        const repo = await rRes.json();
        neuron.full_content = repo.full_content || neuron.full_content;
        neuron.label = repo.label || neuron.label;
        extra.memory_type = `${repo.memory_count || 0} chats importados`;
      }
    } catch (_) {
      /* neuron data enough */
    }
  }

  if (neuron.id?.startsWith("vault_") || neuron.type === "note") {
    const notePath = neuron.ref_path;
    if (notePath) {
      try {
        const vRes = await fetch(`/api/vault/notes/${encodeURIComponent(notePath)}`);
        if (vRes.ok) {
          const note = await vRes.json();
          neuron.full_content = note.content || neuron.full_content;
          if (note.links?.length) extra.memory_type = `Enlaces: ${note.links.join(", ")}`;
          if (note.backlinks?.length) extra.recall_count = note.backlinks.length;
        }
      } catch (_) {
        /* neuron data enough */
      }
    }
  }

  showNeuronPanel(neuron, extra, viewOpts);

  const memoryId = neuron.id?.startsWith("memory_") ? neuron.id.replace(/^memory_/, "") : null;
  let vaultPath = neuron.ref_path || null;
  if (!vaultPath && neuron.id?.startsWith("vault_")) {
    try {
      const vRes = await fetch(`/api/neurons/${encodeURIComponent(neuron.id)}`);
      if (vRes.ok) {
        const fromApi = await vRes.json();
        vaultPath = fromApi.ref_path || vaultPath;
      }
    } catch (_) {
      /* optional */
    }
  }

  activeNeuronContext = {
    neuronId: neuron.id,
    memoryId,
    vaultPath,
    label: neuron.label || neuron.id,
    deletable: Boolean(memoryId || vaultPath),
  };

  if (neuron.type === "workflow" && neuron.id.startsWith("workflow_")) {
    selectWorkflow(neuron.id.replace("workflow_", ""));
  }
  if (brain3d) brain3d.setSelected(neuron.id);
}

function showTooltip(neuron, x, y) {
  if (!neuron) {
    neuronTooltip.classList.add("hidden");
    return;
  }
  const typeLabel = {
    workflow: "Workflow",
    memory: "Memoria",
    conversation: "Chat",
    source: "Fuente",
    tool: "Tool",
    note: "Nota",
  }[neuron.type] || neuron.type;
  neuronTooltip.innerHTML = `<strong>${typeLabel}</strong><br>${neuron.label}<br><span style="opacity:0.7">${neuron.content_preview || ""}</span>`;
  neuronTooltip.style.left = `${x + 14}px`;
  neuronTooltip.style.top = `${y + 14}px`;
  neuronTooltip.classList.remove("hidden");
}

async function loadHealth() {
  const res = await fetch("/api/health");
  const data = await res.json();
  defaultModel = data.default_model || defaultModel;
  const allowed = data.allowed_models || [];
  modelSelect.innerHTML = "";

  if (!allowed.length) {
    const opt = document.createElement("option");
    opt.value = defaultModel;
    opt.textContent = `${defaultModel} (ollama pull qwen2.5-coder:7b)`;
    modelSelect.appendChild(opt);
    setStatus(false, "Sin modelos — instala qwen2.5-coder:7b");
    return;
  }

  allowed.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.name;
    const icon = m.tier === "heavy" ? "🔴" : m.tier === "medium" ? "🟢" : "🟡";
    opt.textContent = `${icon} ${m.name}`;
    if (m.name === defaultModel) opt.selected = true;
    modelSelect.appendChild(opt);
  });

  const blocked = (data.ollama?.models || []).length - allowed.length;
  const memCount = data.memory?.count ?? 0;
  const statusMsg = data.ollama?.ok
    ? `Ollama OK · ${memCount} memorias${blocked ? ` · ${blocked} bloq.` : ""}`
    : "Ollama offline";
  setStatus(data.ollama?.ok, statusMsg);

  if (safeBanner) {
    const warns = [...(data.warnings || [])];
    const ed = data.edition;
    const wfCount = data.brain_features?.workflow_count;
    if (ed && !ed.premium) {
      safeBanner.className = "safe-banner edition-beta";
      const upgrade = ed.upgrade_url
        ? ` · <a href="${ed.upgrade_url}" target="_blank" rel="noopener">Premium</a>`
        : "";
      const lim = ed.limits || {};
      const hist = lim.chat_history_turns ?? 4;
      const dirN = lim.dir_list_max ?? 12;
      safeBanner.innerHTML =
        `🧪 Beta — ${hist} turnos chat · 1 carpeta local (${dirN} entradas/listado) · sin Repo/Archivo.${upgrade}`;
      if (consolidateBtn) consolidateBtn.hidden = true;
      if (forgetStaleBtn) forgetStaleBtn.hidden = true;
    } else {
      if (consolidateBtn) consolidateBtn.hidden = false;
      if (forgetStaleBtn) forgetStaleBtn.hidden = false;
      if (wfCount != null && wfCount < 4) {
        warns.push(
          `Instancia vieja (${wfCount}/4+ workflows). Ejecuta scripts/start-brain.ps1 y abre el puerto que indique.`
        );
      }
    }
    if (warns.length) {
      safeBanner.className = "safe-banner warn";
      safeBanner.textContent = "⚠️ " + warns.join(" ");
    } else if (!ed || ed.premium) {
      safeBanner.className = "safe-banner";
      safeBanner.textContent =
        `🛡️ Patrón seguro: ${data.default_model}, libera VRAM. Embedding: ${data.memory?.embed_model || "nomic-embed-text"}`;
    }
  }
}

async function loadWorkflows() {
  const res = await fetch("/api/workflows");
  const data = await res.json();
  workflows = data.workflows || [];
  if (!selectedId && workflows.length) selectedId = workflows[0].id;
  renderStrip();
  updateFramework();
}

async function refreshBrainGraph() {
  if (!brain3d) return;
  if (refreshBrainGraph._timer) clearTimeout(refreshBrainGraph._timer);
  refreshBrainGraph._timer = setTimeout(async () => {
    refreshBrainGraph._timer = null;
    await brain3d.loadGraph();
    rebuildClusterStrip(brain3d.clusters);
  }, 400);
}

async function loadVaultNotes() {
  const res = await fetch("/api/vault/notes");
  const data = await res.json();
  const notes = data.notes || [];
  vaultNoteCount.textContent = notes.length;
  vaultNoteList.innerHTML = "";
  notes.slice(0, 10).forEach((n) => {
    const li = document.createElement("li");
    li.className = "memory-item clickable";
    li.innerHTML = `
      <span class="memory-type">note</span>
      <span class="memory-text">${escapeHtml(n.title)} — ${escapeHtml((n.preview || "").slice(0, 60))}</span>
    `;
    li.onclick = () => {
      openNeuronDetail({
        id: `vault_${n.path.replace(/\//g, "_").replace(".md", "")}`,
        label: n.title,
        type: "note",
        content_preview: n.preview,
        full_content: "",
        importance: n.path === "BRAIN.md" ? 0.95 : 0.65,
        created_at: n.modified_at,
        connections: n.links || [],
        ref_path: n.path,
      });
    };
    vaultNoteList.appendChild(li);
  });
}

async function loadVaultStatus() {
  const res = await fetch("/api/vault/onboarding/status");
  const data = await res.json();
  if (data.completed) {
    vaultStatus.textContent = "BRAIN.md listo · cada chat se guarda en Process/";
    vaultOnboardBtn.textContent = "Re-entrevista";
  } else if (data.active) {
    vaultStatus.textContent = `Onboarding ${data.step}/${data.total} — responde abajo`;
    showOnboardingBox(true);
  } else {
    vaultStatus.textContent = "Completa la entrevista para cargar tu perfil automáticamente";
  }
}

function showOnboardingBox(show) {
  onboardingBox.classList.toggle("hidden", !show);
}

async function startOnboarding() {
  const res = await fetch("/api/vault/onboarding/start", { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Error");
  showOnboardingBox(true);
  onboardingQuestion.textContent = data.question || "";
  onboardingAnswer.value = "";
  onboardingAnswer.focus();
  await loadVaultStatus();
}

async function submitOnboardingAnswer() {
  const answer = onboardingAnswer.value.trim();
  if (!answer) return;
  onboardingSubmitBtn.disabled = true;
  try {
    const res = await fetch("/api/vault/onboarding/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Error");
    if (data.done) {
      showOnboardingBox(false);
      output.textContent = data.message || "Perfil guardado en BRAIN.md";
      await loadVaultNotes();
      await refreshBrainGraph();
    } else {
      onboardingQuestion.textContent = data.question || "";
      onboardingAnswer.value = "";
      onboardingAnswer.focus();
    }
    await loadVaultStatus();
  } finally {
    onboardingSubmitBtn.disabled = false;
  }
}

async function maintainVault() {
  vaultMaintainBtn.disabled = true;
  try {
    const res = await fetch("/api/vault/maintain", { method: "POST" });
    const data = await res.json();
    output.textContent = data.summary || "Vault revisado.";
    await loadVaultNotes();
    await refreshBrainGraph();
  } finally {
    vaultMaintainBtn.disabled = false;
  }
}

async function createProject() {
  const name = projectNameInput.value.trim();
  if (!name) return;
  createProjectBtn.disabled = true;
  try {
    const res = await fetch("/api/vault/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, goal: "" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Error");
    projectNameInput.value = "";
    output.textContent = `Proyecto creado: projects/${data.slug} (Inputs/Process/Outputs/Feedback)`;
    await loadVaultNotes();
    await refreshBrainGraph();
  } catch (err) {
    output.textContent = "Proyecto: " + err.message;
  } finally {
    createProjectBtn.disabled = false;
  }
}

async function loadRepos() {
  const res = await fetch("/api/repos");
  const data = await res.json();
  if (data.premium_required) {
    if (reposPanel) reposPanel.classList.add("hidden");
    return;
  }
  if (reposPanel) reposPanel.classList.remove("hidden");
  const repos = data.repos || [];
  repoCount.textContent = repos.length;
  repoList.innerHTML = "";
  repos.forEach((r) => {
    const li = document.createElement("li");
    li.className = "memory-item clickable";
    li.innerHTML = `
      <span class="memory-type">repo</span>
      <span class="memory-text">${escapeHtml(r.label)} — ${r.memory_count || 0} chats</span>
    `;
    li.onclick = () => {
      openNeuronDetail({
        id: `repo_${r.id}`,
        label: r.label,
        type: "repository",
        content_preview: r.description || r.label,
        full_content: "",
        importance: 0.88,
        connections: ["core"],
        ref_path: r.code_path,
      });
    };
    repoList.appendChild(li);
  });
}

async function syncRepos() {
  syncReposBtn.disabled = true;
  output.className = "output-box thinking";
  let repoLabels = "repositorios configurados";
  try {
    const listRes = await fetch("/api/repos");
    const listData = await listRes.json();
    const names = (listData.repos || []).map((r) => r.label || r.id);
    if (names.length) repoLabels = names.join(", ");
  } catch {
    /* ignore */
  }
  output.textContent =
    `Importando chats Cursor (${repoLabels})… puede tardar 1–2 min. No uses uvicorn --reload durante la importación.`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300000);
  try {
    const res = await fetch("/api/repos/sync", { method: "POST", signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(errBody.slice(0, 200) || `HTTP ${res.status}`);
    }
    const data = await res.json();
    const summary = (data.repos || [])
      .map((r) =>
        r.error
          ? `${r.repo_id}: ${r.error}`
          : `${r.repo_id}: +${r.added} nuevos, ${r.skipped ?? 0} ya importados`
      )
      .join(" · ");
    output.className = "output-box";
    output.textContent = `Repos sincronizados. ${summary || "Listo."}`;
    await loadRepos();
    await loadMemories();
    await refreshBrainGraph();
  } catch (err) {
    output.className = "output-box";
    const msg =
      err.name === "AbortError"
        ? "Importación tardó demasiado (>5 min). ¿Ollama caído o uvicorn --reload reinició el servidor? Usa scripts/start-brain.ps1 (sin --reload) y vuelve a intentar."
        : err.message;
    output.textContent = "Sync repos: " + msg;
  } finally {
    clearTimeout(timer);
    syncReposBtn.disabled = false;
  }
}

async function pinNeuronOnBrain(neuronId) {
  if (!neuronId) return false;
  if (brain3d?.locateNeuron(neuronId)) return true;
  if (brain3d) {
    await brain3d.loadGraph();
    rebuildClusterStrip(brain3d.clusters);
    if (brain3d.locateNeuron(neuronId)) return true;
  }
  return false;
}

async function pinMemoryNeuron(memoryId) {
  const ok = await pinNeuronOnBrain(memoryNeuronId(memoryId));
  if (!ok && output) {
    output.className = "output-box";
    output.textContent = "No se encontró la neurona. Pulsa ↻ Actualizar en Memorias.";
  }
  return ok;
}

function memoryDetailPayload(m) {
  return {
    id: memoryNeuronId(m.id),
    label: (m.text || "").slice(0, 40),
    type: memoryNeuronType(m.type),
    content_preview: (m.text || "").slice(0, 80),
    full_content: m.text || "",
    importance: m.importance,
    created_at: m.created_at || m.metadata?.created_at,
    connections: ["core"],
  };
}

function searchKindLabel(kind) {
  if (kind === "vault_note") return "Vault";
  if (kind === "memory") return "Memoria";
  return "Neurona";
}

function searchResultToNeuron(item) {
  return {
    id: item.id,
    label: item.label || item.id,
    type: item.kind === "vault_note" ? "note" : item.type || "memory",
    content_preview: item.preview || "",
    full_content: item.preview || "",
    ref_path: item.vault_path || null,
    importance: item.importance,
    created_at: item.created_at,
    connections: ["core"],
  };
}

async function deleteMemoryById(memoryId) {
  const res = await fetch(`/api/memories/${encodeURIComponent(memoryId)}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "No se pudo eliminar la memoria");
  }
}

async function deleteVaultNoteByPath(vaultPath) {
  const res = await fetch(`/api/vault/notes/${encodeURIComponent(vaultPath)}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "No se pudo eliminar la nota");
  }
}

async function deleteSearchResult(item) {
  const label = item.label || item.id;
  if (!confirm(`¿Eliminar «${label.slice(0, 72)}»?`)) return;
  if (item.memory_id) {
    await deleteMemoryById(item.memory_id);
  } else if (item.vault_path) {
    await deleteVaultNoteByPath(item.vault_path);
  } else {
    return;
  }
  hideNeuronPanel();
  await loadMemories();
  await loadVaultNotes();
  await refreshBrainGraph();
  await loadHealth();
  const q = memorySearchInput?.value?.trim();
  if (q) await runMemorySearch(q);
  else clearSearchResults();
}

async function deleteActiveNeuron() {
  if (!activeNeuronContext?.deletable) return;
  const label = activeNeuronContext.label || activeNeuronContext.neuronId;
  if (!confirm(`¿Eliminar «${String(label).slice(0, 72)}»?`)) return;
  try {
    if (activeNeuronContext.memoryId) {
      await deleteMemoryById(activeNeuronContext.memoryId);
    } else if (activeNeuronContext.vaultPath) {
      await deleteVaultNoteByPath(activeNeuronContext.vaultPath);
    }
    hideNeuronPanel();
    await loadMemories();
    await loadVaultNotes();
    await refreshBrainGraph();
    await loadHealth();
    const q = memorySearchInput?.value?.trim();
    if (q) await runMemorySearch(q);
    else clearSearchResults();
  } catch (err) {
    output.className = "output-box";
    output.textContent = "Error al eliminar: " + err.message;
  }
}

function bindMemoryRowActions(li, ctx) {
  li.querySelector(".memory-pin")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    await pinNeuronOnBrain(ctx.neuronId);
  });
  li.querySelectorAll(".memory-view").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openNeuronDetail(ctx.neuron, { initialTab: btn.dataset.tab || "content" });
    });
  });
  li.querySelector(".memory-del")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    await deleteSearchResult(ctx.deletePayload);
  });
}

function renderMemoryRows(items, { searchMode = false, asMemories = false, targetList = memoryList } = {}) {
  if (!targetList) return;
  targetList.innerHTML = "";
  if (searchMode) {
    targetList.classList.remove("hidden");
  }
  if (searchMode && !items.length) {
    targetList.innerHTML = `<li class="memory-list-search-hint">Sin resultados para esa búsqueda.</li>`;
    return;
  }
  if (searchMode) {
    const hint = document.createElement("li");
    hint.className = "memory-list-search-hint";
    hint.textContent = `${items.length} resultado(s) — ID neurona, memoria ChromaDB o nota vault`;
    targetList.appendChild(hint);
  }

  items.forEach((item) => {
    const asMem = asMemories;
    const neuron = asMem ? memoryDetailPayload(item) : searchResultToNeuron(item);
    const chatMemory = asMem
      ? isChatMemory(item)
      : item.kind === "memory" && (item.type === "conversation" || item.type === "workflow_run");
    const deletePayload = asMem
      ? { memory_id: item.id, label: (item.text || "").slice(0, 72) }
      : { memory_id: item.memory_id, vault_path: item.vault_path, label: item.label };
    const preview = asMem ? (item.text || "").slice(0, 100) : (item.preview || item.label || "").slice(0, 100);
    const idLine = asMem ? item.id : item.id;
    const kindBadge = asMem ? "" : `<span class="memory-kind-badge">${searchKindLabel(item.kind)}</span>`;

    const li = document.createElement("li");
    li.className = "memory-item clickable";
    li.innerHTML = `
      ${kindBadge}<span class="memory-type">${escapeHtml(asMem ? item.type : item.type || item.kind)}</span>
      <span class="memory-text">${escapeHtml(preview)}</span>
      <span class="memory-item-id">${escapeHtml(idLine)}</span>
      <div class="memory-item-actions">
        <button type="button" class="secondary small memory-pin" title="Ubicar en cerebro 3D" aria-label="Ubicar neurona">📍</button>
        ${chatMemory ? `<button type="button" class="secondary small memory-view" data-tab="conversation" title="Ver conversación" aria-label="Ver conversación">💬</button>` : ""}
        <button type="button" class="secondary small memory-view" data-tab="content" title="Ver contenido" aria-label="Ver contenido">📄</button>
        <button type="button" class="secondary small memory-del" title="Eliminar" aria-label="Eliminar">✕</button>
      </div>
    `;
    li.onclick = (e) => {
      if (e.target.closest(".memory-item-actions")) return;
      openNeuronDetail(neuron, { initialTab: chatMemory ? "conversation" : "content" });
    };
    bindMemoryRowActions(li, { neuron, neuronId: neuron.id, deletePayload });
    targetList.appendChild(li);
  });
}

function clearSearchResults() {
  if (searchResults) {
    searchResults.innerHTML = "";
    searchResults.classList.add("hidden");
  }
}

function vaultNeuronIdFromPath(path) {
  return `vault_${String(path || "")
    .replace(/\\/g, "/")
    .replace(/\//g, "_")
    .replace(/\.md$/i, "")
    .replace(/ /g, "-")}`;
}

function localSearchMatch(haystack, query) {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const h = haystack.toLowerCase();
  if (h.includes(q) || h === q) return true;
  return q.split(/\s+/).filter((p) => p.length >= 2).every((p) => h.includes(p));
}

async function searchBrainLocal(query) {
  const q = query.trim();
  if (!q) return [];
  const results = [];
  const seen = new Set();

  const push = (item) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    results.push(item);
  };

  let memories = cachedMemories;
  if (!memories.length) {
    try {
      const memRes = await fetch("/api/memories");
      if (memRes.ok) {
        const memData = await memRes.json();
        memories = memData.memories || [];
        cachedMemories = memories;
      }
    } catch (_) {
      memories = [];
    }
  }

  for (const m of memories) {
    const neuronId = memoryNeuronId(m.id);
    const meta = m.metadata || {};
    const haystack = [m.id, neuronId, m.text || "", m.type || "", JSON.stringify(meta)].join(" ");
    if (!localSearchMatch(haystack, q) && q.toLowerCase() !== m.id.toLowerCase() && q.toLowerCase() !== neuronId.toLowerCase()) {
      continue;
    }
    push({
      kind: "memory",
      id: neuronId,
      memory_id: m.id,
      vault_path: meta.vault_note_path || null,
      label: (m.text || m.id).slice(0, 48),
      preview: (m.text || "").slice(0, 160),
      type: m.type || "conversation",
      importance: m.importance,
      created_at: m.created_at,
    });
  }

  try {
    const vRes = await fetch("/api/vault/notes");
    if (vRes.ok) {
      const vData = await vRes.json();
      for (const note of vData.notes || []) {
        const neuronId = vaultNeuronIdFromPath(note.path);
        const stem = (note.path || "").split("/").pop()?.replace(/\.md$/i, "") || "";
        const haystack = [neuronId, note.path, note.title, note.preview || ""].join(" ");
        const exact =
          q.toLowerCase() === neuronId.toLowerCase()
          || q.toLowerCase() === (note.path || "").toLowerCase()
          || q.toLowerCase() === stem.toLowerCase();
        if (!exact && !localSearchMatch(haystack, q)) continue;
        push({
          kind: "vault_note",
          id: neuronId,
          memory_id: null,
          vault_path: note.path,
          label: note.title || note.path,
          preview: (note.preview || "").slice(0, 160),
          type: "note",
          importance: null,
          created_at: note.modified_at,
        });
      }
    }
  } catch (_) {
    /* vault optional */
  }

  return results.slice(0, 50);
}

async function runMemorySearch(query) {
  const q = query.trim();
  memorySearchClear?.classList.toggle("hidden", !q);
  if (!q) {
    clearSearchResults();
    return;
  }
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=50`);
    if (res.status === 404) {
      const local = await searchBrainLocal(q);
      renderMemoryRows(local, { searchMode: true, targetList: searchResults });
      return;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Error de búsqueda");
    renderMemoryRows(data.results || [], { searchMode: true, targetList: searchResults });
  } catch (err) {
    try {
      const local = await searchBrainLocal(q);
      if (local.length) {
        renderMemoryRows(local, { searchMode: true, targetList: searchResults });
        return;
      }
    } catch (_) {
      /* fall through */
    }
    if (searchResults) {
      searchResults.classList.remove("hidden");
      searchResults.innerHTML = `<li class="memory-list-search-hint">Error: ${escapeHtml(err.message)}. Reinicia con scripts/start-brain.ps1</li>`;
    }
  }
}

function isChatMemory(m) {
  if (m.type === "conversation" || m.type === "workflow_run") return true;
  return parseConversationText(m.text || "").isChat;
}

async function loadMemories() {
  const res = await fetch("/api/memories");
  const data = await res.json();
  cachedMemories = data.memories || [];
  memoryCount.textContent = cachedMemories.length;
  renderMemoryRows(cachedMemories.slice(0, 12), { asMemories: true, targetList: memoryList });
}

async function addMemory() {
  const text = memoryInput.value.trim();
  if (!text) return;
  addMemoryBtn.disabled = true;
  try {
    const res = await fetch("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, type: memoryTypeSelect.value }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Error al guardar");
    }
    memoryInput.value = "";
    await loadMemories();
    await loadVaultNotes();
    await refreshBrainGraph();
    await loadHealth();
  } catch (err) {
    output.textContent = "Memoria: " + err.message;
  } finally {
    addMemoryBtn.disabled = false;
  }
}

async function runWorkflow() {
  if (!selectedId || llmBusy) return;
  runBtn.disabled = true;
  chatBtn.disabled = true;
  refreshBtn.disabled = true;
  setLlmBusy(true, "Ejecutando workflow…", "Liberando GPU · consultando Ollama…");
  setRunning(selectedId);
  output.className = "output-box thinking";
  output.textContent = "Impulsos sinápticos en marcha — ejecutando workflow…";
  sources.textContent = "";
  try {
    const res = await fetch(`/api/workflows/${selectedId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelSelect.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Error al ejecutar");
    output.className = "output-box";
    output.textContent = data.output || "(sin salida)";
    if (data.web_results?.length) {
      sources.innerHTML = "<strong>Fuentes:</strong><br>" + data.web_results
        .map((r) => `• <a href="${r.url}" target="_blank" rel="noopener">${r.title || r.url}</a>`)
        .join("<br>");
    }
    refreshAfterLlm();
  } catch (err) {
    output.className = "output-box";
    output.textContent = "Error: " + err.message;
  } finally {
    runBtn.disabled = false;
    chatBtn.disabled = false;
    refreshBtn.disabled = false;
    setLlmBusy(false);
    clearRunning();
    loadHealth();
  }
}

async function sendChat() {
  const message = chatInput.value.trim();
  if (!message || llmBusy) return;
  chatBtn.disabled = true;
  runBtn.disabled = true;
  refreshBtn.disabled = true;
  setLlmBusy(true, "Generando respuesta…", "Cerebro 3D en pausa · GPU libre para el modelo");
  sources.textContent = "";

  sessionHistory.push({ role: "user", content: message });
  streamingAssistant = "…";
  renderSessionTranscript(streamingAssistant);
  chatInput.value = "";

  const payload = {
    message,
    model: modelSelect.value,
    workflow_id: selectedId || null,
    history: sessionHistory.slice(0, -1),
  };

  try {
    const res = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Error en chat");
    }

    let finalContent = "";
    let finalModel = modelSelect.value;
    streamingAssistant = "";

    await consumeChatStream(res, (evt) => {
      if (evt.type === "web_results") {
        renderWebSources(evt.web_results);
      } else if (evt.type === "token") {
        streamingAssistant += evt.content;
        renderSessionTranscript(streamingAssistant);
      } else if (evt.type === "done") {
        finalContent = evt.content || streamingAssistant;
        finalModel = evt.model || finalModel;
      } else if (evt.type === "error") {
        throw new Error(evt.detail || "Error en streaming");
      }
    });

    streamingAssistant = "";
    sessionHistory.push({ role: "assistant", content: finalContent || "(sin respuesta)" });
    renderSessionTranscript();
    refreshAfterLlm();
  } catch (err) {
    sessionHistory.pop();
    streamingAssistant = "";
    output.className = "output-box";
    output.textContent = "Error: " + err.message;
    renderSessionTranscript();
  } finally {
    chatBtn.disabled = false;
    runBtn.disabled = false;
    refreshBtn.disabled = false;
    setLlmBusy(false);
    loadHealth();
  }
}

function updateBrainZoomHud({ label, t }) {
  if (brainZoomLevel) brainZoomLevel.textContent = label;
  if (brainZoomThumb) {
    const pct = Math.max(0, Math.min(100, (1 - t) * 82));
    brainZoomThumb.style.top = `${pct}%`;
  }
}

let activeClusterKey = null;

function setActiveCluster(key) {
  activeClusterKey = key || null;
  if (!brainClusterStrip) return;
  brainClusterStrip.classList.toggle("has-active", !!activeClusterKey);
  brainClusterStrip.querySelectorAll(".cluster-strip-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.cluster === activeClusterKey);
    btn.setAttribute("aria-pressed", btn.dataset.cluster === activeClusterKey ? "true" : "false");
  });
}

async function focusClusterOnBrain(key) {
  if (!key || !brain3d) return false;
  if (brain3d._suspended) brain3d.suspendRendering(false);
  brain3d.ensureClusters();
  setActiveCluster(key);
  if (brain3d.locateCluster(key)) return true;
  await brain3d.loadGraph();
  rebuildClusterStrip(brain3d.clusters);
  setActiveCluster(key);
  return !!brain3d.locateCluster(key);
}

function bindClusterStripBtn(btn, key) {
  const stop = (e) => e.stopPropagation();
  btn.addEventListener("pointerdown", stop, { capture: true });
  btn.addEventListener("mousedown", stop, { capture: true });
  btn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    focusClusterOnBrain(key);
  };
}

function rebuildClusterStrip(clusters = {}) {
  if (!brainClusterStrip) return;
  brainClusterStrip.innerHTML = "";
  const order = ["workflows", "repos", "cortex", "vault"];
  for (const key of order) {
    const c = clusters[key];
    if (!c || !c.count) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cluster-strip-btn hud-interactive";
    btn.dataset.cluster = key;
    btn.style.setProperty("--cluster-color", c.color);
    btn.innerHTML = `<span>${c.label}</span><em>${c.count}</em>`;
    btn.title = `Acercar a ${c.label} (${c.count} neuronas)`;
    btn.setAttribute("aria-pressed", "false");
    btn.onclick = null;
    bindClusterStripBtn(btn, key);
    brainClusterStrip.appendChild(btn);
  }
  for (const [key, c] of Object.entries(clusters)) {
    if (!c.parent || c.parent !== "repos") continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cluster-strip-btn cluster-strip-sub hud-interactive";
    btn.dataset.cluster = key;
    btn.style.setProperty("--cluster-color", c.color);
    btn.innerHTML = `<span>${c.label}</span><em>${c.count}</em>`;
    btn.title = `Acercar a ${c.label} (${c.count} neuronas)`;
    btn.setAttribute("aria-pressed", "false");
    bindClusterStripBtn(btn, key);
    brainClusterStrip.appendChild(btn);
  }
  if (activeClusterKey && clusters[activeClusterKey]) {
    setActiveCluster(activeClusterKey);
  } else {
    setActiveCluster(null);
  }
}

function initBrainNav() {
  brainZoomIn?.addEventListener("click", (e) => {
    e.stopPropagation();
    brain3d?.zoomIn();
  });
  brainZoomOut?.addEventListener("click", (e) => {
    e.stopPropagation();
    brain3d?.zoomOut();
  });
  brainZoomReset?.addEventListener("click", (e) => {
    e.stopPropagation();
    setActiveCluster(null);
    brain3d?.clearClusterFocus();
    brain3d?.resetView();
  });
}

function setBrainPaused(p) {
  if (brain3d) brain3d.setPaused(p);
}

function setLlmBusy(busy, label = "Procesando con Ollama…", hint = null) {
  llmBusy = busy;
  if (llmLoading) {
    llmLoading.classList.toggle("hidden", !busy);
    llmLoading.setAttribute("aria-busy", busy ? "true" : "false");
  }
  brainStage?.classList.toggle("llm-busy", busy);
  document.body.classList.toggle("llm-busy", busy);
  if (label && llmLoadingLabel) llmLoadingLabel.textContent = label;
  if (hint && llmLoadingHint) llmLoadingHint.textContent = hint;
  else if (busy && llmLoadingHint) {
    llmLoadingHint.textContent = LLM_LOADING_HINTS[0];
  }

  if (brain3d) {
    if (busy) brain3d.suspendRendering(true);
    else brain3d.suspendRendering(false);
  }

  clearInterval(llmLoadingTimer);
  if (busy) {
    let step = 0;
    llmLoadingTimer = setInterval(() => {
      step += 1;
      if (llmLoadingHint) {
        llmLoadingHint.textContent = LLM_LOADING_HINTS[step % LLM_LOADING_HINTS.length];
      }
    }, 4500);
  }
}

async function refreshAfterLlm() {
  await loadMemories();
  await loadVaultNotes();
  setTimeout(() => refreshBrainGraph(), 1200);
}

function initBrain() {
  brain3d = new Brain3D(brain3dContainer, {
    interactionEl: brainStage,
    onSelect: (n) => {
      if (!n) {
        hideNeuronPanel();
        return;
      }
      setActiveCluster(null);
      openNeuronDetail(n).catch(() => {});
    },
    onClusterFocus: (key) => setActiveCluster(key),
    onHover: (n, x, y) => showTooltip(n, x, y),
    onZoomChange: (info) => updateBrainZoomHud(info),
  });
  brain3d.loadGraph().then(() => {
    if (brain3d?.clusters) rebuildClusterStrip(brain3d.clusters);
  });
  initBrainNav();
  brain3d.setInteractionEnabled(true);
  workflowStrip?.addEventListener("pointerdown", (e) => e.stopPropagation());
  workflowStrip?.addEventListener("click", (e) => e.stopPropagation());
  neuronModal?.addEventListener("wheel", (e) => e.stopPropagation(), { capture: true });

  window.__brainAI = {
    cameraDistance: () => brain3d?._cameraDistance?.() ?? null,
    clusterKeys: () => Object.keys(brain3d?.ensureClusters?.() || {}),
    focusCluster: (key) => focusClusterOnBrain(key),
    pinNeuron: (id) => pinNeuronOnBrain(id),
    focusedCluster: () => brain3d?._focusedClusterKey ?? null,
    zoomLevel: () => brain3d?._zoomLevel ?? null,
  };
}

neuronPanelClose.onclick = hideNeuronPanel;
neuronPanelPin?.addEventListener("click", async () => {
  const id = neuronPanelPin.dataset.neuronId;
  if (id) await pinNeuronOnBrain(id);
});
neuronPanelDelete?.addEventListener("click", () => deleteActiveNeuron());
memorySearchInput?.addEventListener("input", () => {
  clearTimeout(memorySearchTimer);
  memorySearchTimer = setTimeout(() => runMemorySearch(memorySearchInput.value), 260);
});
memorySearchInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    clearTimeout(memorySearchTimer);
    runMemorySearch(memorySearchInput.value);
  }
});
memorySearchClear?.addEventListener("click", () => {
  if (memorySearchInput) memorySearchInput.value = "";
  memorySearchClear.classList.add("hidden");
  clearSearchResults();
});
neuronModalBackdrop.onclick = hideNeuronPanel;
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !neuronModal.classList.contains("hidden")) {
    hideNeuronPanel();
  }
});
runBtn.onclick = runWorkflow;
chatBtn.onclick = sendChat;
if (clearChatBtn) clearChatBtn.onclick = clearSessionHistory;
addMemoryBtn.onclick = addMemory;
refreshMemoriesBtn.onclick = async () => {
  await loadMemories();
  await refreshBrainGraph();
};
consolidateBtn.onclick = async () => {
  consolidateBtn.disabled = true;
  try {
    const res = await fetch("/api/memories/consolidate", { method: "POST" });
    const data = await res.json();
    output.textContent = `Consolidación: ${data.merged || 0} duplicados fusionados.`;
    await loadMemories();
    await loadVaultNotes();
    await refreshBrainGraph();
  } finally {
    consolidateBtn.disabled = false;
  }
};
forgetStaleBtn.onclick = async () => {
  forgetStaleBtn.disabled = true;
  try {
    const res = await fetch("/api/memories/forget-stale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: 30 }),
    });
    const data = await res.json();
    output.textContent = `Olvido: ${data.deleted || 0} memorias antiguas eliminadas.`;
    await loadMemories();
    await loadVaultNotes();
    await refreshBrainGraph();
  } finally {
    forgetStaleBtn.disabled = false;
  }
};
refreshBtn.onclick = async () => {
  if (llmBusy) return;
  await loadHealth();
  await loadWorkflows();
  await loadMemories();
  await loadVaultNotes();
  await loadVaultStatus();
  await refreshBrainGraph();
};
vaultOnboardBtn.onclick = () => startOnboarding().catch((e) => { output.textContent = e.message; });
onboardingSubmitBtn.onclick = () => submitOnboardingAnswer();
onboardingAnswer.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submitOnboardingAnswer();
  }
});
vaultMaintainBtn.onclick = maintainVault;
refreshVaultBtn.onclick = async () => {
  await loadVaultNotes();
  await refreshBrainGraph();
};
createProjectBtn.onclick = createProject;
syncReposBtn.onclick = syncRepos;
refreshReposBtn.onclick = loadRepos;

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

initBrain();
window.__brainAI = {
  cameraDistance: () => brain3d?._cameraDistance?.() ?? null,
  clusterKeys: () => Object.keys(brain3d?.clusters || {}),
  focusCluster: (k) => focusClusterOnBrain(k),
  pinNeuron: (id) => pinNeuronOnBrain(id),
  focusedCluster: () => brain3d?._focusedClusterKey ?? null,
  locateCluster: (k) => brain3d?.locateCluster?.(k) ?? false,
};
await loadHealth();
await loadWorkflows();
await loadMemories();
await loadVaultNotes();
await loadVaultStatus();
await loadRepos();
