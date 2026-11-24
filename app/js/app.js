import { CubeBaby } from "./device.js";
import * as store from "./store.js";
import { PARAMS, SWITCHES, SLOT_NAMES, DEFAULT_PRESETS, sanitizePreset } from "./params.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};

const dev = new CubeBaby();
let lib = store.load();
let editSlot = 0;
let snapshot = null; // preset copy for "Desfazer alterações"
let clipboard = null;

const bank = () => lib.banks[lib.current];
const persist = () => store.save(lib);

// ---------------------------------------------------------------- toast

let toastTimer;
function toast(msg, isErr = false) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("err", isErr);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), isErr ? 4000 : 2200);
}

// ---------------------------------------------------------------- loading banks into the pedal

let loadReq = 0;
let loadChain = Promise.resolve();

function setLoadState(text, cls) {
  const s = $("loadState");
  s.textContent = text;
  s.className = `load-state ${cls || ""}`;
}

function canWrite() {
  return dev.connected && dev.info.supported;
}

/** Send the current bank to the pedal's RAM. Latest request wins. */
function loadCurrentBank() {
  if (!canWrite()) {
    setLoadState(dev.connected ? "Modelo não validado: só leitura" : "Será carregado ao conectar o pedal", "busy");
    return Promise.resolve();
  }
  const my = ++loadReq;
  setLoadState("Carregando no pedal…", "busy");
  loadChain = loadChain.then(async () => {
    if (my !== loadReq) return;
    try {
      const want = bank().presets.map((p) => sanitizePreset(p.bytes));
      await dev.loadBank(want);
      // Read back and compare, so the screen only says OK when the pedal really has it.
      const got = await dev.readPresets();
      const bad = [0, 1, 2].filter((i) => got[i].some((b, k) => b !== want[i][k]));
      if (my !== loadReq) return;
      if (bad.length) setLoadState(`Pedal diferente do banco em ${bad.map((i) => SLOT_NAMES[i]).join(", ")}`, "err");
      else setLoadState("✓ Banco carregado e conferido no pedal", "ok");
    } catch (err) {
      if (my === loadReq) setLoadState(`Erro: ${err.message}`, "err");
    }
  });
  return loadChain;
}

// coalesced single-parameter writes (slider drags)
const pendingParams = new Map();
let flushing = false;
async function sendParam(slot, off, value) {
  if (!canWrite()) return;
  pendingParams.set(`${slot}:${off}`, { slot, off, value });
  if (flushing) return;
  flushing = true;
  try {
    while (pendingParams.size) {
      const [key, p] = pendingParams.entries().next().value;
      pendingParams.delete(key);
      await dev.setParam(p.slot, p.off, p.value);
    }
  } catch (err) {
    toast(`Erro ao enviar: ${err.message}`, true);
  } finally {
    flushing = false;
  }
}

// ---------------------------------------------------------------- bank navigation

function selectBank(i, { load = true } = {}) {
  const n = lib.banks.length;
  lib.current = ((i % n) + n) % n;
  snapshot = null;
  persist();
  renderAll();
  if (load) loadCurrentBank();
}

$("prevBank").onclick = () => selectBank(lib.current - 1);
$("unstick").onclick = async () => {
  if (!canWrite()) return toast("Conecte o pedal primeiro.", true);
  try {
    await dev.unstick(bank().presets.map((p) => sanitizePreset(p.bytes)));
    toast("Bloco AMP reiniciado.");
  } catch (err) {
    toast(`Erro: ${err.message}`, true);
  }
};
$("nextBank").onclick = () => selectBank(lib.current + 1);

document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, select, textarea")) return;
  if (["ArrowRight", "ArrowDown", "PageDown"].includes(e.key)) {
    e.preventDefault();
    selectBank(lib.current + 1);
  } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) {
    e.preventDefault();
    selectBank(lib.current - 1);
  }
});

// ---------------------------------------------------------------- views

const VIEWS = ["stage", "banks", "edit", "settings"];

