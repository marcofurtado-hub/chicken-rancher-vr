// =============================================================================
// CONFIG — todas as tabelas de números e textos (armas, naves, waves, galinhas, habilidades).
// Para balancear o jogo, mexa aqui. A lógica não depende dos valores.
// =============================================================================
import { tr } from './i18n.js';

export const WEAPONS = {
  hands:    { label: tr('OVOS NA MÃO', 'EGGS IN HAND', 'MUNAT KÄDESSÄ'),     icon: '🥚' },
  slingshot:{ label: tr('ESTILINGUE', 'SLINGSHOT', 'RITSA'),      icon: '🎯' },
  crossbow: { label: tr('BESTA', 'CROSSBOW', 'VARSIJOUSI'),           icon: '🏹' },
  pistols:  { label: tr('PISTOLAS DUPLAS', 'DUAL PISTOLS', 'TUPLAPISTOOLIT'), icon: '🔫' },
  shotgun:  { label: tr('ESCOPETA', 'SHOTGUN', 'HAULIKKO'),        icon: '💥' },
  launcher: { label: tr('LANÇA-OVO', 'EGG LAUNCHER', 'MUNANHEITIN'),       icon: '💣' },
  gatling:  { label: 'GATLING',         icon: '🔥' },
  homing:   { label: tr('TELEGUIADO', 'HOMING', 'HAKEUTUVA'),      icon: '🚀' },
  laser:    { label: 'LASER',           icon: '⚡' },
  tesla:    { label: tr('RAIO TESLA', 'TESLA BOLT', 'TESLASALAMA'),      icon: '🌩' },
  fireworks:{ label: tr('ROJÃO', 'FIREWORKS', 'ILOTULITE'),           icon: '🎆' },
};

// Uma arma nova por wave (10). Raio tesla e laser voltaram para as waves 9 e 10; a besta segue de fora (igual ao estilingue).
export const WEAPON_ORDER = ['hands', 'slingshot', 'pistols', 'shotgun', 'launcher', 'gatling', 'homing', 'fireworks', 'tesla', 'laser'];

