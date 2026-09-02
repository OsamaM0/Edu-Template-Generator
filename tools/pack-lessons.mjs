/* ============================================================================
   tools/pack-lessons.mjs — encrypt lesson JSON into .wsx containers
   ----------------------------------------------------------------------------
   Usage (Node ≥ 18):
       node tools/pack-lessons.mjs

   Reads every data/lessons/*.json (files starting with "_" are skipped, they
   are templates for authors), writes data/lessons/<id>.wsx next to it using
   the same pack.js the browser decrypts with — one seed, one place.

   Deploy checklist:
     1. run this script
     2. set  protection.packedLessons: true  in config.js
     3. upload the .wsx files but NOT the plain .json files
   Keep the .json files locally / in git — they are the editable source.
   ========================================================================== */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { pack } from "../assets/js/pack.js";

const dir = new URL("../data/lessons/", import.meta.url);
const names = (await readdir(dir)).filter(n => n.endsWith(".json") && !n.startsWith("_"));

if (!names.length){
  console.log("No lesson JSON files found in data/lessons/ — nothing to pack.");
  process.exit(0);
}

for (const name of names){
  const obj = JSON.parse(await readFile(new URL(name, dir), "utf8"));
  const bytes = await pack(obj);
  const out = name.replace(/\.json$/, ".wsx");
  await writeFile(new URL(out, dir), bytes);
  console.log(`packed  ${name}  ->  ${out}  (${bytes.length} bytes)`);
}

console.log(`\n${names.length} lesson(s) packed.`);
console.log("Reminder: deploy the .wsx files WITHOUT the plain .json files,");
console.log("and set protection.packedLessons: true in config.js.");