function showView(name) {
  if (!VIEWS.includes(name)) name = "stage";
  if (location.hash.slice(1) !== name) history.replaceState(null, "", `#${name}`);
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  if (name === "edit") snapshot = null;
  renderAll();
  updateWakeLock();
}
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => showView(t.dataset.view)));

function renderAll() {
  renderStage();
  renderBanks();
  renderEditor();
  renderSettings();
}

function renderStage() {
  $("bankCounter").textContent = `Banco ${lib.current + 1} / ${lib.banks.length}`;
  $("bankName").textContent = bank().name;
  $("stageSlots").replaceChildren(
    ...bank().presets.map((p, i) =>
      el("li", { className: "slot" }, el("span", { className: "letter", textContent: SLOT_NAMES[i] }),
        el("span", { className: "pname", textContent: p.name })),
    ),
  );
}

function renderBanks() {
  $("bankList").replaceChildren(
    ...lib.banks.map((b, i) => {
      const name = el("input", { value: b.name, maxLength: 32, ariaLabel: "Nome do banco" });
      name.onchange = () => {
        b.name = name.value.trim() || `Banco ${i + 1}`;
        persist();
        renderAll();
      };
      const btn = (label, fn, title) => {
        const x = el("button", { className: "btn small", textContent: label, title: title || label });
        x.onclick = fn;
        return x;
      };
      return el(
        "li",
        { className: `bank-item ${i === lib.current ? "current" : ""}` },
        el("div", { className: "top" }, el("strong", { textContent: `${i + 1}.` }), name),
        el("div", { className: "names", textContent: b.presets.map((p, k) => `${SLOT_NAMES[k]}: ${p.name}`).join(" · ") }),
        el(
          "div",
          { className: "actions" },
          btn("Tocar", () => { selectBank(i); showView("stage"); }),
          btn("Editar", () => { selectBank(i); showView("edit"); }),
          btn("▲", () => moveBank(i, -1), "Mover para cima"),
          btn("▼", () => moveBank(i, 1), "Mover para baixo"),
          btn("Duplicar", () => duplicateBank(i)),
          btn("Apagar", () => deleteBank(i)),
        ),
      );
    }),
  );
}

function moveBank(i, d) {
  const j = i + d;
  if (j < 0 || j >= lib.banks.length) return;
  const cur = lib.banks[lib.current];
  [lib.banks[i], lib.banks[j]] = [lib.banks[j], lib.banks[i]];
  lib.current = lib.banks.indexOf(cur);
  persist();
  renderAll();
}

function duplicateBank(i) {
  const src = lib.banks[i];
  const copy = store.newBank(`${src.name} (cópia)`, src.presets.map((p) => p.bytes), src.presets.map((p) => p.name));
  lib.banks.splice(i + 1, 0, copy);
  persist();
  renderAll();
}

function deleteBank(i) {
  if (lib.banks.length === 1) return toast("Precisa existir pelo menos um banco.", true);
  if (!confirm(`Apagar o banco "${lib.banks[i].name}"?`)) return;
  const wasCurrent = i === lib.current;
  lib.banks.splice(i, 1);
  if (lib.current > i || lib.current >= lib.banks.length) lib.current--;
  lib.current = Math.max(0, lib.current);
  persist();
  renderAll();
  if (wasCurrent) loadCurrentBank();
}

$("addBank").onclick = () => {
  const b = bank();
  lib.banks.push(store.newBank(`Banco ${lib.banks.length + 1}`, b.presets.map((p) => p.bytes), b.presets.map((p) => p.name)));
  persist();
  renderAll();
  toast("Banco criado (cópia do banco atual).");
};

// ---------------------------------------------------------------- editor

function preset() {
  return bank().presets[editSlot];
}

