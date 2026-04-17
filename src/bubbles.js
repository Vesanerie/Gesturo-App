// Welcome bubbles canvas animation. Self-contained IIFE.
// ══ BULLES ══
(function() {
  const canvas = document.getElementById('bubbles-canvas')
  const ctx = canvas.getContext('2d')
  let bubbles = [], welcomeDone = false
  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight }
  function createBubble(welcome = false) {
    const r = welcome ? Math.random() * 80 + 5 : Math.random() * 14 + 2
    return { x: Math.random() * canvas.width, y: canvas.height + r + Math.random() * (welcome ? 600 : 20), r, speed: welcome ? Math.random() * 12 + 6 : Math.random() * 0.4 + 0.08, splitStartY: canvas.height * (0.25 + Math.random() * 0.35), splitSpeed: (Math.random() * 4 + 1) * (Math.random() < 0.5 ? -1 : 1), opacity: welcome ? Math.random() * 0.25 + 0.08 : Math.random() * 0.15 + 0.04, welcome }
  }
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    // En mode Jour le fond est clair → les bulles bleues très transparentes
    // sont invisibles. On utilise un bleu plus saturé/foncé + opacity boostée
    // pour qu'elles restent "eau bleue" logique.
    const light = document.body.classList.contains('theme-light')
    const stroke = light ? '30,95,220' : '41,131,235'
    const highlight = light ? '80,140,230' : '180,220,255'
    const opMult = light ? 2.2 : 1  // plus visible en jour
    bubbles.forEach(b => {
      const op = Math.min(1, b.opacity * opMult)
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(${stroke},${op})`; ctx.lineWidth = b.welcome ? Math.max(0.5, b.r * 0.04) : 0.3; ctx.stroke()
      ctx.beginPath(); ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.22, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${highlight},${op * 0.5})`; ctx.fill()
    })
  }
  function update() {
    bubbles.forEach(b => { b.y -= b.speed; if (b.welcome && b.y < b.splitStartY) { b.x += b.splitSpeed; b.speed *= 0.97; b.opacity *= 0.97 } })
    bubbles = bubbles.filter(b => b.y + b.r > 0 && b.opacity > 0.008 && b.x > -200 && b.x < canvas.width + 200)
    if (!welcomeDone) return
    if (Math.random() < 0.04) bubbles.push(createBubble())
    if (bubbles.length < 18) bubbles.push(createBubble())
  }
  function loop() { update(); draw(); requestAnimationFrame(loop) }
  resize(); window.addEventListener('resize', resize)
  for (let i = 0; i < 160; i++) bubbles.push(createBubble(true))
  setTimeout(() => { welcomeDone = true }, 4000); loop()
})()
