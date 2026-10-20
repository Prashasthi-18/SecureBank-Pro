/* SecureBank Pro — motion & interaction layer.
   Runs under a strict CSP (no inline scripts/styles), so all dynamic styling goes through the CSSOM. */
(() => {
  "use strict";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(pointer: fine)").matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = document.documentElement;
  const body = document.body;
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
  };

  /* ------------------------------------------------------------ ambient spotlight, scroll progress, sticky header */
  if (finePointer && !reduce) {
    let queued = false, mx = 0, my = 0;
    addEventListener("pointermove", (e) => {
      mx = e.clientX; my = e.clientY;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        root.style.setProperty("--mx", mx + "px");
        root.style.setProperty("--my", my + "px");
        queued = false;
      });
    }, { passive: true });
  }
  const topbar = $(".topbar");
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    root.style.setProperty("--scroll", max > 0 ? (scrollY / max).toFixed(4) : 0);
    topbar?.classList.toggle("is-scrolled", scrollY > 8);
  };
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ------------------------------------------------------------ nav: sliding highlight */
  const nav = $("[data-nav]");
  if (nav) {
    const ink = $(".nav-ink", nav);
    const links = $$("a", nav);
    const active = links.find((a) => a.classList.contains("is-active"));
    const moveTo = (a) => {
      if (!a) { ink.style.setProperty("--ink-o", 0); return; }
      ink.style.setProperty("--ink-x", a.offsetLeft + "px");
      ink.style.setProperty("--ink-w", a.offsetWidth + "px");
      ink.style.setProperty("--ink-o", 1);
    };
    const settle = () => moveTo(active);
    links.forEach((a) => a.addEventListener("pointerenter", () => moveTo(a)));
    nav.addEventListener("pointerleave", settle);
    addEventListener("resize", settle);
    document.fonts?.ready.then(settle);
    if (active && "ResizeObserver" in window) new ResizeObserver(settle).observe(active);
    settle();
  }

  /* ------------------------------------------------------------ magnetic buttons, ripples */
  if (finePointer && !reduce) {
    $$(".magnetic").forEach((el) => {
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--tx", (e.clientX - r.left - r.width / 2) * 0.18 + "px");
        el.style.setProperty("--ty", (e.clientY - r.top - r.height / 2) * 0.28 + "px");
      });
      el.addEventListener("pointerleave", () => { el.style.setProperty("--tx", "0px"); el.style.setProperty("--ty", "0px"); });
    });
  }
  document.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest(".btn, .qa");
    if (!btn || reduce || btn.matches("[data-hold]")) return;
    const r = btn.getBoundingClientRect(), size = Math.max(r.width, r.height);
    const s = document.createElement("span");
    s.className = "ripple";
    Object.assign(s.style, { width: size + "px", height: size + "px", left: e.clientX - r.left - size / 2 + "px", top: e.clientY - r.top - size / 2 + "px" });
    btn.appendChild(s);
    setTimeout(() => s.remove(), 700);
  });

  /* ------------------------------------------------------------ toasts */
  $$(".toast").forEach((t, i) => {
    let timer;
    const close = () => { t.classList.add("is-out"); setTimeout(() => t.remove(), 380); };
    const arm = () => { clearTimeout(timer); timer = setTimeout(close, 6500 + i * 600); };
    $(".toast-x", t)?.addEventListener("click", close);
    t.addEventListener("pointerenter", () => clearTimeout(timer));
    t.addEventListener("pointerleave", arm);
    arm();
  });

  /* ------------------------------------------------------------ headline word reveal */
  $$("[data-words]").forEach((el) => {
    if (reduce) return;
    let i = 0;
    const wrap = (text, cls) => {
      const frag = document.createDocumentFragment();
      text.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
        const w = document.createElement("span");
        w.className = cls ? `w ${cls}` : "w";
        w.textContent = part;
        w.style.setProperty("--i", i++);
        frag.appendChild(w);
      });
      return frag;
    };
    [...el.childNodes].forEach((node) => {
      if (node.nodeType === 3) node.replaceWith(wrap(node.textContent));
      else if (node.nodeType === 1) node.replaceWith(wrap(node.textContent, node.className));
    });
  });

  /* ------------------------------------------------------------ reveals, staggers, count-ups */
  $$(".stagger").forEach((list) => [...list.children].forEach((c, i) => c.style.setProperty("--i", Math.min(i, 12))));
  const reveals = $$(".reveal");
  reveals.forEach((el) => {
    const sibs = [...el.parentElement.children].filter((c) => c.classList.contains("reveal"));
    el.style.setProperty("--i", sibs.indexOf(el) % 4);
  });
  const countUp = (el) => {
    const target = Number(el.dataset.count), t0 = performance.now(), dur = 1400;
    if (reduce || !target) { el.textContent = target.toLocaleString("en-US"); return; }
    (function f(now) {
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 4);
      el.textContent = Math.round(target * e).toLocaleString("en-US");
      if (p < 1) requestAnimationFrame(f);
    })(t0);
  };
  const counters = $$("[data-count]");
  if ("IntersectionObserver" in window && !reduce) {
    counters.forEach((c) => (c.textContent = "0"));
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add("is-in");
      $$("[data-count]", en.target).forEach(countUp);
      io.unobserve(en.target);
    }), { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
    reveals.forEach((el) => io.observe(el));
  } else reveals.forEach((el) => el.classList.add("is-in"));

  /* ------------------------------------------------------------ hero parallax, feature spotlights */
  const stage = $("[data-parallax]");
  if (stage && finePointer && !reduce) {
    $$(".layer", stage).forEach((l) => l.style.setProperty("--d", l.dataset.depth || 0));
    addEventListener("pointermove", (e) => {
      stage.style.setProperty("--px", ((e.clientX / innerWidth) - 0.5) * -40);
      stage.style.setProperty("--py", ((e.clientY / innerHeight) - 0.5) * -30);
    }, { passive: true });
  }
  if (finePointer) {
    $$(".spot-card").forEach((c) => c.addEventListener("pointermove", (e) => {
      const r = c.getBoundingClientRect();
      c.style.setProperty("--sx", e.clientX - r.left + "px");
      c.style.setProperty("--sy", e.clientY - r.top + "px");
    }));
  }

  /* ------------------------------------------------------------ odometer numbers */
  const fmtCents = (c) => {
    const neg = c < 0;
    c = Math.abs(Math.round(c));
    return (neg ? "-" : "") + Math.floor(c / 100).toLocaleString("en-US") + "." + String(c % 100).padStart(2, "0");
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
      strip.style.transitionDelay = (instant ? 0 : k * 40) + "ms";
      strip.style.transform = `translateY(-${Number(ch) * 1.15}em)`;
    });
    if (!sameShape && !instant) requestAnimationFrame(() => requestAnimationFrame(apply)); else apply();
  }
  $$("[data-odometer]").forEach((el) => setOdometer(el, fmtCents(Number(el.dataset.odometer)), reduce));
  $$("[data-odometer-int]").forEach((el) => setOdometer(el, Number(el.dataset.odometerInt).toLocaleString("en-US"), reduce));

  /* ------------------------------------------------------------ dashboard: greeting, intro, chart */
  const greet = $("[data-greet]");
  if (greet) {
    const h = new Date().getHours();
    greet.textContent = h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }
  const intro = $("[data-intro]");
  if (intro) {
    if (reduce) intro.remove();
    else setTimeout(() => intro.remove(), 2400);
  }

  const spark = $(".spark[data-history]");
  if (spark) {
    const vals = spark.dataset.history.split(",").map(Number).filter((n) => !Number.isNaN(n));
    if (vals.length === 1) vals.unshift(vals[0]);
    const delta = $("[data-delta]");
    if (delta && vals.length > 1) {
      const diff = vals.at(-1) - vals[0];
      if (diff !== 0) {
        delta.hidden = false;
        delta.classList.toggle("is-down", diff < 0);
        delta.textContent = `${diff > 0 ? "▲ +" : "▼ "}${fmtCents(diff)} across recent activity`;
      }
    }
    const W = 600, H = 160, pad = 14, min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
    const pts = vals.map((v, i) => [(i / (vals.length - 1)) * W, H - pad - ((v - min) / span) * (H - pad * 2.4)]);
    // Smooth the line with a Catmull-Rom → Bezier conversion, clamped so it never overshoots the real values
    const clampY = (y, a, b) => Math.min(Math.max(a, b), Math.max(Math.min(a, b), y));
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, clampY(p1[1] + (p2[1] - p0[1]) / 6, p1[1], p2[1])];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, clampY(p2[1] - (p3[1] - p1[1]) / 6, p1[1], p2[1])];
      d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    const NS = "http://www.w3.org/2000/svg";
    const mk = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
    const defs = mk("defs", {});
    const fill = mk("linearGradient", { id: "sparkFill", x1: 0, y1: 0, x2: 0, y2: 1 });
    fill.append(mk("stop", { offset: 0, "stop-color": "#7C8CFF", "stop-opacity": ".35" }), mk("stop", { offset: 1, "stop-color": "#7C8CFF", "stop-opacity": "0" }));
    const stroke = mk("linearGradient", { id: "sparkLine", x1: 0, y1: 0, x2: 1, y2: 0 });
    stroke.append(mk("stop", { offset: 0, "stop-color": "#7C8CFF" }), mk("stop", { offset: 1, "stop-color": "#37D3F0" }));
    defs.append(fill, stroke);
    const area = mk("path", { class: "area", d: `${d} L${W} ${H} L0 ${H} Z` });
    const line = mk("path", { class: "line", d });
    const last = pts.at(-1);
    const pulse = mk("circle", { class: "head-pulse", cx: last[0], cy: last[1], r: 5 });
    const head = mk("circle", { class: "head", cx: last[0], cy: last[1], r: 5 });
    const cLine = mk("line", { class: "cursor-line", x1: 0, x2: 0, y1: 0, y2: H });
    const cDot = mk("circle", { class: "cursor-dot", r: 5 });
    spark.append(defs, area, line, cLine, pulse, head, cDot);
    spark.style.setProperty("--len", Math.ceil(line.getTotalLength()) + 10);
    setTimeout(() => spark.classList.add("is-drawn"), intro && !reduce ? 1900 : 200);

    const tip = $("[data-chart-tip]");
    spark.addEventListener("pointermove", (e) => {
      const r = spark.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(pts.length - 1, Math.round((x / W) * (pts.length - 1))));
      const [px, py] = pts[i];
      cLine.setAttribute("x1", px); cLine.setAttribute("x2", px);
      cDot.setAttribute("cx", px); cDot.setAttribute("cy", py);
      spark.classList.add("is-hover");
      if (tip) {
        tip.hidden = false;
        tip.textContent = "";
        const small = document.createElement("small");
        small.textContent = i === pts.length - 1 ? "Now" : `${pts.length - 1 - i} transaction${pts.length - 1 - i === 1 ? "" : "s"} ago`;
        tip.append(small, fmtCents(vals[i]));
        tip.style.setProperty("--tx", (px / W) * r.width + 8);
        tip.style.setProperty("--ty", (py / H) * r.height + 8);
      }
    });
    spark.addEventListener("pointerleave", () => { spark.classList.remove("is-hover"); if (tip) tip.hidden = true; });
  }

  /* ------------------------------------------------------------ 3D tilt cards */
  if (finePointer && !reduce) {
    $$(".tilt").forEach((card) => {
      card.addEventListener("pointermove", (e) => {
        const r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        card.style.setProperty("--ry", (x - 0.5) * 14 + "deg");
        card.style.setProperty("--rx", (0.5 - y) * 12 + "deg");
        card.style.setProperty("--gx", x * 100 + "%");
        card.style.setProperty("--gy", y * 100 + "%");
      });
      card.addEventListener("pointerleave", () => { card.style.setProperty("--rx", "0deg"); card.style.setProperty("--ry", "0deg"); });
    });
  }

  /* ------------------------------------------------------------ onboarding checklist */
  const onboard = $("[data-onboard]");
  const syncOnboard = () => {
    if (!onboard) return;
    if (store.get("sb-copied")) $("[data-step-copy]", onboard)?.classList.add("is-done");
    const steps = $$("[data-step]", onboard), done = steps.filter((s) => s.classList.contains("is-done")).length;
    $("[data-onboard-count]", onboard).textContent = `${done}/${steps.length}`;
    $("[data-onboard-ring]", onboard).style.setProperty("--ring-off", (113.1 * (1 - done / steps.length)).toFixed(1));
  };
  if (onboard) {
    if (store.get("sb-onboard-hidden")) onboard.classList.add("is-hidden");
    $("[data-onboard-hide]", onboard)?.addEventListener("click", () => {
      store.set("sb-onboard-hidden", "1");
      onboard.animate?.([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-8px) scale(.98)" }], { duration: reduce ? 1 : 300, easing: "ease-in" })
        .finished.then(() => onboard.classList.add("is-hidden"));
    });
    setTimeout(syncOnboard, reduce ? 0 : 400);
  }

  /* ------------------------------------------------------------ copy to clipboard */
  $$("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
    const label = $("[data-copy-text]", b) || b;
    const old = label.textContent;
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      label.textContent = b.dataset.copyLabel || "Copied";
    } catch {
      label.textContent = b.dataset.copy;
    }
    b.classList.add("is-done");
    store.set("sb-copied", "1");
    syncOnboard();
    setTimeout(() => { label.textContent = old; b.classList.remove("is-done"); }, 1800);
  }));

  /* ------------------------------------------------------------ guided tour */
  const tourBtn = $("[data-tour-start]");
  if (tourBtn) {
    const stops = $$("[data-tour]");
    let idx = 0, spot, pop, blocker, lastFocus;
    const place = () => {
      const el = stops[idx], r = el.getBoundingClientRect(), pad = 8;
      Object.assign(spot.style, { top: r.top - pad + "px", left: r.left - pad + "px", width: r.width + pad * 2 + "px", height: r.height + pad * 2 + "px" });
      const pw = pop.offsetWidth, ph = pop.offsetHeight;
      let top = r.bottom + 18;
      if (top + ph > innerHeight - 12) top = Math.max(12, r.top - ph - 18);
      const left = Math.min(innerWidth - pw - 16, Math.max(16, r.left + r.width / 2 - pw / 2));
      Object.assign(pop.style, { top: top + "px", left: left + "px" });
    };
    const render = () => {
      const el = stops[idx];
      pop.textContent = "";
      const h = document.createElement("h3"); h.id = "tour-title"; h.textContent = el.dataset.tourTitle;
      const p = document.createElement("p"); p.textContent = el.dataset.tourText;
      const foot = document.createElement("div"); foot.className = "tour-foot";
      const dots = document.createElement("span"); dots.className = "tour-dots";
      stops.forEach((_, i) => { const d = document.createElement("i"); if (i === idx) d.className = "on"; dots.appendChild(d); });
      const mkBtn = (text, cls, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = cls; b.textContent = text; b.addEventListener("click", fn); return b; };
      foot.append(dots);
      if (idx > 0) foot.append(mkBtn("Back", "btn btn-ghost btn-sm", () => go(idx - 1)));
      else foot.append(mkBtn("Skip", "btn btn-ghost btn-sm", end));
      const next = mkBtn(idx === stops.length - 1 ? "Done" : "Next", "btn btn-primary btn-sm", () => (idx === stops.length - 1 ? end() : go(idx + 1)));
      foot.append(next);
      pop.append(h, p, foot);
      next.focus({ preventScroll: true });
    };
    const go = (i) => {
      idx = i;
      stops[idx].scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
      render();
      place();
      setTimeout(place, reduce ? 0 : 450);
    };
    const onKey = (e) => {
      if (e.key === "Escape") end();
      else if (e.key === "ArrowRight" && idx < stops.length - 1) go(idx + 1);
      else if (e.key === "ArrowLeft" && idx > 0) go(idx - 1);
    };
    const end = () => {
      [spot, pop, blocker].forEach((n) => n?.remove());
      removeEventListener("resize", place); removeEventListener("scroll", place); document.removeEventListener("keydown", onKey);
      store.set("sb-toured", "1");
      lastFocus?.focus();
    };
    tourBtn.addEventListener("click", () => {
      if (!stops.length) return;
      lastFocus = document.activeElement;
      blocker = document.createElement("div"); blocker.className = "tour-blocker"; blocker.addEventListener("click", end);
      spot = document.createElement("div"); spot.className = "tour-spot";
      pop = document.createElement("div"); pop.className = "tour-pop";
      pop.setAttribute("role", "dialog"); pop.setAttribute("aria-modal", "true"); pop.setAttribute("aria-labelledby", "tour-title");
      body.append(blocker, spot, pop);
      addEventListener("resize", place); addEventListener("scroll", place, { passive: true }); document.addEventListener("keydown", onKey);
      go(0);
    });
  }

  /* ------------------------------------------------------------ password reveal & caps lock */
  $$("[data-reveal]").forEach((btn) => btn.addEventListener("click", () => {
    const show = btn.getAttribute("aria-pressed") !== "true";
    btn.dataset.reveal.split(" ").forEach((id) => { const f = document.getElementById(id); if (f) f.type = show ? "text" : "password"; });
    btn.setAttribute("aria-pressed", String(show));
    btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    $("use", btn)?.setAttribute("href", show ? "#i-eye-off" : "#i-eye");
  }));
  const caps = $("[data-caps]");
  if (caps) {
    const check = (e) => { if (e.getModifierState) caps.hidden = !e.getModifierState("CapsLock"); };
    $$("input[type=password]").forEach((i) => { i.addEventListener("keyup", check); i.addEventListener("keydown", check); });
  }
  const busy = (form) => form.addEventListener("submit", () => {
    const b = $("[data-submit]", form);
    if (b) b.classList.add("is-loading");
  });

  /* ------------------------------------------------------------ sign in: the lock reacts as you type */
  const login = $("[data-login]");
  if (login) {
    busy(login);
    const scene = $("[data-lock]"), dots = $("[data-lock-dots]"), pw = $("input[name=password]", login);
    let typingTimer;
    login.addEventListener("input", (e) => {
      if (!scene) return;
      scene.classList.remove("is-denied");
      scene.classList.add("is-typing");
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => scene.classList.remove("is-typing"), 180);
      if (e.target === pw && dots) {
        const n = Math.min(pw.value.length, 14);
        while (dots.children.length < n) dots.appendChild(document.createElement("i"));
        while (dots.children.length > n) dots.lastChild.remove();
      }
    });
    login.addEventListener("submit", () => scene?.classList.add("is-open"));
  }

  /* ------------------------------------------------------------ register: live validation, progress, strength */
  const reg = $("[data-register]");
  if (reg) {
    busy(reg);
    const pw = $("input[name=password]", reg), confirm = $("input[name=confirm]", reg);
    const meter = $("[data-strength]", reg), bars = $$(".strength-bar i", meter), word = $("[data-strength-word]", meter);
    const progress = $("[data-progress]", reg), progressText = $("[data-progress-text]", reg);
    const rules = {
      len: (s) => s.length >= 12, lower: (s) => /[a-z]/.test(s), upper: (s) => /[A-Z]/.test(s),
      digit: (s) => /\d/.test(s), symbol: (s) => /[^A-Za-z0-9]/.test(s),
    };
    const colors = ["#FF5C7A", "#FF5C7A", "#FFB547", "#FFB547", "#2BD49A"];
    const words = ["Too weak", "Weak", "Getting there", "Almost there", "Strong password"];
    const strength = () => {
      let score = 0;
      for (const [k, fn] of Object.entries(rules)) {
        const ok = fn(pw.value); score += ok;
        $(`[data-rule=${k}]`, meter).classList.toggle("ok", ok);
      }
      bars.forEach((b, i) => { b.classList.toggle("on", i < score); b.style.setProperty("--sc", colors[Math.max(0, score - 1)]); });
      word.textContent = pw.value ? words[Math.max(0, score - 1)] : "Use at least 12 characters";
      return score;
    };
    const update = () => {
      let done = 0;
      $$("[data-field]", reg).forEach((f) => {
        const input = $("input", f);
        let ok;
        if (input === pw) ok = strength() === 5;
        else if (input === confirm) ok = !!confirm.value && confirm.value === pw.value;
        else if (input.dataset.pattern) ok = new RegExp(input.dataset.pattern).test(input.value.trim());
        else ok = !!input.value.trim();
        f.classList.toggle("is-valid", ok);
        done += ok;
      });
      progress.style.setProperty("--p", done / 5);
      progressText.textContent = done === 5 ? "Ready to go!" : `${done} of 5 done`;
    };
    reg.addEventListener("input", update);
    update();
  }

  /* ------------------------------------------------------------ transfer: live review, lookup, quick fills, hold-to-send */
  const tf = $("[data-transfer]");
  if (tf) {
    const review = $(".review");
    const pvFrom = $("[data-pv-from]"), pvTo = $("[data-pv-to]"), pvAmt = $("[data-pv-amount]"), pvMemo = $("[data-pv-memo]");
    const pvAfter = $("[data-pv-after]"), pvStatus = $("[data-pv-status]"), pvToCard = $("[data-pv-to-card]");
    const toInput = $("[data-to]", tf), amt = $("[data-amount]", tf), memo = $("[data-memo]", tf), result = $("[data-lookup-result]", tf);
    const memoCount = $("[data-memo-count]", tf), amountHint = $("[data-amount-hint]", tf);
    const hold = $("[data-hold]", tf), label = $(".hold-label", hold);
    const defaultHint = amountHint.textContent;
    let known = false;

    const source = () => $("input[name=from_account]:checked", tf);
    const cents = () => {
      const raw = amt.value.replace(/,/g, "").trim();
      return /^\d{1,9}(\.\d{1,2})?$/.test(raw) ? Math.round(parseFloat(raw) * 100) : 0;
    };
    const refresh = () => {
      const r = source(), c = cents();
      if (r) pvFrom.textContent = `${r.dataset.kind[0].toUpperCase()}${r.dataset.kind.slice(1)} · ${fmtCents(+r.dataset.balance)}`;
      setOdometer(pvAmt, fmtCents(c), reduce);
      pvMemo.textContent = memo.value.trim() || "None";
      memoCount.textContent = `${memo.value.length}/80`;
      const left = r ? +r.dataset.balance - c : 0;
      pvAfter.textContent = r && c ? fmtCents(left) : "—";
      const over = r && c > +r.dataset.balance;
      amountHint.classList.toggle("is-warn", !!over);
      amountHint.textContent = over ? `That's more than the ${fmtCents(+r.dataset.balance)} in ${r.dataset.kind}.` : defaultHint;
      $("[data-tstep=from]", tf).classList.toggle("is-complete", !!r);
      $("[data-tstep=to]", tf).classList.toggle("is-complete", known);
      $("[data-tstep=amount]", tf).classList.toggle("is-complete", c > 0 && !over);
      const ready = !!r && known && c > 0 && !over;
      review.classList.toggle("is-ready", ready);
      pvStatus.textContent = ready ? "Ready. Hold the button to send." : !known ? "Add a recipient to continue" : !c ? "Enter an amount" : over ? "Amount is above your balance" : "Fill in the steps to continue";
      if (!hold.classList.contains("is-holding") && !hold.disabled) label.textContent = c ? `Hold to send ${fmtCents(c)}` : "Hold to send";
    };

    let timer, ctrl;
    const lookup = () => {
      const v = toInput.value.trim().toUpperCase();
      known = false;
      pvToCard.classList.remove("is-known");
      result.className = "lookup-result"; result.textContent = "";
      pvTo.textContent = v || "Enter an account number";
      $$("[data-fill]", tf).forEach((b) => b.classList.toggle("is-on", b.dataset.fill === v));
      refresh();
      clearTimeout(timer);
      if (!/^SB\d{10}$/.test(v)) {
        if (v.length >= 12) { result.className = "lookup-result is-bad"; result.textContent = "Account numbers look like SB0123456789."; }
        return;
      }
      timer = setTimeout(async () => {
        ctrl?.abort(); ctrl = new AbortController();
        result.className = "lookup-result is-busy"; result.textContent = "Checking…";
        try {
          const res = await fetch(`${tf.dataset.lookup}?account=${encodeURIComponent(v)}`, {
            signal: ctrl.signal, headers: { Accept: "application/json" }, credentials: "same-origin",
          });
          const data = await res.json();
          if (res.ok) {
            const same = source()?.dataset.number === v;
            if (same) {
              result.className = "lookup-result is-bad";
              result.textContent = "That's the account you're sending from. Pick a different one.";
            } else {
              known = true;
              result.className = "lookup-result is-ok";
              result.textContent = `${data.name} · ${data.kind}${data.own ? " (yours)" : ""}`;
              pvTo.textContent = data.own ? `Your ${data.kind}` : data.name;
              pvToCard.classList.add("is-known");
            }
          } else { result.className = "lookup-result is-bad"; result.textContent = data.error; }
        } catch (err) { if (err.name !== "AbortError") { result.className = "lookup-result"; result.textContent = ""; } }
        refresh();
      }, 300);
    };

    // "My savings" / "My checking": fill the number and make sure we're not sending to the same account
    $$("[data-fill]", tf).forEach((b) => b.addEventListener("click", () => {
      const r = source();
      if (r && r.dataset.number === b.dataset.fill) {
        const other = $$("input[name=from_account]", tf).find((x) => x.dataset.number !== b.dataset.fill);
        if (other) other.checked = true;
      }
      toInput.value = b.dataset.fill;
      b.classList.remove("is-pop"); void b.offsetWidth; b.classList.add("is-pop");
      lookup();
      amt.focus();
    }));
    $$("[data-amount-set]", tf).forEach((b) => b.addEventListener("click", () => {
      amt.value = b.dataset.amountSet;
      $$("[data-amount-set]", tf).forEach((x) => x.classList.toggle("is-on", x === b));
      b.classList.remove("is-pop"); void b.offsetWidth; b.classList.add("is-pop");
      refresh();
    }));
    tf.addEventListener("change", (e) => { if (e.target.name === "from_account") lookup(); });
    toInput.addEventListener("input", lookup);
    amt.addEventListener("input", () => { $$("[data-amount-set]", tf).forEach((x) => x.classList.toggle("is-on", x.dataset.amountSet === amt.value)); refresh(); });
    memo.addEventListener("input", refresh);
    // If we arrived with ?to= pointing at the default source account, switch source first
    if (toInput.value) {
      const v = toInput.value.trim().toUpperCase(), r = source();
      if (r && r.dataset.number === v) {
        const other = $$("input[name=from_account]", tf).find((x) => x.dataset.number !== v);
        if (other) other.checked = true;
      }
      lookup();
    } else refresh();

    // Hold-to-send: one second of deliberate pressure before money moves
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
      if (done || !hold.classList.contains("is-holding")) return;
      cancelAnimationFrame(raf); hold.classList.remove("is-holding"); setP(0); refresh();
    };
    hold.addEventListener("pointerdown", begin);
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => hold.addEventListener(ev, end));
    hold.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) begin(e); else if (e.repeat) e.preventDefault(); });
    hold.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") end(); });
    tf.addEventListener("submit", (e) => {
      if (done) return;
      e.preventDefault();
      label.textContent = "Press and hold to send";
      hold.animate?.([{ transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(-3px)" }, { transform: "none" }], { duration: 320 });
    });
  }

  /* ------------------------------------------------------------ receipt: check draws, coins fly, confetti */
  const receipt = $("[data-receipt]");
  if (receipt) {
    const lane = $(".coin-lane", receipt), to = $(".coin-to", receipt);
    receipt.classList.add("is-done");
    if (!reduce && lane) {
      const n = 8, w = lane.getBoundingClientRect().width;
      for (let i = 0; i < n; i++) {
        setTimeout(() => {
          const c = document.createElement("span"); c.className = "coin"; c.style.setProperty("--w", w + "px");
          lane.appendChild(c);
          setTimeout(() => { c.remove(); to.classList.remove("is-hit"); void to.offsetWidth; to.classList.add("is-hit"); }, 900);
        }, 500 + i * 110);
      }
      setTimeout(confetti, 900);
    }
    $("[data-print]", receipt)?.addEventListener("click", () => print());
  }
  function confetti() {
    const colors = ["#7C8CFF", "#A78BFA", "#37D3F0", "#2BD49A", "#EDF0F7", "#FFB547"];
    const ox = innerWidth / 2, oy = innerHeight * 0.28;
    const bits = Array.from({ length: 110 }, () => {
      const el = document.createElement("div"); el.className = "confetti";
      el.style.setProperty("--c", colors[(Math.random() * colors.length) | 0]);
      if (Math.random() < 0.3) { el.style.width = "6px"; el.style.height = "6px"; el.style.borderRadius = "50%"; }
      body.appendChild(el);
      const a = Math.random() * Math.PI * 2, v = Math.random() * 13 + 5;
      return { el, x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 7, r: Math.random() * 360, vr: (Math.random() - 0.5) * 24, life: 0 };
    });
    (function frame() {
      let alive = false;
      for (const b of bits) {
        if (!b.el.isConnected) continue;
        b.vy += 0.38; b.vx *= 0.986; b.vy *= 0.99; b.x += b.vx; b.y += b.vy; b.r += b.vr; b.life++;
        b.el.style.transform = `translate(${b.x}px, ${b.y}px) rotate(${b.r}deg) rotateX(${b.r * 2}deg)`;
        b.el.style.opacity = Math.max(0, 1 - b.life / 150);
        if (b.life < 150 && b.y < innerHeight + 40) alive = true; else b.el.remove();
      }
      if (alive) requestAnimationFrame(frame);
    })();
  }

  /* ------------------------------------------------------------ activity filters, admin table filter */
  const filters = $("[data-filters]");
  if (filters) {
    const rows = $$("[data-tx-list] > .tx"), empty = $("[data-filter-empty]");
    filters.addEventListener("click", (e) => {
      const b = e.target.closest("[data-filter]");
      if (!b) return;
      $$("[data-filter]", filters).forEach((x) => { x.classList.toggle("is-on", x === b); x.setAttribute("aria-pressed", String(x === b)); });
      let shown = 0;
      rows.forEach((r) => { const ok = b.dataset.filter === "all" || r.classList.contains(b.dataset.filter); r.classList.toggle("is-filtered", !ok); shown += ok; });
      if (empty) empty.hidden = shown > 0;
    });
  }
  $$("[data-table-filter]").forEach((input) => {
    const rows = $$(`${input.dataset.tableFilter} tbody tr`);
    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      rows.forEach((r) => r.classList.toggle("is-filtered", !!q && !r.textContent.toLowerCase().includes(q)));
    });
  });

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