export const UFO_TYPES = {
  saucer:   { name: tr('NAVE COMUM', 'SAUCER', 'LAUTANEN'),     desc: tr('abduz galinhas com o feixe', 'abducts chickens with its beam', 'sieppaa kanoja säteellään'),          role: 'abduct',  hp: 1, scale: 1.0,  speed: 1.0,  beam: 1.0,  color: 0xb8c2d4, glow: 0x5effd0, pts: 100, drop: 0.07 },
  zippy:    { name: tr('NAVE VELOZ', 'SPEEDSTER', 'PIKALAUTANEN'),     desc: tr('zigue-zague e abdução rápida', 'zigzags and abducts fast', 'siksakkaa ja sieppaa nopeasti'),        role: 'abduct',  hp: 1, scale: 0.78, speed: 1.75, beam: 0.65, color: 0xe04848, glow: 0xffa040, pts: 150, drop: 0.09 },
  tank:     { name: tr('NAVE BLINDADA', 'ARMORED SAUCER', 'PANSSARILAUTANEN'),  desc: tr('aguenta vários ovos', 'takes several eggs', 'kestää monta munaa'),                 role: 'abduct',  hp: 3, scale: 1.35, speed: 0.62, beam: 1.25, color: 0xd4aa3c, glow: 0xfff07a, pts: 250, drop: 0.22 },
  gunner:   { name: tr('NAVE ATIRADORA', 'GUNNER', 'AMPUJA'), desc: tr('cospe gosma em você. Acerte a gosma no ar!', 'spits goo at you. Shoot the goo mid-air!', 'sylkee limaa päällesi. Ammu lima ilmassa!'), role: 'gunner', hp: 2, scale: 1.05, speed: 1.1, beam: 0, color: 0x8e5ad8, glow: 0x8aff50, pts: 200, drop: 0.14 },
  kamikaze: { name: tr('NAVE KAMIKAZE', 'KAMIKAZE', 'KAMIKAZE'),  desc: tr('mergulha na varanda. Derrube antes!', 'dives at the porch. Shoot it down first!', 'syöksyy kuistille. Ammu se alas ensin!'),  role: 'dive',    hp: 1, scale: 0.85, speed: 1.0,  beam: 0,    color: 0xff8a20, glow: 0xff3020, pts: 175, drop: 0.10 },
  splitter: { name: tr('NAVE DIVISORA', 'SPLITTER', 'JAKAUTUJA'),  desc: tr('vira duas quando explode', 'splits in two when it blows up', 'jakautuu kahdeksi räjähtäessään'),            role: 'abduct',  hp: 2, scale: 1.25, speed: 0.9,  beam: 1.0,  color: 0x2fae9c, glow: 0xa0ffe8, pts: 200, drop: 0.12 },
  mini:     { name: tr('MINI NAVE', 'MINI SAUCER', 'MINILAUTANEN'),      desc: '',                                    role: 'abduct',  hp: 1, scale: 0.6,  speed: 1.6,  beam: 0.7,  color: 0x5fd8c4, glow: 0xa0ffe8, pts: 60,  drop: 0.0 },
  shielder: { name: tr('NAVE ESCUDEIRA', 'SHIELDER', 'SUOJAAJA'), desc: tr('blinda as outras. Mate ela primeiro!', 'shields the others. Kill it first!', 'suojaa muita. Tuhoa se ensin!'), role: 'support', hp: 3, scale: 1.1,  speed: 0.8,  beam: 0,    color: 0x3a66e8, glow: 0x70b0ff, pts: 300, drop: 0.28 },
  ghost:    { name: tr('NAVE FANTASMA', 'GHOST SAUCER', 'AAVELAUTANEN'),  desc: tr('some e reaparece do nada', 'vanishes and reappears out of nowhere', 'katoaa ja ilmestyy tyhjästä'),            role: 'abduct',  hp: 1, scale: 1.0,  speed: 1.2,  beam: 0.9,  color: 0xd8e0ff, glow: 0xd0a8ff, pts: 250, drop: 0.14 },
  bomber:   { name: tr('NAVE BOMBARDEIRA', 'BOMBER', 'POMMITTAJA'), desc: tr('solta bombas onde você está. Saia de baixo!', 'drops bombs where you stand. Get out from under it!', 'pudottaa pommeja päällesi. Väistä alta!'), role: 'bomber', hp: 3, scale: 1.2, speed: 1.0, beam: 0, color: 0x5a6a3a, glow: 0xff5020, pts: 250, drop: 0.18 },
  sniper:   { name: tr('NAVE SNIPER', 'SNIPER', 'TARKKA-AMPUJA'),      desc: tr('mira um laser em você. Saia da mira!', 'locks a laser on you. Move out of its sights!', 'tähtää sinua laserilla. Väistä tähtäin!'),  role: 'sniper',  hp: 2, scale: 0.95, speed: 1.0, beam: 0,    color: 0x2a3038, glow: 0xff2040, pts: 300, drop: 0.20 },
  thief:    { name: tr('NAVE LADRA', 'THIEF', 'VARAS'),       desc: tr('agarra uma galinha e foge voando baixo', 'grabs a chicken and flees flying low', 'nappaa kanan ja pakenee matalalla'), role: 'thief',  hp: 2, scale: 0.9,  speed: 1.0, beam: 0,    color: 0xc03080, glow: 0xff60c0, pts: 250, drop: 0.12 },
  boss:     { name: tr('CHEFÃO', 'BOSS', 'POMO'),         desc: '',                                    role: 'boss',    hp: 0, scale: 2.4,  speed: 0.75, beam: 0.8,  color: 0x3c3c4c, glow: 0xff3838, pts: 1500, drop: 1 },
};

