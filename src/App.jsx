import { useEffect, useRef, useState } from 'react'

export default function App() {
  const canvasRef = useRef(null)
  const animRef = useRef(null)
  const stateRef = useRef({
    shieldActive: false,
    xenonMass: 100,
    plasmaTemp: 300,
    magneticField: 0.02,
    mirrorActive: false,
    debrisParticles: [],
    collisionEvents: [],
    debrisDetected: 0,
    debrisNeutralized: 0,
    debrisPenetrated: 0,
    time: 0
  })
  const [display, setDisplay] = useState(stateRef.current)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    function spawnDebris() {
      const angle = Math.random() * Math.PI * 2
      const radius = 280
      stateRef.current.debrisParticles.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: -Math.cos(angle) * (2 + Math.random() * 2),
        vy: -Math.sin(angle) * (2 + Math.random() * 2),
        size: 1 + Math.random() * 4,
        threat: 'HIGH',
        id: Math.random()
      })
      stateRef.current.debrisDetected++
    }

    function step() {
      const s = stateRef.current
      s.time += 0.016

      // Spawn debris
      if (Math.random() < 0.03) spawnDebris()

      if (s.shieldActive) {
        // Consume xenon
        s.xenonMass = Math.max(0, s.xenonMass - 0.002)

        // Heat plasma
        const targetTemp = s.mirrorActive ? 10000 : 6000
        s.plasmaTemp += (targetTemp - s.plasmaTemp) * 0.01

        // Move and check debris
        const toRemove = []
        for (const p of s.debrisParticles) {
          p.x += p.vx
          p.y += p.vy
          const dist = Math.sqrt(p.x ** 2 + p.y ** 2)

          // Hit xenon cloud zone
          if (dist < 180 && dist > 100) {
            const xenonEffect = s.xenonMass / 100
            const plasmaEffect = s.plasmaTemp / 10000
            const shieldStrength = (xenonEffect + plasmaEffect) / 2

            if (Math.random() < shieldStrength * 0.15) {
              s.collisionEvents.push({
                x: p.x, y: p.y,
                type: plasmaEffect > 0.7 ? 'ABLATION' : 'SLOWDOWN',
                time: Date.now()
              })
              toRemove.push(p.id)
              s.debrisNeutralized++
              continue
            }
          }

          // Hit spacecraft
          if (dist < 45) {
            s.collisionEvents.push({
              x: p.x, y: p.y,
              type: 'PENETRATION',
              time: Date.now()
            })
            toRemove.push(p.id)
            s.debrisPenetrated++
            continue
          }

          // Left screen
          if (dist > 320) toRemove.push(p.id)
        }
        s.debrisParticles = s.debrisParticles.filter(p => !toRemove.includes(p.id))
        s.collisionEvents = s.collisionEvents.filter(e => Date.now() - e.time < 600)

      } else {
        // Shield off — plasma cools
        s.plasmaTemp += (300 - s.plasmaTemp) * 0.02
        // Debris still moves
        for (const p of s.debrisParticles) {
          p.x += p.vx
          p.y += p.vy
        }
        s.debrisParticles = s.debrisParticles.filter(p => Math.sqrt(p.x**2+p.y**2) < 320)
      }

      // ── DRAW ──
      const cx = canvas.width / 2
      const cy = canvas.height / 2
      const s2 = stateRef.current

      // Space background
      ctx.fillStyle = '#000008'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Stars
      for (let i = 0; i < 150; i++) {
        const sx = (i * 137.5) % canvas.width
        const sy = (i * 97.3) % canvas.height
        ctx.fillStyle = `rgba(255,255,255,${0.2 + (i % 3) * 0.2})`
        ctx.fillRect(sx, sy, 1, 1)
      }

      // Magnetic field lines
      if (s2.shieldActive) {
        ctx.strokeStyle = `rgba(80,120,255,${0.1 + s2.magneticField * 5})`
        ctx.lineWidth = 0.5
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
          ctx.beginPath()
          for (let t = -Math.PI/2; t <= Math.PI/2; t += 0.05) {
            const r = 180 * Math.cos(t) ** 2
            const x = cx + r * Math.cos(t + a)
            const y = cy + r * Math.sin(t + a) * 0.5
            t === -Math.PI/2 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
          }
          ctx.stroke()
        }
      }

      // Xenon cloud
      if (s2.shieldActive && s2.xenonMass > 0) {
        const xenonAlpha = (s2.xenonMass / 100) * 0.3
        const grad = ctx.createRadialGradient(cx, cy, 40, cx, cy, 185)
        grad.addColorStop(0,    'rgba(120,180,255,0)')
        grad.addColorStop(0.4,  `rgba(120,180,255,${xenonAlpha * 0.5})`)
        grad.addColorStop(0.75, `rgba(120,180,255,${xenonAlpha})`)
        grad.addColorStop(1,    'rgba(120,180,255,0)')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(cx, cy, 185, 0, Math.PI * 2)
        ctx.fill()
      }

      // Plasma layer
      if (s2.shieldActive) {
        const t = Math.min(1, s2.plasmaTemp / 10000)
        const plasmaGrad = ctx.createRadialGradient(cx, cy, 95, cx, cy, 160)
        plasmaGrad.addColorStop(0,   'rgba(160,60,255,0)')
        plasmaGrad.addColorStop(0.5, `rgba(160,60,255,${t * 0.25})`)
        plasmaGrad.addColorStop(0.85,`rgba(200,100,255,${t * 0.5})`)
        plasmaGrad.addColorStop(1,   'rgba(200,100,255,0)')
        ctx.fillStyle = plasmaGrad
        ctx.beginPath()
        ctx.arc(cx, cy, 160, 0, Math.PI * 2)
        ctx.fill()
      }

      // Solar rays
      if (s2.mirrorActive && s2.shieldActive) {
        ctx.strokeStyle = 'rgba(255,230,80,0.5)'
        ctx.lineWidth = 1.5
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath()
          ctx.moveTo(cx + 300 + i * 12, cy - 200)
          ctx.lineTo(cx + 170 + i * 3,  cy + i * 8)
          ctx.lineTo(cx + 120, cy)
          ctx.stroke()
        }
      }

      // Spacecraft body
      ctx.fillStyle = '#1a2a3a'
      ctx.strokeStyle = '#3a6a9a'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.roundRect(cx - 38, cy - 18, 76, 36, 4)
      ctx.fill(); ctx.stroke()

      // Solar panels
      ctx.fillStyle = '#0a2a5a'
      ctx.strokeStyle = '#1a4a8a'
      ctx.fillRect(cx - 95, cy - 7, 52, 14)
      ctx.strokeRect(cx - 95, cy - 7, 52, 14)
      ctx.fillRect(cx + 43, cy - 7, 52, 14)
      ctx.strokeRect(cx + 43, cy - 7, 52, 14)

      // Thruster glow when active
      if (s2.shieldActive) {
        const thrusterPositions = [
          [cx-38, cy-10], [cx-38, cy+10],
          [cx+38, cy-10], [cx+38, cy+10]
        ]
        for (const [tx, ty] of thrusterPositions) {
          const tGrad = ctx.createRadialGradient(tx, ty, 0, tx, ty, 8)
          tGrad.addColorStop(0, 'rgba(0,180,255,0.9)')
          tGrad.addColorStop(1, 'rgba(0,180,255,0)')
          ctx.fillStyle = tGrad
          ctx.beginPath()
          ctx.arc(tx, ty, 8, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // Debris particles
      for (const p of s2.debrisParticles) {
        const x = cx + p.x
        const y = cy + p.y
        const dist = Math.sqrt(p.x**2 + p.y**2)
        const inShield = dist < 185 && s2.shieldActive

        ctx.fillStyle = inShield ? '#ff8844' : '#ff3333'
        ctx.beginPath()
        ctx.arc(x, y, p.size, 0, Math.PI * 2)
        ctx.fill()

        // Trail
        ctx.strokeStyle = inShield
          ? 'rgba(255,136,68,0.3)'
          : 'rgba(255,51,51,0.3)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x - p.vx * 6, y - p.vy * 6)
        ctx.stroke()
      }

      // Collision effects
      for (const e of s2.collisionEvents) {
        const age = (Date.now() - e.time) / 600
        const alpha = 1 - age
        const x = cx + e.x
        const y = cy + e.y

        if (e.type === 'ABLATION') {
          ctx.fillStyle = `rgba(255,160,40,${alpha})`
          ctx.beginPath()
          ctx.arc(x, y, 12 * age, 0, Math.PI * 2)
          ctx.fill()
        } else if (e.type === 'SLOWDOWN') {
          ctx.strokeStyle = `rgba(80,200,255,${alpha})`
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(x, y, 18 * age, 0, Math.PI * 2)
          ctx.stroke()
        } else if (e.type === 'PENETRATION') {
          ctx.fillStyle = `rgba(255,40,40,${alpha})`
          ctx.beginPath()
          ctx.arc(x, y, 15, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // HUD text
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(10, 10, 200, 160)
      ctx.fillStyle = '#4a8aaa'
      ctx.font = '10px monospace'
      ctx.fillText('AEGOS SHIELD TELEMETRY', 20, 28)
      ctx.fillStyle = '#ffffff'
      ctx.font = '11px monospace'
      ctx.fillText(`Status: ${s2.shieldActive ? '● ACTIVE' : '○ OFFLINE'}`, 20, 50)
      ctx.fillStyle = s2.shieldActive ? '#00ff88' : '#ff4444'
      ctx.fillRect(78, 40, 8, 8)
      ctx.fillStyle = '#ffffff'
      ctx.fillText(`Plasma: ${Math.floor(s2.plasmaTemp).toLocaleString()} K`, 20, 68)
      ctx.fillText(`Xenon:  ${s2.xenonMass.toFixed(1)} kg`, 20, 84)
      ctx.fillText(`B-field: ${s2.magneticField.toFixed(3)} T`, 20, 100)
      ctx.fillStyle = '#44ff88'
      ctx.fillText(`Neutralized: ${s2.debrisNeutralized}`, 20, 118)
      ctx.fillStyle = '#ff4444'
      ctx.fillText(`Penetrated:  ${s2.debrisPenetrated}`, 20, 134)
      ctx.fillStyle = '#aaaaaa'
      ctx.fillText(`Detected:    ${s2.debrisDetected}`, 20, 150)

      setDisplay({ ...s2 })
      animRef.current = requestAnimationFrame(step)
    }

    animRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(animRef.current)
  }, [])

  function toggleShield() {
    stateRef.current.shieldActive = !stateRef.current.shieldActive
  }

  function toggleMirror() {
    stateRef.current.mirrorActive = !stateRef.current.mirrorActive
  }

  function setMagneticField(v) {
    stateRef.current.magneticField = parseFloat(v)
  }

  return (
    <div style={{
      background: '#000',
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '2rem',
      padding: '2rem',
      fontFamily: 'monospace'
    }}>
      <canvas
        ref={canvasRef}
        width={650}
        height={650}
        style={{ border: '1px solid #1a2a3a' }}
      />

      <div style={{
        width: 240,
        background: '#050d15',
        border: '1px solid #1a2a3a',
        padding: '1.5rem',
        color: '#fff'
      }}>
        <div style={{ fontSize: 11, color: '#4a8aaa',
                      letterSpacing: '0.15em', marginBottom: '1.5rem' }}>
          AEGOS CONTROL
        </div>

        <button onClick={toggleShield} style={{
          width: '100%', padding: '12px', cursor: 'pointer',
          background: display.shieldActive ? '#0a2a0a' : '#1a0a0a',
          border: `1px solid ${display.shieldActive ? '#00ff44' : '#ff4400'}`,
          color: display.shieldActive ? '#00ff44' : '#ff4400',
          fontSize: 13, letterSpacing: '0.1em', marginBottom: '1.5rem'
        }}>
          {display.shieldActive ? '● SHIELD ACTIVE' : '○ ACTIVATE SHIELD'}
        </button>

        <button onClick={toggleMirror} style={{
          width: '100%', padding: '10px', cursor: 'pointer',
          background: display.mirrorActive ? '#1a1a00' : 'transparent',
          border: `1px solid ${display.mirrorActive ? '#ffdd00' : '#333'}`,
          color: display.mirrorActive ? '#ffdd00' : '#555',
          fontSize: 12, marginBottom: '1.5rem'
        }}>
          {display.mirrorActive ? '◉ SOLAR MIRROR ON' : '○ SOLAR MIRROR OFF'}
        </button>

        <label style={{ fontSize: 11, color: '#4a8aaa' }}>
          MAGNETIC FIELD
        </label>
        <input type="range" min="0.005" max="0.05" step="0.001"
          defaultValue="0.02"
          onChange={e => setMagneticField(e.target.value)}
          style={{ width: '100%', margin: '8px 0 4px' }}
        />
        <div style={{ fontSize: 12, marginBottom: '1.5rem' }}>
          {display.magneticField?.toFixed(3)} Tesla
        </div>

        <div style={{ fontSize: 11, color: '#4a8aaa', marginBottom: 8 }}>
          SHIELD LAYERS
        </div>
        <div style={{ fontSize: 12, lineHeight: 2.2, color: '#aaa' }}>
          <div style={{color: display.shieldActive && display.xenonMass > 0
                        ? '#88aaff' : '#333'}}>
            ■ Xenon gas cloud
          </div>
          <div style={{color: display.shieldActive && display.plasmaTemp > 1000
                        ? '#aa88ff' : '#333'}}>
            ■ Plasma layer
          </div>
          <div style={{color: display.shieldActive
                        ? '#88ffaa' : '#333'}}>
            ■ Magnetic field
          </div>
          <div style={{color: display.mirrorActive && display.shieldActive
                        ? '#ffdd44' : '#333'}}>
            ■ Solar focusing
          </div>
        </div>

        <div style={{
          marginTop: '1.5rem',
          paddingTop: '1rem',
          borderTop: '1px solid #1a2a3a',
          fontSize: 12,
          lineHeight: 2
        }}>
          <div style={{ color: '#44ff88' }}>
            Neutralized: {display.debrisNeutralized}
          </div>
          <div style={{ color: '#ff4444' }}>
            Penetrated: {display.debrisPenetrated}
          </div>
          <div style={{ color: '#aaa' }}>
            Detected: {display.debrisDetected}
          </div>
          {display.debrisDetected > 0 && (
            <div style={{ color: '#fff', marginTop: 4 }}>
              Efficiency:{' '}
              {((display.debrisNeutralized / display.debrisDetected) * 100).toFixed(0)}%
            </div>
          )}
        </div>

        <div style={{
          marginTop: '1rem',
          paddingTop: '1rem',
          borderTop: '1px solid #1a2a3a',
          fontSize: 11,
          color: display.xenonMass < 20 ? '#ff4444' : '#aaa'
        }}>
          Xenon remaining: {display.xenonMass?.toFixed(1)} kg
          {display.xenonMass < 20 && (
            <div style={{ color: '#ff4444', marginTop: 4 }}>
              ⚠ XENON LOW
            </div>
          )}
        </div>
      </div>
    </div>
  )
}