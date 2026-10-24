// The controls of the page: the voice's and the body's, by key (the Faust
// address without the program name), grouped as on the module's panel, each
// with its range (read from the DSPs' JSON at start) and its explanation in
// English and French; and the presets.
//
// How it fits: app.js builds a tab per group with a slider per control, and the preset
// menu; orbit.js seeds its library with the presets; pwa.js lists the controls a phone's
// motion can drive. Under node, scripts/check_presets.mjs renders every preset and
// scripts/gen_atlas.mjs places every preset on the atlas: atlas.json refers to the
// presets by id, so a preset added, changed or renamed asks for `make web-atlas` again.

// The tabs of the controls, in order: `id` (the `group` of a control) and the tab's name
// in English and French. app.js adds the Orbit, Atlas and Phone tabs after them, and
// drops a group none of whose controls the DSPs have.
export const GROUPS = [
  { id: "exciter", en: "Exciter", fr: "Excitateur" },
  { id: "resonator", en: "Resonator", fr: "Résonateur" },
  { id: "space", en: "Space", fr: "Espace" },
  { id: "unit", en: "Unit", fr: "Unité" },
  { id: "performance", en: "Performance", fr: "Jeu" },
];

// One entry per control shown, in the order of the page:
// - key: the Faust address without the program name, as the DSPs' JSON gives it;
// - group: the id of its tab (GROUPS);
// - step (optional): 1 for a control that takes whole values (the model); the page reads
//   the step from the DSPs' JSON, this field states it here;
// - en, fr: [label, explanation].
//
// The ranges and defaults come from the DSPs' JSON (app.js readRanges): a control the
// DSPs do not have is not shown. The note's controls (freq, gain, gate) are not listed:
// the keyboard plays them.
export const CONTROLS = [
  {
    key: "exciter/envelope", group: "exciter",
    en: ["Contour", "The envelope of the bow and the blow: percussive below 0.4 (and up to 5 times louder), AD, then ADSR around 0.5, then AR with a long sustain."],
    fr: ["Contour", "L'enveloppe de l'archet et du souffle : percussive sous 0,4 (et jusqu'à 5 fois plus forte), AD, puis ADSR vers 0,5, puis AR à long maintien."],
  },
  {
    key: "exciter/bow", group: "exciter",
    en: ["Bow", "Level of the bow: a noise that flips sign at random, and the friction that drives the eight bowed modes."],
    fr: ["Archet", "Niveau de l'archet : un bruit qui change de signe au hasard, et le frottement qui entretient les huit modes frottés."],
  },
  {
    key: "exciter/blow", group: "exciter",
    en: ["Blow", "Level of the blow: granular noise through a diffuser; above 2/3 a reed and a bore join in, like a wind instrument."],
    fr: ["Souffle", "Niveau du souffle : un bruit granulaire passé dans un diffuseur ; au-delà de 2/3, une anche et un tuyau s'y ajoutent, comme un instrument à vent."],
  },
  {
    key: "exciter/strike", group: "exciter",
    en: ["Strike", "Level of the strike; above 0.8 the raw mallet sound also bleeds into the output."],
    fr: ["Frappe", "Niveau de la frappe ; au-delà de 0,8, le son brut du maillet passe aussi dans la sortie."],
  },
  {
    key: "exciter/bow_timbre", group: "exciter",
    en: ["Bow timbre", "Brightness of the bow's noise (a low-pass, also scaled by the resonator's brightness)."],
    fr: ["Timbre de l'archet", "Brillance du bruit de l'archet (un passe-bas, réglé aussi par la brillance du résonateur)."],
  },
  {
    key: "exciter/flow", group: "exciter",
    en: ["Flow", "Where the granular player jumps back in its noise sample: from an even breath to a gusty, irregular one."],
    fr: ["Flux", "Où le lecteur granulaire revient dans son échantillon de bruit : d'un souffle égal à un souffle irrégulier, par rafales."],
  },
  {
    key: "exciter/blow_timbre", group: "exciter",
    en: ["Blow timbre", "Speed at which the noise sample is read, and the brightness of the reed's tone."],
    fr: ["Timbre du souffle", "Vitesse de lecture de l'échantillon de bruit, et brillance du son de l'anche."],
  },
  {
    key: "exciter/mallet", group: "exciter",
    en: ["Mallet", "What strikes: nine recorded mallets and hits (below 0.4), a mallet pulse, a plectrum (0.6 to 0.8), then bouncing particles."],
    fr: ["Maillet", "Ce qui frappe : neuf maillets et coups enregistrés (sous 0,4), une impulsion de maillet, un plectre (de 0,6 à 0,8), puis des particules qui rebondissent."],
  },
  {
    key: "exciter/strike_timbre", group: "exciter",
    en: ["Strike timbre", "Hardness of the strike: the playback speed of the samples, the brightness of the pulses."],
    fr: ["Timbre de la frappe", "Dureté de la frappe : la vitesse de lecture des échantillons, la brillance des impulsions."],
  },
  {
    key: "resonator/geometry", group: "resonator",
    en: ["Geometry", "Spacing of the 52 modes: compressed partials below 0.25, harmonic around 0.27, then stretched like bars, plates and bells. With strings, the dispersion or the chord."],
    fr: ["Géométrie", "Écart des 52 modes : partiels resserrés sous 0,25, harmoniques vers 0,27, puis étirés comme des barres, des plaques et des cloches. Avec les cordes, la dispersion ou l'accord."],
  },
  {
    key: "resonator/brightness", group: "resonator",
    en: ["Brightness", "How fast the high modes decay compared with the low ones: wood and felt at the bottom, glass and metal at the top."],
    fr: ["Brillance", "Vitesse d'extinction des modes aigus par rapport aux graves : bois et feutre en bas, verre et métal en haut."],
  },
  {
    key: "resonator/damping", group: "resonator",
    en: ["Damping", "Decay time of the whole resonator, up to an endless ring at the top for the strings."],
    fr: ["Amortissement", "Durée d'extinction de tout le résonateur, jusqu'à une résonance sans fin en haut pour les cordes."],
  },
  {
    key: "resonator/position", group: "resonator",
    en: ["Position", "Where the resonator is excited and picked up: the comb filtering of the modes, hollow in the middle."],
    fr: ["Position", "Où le résonateur est excité et capté : le filtrage en peigne des modes, creux au milieu."],
  },
  {
    key: "resonator/model", group: "resonator", step: 1,
    en: ["Model", "0: the modal resonator. 1: one string (hidden mode of the module). 2: five strings tuned to a chord set by the geometry."],
    fr: ["Modèle", "0 : le résonateur modal. 1 : une corde (mode caché du module). 2 : cinq cordes accordées sur un accord choisi par la géométrie."],
  },
  {
    key: "space/space", group: "space",
    en: ["Space", "Below 0.1 the raw exciter on the left output, then a widening stereo image, a reverb from 0.6, and above 1.75 the reverb freezes."],
    fr: ["Espace", "Sous 0,1 l'excitateur brut sur la sortie gauche, puis une image stéréo qui s'élargit, une réverbération à partir de 0,6, et au-delà de 1,75 la réverbération se fige."],
  },
  {
    key: "unit/signature", group: "unit",
    en: ["Signature", "Each module draws its own small differences from its serial number: here where the blow's noise starts and the plectrum's first pulse."],
    fr: ["Signature", "Chaque module tire ses petites différences de son numéro de série : ici, où commence le bruit du souffle et la première impulsion du plectre."],
  },
  {
    key: "unit/mod_frequency", group: "unit",
    en: ["LFO rate", "Speed of the slow movement of the second pickup, which animates the stereo side (Hz)."],
    fr: ["Vitesse du LFO", "Vitesse du lent mouvement du second micro, qui anime le côté stéréo (Hz)."],
  },
  {
    key: "unit/mod_offset", group: "unit",
    en: ["LFO offset", "Position of the second pickup around which the LFO moves it."],
    fr: ["Décalage du LFO", "Position du second micro autour de laquelle le LFO le déplace."],
  },
  {
    key: "unit/diffusion", group: "unit",
    en: ["Diffusion", "Coefficient of the reverb's all-passes: how dense the echoes are."],
    fr: ["Diffusion", "Coefficient des passe-tout de la réverbération : la densité des échos."],
  },
  {
    key: "unit/reverb_lp", group: "unit",
    en: ["Reverb tone", "Low-pass in the reverb's loops: darker below, brighter above."],
    fr: ["Couleur de la réverbération", "Passe-bas dans les boucles de la réverbération : plus sombre en bas, plus clair en haut."],
  },
  {
    key: "performance/modulation", group: "performance",
    en: ["Pitch offset", "The module's FM input, in semitones, added to every note."],
    fr: ["Décalage de hauteur", "L'entrée FM du module, en demi-tons, ajoutée à chaque note."],
  },
];

