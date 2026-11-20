/* AI Lab shared helpers. Plain JavaScript, no libraries. */
(function () {
  const AI = (window.AI = {});
  AI.$ = (s, r = document) => r.querySelector(s);
  AI.$$ = (s, r = document) => [...r.querySelectorAll(s)];
  AI.css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  AI.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  AI.lerp = (a, b, t) => a + (b - a) * t;
  AI.fmt = (v, d = 3) => (isFinite(v) ? v.toFixed(d) : '–');

  // ---- theme (shares the portfolio's "theme" key) ----
  const themeCbs = [];
  AI.onTheme = fn => themeCbs.push(fn);
  let theme = 'dark';
  try { theme = localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); } catch (e) {}
  document.documentElement.setAttribute('data-theme', theme);
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('themeBtn');
    const paint = () => { if (btn) btn.textContent = theme === 'dark' ? '☀' : '☾'; };
    paint();
    if (btn) btn.addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('theme', theme); } catch (e) {}
      document.documentElement.setAttribute('data-theme', theme);
      paint();
      themeCbs.forEach(f => f(theme));
    });
  });

  // ---- hi-dpi canvas that redraws on resize ----
  AI.fit = function (canvas, draw) {
    const ctx = canvas.getContext('2d');
    const go = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
      if (canvas._w === w && canvas._h === h && canvas._dpr === dpr) return;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      canvas._w = w; canvas._h = h; canvas._dpr = dpr;
      if (draw) draw();
    };
    new ResizeObserver(go).observe(canvas);
    go();
    return ctx;
  };

  // ---- random + datasets (2-D, coordinates roughly in [-1, 1]) ----
  AI.gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  AI.shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const g = AI.gauss;
  AI.datasets = {
    circles(n, noise) { const o = []; for (let i = 0; i < n; i++) { const l = i % 2, r = (l ? 0.35 : 0.8) + g() * noise * 0.6, t = Math.random() * 6.2832; o.push({ x: r * Math.cos(t), y: r * Math.sin(t), l }); } return o; },
    xor(n, noise) { const o = []; for (let i = 0; i < n; i++) { const x = Math.random() * 2 - 1, y = Math.random() * 2 - 1; o.push({ x: x + g() * noise * 0.4, y: y + g() * noise * 0.4, l: x * y > 0 ? 1 : 0 }); } return o; },
    spiral(n, noise) { const o = []; for (let i = 0; i < n; i++) { const l = i % 2, k = Math.random(), r = 0.1 + 0.85 * k, t = k * 3.6 + l * Math.PI; o.push({ x: r * Math.cos(t) + g() * noise * 0.3, y: r * Math.sin(t) + g() * noise * 0.3, l }); } return o; },
    moons(n, noise) { const o = []; for (let i = 0; i < n; i++) { const l = i % 2, t = Math.random() * Math.PI; const x = l ? 1 - Math.cos(t) : Math.cos(t), y = l ? 0.5 - Math.sin(t) : Math.sin(t); o.push({ x: (x - 0.5) * 0.62 + g() * noise * 0.4, y: (y - 0.25) * 0.85 + g() * noise * 0.4, l }); } return o; },
    gauss(n, noise) { const o = []; for (let i = 0; i < n; i++) { const l = i % 2, s = 0.18 + noise; o.push({ x: (l ? 0.45 : -0.45) + g() * s, y: (l ? 0.4 : -0.4) + g() * s, l }); } return o; },
  };

  // ---- simple multi-series line chart ----
  AI.lineChart = function (canvas, series, o = {}) {
    const ctx = canvas.getContext('2d'), w = canvas._w, h = canvas._h;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 38, r: 10, t: 10, b: 20 }, muted = AI.css('--muted'), line = AI.css('--line2');
    let min = Infinity, max = -Infinity, n = 0;
    series.forEach(s => { n = Math.max(n, s.data.length); s.data.forEach(v => { if (isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); } }); });
    if (o.min != null) min = o.min; if (o.max != null) max = o.max;
    ctx.font = '11px ui-monospace,Consolas,monospace'; ctx.fillStyle = muted; ctx.strokeStyle = line; ctx.lineWidth = 1;
    if (!isFinite(min) || n < 2) { ctx.fillText(o.empty || 'waiting for data…', pad.l, h / 2); return; }
    if (max - min < 1e-9) max = min + 1;
    const X = i => pad.l + (i / (n - 1)) * (w - pad.l - pad.r), Y = v => pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b);
    for (let k = 0; k <= 3; k++) { const v = min + ((max - min) * k) / 3, y = Y(v); ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke(); ctx.globalAlpha = 1; ctx.fillText(o.pct ? (v * 100).toFixed(0) + '%' : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2), 2, y + 4); }
    ctx.fillText(o.xlabel || '', w - pad.r - ctx.measureText(o.xlabel || '').width, h - 5);
    series.forEach(s => {
      ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
      let started = false;
      s.data.forEach((v, i) => { if (!isFinite(v)) return; const x = X(i), y = Y(v); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); });
      ctx.stroke();
    });
    let lx = pad.l + 6;
    series.forEach(s => { if (!s.label) return; ctx.fillStyle = s.color; ctx.fillRect(lx, 12, 10, 3); ctx.fillStyle = muted; ctx.fillText(s.label, lx + 14, 16); lx += ctx.measureText(s.label).width + 30; });
  };

  AI.hex2rgb = h => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  AI.palette = ['#8b5cf6', '#22d3ee', '#f59e0b', '#34d399', '#fb7185', '#60a5fa', '#e879f9', '#a3e635'];
})();
