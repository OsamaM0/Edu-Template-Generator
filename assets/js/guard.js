/* ============================================================================
   guard.js — first line of defence against casual cloning
   ----------------------------------------------------------------------------
   Deliberately a CLASSIC script, not a module: browsers refuse to run module
   scripts from file://, so a module guard would never fire exactly in the
   case we care about most — someone did "Save page as…" and opened the copy
   from disk. A classic script still runs there, sees file:// (or a hostname
   that is not ours), and wipes the saved-out DOM before it can be read.

   Configured by window.EDU_CONFIG.protection (see config.js). Does nothing
   when the block is absent or enabled:false, so old configs keep working.

   Honest scope: this stops "save the HTML / re-host it" copies, not a person
   with devtools. See README → "Content protection".
   ========================================================================== */
(function(){
  "use strict";

  var P = (window.EDU_CONFIG && window.EDU_CONFIG.protection) || null;
  if (!P || !P.enabled) return;

  var LOCAL = ["localhost", "127.0.0.1", "[::1]"];

  function hostAllowed(){
    var h = String(location.hostname).toLowerCase();
    if (P.allowLocalhost !== false && LOCAL.indexOf(h) !== -1) return true;
    var hosts = P.allowedHosts || [];
    if (!hosts.length) return true;             // [] = any web host
    for (var i = 0; i < hosts.length; i++){
      var a = String(hosts[i]).toLowerCase();
      if (h === a) return true;                 // exact
      if (h.length > a.length && h.slice(-(a.length + 1)) === "." + a) return true;  // subdomain
    }
    return false;
  }

  var reason = null;
  if (P.blockFileProtocol !== false && location.protocol === "file:") reason = "file";
  else if (!hostAllowed())                                            reason = "host";
  else if (P.embedOnly && window === window.top)                      reason = "frame";
  if (!reason) return;

  // Tell main.js not to boot, hide everything now, replace the DOM when ready.
  window.__EDU_BLOCKED = reason;
  document.documentElement.style.visibility = "hidden";

  function wipe(){
    var home = P.homeUrl ? String(P.homeUrl) : "";
    var link = "";
    if (home){
      var a = document.createElement("a");
      a.href = home;
      link = '<a href="' + a.href + '" target="_top" style="display:inline-block;margin-top:16px;' +
             'padding:10px 22px;border-radius:999px;background:#4f46e5;color:#fff;' +
             'text-decoration:none;font-weight:700">فتح الورقة من الموقع الرسمي</a>';
    }
    document.body.innerHTML =
      '<div dir="rtl" style="min-height:100vh;display:flex;align-items:center;justify-content:center;' +
      'font-family:Cairo,Tahoma,sans-serif;background:#f8fafc;color:#0f172a;text-align:center;padding:24px">' +
        '<div style="max-width:440px">' +
          '<div style="font-size:44px">🔒</div>' +
          '<h1 style="font-size:22px;margin:12px 0 8px">هذه نسخة غير مصرّح بها</h1>' +
          '<p style="font-size:15px;color:#475569;line-height:1.8;margin:0">' +
            'أوراق العمل تعمل فقط من موقعها الرسمي، ولا يمكن تشغيلها من نسخة محفوظة أو من موقع آخر.' +
          '</p>' + link +
        '</div>' +
      '</div>';
    document.documentElement.style.visibility = "";
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", wipe);
  } else {
    wipe();
  }
})();
