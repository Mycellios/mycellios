// MIT, Copyright (c) 2026 Jérémy Perret. See ../assets/Bloub-LICENSE.txt.
// Adapted from NorbertBodziony/bloub@7983de0bb7e868ac84881581eaa8c2e1f459dd30.
// Pure idle gaze/blink math only; no OpenBot application code or Solid runtime.
const TAU = Math.PI * 2;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
export function loopNoise(t: number, period: number, seed = 0): number {
  const p = (t / period) * TAU
  return (
    0.55 * Math.sin(p + seed) +
    0.3 * Math.sin(2 * p + seed * 1.7 + 1.1) +
    0.15 * Math.sin(3 * p + seed * 2.3 + 2.4)
  )
}

/** PRNG deterministe (mulberry32) : meme sequence a chaque lecture. */
export function createRng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}


export interface Liveliness {
  dYaw: number
  dPitch: number
  dRoll: number
  /** 1 = oeil ouvert, 0 = ferme (ecrasement vertical en repere ecran) */
  lid: number
  driftX: number
  driftY: number
  breath: number
}

const BLINK_RNG = createRng(0x5eed)
/** Calendrier de clignements pre-tire : deterministe et sans etat. */
const BLINKS: number[] = (() => {
  const out: number[] = []
  let t = 1.4
  while (t < 900) {
    out.push(t)
    // 1.9 a 4.6 s entre deux clignements, plus un double clignement parfois
    t += 1.9 + BLINK_RNG() * 2.7
    if (BLINK_RNG() < 0.18) {
      out.push(t)
      t += 0.24
    }
  }
  return out
})()

/** Mesure : 1 a 2 frames a 10 fps. */
const BLINK_DUR = 0.18

function blinkLid(t: number): number {
  for (let i = 0; i < BLINKS.length; i++) {
    const start = BLINKS[i]!
    if (t < start) break
    const k = (t - start) / BLINK_DUR
    if (k >= 0 && k <= 1) {
      // fermeture rapide, reouverture un peu plus lente
      return k < 0.45 ? 1 - k / 0.45 : (k - 0.45) / 0.55
    }
  }
  return 1
}

export interface LivelinessOptions {
  wander?: number
  blink?: boolean
  float?: boolean
}

export function liveliness(t: number, opt: LivelinessOptions = {}): Liveliness {
  const { wander = 1, blink = true, float = true } = opt

  // Periodes premieres entre elles : la derive ne se repete jamais a l'oeil.
  return {
    dYaw: (loopNoise(t, 11.3, 0.4) * 5.5 + loopNoise(t, 3.7, 2.1) * 1.6) * wander,
    dPitch: (loopNoise(t, 9.1, 1.3) * 4.2 + loopNoise(t, 4.3, 0.7) * 1.3) * wander,
    dRoll: loopNoise(t, 13.7, 3.2) * 2.2 * wander,
    lid: blink ? blinkLid(t) : 1,
    // Au repos la video est quasiment immobile (centre stable a +-0.003, rayon
    // constant) : toute la vie passe par le regard et les clignements. On garde
    // juste de quoi ne pas figer completement l'image.
    driftX: float ? loopNoise(t, 7.9, 1.9) * 0.006 : 0,
    driftY: float ? loopNoise(t, 5.3, 0.3) * 0.007 : 0,
    // La largeur est constante, seule la hauteur respire tres legerement.
    breath: float ? 1 + Math.sin((t / 3.4) * Math.PI * 2) * 0.005 : 1
  }
}

/**
 * Le clignement est un ecrasement VERTICAL en repere ecran autour du centre de
 * l'oeil (mesure : la largeur de bbox est conservee, la hauteur tombe a ~0.35),
 * pas un retrecissement le long de l'axe incline de la gelule. On le compose
 * donc apres la matrice tangente, en n'affectant que les sorties en y.
 */
export function blinkScale(lid: number): number {
  return 0.06 + 0.94 * clamp(lid)
}


/** Mycellios runtime states lend the face a pose, never change body/color. */
export function myceliumEyeFrame(seconds: number, status: string | undefined, phase = 0, hover = false) {
  const t = Math.max(0, seconds + phase) % 890;
  const life = liveliness(t, { float: false });
  const working = status === "queued" || status === "leased" || status === "running";
  const waiting = status === "waiting_input" || status === "waiting_takeover";
  const failed = status === "failed";
  const asleep = status === "asleep" || status === "offline";
  const responded = status === "completed" || status === "succeeded";
  const mood = working ? "working" : waiting ? "waiting" : failed ? "failed" : asleep ? "asleep" : responded ? "responded" : "idle";
  return {
    mood,
    x: life.dYaw * 0.14 + (working ? Math.sin(t * 1.3) * 1.4 : waiting ? 0.7 : hover ? 0.8 : 0),
    y: life.dPitch * -0.12 + (working ? -1.4 : failed ? 1.2 : hover ? -0.6 : 0),
    roll: life.dRoll * 0.3 + (waiting ? -2 : 0),
    // A blink is a moving eyelid mask, not a squash of the felt texture.
    lid: asleep ? 0.06 : Math.max(0.06, Math.min(life.lid, responded ? 0.58 : 1)),
    leftLid: hover && !working && (t % 7) < 0.22 ? 0.08 : undefined,
  };
}
