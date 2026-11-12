// Adapted from @norbert_bodziony/bloub 0.6.4 (MIT), Copyright (c) 2026 Jérémy Perret.
// Source: NorbertBodziony/bloub@7983de0bb7e868ac84881581eaa8c2e1f459dd30.
// Full license: ../assets/Bloub-LICENSE.txt. No SolidJS runtime is included.
interface PlushPad { kw: number; kh: number }

/**
 * Le patin sur une gelule de `w` x `h` px : des morceaux d'une gelule de feutre, jamais etiree.
 *
 * Le feutre (`tools/peluche/fit/feutre.py`) a un grain et une frange : etire, chaque fibre
 * devenait une raie. Chaque patin est donc cuit en gelule, couchee (`x`) et debout (`y`) : le
 * patin rond (la gelule ajustee sans sa partie droite) allonge d'une partie droite de
 * `2 BARRE` petits cotes, le feutre lu sur le patin rond et prolonge dans la partie droite. Les
 * deux bouts sont le patin rond tel quel ; la partie droite est SYMETRIQUE (et a la meme
 * lumiere partout). Sur une gelule longue de `2 e` de plus que large, a l'echelle `u` du
 * petit cote, chaque moitie montre son bout et `e` de partie droite :
 * - jusqu'a `BARRE`, d'un seul morceau. Les deux moities se rejoignent au centre sur deux
 *   colonnes symetriques de l'image : la meme matiere ;
 * - au-dela, par troncons de `BARRE` : l'image lue jusqu'a son milieu, puis au-dela de son
 *   milieu (le reflet de ce qui precede), et ainsi de suite. Jusqu'a `BARRES` troncons ; plus
 *   loin, ils s'etirent (aucun oeil du catalogue n'y va).
 *
 * Aucune coupe ne tombe sur le bord d'une image (le bord d'un `<image>` est antialiase en plus
 * de la coupe : un liseré). Toutes sont paralleles, et les morceaux s'additionnent
 * (`plus-lighter`) dans un groupe isole : leurs couvertures antialiasees se completent a 1.
 * Tout est continu en `w`, `h`, l'image elle-meme comprise quand l'oeil passe de couche a
 * debout : sur une gelule ronde, les deux images montrent le MEME patin rond (`matiere.py`).
 */
export interface PadPiece {
  /** l'image : la gelule couchee (`x`) ou debout (`y`) */
  src: 'x' | 'y'
  /** le rectangle ou le morceau est pose, centre sur l'oeil */
  x: number
  y: number
  w: number
  h: number
  /** ce qu'il montre de son image (0 a 1) : le `viewBox` de l'`<svg>` imbrique */
  viewBox: string
}

/** un troncon de partie droite, en petits cotes : la moitie de celle de l'image (`barre` de `matiere.py`) */
export const BARRE = 0.5

/**
 * Au-dela de ce nombre de troncons de chaque cote, ils s'etirent plutot que de se multiplier
 * (CHOISI) : aucun oeil du catalogue ne va si loin ; le plus long (Vita, 3,8 fois plus long que
 * large) en demande trois.
 */
export const BARRES = 3

/** Les morceaux du patin `pad` pose sur une gelule de `w` x `h` px. */
export function padPieces(pad: PlushPad, w: number, h: number): PadPiece[] {
  const court = Math.min(w, h)
  const surX = w >= h
  const e = (Math.max(w, h) - court) / 2
  // le long de l'axe long (a) et en travers (b) : le patin rond, puis l'image entiere
  const [Sa, Sb] = surX ? [pad.kw * court, pad.kh * court] : [pad.kh * court, pad.kw * court]
  const L = BARRE * court
  const T = Sa + 2 * L
  const morceau = (a0: number, a1: number, i0: number, i1: number): PadPiece =>
    surX
      ? { src: 'x', x: a0, y: -Sb / 2, w: a1 - a0, h: Sb, viewBox: `${i0 / T} 0 ${(i1 - i0) / T} 1` }
      : { src: 'y', x: -Sb / 2, y: a0, w: Sb, h: a1 - a0, viewBox: `0 ${i0 / T} 1 ${(i1 - i0) / T}` }
  // a gauche : [a0, a1] a l'ecran montre [i0, i1] de l'image (px a l'echelle u) ; a droite, le reflet
  const out: PadPiece[] = []
  const paire = (a0: number, a1: number, i0: number, i1: number) => {
    out.push(morceau(a0, a1, i0, i1))
    out.push(morceau(-a1, -a0, T - i1, T - i0))
  }
  // un troncon a l'ecran : `L`, etire au-dela de `BARRES`
  const P = Math.max(L, e / BARRES)
  if (P === L) {
    // pas etire : le bout et le premier troncon d'un morceau
    paire(-e - Sa / 2, Math.min(-e + L, 0), 0, Sa / 2 + Math.min(e, L))
  } else {
    paire(-e - Sa / 2, -e, 0, Sa / 2)
  }
  for (let k = P === L ? 1 : 0; k * P < e - 1e-9 * court; k++) {
    const a0 = -e + k * P
    const a1 = Math.min(a0 + P, 0)
    // pair : depuis le debut de la partie droite ; impair : depuis son milieu
    const i0 = Sa / 2 + (k % 2) * L
    paire(a0, a1, i0, i0 + ((a1 - a0) / P) * L)
  }
  return out
}

/** La demi-etendue des morceaux, centres sur l'oeil : ce que couvrent les images, frange et ombre comprises. */
export function padExtent(pieces: readonly PadPiece[]): { x: number; y: number } {
  let x = 0
  let y = 0
  for (const m of pieces) {
    x = Math.max(x, Math.abs(m.x), Math.abs(m.x + m.w))
    y = Math.max(y, Math.abs(m.y), Math.abs(m.y + m.h))
  }
  return { x, y }
}
