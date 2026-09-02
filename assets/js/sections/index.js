/* ============================================================================
   sections/index.js — the section registry
   ----------------------------------------------------------------------------
   ADDING A NEW SECTION TYPE — the whole contract:
     1. create sections/my-type.js exporting
          type    "my-type"                         (the JSON "type" value)
          render  (sec) => html                     (required)
          wire    (cardEl) => {onResize?} | void    (optional, interactivity)
          reset   (cardEl) => void                  (optional, toolbar reset)
     2. import it below and add it to REGISTRY.
   Nothing else in the codebase changes.
   ========================================================================== */
import * as choose         from "./choose.js";
import * as fillBlank      from "./fill-blank.js";
import * as matching       from "./matching.js";
import * as classify       from "./classify.js";
import * as drawing        from "./drawing.js";
import * as homework       from "./homework.js";
import * as selfAssessment from "./self-assessment.js";
import * as signatures     from "./signatures.js";
import * as note           from "./note.js";
import * as question       from "./question.js";

const MODULES = [choose, fillBlank, matching, classify, drawing, homework, selfAssessment, signatures, note, question];

const REGISTRY = Object.fromEntries(MODULES.map(m => [m.type, m]));

/** Unknown types fall back to the generic note card. */
export const forType = t => REGISTRY[t] || note;

export const knownTypes = () => Object.keys(REGISTRY);
