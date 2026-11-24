// Preset library, kept on the phone (localStorage) with JSON export/import.
import { DEFAULT_PRESETS, SLOT_NAMES, sanitizePreset } from "./params.js";

const KEY = "cubebaby.library.v1";

const uid = () => Math.random().toString(36).slice(2, 10);

export function newBank(name, presets = DEFAULT_PRESETS, names) {
  return {
    id: uid(),
    name,
    presets: presets.map((bytes, i) => ({ name: names?.[i] ?? `Preset ${SLOT_NAMES[i]}`, bytes: sanitizePreset(bytes) })),
  };
}

function defaultLibrary() {
  return { version: 1, current: 0, banks: [newBank("Banco 1")], fromPedal: false };
}

export function validate(lib) {
  const ok =
    lib && lib.version === 1 && Array.isArray(lib.banks) && lib.banks.length > 0 &&
    lib.banks.every(
      (b) => typeof b.name === "string" && Array.isArray(b.presets) && b.presets.length === 3 &&
        b.presets.every(
          (p) => typeof p.name === "string" && Array.isArray(p.bytes) && p.bytes.length === 16 &&
            p.bytes.every((x) => Number.isInteger(x) && x >= 0 && x <= 255),
        ),
    );
  if (!ok) throw new Error("arquivo de biblioteca inválido");
  lib.banks.forEach((b) => {
    b.id ||= uid();
    b.presets.forEach((p) => (p.bytes = sanitizePreset(p.bytes))); // clamp out-of-range values
  });
  lib.current = Math.min(Math.max(0, lib.current | 0), lib.banks.length - 1);
  return lib;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return validate(JSON.parse(raw));
  } catch (err) {
    console.warn("biblioteca ilegível, usando padrão", err);
  }
  return defaultLibrary();
}

let timer = null;
export function save(lib, immediate = false) {
  clearTimeout(timer);
  const write = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(lib));
    } catch (err) {
      console.error("falha ao salvar biblioteca", err);
    }
  };
  if (immediate) write();
  else timer = setTimeout(write, 300);
}

export function clear() {
  clearTimeout(timer);
  localStorage.removeItem(KEY);
}

export function exportFile(lib) {
  const blob = new Blob([JSON.stringify(lib, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cubebaby-bancos-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function importFile(file) {
  return validate(JSON.parse(await file.text()));
}

// Ask the browser not to evict our storage.
navigator.storage?.persist?.().catch(() => {});
