/** A short, restrained confetti burst in the brand colours on one canvas. About 1 KB; no library. Returns a stop function. */
export function burstConfetti(canvas: HTMLCanvasElement, { count = 90, durationMs = 2400 } = {}): () => void {
  const context = canvas.getContext("2d");
  if (!context) return () => undefined;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth, height = canvas.clientHeight;
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  context.scale(ratio, ratio);
  const colours = ["#a9bcff", "#c9b1ff", "#ffcdb3", "#f3af95", "#ffffff", "#7ea8fa"];
  const originX = width / 2, originY = height * 0.42;
  const pieces = Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
    const speed = 5 + Math.random() * 7.5;
    return { x: originX + (Math.random() - 0.5) * 60, y: originY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size: 4 + Math.random() * 5,
      spin: Math.random() * Math.PI, turn: (Math.random() - 0.5) * 0.3, colour: colours[index % colours.length], round: index % 4 === 0 };
  });
  let frame = 0, started = 0;
  const draw = (time: number) => {
    if (!started) started = time;
    const progress = (time - started) / durationMs;
    context.clearRect(0, 0, width, height);
    if (progress >= 1) return;
    context.globalAlpha = progress < 0.7 ? 1 : 1 - (progress - 0.7) / 0.3;
    for (const piece of pieces) {
      piece.vx *= 0.985; piece.vy = piece.vy * 0.985 + 0.22;
      piece.x += piece.vx; piece.y += piece.vy; piece.spin += piece.turn;
      context.save(); context.translate(piece.x, piece.y); context.rotate(piece.spin); context.fillStyle = piece.colour;
      if (piece.round) { context.beginPath(); context.arc(0, 0, piece.size / 2.4, 0, Math.PI * 2); context.fill(); }
      else context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
      context.restore();
    }
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);
  return () => { cancelAnimationFrame(frame); context.clearRect(0, 0, width, height); };
}