// 10 waves, cada uma com um CHEFE totalmente diferente (corpo e mecânica próprios, ver bosses.js).
// O chefe só chega no FIM da wave, depois que todas as naves comuns foram embora. A wave 10 termina em VITÓRIA + ranking.
// `vets`: chefes já vencidos que voltam no meio da wave como inimigos comuns (o difícil de ontem é o fácil de hoje).
export const WAVES = [
  { weapon: 'hands',     mix: { saucer: 4 }, interval: 1.6, speed: 1.1, beamTime: 7.0, maxAlive: 3, hpMult: 1, boss: 'zepelim', ufoScale: 1.7, tod: 0, close: true, intro: 'saucer', aggro: 0 },
  { weapon: 'slingshot', mix: { saucer: 5, zippy: 2 }, interval: 1.4, speed: 1.4, beamTime: 6.5, maxAlive: 4, hpMult: 1, boss: 'olhao', ufoScale: 1.5, tod: 0.4, intro: 'zippy', aggro: 0 },
  { weapon: 'pistols',   mix: { saucer: 5, zippy: 3, tank: 2 }, interval: 1.2, speed: 1.6, beamTime: 6.0, maxAlive: 5, hpMult: 1, boss: 'minhocao', vets: ['zepelim'], ufoScale: 1.35, tod: 0.8, intro: 'tank', aggro: 0.5 },
  { weapon: 'shotgun',   mix: { saucer: 5, zippy: 3, tank: 2, gunner: 2 }, interval: 1.1, speed: 1.8, beamTime: 5.7, maxAlive: 5, hpMult: 1, boss: 'centopeia', vets: ['olhao'], ufoScale: 1.25, tod: 1.2, intro: 'gunner', aggro: 0.9 },
  { weapon: 'launcher',  mix: { saucer: 5, zippy: 3, tank: 2, gunner: 2, kamikaze: 2 }, interval: 1.0, speed: 2.0, beamTime: 5.4, maxAlive: 6, hpMult: 1.3, boss: 'magico', vets: ['zepelim', 'minhocao'], ufoScale: 1.15, tod: 1.6, intro: 'kamikaze', aggro: 1.0 },
  { weapon: 'gatling',   mix: { saucer: 5, zippy: 3, tank: 2, gunner: 2, kamikaze: 2, splitter: 2 }, interval: 0.95, speed: 2.1, beamTime: 5.2, maxAlive: 7, hpMult: 1.5, boss: 'polvo', vets: ['olhao', 'centopeia'], ufoScale: 1.08, tod: 2.0, intro: 'splitter', aggro: 1.1 },
  { weapon: 'homing',    mix: { saucer: 5, zippy: 3, tank: 2, gunner: 2, kamikaze: 2, splitter: 2, shielder: 2 }, interval: 0.9, speed: 2.3, beamTime: 5.0, maxAlive: 8, hpMult: 2, boss: 'colheitadeira', vets: ['zepelim', 'magico'], ufoScale: 1.0, tod: 2.5, intro: 'shielder', aggro: 1.2 },
  { weapon: 'fireworks', mix: { saucer: 5, zippy: 3, tank: 2, gunner: 2, kamikaze: 2, splitter: 2, shielder: 2, ghost: 2 }, interval: 0.85, speed: 2.4, beamTime: 4.8, maxAlive: 8, hpMult: 2, boss: 'tempestade', vets: ['olhao', 'centopeia'], ufoScale: 0.95, tod: 3.0, intro: 'ghost', aggro: 1.3 },
  { weapon: 'tesla',     mix: { saucer: 5, zippy: 3, tank: 2, gunner: 2, kamikaze: 2, splitter: 2, ghost: 2, bomber: 2, sniper: 2 }, interval: 0.8, speed: 2.5, beamTime: 4.7, maxAlive: 9, hpMult: 2.3, boss: 'colmeia', vets: ['minhocao', 'polvo'], ufoScale: 0.92, tod: 3.5, intro: 'bomber', aggro: 1.4 },
  { weapon: 'laser',     mix: { saucer: 5, zippy: 3, tank: 2, gunner: 2, kamikaze: 2, splitter: 2, shielder: 2, ghost: 2, bomber: 2, thief: 2 }, interval: 0.8, speed: 2.6, beamTime: 4.6, maxAlive: 9, hpMult: 2.5, boss: 'galozilla', vets: ['olhao', 'magico'], ufoScale: 0.9, tod: 4, intro: 'thief', aggro: 1.5, flight: true },
];

