// SVG art for the 19 missing relic sprites. 32-unit grid unless noted.
// Shared conventions: outline #2a180e (dark warm brown), flat shade bands,
// light from the upper-left, transparent background.
const O = '#2a180e'; // outline
const ol = `stroke="${O}" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round"`;

export const SPRITES = {
  // --- Curse: Dull Blade (−3 ST). A chipped, rust-spotted short sword. -------
  dull_blade: {
    svg: `
      <!-- grip -->
      <path d="M11.5 22.5 L7.5 26.5" stroke="${O}" stroke-width="4.6" stroke-linecap="round"/>
      <path d="M11.5 22.5 L7.5 26.5" stroke="#7a4e2c" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M10.7 23.1 l1.1 1.1 M9.2 24.6 l1.1 1.1" stroke="#4a2c17" stroke-width="1"/>
      <!-- pommel -->
      <circle cx="6.2" cy="27.8" r="2.1" fill="#6e5738" ${ol}/>
      <circle cx="5.6" cy="27.2" r="0.7" fill="#8f7448"/>
      <!-- crossguard -->
      <path d="M9.2 20.4 L16.6 27.8 L19 25.4 L11.6 18 Z" fill="#6e5738" ${ol}/>
      <path d="M10.4 20.2 L16.4 26.2" stroke="#8f7448" stroke-width="1"/>
      <!-- blade: wide, with two big chips bitten out of the lower edge -->
      <path d="M28 4 L28.6 8.2 L25.4 11.4 L25.8 13.6 L21.8 15 L22.2 17.4 L18.4 18.6 L17 22.2 L12.6 17.8 Z"
            fill="#a19a90" ${ol}/>
      <!-- darker lower band of the blade face -->
      <path d="M28.2 6 L28.6 8.2 L25.4 11.4 L25.8 13.6 L21.8 15 L22.2 17.4 L18.4 18.6 L17 22.2 L14.8 20 Z"
            fill="#736c62"/>
      <!-- highlight along the spine -->
      <path d="M27 5.2 L13.8 18" stroke="#c2bbb0" stroke-width="1.2"/>
      <!-- rust patches, big enough to read -->
      <path d="M24.2 10.2 q1.6-0.8 2.2 0.6 q0.5 1.2-0.8 1.7 q-1.5 0.5-2-0.8 q-0.4-1 0.6-1.5 Z" fill="#8a4a22"/>
      <path d="M19 15.4 q1.4-0.6 2 0.5 q0.5 1-0.6 1.6 q-1.3 0.6-1.9-0.5 q-0.5-0.9 0.5-1.6 Z" fill="#9c5a28"/>
      <path d="M16 18.6 q1.2-0.5 1.7 0.5 q0.4 0.9-0.6 1.4 q-1.1 0.4-1.6-0.5 q-0.4-0.8 0.5-1.4 Z" fill="#8a4a22"/>
      <path d="M26.6 7 q0.9-0.4 1.2 0.4 q0.3 0.7-0.5 1 q-0.8 0.3-1.1-0.4 q-0.3-0.6 0.4-1 Z" fill="#9c5a28"/>
    `,
  },

  // --- Curse: Clouded Mind (−3 KN). A scrying orb gone gray with fog. --------
  clouded_mind: {
    svg: `
      <!-- stand -->
      <path d="M10.5 25.5 h11 l1.5 3.5 h-14 Z" fill="#4a3a2a" ${ol}/>
      <path d="M11.5 25.8 h9" stroke="#63503a" stroke-width="1.2"/>
      <!-- orb -->
      <circle cx="16" cy="15.5" r="10" fill="#544d63" ${ol}/>
      <!-- fog banks -->
      <path d="M8 18.5 q3-3 6-1.5 t7-1 q3 0.5 4.5 2.5 q-1.5 4.5-6 6 q-5 1.5-9-1.5 q-2-1.5-2.5-4.5 Z" fill="#6c6478"/>
      <path d="M7.5 13.5 q2.5-4 6.5-3.5 q3 0.4 4.5 2 q2.5-2 5.5-0.5 q1.5 0.8 2 2.5 q-2 2.5-5.5 2 q-2.5-0.4-3.5-1.5 q-2 2-5 1.5 q-3-0.5-4.5-2.5 Z" fill="#8b8399"/>
      <!-- swirl -->
      <path d="M11.5 15.5 q4-4.5 8.5-1.5 q3 2 1.5 5 q-1.2 2.3-3.8 1.8 q-2-0.4-2.2-2.3 q-0.2-1.6 1.4-2 q1.3-0.3 1.8 0.8"
            fill="none" stroke="#b0aabb" stroke-width="1.2"/>
      <!-- glass rim shadow + specular -->
      <path d="M16 5.5 a10 10 0 0 1 10 10" fill="none" stroke="#3a3348" stroke-width="1.4" opacity="0.6"/>
      <path d="M9.5 10.5 q2.5-3.5 6-3.8" fill="none" stroke="#ffffff" stroke-width="1.6" opacity="0.75"/>
      <path d="M8.4 13.2 q0.3-1 0.9-1.9" fill="none" stroke="#ffffff" stroke-width="1.2" opacity="0.5"/>
    `,
  },

  // --- Trigger: Bloodied Fang (heal 12% on combat win). One fang, fresh kill. -
  bloodied_fang: {
    svg: `
      <!-- cord ring -->
      <circle cx="16" cy="5.2" r="2.3" fill="none" stroke="#9c6f1f" stroke-width="1.6"/>
      <circle cx="16" cy="5.2" r="2.3" fill="none" stroke="${O}" stroke-width="0.7" opacity="0.6"/>
      <!-- gold cap -->
      <path d="M11.8 7.5 q4.2-2.2 8.4 0 l-0.6 4 q-3.6 1.6-7.2 0 Z" fill="#d9a83c" ${ol}/>
      <path d="M12.2 8.1 q3.8-1.8 7.6 0" stroke="#f2d27a" stroke-width="1" fill="none"/>
      <path d="M12.6 10.9 q3.4 1.4 6.8 0" stroke="#9c6f1f" stroke-width="1" fill="none"/>
      <!-- fang: a claw curve, base under the cap, tip sweeping to the lower-left -->
      <path d="M12.3 11.2 q3.5 1.6 7.2 0.3 C21.6 17.5 19 23 10.9 26.6 C13.9 23 12.6 17 12.3 11.2 Z"
            fill="#ece2cc" ${ol}/>
      <path d="M19.1 12 C20.9 17.3 18.4 22.3 11.8 25.7 C16.6 22.4 18.3 17.4 17.5 12.3 Z" fill="#cbbd9e"/>
      <!-- blood: bright coat over the tip third, one fat drop below -->
      <path d="M16.9 19.4 q-1.9 4.3-6 7.2 q3.3-0.6 5.9-2.6 q2.1-1.6 3-3.6 q-1.6-0.1-2.9-1 Z"
            fill="#c22626" ${ol}/>
      <path d="M17.3 20.8 q-1.7 2.8-4.4 4.7 q2.3-0.7 4-2.2 q1.2-1 1.8-2.2 q-0.8-0.1-1.4-0.3 Z" fill="#e85454"/>
      <path d="M11.6 28.6 q1.7 2 0 3.4 q-1.7-1.4 0-3.4 Z" fill="#c22626" ${ol}/>
      <path d="M11.2 30.1 q0.2 0.9 0.8 1.2" stroke="#e85454" stroke-width="0.8" fill="none"/>
    `,
  },

  // --- Trigger: Desperate Ward (below 35% HP: +6 DEF). Battered shield, rune lit. -
  desperate_ward: {
    svg: `
      <!-- battered round shield, wood planks, steel rim -->
      <circle cx="16" cy="16" r="11.2" fill="#7a4a26" ${ol}/>
      <path d="M11.5 5.9 a11.2 11.2 0 0 0 0 20.2 Z" fill="#5f3719"/>
      <path d="M20.5 5.9 a11.2 11.2 0 0 1 0 20.2 Z" fill="#8f5a30"/>
      <path d="M11.5 5.7 v20.6 M20.5 5.7 v20.6" stroke="${O}" stroke-width="0.8" opacity="0.7"/>
      <!-- steel rim with dents -->
      <circle cx="16" cy="16" r="11.2" fill="none" stroke="#8a8f98" stroke-width="1.8"/>
      <circle cx="16" cy="16" r="12.1" fill="none" stroke="${O}" stroke-width="1"/>
      <circle cx="16" cy="16" r="10.2" fill="none" stroke="${O}" stroke-width="0.8" opacity="0.8"/>
      <path d="M7 9.5 l1.6 1.4 M25.5 19 l-1.7 -1.1 M12 26.6 l0.8-1.7" stroke="${O}" stroke-width="1.1"/>
      <!-- cracks -->
      <path d="M9.5 21.5 l3.2-2.6 1.8 0.4 M23.8 9.6 l-3.4 2.8 -1.6-0.2" stroke="${O}" stroke-width="0.9" fill="none"/>
      <!-- glowing rune: a warding chevron -->
      <path d="M16 10.5 l4.2 5 -4.2 6 -4.2-6 Z M16 10.5 v11" fill="none" stroke="#0e4b5c" stroke-width="2.6"/>
      <path d="M16 10.5 l4.2 5 -4.2 6 -4.2-6 Z M16 10.5 v11" fill="none" stroke="#7fd4e8" stroke-width="1.3"/>
      <path d="M16 12.2 l2.9 3.4 -2.9 4.2 -2.9-4.2 Z" fill="none" stroke="#d9f4fb" stroke-width="0.6" opacity="0.9"/>
    `,
  },

  // --- T3: Worldroot Heart. A heart woven from living roots, green veins lit. -
  worldroot_heart: {
    svg: `
      <path d="M16 28 C7.5 21.5 6 13.5 9.5 10 C12.2 7.2 15.2 8.6 16 11.2 C16.8 8.6 19.8 7.2 22.5 10 C26 13.5 24.5 21.5 16 28 Z"
            fill="#6b4426" ${ol}/>
      <!-- woven root strands: deep crevices + lit ridges -->
      <path d="M10 11.5 q4 3 5.2 8.5 q0.6 3 0.4 5.5 M21.8 11.2 q-3.6 3.4-4.6 8.8 M8.6 15.5 q4.4 1.5 8 6.5 M23.4 15.5 q-4.6 1.8-7 5.5"
            fill="none" stroke="#42260f" stroke-width="1.4"/>
      <path d="M11.2 10.6 q3.4 2.8 4.4 8 M20.6 10.6 q-3 3-4 8.2 M9.2 17.8 q3.8 1.4 6.4 5.2 M22.6 18 q-3.6 1.6-5.4 4.6"
            fill="none" stroke="#9a6c3e" stroke-width="1.1"/>
      <path d="M12.6 9.6 q2.6 2.4 3.4 6.4 M19.2 9.6 q-2.2 2.6-3 6.6" fill="none" stroke="#9a6c3e" stroke-width="0.9"/>
      <!-- glowing sap veins -->
      <path d="M16 26.5 q-0.4-5.5-2.6-9 q-1.4-2.2-3.2-3.4 M16 26.5 q0.6-5 2.8-8.4 q1.2-1.9 2.6-3"
            fill="none" stroke="#3f8f2e" stroke-width="1.5"/>
      <path d="M16 25.6 q-0.4-4.8-2.4-8 q-1.2-1.9-2.6-2.9 M16 25.6 q0.6-4.4 2.5-7.4 q1-1.6 2.2-2.6"
            fill="none" stroke="#7fd45e" stroke-width="0.8"/>
      <circle cx="16" cy="14.8" r="1.3" fill="#7fd45e"/>
      <circle cx="16" cy="14.5" r="0.55" fill="#d2f5c0"/>
    `,
  },

  // --- T3: Dragon Scale. One iridescent scale, ridged, gold-rimmed base. ------
  dragon_scale: {
    svg: `
      <path d="M16 28.5 Q6.8 20.5 8 10.8 Q11.5 6.2 16 5.8 Q20.5 6.2 24 10.8 Q25.2 20.5 16 28.5 Z"
            fill="#2e8f7a" ${ol}/>
      <!-- shade: right/lower half -->
      <path d="M16 28.5 Q25.2 20.5 24 10.8 Q20.5 6.2 16 5.8 L16 8 Q19.5 8.4 22 11.6 Q23 19.5 16 26 Z" fill="#1e6353"/>
      <!-- growth ridges -->
      <path d="M16 25.8 Q10.2 20.2 10.4 12.6 M16 22.2 Q12.4 18.6 12.6 13.6" fill="none" stroke="#4fb89c" stroke-width="1"/>
      <path d="M16 25.8 Q21.8 20.2 21.6 12.6 M16 22.2 Q19.6 18.6 19.4 13.6" fill="none" stroke="#175247" stroke-width="1"/>
      <!-- gold crest along the top edge -->
      <path d="M8.4 10.4 Q11.8 6.4 16 6 Q20.2 6.4 23.6 10.4" fill="none" stroke="#d9a83c" stroke-width="1.7"/>
      <path d="M9.4 9.6 Q12.4 6.8 16 6.5" fill="none" stroke="#f2d27a" stroke-width="0.8"/>
      <!-- specular -->
      <path d="M10.6 12.4 q0.6 4.4 2.6 7.6" fill="none" stroke="#a8e6d2" stroke-width="0.9" opacity="0.85"/>
    `,
  },

  // --- T3: Soulbound Crown. Gold crown, soul-gem, wisps rising. ---------------
  soulbound_crown: {
    svg: `
      <!-- soul wisps -->
      <path d="M11 15 q-1.6-3.4 0.6-6.2 M16 13.5 q-1.2-3.8 1-7.5 M21 15 q1.8-3.6-0.4-6.6"
            fill="none" stroke="#b18ae0" stroke-width="1.3" opacity="0.85"/>
      <path d="M16 12.5 q-0.8-3 0.8-5.6" fill="none" stroke="#e2d2f7" stroke-width="0.7" opacity="0.9"/>
      <!-- crown points -->
      <path d="M7.5 25.5 L7.5 15.5 L11.5 19 L16 13.5 L20.5 19 L24.5 15.5 L24.5 25.5 Z" fill="#d9a83c" ${ol}/>
      <!-- point balls -->
      <circle cx="7.5" cy="14.5" r="1.4" fill="#f2d27a" ${ol}/>
      <circle cx="16" cy="12.6" r="1.5" fill="#f2d27a" ${ol}/>
      <circle cx="24.5" cy="14.5" r="1.4" fill="#f2d27a" ${ol}/>
      <!-- band -->
      <path d="M7 21.5 h18 v4.5 h-18 Z" fill="#c1922e" ${ol}/>
      <path d="M7.6 22.2 h16.8" stroke="#f2d27a" stroke-width="0.9"/>
      <path d="M7.6 25.2 h16.8" stroke="#9c6f1f" stroke-width="0.9"/>
      <!-- shading on the right point -->
      <path d="M24.5 16.5 v9 h-4 Z" fill="#b0862a"/>
      <!-- soul gem -->
      <path d="M16 20.2 l3 3.6 -3 3.6 -3-3.6 Z" fill="#6b4a9c" ${ol}/>
      <path d="M16 21.4 l2 2.4 -2 2.4 -2-2.4 Z" fill="#8f6ac4"/>
      <path d="M15.2 22.4 l1-1.1" stroke="#e2d2f7" stroke-width="0.8"/>
    `,
  },

  // --- T3: Frostbitten Edge. A blade sheathed in creeping ice. ---------------
  frostbitten_edge: {
    svg: `
      <!-- grip -->
      <path d="M11.5 22.5 L7.5 26.5" stroke="${O}" stroke-width="4.6" stroke-linecap="round"/>
      <path d="M11.5 22.5 L7.5 26.5" stroke="#2f4a6e" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M10.7 23.1 l1.1 1.1 M9.2 24.6 l1.1 1.1" stroke="#1d3049" stroke-width="1"/>
      <circle cx="6.2" cy="27.8" r="2.1" fill="#6e7683" ${ol}/>
      <!-- crossguard -->
      <path d="M9.2 20.4 L16.6 27.8 L19 25.4 L11.6 18 Z" fill="#6e7683" ${ol}/>
      <path d="M10.4 20.2 L16.4 26.2" stroke="#98a0ac" stroke-width="1"/>
      <!-- blade -->
      <path d="M28 4 L28.8 8 L17 22.2 L12.6 17.8 Z" fill="#b7c4d0" ${ol}/>
      <path d="M28.4 6 L28.8 8 L17 22.2 L14.8 20 Z" fill="#8fa2b4"/>
      <path d="M27.2 5.2 L13.8 18" stroke="#e2ecf4" stroke-width="1.2"/>
      <!-- creeping ice: crystals clinging to the blade -->
      <path d="M20.2 12.6 l2.4-0.6 1 2.6 -2 2.4 -2.6-1.4 Z" fill="#bfe8f5" ${ol}/>
      <path d="M24.6 7.4 l2-0.4 0.8 2 -1.6 1.8 -2-1 Z" fill="#a5dcef" ${ol}/>
      <path d="M15.4 17.4 l2.2-0.4 0.8 2.2 -1.8 2 -2.2-1.2 Z" fill="#bfe8f5" ${ol}/>
      <path d="M21 13.4 l1.4-0.3 M25.2 8 l1.1-0.2 M16.2 18.2 l1.3-0.2" stroke="#eef9fd" stroke-width="0.8"/>
      <!-- icicles under the guard -->
      <path d="M13.4 24.6 q0.8 2.6 0 4.4 q-1.4-1.8-1.6-3.6 Z" fill="#a5dcef" ${ol}/>
      <path d="M16.6 26.8 q0.5 1.8 0 3.2 q-1-1.3-1.2-2.6 Z" fill="#bfe8f5" ${ol}/>
      <!-- frost sparkles -->
      <path d="M22.5 5.5 l0 1.6 M21.7 6.3 l1.6 0 M10.5 14.5 l0 1.4 M9.8 15.2 l1.4 0" stroke="#eef9fd" stroke-width="0.7"/>
    `,
  },

  // --- Trigger: Shrine Stone. A mossy menhir with a lit spiral sigil. ---------
  shrine_stone: {
    svg: `
      <!-- pebbles -->
      <ellipse cx="7.5" cy="27.5" rx="2.4" ry="1.6" fill="#6e7365" ${ol}/>
      <ellipse cx="25" cy="27.8" rx="2" ry="1.4" fill="#7b8070" ${ol}/>
      <!-- menhir -->
      <path d="M11 28.5 Q9.6 18 11.5 9.5 Q13.5 5.5 17 5.2 Q20.6 5.8 21.8 10 Q23.4 18.5 21.5 28.5 Z"
            fill="#8a8f98" ${ol}/>
      <path d="M21.8 10 Q23.4 18.5 21.5 28.5 L17.5 28.5 Q19.6 18.5 18.4 9 Q18 6.6 17 5.2 Q20.6 5.8 21.8 10 Z"
            fill="#5c616c"/>
      <path d="M12.2 9.8 Q13.8 6.4 16.6 6" fill="none" stroke="#b2b7be" stroke-width="1"/>
      <!-- cracks -->
      <path d="M13 13.5 l2 1.6 -0.6 1.8 M19.5 21 l-1.8 1.4" fill="none" stroke="${O}" stroke-width="0.8" opacity="0.8"/>
      <!-- moss -->
      <path d="M11 28.5 q0.2-3 2.2-3 q1.4 0 1.8 1.4 q1.6-0.8 2.6 0.6 q0.6 0.8 0.4 1 Z" fill="#4f7d2e"/>
      <path d="M11.6 27.2 q1.2-0.8 2.2 0" fill="none" stroke="#74a44a" stroke-width="0.8"/>
      <!-- lit spiral sigil -->
      <path d="M16.2 13.2 q3.4 0.6 3.2 3.6 q-0.2 2.8-3 2.8 q-2.4 0-2.6-2.2 q-0.2-1.9 1.7-2.1 q1.5-0.1 1.7 1.2 q0.1 1-0.9 1.1"
            fill="none" stroke="#0e4b5c" stroke-width="2.4"/>
      <path d="M16.2 13.2 q3.4 0.6 3.2 3.6 q-0.2 2.8-3 2.8 q-2.4 0-2.6-2.2 q-0.2-1.9 1.7-2.1 q1.5-0.1 1.7 1.2 q0.1 1-0.9 1.1"
            fill="none" stroke="#7fd4e8" stroke-width="1.1"/>
      <circle cx="16.4" cy="16.4" r="0.6" fill="#d9f4fb"/>
    `,
  },

  // --- T2: Twin Sage. Two crossed sage leaves bound in a gold band. -----------
  twin_sage: {
    svg: `
      <!-- cord loop -->
      <circle cx="16" cy="6.2" r="2.1" fill="none" stroke="#9c6f1f" stroke-width="1.5"/>
      <!-- left leaf (teal-green) -->
      <path d="M15.2 9.5 Q8.5 13 7.5 21.5 Q7.2 24.5 9 26.5 Q13 24.5 15 18.5 Q16.4 14 15.2 9.5 Z"
            fill="#3d8a68" ${ol}/>
      <path d="M14.6 11 Q10 15 9 22.5 Q8.8 24 9.4 25.2" fill="none" stroke="#2a6349" stroke-width="1"/>
      <path d="M13.6 12.6 Q10.6 16.2 10.2 21.8 M12.4 15 l2.2 1.2 M11 18.6 l2.6 1.2" fill="none" stroke="#5fb389" stroke-width="0.8"/>
      <!-- right leaf (golden-green) -->
      <path d="M16.8 9.5 Q23.5 13 24.5 21.5 Q24.8 24.5 23 26.5 Q19 24.5 17 18.5 Q15.6 14 16.8 9.5 Z"
            fill="#7d9636" ${ol}/>
      <path d="M17.4 11 Q22 15 23 22.5 Q23.2 24 22.6 25.2" fill="none" stroke="#5a6e24" stroke-width="1"/>
      <path d="M18.4 12.6 Q21.4 16.2 21.8 21.8 M19.6 15 l-2.2 1.2 M21 18.6 l-2.6 1.2" fill="none" stroke="#a3bd52" stroke-width="0.8"/>
      <!-- gold binding band -->
      <path d="M12.6 9.2 q3.4 1.6 6.8 0 l0.5 3.2 q-3.9 1.8-7.8 0 Z" fill="#d9a83c" ${ol}/>
      <path d="M13.2 9.9 q2.8 1.2 5.6 0" fill="none" stroke="#f2d27a" stroke-width="0.9"/>
      <path d="M13 11.7 q3 1.4 6 0" fill="none" stroke="#9c6f1f" stroke-width="0.9"/>
    `,
  },

  // --- T1: Padded Jerkin. A quilted leather vest. -----------------------------
  padded_jerkin: {
    svg: `
      <!-- body -->
      <path d="M9 8.5 L12.5 6.5 Q16 8.5 19.5 6.5 L23 8.5 Q25.5 10 25.5 14 L24.5 26.5 Q20 28.5 16 28.5 Q12 28.5 7.5 26.5 L6.5 14 Q6.5 10 9 8.5 Z"
            fill="#8a5a30" ${ol}/>
      <!-- right shade -->
      <path d="M23 8.5 Q25.5 10 25.5 14 L24.5 26.5 Q21.5 27.8 19 28.2 Q20.8 18 19.5 6.5 Z" fill="#63401f"/>
      <!-- quilt stitching -->
      <path d="M7.5 12.5 L21 26 M6.9 17.5 L17 27.5 M7.4 22.8 L12.6 28 M13.5 7.6 L24.9 19 M18.5 7.4 L25.2 14.2 M8.9 7.9 L24.4 23.4"
            stroke="#4a2c15" stroke-width="0.7" opacity="0.85"/>
      <path d="M24.4 12.6 L11 26.1 M25 17.6 L14.9 27.7 M18.4 7.5 L7 18.9 M13.4 7.7 L6.7 14.4 M23.2 8.7 L7.7 24.2 M25 22.9 L19.8 28.1"
            stroke="#4a2c15" stroke-width="0.7" opacity="0.85"/>
      <!-- open front + laces -->
      <path d="M16 9 L16 28.4" stroke="${O}" stroke-width="1.4"/>
      <path d="M13.8 12 l4.4 1.8 M13.8 16 l4.4 1.8 M13.8 20 l4.4 1.8" stroke="#caa15c" stroke-width="0.9"/>
      <!-- collar trim -->
      <path d="M12.5 6.5 Q16 8.5 19.5 6.5 L20.3 8.1 Q16 10.4 11.7 8.1 Z" fill="#a87844" ${ol}/>
      <!-- armholes -->
      <path d="M6.8 13.2 Q9 12.5 9.6 9.1 M25.2 13.2 Q23 12.5 22.4 9.1" fill="none" stroke="${O}" stroke-width="1"/>
    `,
  },

  // --- T1: Runed Band. A silver signet ring, rune blazing on the face plate. --
  runed_band: {
    svg: `
      <!-- band: tilted torus -->
      <path d="M16 10.5 C22.8 10.5 25.5 14.4 25.5 18.5 C25.5 23.4 21.2 26.5 16 26.5 C10.8 26.5 6.5 23.4 6.5 18.5 C6.5 14.4 9.2 10.5 16 10.5 Z
               M16 15 C12.4 15 10.6 16.9 10.6 19 C10.6 21.5 13 23 16 23 C19 23 21.4 21.5 21.4 19 C21.4 16.9 19.6 15 16 15 Z"
            fill="#aab2bd" fill-rule="evenodd" ${ol}/>
      <path d="M16 15 C12.4 15 10.6 16.9 10.6 19 C10.6 21.5 13 23 16 23 L16 21.8 C13.7 21.8 12 20.6 12 19 C12 17.6 13.5 16.4 16 16.4 Z" fill="#6e7683"/>
      <path d="M7.2 20.6 C8.6 24 12.1 25.7 16 25.7 C19.9 25.7 23.4 24 24.8 20.6 C22.8 23.2 19.8 24.4 16 24.4 C12.2 24.4 9.2 23.2 7.2 20.6 Z" fill="#7c8490"/>
      <!-- shoulders joining the plate -->
      <path d="M10.8 12.6 L12.6 9.6 L19.4 9.6 L21.2 12.6 Q16 14.6 10.8 12.6 Z" fill="#8d95a1" ${ol}/>
      <!-- signet face plate -->
      <ellipse cx="16" cy="7.6" rx="6.4" ry="4.6" fill="#c3cad3" ${ol}/>
      <path d="M16 12.2 A6.4 4.6 0 0 1 9.6 7.6 L10.9 7.6 A5.1 3.4 0 0 0 16 11 Z" fill="#98a0ac"/>
      <path d="M11 5.2 Q13.3 3.4 16 3.4" fill="none" stroke="#eef2f6" stroke-width="0.9"/>
      <!-- the warding rune, cut deep and lit -->
      <path d="M16 10.4 V5.2 M16 7 L13.6 5 M16 7 L18.4 5" fill="none" stroke="#0e4b5c" stroke-width="2.1"/>
      <path d="M16 10.4 V5.2 M16 7 L13.6 5 M16 7 L18.4 5" fill="none" stroke="#7fd4e8" stroke-width="0.95"/>
      <circle cx="16" cy="9.6" r="0.5" fill="#d9f4fb"/>
      <!-- sparkle -->
      <path d="M23.8 5.4 l0 1.6 M23 6.2 l1.6 0" stroke="#eef9fd" stroke-width="0.8"/>
    `,
  },

  // --- T1: Bone Ward. Crossed bones lashed with red cord. --------------------
  bone_ward: {
    svg: `
      <!-- bone 1: lower-left to upper-right -->
      <path d="M8.9 24.9 L21.1 12.7" stroke="${O}" stroke-width="5"/>
      <path d="M8.9 24.9 L21.1 12.7" stroke="#ece2cc" stroke-width="3"/>
      <circle cx="22.6" cy="9.9" r="2.4" fill="#ece2cc" ${ol}/>
      <circle cx="25.1" cy="12.4" r="2.4" fill="#ece2cc" ${ol}/>
      <circle cx="6.9" cy="22.6" r="2.4" fill="#ece2cc" ${ol}/>
      <circle cx="9.4" cy="25.1" r="2.4" fill="#ece2cc" ${ol}/>
      <!-- bone 2: upper-left to lower-right -->
      <path d="M10.9 12.9 L23.1 25.1" stroke="${O}" stroke-width="5"/>
      <path d="M10.9 12.9 L23.1 25.1" stroke="#ece2cc" stroke-width="3"/>
      <circle cx="9.4" cy="10.1" r="2.4" fill="#ece2cc" ${ol}/>
      <circle cx="6.9" cy="12.6" r="2.4" fill="#ece2cc" ${ol}/>
      <circle cx="24.6" cy="22.4" r="2.4" fill="#ece2cc" ${ol}/>
      <circle cx="22.1" cy="24.9" r="2.4" fill="#ece2cc" ${ol}/>
      <!-- bone shading -->
      <path d="M12.4 14.8 L21.4 23.8 M11 22.6 L19.4 14.2" stroke="#cbbd9e" stroke-width="1.1"/>
      <!-- red cord binding at the crossing -->
      <path d="M13.4 14.6 l5.2 4.8 M13.2 17.4 l5.4 2.4 M14.2 13.8 l4 5.8" stroke="#a13030" stroke-width="1.5"/>
      <path d="M13.6 15.4 l4.6 3.4" stroke="#c94848" stroke-width="0.8"/>
    `,
  },

  // --- T1: Frost Mantle. A pale hooded cloak, frost-rimed hem. ----------------
  frost_mantle: {
    svg: `
      <!-- cloak body -->
      <path d="M16 5.5 Q10.5 7.5 9 13 L7 26.5 Q11.5 29 16 29 Q20.5 29 25 26.5 L23 13 Q21.5 7.5 16 5.5 Z"
            fill="#bcd8ea" ${ol}/>
      <!-- right shade -->
      <path d="M23 13 L25 26.5 Q21.5 28.4 18 28.8 Q20.6 20.5 19.6 10.2 Q21.9 11 23 13 Z" fill="#8fb4cf"/>
      <!-- hood opening -->
      <path d="M16 6.8 Q12.2 8.4 11.2 12.6 Q13.4 15.2 16 15.2 Q18.6 15.2 20.8 12.6 Q19.8 8.4 16 6.8 Z"
            fill="#4a6e8a" ${ol}/>
      <path d="M12.4 12.2 Q14 14 16 14 Q18 14 19.6 12.2" fill="none" stroke="#33506a" stroke-width="1.2"/>
      <!-- folds -->
      <path d="M12.5 16 L11.5 27.5 M16 16.5 L16 28.8 M19.5 16 L20.5 27.6" stroke="#6a92b0" stroke-width="1" fill="none"/>
      <path d="M10.4 16.5 L9.4 26.8" stroke="#d8eaf5" stroke-width="0.9" fill="none"/>
      <!-- frost-rimed hem -->
      <path d="M7.2 26.4 l1.8-2 1.6 2.4 1.8-2.2 1.7 2.6 1.9-2.3 1.9 2.3 1.7-2.6 1.8 2.2 1.6-2.4 1.8 2" fill="none" stroke="#eef9fd" stroke-width="1.1"/>
      <!-- clasp -->
      <circle cx="16" cy="16.8" r="1.5" fill="#d9a83c" ${ol}/>
      <circle cx="15.6" cy="16.4" r="0.5" fill="#f2d27a"/>
      <!-- sparkles -->
      <path d="M10 20.5 l0 1.4 M9.3 21.2 l1.4 0 M21.5 22.5 l0 1.4 M20.8 23.2 l1.4 0" stroke="#eef9fd" stroke-width="0.7"/>
    `,
  },

  // --- T2: Aegis Charm. A shield pendant: gold rim, star-struck blue field. ---
  aegis_charm: {
    svg: `
      <!-- chain ring -->
      <circle cx="16" cy="5" r="2.2" fill="none" stroke="#9c6f1f" stroke-width="1.5"/>
      <!-- heater shield -->
      <path d="M16 8 Q20.5 9.8 24 9.5 Q24.4 17.5 21.5 22.5 Q19.3 26.2 16 28 Q12.7 26.2 10.5 22.5 Q7.6 17.5 8 9.5 Q11.5 9.8 16 8 Z"
            fill="#d9a83c" ${ol}/>
      <!-- blue field inset -->
      <path d="M16 10.2 Q19.6 11.6 22 11.5 Q22.2 17.4 19.9 21.4 Q18.2 24.3 16 25.7 Q13.8 24.3 12.1 21.4 Q9.8 17.4 10 11.5 Q12.4 11.6 16 10.2 Z"
            fill="#3d6ea8" ${ol}/>
      <path d="M16 10.2 Q19.6 11.6 22 11.5 Q22.2 17.4 19.9 21.4 Q18.2 24.3 16 25.7 Z" fill="#2c5486"/>
      <!-- embossed star -->
      <path d="M16 12.6 L17.2 15.9 L20.6 16 L17.9 18 L18.9 21.3 L16 19.3 L13.1 21.3 L14.1 18 L11.4 16 L14.8 15.9 Z"
            fill="#f2d27a" stroke="#9c6f1f" stroke-width="0.7"/>
      <!-- rim light -->
      <path d="M9 10.5 Q8.8 16 10.6 20.2" fill="none" stroke="#f2d27a" stroke-width="0.9"/>
    `,
  },

  // --- T2: Windrunner Sash. A knotted ribbon, two tails streaming in the wind. -
  windrunner_sash: {
    svg: `
      <!-- wind lines behind -->
      <path d="M6 5.5 q7-2.5 12 1 M16 25 q5 2.5 10.5 0.5" fill="none" stroke="#b8e6d8" stroke-width="1.1" opacity="0.9"/>
      <!-- upper tail: streams right with a ripple, flared tip -->
      <path d="M10.5 8.5 C15 5.8 19 10.2 24.5 7 L28 10.2 C22 14.6 16.5 9.6 11.5 12.6 Z"
            fill="#3da88a" ${ol}/>
      <path d="M24.5 7 L28 10.2 C25.6 12 23.2 12.4 20.8 11.9 C23 10.8 24.4 9.2 24.5 7 Z" fill="#2a7a63"/>
      <path d="M11.5 8.9 C14.8 7 18 9.8 21.6 9.1" fill="none" stroke="#62c9a8" stroke-width="1"/>
      <!-- lower tail: sweeps down-right, V-notched ribbon end -->
      <path d="M9.5 12.5 C12.5 17.5 18 20 24 23 L27.5 21.5 L25 26.5 L21.8 24.9 C15.8 22 10 19 6.8 14.2 Z"
            fill="#3da88a" ${ol}/>
      <path d="M24 23 L27.5 21.5 L25 26.5 L21.8 24.9 C22.9 24.4 23.8 23.8 24 23 Z" fill="#2a7a63"/>
      <path d="M8.2 13.4 C11 17.4 15.6 19.8 20.4 22.2" fill="none" stroke="#2a7a63" stroke-width="1"/>
      <path d="M9.9 13.3 C12.4 16.9 16.6 19.2 21 21.4" fill="none" stroke="#62c9a8" stroke-width="0.9"/>
      <!-- knot -->
      <path d="M7.2 8.2 Q11 6.6 12.8 9.8 Q13.4 13 10.4 14 Q7 14.6 6 11.6 Q5.6 9.4 7.2 8.2 Z" fill="#3da88a" ${ol}/>
      <path d="M7.6 9.2 Q10.2 8.2 11.4 10.2" fill="none" stroke="#62c9a8" stroke-width="1"/>
      <path d="M8 12.8 Q9.8 13.4 11.2 12.4" fill="none" stroke="#2a7a63" stroke-width="1"/>
      <!-- wind curls in front -->
      <path d="M13.5 15.5 q4.5 1.5 8-0.5 q1.8-1 2-2.6" fill="none" stroke="#d8f4ec" stroke-width="1"/>
      <path d="M12 27.5 q4 1.5 7.5 0" fill="none" stroke="#b8e6d8" stroke-width="1"/>
    `,
  },

  // --- T2: Gilded Mask. A gold half-mask with ribbon ties. --------------------
  gilded_mask: {
    svg: `
      <!-- ribbons: trailing down and out from the sides -->
      <path d="M8 14.5 Q4.5 16.5 3.5 21 M24 14.5 Q27.5 16.5 28.5 21" fill="none" stroke="#7a2c3c" stroke-width="1.6"/>
      <path d="M3.9 19 Q3.2 21.5 4.4 23.5 M28.1 19 Q28.8 21.5 27.6 23.5" fill="none" stroke="#7a2c3c" stroke-width="1.2"/>
      <!-- mask face: rounder, brighter gold -->
      <path d="M16 6.5 Q22.5 6.8 24.8 10.5 Q26 16 23.5 20.8 Q20.8 25.8 16 27.5 Q11.2 25.8 8.5 20.8 Q6 16 7.2 10.5 Q9.5 6.8 16 6.5 Z"
            fill="#e0b23f" ${ol}/>
      <!-- right shade -->
      <path d="M24.8 10.5 Q26 16 23.5 20.8 Q20.8 25.8 16 27.5 L16 25.4 Q19.4 24 21.6 20 Q23.6 16 22.6 11.2 Q20.8 8.6 17.5 7.4 Q22.5 7.8 24.8 10.5 Z"
            fill="#b0862a"/>
      <!-- almond eye holes, gently upturned -->
      <path d="M9.6 14.2 Q12 12.2 14.8 13.8 Q13.6 16.2 11.2 16 Q9.8 15.6 9.6 14.2 Z" fill="${O}"/>
      <path d="M22.4 14.2 Q20 12.2 17.2 13.8 Q18.4 16.2 20.8 16 Q22.2 15.6 22.4 14.2 Z" fill="${O}"/>
      <!-- gold glints under the eyes -->
      <path d="M10.6 16.9 q1.8 0.8 3.4 0 M17.9 16.9 q1.8 0.8 3.4 0" fill="none" stroke="#f2d27a" stroke-width="0.8"/>
      <!-- brow arches + nose ridge -->
      <path d="M9.6 12.2 Q12.4 10.8 14.8 12 M22.4 12.2 Q19.6 10.8 17.2 12" fill="none" stroke="#f2d27a" stroke-width="1"/>
      <path d="M16 13.8 L15.4 18.4 Q15.8 19.2 16.8 19" fill="none" stroke="#9c6f1f" stroke-width="1"/>
      <!-- serene smile with upturned corners -->
      <path d="M12.2 21.8 Q16 24.4 19.8 21.8" fill="none" stroke="#9c6f1f" stroke-width="1.2"/>
      <path d="M12.2 21.8 l-0.7-0.8 M19.8 21.8 l0.7-0.8" stroke="#9c6f1f" stroke-width="1"/>
      <!-- forehead gem -->
      <path d="M16 8.4 l1.4 1.7 -1.4 1.7 -1.4-1.7 Z" fill="#3d8a68" stroke="#9c6f1f" stroke-width="0.7"/>
      <!-- cheek light -->
      <path d="M9.6 17.5 q0.6 2.8 2.3 4.9" fill="none" stroke="#f2d27a" stroke-width="0.9"/>
    `,
  },

  // --- T2: Shadow Mantle. A near-black cloak trailing shadow. -----------------
  shadow_mantle: {
    svg: `
      <!-- shadow wisps off the hem -->
      <path d="M8 26.5 q-2.5 1.5-4.5 0.5 M22 27.5 q2.5 1.8 5.5 0.8 M12 28.5 q-1.5 2-3.8 2.2"
            fill="none" stroke="#7a5cae" stroke-width="1.2" opacity="0.75"/>
      <!-- cloak body -->
      <path d="M16 5.5 Q10.5 7.5 9 13 L7 26.5 Q11.5 29 16 29 Q20.5 29 25 26.5 L23 13 Q21.5 7.5 16 5.5 Z"
            fill="#3a2f4a" ${ol}/>
      <path d="M23 13 L25 26.5 Q21.5 28.4 18 28.8 Q20.6 20.5 19.6 10.2 Q21.9 11 23 13 Z" fill="#241c30"/>
      <!-- hood opening: darkness inside, two faint eyes -->
      <path d="M16 6.8 Q12.2 8.4 11.2 12.6 Q13.4 15.2 16 15.2 Q18.6 15.2 20.8 12.6 Q19.8 8.4 16 6.8 Z"
            fill="#120c1c" ${ol}/>
      <path d="M13.9 11.7 l1.3 0.5 M17 12.2 l1.3-0.5" stroke="#9f7fd4" stroke-width="0.9"/>
      <!-- folds -->
      <path d="M12.5 16 L11.5 27.5 M16 16.5 L16 28.8 M19.5 16 L20.5 27.6" stroke="#241c30" stroke-width="1" fill="none"/>
      <path d="M10.4 16.5 L9.4 26.8" stroke="#55486b" stroke-width="0.9" fill="none"/>
      <!-- hem dissolving into wisps -->
      <path d="M7.4 26.2 q1.6 1.4 3.4 0.6 q1.4 1.6 3.4 0.9 q1.8 1.3 3.8 0.4 q1.6 1 3.4 0.2 q1.6 0.8 3.2-0.4"
            fill="none" stroke="#55486b" stroke-width="1.1"/>
      <!-- silver clasp -->
      <path d="M16 16.4 l1.6 1.9 -1.6 1.9 -1.6-1.9 Z" fill="#aab2bd" ${ol}/>
    `,
  },

  // --- T2: Verdant Sigil. A stone disc, leaf sigil glowing green. -------------
  verdant_sigil: {
    svg: `
      <!-- stone disc -->
      <circle cx="16" cy="16.5" r="11.5" fill="#7b8070" ${ol}/>
      <path d="M16 5 A11.5 11.5 0 0 1 16 28 L16 26 A9.5 9.5 0 0 0 16 7 Z" fill="#5f6455"/>
      <circle cx="16" cy="16.5" r="9.2" fill="none" stroke="${O}" stroke-width="0.9" opacity="0.85"/>
      <path d="M8.4 11 Q10.6 7.6 14.4 6.8" fill="none" stroke="#989d8b" stroke-width="1"/>
      <!-- chips on the rim -->
      <path d="M6.2 20.5 l1.9 0.8 M24.5 9.5 l-1.6 1.1" stroke="${O}" stroke-width="1"/>
      <!-- glowing leaf sigil: pointed tip up, stem trailing down -->
      <path d="M16 8.8 Q21.2 12.8 20.4 18.6 Q19.8 22 16.8 23.6 Q13.6 21.6 13.2 16.6 Q13 12 16 8.8 Z"
            fill="#2e5c1e" stroke="#1d3f12" stroke-width="0.9"/>
      <path d="M16 10.6 Q19.6 14 19 18.6 Q18.6 20.9 16.8 22.2 Q14.8 20.4 14.4 16.4 Q14.2 13 16 10.6 Z" fill="#5fae3c"/>
      <!-- stem -->
      <path d="M16.8 23.6 Q17.2 25.4 16.2 26.8" fill="none" stroke="#2e5c1e" stroke-width="1.1"/>
      <!-- midrib + side veins -->
      <path d="M16 10.6 Q16.7 16.5 16.8 22.2 M15 14.2 l1.8 1.2 M14.7 17.4 l2.1 1.2 M18 14.6 l-1.3 1 M18.3 17.8 l-1.6 1"
            fill="none" stroke="#2e5c1e" stroke-width="0.7"/>
      <path d="M16.1 11.2 Q16.6 16 16.7 20.6" fill="none" stroke="#a8dd8a" stroke-width="0.6"/>
      <!-- glow flecks -->
      <path d="M11.5 12.5 l0 1.2 M10.9 13.1 l1.2 0 M21.5 21.5 l0 1.2 M20.9 22.1 l1.2 0" stroke="#a8dd8a" stroke-width="0.7"/>
    `,
  },
};
