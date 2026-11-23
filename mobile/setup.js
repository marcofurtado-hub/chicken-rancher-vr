// =============================================================================
// VERSÃO MOBILE — configuração da partida curta.
// Este arquivo roda ANTES do resto do jogo carregar (é o primeiro import do main.js):
// ele troca, em memória, as tabelas de `src/config.js` pela partida de celular.
// Nada em `src/` é editado: o jogo principal continua com as 10 waves dele.
// Para balancear a versão mobile, mexa só aqui.
// =============================================================================
import { WAVES, WEAPON_ORDER, BOSSES, BOSS_ORDER, WEAPON_TIPS, SKILLS } from '../src/config.js';
import { FIREBASE } from '../src/leaderboard-config.js';
import { tr } from '../src/i18n.js';

// ---------- 3 waves, 3 chefes (uns 4 minutos) ----------
// Só naves que dá para enfrentar SEM ANDAR: nada de bombardeira nem sniper ("saia de baixo / saia da mira").
// `ufoScale` maior que no jogo principal: nave grande é mais fácil de ver e acertar em tela pequena.
// `intro: 'saucer'` em todas: o banner da wave fica curto (sem a linha "NOVA AMEAÇA"), para caber em letra grande.
const MOBILE_WAVES = [
  { weapon: 'hands',   mix: { saucer: 5 },
    interval: 1.5, speed: 1.15, beamTime: 7.0, maxAlive: 3, hpMult: 1, boss: 'zepelim',   ufoScale: 1.7,  tod: 0,   close: true, intro: 'saucer',   aggro: 0 },
  { weapon: 'slingshot', mix: { saucer: 6, zippy: 3, tank: 2, gunner: 1 },
    interval: 1.2, speed: 1.5,  beamTime: 6.5, maxAlive: 4, hpMult: 1, boss: 'olhao',     ufoScale: 1.45, tod: 1.7, intro: 'saucer',   aggro: 0.5 },
  { weapon: 'gatling', mix: { saucer: 6, zippy: 4, tank: 3, gunner: 2, kamikaze: 2, splitter: 2 },
    interval: 0.85, speed: 2.0, beamTime: 5.4, maxAlive: 6, hpMult: 4, boss: 'galozilla', ufoScale: 1.25, tod: 3.4, intro: 'saucer',   aggro: 1.0 },
];
WAVES.length = 0;
WAVES.push(...MOBILE_WAVES);

// Uma arma por wave (a arma nova é a recompensa de passar de wave). Sem troca de arma: sempre a mais nova.
// Cada arma tem o seu gesto no polegar direito (ver main.js): deslizar, puxar e soltar, segurar.
WEAPON_ORDER.length = 0;
WEAPON_ORDER.push('hands', 'slingshot', 'gatling');

// Batedor → Vigia → Imperador. O Imperador chama os dois primeiros de volta durante a luta (já é assim no jogo).
// A ordem aqui também diz quais chefes são aquecidos no boot (menos coisa para o celular carregar).
BOSS_ORDER.length = 0;
BOSS_ORDER.push('zepelim', 'olhao', 'galozilla');
// Vida dos chefes para as armas da versão mobile (no jogo principal o Imperador enfrenta o laser, aqui a gatling).
BOSSES.olhao.hp = 70;
BOSSES.galozilla.hp = 2000;

// Melhorias: sai o OVO ESPERTO (ovo que curva até a nave). Aqui o ovo já persegue a nave que o gesto escolheu,
// então essa carta não mudaria quase nada. Ficam: ovo grandão, ricochete, ovo duplo, coração e ninhada.
{ const i = SKILLS.findIndex(k => k.id === 'mira'); if (i >= 0) SKILLS.splice(i, 1); }

// Dicas das armas com as palavras do celular (posição [1] = fora do VR)
WEAPON_TIPS.hands[1] = tr('deslize o dedo na direção da nave', 'swipe toward the saucer', 'pyyhkäise lautasta kohti');
WEAPON_TIPS.slingshot[1] = tr('puxe pra trás e solte', 'pull back and release', 'vedä taakse ja päästä');
WEAPON_TIPS.gatling[1] = tr('segure o dedo: 16 ovos por segundo', 'hold: 16 eggs per second', 'pidä sormea: 16 munaa sekunnissa');

// Ranking mundial fica só no jogo principal: uma partida de 3 waves não disputa com a de 10.
FIREBASE.projectId = '';
FIREBASE.apiKey = '';
