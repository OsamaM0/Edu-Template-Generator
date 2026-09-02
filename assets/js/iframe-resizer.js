/* ============================================================================
   iframe-resizer.js — drop this on the HOST page (not inside the worksheet)
   ----------------------------------------------------------------------------
   Auto-grows any <iframe data-edu-worksheet> to the worksheet's real height,
   so the embed never gets its own scrollbar.

     <iframe data-edu-worksheet
             src="https://worksheets.example.com/embed.html?lesson=science-g1-plant-parts"
             style="width:100%;border:0" title="ورقة عمل"></iframe>
     <script src="https://worksheets.example.com/assets/js/iframe-resizer.js"></script>

   Plain script — no module, no dependencies, works on any page.
   ========================================================================== */
(function(){
  "use strict";

  var SELECTOR = "iframe[data-edu-worksheet]";
  var MIN_HEIGHT = 400;

  window.addEventListener("message", function(ev){
    var msg = ev.data;
    if (!msg || msg.source !== "edu-worksheet") return;

    // Find the iframe this message came from.
    var frames = document.querySelectorAll(SELECTOR);
    for (var i = 0; i < frames.length; i++){
      if (frames[i].contentWindow !== ev.source) continue;

      if (msg.type === "height" && typeof msg.height === "number"){
        frames[i].style.height = Math.max(MIN_HEIGHT, msg.height) + "px";
      }
      if (msg.type === "ready"){
        frames[i].setAttribute("data-edu-ready", "1");
        frames[i].dispatchEvent(new CustomEvent("edu:ready", { detail: msg, bubbles: true }));
      }
      if (msg.type === "error"){
        frames[i].setAttribute("data-edu-error", msg.code || "1");
        frames[i].dispatchEvent(new CustomEvent("edu:error", { detail: msg, bubbles: true }));
      }
      return;
    }
  });

  function hello(frame){
    try { frame.contentWindow.postMessage({ source: "edu-host", type: "hello" }, "*"); }
    catch (e){ /* frame not ready yet — its load handler will ping again */ }
  }

  function init(){
    var frames = document.querySelectorAll(SELECTOR);
    for (var i = 0; i < frames.length; i++){
      var f = frames[i];
      if (!f.style.height) f.style.height = MIN_HEIGHT + "px";   // before first message
      f.setAttribute("scrolling", "no");
      // The worksheet may have finished loading before this script ran, so ask
      // it to re-announce itself. Order of script vs. iframe no longer matters.
      f.addEventListener("load", hello.bind(null, f));
      hello(f);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
