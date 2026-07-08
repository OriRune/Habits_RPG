// ============================================================================
//  TOWN DECOR — edit this file to tune the Homestead decor catalog.
// ============================================================================
//
//  Cosmetic props for "The Homestead" (src/engine/town.ts). Unlike buildings,
//  decor is NOT unique — it repeats up to a per-type cap (TOWN_DECOR_PER_TYPE_CAP)
//  and a global cap (TOWN_DECOR_CAP). Each entry charges gold + materials at
//  placement; removeDecor refunds 50% of the materials. Decor grants small
//  prestige (1–3 each) toward deed/Chapel gates. Pure data — see townBuildings.ts.
//
//  FIELDS
//  ------
//  w, h        Footprint in cells (most decor is 1×1; the fountain is 2×2).
//  gold        Charged at placement (bypassed by the unlimitedGold dev switch).
//  materials   Charged at placement (never bypassed).
//  prestige    Prestige granted while placed.
// ============================================================================

export interface TownDecorDef {
  key: string;
  name: string;
  w: number;
  h: number;
  gold: number;
  materials: Record<string, number>;
  prestige: number;
  artKey: string;
}

export const TOWN_DECOR: Record<string, TownDecorDef> = {
  lamppost:    { key: 'lamppost',    name: 'Lamppost',    w: 1, h: 1, gold: 15, materials: { wood: 1 },  prestige: 1, artKey: 'lamppost' },
  well:        { key: 'well',        name: 'Well',        w: 1, h: 1, gold: 30, materials: { stone: 3 }, prestige: 2, artKey: 'well' },
  hedge:       { key: 'hedge',       name: 'Hedge',       w: 1, h: 1, gold: 10, materials: { wood: 1 },  prestige: 1, artKey: 'hedge' },
  flower_bed:  { key: 'flower_bed',  name: 'Flower Bed',  w: 1, h: 1, gold: 12, materials: { wood: 1 },  prestige: 1, artKey: 'flower_bed' },
  banner:      { key: 'banner',      name: 'Banner',      w: 1, h: 1, gold: 20, materials: { wood: 1 },  prestige: 1, artKey: 'banner' },
  fountain:    { key: 'fountain',    name: 'Fountain',    w: 2, h: 2, gold: 80, materials: { stone: 6 }, prestige: 3, artKey: 'fountain' },
  statue:      { key: 'statue',      name: 'Statue',      w: 1, h: 1, gold: 60, materials: { stone: 4 }, prestige: 3, artKey: 'statue' },
  cart:        { key: 'cart',        name: 'Cart',        w: 1, h: 1, gold: 25, materials: { wood: 2 },  prestige: 1, artKey: 'cart' },
  tree:        { key: 'tree',        name: 'Tree',        w: 1, h: 1, gold: 10, materials: { wood: 1 },  prestige: 1, artKey: 'tree' },
  cobble_path: { key: 'cobble_path', name: 'Cobble Path', w: 1, h: 1, gold: 10, materials: { stone: 1 }, prestige: 1, artKey: 'cobble_path' },
};

export const TOWN_DECOR_KEYS = Object.keys(TOWN_DECOR);