function renderEditor() {
  const sel = $("editBank");
  sel.replaceChildren(...lib.banks.map((b, i) => el("option", { value: i, textContent: `${i + 1}. ${b.name}` })));
  sel.value = lib.current;

  $("editSlot").replaceChildren(
    ...SLOT_NAMES.map((s, i) => {
      const b = el("button", { textContent: s, title: bank().presets[i].name, role: "tab" });
      b.setAttribute("aria-selected", i === editSlot);
      b.onclick = () => { editSlot = i; snapshot = null; renderEditor(); };
      return b;
    }),
  );

  const p = preset();
  if (!snapshot) snapshot = { name: p.name, bytes: [...p.bytes] };
  $("presetName").value = p.name;
  $("editHint").textContent = canWrite()
    ? `Mudanças vão direto para a RAM do pedal. Pise no ${SLOT_NAMES[editSlot]} para ouvir.`
    : "Conecte o pedal para ouvir as mudanças em tempo real.";

  $("paramList").replaceChildren(
    ...PARAMS.map((def) => {
      const fmt = (v) => (def.describe ? `${v} · ${def.describe(v)}` : String(v));
      const val = el("span", { className: "val", textContent: fmt(p.bytes[def.off]) });
      const range = el("input", { type: "range", min: 0, max: def.max, step: 1, value: Math.min(p.bytes[def.off], def.max) });
      range.oninput = () => {
        const v = Number(range.value);
        p.bytes[def.off] = v;
        val.textContent = fmt(v);
        $("rawBytes").textContent = hex(p.bytes);
        persist();
        sendParam(editSlot, def.off, v);
      };
      const label = el("label", {}, el("span", { textContent: def.label }), el("span", {}, val, el("span", { className: "max", textContent: ` / ${def.max}` })));
      return el("div", { className: "param" }, label, range);
    }),
  );

  $("switchList").replaceChildren(
    ...SWITCHES.map((def) => {
      const box = el("input", { type: "checkbox", checked: !!p.bytes[def.off] });
      box.onchange = () => {
        const v = box.checked ? 1 : 0;
        p.bytes[def.off] = v;
        $("rawBytes").textContent = hex(p.bytes);
        persist();
        sendParam(editSlot, def.off, v);
      };
      return el("label", { className: "switch" }, el("span", { textContent: def.label }), box);
    }),
  );

  $("rawBytes").textContent = hex(p.bytes);
  $("pastePreset").disabled = !clipboard;
}

const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ");

$("editBank").onchange = (e) => selectBank(Number(e.target.value));

$("presetName").onchange = (e) => {
  preset().name = e.target.value.trim() || `Preset ${SLOT_NAMES[editSlot]}`;
  persist();
  renderAll();
};

$("revertPreset").onclick = () => {
  if (!snapshot) return;
  const p = preset();
  p.name = snapshot.name;
  p.bytes = [...snapshot.bytes];
  persist();
  renderAll();
  loadCurrentBank();
  toast("Alterações desfeitas.");
};

$("copyPreset").onclick = () => {
  clipboard = { name: preset().name, bytes: [...preset().bytes] };
  renderEditor();
  toast(`Preset "${clipboard.name}" copiado.`);
};

$("pastePreset").onclick = () => {
  if (!clipboard) return;
  const p = preset();
  p.name = clipboard.name;
  p.bytes = [...clipboard.bytes];
  persist();
  renderAll();
  loadCurrentBank();
  toast("Preset colado.");
};

// ---------------------------------------------------------------- settings

function renderSettings() {
  const i = dev.info;
  $("devInfo").textContent = i
    ? `${i.name} · chip 0x${i.chipId.toString(16)} · ${i.supported ? "modelo validado" : "modelo NÃO validado (só leitura)"} · porta "${i.port}"`
    : "Nenhum pedal conectado.";
  $("importPedal").disabled = !dev.connected;
}

$("importPedal").onclick = async () => {
  try {
    const presets = await dev.readPresets();
    lib.banks.push(store.newBank(`Do pedal ${new Date().toLocaleDateString("pt-BR")}`, presets));
    persist();
    renderAll();
    toast("Presets do pedal adicionados como novo banco.");
  } catch (err) {
    toast(`Erro: ${err.message}`, true);
  }
};

