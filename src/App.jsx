import { useEffect, useRef, useState } from 'react'

const k   = 1.380649e-23
const mXe = 2.18e-25
const q   = 1.602e-19
const stefanBoltzmann = 5.67e-8
const HULL_THICKNESS  = 0.003
const SCALE = 1/500

// ── REAL PHYSICS ──
function xenonThermalSpeed(T) { return Math.sqrt(2*k*T/mXe) }
function stoppingPower(nXe, v, diam) {
  const sigma = Math.PI*(diam/2+2.16e-10)**2
  return nXe * mXe * v**2 * sigma
}
function velocityAfterGas(v0, mass, nXe, diam, dx) {
  const dEdx = stoppingPower(nXe, v0, diam)
  const newKE = Math.max(0, 0.5*mass*v0**2 - dEdx*dx)
  return Math.sqrt(2*newKE/mass)
}
function plasmaHeatFlux(T) { return stefanBoltzmann*T**4 }
function ablationRate(flux, area) { return (flux*area)/1.08e7 }
function confinedFraction(B, R) { return Math.max(0,1-1/Math.sqrt(Math.max(1.001,R))) }
function gyroradius(v, B) { return (mXe*v)/(q*Math.max(B,1e-10)) }
function solarPower(area) { return 1361*area*0.85 }
function xenonNumberDensity(mass, vol) { return (mass/mXe)/Math.max(vol,0.001) }
function debrisMass(diam, dens) { return (4/3)*Math.PI*(diam/2)**3*dens }
function penetrationDepth(diam, vel, dDens) {
  const v_kms = vel/1000
  return 0.82*(diam*100)**1.056*(dDens/2700)**0.519*v_kms**0.875/100
}

// ── DEBRIS TYPES WITH REAL COLORS AND PROPERTIES ──
const DEBRIS_TYPES = [
  {
    name: 'Chondrite Meteorite',
    color: '#8B6914',        // rocky brown
    glowColor: '#ff6600',    // orange entry glow
    trailColor: '#ff4400',
    diameter: 0.008,
    density: 3500,
    velocity: 20000,
    description: 'Stony meteorite, most common type',
    origin: 'Asteroid belt',
    composition: 'Silicate minerals, iron',
    entryGlow: true,         // heats up entering atmosphere
  },
  {
    name: 'Iron Meteorite',
    color: '#5a5a6a',        // metallic grey-blue
    glowColor: '#ffffff',
    trailColor: '#aaaaff',
    diameter: 0.015,
    density: 7900,
    velocity: 17000,
    description: 'Dense iron-nickel composition',
    origin: 'Differentiated asteroid core',
    composition: 'Iron-Nickel alloy (Fe-Ni)',
    entryGlow: true,
  },
  {
    name: 'Carbonaceous Chondrite',
    color: '#2a2a2a',        // very dark, carbon-rich
    glowColor: '#440000',
    trailColor: '#880000',
    diameter: 0.012,
    density: 2200,
    velocity: 18000,
    description: 'Primitive carbon-rich meteorite',
    origin: 'Outer asteroid belt',
    composition: 'Carbon, water ice, organics',
    entryGlow: false,
  },
  {
    name: 'Paint Fleck',
    color: '#cccccc',        // white/grey
    glowColor: '#ffffff',
    trailColor: '#aaaaaa',
    diameter: 0.001,
    density: 1400,
    velocity: 7500,
    description: 'Spacecraft paint fragment',
    origin: 'LEO debris belt',
    composition: 'Polymer coating',
    entryGlow: false,
  },
  {
    name: 'Aluminium Shard',
    color: '#b8c8d8',        // metallic light blue
    glowColor: '#88ccff',
    trailColor: '#4488aa',
    diameter: 0.02,
    density: 2700,
    velocity: 9000,
    description: 'Satellite structural fragment',
    origin: 'LEO debris belt',
    composition: 'Aluminium alloy 6061',
    entryGlow: false,
  },
  {
    name: 'Steel Bolt',
    color: '#888890',
    glowColor: '#aaaacc',
    trailColor: '#666688',
    diameter: 0.01,
    density: 7800,
    velocity: 11000,
    description: 'Lost fastener from EVA',
    origin: 'LEO debris belt',
    composition: 'Stainless steel',
    entryGlow: false,
  },
  {
    name: 'Micrometeorite',
    color: '#aa8844',
    glowColor: '#ffcc44',
    trailColor: '#ff8800',
    diameter: 0.0003,
    density: 3200,
    velocity: 25000,
    description: 'Sub-mm cosmic dust particle',
    origin: 'Cometary debris stream',
    composition: 'Olivine, pyroxene, iron',
    entryGlow: true,
  },
  {
    name: 'Satellite Panel',
    color: '#1a3a6a',        // dark blue like solar panel
    glowColor: '#4466ff',
    trailColor: '#2244aa',
    diameter: 0.08,
    density: 1800,
    velocity: 7800,
    description: 'Solar panel fragment',
    origin: 'LEO debris belt',
    composition: 'GaAs cells, aluminium frame',
    entryGlow: false,
  },
]

const DEBRIS_PRESETS = {}
DEBRIS_TYPES.forEach(d => {
  DEBRIS_PRESETS[d.name] = { diameter: d.diameter, density: d.density, velocity: d.velocity }
})

// LEO debris belt zones (pixel radius from center)
const LEO_BELTS = [
  { name: 'LEO Dense (400-600km)', radius: 210, width: 18,
    color: 'rgba(255,80,80,0.12)', labelColor: '#ff5544',
    description: 'Most congested orbital shell — ISS altitude' },
  { name: 'LEO Medium (600-800km)', radius: 240, width: 16,
    color: 'rgba(255,160,40,0.09)', labelColor: '#ff9933',
    description: 'High debris density from Iridium collision' },
  { name: 'LEO Sparse (800-1000km)', radius: 268, width: 14,
    color: 'rgba(255,220,50,0.07)', labelColor: '#ffcc22',
    description: 'Moderate risk — Cosmos 954 altitude' },
  { name: 'MEO (2000km+)', radius: 295, width: 10,
    color: 'rgba(100,200,255,0.05)', labelColor: '#44aaff',
    description: 'Medium Earth Orbit — GPS satellites' },
]

