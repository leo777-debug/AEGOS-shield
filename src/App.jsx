import { useEffect, useRef, useState } from 'react'

// ── REAL PHYSICS CONSTANTS ──
const k  = 1.380649e-23   // Boltzmann constant J/K
const mXe = 2.18e-25      // Xenon atom mass kg
const q   = 1.602e-19     // Ion charge coulombs
const mu0 = 4*Math.PI*1e-7 // Permeability of free space
const stefanBoltzmann = 5.67e-8

// ── REAL PHYSICS FUNCTIONS ──

// Maxwell-Boltzmann: most probable xenon atom speed at temperature T
function xenonThermalSpeed(T) {
  return Math.sqrt(2 * k * T / mXe) // m/s
}

// Stopping power: energy lost per meter by debris in xenon gas
// Based on momentum transfer collision physics
function stoppingPower(xenonNumberDensity, debrisVelocity, debrisMass, debrisDiameter) {
  const sigma = Math.PI * (debrisDiameter/2 + 2.16e-10)**2 // collision cross section m²
  const dEdx  = xenonNumberDensity * mXe * debrisVelocity**2 * sigma
  return dEdx // J/m
}

// Velocity after traveling distance dx through xenon cloud
function velocityAfterGas(v0, mass, xenonDensity, diameter, dx) {
  const dEdx   = stoppingPower(xenonDensity, v0, mass, diameter)
  const ke0    = 0.5 * mass * v0**2
  const newKE  = Math.max(0, ke0 - dEdx * dx)
  return Math.sqrt(2 * newKE / mass)
}

// Plasma heat flux W/m²
function plasmaHeatFlux(T) {
  return stefanBoltzmann * T**4
}

// Ablation: mass removed from debris per second by plasma
function ablationRate(heatFlux, debrisArea) {
  const sublimationEnergy = 1.08e7 // J/kg aluminum
  return (heatFlux * debrisArea) / sublimationEnergy // kg/s
}

// Magnetic mirror confinement fraction
function confinedFraction(B_equator, B_mirror) {
  const R = B_mirror / B_equator
  return Math.max(0, 1 - 1/Math.sqrt(Math.max(1.001, R)))
}

// Gyroradius of xenon ion in magnetic field
function gyroradius(ionSpeed, B) {
  return (mXe * ionSpeed) / (q * Math.max(B, 1e-10))
}

// Solar concentration: power delivered to plasma
function solarPower(mirrorArea, targetArea, AU = 1) {
  const solarConstant = 1361 / (AU**2) // W/m² at distance AU
  const efficiency    = 0.85
  return solarConstant * mirrorArea * efficiency // W
}

// Xenon number density from mass and volume
function xenonNumberDensity(massKg, volumeM3) {
  return (massKg / mXe) / Math.max(volumeM3, 0.001)
}

// Debris mass from diameter and density
function debrisMass(diameterM, densityKgM3) {
  const r = diameterM / 2
  return (4/3) * Math.PI * r**3 * densityKgM3
}

// Cour-Palais penetration depth (NASA standard)
function penetrationDepth(diam, velocity, debrisDens, shieldDens) {
  const v_kms = velocity / 1000
  return 0.82 * (diam*100)**1.056 *
         (debrisDens/shieldDens)**0.519 *
         v_kms**0.875 / 100 // meters
}

// Hull wall thickness (aluminum spacecraft)
const HULL_THICKNESS = 0.003 // 3mm aluminum — real ISS wall thickness

// ── DEBRIS PRESETS ──
const DEBRIS_PRESETS = {
  'Paint Fleck':     { diameter: 0.001, density: 1400, velocity: 7500  },
  'Aluminium Shard': { diameter: 0.01,  density: 2700, velocity: 9000  },
  'Steel Fragment':  { diameter: 0.008, density: 7800, velocity: 11000 },
  'Micrometeorite':  { diameter: 0.005, density: 3500, velocity: 15000 },
  'Satellite Chunk': { diameter: 0.05,  density: 2000, velocity: 8000  },
}

const SCALE = 1/500 // 1 pixel = 500 meters ... scaled for vis

