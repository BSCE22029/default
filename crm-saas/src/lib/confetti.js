const COLORS = ['#6366f1','#22c55e','#f59e0b','#ec4899','#0ea5e9','#8b5cf6','#fbbf24','#f97316'];

export function burst(options = {}) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999';
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const cx = options.x ?? canvas.width  / 2;
  const cy = options.y ?? canvas.height / 3;

  const ps = Array.from({ length: options.count ?? 160 }, () => ({
    x: cx, y: cy,
    vx: (Math.random() - .5) * 22,
    vy: Math.random() * -18 - 2,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    w: Math.random() * 12 + 5,
    h: Math.random() * 7  + 3,
    rot: Math.random() * 360,
    rv: (Math.random() - .5) * 14,
    life: 1,
    decay: .010 + Math.random() * .009,
  }));

  let id;
  function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let any = false;
    for (const p of ps) {
      p.x += p.vx; p.y += p.vy; p.vy += .6;
      p.rot += p.rv; p.life -= p.decay;
      if (p.life <= 0) continue;
      any = true;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle   = p.color;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (any) id = requestAnimationFrame(frame);
    else canvas.remove();
  }
  id = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(id); canvas.remove(); };
}
