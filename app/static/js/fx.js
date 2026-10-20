/* SecureBank Pro — motion & interaction layer.
   Runs under a strict CSP (no inline scripts/styles), so all dynamic styling goes through the CSSOM. */
(() => {
  "use strict";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(pointer: fine)").matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const body = document.body;

  /* ------------------------------------------------------------ page curtain */
  const curtain = $(".curtain");
  if (!reduce && sessionStorage.getItem("sb-curtain")) {
    sessionStorage.removeItem("sb-curtain");
    $$("span", curtain).forEach((s) => (s.style.transition = "none"));
    body.classList.add("is-leaving");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      $$("span", curtain).forEach((s) => (s.style.transition = ""));
      body.classList.remove("is-leaving");
    }));
  }
  addEventListener("pageshow", (e) => { if (e.persisted) body.classList.remove("is-leaving"); });
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (reduce || !a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.hash && url.pathname === location.pathname) return;
    e.preventDefault();
    sessionStorage.setItem("sb-curtain", "1");
    body.classList.add("is-leaving");
    setTimeout(() => (location.href = url.href), 420);
  });

  /* ------------------------------------------------------------ brass dust particle field */
  const canvas = $("#dust");
  if (canvas && !reduce) {
    const ctx = canvas.getContext("2d");
    const mouse = { x: -9999, y: -9999 };
    let w, h, dpr, parts = [], running = true;
    const resize = () => {
      dpr = Math.min(devicePixelRatio || 1, 2);
      w = canvas.width = innerWidth * dpr; h = canvas.height = innerHeight * dpr;
      canvas.style.width = innerWidth + "px"; canvas.style.height = innerHeight + "px";
      const count = Math.min(110, Math.floor((innerWidth * innerHeight) / 14000));
      parts = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.25 * dpr, vy: (Math.random() - 0.5) * 0.25 * dpr,
        r: (Math.random() * 1.6 + 0.4) * dpr, hue: Math.random() < 0.18 ? "g" : "b",
      }));
    };
    resize();
    addEventListener("resize", resize);
    addEventListener("pointermove", (e) => { mouse.x = e.clientX * dpr; mouse.y = e.clientY * dpr; });
    document.addEventListener("visibilitychange", () => {
      running = !document.hidden; if (running) requestAnimationFrame(tick);
    });
    const link = 120 * (devicePixelRatio || 1);
    function tick() {
      if (!running) return;
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        const dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy, R = 140 * dpr;
        if (d2 < R * R) { const f = (1 - Math.sqrt(d2) / R) * 0.9; p.vx += (dx / R) * f; p.vy += (dy / R) * f; }
        p.vx *= 0.96; p.vy *= 0.96;
        p.vx += (Math.random() - 0.5) * 0.02; p.vy += (Math.random() - 0.5) * 0.02;
        p.x = (p.x + p.vx + w) % w; p.y = (p.y + p.vy + h) % h;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.hue === "g" ? "rgba(59,181,154,.75)" : "rgba(241,216,138,.7)"; ctx.fill();
      }
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          const a = parts[i], b = parts[j], dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy);
          if (d < link) {
            ctx.strokeStyle = `rgba(200,162,74,${(1 - d / link) * 0.22})`;
            ctx.lineWidth = dpr * 0.7; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------ cursor glow, magnetic buttons, ripples */
  const glow = $(".cursor-glow");
  if (glow && finePointer && !reduce) {
    addEventListener("pointermove", (e) => {
      glow.style.setProperty("--mx", e.clientX + "px");
      glow.style.setProperty("--my", e.clientY + "px");
    });
  }
  if (finePointer && !reduce) {
    $$(".magnetic").forEach((el) => {
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--tx", (e.clientX - r.left - r.width / 2) * 0.25 + "px");
        el.style.setProperty("--ty", (e.clientY - r.top - r.height / 2) * 0.35 + "px");
      });
      el.addEventListener("pointerleave", () => { el.style.setProperty("--tx", "0px"); el.style.setProperty("--ty", "0px"); });
    });
  }
  document.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest(".btn");
    if (!btn || reduce) return;
    const r = btn.getBoundingClientRect(), size = Math.max(r.width, r.height);
    const s = document.createElement("span");
    s.className = "ripple";
    Object.assign(s.style, { width: size + "px", height: size + "px", left: e.clientX - r.left - size / 2 + "px", top: e.clientY - r.top - size / 2 + "px" });
    btn.appendChild(s);
    setTimeout(() => s.remove(), 700);
  });

  /* ------------------------------------------------------------ toasts */
  $$(".toast").forEach((t, i) => {
    const close = () => { t.classList.add("is-out"); setTimeout(() => t.remove(), 400); };
    $(".toast-x", t)?.addEventListener("click", close);
    setTimeout(close, 6500 + i * 600);
  });

  /* ------------------------------------------------------------ reveals & staggers */
  $$(".stagger").forEach((list) => [...list.children].forEach((c, i) => c.style.setProperty("--i", i)));
  const reveals = $$(".reveal");
  reveals.forEach((el) => el.style.setProperty("--i", [...el.parentElement.children].indexOf(el) % 3));
  if ("IntersectionObserver" in window && !reduce) {
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); }
    }), { threshold: 0.2 });
    reveals.forEach((el) => io.observe(el));
  } else reveals.forEach((el) => el.classList.add("is-in"));

  /* ------------------------------------------------------------ headline decode effect */
  $$(".scramble").forEach((el) => {
    if (reduce) return;
    const text = el.dataset.text || el.textContent;
    const glyphs = "0123456789#%$&@*SBPRO";
    el.setAttribute("aria-label", text);
    el.textContent = "";
    const chars = [];
    text.split(" ").forEach((word, wi, arr) => {
      const wspan = document.createElement("span");
      wspan.setAttribute("aria-hidden", "true");
      wspan.style.whiteSpace = "nowrap";
      for (const ch of word) {
        const c = document.createElement("span"); c.className = "ch is-noise"; c.textContent = ch;
        wspan.appendChild(c); chars.push({ el: c, ch });
      }
      el.appendChild(wspan);
      if (wi < arr.length - 1) el.appendChild(document.createTextNode(" "));
    });
    const start = performance.now(), per = 28;
    (function frame(now) {
      const settled = Math.floor((now - start) / per);
      chars.forEach((c, i) => {
        if (i < settled) { if (c.el.classList.contains("is-noise")) { c.el.textContent = c.ch; c.el.classList.remove("is-noise"); } }
        else c.el.textContent = glyphs[(Math.random() * glyphs.length) | 0];
      });
      if (settled <= chars.length) requestAnimationFrame(frame);
    })(start);
  });

  /* ------------------------------------------------------------ vault door */
  $$(".vault").forEach((v) => $$(".vault-bolts > g", v).forEach((g, i) => $(".bolt", g).style.setProperty("--i", i)));
  let dialAngle = 0, ringAngle = 0;
  const turn = (v, dial, ring) => {
    dialAngle += dial; ringAngle += ring;
    v.style.setProperty("--dial", dialAngle + "deg");
    $(".vault-ring", v).style.setProperty("--ring", ringAngle + "deg");
  };

  // Hero vault: dial points toward the cursor
  const follow = $("[data-follow] .vault");
  if (follow && finePointer && !reduce) {
    addEventListener("pointermove", (e) => {
      const r = follow.getBoundingClientRect();
      const ang = Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI + 90;
      follow.style.setProperty("--dial", ang + "deg");
    });
    follow.parentElement.addEventListener("click", () => {
      follow.classList.toggle("is-open");
    });
  }

  // Sign-in vault: every keystroke turns the dial; submit spins it before the request goes out
  const vaultForm = $("[data-vault-form]");
  if (vaultForm) {
    const v = $(".auth-vault .vault");
    vaultForm.addEventListener("input", () => turn(v, 25 + Math.random() * 50, -(10 + Math.random() * 30)));
    vaultForm.addEventListener("submit", async (e) => {
      if (reduce || vaultForm.dataset.sent) return;
      e.preventDefault();
      vaultForm.dataset.sent = "1";
      $("button[type=submit]", vaultForm).disabled = true;
      v.classList.add("is-spinning");
      turn(v, 0, 220);
      await sleep(750);
      HTMLFormElement.prototype.submit.call(vaultForm);
    });
  }

  // Post-login intro: bolts retract, door swings, dashboard revealed
  const intro = $("[data-intro]");
  if (intro) {
    if (reduce) intro.remove();
    else {
      const v = $(".vault", intro);
      setTimeout(() => v.classList.add("is-open"), 250);
      setTimeout(() => intro.classList.add("is-done"), 50);
      setTimeout(() => intro.remove(), 2800);
    }
  }

  /* ------------------------------------------------------------ odometer numbers */
  const fmtCents = (c) => {
    c = Math.max(0, Math.round(c));
    return Math.floor(c / 100).toLocaleString("en-US") + "." + String(c % 100).padStart(2, "0");
  };
  function setOdometer(el, text, instant) {
    el.setAttribute("aria-label", text);
    const existing = $$(".digit-strip, .sep", el);
    const sameShape = existing.length === text.length &&
      [...text].every((ch, i) => /\d/.test(ch) === existing[i].classList.contains("digit-strip"));
    if (!sameShape) {
      el.textContent = "";
      for (const ch of text) {
        if (/\d/.test(ch)) {
          const wrap = document.createElement("span"); wrap.className = "digit"; wrap.setAttribute("aria-hidden", "true");
          const strip = document.createElement("span"); strip.className = "digit-strip";
          for (let n = 0; n <= 9; n++) { const s = document.createElement("span"); s.textContent = n; strip.appendChild(s); }
          wrap.appendChild(strip); el.appendChild(wrap);
        } else {
          const s = document.createElement("span"); s.className = "sep"; s.setAttribute("aria-hidden", "true"); s.textContent = ch; el.appendChild(s);
        }
      }
    }
    const strips = $$(".digit-strip", el);
    let k = 0;
    const apply = () => [...text].forEach((ch) => {
      if (!/\d/.test(ch)) return;
      const strip = strips[k++];
      strip.style.transitionDelay = (instant ? 0 : k * 45) + "ms";
      strip.style.transform = `translateY(-${Number(ch)}em)`;
    });
    if (!sameShape && !instant) requestAnimationFrame(() => requestAnimationFrame(apply)); else apply();
  }
  $$("[data-odometer]").forEach((el) => setOdometer(el, fmtCents(Number(el.dataset.odometer)), reduce));
  $$("[data-odometer-int]").forEach((el) => setOdometer(el, Number(el.dataset.odometerInt).toLocaleString("en-US"), reduce));

  /* ------------------------------------------------------------ sparkline */
  const spark = $(".spark[data-history]");
  if (spark) {
    const vals = spark.dataset.history.split(",").map(Number).filter((n) => !Number.isNaN(n));
    if (vals.length > 1) {
      const W = 600, H = 120, pad = 8, min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
      const pts = vals.map((v, i) => [(i / (vals.length - 1)) * W, H - pad - ((v - min) / span) * (H - pad * 2)]);
      const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
      const NS = "http://www.w3.org/2000/svg";
      spark.innerHTML = `<defs><linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#C8A24A" stop-opacity=".35"/><stop offset="1" stop-color="#C8A24A" stop-opacity="0"/></linearGradient></defs>`;
      const area = document.createElementNS(NS, "path"); area.setAttribute("class", "area"); area.setAttribute("d", `${d} L${W} ${H} L0 ${H} Z`);
      const line = document.createElementNS(NS, "path"); line.setAttribute("class", "line"); line.setAttribute("d", d);
      const head = document.createElementNS(NS, "circle"); head.setAttribute("class", "head");
      head.setAttribute("cx", pts.at(-1)[0]); head.setAttribute("cy", pts.at(-1)[1]); head.setAttribute("r", 5);
      spark.append(area, line, head);
      spark.style.setProperty("--len", Math.ceil(line.getTotalLength()));
      setTimeout(() => spark.classList.add("is-drawn"), intro ? 1900 : 250);
    }
  }

  /* ------------------------------------------------------------ 3D tilt cards */
  if (finePointer && !reduce) {
    $$(".tilt").forEach((card) => {
      card.addEventListener("pointermove", (e) => {
        const r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        card.style.setProperty("--ry", (x - 0.5) * 18 + "deg");
        card.style.setProperty("--rx", (0.5 - y) * 14 + "deg");
        card.style.setProperty("--gx", x * 100 + "%");
        card.style.setProperty("--gy", y * 100 + "%");
      });
      card.addEventListener("pointerleave", () => { card.style.setProperty("--rx", "0deg"); card.style.setProperty("--ry", "0deg"); });
    });
  }

  /* ------------------------------------------------------------ copy account number */
  $$("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      const old = b.textContent; b.textContent = "Copied"; b.classList.add("is-done");
      setTimeout(() => { b.textContent = old; b.classList.remove("is-done"); }, 1600);
    } catch { b.textContent = b.dataset.copy; }
  }));

  /* ------------------------------------------------------------ password strength (mirrors server rules) */
  const meter = $("[data-strength]");
  if (meter) {
    const pw = $("input[name=password]"), bars = $$(".strength-bar i", meter);
    const rules = {
      len: (s) => s.length >= 12, lower: (s) => /[a-z]/.test(s), upper: (s) => /[A-Z]/.test(s),
      digit: (s) => /\d/.test(s), symbol: (s) => /[^A-Za-z0-9]/.test(s),
    };
    const colors = ["#E5484D", "#E5484D", "#C8A24A", "#C8A24A", "#3BB59A"];
    pw.addEventListener("input", () => {
      let score = 0;
      for (const [k, fn] of Object.entries(rules)) {
        const ok = fn(pw.value); score += ok;
        $(`[data-rule=${k}]`, meter).classList.toggle("ok", ok);
      }
      bars.forEach((b, i) => {
        const on = i < score;
        if (on && !b.classList.contains("on")) { b.classList.remove("on"); void b.offsetWidth; }
        b.classList.toggle("on", on);
        b.style.setProperty("--sc", colors[Math.max(0, score - 1)]);
      });
    });
  }

  /* ------------------------------------------------------------ transfer: live preview, recipient lookup, hold-to-send */
  const tf = $("[data-transfer]");
  if (tf) {
    const pvFrom = $("[data-pv-from]"), pvTo = $("[data-pv-to]"), pvAmt = $("[data-pv-amount]");
    const toInput = $("[data-to]", tf), amt = $("[data-amount]", tf), result = $("[data-lookup-result]", tf);
    const syncFrom = () => {
      const r = $("input[name=from_account]:checked", tf);
      if (r) pvFrom.textContent = `${r.dataset.kind[0].toUpperCase()}${r.dataset.kind.slice(1)} · ${fmtCents(+r.dataset.balance)}`;
    };
    const syncAmt = () => {
      const raw = amt.value.replace(/,/g, "");
      const ok = /^\d{1,9}(\.\d{1,2})?$/.test(raw);
      setOdometer(pvAmt, fmtCents(ok ? Math.round(parseFloat(raw) * 100) : 0), reduce);
    };
    let timer, ctrl;
    const lookup = () => {
      const v = toInput.value.trim().toUpperCase();
      $(".preview-to")?.classList.remove("is-known");
      result.className = "lookup-result"; result.textContent = "";
      pvTo.textContent = v || "Enter an account number";
      if (!/^SB\d{10}$/.test(v)) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        ctrl?.abort(); ctrl = new AbortController();
        result.textContent = "Checking…";
        try {
          const res = await fetch(`${tf.dataset.lookup}?account=${encodeURIComponent(v)}`, {
            signal: ctrl.signal, headers: { Accept: "application/json" }, credentials: "same-origin",
          });
          const data = await res.json();
          if (res.ok) {
            result.className = "lookup-result is-ok";
            result.textContent = `${data.name} · ${data.kind}${data.own ? " (yours)" : ""}`;
            pvTo.textContent = data.name;
            $(".preview-to")?.classList.add("is-known");
          } else { result.className = "lookup-result is-bad"; result.textContent = data.error; }
        } catch (err) { if (err.name !== "AbortError") result.textContent = ""; }
      }, 300);
    };
    tf.addEventListener("change", syncFrom);
    toInput.addEventListener("input", lookup);
    amt.addEventListener("input", syncAmt);
    syncFrom(); syncAmt(); if (toInput.value) lookup();

    // Hold-to-send: one second of deliberate pressure before money moves
    const hold = $("[data-hold]", tf), label = $(".hold-label", hold);
    let raf = 0, t0 = 0, done = false;
    const setP = (p) => hold.style.setProperty("--hold", p);
    const step = (now) => {
      const p = Math.min(1, (now - t0) / 1000);
      setP(p);
      if (p >= 1) {
        done = true; hold.classList.remove("is-holding"); label.textContent = "Sending…"; hold.disabled = true;
        HTMLFormElement.prototype.submit.call(tf);
        return;
      }
      raf = requestAnimationFrame(step);
    };
    const begin = (e) => {
      if (done) return;
      e.preventDefault(); hold.classList.add("is-holding"); label.textContent = "Keep holding…";
      t0 = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(step);
    };
    const end = () => {
      if (done) return;
      cancelAnimationFrame(raf); hold.classList.remove("is-holding"); setP(0); label.textContent = "Hold to send";
    };
    hold.addEventListener("pointerdown", begin);
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => hold.addEventListener(ev, end));
    hold.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) begin(e); else if (e.repeat) e.preventDefault(); });
    hold.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") end(); });
    tf.addEventListener("submit", (e) => {
      if (done) return;
      e.preventDefault();
      label.textContent = "Press and hold to send";
      hold.animate?.([{ transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "none" }], { duration: 300 });
    });
  }

  /* ------------------------------------------------------------ receipt: coins fly, stamp lands, confetti */
  const receipt = $("[data-receipt]");
  if (receipt) {
    const lane = $(".coin-lane", receipt), to = $(".coin-to", receipt), stamp = $(".stamp", receipt);
    const finish = () => { stamp.classList.add("is-in"); if (!reduce) setTimeout(confetti, 300); };
    if (reduce) finish();
    else {
      const n = 10, w = lane.getBoundingClientRect().width;
      for (let i = 0; i < n; i++) {
        setTimeout(() => {
          const c = document.createElement("span"); c.className = "coin"; c.style.setProperty("--w", w + "px");
          lane.appendChild(c);
          setTimeout(() => { c.remove(); to.classList.remove("is-hit"); void to.offsetWidth; to.classList.add("is-hit"); }, 900);
        }, 200 + i * 110);
      }
      setTimeout(finish, 200 + n * 110 + 800);
    }
  }
  function confetti() {
    const colors = ["#F1D88A", "#C8A24A", "#3BB59A", "#E6ECF3", "#7BE0C6"];
    const bits = Array.from({ length: 90 }, () => {
      const el = document.createElement("div"); el.className = "confetti";
      el.style.background = colors[(Math.random() * colors.length) | 0];
      document.body.appendChild(el);
      return { el, x: innerWidth / 2, y: innerHeight * 0.35, vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 16 - 6,
        r: Math.random() * 360, vr: (Math.random() - 0.5) * 22, life: 0 };
    });
    (function frame() {
      let alive = false;
      for (const b of bits) {
        b.vy += 0.42; b.vx *= 0.985; b.x += b.vx; b.y += b.vy; b.r += b.vr; b.life++;
        b.el.style.transform = `translate(${b.x}px, ${b.y}px) rotate(${b.r}deg) rotateX(${b.r * 2}deg)`;
        b.el.style.opacity = Math.max(0, 1 - b.life / 140);
        if (b.life < 140 && b.y < innerHeight + 40) alive = true; else b.el.remove();
      }
      if (alive) requestAnimationFrame(frame);
    })();
  }

  /* ------------------------------------------------------------ idle sign-out countdown */
  const idle = Number(body.dataset.idle || 0);
  if (idle) {
    const ring = $(".idle-ring"), text = $(".idle-text"), warn = $(".idle-warning"), count = $(".idle-count");
    const C = 94.25, deadline = Date.now() + idle * 1000;
    const tick = () => {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      ring?.style.setProperty("--idle-off", (C * (1 - left / idle)).toFixed(2));
      if (text) text.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
      ring?.classList.toggle("is-low", left <= 60);
      if (warn) { warn.hidden = left > 60; if (count) count.textContent = left; }
      if (left <= 0) { location.reload(); return; }
      setTimeout(tick, 1000);
    };
    tick();
  }
})();