export default function App() {
  const canvasRef  = useRef(null)
  const animRef    = useRef(null)
  const chartRef   = useRef(null)
  const histRef    = useRef({ t:[], neutralized:[], penetrated:[], plasma:[], efficiency:[] })

  // ── ALL REAL PHYSICS PARAMETERS ──
  const params = useRef({
    // Xenon
    xenonMassKg:      100,
    xenonFlowRate:    0.3,       // kg/min
    xenonVolumeM3:    1000,      // cloud volume m³

    // Plasma
    plasmaTemp:       300,       // K current
    onboardPowerW:    50000,     // W electron beam power
    mirrorAreaM2:     10,        // m² parabolic mirror

    // Magnetic
    magneticFieldT:   0.02,      // Tesla at equator
    mirrorRatio:      3.0,       // B_mirror / B_equator

    // Debris (user controlled)
    debrisDiameter:   0.01,      // meters
    debrisDensity:    2700,      // kg/m³
    debrisVelocity:   9000,      // m/s
    debrisSpawnRate:  0.025,     // per frame

    // State
    shieldActive:     false,
    mirrorActive:     false,
    xenonMass:        100,
    hullIntegrity:    100,
    debrisParticles:  [],
    collisionEvents:  [],
    particles:        [],
    debrisDetected:   0,
    debrisNeutralized:0,
    debrisPenetrated: 0,
    time:             0,
    lastChart:        0,

    // Computed (updated each frame)
    computed: {
      xenonDensity:      0,
      thermalSpeed:      0,
      heatFlux:          0,
      gyroradius:        0,
      confinedFraction:  0,
      shieldEfficiency:  0,
      debrisMass:        0,
      penetrationDepth:  0,
      velocityInShield:  0,
    }
  })

  const [ui, setUi] = useState({})
  const [tab, setTab] = useState('shield')

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')
    const chartC = chartRef.current
    const cctx   = chartC.getContext('2d')

    function spawnDebris() {
      const p   = params.current
      const ang = Math.random() * Math.PI * 2
      const r   = 290

      // Real debris mass from user parameters
      const mass = debrisMass(p.debrisDiameter, p.debrisDensity)

      // Pixel velocity scaled from real m/s
      const pixelSpeed = p.debrisVelocity * SCALE * 0.016

      p.debrisParticles.push({
        x:        Math.cos(ang) * r,
        y:        Math.sin(ang) * r,
        vx:      -Math.cos(ang) * pixelSpeed,
        vy:      -Math.sin(ang) * pixelSpeed,
        realVelocity:  p.debrisVelocity,   // m/s — changes as shield slows it
        diameter:      p.debrisDiameter,   // m
        density:       p.debrisDensity,    // kg/m³
        mass,                              // kg
        pixSize: Math.max(2, Math.log10(p.debrisDiameter*1000+1)*5),
        id: Math.random(),
        age: 0,
      })
      p.debrisDetected++
    }

    function spawnParticle(x, y, color, n=8) {
      const p = params.current
      for (let i=0; i<n; i++) {
        const a = Math.random()*Math.PI*2
        const s = 0.5 + Math.random()*2.5
        p.particles.push({
          x, y,
          vx: Math.cos(a)*s, vy: Math.sin(a)*s,
          color, life: 1,
          size: 1+Math.random()*2.5,
          id: Math.random()
        })
      }
    }

    function step() {
      const p   = params.current
      const now = Date.now()
      p.time   += 0.016

      // ── COMPUTE REAL PHYSICS EACH FRAME ──

      // Xenon number density (real)
      const nXe = xenonNumberDensity(p.xenonMass, p.xenonVolumeM3)

      // Thermal speed of xenon ions
      const vThermal = xenonThermalSpeed(p.plasmaTemp)

      // Gyroradius of confined ions
      const rGyro = gyroradius(vThermal, p.magneticFieldT)

      // Fraction of ions magnetically confined
      const confFrac = confinedFraction(
        p.magneticFieldT,
        p.magneticFieldT * p.mirrorRatio
      )

      // Plasma heat flux
      const hFlux = plasmaHeatFlux(p.plasmaTemp)

      // Current debris properties
      const dMass = debrisMass(p.debrisDiameter, p.debrisDensity)
      const dArea = Math.PI * (p.debrisDiameter/2)**2

      // Velocity after passing through xenon cloud (real stopping power)
      const cloudThicknessM = 50 // meters — realistic xenon cloud depth
      const vAfterGas = p.shieldActive && nXe > 0
        ? velocityAfterGas(p.debrisVelocity, dMass, nXe, p.debrisDiameter, cloudThicknessM)
        : p.debrisVelocity

      // Ablation mass removed per second
      const ablRate = ablationRate(hFlux, dArea) // kg/s
      const transitTime = cloudThicknessM / Math.max(vAfterGas, 1)
      const massAblated = ablRate * transitTime
      const fractionAblated = Math.min(1, massAblated / Math.max(dMass, 1e-30))

      // Penetration depth if debris hits hull
      const penDepth = penetrationDepth(
        p.debrisDiameter,
        vAfterGas,
        p.debrisDensity,
        2700  // aluminum hull
      )
      const penetrates = penDepth > HULL_THICKNESS

      // Overall shield efficiency from real physics
      const velocityReduction = Math.max(0, 1 - vAfterGas/Math.max(p.debrisVelocity,1))
      const shieldEff = Math.min(1,
        fractionAblated * 0.5 +
        velocityReduction * 0.3 +
        confFrac * 0.2
      )

      // Store computed values for display
      p.computed = {
        xenonDensity:     nXe,
        thermalSpeed:     vThermal,
        heatFlux:         hFlux,
        gyroradius:       rGyro,
        confinedFraction: confFrac,
        shieldEfficiency: shieldEff,
        debrisMass:       dMass,
        penetrationDepth: penDepth,
        velocityInShield: vAfterGas,
        fractionAblated,
        penetrates,
        velocityReduction,
      }

      // ── SHIELD STATE ──
      if (p.shieldActive && p.xenonMass > 0) {
        // Consume xenon based on flow rate
        p.xenonMass = Math.max(0, p.xenonMass - (p.xenonFlowRate/60) * 0.016)

        // Plasma temperature: heating from onboard power + solar
        const solarW    = p.mirrorActive ? solarPower(p.mirrorAreaM2, 300) : 0
        const totalPow  = p.onboardPowerW + solarW
        // dT/dt = Power / (volume * heat capacity of plasma)
        const heatCap   = 520 // J/(kg·K) approximate plasma
        const plasmaMass= nXe * mXe * p.xenonVolumeM3
        const dTdt      = plasmaMass > 0
          ? totalPow / (plasmaMass * heatCap)
          : totalPow / (1e-6 * heatCap)
        const cooling   = stefanBoltzmann * p.plasmaTemp**4 * 1e-8
        p.plasmaTemp    = Math.max(300, p.plasmaTemp + (dTdt - cooling) * 0.016 * 100)

        if (p.xenonMass <= 0) p.shieldActive = false
      } else {
        // Cool down naturally
        p.plasmaTemp = Math.max(300, p.plasmaTemp - (p.plasmaTemp - 300) * 0.01)
      }

      // ── SPAWN DEBRIS ──
      if (Math.random() < p.debrisSpawnRate) spawnDebris()

      // ── PROCESS DEBRIS ──
      const toRemove = []
      for (const d of p.debrisParticles) {
        d.x  += d.vx
        d.y  += d.vy
        d.age++
        const dist = Math.sqrt(d.x**2 + d.y**2)

        if (p.shieldActive && dist < 185 && dist > 95) {
          // Apply real stopping power to THIS debris particle
          const nXeLocal = xenonNumberDensity(p.xenonMass, p.xenonVolumeM3)

          // Slow debris using real equation
          d.realVelocity = velocityAfterGas(
            d.realVelocity, d.mass, nXeLocal, d.diameter, 2
          )

          // Scale pixel velocity to match real velocity
          const speedRatio = d.realVelocity / p.debrisVelocity
          d.vx *= 0.998 // gradual pixel slowdown
          d.vy *= 0.998

          // Ablation check using real heat flux
          const dArea2    = Math.PI*(d.diameter/2)**2
          const ablMass   = ablationRate(hFlux, dArea2) * 0.016
          const ablFrac   = ablMass / Math.max(d.mass, 1e-30)
          d.mass          = Math.max(0, d.mass - ablMass)
          d.diameter      = d.mass > 0
            ? 2*Math.cbrt((3*d.mass)/(4*Math.PI*d.density))
            : 0

          if (d.mass <= 0 || ablFrac > 0.99) {
            // Fully ablated
            p.collisionEvents.push({x:d.x,y:d.y,type:'ABLATION',time:now})
            spawnParticle(canvas.width/2+d.x, canvas.height/2+d.y, '#ff8844', 10)
            toRemove.push(d.id)
            p.debrisNeutralized++
            continue
          }

          // Slowdown enough to be harmless?
          const penD = penetrationDepth(d.diameter, d.realVelocity, d.density, 2700)
          if (penD < HULL_THICKNESS * 0.5 && d.realVelocity < 1000) {
            p.collisionEvents.push({x:d.x,y:d.y,type:'SLOWDOWN',time:now})
            spawnParticle(canvas.width/2+d.x, canvas.height/2+d.y, '#44aaff', 8)
            toRemove.push(d.id)
            p.debrisNeutralized++
            continue
          }
        }

        // Hit spacecraft
        if (dist < 42) {
          const penD  = penetrationDepth(d.diameter, d.realVelocity, d.density, 2700)
          const hulls = penD / HULL_THICKNESS  // fraction of hull penetrated
          const dmg   = Math.min(40, hulls * 15 + d.diameter * 200)
          p.hullIntegrity = Math.max(0, p.hullIntegrity - dmg)
          p.collisionEvents.push({x:d.x,y:d.y,type:'PENETRATION',time:now})
          spawnParticle(canvas.width/2+d.x, canvas.height/2+d.y, '#ff2222', 14)
          toRemove.push(d.id)
          p.debrisPenetrated++
          continue
        }

        if (dist > 320) toRemove.push(d.id)
      }

      p.debrisParticles  = p.debrisParticles.filter(d => !toRemove.includes(d.id))
      p.collisionEvents  = p.collisionEvents.filter(e => now - e.time < 700)

      // Visual particles
      for (const pt of p.particles) {
        pt.x += pt.vx; pt.y += pt.vy
        pt.life -= 0.035; pt.vx *= 0.94; pt.vy *= 0.94
      }
      p.particles = p.particles.filter(pt => pt.life > 0)

      // Chart update every 2s
      if (now - p.lastChart > 2000) {
        const h = histRef.current
        h.t.push(Math.floor(p.time))
        h.neutralized.push(p.debrisNeutralized)
        h.penetrated.push(p.debrisPenetrated)
        h.plasma.push(Math.floor(p.plasmaTemp))
        h.efficiency.push(Math.floor(shieldEff*100))
        if (h.t.length > 30) {
          h.t.shift();h.neutralized.shift()
          h.penetrated.shift();h.plasma.shift();h.efficiency.shift()
        }
        p.lastChart = now
        drawChart(cctx)
      }

      drawMain(ctx, canvas, p, now)
      setUi({
        shieldActive:      p.shieldActive,
        mirrorActive:      p.mirrorActive,
        xenonMass:         p.xenonMass,
        plasmaTemp:        p.plasmaTemp,
        magneticFieldT:    p.magneticFieldT,
        hullIntegrity:     p.hullIntegrity,
        debrisDetected:    p.debrisDetected,
        debrisNeutralized: p.debrisNeutralized,
        debrisPenetrated:  p.debrisPenetrated,
        computed:          p.computed,
        debrisDiameter:    p.debrisDiameter,
        debrisVelocity:    p.debrisVelocity,
        debrisDensity:     p.debrisDensity,
      })

      animRef.current = requestAnimationFrame(step)
    }

    animRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(animRef.current)
  }, [])

  // ── DRAW ──
  function drawMain(ctx, canvas, p, now) {
    const cx = canvas.width/2
    const cy = canvas.height/2
    const c  = p.computed

    ctx.fillStyle = '#000008'
    ctx.fillRect(0,0,canvas.width,canvas.height)

    // Stars
    for (let i=0; i<180; i++) {
      const sx = (i*137.5)%canvas.width
      const sy = (i*97.3)%canvas.height
      const tw = 0.2+Math.abs(Math.sin(p.time*0.4+i))*0.4
      ctx.fillStyle=`rgba(255,255,255,${tw})`
      ctx.fillRect(sx,sy,i%7===0?2:1,i%7===0?2:1)
    }

    if (p.shieldActive) {
      // Magnetic field lines — density shows confinement
      const fieldAlpha = 0.06 + p.magneticFieldT*4
      const pulse = 0.7+Math.sin(p.time*2)*0.3
      ctx.strokeStyle=`rgba(80,120,255,${fieldAlpha*pulse})`
      ctx.lineWidth=0.8
      const lineCount = Math.floor(4 + c.confinedFraction*6)
      for (let a=0; a<Math.PI*2; a+=Math.PI*2/lineCount) {
        ctx.beginPath()
        for (let t=-Math.PI/2; t<=Math.PI/2; t+=0.04) {
          const r=185*Math.cos(t)**2
          const x=cx+r*Math.cos(t+a+p.time*0.05)
          const y=cy+r*Math.sin(t+a+p.time*0.05)*0.55
          t===-Math.PI/2?ctx.moveTo(x,y):ctx.lineTo(x,y)
        }
        ctx.stroke()
      }

      // Xenon cloud — opacity from real density
      if (p.xenonMass > 0) {
        const densNorm = Math.min(1, c.xenonDensity/1e15)
        const xa = densNorm * 0.4
        for (let layer=0;layer<3;layer++) {
          const grad=ctx.createRadialGradient(cx,cy,45+layer*15,cx,cy,155+layer*15)
          grad.addColorStop(0,'rgba(100,160,255,0)')
          grad.addColorStop(0.5,`rgba(120,180,255,${xa*0.4})`)
          grad.addColorStop(0.85,`rgba(140,200,255,${xa*0.7})`)
          grad.addColorStop(1,'rgba(140,200,255,0)')
          ctx.fillStyle=grad
          ctx.beginPath()
          ctx.arc(cx,cy,170+layer*10,0,Math.PI*2)
          ctx.fill()
        }
      }

      // Plasma — color and intensity from real temperature
      const tNorm  = Math.min(1, p.plasmaTemp/15000)
      const flick  = 0.85+Math.sin(p.time*7)*0.15
      // Color shifts blue→purple→white as temp rises
      const pr = Math.floor(100+tNorm*155)
      const pg = Math.floor(40+tNorm*60)
      const pb = 255
      const pGrad=ctx.createRadialGradient(cx,cy,88,cx,cy,168)
      pGrad.addColorStop(0,`rgba(${pr},${pg},${pb},0)`)
      pGrad.addColorStop(0.4,`rgba(${pr},${pg},${pb},${tNorm*0.2*flick})`)
      pGrad.addColorStop(0.78,`rgba(${pr},${pg},${pb},${tNorm*0.55*flick})`)
      pGrad.addColorStop(1,`rgba(${pr},${pg},${pb},0)`)
      ctx.fillStyle=pGrad
      ctx.beginPath()
      ctx.arc(cx,cy,168,0,Math.PI*2)
      ctx.fill()

      // Shield boundary — shows real efficiency
      ctx.strokeStyle=`rgba(0,255,120,${c.shieldEfficiency*0.7})`
      ctx.lineWidth=1.5
      ctx.setLineDash([4,6])
      ctx.beginPath()
      ctx.arc(cx,cy,190,0,Math.PI*2*c.shieldEfficiency)
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Solar rays — count shows mirror area
    if (p.mirrorActive && p.shieldActive) {
      const rayCount = Math.floor(p.mirrorAreaM2/3)
      for (let i=-rayCount;i<=rayCount;i++) {
        const al=0.3+Math.abs(Math.sin(p.time*3+i))*0.3
        ctx.strokeStyle=`rgba(255,230,80,${al})`
        ctx.lineWidth=1+Math.abs(i)*0.2
        ctx.beginPath()
        ctx.moveTo(cx+320+i*14,cy-220)
        ctx.lineTo(cx+178+i*3,cy+i*5)
        ctx.lineTo(cx+125,cy+i*2)
        ctx.stroke()
      }
      ctx.strokeStyle='rgba(200,200,100,0.7)'
      ctx.lineWidth=2
      ctx.beginPath()
      ctx.arc(cx+178,cy,32,-Math.PI*0.65,Math.PI*0.65)
      ctx.stroke()
    }

    // Spacecraft hull color shows damage
    const hullCol = p.hullIntegrity>60?'#1a2a3a':p.hullIntegrity>30?'#3a2a1a':'#3a1510'
    const hullStr = p.hullIntegrity>60?'#3a6a9a':p.hullIntegrity>30?'#9a6a2a':'#cc3010'

    if (p.shieldActive) {
      const thrPos=[[cx-38,cy-10],[cx-38,cy+10],[cx+38,cy-10],[cx+38,cy+10]]
      for (const [tx,ty] of thrPos) {
        const g=ctx.createRadialGradient(tx,ty,0,tx,ty,14)
        g.addColorStop(0,'rgba(0,200,255,0.9)')
        g.addColorStop(1,'rgba(0,200,255,0)')
        ctx.fillStyle=g; ctx.beginPath()
        ctx.arc(tx,ty,14,0,Math.PI*2); ctx.fill()
      }
    }

    ctx.fillStyle=hullCol; ctx.strokeStyle=hullStr; ctx.lineWidth=1.5
    ctx.beginPath(); ctx.roundRect(cx-38,cy-18,76,36,4); ctx.fill(); ctx.stroke()

    // Hull crack when damaged
    if (p.hullIntegrity < 50) {
      ctx.strokeStyle=`rgba(255,80,30,${(50-p.hullIntegrity)/50})`
      ctx.lineWidth=0.8; ctx.beginPath()
      ctx.moveTo(cx-8,cy-18); ctx.lineTo(cx+4,cy-4)
      ctx.lineTo(cx-2,cy+18); ctx.stroke()
    }

    // Solar panels
    ctx.fillStyle='#0a2a5a'; ctx.strokeStyle='#1a4a8a'; ctx.lineWidth=1
    ctx.fillRect(cx-95,cy-7,52,14); ctx.strokeRect(cx-95,cy-7,52,14)
    ctx.fillRect(cx+43,cy-7,52,14); ctx.strokeRect(cx+43,cy-7,52,14)
    ctx.strokeStyle='rgba(30,80,150,0.4)'; ctx.lineWidth=0.5
    for (let i=1;i<4;i++) {
      ctx.beginPath(); ctx.moveTo(cx-95+i*13,cy-7); ctx.lineTo(cx-95+i*13,cy+7); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(cx+43+i*13,cy-7); ctx.lineTo(cx+43+i*13,cy+7); ctx.stroke()
    }

    // Hull bar under ship
    ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(cx-80,cy+32,160,8)
    const hc=p.hullIntegrity>60?'#00ff88':p.hullIntegrity>30?'#ffaa00':'#ff3333'
    ctx.fillStyle=hc; ctx.fillRect(cx-80,cy+32,160*(p.hullIntegrity/100),8)
    ctx.strokeStyle='#1a2a3a'; ctx.lineWidth=1; ctx.strokeRect(cx-80,cy+32,160,8)
    ctx.fillStyle='#888'; ctx.font='9px monospace'
    ctx.fillText(`HULL ${p.hullIntegrity.toFixed(0)}%`,cx-18,cy+52)

    // Debris
    for (const d of p.debrisParticles) {
      const x=cx+d.x; const y=cy+d.y
      const dist=Math.sqrt(d.x**2+d.y**2)
      const inShield=dist<185&&p.shieldActive
      const slowFrac=1-d.realVelocity/p.debrisVelocity

      // Color shifts red→orange as debris slows (real velocity)
      const dr=255; const dg=Math.floor(slowFrac*150)
      const g2=ctx.createRadialGradient(x,y,0,x,y,d.pixSize*3)
      g2.addColorStop(0,`rgba(${dr},${dg},0,0.7)`)
      g2.addColorStop(1,'rgba(0,0,0,0)')
      ctx.fillStyle=g2; ctx.beginPath()
      ctx.arc(x,y,d.pixSize*3,0,Math.PI*2); ctx.fill()

      ctx.fillStyle=inShield?`rgb(${dr},${dg},0)`:'#ff3333'
      ctx.beginPath(); ctx.arc(x,y,d.pixSize,0,Math.PI*2); ctx.fill()

      ctx.strokeStyle='rgba(255,50,50,0.2)'; ctx.lineWidth=1
      ctx.beginPath(); ctx.moveTo(x,y)
      ctx.lineTo(x-d.vx*10,y-d.vy*10); ctx.stroke()
    }

    // Visual particles
    for (const pt of p.particles) {
      const col=pt.color.startsWith('#')
        ? pt.color
        : pt.color
      ctx.globalAlpha=pt.life
      ctx.fillStyle=col; ctx.beginPath()
      ctx.arc(pt.x,pt.y,pt.size*pt.life,0,Math.PI*2); ctx.fill()
    }
    ctx.globalAlpha=1

    // Collision effects
    for (const e of p.collisionEvents) {
      const age=(now-e.time)/700; const al=1-age
      const x=cx+e.x; const y=cy+e.y
      if (e.type==='ABLATION') {
        ctx.strokeStyle=`rgba(255,160,40,${al})`; ctx.lineWidth=2
        ctx.beginPath(); ctx.arc(x,y,22*age,0,Math.PI*2); ctx.stroke()
        ctx.fillStyle=`rgba(255,220,80,${al*0.4})`
        ctx.beginPath(); ctx.arc(x,y,8*(1-age*0.5),0,Math.PI*2); ctx.fill()
      } else if (e.type==='SLOWDOWN') {
        ctx.strokeStyle=`rgba(80,200,255,${al})`; ctx.lineWidth=1.5
        ctx.beginPath(); ctx.arc(x,y,24*age,0,Math.PI*2); ctx.stroke()
      } else {
        ctx.fillStyle=`rgba(255,30,30,${al*0.8})`
        ctx.beginPath(); ctx.arc(x,y,18*(1-age*0.4),0,Math.PI*2); ctx.fill()
      }
    }

    // Telemetry HUD
    ctx.fillStyle='rgba(0,4,12,0.8)'
    ctx.fillRect(10,10,225,210)
    ctx.strokeStyle='#1a3a5a'; ctx.lineWidth=0.5
    ctx.strokeRect(10,10,225,210)
    ctx.fillStyle='#4a8aaa'; ctx.font='10px monospace'
    ctx.fillText('AEGOS SHIELD TELEMETRY',20,28)
    ctx.font='10px monospace'
    const lines=[
      {t:`Status:   ${p.shieldActive?'ACTIVE':'OFFLINE'}`,
       c:p.shieldActive?'#00ff88':'#ff4444'},
      {t:`Plasma:   ${Math.floor(p.plasmaTemp).toLocaleString()} K`,c:'#aa88ff'},
      {t:`Xe Dens:  ${c.xenonDensity?.toExponential(1)} /m³`,c:'#88aaff'},
      {t:`Xe Speed: ${(c.thermalSpeed/1000)?.toFixed(1)} km/s`,c:'#88ccff'},
      {t:`Gyrorad:  ${(c.gyroradius*100)?.toFixed(2)} cm`,c:'#88ddff'},
      {t:`Confined: ${((c.confinedFraction||0)*100).toFixed(0)}%`,c:'#88ffcc'},
      {t:`Heat Flux:${(c.heatFlux/1e6)?.toFixed(0)} MW/m²`,c:'#ffaa88'},
      {t:`Vel→shield:${((c.velocityInShield||0)/1000).toFixed(1)} km/s`,c:'#ffcc44'},
      {t:`Ablated:  ${((c.fractionAblated||0)*100).toFixed(1)}%`,c:'#ff8844'},
      {t:`Pen depth:${((c.penetrationDepth||0)*1000).toFixed(2)} mm`,c:
        (c.penetrationDepth||0)>HULL_THICKNESS?'#ff4444':'#44ff88'},
      {t:`Shield:   ${((c.shieldEfficiency||0)*100).toFixed(0)}%`,c:'#00ff88'},
      {t:`Hull:     ${p.hullIntegrity.toFixed(0)}%`,c:hc},
      {t:`Neutral:  ${p.debrisNeutralized}`,c:'#44ff88'},
      {t:`Impact:   ${p.debrisPenetrated}`,c:'#ff4444'},
    ]
    lines.forEach((l,i)=>{
      ctx.fillStyle=l.c
      ctx.fillText(l.t,20,46+i*12)
    })
  }

  function drawChart(ctx) {
    const h=histRef.current
    const w=chartRef.current.width
    const h2=chartRef.current.height
    ctx.fillStyle='#000d1a'; ctx.fillRect(0,0,w,h2)
    if (h.t.length<2) return

    const maxN=Math.max(...h.neutralized,1)

    // Neutralized
    ctx.strokeStyle='#44ff88'; ctx.lineWidth=2; ctx.beginPath()
    h.neutralized.forEach((v,i)=>{
      const x=(i/(h.neutralized.length-1))*(w-20)+10
      const y=h2-20-(v/maxN)*(h2-30)
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)
    }); ctx.stroke()

    // Penetrated
    ctx.strokeStyle='#ff4444'; ctx.lineWidth=2; ctx.beginPath()
    h.penetrated.forEach((v,i)=>{
      const x=(i/(h.penetrated.length-1))*(w-20)+10
      const y=h2-20-(v/maxN)*(h2-30)
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)
    }); ctx.stroke()

    // Shield efficiency
    ctx.strokeStyle='#00ff88'; ctx.lineWidth=1.5
    ctx.setLineDash([3,3]); ctx.beginPath()
    h.efficiency.forEach((v,i)=>{
      const x=(i/(h.efficiency.length-1))*(w-20)+10
      const y=h2-20-(v/100)*(h2-30)
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)
    }); ctx.stroke(); ctx.setLineDash([])

    ctx.font='9px monospace'
    ctx.fillStyle='#44ff88'; ctx.fillText('— Neutralized',10,12)
    ctx.fillStyle='#ff4444'; ctx.fillText('— Penetrated',100,12)
    ctx.fillStyle='#00ff88'; ctx.fillText('--- Efficiency',190,12)
  }

  // ── PARAM SETTERS — all change real physics ──
  const set = (key, val) => { params.current[key] = val }

  function loadPreset(name) {
    const pr = DEBRIS_PRESETS[name]
    params.current.debrisDiameter = pr.diameter
    params.current.debrisDensity  = pr.density
    params.current.debrisVelocity = pr.velocity
  }

  const eff = ui.debrisDetected > 0
    ? ((ui.debrisNeutralized/ui.debrisDetected)*100).toFixed(0) : 0

  const c = ui.computed || {}

  const hc = (ui.hullIntegrity||100)>60?'#00ff88'
           : (ui.hullIntegrity||100)>30?'#ffaa00':'#ff3333'

  // ── UI ──
  return (
    <div style={{
      background:'#000', minHeight:'100vh',
      display:'flex', alignItems:'flex-start',
      justifyContent:'center', gap:'1rem',
      padding:'1rem', fontFamily:'monospace'
    }}>
      <div>
        <canvas ref={canvasRef} width={620} height={580}
          style={{border:'1px solid #1a2a3a',display:'block'}}/>
        <canvas ref={chartRef} width={620} height={110}
          style={{border:'1px solid #1a2a3a',display:'block',
                  marginTop:3,background:'#000d1a'}}/>
      </div>

      {/* Control panel */}
      <div style={{
        width:270, background:'#050d15',
        border:'1px solid #1a2a3a', color:'#fff',
        alignSelf:'flex-start', fontSize:11
      }}>
        {/* Tabs */}
        <div style={{display:'flex',borderBottom:'1px solid #1a2a3a'}}>
          {['shield','debris','physics'].map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{
              flex:1, padding:'9px 2px', background:tab===t?'#0a1a2a':'transparent',
              border:'none',
              borderBottom:tab===t?'2px solid #4a8aaa':'2px solid transparent',
              color:tab===t?'#4a8aaa':'#444', cursor:'pointer',
              fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase'
            }}>{t}</button>
          ))}
        </div>

        <div style={{padding:'1rem'}}>

          {/* ── SHIELD TAB ── */}
          {tab==='shield' && (<>
            <button onClick={()=>set('shieldActive',!params.current.shieldActive)}
              style={{
                width:'100%', padding:'11px', cursor:'pointer',
                background:ui.shieldActive?'#0a2a0a':'#1a0808',
                border:`1px solid ${ui.shieldActive?'#00ff44':'#ff4400'}`,
                color:ui.shieldActive?'#00ff44':'#ff4400',
                fontSize:12, letterSpacing:'0.1em', marginBottom:'0.75rem'
              }}>
              {ui.shieldActive?'● SHIELD ACTIVE':'○ ACTIVATE SHIELD'}
            </button>

            <button onClick={()=>set('mirrorActive',!params.current.mirrorActive)}
              style={{
                width:'100%', padding:'9px', cursor:'pointer',
                background:ui.mirrorActive?'#181600':'transparent',
                border:`1px solid ${ui.mirrorActive?'#ffdd00':'#2a2a2a'}`,
                color:ui.mirrorActive?'#ffdd00':'#444',
                fontSize:11, marginBottom:'1rem'
              }}>
              {ui.mirrorActive?'◉ SOLAR MIRROR ON':'○ SOLAR MIRROR OFF'}
            </button>

            {/* Magnetic field */}
            {[
              {label:'Magnetic Field (T)',key:'magneticFieldT',
               min:0.001,max:0.1,step:0.001,
               val:(ui.magneticFieldT||0.02).toFixed(3),unit:'T',
               note:`${((c.confinedFraction||0)*100).toFixed(0)}% ions confined`},
              {label:'Mirror Ratio',key:'mirrorRatio',
               min:1.1,max:10,step:0.1,
               val:(params.current.mirrorRatio||3).toFixed(1),unit:'x',
               note:`Loss cone: ${(Math.asin(1/Math.sqrt(params.current.mirrorRatio||3))*180/Math.PI).toFixed(0)}°`},
              {label:'Xenon Flow Rate',key:'xenonFlowRate',
               min:0.05,max:2,step:0.05,
               val:(params.current.xenonFlowRate||0.3).toFixed(2),unit:'kg/min',
               note:`${(ui.xenonMass||100).toFixed(1)} kg left`},
              {label:'Mirror Area',key:'mirrorAreaM2',
               min:1,max:50,step:1,
               val:(params.current.mirrorAreaM2||10).toFixed(0),unit:'m²',
               note:`${(solarPower(params.current.mirrorAreaM2||10,300)/1000).toFixed(0)} kW delivered`},
              {label:'Onboard Power',key:'onboardPowerW',
               min:1000,max:500000,step:1000,
               val:((params.current.onboardPowerW||50000)/1000).toFixed(0),unit:'kW',
               note:'electron beam heating'},
            ].map(s=>(
              <div key={s.key} style={{marginBottom:'0.9rem'}}>
                <div style={{
                  display:'flex',justifyContent:'space-between',
                  color:'#4a8aaa',marginBottom:3
                }}>
                  <span>{s.label}</span>
                  <span style={{color:'#fff'}}>{s.val} {s.unit}</span>
                </div>
                <input type="range" min={s.min} max={s.max} step={s.step}
                  defaultValue={params.current[s.key]||s.min}
                  onChange={e=>set(s.key,parseFloat(e.target.value))}
                  style={{width:'100%',marginBottom:2}}/>
                <div style={{color:'#444',fontSize:10}}>{s.note}</div>
              </div>
            ))}

            {/* Actions */}
            <div style={{display:'flex',gap:6,marginTop:'0.5rem'}}>
              <button onClick={()=>{params.current.xenonMass=100}}
                style={{flex:1,padding:'7px',cursor:'pointer',
                  background:'transparent',border:'1px solid #1a3a5a',
                  color:'#4a8aaa',fontSize:10}}>↺ Refill Xe</button>
              <button onClick={()=>{params.current.hullIntegrity=100}}
                style={{flex:1,padding:'7px',cursor:'pointer',
                  background:'transparent',border:'1px solid #1a3a1a',
                  color:'#44aa44',fontSize:10}}>✦ Repair</button>
            </div>

            {/* Hull bar */}
            <div style={{marginTop:'0.75rem'}}>
              <div style={{
                display:'flex',justifyContent:'space-between',
                color:'#4a8aaa',marginBottom:4,fontSize:10
              }}>
                <span>HULL INTEGRITY</span>
                <span style={{color:hc}}>{(ui.hullIntegrity||100).toFixed(0)}%</span>
              </div>
              <div style={{background:'#0a0a0a',height:8,borderRadius:2,overflow:'hidden'}}>
                <div style={{
                  height:'100%',
                  width:`${ui.hullIntegrity||100}%`,
                  background:hc,transition:'width 0.3s,background 0.3s'
                }}/>
              </div>
            </div>

            {/* Stats */}
            <div style={{
              marginTop:'0.75rem',paddingTop:'0.75rem',
              borderTop:'1px solid #1a2a3a',lineHeight:2
            }}>
              <div style={{color:'#44ff88'}}>Neutralized: {ui.debrisNeutralized}</div>
              <div style={{color:'#ff4444'}}>Penetrated:  {ui.debrisPenetrated}</div>
              <div style={{color:'#aaa'}}>Detected:    {ui.debrisDetected}</div>
              <div style={{color:'#fff'}}>Efficiency:  {eff}%</div>
            </div>
          </>)}

          {/* ── DEBRIS TAB ── */}
          {tab==='debris' && (<>
            <div style={{color:'#4a8aaa',marginBottom:'0.75rem',
                         letterSpacing:'0.1em',fontSize:10}}>
              DEBRIS PARAMETERS
            </div>

            {/* Presets */}
            <div style={{marginBottom:'0.75rem'}}>
              <div style={{color:'#4a8aaa',fontSize:10,marginBottom:4}}>PRESETS</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                {Object.keys(DEBRIS_PRESETS).map(name=>(
                  <button key={name} onClick={()=>loadPreset(name)} style={{
                    padding:'4px 7px',cursor:'pointer',fontSize:9,
                    background:'transparent',border:'1px solid #1a3a5a',
                    color:'#4a8aaa'
                  }}>{name}</button>
                ))}
              </div>
            </div>

            {[
              {label:'Diameter',key:'debrisDiameter',
               min:0.0001,max:0.2,step:0.0001,
               display:((ui.debrisDiameter||0.01)*1000).toFixed(1),unit:'mm',
               note:'affects mass, ablation, penetration'},
              {label:'Density',key:'debrisDensity',
               min:500,max:8000,step:100,
               display:(ui.debrisDensity||2700).toFixed(0),unit:'kg/m³',
               note:'500=foam, 2700=Al, 7800=steel'},
              {label:'Velocity',key:'debrisVelocity',
               min:100,max:20000,step:100,
               display:((ui.debrisVelocity||9000)/1000).toFixed(1),unit:'km/s',
               note:'LEO avg ~7.5 km/s'},
              {label:'Spawn Rate',key:'debrisSpawnRate',
               min:0.005,max:0.15,step:0.005,
               display:(params.current.debrisSpawnRate*100).toFixed(1),unit:'%/frame',
               note:'debris field density'},
            ].map(s=>(
              <div key={s.key} style={{marginBottom:'1rem'}}>
                <div style={{
                  display:'flex',justifyContent:'space-between',
                  color:'#4a8aaa',marginBottom:3
                }}>
                  <span>{s.label}</span>
                  <span style={{color:'#fff'}}>{s.display} {s.unit}</span>
                </div>
                <input type="range"
                  min={s.min} max={s.max} step={s.step}
                  defaultValue={params.current[s.key]}
                  onChange={e=>set(s.key,parseFloat(e.target.value))}
                  style={{width:'100%',marginBottom:2}}/>
                <div style={{color:'#444',fontSize:10}}>{s.note}</div>
              </div>
            ))}

            {/* Live debris physics readout */}
            <div style={{
              marginTop:'0.5rem',paddingTop:'0.75rem',
              borderTop:'1px solid #1a2a3a'
            }}>
              <div style={{color:'#4a8aaa',fontSize:10,
                           marginBottom:6,letterSpacing:'0.1em'}}>
                LIVE PHYSICS READOUT
              </div>
              {[
                {label:'Debris mass',
                 val:`${((c.debrisMass||0)*1000).toExponential(2)} g`},
                {label:'KE at impact',
                 val:`${((0.5*(c.debrisMass||0)*(ui.debrisVelocity||9000)**2)/1000).toFixed(0)} kJ`},
                {label:'Vel in shield',
                 val:`${((c.velocityInShield||0)/1000).toFixed(2)} km/s`},
                {label:'Mass ablated',
                 val:`${((c.fractionAblated||0)*100).toFixed(1)}%`},
                {label:'Pen depth',
                 val:`${((c.penetrationDepth||0)*1000).toFixed(2)} mm`,
                 warn:(c.penetrationDepth||0)>HULL_THICKNESS},
                {label:'Hull thickness',val:'3.00 mm'},
                {label:'Penetrates?',
                 val:c.penetrates?'YES — DANGER':'NO — SAFE',
                 warn:c.penetrates},
              ].map(r=>(
                <div key={r.label} style={{
                  display:'flex',justifyContent:'space-between',
                  marginBottom:5,fontSize:10
                }}>
                  <span style={{color:'#666'}}>{r.label}</span>
                  <span style={{color:r.warn?'#ff4444':'#fff'}}>{r.val}</span>
                </div>
              ))}
            </div>
          </>)}

          {/* ── PHYSICS TAB ── */}
          {tab==='physics' && (<>
            <div style={{color:'#4a8aaa',fontSize:10,
                         letterSpacing:'0.1em',marginBottom:'0.75rem'}}>
              REAL-TIME PHYSICS VALUES
            </div>
            {[
              {label:'Xenon number density',
               val:`${(c.xenonDensity||0).toExponential(2)} m⁻³`,
               note:'From mass/volume calculation'},
              {label:'Xe thermal speed',
               val:`${((c.thermalSpeed||0)/1000).toFixed(2)} km/s`,
               note:'Maxwell-Boltzmann at plasma T'},
              {label:'Ion gyroradius',
               val:`${((c.gyroradius||0)*100).toFixed(2)} cm`,
               note:'Larmor radius in B field'},
              {label:'Confined fraction',
               val:`${((c.confinedFraction||0)*100).toFixed(1)}%`,
               note:'Magnetic mirror ratio'},
              {label:'Plasma heat flux',
               val:`${((c.heatFlux||0)/1e6).toFixed(2)} MW/m²`,
               note:'Stefan-Boltzmann at T'},
              {label:'Velocity reduction',
               val:`${((c.velocityReduction||0)*100).toFixed(1)}%`,
               note:'Xenon stopping power'},
              {label:'Ablation fraction',
               val:`${((c.fractionAblated||0)*100).toFixed(2)}%`,
               note:'Heat flux × transit time'},
              {label:'Shield efficiency',
               val:`${((c.shieldEfficiency||0)*100).toFixed(1)}%`,
               note:'Combined all layers'},
              {label:'Pen depth (Cour-Palais)',
               val:`${((c.penetrationDepth||0)*1000).toFixed(3)} mm`,
               note:'NASA standard equation'},
              {label:'Hull wall (Al)',
               val:'3.000 mm',
               note:'Real ISS wall thickness'},
            ].map(r=>(
              <div key={r.label} style={{marginBottom:'0.9rem'}}>
                <div style={{
                  display:'flex',justifyContent:'space-between',marginBottom:2
                }}>
                  <span style={{color:'#888',fontSize:10}}>{r.label}</span>
                  <span style={{color:'#fff',fontSize:11,fontWeight:'bold'}}>
                    {r.val}
                  </span>
                </div>
                <div style={{color:'#333',fontSize:9}}>{r.note}</div>
              </div>
            ))}

            <div style={{
              marginTop:'0.5rem',paddingTop:'0.75rem',
              borderTop:'1px solid #1a2a3a',
              color:'#333',fontSize:9,lineHeight:1.8
            }}>
              Equations used:<br/>
              • Maxwell-Boltzmann distribution<br/>
              • Lorentz magnetic mirror confinement<br/>
              • Stefan-Boltzmann radiation<br/>
              • Cour-Palais hypervelocity impact<br/>
              • Momentum transfer stopping power<br/>
              • Thermal ablation (sublimation energy)
            </div>
          </>)}

        </div>
      </div>
    </div>
  )
}
