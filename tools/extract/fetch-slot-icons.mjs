// Descarga los iconos de ranura vacía de la ventana de personaje (Interface/PaperDoll/UI-PaperDoll-Slot-*) a apps/web/public/slots/<ranura>.png.
//
// Salen del cliente del juego (SOLO LECTURA) a traves de wow.tools.local, que debe estar arrancado en modo local (ver docs/EXTRACTION.md):
// GET /casc/blp2png?filedataid=N devuelve el PNG. Esta herramienta nunca escribe en el cliente; solo hace peticiones HTTP a localhost
// y escribe en este repo. Los FileDataID salen del listfile de la herramienta (ruta Interface/PaperDoll/UI-PaperDoll-Slot-*.blp).
//
// Uso: node tools/extract/fetch-slot-icons.mjs [--force]
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = join(root, "apps", "web", "public", "slots");
const force = process.argv.includes("--force");
const base = process.env.WTL_URL ?? "http://localhost:5000";

// Ranura de la calculadora -> FileDataID de su textura. La espalda usa la del pecho (como el juego), y los dos anillos y abalorios, la misma.
const SLOT_FILE = {
  head: 136516,
  neck: 136519,
  shoulder: 136526,
  back: 136512,
  chest: 136512,
  shirt: 136525,
  tabard: 136527,
  wrist: 136530,
  hands: 136515,
  waist: 136529,
  legs: 136517,
  feet: 136513,
  finger1: 136514,
  finger2: 136514,
  trinket1: 136528,
  trinket2: 136528,
  mainHand: 136518,
  offHand: 136524,
  ranged: 136520,
};

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
mkdirSync(outDir, { recursive: true });

let ok = 0;
const failed = [];
for (const [slot, id] of Object.entries(SLOT_FILE)) {
  const file = join(outDir, `${slot}.png`);
  if (!force && existsSync(file)) continue;
  try {
    const res = await fetch(`${base}/casc/blp2png?filedataid=${id}`, { signal: AbortSignal.timeout(60000) });
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok || buf.length < 100 || !buf.subarray(0, 4).equals(PNG)) throw new Error(`respuesta no valida (${res.status}, ${buf.length} B)`);
    writeFileSync(file, buf);
    ok++;
  } catch (e) {
    failed.push([slot, e instanceof Error ? e.message : String(e)]);
  }
}

console.log(`Descargados: ${ok}. Fallidos: ${failed.length}.`);
for (const [slot, why] of failed) console.log(`  ${slot}: ${why}`);
process.exit(failed.length ? 2 : 0);