// A preset starts from the defaults of the DSPs (Part::Init) and sets these. Each one has
// an `id` (the menu's value, the `preset` of atlas.json's points), its [name,
// description] in English and French, and `values`, control values by key, set over the
// defaults. The comment above each one gives its exciter and resonator.
export const PRESETS = [
  {
    // The module at power-up: no value set, every control at its default.
    id: "default",
    en: ["Module defaults", "The patch of Part::Init: a mallet on a slightly stretched resonator, a little reverb."],
    fr: ["Réglages du module", "Le patch de Part::Init : un maillet sur un résonateur un peu étiré, un peu de réverbération."],
    values: {},
  },
  // The first eight after the defaults: one of each family, then the families one by one.
  {
    // Strike, modal: the mallet pulse (0.5) on harmonic modes (geometry 0.27), dark.
    id: "marimba",
    en: ["Wooden bar", "A soft mallet on harmonic modes with dark, quick highs."],
    fr: ["Lame de bois", "Un maillet doux sur des modes harmoniques aux aigus sombres et brefs."],
    values: { "exciter/mallet": 0.5, "exciter/strike_timbre": 0.35, "resonator/geometry": 0.27, "resonator/brightness": 0.3, "resonator/damping": 0.35, "resonator/position": 0.25, "space/space": 0.7 },
  },
  {
    // Strike, modal: a recorded mallet (0.3) on stretched modes (0.78), bright.
    id: "bell",
    en: ["Bell", "A recorded mallet on stretched, bright, long modes."],
    fr: ["Cloche", "Un maillet enregistré sur des modes étirés, brillants et longs."],
    values: { "exciter/strike": 0.8, "exciter/mallet": 0.3, "exciter/strike_timbre": 0.7, "resonator/geometry": 0.78, "resonator/brightness": 0.75, "resonator/damping": 0.15, "resonator/position": 0.4, "space/space": 1.1 },
  },
  {
    // Bow, modal: the strike off, an ADSR contour (0.5), stretched bright modes.
    id: "glass",
    en: ["Bowed glass", "The bow alone, ADSR, on bright stretched modes."],
    fr: ["Verre frotté", "L'archet seul, en ADSR, sur des modes étirés et brillants."],
    values: { "exciter/strike": 0, "exciter/bow": 0.85, "exciter/envelope": 0.5, "exciter/bow_timbre": 0.6, "resonator/geometry": 0.85, "resonator/brightness": 0.65, "resonator/damping": 0.6, "space/space": 1.0 },
  },
  {
    // Blow, modal: above 2/3, the reed and the bore, on harmonic modes.
    id: "pipe",
    en: ["Reed pipe", "The blow above 2/3: the reed and the bore, on harmonic modes."],
    fr: ["Tuyau à anche", "Le souffle au-delà de 2/3 : l'anche et le tuyau, sur des modes harmoniques."],
    values: { "exciter/strike": 0, "exciter/blow": 0.75, "exciter/flow": 0.35, "exciter/blow_timbre": 0.45, "exciter/envelope": 0.55, "resonator/geometry": 0.27, "resonator/brightness": 0.4, "resonator/damping": 0.45, "space/space": 0.9 },
  },
  {
    // Blow, modal: below 2/3, granular noise only, a gusty flow (0.8).
    id: "breath",
    en: ["Breath", "Gusty granular noise through a plate-like resonator."],
    fr: ["Souffle", "Un bruit granulaire en rafales dans un résonateur comme une plaque."],
    values: { "exciter/strike": 0, "exciter/blow": 0.6, "exciter/flow": 0.8, "exciter/blow_timbre": 0.7, "exciter/envelope": 0.75, "resonator/geometry": 0.6, "resonator/brightness": 0.6, "resonator/damping": 0.55, "space/space": 1.2 },
  },
  {
    // Strike, one string (model 1): the plectrum (mallet 0.7).
    id: "pluck",
    en: ["Plucked string", "One string and the plectrum, with its palm mute on release."],
    fr: ["Corde pincée", "Une corde et le plectre, avec son étouffement au relâché."],
    values: { "resonator/model": 1, "exciter/mallet": 0.7, "exciter/strike": 0.7, "resonator/geometry": 0.25, "resonator/brightness": 0.6, "resonator/damping": 0.45, "space/space": 0.6 },
  },
  {
    // Strike, five strings (model 2): the geometry chooses the chord.
    id: "chord",
    en: ["String chord", "Five strings tuned to a chord: move the geometry to change it."],
    fr: ["Accord de cordes", "Cinq cordes accordées sur un accord : la géométrie le change."],
    values: { "resonator/model": 2, "exciter/strike": 0.7, "resonator/geometry": 0.45, "resonator/brightness": 0.55, "resonator/damping": 0.6, "space/space": 1.1 },
  },
  {
    // Strike, modal: particles (mallet above 0.8) on metallic modes, a large space.
    id: "rain",
    en: ["Particles", "Bouncing particles on a metallic resonator, in a large space."],
    fr: ["Particules", "Des particules qui rebondissent sur un résonateur métallique, dans un grand espace."],
    values: { "exciter/mallet": 0.93, "exciter/strike_timbre": 0.7, "resonator/geometry": 0.65, "resonator/brightness": 0.7, "resonator/damping": 0.4, "space/space": 1.3 },
  },
  // Percussion.
  {
    // Strike, modal: a recorded mallet (0.2) on the most stretched modes (0.95).
    id: "gong",
    en: ["Gong", "A recorded mallet on strongly stretched modes that ring long, in a large space."],
    fr: ["Gong", "Un maillet enregistré sur des modes très étirés qui résonnent longtemps, dans un grand espace."],
    values: { "exciter/strike": 0.85, "exciter/mallet": 0.2, "exciter/strike_timbre": 0.4, "resonator/geometry": 0.95, "resonator/brightness": 0.65, "resonator/damping": 0.1, "resonator/position": 0.3, "space/space": 1.4 },
  },
  {
    // Strike, modal: the mallet pulse (0.5) on moderately stretched modes (0.45).
    id: "steeldrum",
    en: ["Steel drum", "A mallet on moderately stretched, bright modes."],
    fr: ["Steel drum", "Un maillet sur des modes moyennement étirés et brillants."],
    values: { "exciter/mallet": 0.5, "exciter/strike_timbre": 0.6, "resonator/geometry": 0.45, "resonator/brightness": 0.65, "resonator/damping": 0.35, "resonator/position": 0.2, "space/space": 0.8 },
  },
  {
    // Strike, modal: a recorded hit (0.1) on compressed partials (0.15), little space.
    id: "woodblock",
    en: ["Wood block", "A short recorded hit on a damped, dark resonator: dry."],
    fr: ["Bloc de bois", "Un coup enregistré bref sur un résonateur amorti et sombre : sec."],
    values: { "exciter/strike": 0.9, "exciter/mallet": 0.1, "exciter/strike_timbre": 0.7, "resonator/geometry": 0.15, "resonator/brightness": 0.25, "resonator/damping": 0.05, "resonator/position": 0.4, "space/space": 0.3 },
  },
  {
    // Strike, modal: a recorded mallet (0.25), picked up near the edge (position 0.12).
    id: "kalimba",
    en: ["Kalimba", "A recorded mallet on slightly stretched modes, picked up near the edge."],
    fr: ["Kalimba", "Un maillet enregistré sur des modes légèrement étirés, captés près du bord."],
    values: { "exciter/mallet": 0.25, "exciter/strike_timbre": 0.55, "resonator/geometry": 0.33, "resonator/brightness": 0.55, "resonator/damping": 0.4, "resonator/position": 0.12, "space/space": 0.7 },
  },
  // Bowed and blown.
  {
    // Bow, modal: a gentle bow (0.6) on stretched (0.72), bright modes.
    id: "bowl",
    en: ["Singing bowl", "A gentle bow on stretched, bright modes that barely decay."],
    fr: ["Bol chantant", "Un archet doux sur des modes étirés et brillants qui s'éteignent à peine."],
    values: { "exciter/strike": 0, "exciter/bow": 0.6, "exciter/bow_timbre": 0.4, "exciter/envelope": 0.65, "resonator/geometry": 0.72, "resonator/brightness": 0.8, "resonator/damping": 0.1, "resonator/position": 0.35, "space/space": 1.2 },
  },
  {
    // Bow, modal: a strong bow (0.95) on dark harmonic modes.
    id: "lowbow",
    en: ["Low bow", "The bow alone on harmonic modes, dark, with an ADSR: play it low."],
    fr: ["Archet grave", "L'archet seul sur des modes harmoniques, sombre, en ADSR : à jouer grave."],
    values: { "exciter/strike": 0, "exciter/bow": 0.95, "exciter/bow_timbre": 0.35, "exciter/envelope": 0.5, "resonator/geometry": 0.27, "resonator/brightness": 0.3, "resonator/damping": 0.75, "resonator/position": 0.18, "space/space": 0.9 },
  },
  {
    // Blow, modal: below 2/3 (no reed), an even flow (0.15), harmonic modes.
    id: "flute",
    en: ["Flute", "A steady breath without the reed on damped harmonic modes."],
    fr: ["Flûte", "Un souffle régulier, sans l'anche, sur des modes harmoniques amortis."],
    values: { "exciter/strike": 0, "exciter/blow": 0.35, "exciter/flow": 0.15, "exciter/blow_timbre": 0.6, "exciter/envelope": 0.55, "resonator/geometry": 0.27, "resonator/brightness": 0.5, "resonator/damping": 0.75, "resonator/position": 0.25, "space/space": 0.9 },
  },
  {
    // Blow, modal: the reed (0.9), harmonic modes picked up at their middle (0.5).
    id: "clarinet",
    en: ["Clarinet", "The reed, dark, on harmonic modes picked up in the middle (odd partials)."],
    fr: ["Clarinette", "L'anche, sombre, sur des modes harmoniques captés au milieu (partiels impairs)."],
    values: { "exciter/strike": 0, "exciter/blow": 0.9, "exciter/flow": 0.3, "exciter/blow_timbre": 0.3, "exciter/envelope": 0.55, "resonator/geometry": 0.27, "resonator/brightness": 0.35, "resonator/damping": 0.65, "resonator/position": 0.5, "space/space": 0.8 },
  },
  // Strings.
  {
    // Strike, one string: the plectrum (0.65), a long ring.
    id: "harp",
    en: ["Harp", "One string and the plectrum, ringing long, with some space."],
    fr: ["Harpe", "Une corde et le plectre, qui résonne longtemps, avec un peu d'espace."],
    values: { "resonator/model": 1, "exciter/strike": 0.85, "exciter/mallet": 0.65, "exciter/strike_timbre": 0.45, "resonator/geometry": 0.25, "resonator/brightness": 0.6, "resonator/damping": 0.7, "resonator/position": 0.2, "space/space": 1.0 },
  },
  {
    // Strike, one string: positive dispersion (geometry 0.55), near the bridge (0.12).
    id: "koto",
    en: ["Dispersive string", "One string with positive dispersion (geometry above 0.26), plucked near the bridge, like a koto or a sitar."],
    fr: ["Corde dispersive", "Une corde à dispersion positive (géométrie au-delà de 0,26), pincée près du chevalet, comme un koto ou un sitar."],
    values: { "resonator/model": 1, "exciter/mallet": 0.72, "exciter/strike_timbre": 0.7, "resonator/geometry": 0.55, "resonator/brightness": 0.8, "resonator/damping": 0.55, "resonator/position": 0.12, "space/space": 0.7 },
  },
  {
    // Strike, one string: the plectrum near the end of its range (0.78), a short ring.
    id: "muted",
    en: ["Muted string", "One string, the plectrum at the end of its range, a short damping."],
    fr: ["Corde étouffée", "Une corde, le plectre en fin de plage, un amortissement court."],
    values: { "resonator/model": 1, "exciter/strike": 0.75, "exciter/mallet": 0.78, "resonator/geometry": 0.25, "resonator/brightness": 0.45, "resonator/damping": 0.25, "resonator/position": 0.3, "space/space": 0.4 },
  },
  {
    // Bow, five strings: an ADSR contour (0.55).
    id: "bowedchord",
    en: ["Bowed chord", "Five strings tuned to a chord, sustained by the bow, with an ADSR."],
    fr: ["Accord frotté", "Cinq cordes accordées sur un accord, entretenues par l'archet, en ADSR."],
    values: { "resonator/model": 2, "exciter/strike": 0, "exciter/bow": 0.85, "exciter/envelope": 0.55, "resonator/geometry": 0.65, "resonator/brightness": 0.55, "resonator/damping": 0.8, "space/space": 1.2 },
  },
  // Textures and space.
  {
    // Strike, modal: particles (0.86) on harmonic modes (0.3).
    id: "rainstick",
    en: ["Rain stick", "Particles on a harmonic resonator with little damping: hold the key."],
    fr: ["Bâton de pluie", "Des particules sur un résonateur harmonique peu amorti : tenir la touche."],
    values: { "exciter/strike": 0.7, "exciter/mallet": 0.86, "exciter/strike_timbre": 0.5, "resonator/geometry": 0.3, "resonator/brightness": 0.45, "resonator/damping": 0.6, "space/space": 1.0 },
  },
  {
    // Strike, modal: particles (0.95) on bell-like modes (0.8), a large space.
    id: "chimes",
    en: ["Wind chimes", "Particles on a bell-like resonator, bright and long, in a large space."],
    fr: ["Carillon à vent", "Des particules sur un résonateur en cloche, brillant et long, dans un grand espace."],
    values: { "exciter/mallet": 0.95, "exciter/strike_timbre": 0.85, "resonator/geometry": 0.8, "resonator/brightness": 0.8, "resonator/damping": 0.2, "space/space": 1.4 },
  },
  {
    // Bow, modal: a sustained contour (0.6) in a large reverb (space 1.5).
    id: "drone",
    en: ["Drone", "The bow on a sustained resonator in a large reverb; move space past 1.75 to freeze the reverb with what it holds."],
    fr: ["Drone", "L'archet sur un résonateur entretenu dans une grande réverbération ; passez l'espace au-delà de 1,75 pour la figer avec ce qu'elle contient."],
    values: { "exciter/strike": 0, "exciter/bow": 0.8, "exciter/envelope": 0.6, "resonator/geometry": 0.4, "resonator/brightness": 0.5, "resonator/damping": 0.7, "space/space": 1.5 },
  },
];
