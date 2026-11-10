// =============================================================================
// CONFIG — todas as tabelas de números e textos (armas, naves, waves, galinhas, habilidades).
// Para balancear o jogo, mexa aqui. A lógica não depende dos valores.
// =============================================================================
import { tr } from './i18n.js';

export const WEAPONS = {
  hands:    { label: tr('OVOS NA MÃO', 'EGGS IN HAND', 'MUNAT KÄDESSÄ'),     icon: '🥚' },
  slingshot:{ label: tr('ESTILINGUE', 'SLINGSHOT', 'RITSA'),      icon: '🪨' },
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

export const WEAPON_ORDER = ['hands', 'slingshot', 'crossbow', 'pistols', 'shotgun', 'launcher', 'gatling', 'homing', 'laser', 'tesla', 'fireworks'];

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

export const WAVES = [
  { weapon: 'hands',     mix: { saucer: 7 }, interval: 1.7, speed: 1.1, beamTime: 7.0, maxAlive: 3, hpMult: 1, boss: 0, ufoScale: 1.7, tod: 0, close: true, intro: 'saucer', aggro: 0 },
  { weapon: 'slingshot', mix: { saucer: 8, zippy: 4 }, interval: 1.35, speed: 1.5, beamTime: 6.3, maxAlive: 4, hpMult: 1, boss: 0, ufoScale: 1.45, tod: 0.35, intro: 'zippy', aggro: 0 },
  { weapon: 'crossbow',  mix: { saucer: 8, zippy: 4, tank: 3 }, interval: 1.15, speed: 1.7, beamTime: 5.9, maxAlive: 5, hpMult: 1, boss: 10, ufoScale: 1.3, tod: 0.7, intro: 'tank', aggro: 0.6 },
  { weapon: 'pistols',   mix: { saucer: 9, zippy: 4, tank: 2, gunner: 4 }, interval: 1.0, speed: 1.9, beamTime: 5.6, maxAlive: 7, hpMult: 1, boss: 0, ufoScale: 1.2, tod: 1.1, intro: 'gunner', aggro: 1 },
  { weapon: 'shotgun',   mix: { saucer: 10, zippy: 5, tank: 3, gunner: 3, kamikaze: 5 }, interval: 0.9, speed: 2.1, beamTime: 5.3, maxAlive: 8, hpMult: 2, boss: 0, ufoScale: 1.1, tod: 1.5, intro: 'kamikaze', aggro: 1.1 },
  { weapon: 'launcher',  mix: { saucer: 10, zippy: 5, tank: 3, gunner: 3, kamikaze: 4, splitter: 4 }, interval: 0.84, speed: 2.2, beamTime: 5.1, maxAlive: 9, hpMult: 2, boss: 55, bossGoo: 2, ufoScale: 1.05, tod: 1.9, intro: 'splitter', aggro: 1.2 },
  { weapon: 'gatling',   mix: { saucer: 11, zippy: 6, tank: 4, gunner: 4, kamikaze: 5, splitter: 3, shielder: 2 }, interval: 0.76, speed: 2.4, beamTime: 4.9, maxAlive: 10, hpMult: 3, boss: 0, ufoScale: 0.98, tod: 2.3, intro: 'shielder', aggro: 1.3 },
  { weapon: 'homing',    mix: { saucer: 11, zippy: 6, tank: 4, gunner: 4, kamikaze: 5, splitter: 3, shielder: 2, ghost: 5 }, interval: 0.7, speed: 2.5, beamTime: 4.7, maxAlive: 11, hpMult: 3, boss: 0, ufoScale: 0.92, tod: 2.7, intro: 'ghost', aggro: 1.4 },
  { weapon: 'laser',     mix: { saucer: 12, zippy: 6, tank: 4, gunner: 4, kamikaze: 5, splitter: 3, shielder: 2, ghost: 4, bomber: 4 }, interval: 0.65, speed: 2.6, beamTime: 4.6, maxAlive: 12, hpMult: 2, boss: 140, bossGoo: 3, ufoScale: 0.88, tod: 3.1, intro: 'bomber', aggro: 1.5 },
  { weapon: 'tesla',     mix: { saucer: 12, zippy: 7, tank: 4, gunner: 4, kamikaze: 5, splitter: 3, shielder: 2, ghost: 4, bomber: 3, sniper: 4 }, interval: 0.6, speed: 2.7, beamTime: 4.5, maxAlive: 12, hpMult: 3, boss: 0, ufoScale: 0.86, tod: 3.5, intro: 'sniper', aggro: 1.6 },
  { weapon: 'fireworks', mix: { saucer: 12, zippy: 7, tank: 5, gunner: 4, kamikaze: 6, splitter: 3, shielder: 2, ghost: 4, bomber: 3, sniper: 3, thief: 6 }, interval: 0.56, speed: 2.8, beamTime: 4.4, maxAlive: 13, hpMult: 3, boss: 0, ufoScale: 0.85, tod: 3.8, intro: 'thief', aggro: 1.7 },
  { weapon: 'fireworks', mix: { saucer: 12, zippy: 7, tank: 5, gunner: 5, kamikaze: 6, splitter: 3, shielder: 3, ghost: 4, bomber: 4, sniper: 3, thief: 4 }, interval: 0.55, speed: 2.8, beamTime: 4.3, maxAlive: 13, hpMult: 3, boss: 'mothership', motherPod: 40, motherCore: 130, ufoScale: 0.85, tod: 4, aggro: 1.8, flight: true },
];

export function endlessWave(n) {
  return {
    weapon: null, endless: true, n,
    mix: { saucer: 12 + 3 * n, zippy: 8 + 2 * n, tank: 5 + n, gunner: 5 + n, kamikaze: 6 + n, splitter: 4 + n, shielder: 3 + Math.floor(n / 2), ghost: 5 + n, bomber: 4 + n, sniper: 3 + Math.floor(n / 2), thief: 4 + n },
    interval: Math.max(0.3, 0.52 - 0.03 * n), speed: 2.8 + 0.12 * n, beamTime: Math.max(3.0, 4.3 - 0.12 * n),
    maxAlive: 13 + n, hpMult: 3 + 0.4 * n, boss: (n % 3 === 2) ? 'mothership' : 160 + 45 * n, bossGoo: 4,
    motherPod: 45 + 12 * n, motherCore: 150 + 35 * n, ufoScale: 0.85, tod: 4, aggro: 1.9 + 0.12 * n, flight: n % 3 === 2,
  };
}

export const CHICKEN_KINDS = {
  hen:     { label: tr('Galinha', 'Hen', 'Kana'),         scale: 1.0,  speed: 0.6, beamMul: 1.0, flee: 1.7 },
  rooster: { label: tr('Galo', 'Rooster', 'Kukko'),            scale: 1.22, speed: 0.7, beamMul: 1.6, flee: 1.9 },
  chick:   { label: tr('Pintinho', 'Chick', 'Tipu'),        scale: 0.6,  speed: 1.0, beamMul: 0.7, flee: 2.4 },
  golden:  { label: tr('Galinha de Ouro', 'Golden Hen', 'Kultakana'), scale: 1.05, speed: 0.6, beamMul: 1.0, flee: 1.8 },
};

export const HEN_SKINS = [[0xfafafa, 0xe6e6e6], [0xc07a3a, 0xa0602a], [0x3a3a3e, 0x2a2a2e], [0xe8c890, 0xd4b070]];

export const SKILLS = [
  { id: 'fan',     cat: 'atk', rar: 'epico', icon: '🔱', title: tr('OVO LEQUE', 'FAN EGGS', 'VIUHKAMUNAT'),       desc: tr('+ovos em diagonal em todo tiro', '+diagonal eggs on every shot', '+vinomunia joka laukaukseen'),  lvl: [tr('+2 ovos em leque', '+2 fan eggs', '+2 viuhkamunaa'), tr('+4 ovos em leque', '+4 fan eggs', '+4 viuhkamunaa'), tr('+4 ovos, recarga menor', '+4 eggs, shorter cooldown', '+4 munaa, lyhyempi lataus')] },
  { id: 'double',  cat: 'atk', rar: 'epico', icon: '➕', title: tr('RAJADA DUPLA', 'DOUBLE BURST', 'TUPLASARJA'),    desc: tr('+ovos lado a lado em todo tiro', '+side-by-side eggs on every shot', '+rinnakkaisia munia joka laukaukseen'),  lvl: [tr('+1 ovo lado a lado', '+1 side egg', '+1 rinnakkaismuna'), tr('+2 ovos lado a lado', '+2 side eggs', '+2 rinnakkaismunaa'), tr('+2 ovos, recarga menor', '+2 eggs, shorter cooldown', '+2 munaa, lyhyempi lataus')] },
  { id: 'fury',    cat: 'atk', rar: 'raro',  icon: '😤', title: tr('FÚRIA', 'FURY', 'RAIVO'),            desc: tr('muito mais dano', 'much more damage', 'paljon enemmän vahinkoa'),                 lvl: [tr('+50% de dano', '+50% damage', '+50 % vahinkoa'), tr('+75% de dano', '+75% damage', '+75 % vahinkoa'), tr('+100% de dano', '+100% damage', '+100 % vahinkoa')] },
  { id: 'turbo',   cat: 'atk', rar: 'comum', icon: '⚡', title: tr('DEDO TURBO', 'TURBO FINGER', 'TURBOSORMI'),       desc: tr('atira muito mais rápido', 'shoots much faster', 'ampuu paljon nopeammin'),         lvl: [tr('+50% de cadência', '+50% fire rate', '+50 % tulinopeutta'), tr('+75% de cadência', '+75% fire rate', '+75 % tulinopeutta'), tr('+100% de cadência', '+100% fire rate', '+100 % tulinopeutta')] },
  { id: 'eagle',   cat: 'atk', rar: 'raro',  icon: '🎯', title: tr('OLHO DE ÁGUIA', 'EAGLE EYE', 'KOTKANSILMÄ'),    desc: tr('chance de crítico (dano x2)', 'critical chance (x2 damage)', 'kriittinen osuma (vahinko x2)'),     lvl: [tr('35% de crítico', '35% crit', '35 % kriittinen'), tr('50% de crítico', '50% crit', '50 % kriittinen'), tr('65% de crítico', '65% crit', '65 % kriittinen')] },
  { id: 'fire',    cat: 'egg', rar: 'raro',  icon: '🔥', title: tr('OVO FLAMEJANTE', 'FLAMING EGG', 'LIEKKIMUNA'),   desc: tr('as naves pegam fogo', 'saucers catch fire', 'lautaset syttyvät tuleen'),             lvl: [tr('queima +60%', 'burn +60%', 'palo +60 %'), tr('queima +120%', 'burn +120%', 'palo +120 %'), tr('queima +180%', 'burn +180%', 'palo +180 %')] },
  { id: 'ice',     cat: 'egg', rar: 'raro',  icon: '❄️', title: tr('OVO CONGELANTE', 'FREEZING EGG', 'JÄÄMUNA'),   desc: tr('naves e feixes ficam lentos', 'slows saucers and beams', 'hidastaa lautasia ja säteitä'),     lvl: [tr('40% mais lentas', '40% slower', '40 % hitaampia'), tr('60% mais lentas', '60% slower', '60 % hitaampia'), tr('60%, recarga menor', '60%, shorter cooldown', '60 %, lyhyempi lataus')] },
  { id: 'shock',   cat: 'egg', rar: 'raro',  icon: '🌩', title: tr('OVO ELÉTRICO', 'ELECTRIC EGG', 'SÄHKÖMUNA'),     desc: tr('choque pula pras vizinhas', 'shock jumps to nearby saucers', 'shokki hyppää viereisiin'),       lvl: [tr('pula pra 2 naves', 'jumps to 2 saucers', 'hyppää 2 lautaseen'), tr('pula pra 3 naves', 'jumps to 3 saucers', 'hyppää 3 lautaseen'), tr('pula pra 4 naves', 'jumps to 4 saucers', 'hyppää 4 lautaseen')] },
  { id: 'bounce',  cat: 'egg', rar: 'comum', icon: '🔁', title: tr('RICOCHETE', 'RICOCHET', 'KIMPOILU'),        desc: tr('o ovo quica de nave em nave', 'the egg bounces between saucers', 'muna kimpoaa lautaselta toiselle'),     lvl: [tr('quica 2 vezes', 'bounces 2 times', 'kimpoaa 2 kertaa'), tr('quica 3 vezes', 'bounces 3 times', 'kimpoaa 3 kertaa'), tr('quica 4 vezes', 'bounces 4 times', 'kimpoaa 4 kertaa')] },
  { id: 'pierce',  cat: 'egg', rar: 'comum', icon: '🗡', title: tr('OVO PERFURANTE', 'PIERCING EGG', 'LÄPÄISYMUNA'),   desc: tr('atravessa várias naves', 'goes through several saucers', 'läpäisee monta lautasta'),          lvl: [tr('atravessa 2', 'pierces 2', 'läpäisee 2'), tr('atravessa 3', 'pierces 3', 'läpäisee 3'), tr('atravessa 4', 'pierces 4', 'läpäisee 4')] },
  { id: 'bird',    cat: 'def', rar: 'epico', icon: '🐦', title: tr('PASSARINHO', 'LITTLE BIRD', 'PIKKULINTU'),       desc: tr('voa sozinho e caça naves', 'flies on its own and hunts saucers', 'lentää itse ja jahtaa lautasia'),        lvl: [tr('1 passarinho', '1 bird', '1 lintu'), tr('1 passarinho forte', '1 strong bird', '1 vahva lintu'), tr('2 passarinhos', '2 birds', '2 lintua')] },
  { id: 'slowmo',  cat: 'def', rar: 'raro',  icon: '⏳', title: tr('CÂMERA LENTA', 'SLOW MOTION', 'HIDASTUS'),     desc: tr('aliens em câmera lenta', 'aliens in slow motion', 'alienit hidastettuina'),          lvl: [tr('60% mais lentos', '60% slower', '60 % hitaampia'), tr('70% mais lentos', '70% slower', '70 % hitaampia'), tr('75% mais lentos', '75% slower', '75 % hitaampia')] },
  { id: 'bubble',  cat: 'def', rar: 'raro',  icon: '🛡', title: tr('BOLHA', 'BUBBLE', 'KUPLA'),            desc: tr('você não toma dano', 'you take no damage', 'et ota vahinkoa'),              lvl: [tr('bolha de 8s', '8s bubble', '8 s kupla'), tr('recarga menor', 'shorter cooldown', 'lyhyempi lataus'), tr('recarga mínima', 'minimum cooldown', 'lyhin lataus')] },
  { id: 'feather', cat: 'def', rar: 'comum', icon: '🪶', title: tr('ESCUDO DE PENAS', 'FEATHER SHIELD', 'HÖYHENSUOJA'),  desc: tr('galinhas bloqueiam abdução', 'chickens block abductions', 'kanat torjuvat sieppaukset'),      lvl: [tr('1 bloqueio por galinha', '1 block per chicken', '1 torjunta per kana'), tr('recarga menor', 'shorter cooldown', 'lyhyempi lataus'), tr('2 bloqueios por galinha', '2 blocks per chicken', '2 torjuntaa per kana')] },
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
  { id: 'canja', cat: 'def', rar: 'comum', icon: '🍲', title: tr('CANJA DA VOVÓ', "GRANNY'S SOUP", 'MUMMON KEITTO'), desc: tr('cura 50 de vida agora', 'heals 50 HP now', 'parantaa 50 HP heti'), instant: true },
  { id: 'angel', cat: 'def', rar: 'raro', icon: '👼', title: tr('ANJO DA GRANJA', 'FARM ANGEL', 'MAATILAN ENKELI'), desc: tr('+2 galinhas agora', '+2 chickens now', '+2 kanaa heti'), instant: true },
  { id: 'heart', cat: 'def', rar: 'comum', icon: '❤️', title: tr('CORAÇÃO DE GALO', 'ROOSTER HEART', 'KUKON SYDÄN'), desc: tr('+20 de vida máxima', '+20 max HP', '+20 maksimi-HP'), instant: true },
  { id: 'cash', cat: 'def', rar: 'comum', icon: '💰', title: tr('BOLADA', 'JACKPOT', 'POTTI'), desc: tr('+1500 pontos', '+1500 points', '+1500 pistettä'), instant: true },
];

export const POWERS = {
  golden:  { label: tr('OVO DE OURO', 'GOLDEN EGG', 'KULTAMUNA'), sub: tr('DANO x3 · 8s', 'DAMAGE x3 · 8s', 'VAHINKO x3 · 8 s'), color: 0xffc820, css: '#ffd040', icon: '🥚', dur: 8 },
  boom:    { label: tr('OVO-BOMBA', 'BOMB EGG', 'POMMIMUNA'), sub: tr('EXPLODE TUDO · 8s', 'EVERYTHING EXPLODES · 8s', 'KAIKKI RÄJÄHTÄÄ · 8 s'), color: 0xff6020, css: '#ff8040', icon: '💣', dur: 8 },
  slow:    { label: tr('CÂMERA LENTA', 'SLOW MOTION', 'HIDASTUS'), sub: tr('ALIENS LERDOS · 8s', 'SLOW ALIENS · 8s', 'HITAAT ALIENIT · 8 s'), color: 0x40c0ff, css: '#60d0ff', icon: '⏳', dur: 8 },
  chicken: { label: tr('+1 GALINHA', '+1 CHICKEN', '+1 KANA'), sub: '', color: 0xffffff, css: '#ffffff', icon: '🐔', dur: 0 },
  heal:    { label: tr('CURA', 'HEAL', 'PARANNUS'), sub: tr('+35 DE VIDA', '+35 HP', '+35 HP'), color: 0xff5070, css: '#ff6080', icon: '❤️', dur: 0 },
};