export default function App() {
  const canvasRef = useRef(null)
  const animRef   = useRef(null)
  const chartRef  = useRef(null)
  const histRef   = useRef({ t:[], neutralized:[], penetrated:[], plasma:[], efficiency:[] })

  const params = useRef({
    xenonMass:       100,
    xenonFlowRate:   0.3,
    xenonVolumeM3:   1000,
    plasmaTemp:      300,
    onboardPowerW:   50000,
    mirrorAreaM2:    10,
    magneticFieldT:  0.02,
    mirrorRatio:     3.0,
    debrisDiameter:  0.01,
    debrisDensity:   2700,
    debrisVelocity:  9000,
    debrisSpawnRate: 0.025,
    selectedType:    null,   // null = random mix
    showBelts:       true,
    showOrbits:      true,
    shieldActive:    false,
    mirrorActive:    false,
    hullIntegrity:   100,
    debrisParticles: [],
    collisionEvents: [],
    particles:       [],
    debrisDetected:   0,
    debrisNeutralized:0,
    debrisPenetrated: 0,
    time:             0,
    lastChart:        0,
    computed: {}
  })

  const [ui, setUi]   = useState({})
  const [tab, setTab] = useState('shield')

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')
    const chartC = chartRef.current
    const cctx   = chartC.getContext('2d')

    function pickDebrisType() {
      const p = params.current
      if (p.selectedType !== null) return DEBRIS_TYPES[p.selectedType]
      // Random weighted mix — man-made more common in LEO
      const weights = [1,1,1, 8,8,6, 2, 3] // meteorites less common than debris
      const total = weights.reduce((a,b)=>a+b,0)
      let r = Math.random()*total
      for (let i=0; i<weights.length; i++) {
        r -= weights[i]
        if (r<=0) return DEBRIS_TYPES[i]
      }
      return DEBRIS_TYPES[4]
    }

    function spawnDebris() {
      const p    = params.current
      const type = pickDebrisType()

      // Spawn from a random LEO belt or from all directions
      const beltSpawn = p.showBelts && Math.random() < 0.7
      let spawnRadius = 280
      if (beltSpawn) {
        const belt = LEO_BELTS[Math.floor(Math.random()*LEO_BELTS.length)]
        spawnRadius = belt.radius + (Math.random()-0.5)*belt.width
      }

      const ang   = Math.random()*Math.PI*2
      const diam  = p.selectedType !== null ? p.debrisDiameter : type.diameter
      const dens  = p.selectedType !== null ? p.debrisDensity  : type.density
      const vel   = p.selectedType !== null ? p.debrisVelocity : type.velocity
      const mass  = debrisMass(diam, dens)
      const pixSpeed = vel * SCALE * 0.016

      p.debrisParticles.push({
        x:           Math.cos(ang)*spawnRadius,
        y:           Math.sin(ang)*spawnRadius,
        vx:         -Math.cos(ang)*pixSpeed,
        vy:         -Math.sin(ang)*pixSpeed,
        realVelocity: vel,
        diameter:    diam,
        density:     dens,
        mass,
        type,
        // Visual
        pixSize:     Math.max(1.5, Math.log10(diam*1000+1.1)*5),
        trailLength: 6 + Math.floor(vel/3000),
        entryHeat:   0,  // 0-1 heating effect
        id:          Math.random(),
        age:         0,
        fromBelt:    beltSpawn,
      })
      p.debrisDetected++
    }

    function spawnParticle(x, y, color, n=8) {
      for (let i=0;i<n;i++) {
        const a=Math.random()*Math.PI*2
        const s=0.5+Math.random()*2.5
        params.current.particles.push({
          x,y, vx:Math.cos(a)*s, vy:Math.sin(a)*s,
          color, life:1, size:1+Math.random()*2.5, id:Math.random()
        })
      }
    }

    function step() {
      const p   = params.current
      const now = Date.now()
      p.time   += 0.016

      // ── COMPUTE PHYSICS ──
      const nXe      = xenonNumberDensity(p.xenonMass, p.xenonVolumeM3)
      const vThermal = xenonThermalSpeed(p.plasmaTemp)
      const rGyro    = gyroradius(vThermal, p.magneticFieldT)
      const confFrac = confinedFraction(p.magneticFieldT, p.mirrorRatio)
      const hFlux    = plasmaHeatFlux(p.plasmaTemp)
      const dMass    = debrisMass(p.debrisDiameter, p.debrisDensity)
      const dArea    = Math.PI*(p.debrisDiameter/2)**2

      const vAfterGas = p.shieldActive && nXe>0
        ? velocityAfterGas(p.debrisVelocity, dMass, nXe, p.debrisDiameter, 50)
        : p.debrisVelocity

      const ablRate    = ablationRate(hFlux, dArea)
      const transitT   = 50/Math.max(vAfterGas,1)
      const massAbl    = ablRate*transitT
      const fracAbl    = Math.min(1, massAbl/Math.max(dMass,1e-30))
      const velRed     = Math.max(0,1-vAfterGas/Math.max(p.debrisVelocity,1))
      const penDepth   = penetrationDepth(p.debrisDiameter,vAfterGas,p.debrisDensity)
      const penetrates = penDepth > HULL_THICKNESS
      const shieldEff  = Math.min(1, fracAbl*0.5+velRed*0.3+confFrac*0.2)

      p.computed = {
        xenonDensity:nXe, thermalSpeed:vThermal, heatFlux:hFlux,
        gyroradius:rGyro, confinedFraction:confFrac, shieldEfficiency:shieldEff,
        debrisMass:dMass, penetrationDepth:penDepth, velocityInShield:vAfterGas,
        fractionAblated:fracAbl, penetrates, velocityReduction:velRed
      }

      // ── SHIELD STATE ──
      if (p.shieldActive && p.xenonMass>0) {
        p.xenonMass = Math.max(0, p.xenonMass-(p.xenonFlowRate/60)*0.016)
        const solarW   = p.mirrorActive ? solarPower(p.mirrorAreaM2) : 0
        const totalPow = p.onboardPowerW+solarW
        const plasmaMass = nXe*mXe*p.xenonVolumeM3
        const dTdt = plasmaMass>0 ? totalPow/(plasmaMass*520) : totalPow/520
        const cooling = stefanBoltzmann*p.plasmaTemp**4*1e-8
        p.plasmaTemp = Math.max(300, p.plasmaTemp+(dTdt-cooling)*0.016*100)
        if (p.xenonMass<=0) p.shieldActive=false
      } else {
        p.plasmaTemp = Math.max(300, p.plasmaTemp-(p.plasmaTemp-300)*0.01)
      }

      // Spawn
      if (Math.random()<p.debrisSpawnRate) spawnDebris()

      // Process debris
      const toRemove = []
      for (const d of p.debrisParticles) {
        d.x  += d.vx; d.y += d.vy; d.age++
        const dist = Math.sqrt(d.x**2+d.y**2)

        // Entry heating effect — debris glows as it enters shield
        if (dist < 220 && d.type.entryGlow) {
          d.entryHeat = Math.min(1, d.entryHeat+0.05)
        }

        if (p.shieldActive && dist<185 && dist>95) {
          const nXeL = xenonNumberDensity(p.xenonMass, p.xenonVolumeM3)
          d.realVelocity = velocityAfterGas(d.realVelocity,d.mass,nXeL,d.diameter,2)
          d.vx *= 0.998; d.vy *= 0.998

          const dA2   = Math.PI*(d.diameter/2)**2
          const ablM  = ablationRate(hFlux,dA2)*0.016
          d.mass      = Math.max(0, d.mass-ablM)
          d.diameter  = d.mass>0 ? 2*Math.cbrt((3*d.mass)/(4*Math.PI*d.density)) : 0

          if (d.mass<=0) {
            p.collisionEvents.push({x:d.x,y:d.y,type:'ABLATION',
              color:d.type.glowColor,time:now})
            spawnParticle(canvas.width/2+d.x,canvas.height/2+d.y,d.type.glowColor,12)
            toRemove.push(d.id); p.debrisNeutralized++; continue
          }

          const pD = penetrationDepth(d.diameter,d.realVelocity,d.density)
          if (pD<HULL_THICKNESS*0.5&&d.realVelocity<1000) {
            p.collisionEvents.push({x:d.x,y:d.y,type:'SLOWDOWN',
              color:d.type.glowColor,time:now})
            spawnParticle(canvas.width/2+d.x,canvas.height/2+d.y,'#44aaff',8)
            toRemove.push(d.id); p.debrisNeutralized++; continue
          }
        }

        if (dist<42) {
          const pD  = penetrationDepth(d.diameter,d.realVelocity,d.density)
          const hulls = pD/HULL_THICKNESS
          p.hullIntegrity = Math.max(0, p.hullIntegrity-Math.min(40,hulls*15+d.diameter*200))
          p.collisionEvents.push({x:d.x,y:d.y,type:'PENETRATION',
            color:d.type.glowColor,time:now})
          spawnParticle(canvas.width/2+d.x,canvas.height/2+d.y,d.type.color,14)
          toRemove.push(d.id); p.debrisPenetrated++; continue
        }

        if (dist>330) toRemove.push(d.id)
      }

      p.debrisParticles = p.debrisParticles.filter(d=>!toRemove.includes(d.id))
      p.collisionEvents = p.collisionEvents.filter(e=>now-e.time<700)

      for (const pt of p.particles) {
        pt.x+=pt.vx; pt.y+=pt.vy
        pt.life-=0.035; pt.vx*=0.94; pt.vy*=0.94
      }
      p.particles = p.particles.filter(pt=>pt.life>0)

      // Chart
      if (now-p.lastChart>2000) {
        const h=histRef.current
        h.t.push(Math.floor(p.time))
        h.neutralized.push(p.debrisNeutralized)
        h.penetrated.push(p.debrisPenetrated)
        h.plasma.push(Math.floor(p.plasmaTemp))
        h.efficiency.push(Math.floor(shieldEff*100))
        if (h.t.length>30) {
          h.t.shift();h.neutralized.shift()
          h.penetrated.shift();h.plasma.shift();h.efficiency.shift()
        }
        p.lastChart=now
        drawChart(cctx)
      }

      drawMain(ctx,canvas,p,now)
      setUi({
        shieldActive:p.shieldActive, mirrorActive:p.mirrorActive,
        xenonMass:p.xenonMass, plasmaTemp:p.plasmaTemp,
        magneticFieldT:p.magneticFieldT, hullIntegrity:p.hullIntegrity,
        debrisDetected:p.debrisDetected, debrisNeutralized:p.debrisNeutralized,
        debrisPenetrated:p.debrisPenetrated, computed:p.computed,
        debrisDiameter:p.debrisDiameter, debrisVelocity:p.debrisVelocity,
        debrisDensity:p.debrisDensity, selectedType:p.selectedType,
        showBelts:p.showBelts, showOrbits:p.showOrbits,
      })

      animRef.current = requestAnimationFrame(step)
    }

    animRef.current = requestAnimationFrame(step)
    return ()=>cancelAnimationFrame(animRef.current)
  }, [])

  function drawMain(ctx, canvas, p, now) {
    const cx = canvas.width/2
    const cy = canvas.height/2
    const c  = p.computed

    // Deep space background
    ctx.fillStyle='#000008'
    ctx.fillRect(0,0,canvas.width,canvas.height)

    // Milky way glow (subtle)
    const mwGrad = ctx.createLinearGradient(0,0,canvas.width,canvas.height)
    mwGrad.addColorStop(0,'rgba(20,15,40,0.3)')
    mwGrad.addColorStop(0.5,'rgba(40,30,60,0.15)')
    mwGrad.addColorStop(1,'rgba(10,5,20,0.3)')
    ctx.fillStyle=mwGrad
    ctx.fillRect(0,0,canvas.width,canvas.height)

    // Stars — varied sizes and colors like real stars
    const starColors=['#ffffff','#ffe8cc','#cce8ff','#ffeeaa','#ccddff']
    for (let i=0;i<250;i++) {
      const sx=(i*137.508)%canvas.width
      const sy=(i*97.333)%canvas.height
      const twinkle=0.15+Math.abs(Math.sin(p.time*0.3+i*0.7))*0.5
      const size = i%20===0?2:i%7===0?1.5:1
      ctx.fillStyle=starColors[i%starColors.length].replace(')',`,${twinkle})`).replace('rgb','rgba').replace('#','rgba(').replace(/([0-9a-f]{2})/gi,(m)=>parseInt(m,16)+',')
      // simpler star rendering:
      const brightness = 0.1+Math.abs(Math.sin(p.time*0.3+i*0.7))*0.6
      ctx.fillStyle=`rgba(255,255,255,${brightness})`
      if (i%15===0) ctx.fillStyle=`rgba(255,220,180,${brightness})`
      if (i%23===0) ctx.fillStyle=`rgba(180,200,255,${brightness})`
      ctx.fillRect(sx,sy,size,size)
    }

    // Earth glow at bottom (we're in LEO)
    const earthGrad=ctx.createRadialGradient(cx,canvas.height+180,100,cx,canvas.height+180,380)
    earthGrad.addColorStop(0,'rgba(20,80,200,0.25)')
    earthGrad.addColorStop(0.5,'rgba(10,40,120,0.15)')
    earthGrad.addColorStop(1,'rgba(0,0,0,0)')
    ctx.fillStyle=earthGrad
    ctx.fillRect(0,0,canvas.width,canvas.height)

    // ── LEO DEBRIS BELTS ──
    if (p.showBelts) {
      for (const belt of LEO_BELTS) {
        // Belt ring
        ctx.strokeStyle=belt.color.replace('0.','0.6)')
                                   .replace('rgba(','').replace(')','')
        // Draw as thick ring
        for (let w=0;w<belt.width;w++) {
          const alpha=0.04*(1-w/belt.width)
          ctx.strokeStyle=belt.color.replace(/[\d.]+\)$/,`${alpha})`)
          ctx.lineWidth=3
          ctx.beginPath()
          ctx.arc(cx,cy,belt.radius-belt.width/2+w,0,Math.PI*2)
          ctx.stroke()
        }

        // Debris specks IN the belt
        for (let i=0;i<12;i++) {
          const ang = (i/12)*Math.PI*2 + p.time*0.02*(i%3===0?1:-1)
          const r   = belt.radius + (Math.sin(i*7.3)*belt.width*0.4)
          const x   = cx+Math.cos(ang)*r
          const y   = cy+Math.sin(ang)*r
          ctx.fillStyle=belt.labelColor.replace(')',',0.4)').replace('#','rgba(')
          // simple dot for belt debris
          ctx.fillStyle=`rgba(200,150,100,0.3)`
          ctx.fillRect(x,y,1,1)
        }

        // Belt label
        const labelAng = -Math.PI/4
        const lx = cx+Math.cos(labelAng)*(belt.radius)
        const ly = cy+Math.sin(labelAng)*(belt.radius)
        ctx.fillStyle=belt.labelColor
        ctx.font='8px monospace'
        ctx.fillText(belt.name.split('(')[1]?.replace(')','')+'',lx+4,ly)
      }
    }

    // Orbit ring for spacecraft
    if (p.showOrbits) {
      ctx.strokeStyle='rgba(60,120,180,0.15)'
      ctx.lineWidth=1; ctx.setLineDash([4,8])
      ctx.beginPath(); ctx.arc(cx,cy,0,0,Math.PI*2); ctx.stroke()
      ctx.setLineDash([])
    }

    // ── SHIELD LAYERS ──
    if (p.shieldActive) {
      // Magnetic field lines
      const fieldAlpha = 0.06+p.magneticFieldT*4
      const pulse = 0.7+Math.sin(p.time*2)*0.3
      ctx.strokeStyle=`rgba(80,120,255,${fieldAlpha*pulse})`
      ctx.lineWidth=0.8
      const lineCount=Math.floor(4+(c.confinedFraction||0)*6)
      for (let a=0;a<Math.PI*2;a+=Math.PI*2/lineCount) {
        ctx.beginPath()
        for (let t=-Math.PI/2;t<=Math.PI/2;t+=0.04) {
          const r=185*Math.cos(t)**2
          const x=cx+r*Math.cos(t+a+p.time*0.05)
          const y=cy+r*Math.sin(t+a+p.time*0.05)*0.55
          t===-Math.PI/2?ctx.moveTo(x,y):ctx.lineTo(x,y)
        }
        ctx.stroke()
      }

      // Xenon cloud
      if (p.xenonMass>0) {
        const densNorm=Math.min(1,(c.xenonDensity||0)/1e15)
        const xa=densNorm*0.45
        for (let layer=0;layer<3;layer++) {
          const grad=ctx.createRadialGradient(cx,cy,45+layer*15,cx,cy,155+layer*15)
          grad.addColorStop(0,'rgba(100,160,255,0)')
          grad.addColorStop(0.5,`rgba(120,180,255,${xa*0.4})`)
          grad.addColorStop(0.85,`rgba(140,200,255,${xa*0.7})`)
          grad.addColorStop(1,'rgba(140,200,255,0)')
          ctx.fillStyle=grad
          ctx.beginPath(); ctx.arc(cx,cy,170+layer*10,0,Math.PI*2); ctx.fill()
        }
      }

      // Plasma layer
      const tNorm=Math.min(1,p.plasmaTemp/15000)
      const flick=0.85+Math.sin(p.time*7)*0.15
      const pr=Math.floor(100+tNorm*155)
      const pGrad=ctx.createRadialGradient(cx,cy,88,cx,cy,168)
      pGrad.addColorStop(0,`rgba(${pr},60,255,0)`)
      pGrad.addColorStop(0.4,`rgba(${pr},60,255,${tNorm*0.2*flick})`)
      pGrad.addColorStop(0.78,`rgba(${pr},60,255,${tNorm*0.55*flick})`)
      pGrad.addColorStop(1,`rgba(${pr},60,255,0)`)
      ctx.fillStyle=pGrad
      ctx.beginPath(); ctx.arc(cx,cy,168,0,Math.PI*2); ctx.fill()

      // Efficiency ring
      ctx.strokeStyle=`rgba(0,255,120,${(c.shieldEfficiency||0)*0.7})`
      ctx.lineWidth=1.5; ctx.setLineDash([4,6])
      ctx.beginPath()
      ctx.arc(cx,cy,192,0,Math.PI*2*(c.shieldEfficiency||0))
      ctx.stroke(); ctx.setLineDash([])
    }

    // Solar mirror
    if (p.mirrorActive&&p.shieldActive) {
      const rayCount=Math.floor(p.mirrorAreaM2/3)
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
      ctx.lineWidth=2; ctx.beginPath()
      ctx.arc(cx+178,cy,32,-Math.PI*0.65,Math.PI*0.65); ctx.stroke()
    }

    // Spacecraft
    const hullCol=p.hullIntegrity>60?'#1a2a3a':p.hullIntegrity>30?'#3a2a1a':'#3a1510'
    const hullStr=p.hullIntegrity>60?'#3a6a9a':p.hullIntegrity>30?'#9a6a2a':'#cc3010'

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

    if (p.hullIntegrity<50) {
      ctx.strokeStyle=`rgba(255,80,30,${(50-p.hullIntegrity)/50})`
      ctx.lineWidth=0.8; ctx.beginPath()
      ctx.moveTo(cx-8,cy-18); ctx.lineTo(cx+4,cy-4)
      ctx.lineTo(cx-2,cy+18); ctx.stroke()
    }

    ctx.fillStyle='#0a2a5a'; ctx.strokeStyle='#1a4a8a'; ctx.lineWidth=1
    ctx.fillRect(cx-95,cy-7,52,14); ctx.strokeRect(cx-95,cy-7,52,14)
    ctx.fillRect(cx+43,cy-7,52,14); ctx.strokeRect(cx+43,cy-7,52,14)
    ctx.strokeStyle='rgba(30,80,150,0.4)'; ctx.lineWidth=0.5
    for (let i=1;i<4;i++) {
      ctx.beginPath(); ctx.moveTo(cx-95+i*13,cy-7); ctx.lineTo(cx-95+i*13,cy+7); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(cx+43+i*13,cy-7); ctx.lineTo(cx+43+i*13,cy+7); ctx.stroke()
    }

    // Hull integrity bar
    const hc=p.hullIntegrity>60?'#00ff88':p.hullIntegrity>30?'#ffaa00':'#ff3333'
    ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(cx-80,cy+32,160,8)
    ctx.fillStyle=hc; ctx.fillRect(cx-80,cy+32,160*(p.hullIntegrity/100),8)
    ctx.strokeStyle='#1a2a3a'; ctx.lineWidth=1; ctx.strokeRect(cx-80,cy+32,160,8)
    ctx.fillStyle='#888'; ctx.font='9px monospace'
    ctx.fillText(`HULL ${p.hullIntegrity.toFixed(0)}%`,cx-18,cy+52)

    // ── DEBRIS PARTICLES ──
    for (const d of p.debrisParticles) {
      const x=cx+d.x; const y=cy+d.y
      const dist=Math.sqrt(d.x**2+d.y**2)
      const inShield=dist<185&&p.shieldActive
      const slowFrac=Math.max(0,1-d.realVelocity/d.type.velocity)

      // Entry heating glow for meteorites
      if (d.entryHeat>0) {
        const heatGrad=ctx.createRadialGradient(x,y,0,x,y,d.pixSize*6)
        heatGrad.addColorStop(0,`rgba(255,150,30,${d.entryHeat*0.8})`)
        heatGrad.addColorStop(1,'rgba(255,80,0,0)')
        ctx.fillStyle=heatGrad
        ctx.beginPath(); ctx.arc(x,y,d.pixSize*6,0,Math.PI*2); ctx.fill()
      }

      // Outer glow
      const glowCol=inShield?d.type.glowColor:d.type.color
      const gGrad=ctx.createRadialGradient(x,y,0,x,y,d.pixSize*3)
      gGrad.addColorStop(0,glowCol+'aa')
      gGrad.addColorStop(1,'rgba(0,0,0,0)')
      ctx.fillStyle=gGrad
      ctx.beginPath(); ctx.arc(x,y,d.pixSize*3,0,Math.PI*2); ctx.fill()

      // Trail — color from debris type
      const trailLen = d.trailLength*(1+d.entryHeat*2)
      ctx.strokeStyle=d.type.trailColor+'55'
      ctx.lineWidth=d.pixSize*0.8
      ctx.beginPath(); ctx.moveTo(x,y)
      ctx.lineTo(x-d.vx*trailLen,y-d.vy*trailLen); ctx.stroke()

      // Core — changes color as it slows
      const mixCol = inShield && slowFrac>0.1
        ? `rgba(255,${Math.floor(150+slowFrac*100)},50,0.9)`
        : d.type.color+'dd'
      ctx.fillStyle=mixCol
      ctx.beginPath(); ctx.arc(x,y,d.pixSize,0,Math.PI*2); ctx.fill()

      // Size dot at center
      ctx.fillStyle='rgba(255,255,255,0.6)'
      ctx.beginPath(); ctx.arc(x,y,Math.max(0.5,d.pixSize*0.3),0,Math.PI*2); ctx.fill()
    }

    // Visual particles
    for (const pt of p.particles) {
      ctx.globalAlpha=pt.life
      ctx.fillStyle=pt.color
      ctx.beginPath(); ctx.arc(pt.x,pt.y,pt.size*pt.life,0,Math.PI*2); ctx.fill()
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

    // ── HUD ──
    ctx.fillStyle='rgba(0,4,12,0.82)'
    ctx.fillRect(10,10,228,215)
    ctx.strokeStyle='#1a3a5a'; ctx.lineWidth=0.5
    ctx.strokeRect(10,10,228,215)
    ctx.fillStyle='#4a8aaa'; ctx.font='10px monospace'
    ctx.fillText('AEGOS SHIELD TELEMETRY',20,28)
    ctx.font='10px monospace'
    const lines=[
      {t:`Status:    ${p.shieldActive?'ACTIVE':'OFFLINE'}`,
       c:p.shieldActive?'#00ff88':'#ff4444'},
      {t:`Plasma:    ${Math.floor(p.plasmaTemp).toLocaleString()} K`,c:'#aa88ff'},
      {t:`Xe Dens:   ${(c.xenonDensity||0).toExponential(1)} /m³`,c:'#88aaff'},
      {t:`Gyrorad:   ${((c.gyroradius||0)*100).toFixed(2)} cm`,c:'#88ddff'},
      {t:`Confined:  ${((c.confinedFraction||0)*100).toFixed(0)}%`,c:'#88ffcc'},
      {t:`Heat Flux: ${((c.heatFlux||0)/1e6).toFixed(0)} MW/m²`,c:'#ffaa88'},
      {t:`Vel→shield:${((c.velocityInShield||0)/1000).toFixed(1)} km/s`,c:'#ffcc44'},
      {t:`Ablated:   ${((c.fractionAblated||0)*100).toFixed(1)}%`,c:'#ff8844'},
      {t:`Pen depth: ${((c.penetrationDepth||0)*1000).toFixed(2)} mm`,
       c:(c.penetrationDepth||0)>HULL_THICKNESS?'#ff4444':'#44ff88'},
      {t:`Shield:    ${((c.shieldEfficiency||0)*100).toFixed(0)}%`,c:'#00ff88'},
      {t:`Hull:      ${p.hullIntegrity.toFixed(0)}%`,c:hc},
      {t:`Neutral:   ${p.debrisNeutralized}`,c:'#44ff88'},
      {t:`Impact:    ${p.debrisPenetrated}`,c:'#ff4444'},
      {t:`Detected:  ${p.debrisDetected}`,c:'#aaaaaa'},
    ]
    lines.forEach((l,i)=>{
      ctx.fillStyle=l.c; ctx.fillText(l.t,20,46+i*12)
    })
  }

  function drawChart(ctx) {
    const h=histRef.current
    const w=chartRef.current.width
    const hh=chartRef.current.height
    ctx.fillStyle='#000d1a'; ctx.fillRect(0,0,w,hh)
    if (h.t.length<2) return
    const maxN=Math.max(...h.neutralized,1)

    ctx.strokeStyle='#44ff88'; ctx.lineWidth=2; ctx.beginPath()
    h.neutralized.forEach((v,i)=>{
      const x=(i/(h.neutralized.length-1))*(w-20)+10
      const y=hh-20-(v/maxN)*(hh-30)
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)
    }); ctx.stroke()

    ctx.strokeStyle='#ff4444'; ctx.lineWidth=2; ctx.beginPath()
    h.penetrated.forEach((v,i)=>{
      const x=(i/(h.penetrated.length-1))*(w-20)+10
      const y=hh-20-(v/maxN)*(hh-30)
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)
    }); ctx.stroke()

    ctx.strokeStyle='#00ff88'; ctx.lineWidth=1.5
    ctx.setLineDash([3,3]); ctx.beginPath()
    h.efficiency.forEach((v,i)=>{
      const x=(i/(h.efficiency.length-1))*(w-20)+10
      const y=hh-20-(v/100)*(hh-30)
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)
    }); ctx.stroke(); ctx.setLineDash([])

    ctx.font='9px monospace'
    ctx.fillStyle='#44ff88'; ctx.fillText('— Neutralized',10,12)
    ctx.fillStyle='#ff4444'; ctx.fillText('— Penetrated',100,12)
    ctx.fillStyle='#00ff88'; ctx.fillText('--- Efficiency',190,12)
  }

  const set = (key,val) => { params.current[key]=val }
  function loadPreset(name) {
    const pr=DEBRIS_PRESETS[name]
    params.current.debrisDiameter=pr.diameter
    params.current.debrisDensity=pr.density
    params.current.debrisVelocity=pr.velocity
  }

  const eff=ui.debrisDetected>0
    ?((ui.debrisNeutralized/ui.debrisDetected)*100).toFixed(0):0
  const c=ui.computed||{}
  const hc=(ui.hullIntegrity||100)>60?'#00ff88'
          :(ui.hullIntegrity||100)>30?'#ffaa00':'#ff3333'

  return (
    <div style={{
      background:'#000',minHeight:'100vh',
      display:'flex',alignItems:'flex-start',
      justifyContent:'center',gap:'1rem',
      padding:'1rem',fontFamily:'monospace'
    }}>
      <div>
        <canvas ref={canvasRef} width={620} height={580}
          style={{border:'1px solid #1a2a3a',display:'block'}}/>
        <canvas ref={chartRef} width={620} height={110}
          style={{border:'1px solid #1a2a3a',display:'block',
                  marginTop:3,background:'#000d1a'}}/>
      </div>

      <div style={{
        width:275,background:'#050d15',
        border:'1px solid #1a2a3a',color:'#fff',
        alignSelf:'flex-start',fontSize:11
      }}>
        {/* Tabs */}
        <div style={{display:'flex',borderBottom:'1px solid #1a2a3a'}}>
          {['shield','debris','belts','physics'].map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{
              flex:1,padding:'8px 2px',
              background:tab===t?'#0a1a2a':'transparent',
              border:'none',
              borderBottom:tab===t?'2px solid #4a8aaa':'2px solid transparent',
              color:tab===t?'#4a8aaa':'#444',cursor:'pointer',
              fontSize:9,letterSpacing:'0.06em',textTransform:'uppercase'
            }}>{t}</button>
          ))}
        </div>

        <div style={{padding:'1rem'}}>

          {/* ── SHIELD TAB ── */}
          {tab==='shield'&&(<>
            <button onClick={()=>set('shieldActive',!params.current.shieldActive)}
              style={{
                width:'100%',padding:'11px',cursor:'pointer',
                background:ui.shieldActive?'#0a2a0a':'#1a0808',
                border:`1px solid ${ui.shieldActive?'#00ff44':'#ff4400'}`,
                color:ui.shieldActive?'#00ff44':'#ff4400',
                fontSize:12,letterSpacing:'0.1em',marginBottom:'0.75rem'
              }}>
              {ui.shieldActive?'● SHIELD ACTIVE':'○ ACTIVATE SHIELD'}
            </button>

            <button onClick={()=>set('mirrorActive',!params.current.mirrorActive)}
              style={{
                width:'100%',padding:'9px',cursor:'pointer',
                background:ui.mirrorActive?'#181600':'transparent',
                border:`1px solid ${ui.mirrorActive?'#ffdd00':'#2a2a2a'}`,
                color:ui.mirrorActive?'#ffdd00':'#444',
                fontSize:11,marginBottom:'0.9rem'
              }}>
              {ui.mirrorActive?'◉ SOLAR MIRROR ON':'○ SOLAR MIRROR OFF'}
            </button>

            {[
              {label:'Magnetic Field',key:'magneticFieldT',
               min:0.001,max:0.1,step:0.001,
               disp:(ui.magneticFieldT||0.02).toFixed(3),unit:'T',
               note:`${((c.confinedFraction||0)*100).toFixed(0)}% ions confined`},
              {label:'Mirror Ratio',key:'mirrorRatio',
               min:1.1,max:10,step:0.1,
               disp:(params.current.mirrorRatio||3).toFixed(1),unit:'x',
               note:`Loss cone ${(Math.asin(1/Math.sqrt(params.current.mirrorRatio||3))*180/Math.PI).toFixed(0)}°`},
              {label:'Xenon Flow',key:'xenonFlowRate',
               min:0.05,max:2,step:0.05,
               disp:(params.current.xenonFlowRate||0.3).toFixed(2),unit:'kg/min',
               note:`${(ui.xenonMass||100).toFixed(1)} kg remaining`},
              {label:'Mirror Area',key:'mirrorAreaM2',
               min:1,max:50,step:1,
               disp:(params.current.mirrorAreaM2||10).toFixed(0),unit:'m²',
               note:`${(solarPower(params.current.mirrorAreaM2||10)/1000).toFixed(0)} kW solar`},
              {label:'Onboard Power',key:'onboardPowerW',
               min:1000,max:500000,step:1000,
               disp:((params.current.onboardPowerW||50000)/1000).toFixed(0),unit:'kW',
               note:'electron beam heating'},
            ].map(s=>(
              <div key={s.key} style={{marginBottom:'0.8rem'}}>
                <div style={{display:'flex',justifyContent:'space-between',
                             color:'#4a8aaa',marginBottom:3}}>
                  <span>{s.label}</span>
                  <span style={{color:'#fff'}}>{s.disp} {s.unit}</span>
                </div>
                <input type="range" min={s.min} max={s.max} step={s.step}
                  defaultValue={params.current[s.key]||s.min}
                  onChange={e=>set(s.key,parseFloat(e.target.value))}
                  style={{width:'100%',marginBottom:2}}/>
                <div style={{color:'#333',fontSize:9}}>{s.note}</div>
              </div>
            ))}

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

            <div style={{marginTop:'0.75rem'}}>
              <div style={{display:'flex',justifyContent:'space-between',
                           color:'#4a8aaa',marginBottom:4,fontSize:10}}>
                <span>HULL INTEGRITY</span>
                <span style={{color:hc}}>{(ui.hullIntegrity||100).toFixed(0)}%</span>
              </div>
              <div style={{background:'#0a0a0a',height:8,borderRadius:2,overflow:'hidden'}}>
                <div style={{height:'100%',width:`${ui.hullIntegrity||100}%`,
                             background:hc,transition:'width 0.3s'}}/>
              </div>
            </div>

            <div style={{marginTop:'0.75rem',paddingTop:'0.75rem',
                         borderTop:'1px solid #1a2a3a',lineHeight:2}}>
              <div style={{color:'#44ff88'}}>Neutralized: {ui.debrisNeutralized}</div>
              <div style={{color:'#ff4444'}}>Penetrated: {ui.debrisPenetrated}</div>
              <div style={{color:'#aaa'}}>Detected: {ui.debrisDetected}</div>
              <div style={{color:'#fff'}}>Efficiency: {eff}%</div>
            </div>
          </>)}

          {/* ── DEBRIS TAB ── */}
          {tab==='debris'&&(<>
            <div style={{color:'#4a8aaa',fontSize:10,
                         letterSpacing:'0.1em',marginBottom:'0.75rem'}}>
              DEBRIS TYPE
            </div>

            {/* Type selector */}
            <div style={{marginBottom:'0.75rem'}}>
              <button
                onClick={()=>set('selectedType',null)}
                style={{
                  width:'100%',padding:'7px',cursor:'pointer',fontSize:10,
                  background:ui.selectedType===null?'#0a1a2a':'transparent',
                  border:`1px solid ${ui.selectedType===null?'#4a8aaa':'#1a2a3a'}`,
                  color:ui.selectedType===null?'#4a8aaa':'#444',marginBottom:4
                }}>
                ◈ Random Mix (realistic distribution)
              </button>
              {DEBRIS_TYPES.map((d,i)=>(
                <button key={d.name}
                  onClick={()=>{
                    set('selectedType',i)
                    loadPreset(d.name)
                  }}
                  style={{
                    width:'100%',padding:'6px 8px',cursor:'pointer',fontSize:10,
                    background:ui.selectedType===i?'#0a1a2a':'transparent',
                    border:`1px solid ${ui.selectedType===i?'#4a8aaa':'#1a2a3a'}`,
                    color:'#fff',marginBottom:3,
                    display:'flex',alignItems:'center',gap:8,textAlign:'left'
                  }}>
                  <span style={{
                    width:10,height:10,borderRadius:'50%',
                    background:d.color,flexShrink:0,
                    boxShadow:`0 0 4px ${d.glowColor}`
                  }}/>
                  <span style={{flex:1}}>{d.name}</span>
                  <span style={{color:'#444',fontSize:9}}>
                    {(d.velocity/1000).toFixed(0)}km/s
                  </span>
                </button>
              ))}
            </div>

            {/* Selected type info */}
            {ui.selectedType!==null&&(
              <div style={{
                background:'#0a1020',border:'1px solid #1a2a3a',
                padding:'0.75rem',marginBottom:'0.75rem',fontSize:10
              }}>
                <div style={{
                  color:DEBRIS_TYPES[ui.selectedType]?.glowColor,
                  marginBottom:6,fontWeight:'bold'
                }}>
                  {DEBRIS_TYPES[ui.selectedType]?.name}
                </div>
                <div style={{color:'#666',lineHeight:1.8}}>
                  <div>{DEBRIS_TYPES[ui.selectedType]?.description}</div>
                  <div>Origin: {DEBRIS_TYPES[ui.selectedType]?.origin}</div>
                  <div>Material: {DEBRIS_TYPES[ui.selectedType]?.composition}</div>
                </div>
              </div>
            )}

            {/* Custom sliders */}
            {[
              {label:'Diameter',key:'debrisDiameter',
               min:0.0001,max:0.2,step:0.0001,
               disp:((ui.debrisDiameter||0.01)*1000).toFixed(1),unit:'mm'},
              {label:'Density',key:'debrisDensity',
               min:500,max:8000,step:50,
               disp:(ui.debrisDensity||2700).toFixed(0),unit:'kg/m³'},
              {label:'Velocity',key:'debrisVelocity',
               min:100,max:25000,step:100,
               disp:((ui.debrisVelocity||9000)/1000).toFixed(1),unit:'km/s'},
              {label:'Spawn Rate',key:'debrisSpawnRate',
               min:0.005,max:0.15,step:0.005,
               disp:(params.current.debrisSpawnRate*100).toFixed(1),unit:'%'},
            ].map(s=>(
              <div key={s.key} style={{marginBottom:'0.8rem'}}>
                <div style={{display:'flex',justifyContent:'space-between',
                             color:'#4a8aaa',marginBottom:3}}>
                  <span>{s.label}</span>
                  <span style={{color:'#fff'}}>{s.disp} {s.unit}</span>
                </div>
                <input type="range" min={s.min} max={s.max} step={s.step}
                  defaultValue={params.current[s.key]}
                  onChange={e=>set(s.key,parseFloat(e.target.value))}
                  style={{width:'100%'}}/>
              </div>
            ))}

            {/* Physics readout */}
            <div style={{paddingTop:'0.75rem',borderTop:'1px solid #1a2a3a'}}>
              <div style={{color:'#4a8aaa',fontSize:10,
                           marginBottom:6,letterSpacing:'0.08em'}}>PHYSICS READOUT</div>
              {[
                {l:'Mass',v:`${((c.debrisMass||0)*1000).toExponential(2)} g`},
                {l:'KE',v:`${((0.5*(c.debrisMass||0)*(ui.debrisVelocity||9000)**2)/1000).toFixed(0)} kJ`},
                {l:'Vel in shield',v:`${((c.velocityInShield||0)/1000).toFixed(2)} km/s`},
                {l:'Ablated',v:`${((c.fractionAblated||0)*100).toFixed(1)}%`},
                {l:'Pen depth',v:`${((c.penetrationDepth||0)*1000).toFixed(2)} mm`,
                 warn:(c.penetrationDepth||0)>HULL_THICKNESS},
                {l:'Penetrates?',v:c.penetrates?'YES ⚠':'NO ✓',warn:c.penetrates},
              ].map(r=>(
                <div key={r.l} style={{display:'flex',justifyContent:'space-between',
                                       marginBottom:5,fontSize:10}}>
                  <span style={{color:'#555'}}>{r.l}</span>
                  <span style={{color:r.warn?'#ff4444':'#fff'}}>{r.v}</span>
                </div>
              ))}
            </div>
          </>)}

          {/* ── BELTS TAB ── */}
          {tab==='belts'&&(<>
            <div style={{color:'#4a8aaa',fontSize:10,
                         letterSpacing:'0.1em',marginBottom:'0.75rem'}}>
              ORBITAL ENVIRONMENT
            </div>

            <button onClick={()=>set('showBelts',!params.current.showBelts)}
              style={{
                width:'100%',padding:'8px',cursor:'pointer',fontSize:10,
                background:ui.showBelts?'#0a1a0a':'transparent',
                border:`1px solid ${ui.showBelts?'#44aa44':'#2a2a2a'}`,
                color:ui.showBelts?'#44aa44':'#444',marginBottom:'0.75rem'
              }}>
              {ui.showBelts?'◉ Debris Belts VISIBLE':'○ Show Debris Belts'}
            </button>

            {LEO_BELTS.map(belt=>(
              <div key={belt.name} style={{
                marginBottom:'0.9rem',padding:'0.6rem',
                background:'#040c18',border:'1px solid #0a1a2a'
              }}>
                <div style={{
                  display:'flex',alignItems:'center',gap:8,marginBottom:4
                }}>
                  <div style={{
                    width:24,height:8,borderRadius:2,
                    background:belt.color.replace(/[\d.]+\)$/,'0.8)'),
                    flexShrink:0
                  }}/>
                  <span style={{color:belt.labelColor,fontSize:10,fontWeight:'bold'}}>
                    {belt.name.split('(')[0].trim()}
                  </span>
                </div>
                <div style={{color:'#555',fontSize:9,lineHeight:1.7}}>
                  <div style={{color:'#888'}}>{belt.name.match(/\((.+)\)/)?.[1]}</div>
                  <div>{belt.description}</div>
                </div>
              </div>
            ))}

            <div style={{
              marginTop:'0.5rem',padding:'0.75rem',
              background:'#040c18',border:'1px solid #0a1a2a',
              color:'#555',fontSize:9,lineHeight:1.8
            }}>
              <div style={{color:'#4a8aaa',marginBottom:4}}>REAL DEBRIS STATS</div>
              <div>Objects tracked: ~27,000+</div>
              <div>Untracked (&gt;1mm): millions</div>
              <div>LEO density peak: 400-600km</div>
              <div>Main sources:</div>
              <div>• 2009 Iridium-Cosmos collision</div>
              <div>• 2007 Chinese ASAT test</div>
              <div>• Soviet Cosmos fragments</div>
              <div>• Normal mission debris</div>
            </div>
          </>)}

          {/* ── PHYSICS TAB ── */}
          {tab==='physics'&&(<>
            <div style={{color:'#4a8aaa',fontSize:10,
                         letterSpacing:'0.1em',marginBottom:'0.75rem'}}>
              REAL-TIME PHYSICS
            </div>
            {[
              {l:'Xe number density',v:`${(c.xenonDensity||0).toExponential(2)} m⁻³`,
               note:'mass/volume × Avogadro'},
              {l:'Xe thermal speed',v:`${((c.thermalSpeed||0)/1000).toFixed(2)} km/s`,
               note:'Maxwell-Boltzmann'},
              {l:'Ion gyroradius',v:`${((c.gyroradius||0)*100).toFixed(2)} cm`,
               note:'Larmor radius'},
              {l:'Confined fraction',v:`${((c.confinedFraction||0)*100).toFixed(1)}%`,
               note:'Magnetic mirror'},
              {l:'Heat flux',v:`${((c.heatFlux||0)/1e6).toFixed(0)} MW/m²`,
               note:'Stefan-Boltzmann'},
              {l:'Vel reduction',v:`${((c.velocityReduction||0)*100).toFixed(1)}%`,
               note:'Stopping power'},
              {l:'Mass ablated',v:`${((c.fractionAblated||0)*100).toFixed(2)}%`,
               note:'Thermal ablation'},
              {l:'Shield efficiency',v:`${((c.shieldEfficiency||0)*100).toFixed(1)}%`,
               note:'Combined layers'},
              {l:'Pen depth',v:`${((c.penetrationDepth||0)*1000).toFixed(3)} mm`,
               note:'Cour-Palais (NASA)'},
              {l:'Hull thickness',v:'3.000 mm',note:'ISS standard Al'},
            ].map(r=>(
              <div key={r.l} style={{marginBottom:'0.8rem'}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:1}}>
                  <span style={{color:'#666',fontSize:10}}>{r.l}</span>
                  <span style={{color:'#fff',fontSize:11}}>{r.v}</span>
                </div>
                <div style={{color:'#2a2a2a',fontSize:9}}>{r.note}</div>
              </div>
            ))}

            <div style={{
              marginTop:'0.5rem',paddingTop:'0.75rem',
              borderTop:'1px solid #1a2a3a',
              color:'#2a2a2a',fontSize:9,lineHeight:1.9
            }}>
              Equations:<br/>
              • Maxwell-Boltzmann (thermal speed)<br/>
              • Lorentz magnetic mirror<br/>
              • Stefan-Boltzmann (heat flux)<br/>
              • Cour-Palais (hypervelocity)<br/>
              • Momentum transfer stopping<br/>
              • Thermal ablation (sublimation)
            </div>
          </>)}

        </div>
      </div>
    </div>
  )
}
