// The controls of the page: the voice's and the body's, by key (the Faust
// address without the program name), grouped as on the module's panel, each
// with its range (read from the DSPs' JSON at start) and its explanation in
// English and French; and the presets.

export const GROUPS = [
  { id: "exciter", en: "Exciter", fr: "Excitateur" },
  { id: "resonator", en: "Resonator", fr: "Résonateur" },
  { id: "space", en: "Space", fr: "Espace" },
  { id: "unit", en: "Unit", fr: "Unité" },
  { id: "performance", en: "Performance", fr: "Jeu" },
];

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

// A preset starts from the defaults of the DSPs (Part::Init) and sets these.
export const PRESETS = [
  {
    id: "default",
    en: ["Module defaults", "The patch of Part::Init: a mallet on a slightly stretched resonator, a little reverb."],
    fr: ["Réglages du module", "Le patch de Part::Init : un maillet sur un résonateur un peu étiré, un peu de réverbération."],
    values: {},
  },
  {
    id: "marimba",
    en: ["Wooden bar", "A soft mallet on harmonic modes with dark, quick highs."],
    fr: ["Lame de bois", "Un maillet doux sur des modes harmoniques aux aigus sombres et brefs."],
    values: { "exciter/mallet": 0.5, "exciter/strike_timbre": 0.35, "resonator/geometry": 0.27, "resonator/brightness": 0.3, "resonator/damping": 0.35, "resonator/position": 0.25, "space/space": 0.7 },
  },
  {
    id: "bell",
    en: ["Bell", "A hard mallet on stretched, bright, long modes."],
    fr: ["Cloche", "Un maillet dur sur des modes étirés, brillants et longs."],
    values: { "exciter/mallet": 0.55, "exciter/strike_timbre": 0.8, "resonator/geometry": 0.78, "resonator/brightness": 0.75, "resonator/damping": 0.15, "resonator/position": 0.4, "space/space": 1.1 },
  },
  {
    id: "glass",
    en: ["Bowed glass", "The bow alone, ADSR, on bright stretched modes."],
    fr: ["Verre frotté", "L'archet seul, en ADSR, sur des modes étirés et brillants."],
    values: { "exciter/strike": 0, "exciter/bow": 0.85, "exciter/envelope": 0.5, "exciter/bow_timbre": 0.6, "resonator/geometry": 0.85, "resonator/brightness": 0.65, "resonator/damping": 0.6, "space/space": 1.0 },
  },
  {
    id: "pipe",
    en: ["Reed pipe", "The blow above 2/3: the reed and the bore, on harmonic modes."],
    fr: ["Tuyau à anche", "Le souffle au-delà de 2/3 : l'anche et le tuyau, sur des modes harmoniques."],
    values: { "exciter/strike": 0, "exciter/blow": 0.92, "exciter/flow": 0.35, "exciter/blow_timbre": 0.45, "exciter/envelope": 0.55, "resonator/geometry": 0.27, "resonator/brightness": 0.45, "resonator/damping": 0.65, "space/space": 0.9 },
  },
  {
    id: "breath",
    en: ["Breath", "Gusty granular noise through a plate-like resonator."],
    fr: ["Souffle", "Un bruit granulaire en rafales dans un résonateur comme une plaque."],
    values: { "exciter/strike": 0, "exciter/blow": 0.6, "exciter/flow": 0.8, "exciter/blow_timbre": 0.7, "exciter/envelope": 0.75, "resonator/geometry": 0.6, "resonator/brightness": 0.6, "resonator/damping": 0.55, "space/space": 1.2 },
  },
  {
    id: "pluck",
    en: ["Plucked string", "One string and the plectrum, with its palm mute on release."],
    fr: ["Corde pincée", "Une corde et le plectre, avec son étouffement au relâché."],
    values: { "resonator/model": 1, "exciter/mallet": 0.7, "exciter/strike": 0.9, "resonator/geometry": 0.25, "resonator/brightness": 0.6, "resonator/damping": 0.45, "space/space": 0.6 },
  },
  {
    id: "chord",
    en: ["String chord", "Five strings tuned to a chord: move the geometry to change it."],
    fr: ["Accord de cordes", "Cinq cordes accordées sur un accord : la géométrie le change."],
    values: { "resonator/model": 2, "exciter/strike": 0.7, "resonator/geometry": 0.45, "resonator/brightness": 0.55, "resonator/damping": 0.6, "space/space": 1.1 },
  },
  {
    id: "rain",
    en: ["Particles", "Bouncing particles on a metallic resonator, in a large space."],
    fr: ["Particules", "Des particules qui rebondissent sur un résonateur métallique, dans un grand espace."],
    values: { "exciter/mallet": 0.93, "exciter/strike_timbre": 0.7, "resonator/geometry": 0.65, "resonator/brightness": 0.7, "resonator/damping": 0.4, "space/space": 1.3 },
  },
];
