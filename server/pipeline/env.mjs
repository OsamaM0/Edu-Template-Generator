/* ============================================================================
   env.mjs — read .env into process.env, if there is one
   ----------------------------------------------------------------------------
   Secrets belong in the environment, and the environment has to come from
   somewhere. Docker gets it from compose; a developer running `npm start`
   gets it from a .env file next to package.json.

   Deliberately small and boring:
     · a real environment variable always wins — .env never overwrites what the
       shell, compose, or systemd already set
     · KEY=value, `export KEY=value`, # comments, blank lines
     · quotes are stripped; \n inside double quotes becomes a newline
     · a missing file is not an error — production has no .env

   Imported first by config.mjs, which is itself imported before server.mjs runs
   its own top-level `process.env` reads, so the core's EDU_* settings see these
   values too.
   ========================================================================== */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function parse(text){
  const out = {};

  for (const raw of text.split(/\r?\n/)){
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq < 1) continue;

    const key = line.slice(0, eq).replace(/^export\s+/, "").trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(eq + 1).trim();

    if (value.startsWith('"') && value.endsWith('"') && value.length > 1){
      value = value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
    } else if (value.startsWith("'") && value.endsWith("'") && value.length > 1){
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();   // trailing comment
    }

    out[key] = value;
  }
  return out;
}

/** @returns {string[]} the names it set, so a caller can log what was loaded. */
export function loadEnv(file){
  const target = file || process.env.EDU_ENV_FILE || path.join(ROOT, ".env");

  let text;
  try { text = readFileSync(target, "utf8"); }
  catch { return []; }

  const applied = [];
  for (const [key, value] of Object.entries(parse(text))){
    if (process.env[key] === undefined){ process.env[key] = value; applied.push(key); }
  }
  return applied;
}

export const loaded = loadEnv();