// Chefes (vida base; cada um tem modelo e regras em bosses.js)
export const BOSSES = {
  zepelim:       { hp: 3,    name: tr('BATEDOR', 'THE SCOUT', 'TIEDUSTELIJA'),              hint: tr('estoure os 3 cristais de energia', 'pop the 3 energy crystals', 'puhkaise 3 energiakristallia') },
  olhao:         { hp: 60,   name: tr('VIGIA', 'THE WATCHER', 'VARTIJA'),                   hint: tr('só toma dano de olho aberto: acerte a pupila', 'only hurts with the eye open: hit the pupil', 'vahinkoa vain silmä auki: osu pupilliin') },
  centopeia:     { hp: 70,   name: tr('COMBOIO', 'THE CONVOY', 'SAATTUE'),                  hint: tr('destrua os vagões, depois a nave-chefe', 'destroy the pods, then the lead ship', 'tuhoa vaunut, sitten johtoalus') },
  polvo:         { hp: 800,  name: tr('CÉREBRO-LULA', 'BRAIN SQUID', 'AIVOKALMARI'),        hint: tr('atire no tentáculo pra ele soltar a galinha', 'shoot a tentacle to free the chicken', 'ammu lonkeroa niin se päästää kanan') },
  minhocao:      { hp: 240,  name: tr('BROCA', 'THE DRILL', 'PORA'),                        hint: tr('só sobe pra morder: acerte a boca pra ela cuspir', 'only surfaces to bite: hit the mouth to make it spit', 'nousee vain puremaan: osu suuhun') },
  tempestade:    { hp: 800,  name: tr('CRISTAL', 'THE CRYSTAL', 'KRISTALLI'),               hint: tr('quebre os cristais e acerte a máquina lá dentro', 'break the crystals and hit the machine inside', 'riko kristallit ja osu koneeseen') },
  magico:        { hp: 80,  name: tr('MIRAGEM', 'THE MIRAGE', 'KANGASTUS'),                hint: tr('duas são holograma: a de verdade tem os olhos brilhando', 'two are holograms: the real one has glowing eyes', 'kaksi on hologrammeja: aidolla silmät hehkuvat') },
  colmeia:       { hp: 160,  name: tr('RAINHA', 'THE QUEEN', 'KUNINGATAR'),                 hint: tr('derrube os zangões pra desligar o escudo', 'shoot the drones to drop the shield', 'ammu lennokit niin suoja sammuu') },
  colheitadeira: { hp: 600, name: tr('CEIFADOR', 'THE REAPER', 'NIITTÄJÄ'),                hint: tr('a frente é blindada: acerte os tanques vermelhos', 'the front is armored: hit the red tanks', 'etuosa on panssaroitu: osu punaisiin säiliöihin') },
  galozilla:     { hp: 2200, name: tr('IMPERADOR', 'THE EMPEROR', 'KEISARI'),               hint: tr('acerte o cérebro, e o peito quando abrir', 'hit the brain, and the chest when it opens', 'osu aivoihin ja rintaan kun se aukeaa') },
};
export const BOSS_ORDER = ['zepelim', 'olhao', 'minhocao', 'centopeia', 'magico', 'polvo', 'colheitadeira', 'tempestade', 'colmeia', 'galozilla'];

export function endlessWave(n) {
  return {
    weapon: null, endless: true, n,
    mix: { saucer: 6 + n, zippy: 3 + n, tank: 2 + Math.floor(n / 2), gunner: 2 + Math.floor(n / 2), kamikaze: 2 + Math.floor(n / 2), splitter: 2 + Math.floor(n / 3), shielder: 2, ghost: 2 + Math.floor(n / 2), bomber: 2 + Math.floor(n / 2), sniper: 1 + Math.floor(n / 2), thief: 1 + Math.floor(n / 2) },
    interval: Math.max(0.35, 0.6 - 0.03 * n), speed: 2.8 + 0.1 * n, beamTime: Math.max(3.2, 4.4 - 0.1 * n),
    maxAlive: 10 + n, hpMult: 2.5 + 0.3 * n, boss: BOSS_ORDER[n % BOSS_ORDER.length], bossGoo: 4,
    motherPod: 45 + 12 * n, motherCore: 150 + 35 * n, ufoScale: 0.85, tod: 4, aggro: 1.9 + 0.12 * n,
  };
}

export const CHICKEN_KINDS = {
  hen:     { label: tr('Galinha', 'Hen', 'Kana'),         scale: 1.0,  speed: 0.6, beamMul: 1.0, flee: 1.7 },
  rooster: { label: tr('Galo', 'Rooster', 'Kukko'),            scale: 1.22, speed: 0.7, beamMul: 1.6, flee: 1.9 },
  chick:   { label: tr('Pintinho', 'Chick', 'Tipu'),        scale: 0.6,  speed: 1.0, beamMul: 0.7, flee: 2.4 },
  golden:  { label: tr('Galinha de Ouro', 'Golden Hen', 'Kultakana'), scale: 1.05, speed: 0.6, beamMul: 1.0, flee: 1.8 },
};

export const HEN_SKINS = [[0xfafafa, 0xe6e6e6], [0xc07a3a, 0xa0602a], [0x3a3a3e, 0x2a2a2e], [0xe8c890, 0xd4b070]];