$("diagBtn").onclick = async () => {
  const out = $("diagOut");
  if (!dev.connected) return toast("Conecte o pedal primeiro.", true);
  try {
    const got = await dev.readPresets();
    out.replaceChildren(
      el("p", { textContent: `Banco atual: ${lib.current + 1}. ${bank().name}` }),
      ...[0, 1, 2].map((i) => {
        const want = bank().presets[i].bytes;
        const same = got[i].every((b, k) => b === want[k]);
        return el(
          "div",
          { className: `diag-slot ${same ? "ok" : "err"}` },
          el("strong", { textContent: `${SLOT_NAMES[i]} ${same ? "✓ igual" : "✗ diferente"}` }),
          el("code", { textContent: `pedal: ${hex(got[i])}` }),
          el("code", { textContent: `banco: ${hex(want)}` }),
        );
      }),
    );
  } catch (err) {
    toast(`Erro: ${err.message}`, true);
  }
};

$("exportLib").onclick = () => store.exportFile(lib);

$("importLib").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const imported = await store.importFile(file);
    if (!confirm(`Substituir a biblioteca atual por ${imported.banks.length} banco(s) do arquivo?`)) return;
    lib = imported;
    store.save(lib, true);
    renderAll();
    loadCurrentBank();
    toast("Biblioteca importada.");
  } catch (err) {
    toast(`Erro: ${err.message}`, true);
  }
};

$("resetLib").onclick = () => {
  if (!confirm("Apagar todos os bancos deste celular? Exporte um backup antes, se quiser guardar.")) return;
  store.clear();
  location.reload();
};

// ---------------------------------------------------------------- connection

function renderConn() {
  const c = $("conn");
  c.classList.toggle("on", dev.connected && dev.info.supported);
  c.classList.toggle("warn", dev.connected && !dev.info.supported);
  $("connText").textContent = $("conn").title = dev.connected
    ? dev.info.supported ? "Cube Baby conectado" : "Conectado (modelo não validado)"
    : dev.access ? "Procurando o pedal…" : "Desconectado";
  $("connectBtn").hidden = !!dev.access;
}

const isUntouchedDefault = (b) =>
  b.presets.every((p, i) => p.name === `Preset ${SLOT_NAMES[i]}` && p.bytes.every((x, k) => x === DEFAULT_PRESETS[i][k]));

dev.addEventListener("connected", async () => {
  renderConn();
  // First connection ever: keep the pedal's own presets as a bank.
  if (!lib.fromPedal) {
    try {
      const presets = await dev.readPresets();
      const original = store.newBank("Original do pedal", presets);
      if (lib.banks.length === 1 && isUntouchedDefault(lib.banks[0])) lib.banks = [original];
      else lib.banks.unshift(original);
      lib.current = 0;
      lib.fromPedal = true;
      store.save(lib, true);
      toast("Presets salvos no pedal guardados como \"Original do pedal\".");
    } catch (err) {
      toast(`Erro ao ler presets: ${err.message}`, true);
    }
  }
  renderAll();
  loadCurrentBank();
});

dev.addEventListener("disconnected", () => {
  renderConn();
  renderAll();
  setLoadState("Pedal desconectado: o banco será recarregado ao reconectar", "busy");
});

async function connect() {
  try {
    await dev.init();
    renderConn();
    if (!dev.connected) setLoadState("Conecte o Cube Baby pelo cabo USB", "busy");
  } catch (err) {
    toast(err.message, true);
  }
}
$("connectBtn").onclick = connect;

// Auto-connect if MIDI permission was granted before.
(async () => {
  try {
    const st = await navigator.permissions.query({ name: "midi", sysex: true });
    if (st.state === "granted") await connect();
  } catch {
    /* permissions API without midi: wait for the button */
  }
})();

// ---------------------------------------------------------------- screen wake lock on stage

let wakeLock = null;
async function updateWakeLock() {
  const onStage = $("view-stage").classList.contains("active") && document.visibilityState === "visible";
  try {
    if (onStage && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    } else if (!onStage && wakeLock) {
      await wakeLock.release();
    }
  } catch {
    /* not critical */
  }
}
document.addEventListener("visibilitychange", updateWakeLock);

// ---------------------------------------------------------------- PWA

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

renderConn();
showView(location.hash.slice(1));
setLoadState(dev.supported ? "Toque em Conectar" : "Este navegador não tem Web MIDI. Use o Chrome.", "busy");
updateWakeLock();