// 3.4: MELHORIAS PERMANENTES e poucas (antes: 14 habilidades ativas de 8 s com botão).
// Cada uma tem níveis; o efeito é pequeno e somado, para sentir a evolução sem ficar apelão.
export const SKILLS = [
  { id: 'forca',   cat: 'atk', rar: 'raro',  max: 3, icon: '💪', title: tr('OVO GRANDÃO', 'BIG EGG', 'ISO MUNA'),          desc: tr('ovo maior e +25% de dano', 'bigger egg and +25% damage', 'isompi muna ja +25 % vahinkoa'),      lvl: [tr('dano x1,25', 'damage x1.25', 'vahinko x1,25'), tr('dano x1,5', 'damage x1.5', 'vahinko x1,5'), tr('dano x1,75', 'damage x1.75', 'vahinko x1,75')] },
  { id: 'ricochete', cat: 'atk', rar: 'raro', max: 2, icon: '🪃', title: tr('RICOCHETE', 'RICOCHET', 'KIMMOKE'),          desc: tr('o ovo quica de uma nave para outra', 'eggs bounce from one saucer to the next', 'muna kimpoaa lautaselta toiselle'), lvl: [tr('quica 1 vez', 'bounces once', 'kimpoaa kerran'), tr('quica 2 vezes', 'bounces twice', 'kimpoaa kahdesti')] },
  { id: 'duplo',   cat: 'egg', rar: 'epico', max: 2, icon: '🥚', title: tr('OVO DUPLO', 'DOUBLE EGG', 'TUPLAMUNA'),     desc: tr('+1 ovo a cada tiro', '+1 egg on every shot', '+1 muna joka laukaukseen'),                lvl: [tr('2 ovos por tiro', '2 eggs per shot', '2 munaa / laukaus'), tr('3 ovos por tiro', '3 eggs per shot', '3 munaa / laukaus')] },
  { id: 'mira',    cat: 'egg', rar: 'raro',  max: 2, icon: '🧲', title: tr('OVO ESPERTO', 'SMART EGG', 'FIKSU MUNA'),      desc: tr('os ovos curvam até as naves', 'eggs curve toward saucers', 'munat kaartuvat lautasiin'), lvl: [tr('curva +60%', 'curve +60%', 'kaarto +60 %'), tr('curva +120%', 'curve +120%', 'kaarto +120 %')] },
  { id: 'coracao', cat: 'def', rar: 'comum', max: 2, icon: '❤️', title: tr('CORAÇÃO DE GALO', 'ROOSTER HEART', 'KUKON SYDÄN'), desc: tr('+25 de vida máxima e cura tudo', '+25 max HP and full heal', '+25 maksimi-HP ja täysi parannus'), lvl: [tr('vida máx +25', 'max HP +25', 'maksimi-HP +25'), tr('vida máx +50', 'max HP +50', 'maksimi-HP +50')] },
  { id: 'ninhada', cat: 'def', rar: 'comum', max: 9, icon: '🐣', title: tr('NINHADA', 'NEW BROOD', 'POIKUE'),          desc: tr('+2 galinhas agora', '+2 chickens now', '+2 kanaa heti'),                                   lvl: [], instant: true },
];

export const RARITY = {
  comum: { label: tr('COMUM', 'COMMON', 'TAVALLINEN'), col: '#9fd090', bg: ['#1f4a1a', '#0a1f0a'], hex: 0x8dff4a },
  raro:  { label: tr('RARO', 'RARE', 'HARVINAINEN'),  col: '#60b0ff', bg: ['#16305a', '#08142a'], hex: 0x60b0ff },
  epico: { label: tr('ÉPICO', 'EPIC', 'EEPPINEN'), col: '#e080ff', bg: ['#4a1670', '#180828'], hex: 0xd070ff },
};

export const CAT_LABEL = { atk: tr('ATAQUE', 'ATTACK', 'HYÖKKÄYS'), egg: tr('OVO', 'EGG', 'MUNA'), def: tr('DEFESA', 'DEFENSE', 'PUOLUSTUS') };

export function getWave(i) { return i < WAVES.length ? WAVES[i] : endlessWave(i - WAVES.length); }

// Dica de uso mostrada quando a arma é liberada (VR / PC)
export const WEAPON_TIPS = {
  hands:     [tr('balance o controle e solte o ovo', 'swing the controller to throw', 'heilauta ohjainta heittääksesi'), tr('clique pra arremessar', 'click to throw', 'klikkaa heittääksesi')],
  slingshot: [tr('gatilho esquerdo pega o elástico: puxe e solte', 'left trigger grabs the band: pull and release', 'vasen liipaisin tarttuu kuminauhaan: vedä ja päästä'), tr('clique: o ovo faz o arco certo', 'click: the egg arcs to the target', 'klikkaa: muna kaartaa kohteeseen')],
  crossbow:  [tr('puxe a corda com o gatilho esquerdo', 'pull the string with the left trigger', 'vedä jännettä vasemmalla liipaisimella'), tr('clique: flecha reta e forte', 'click: straight, strong bolt', 'klikkaa: suora ja voimakas nuoli')],
  pistols:   [tr('um gatilho pra cada mão', 'one trigger per hand', 'yksi liipaisin kummallekin kädelle'), tr('segure o clique: alterna as mãos', 'hold click: alternates hands', 'pidä pohjassa: kädet vuorottelevat')],
  shotgun:   [tr('14 ovos de uma vez, ótima de perto', '14 eggs at once, great up close', '14 munaa kerralla, paras läheltä'), tr('14 ovos de uma vez, ótima de perto', '14 eggs at once, great up close', '14 munaa kerralla, paras läheltä')],
  launcher:  [tr('granada de ovo explode em área', 'egg grenade with splash damage', 'munakranaatti räjähtää alueelle'), tr('granada de ovo explode em área', 'egg grenade with splash damage', 'munakranaatti räjähtää alueelle')],
  gatling:   [tr('segure o gatilho: 20 ovos por segundo', 'hold the trigger: 20 eggs per second', 'pidä liipaisinta: 20 munaa sekunnissa'), tr('segure o clique: 20 ovos por segundo', 'hold click: 20 eggs per second', 'pidä pohjassa: 20 munaa sekunnissa')],
  homing:    [tr('mire perto: os mísseis acham o alvo', 'aim near: the missiles find the target', 'tähtää lähelle: ohjukset löytävät kohteen'), tr('mire perto: os mísseis acham o alvo', 'aim near: the missiles find the target', 'tähtää lähelle: ohjukset löytävät kohteen')],
  laser:     [tr('segure: raio instantâneo', 'hold: instant beam', 'pidä: välitön säde'), tr('segure: raio instantâneo', 'hold: instant beam', 'pidä: välitön säde')],
  tesla:     [tr('o raio pula de nave em nave', 'the bolt chains between saucers', 'salama hyppii lautaselta toiselle'), tr('o raio pula de nave em nave', 'the bolt chains between saucers', 'salama hyppii lautaselta toiselle')],
  fireworks: [tr('rojão explode no céu com muito dano', 'rockets burst in the sky for huge damage', 'raketti räjähtää taivaalla isolla vahingolla'), tr('rojão explode no céu com muito dano', 'rockets burst in the sky for huge damage', 'raketti räjähtää taivaalla isolla vahingolla')],
};

// Cartas de efeito na hora (a lógica fica em skills.js)
export const INSTANTS = [
  { id: 'cash', cat: 'def', rar: 'comum', icon: '💰', title: tr('BOLADA', 'JACKPOT', 'POTTI'), desc: tr('+1500 pontos', '+1500 points', '+1500 pistettä'), instant: true },
];

// 3.4: só 3 caixas de paraquedas, fáceis de entender e sem exagero
export const POWERS = {
  golden:  { label: tr('OVO DE OURO', 'GOLDEN EGG', 'KULTAMUNA'), sub: tr('DANO x2 · 8s', 'DAMAGE x2 · 8s', 'VAHINKO x2 · 8 s'), color: 0xffc820, css: '#ffd040', icon: '🥚', dur: 8 },
  slow:    { label: tr('CÂMERA LENTA', 'SLOW MOTION', 'HIDASTUS'), sub: tr('ALIENS LERDOS · 6s', 'SLOW ALIENS · 6s', 'HITAAT ALIENIT · 6 s'), color: 0x40c0ff, css: '#60d0ff', icon: '⏳', dur: 6 },
  heal:    { label: tr('CURA', 'HEAL', 'PARANNUS'), sub: tr('+30 DE VIDA', '+30 HP', '+30 HP'), color: 0xff5070, css: '#ff6080', icon: '❤️', dur: 0 },
};
