# Chicken Rancher VR 2.0: documento completo do jogo

> Bíblia de design e técnica do jogo. Serve para portar as armas e os sistemas para
> outros jogos e para criar variações do rancho. Todos os números foram tirados do código real
> (`index.html`, ~5.000 linhas, um arquivo só, Three.js r160 via CDN, sem build).

- **Jogar:** https://marcofurtado-hub.github.io/chicken-rancher-vr/
- **Versão 1.0 original:** https://marcofurtado-hub.github.io/chicken-rancher-vr/v1/
- **Repo:** https://github.com/marcofurtado-hub/chicken-rancher-vr
- **Plataformas:** Meta Quest (WebXR), **PC** (mouse + teclado, com movimento e zoom) e mobile (touch)

> **Vai usar em outro jogo? Comece pela [seção 12, Sistemas reaproveitáveis](#12-sistemas-reaproveitáveis-receitas-para-outros-jogos):**
> habilidades estilo Archero, multi-tiro universal, efeitos de impacto, ricochete, companheiro,
> escudo, vida do jogador, modo PC a partir do VR, HUD móvel no VR e teste por script.
> As armas estão na **seção 3** (com o guia de portar na 3.6).

**Versão 2.1 (mais difícil e variada):** 12 waves, 11 armas (novo **rojão de fogos**), 11 naves (novas
**bombardeira**, **sniper** e **ladra**), as naves comuns atiram plasma em você, **habilidades ativas de 8 s**
com recarga (no lugar das permanentes), **passarinho** que voa sozinho, power-ups de 8 s, **andar livre**
(joystick ou WASD, descer a rampa da varanda, cair) e a **cadeira de rodas voadora** na batalha final.

**Idiomas:** português, inglês e finlandês, escolhidos na tela inicial (receita 12.15).

---

## 1. Conceito

Você está numa **cadeira de rodas na varanda** de uma fazenda. Discos voadores descem para
**abduzir as galinhas** do quintal com feixe de luz. Sua munição é **ovo**: toda arma atira ovo,
do arremesso com a mão até o raio tesla. As galinhas funcionam como vidas. Se todas forem levadas,
é game over.

**Pilares**
1. **Waves com escalada clara:** cada wave traz uma arma nova e uma ameaça nova.
2. **Duas formas de perder:** se a sua vida ❤️ chegar a 0 ou se levarem todas as galinhas.
3. **Tudo é ovo:** a identidade cômica vem do splat de ovo frito no chão e da explosão de clara e gema no ar.
4. **VR confortável:** giro suave no joystick direito (curva quadrática, pivô na cabeça, até ~125°/s). Andar, girar e voar ligam uma vinheta escura nas bordas para não enjoar.
5. **Arremesso por gesto mede a mão relativa ao corpo** (posição local no rig), senão andar/girar/cair dispara arremessos sozinho.
5. **Feedback exagerado:** popups de pontos, combo, vibração, sons sintetizados e ciclo dia/noite.

**Loop principal**
```
idle → wave_intro (3s, banner) → playing → wave_complete (bônus) → upgrade (atira num card)
     → próxima wave ... → wave 12 (nave-mãe + cadeira voadora) → victory → modo infinito → game_over → idle
```

---

## 2. Controles

| Ação | VR (Quest) | PC | Mobile |
|---|---|---|---|
| Começar / avançar | gatilho | clique / Espaço | toque |
| Atirar | gatilho direito (segurar = automático) | clique esquerdo (segurar) | toque / segurar |
| Arremessar ovo (mão) | balançar o controle | clique (mira balística) | toque |
| Estilingue / besta | gatilho esquerdo pega a corda, puxa e solta | clique | toque |
| Pistolas duplas | um gatilho para cada mão | clique (alterna as mãos) | segurar |
| Trocar arma | A = próxima, X = anterior | 1-9, 0, - e roda | botão 🔄 |
| **Habilidades (3 slots)** | **B**, **Y** e **GRIP direito** | **Q**, **E** e **F** | botões na tela |
| **Andar** | **joystick esquerdo** (2.4 m/s, para todos os lados) | **WASD / setas** | n/a |
| Girar / mirar | joystick direito (giro suave) | mouse | arrastar |
| Voar (cadeira voadora) | olhar = direção · joystick esq. acelera/freia | olhar = direção · W/S acelera/freia | n/a |
| Zoom | n/a | **botão direito** (FOV 80 → 42, sensibilidade cai junto) | n/a |
| Pausa | n/a | **Esc** (tela de pausa com os controles) | n/a |
| Mover o painel do colo | GRIP perto do painel | n/a | n/a |
| Música | n/a | M | n/a |

**Andar e cair:**
- A varanda fica a 0.4 m do chão.
- Na frente dela, no vão do meio, há uma **rampa** de 1.2 m que leva ao quintal.
- As grades da frente e dos lados bloqueiam a passagem. Só se sobe pela rampa (degraus de mais de 12 cm bloqueiam).
- Se você sair pela lateral da rampa, **cai** com gravidade, ouve um baque e o controle vibra.
- O quintal é livre até a cerca.
- Encostar numa galinha faz ela pular assustada.

**Modo PC:**
- **Mira exata:** a cada frame um raio sai do centro da tela (`pcAim`) e todas as armas convergem para o ponto
  sob a mira, mesmo saindo do canto da tela.
- **Arremesso e estilingue** usam uma solução balística (`ballistic`): o ovo faz o arco certo para cair no ponto mirado.
  Isso dá 85% de acerto a 12 m.
- **Marcador de acerto:** a mira fica vermelha e cresce por um instante a cada acerto.
- A cadeira anda a 2.6 m/s pela varanda, pela rampa e pelo quintal (mesmas regras do VR).
- Ao perder o foco do mouse o jogo **pausa sozinho**.

**HUD:** no VR, um painel pequeno (30 × 16 cm) fica no colo, à esquerda, e sempre vira para você.
Ele mostra a **contagem de galinhas** em destaque (🐔 7/12, laranja com 4 ou menos, vermelho com 2 ou menos),
o detalhe por tipo, pontos, combo, wave, arma, power-ups e os ícones das habilidades com o nível.
**Segure o GRIP perto dele para mover.** A posição fica salva. No desktop o HUD é HTML no canto e há
uma barra de armas embaixo. Ao perder uma galinha aparece "-1 GALINHA · restam N".

---

## 3. ARMAS (o coração do jogo)

### 3.1 Modelo comum: todo projétil é um "ovo"

Toda arma de projétil cria o tiro pela mesma função, `spawnEgg(pos, vel, opções)`:

| Opção | O que faz | Padrão |
|---|---|---|
| `damage` | dano base (multiplicado por `up.dmg` e ×3 com Ovo de Ouro) | 1 |
| `gravity` / `gScale` | aplica gravidade (9.8 × gScale) | false / 1 |
| `scale` | tamanho visual do ovo | 1 |
| `arrow` / `rocket` | ovo alongado com aleta, orientado na direção do voo | false |
| `magnet` | assistência de mira: curva o ovo até o alvo mais próximo à frente | 0 |
| `homing` | míssil teleguiado (trava num alvo e persegue) | false |
| `boom`, `boomR`, `boomDmg` | explode ao bater: dano em área | false, 2.8 m, 2 |
| `pierce` | atravessa N naves | 0 + upgrade |
| `maxLife` | segundos até sumir | 5 |
| `extraR` | engorda a área de acerto (upgrade Ovo Gigante) | 0 |

**Colisão:** é um *swept segment*. A cada frame, o segmento posição anterior → posição atual é testado
contra elipsoides/esferas com `rayEllipsoidT`. Isso evita que tiros rápidos (75 m/s) atravessem
o alvo sem acertar. O acerto escolhido é o de menor `t` (a primeira coisa que o tiro encontra).

**Ao acertar:**
- **nave:** dano + explosão de clara e gema voando (`spawnEggSplat`)
- **chão:** splat de ovo frito (clara, gema e gotinhas) e as galinhas a menos de 1.6 m se assustam
- **parede ou teto da varanda:** splat
- **gosma:** é destruída (+50)
- **caixa de power-up:** ativa o power-up
- **card de upgrade:** escolhe o upgrade

### 3.2 Tabela das 11 armas

| # | Arma | Libera na | Tipo | Dano | Cadência | Velocidade | Especial |
|---|---|---|---|---|---|---|---|
| 1 | 🥚 **Ovos na mão** | wave 1 | arremesso físico | 1 | 380 ms por mão | v_mão × min(3+0.6·v, 9.5) | gravidade 0.35, ímã 4 |
| 2 | 🪨 **Estilingue** | wave 2 | puxa e solta (2 mãos) | 2 | livre | min(puxada×38, 24) m/s | gravidade 1, ímã 3 |
| 3 | 🏹 **Besta** | wave 3 | puxa e solta (2 mãos) | 2 | livre | 38 m/s | sem gravidade, ímã 1.5 |
| 4 | 🔫 **Pistolas duplas** | wave 4 | semiauto, 1 em cada mão | 2 | 0.16 s por mão | 60 m/s | spread 0.015 |
| 5 | 💥 **Escopeta** | wave 5 | 14 chumbos de ovo | 1 × 14 | 0.40 s | 62 m/s | spread 0.26, ovo 0.85× |
| 6 | 💣 **Lança-ovo** | wave 6 | granada em arco | 2 direto + 4 em área | 0.70 s | 26 m/s | gravidade 0.9, raio 3 m, ovo 1.7× |
| 7 | 🔥 **Gatling** | wave 7 | metralhadora (6 canos giram) | 2 | 0.05 s (20/s) | 75 m/s | spread 0.03 |
| 8 | 🚀 **Teleguiado** | wave 8 | rajada de 3 mísseis | 3 cada | 0.90 s | 12 → 24 m/s | trava em nave, caixa ou gosma, vida 4 s |
| 9 | ⚡ **Laser** | wave 9 | raio instantâneo em pulsos | 2 por pulso | ~9.5 pulsos/s | instantâneo, 40 m | tremor leve no feixe |
| 10 | 🌩 **Raio Tesla** | wave 10 | raio em cascata | 3 + cascata | 0.28 s | instantâneo, 45 m | salta para vizinhos com 55% / 30% / 17% |
| 11 | 🎆 **Rojão** | wave 11 | foguete de fogos de artifício | 12 em área (4.5 m) + 4 estalinhos de 4 | 0.85 s | 30 m/s | explode perto de uma nave (2.2 m) ou no céu depois de 1.15 s |

> As cadências são divididas por `up.rate` (upgrade Dedo Ligeiro). Todo dano é multiplicado por
> `up.dmg` (Ovo Turbinado) e por ×3 durante o Ovo de Ouro.

### 3.3 Detalhes de cada arma

**1. Ovos na mão (arremesso VR)**
- A velocidade do controle é medida a cada frame e guardada num histórico dos últimos 10 frames.
- Quando a velocidade passa de **2.0 m/s**, o ovo é lançado com o **pico** do histórico (não com a
  velocidade do momento, que já está desacelerando). Isso deixa o arremesso natural.
- Fator: `min(3 + 0.6·v, 9.5)`. Um swing lento de 2 m/s vira 8 m/s, um forte de 10 m/s vira 95 m/s.
- Gravidade leve (0.35) e ímã 4 (ajuda a acertar), com um ovo visível em cada mão.
- Desktop: lança 13 m/s para frente + 1.2 m/s para cima, gravidade 0.6.

**2. Estilingue (puxa e solta)**
- A mão direita segura o estilingue. A mão esquerda chega a **0.32 m** do saquinho, aperta o gatilho e puxa.
- Ao soltar: direção = repouso − saquinho, velocidade = `min(distância × 38, 24)` m/s.
  A puxada mínima é 2.5 cm.
- Elásticos são cilindros esticados entre as pontas da forquilha e o saquinho (`placeSegment`).

**3. Besta**
- Mesmo gesto do estilingue, mas a força é sempre máxima: **38 m/s**, sem gravidade, ovo-flecha com aleta vermelha.

**4. Pistolas duplas (akimbo)**
- Uma pistola em cada controle, cada gatilho dispara a sua, com cooldown independente de 0.16 s.
- Coice visual: a arma gira para cima um pouco (`kick`) e volta. No desktop elas alternam a cada 0.11 s.

**5. Escopeta**
- 14 ovos por disparo com espalhamento 0.26 e vibração forte (0.95). Ótima de perto e contra grupos.

**6. Lança-ovo**
- Granada de ovo grande em arco. Explode ao tocar nave, chão ou parede: `explodeAt` causa
  dano 4 em raio de 3 m, estoura gosmas, **coleta caixas de power-up** e assusta galinhas.

**7. Gatling**
- Segurar: os 6 canos aceleram a rotação (giro suavizado até 30 rad/s) e disparam 20 ovos por segundo.

**8. Teleguiado**
- Escolhe o alvo no **cone de mira** (cos > 0.75), dando preferência a pontos fracos, módulos e núcleo,
  e também a caixas e gosma. Se nada estiver no cone, pega o mais próximo.
- Os mísseis saem a 12 m/s espalhados, depois de 0.12 s começam a perseguir e aceleram até 24 m/s.
- Se o alvo morrer, o míssil trava em outro. Deixa rastro de fumaça.

**9. Laser**
- Segurar: pulsos de 45 ms ligado e 60 ms desligado. Cada pulso é um raycast instantâneo de 40 m
  com tremor de ±0.012. O feixe é dois cilindros aditivos, um externo e um núcleo branco.
- Com Ovo-Bomba ativo, 30% dos pulsos explodem em área.

**10. Raio Tesla (cascata)**
- Raycast de 45 m com mira generosa (+0.5 m). Acerta o alvo com **100%**.
- **Cascata:** de cada ponto atingido, salta para os **3 vizinhos mais próximos** num raio de **7 m**.
  São até **3 gerações** com dano **55% → 30% → 17%**, no máximo 10 alvos extras por disparo.
  Também estoura gosma no caminho e mostra o popup "CHOQUE xN!".
- Os raios são polilinhas em zigue-zague **suave** (desvio de 0.15 no principal e 0.22 na cascata) feitas com
  um pool de 140 cilindros aditivos. Cada segmento tem vida própria de 0.09 s.

```js
// Núcleo da cascata
let frontier = [hitPoint], dmg = base, total = 0;
for (let gen = 0; gen < 3 && frontier.length && total < 10; gen++) {
  dmg *= 0.55;
  const next = [];
  for (const from of frontier) {
    const cands = inimigosVivosNaoAtingidos()
      .map(u => ({ u, d: u.centro.distanceTo(from) }))
      .filter(c => c.d < 7).sort((a, b) => a.d - b.d).slice(0, 3);
    for (const c of cands) { atingido.add(c.u); total++; desenharRaio(from, c.u.centro); dano(c.u, dmg); next.push(c.u.centro); }
  }
  frontier = next;
}
```

**11. Rojão (fogos de artifício)**
- Sobe assobiando com um rastro de faíscas coloridas e uma gravidade bem leve (0.15).
- Explode quando passa a 2.2 m de qualquer nave, quando bate em algo ou depois de 1.15 s, no céu.
- A explosão tem 110 partículas numa paleta de 2 cores (5 paletas), um flash branco e um anel de choque.
  Ela causa **12 de dano em todas as naves a até 4.5 m** e solta **4 estalinhos** que explodem logo depois
  (4 de dano cada, raio 2.5 m).
- Também coleta power-ups e estoura gosma. Um rojão matou 4 naves blindadas (6 de vida cada) de uma vez.

### 3.4 Modificadores globais das armas

| Fonte | Efeito |
|---|---|
| Power-up **Ovo de Ouro** (10 s) | dano ×3, ovo dourado com rastro brilhante |
| Power-up **Ovo-Bomba** (10 s) | todo ovo explode em área (2.8 m, dano 2) |
| Power-up **Câmera Lenta** (7 s) | inimigos e gosma a 35% de velocidade, seus tiros normais |
| Habilidades (seção 6.3) | Ovo Duplo e Leque multiplicam os tiros de **todas** as armas. Ricochete, fogo, gelo, choque, crítico e fúria valem para ovos, laser e tesla |

**Como os tiros múltiplos funcionam em cada arma** (`volleyDirs`):
- **Ovo Duplo** = +1 cópia paralela por nível (afastadas 16 cm).
- **Ovo Leque** = +2 cópias por nível, a ±14° (e ±28° no nível 2).
- Todo ovo nasce com `spawnEgg(..., { volley: true })` e é replicado ali dentro.
- A escopeta reduz os chumbos por cópia (14/√n) e a gatling tem vida de 1.2 s, para não estourar o limite de 240 projéteis.
- O teleguiado só replica o 1º míssil da rajada.
- O laser ganha um feixe por direção (até 7) e o tesla um raio principal por direção (até 5), compartilhando a cascata.

### 3.5 Assistência de mira (ímã)

```js
// Por frame, para projéteis com magnet > 0:
// procura o alvo mais próximo (até 3.5 m + magnet*0.3) que esteja À FRENTE (dot > 0.7)
// e gira a velocidade em direção a ele mantendo o módulo:
vel.lerp(direcaoParaAlvo * |vel|, min(1, magnet * dt / max(dist, 0.6)));
```
É sutil: corrige uns 20 a 40% no fim da trajetória. No VR isso faz o arremesso parecer muito
melhor do que é. Esse é o segredo do arremesso ser gostoso.

### 3.6 Como portar as armas para outro jogo

O contrato mínimo para reaproveitar as armas é este:

1. **Alvos com partes:** cada inimigo expõe `parts[]` com `{ c: Vector3 (centro no mundo), r ou ellip:[ax,ay,az], kind, mult, active }`.
   Atualize `c` uma vez por frame (`refreshPartCenters`) e logo ao criar o inimigo.
2. **`castSegment(origem, direção, maxT, extraR)`:** devolve o primeiro acerto `{kind, alvo, t}`.
   Projéteis usam o segmento do frame com `maxT = 1`, armas instantâneas usam a direção unitária com `maxT = alcance`.
3. **`applyHit(hit, dano, pos)`:** encaminha pelo tipo (inimigo, projétil inimigo, power-up, card de UI).
4. **`hitPart(alvo, parte, dano, pos)`:** escudo bloqueia, blindagem faz "tink", módulo tem HP próprio,
   e o resto aplica `dano × mult` (crítico = 2×).
5. **Mira:** VR usa o quaternion do controle direito. Desktop converge o tiro da arma (canto da tela)
   para o ponto a 25 m no centro da mira (`shotDir`), senão o tiro sai paralelo e erra.
6. **Coice e muzzle flash:** `grp.userData.kick = 1`, decai 9/s e gira a arma em X. O flash é uma partícula aditiva de 70 ms.

Para trocar o tema basta trocar **o mesh do projétil e o splat**. Por exemplo: tomate com splat vermelho,
bola de neve que vira pó branco, bolha de sabão que estoura. O resto continua igual.

---

## 4. INIMIGOS

### 4.1 Os 11 tipos de nave

| Tipo | Papel | HP base | Escala | Vel. | Feixe | Pontos | Drop | Comportamento |
|---|---|---|---|---|---|---|---|---|
| **Comum** | abduz | 1 | 1.0 | 1.0× | 1.0× | 100 | 7% | desce até a galinha e abduz com feixe |
| **Veloz** | abduz | 1 | 0.78 | 1.75× | 0.65× | 150 | 9% | zigue-zague lateral (amplitude 2.6 m) |
| **Blindada** | abduz | 3 | 1.35 | 0.62× | 1.25× | 250 | 22% | lenta e resistente, anel dourado |
| **Atiradora** | atira | 2 | 1.05 | 1.1× | n/a | 200 | 14% | para a 9-13 m e cospe gosma a cada ~3 s |
| **Kamikaze** | mergulha | 1 | 0.85 | n/a | n/a | 175 | 10% | sirene, pisca 1.3 s e mergulha na sua cara |
| **Divisora** | abduz | 2 | 1.25 | 0.9× | 1.0× | 200 | 12% | ao morrer vira 2 mini naves |
| **Escudeira** | suporte | 3 | 1.1 | 0.8× | n/a | 300 | 28% | blinda até 3 naves a menos de 11 m (bolha + cabo) |
| **Fantasma** | abduz | 1 | 1.0 | 1.2× | 0.9× | 250 | 14% | fica 1.8 s invisível e intocável, 2.4 s visível |
| **Bombardeira** | bombardeia | 3 | 1.2 | n/a | n/a | 250 | 18% | passa por cima de você a 10 m e solta bombas. Um anel vermelho no chão mostra onde cada uma vai cair |
| **Sniper** | atira | 2 | 0.95 | n/a | n/a | 300 | 20% | fica a 18-24 m e mira um laser em você por 2 s. A mira trava 0.45 s antes do tiro, então dá para sair |
| **Ladra** | rouba | 2 | 0.9 | n/a | n/a | 250 | 12% | voa baixo, **agarra** a galinha com garras e foge a 3.2 m/s. Se passar de 22 m, levou |
| *Mini* | abduz | 1 | 0.6 | 1.6× | 0.7× | 60 | 0% | filha da divisora, zigue-zague 1.6 m |

O HP real é `HP base × hpMult da wave` (de 1 a 3 na campanha, crescendo no infinito).

**Ataques contra você (todos podem ser evitados):**

| Ataque | Quem | Dano | Como evitar |
|---|---|---|---|
| Plasma vermelho (rápido) | naves comuns, a partir da wave 3 (a barriga pisca antes) | 10 | atirar nele ou desviar |
| Gosma verde (lenta) | atiradora, chefão, nave-mãe | 18 | atirar nela no ar |
| Bomba | bombardeira | 28 (raio 2 m) | sair do anel vermelho |
| Laser | sniper | 25 | sair da linha depois que a mira trava |
| Mergulho | kamikaze | 35 | derrubar antes |

O **aggro** da wave (de 0 a 1.8, maior no infinito) controla a frequência desses ataques.

**Detalhes dos comportamentos**
- **Abdução:** a nave desce até `descendH` (2.5 a 4.6 m) acima da galinha. O feixe dura
  `beamTime × multiplicador da galinha × upgrade`, a galinha sobe aos poucos, e no fim a nave foge
  para cima. Matar durante o feixe **resgata** a galinha, que desce planando, e dá bônus.
- **Atiradora:** carrega 0.75 s (a barriga cresce com partículas verdes e um som de carga) e depois
  atira uma gosma a 4.6 + 0.3×wave m/s na direção da sua cabeça. A gosma pode ser abatida no ar.
  Se acertar, a tela cobre de gosma por 2.6 s e o combo zera.
- **Kamikaze:** vai até um ponto a 11-14 m, pisca vermelho e mergulha a 8 + 0.35×wave m/s com
  perseguição leve. Se chegar a 1.1 m de você: gosma na tela, combo zera e todas as galinhas se assustam.
- **Escudeira:** a cada 3 s escolhe as 3 naves mais próximas. Elas ganham uma bolha azul e tiros nelas
  fazem "tink" até a escudeira morrer. Um cabo de energia liga as duas, para o jogador entender quem matar.
- **Fantasma:** casco com 7% de opacidade e área de acerto desligada quando invisível. Fica visível ao abduzir.

### 4.2 Chefão (waves 3, 6 e 9)
- Escala 2.4, casco escuro, espinhos, coroa no alien, antena piscando e barra de HP.
- **Ponto fraco:** esfera vermelha embaixo que leva dano ×2 e mostra "CRÍTICO!". O corpo é um elipsoide achatado,
  e a esfera fica para fora dele, então dá para acertar de baixo.
- Entra, paira e faz strafe, escolhe uma galinha, desce e abduz, depois **volta a pairar** (não foge).
- **Reforços:** com 66% e 33% de HP chama 2 naves.
- Da wave 6 em diante cospe 1 gosma, e na wave 9 cospe 3.
- HP: wave 3 = 8, wave 6 = 45, wave 9 = 120. Pontos: 1500 + 250×wave. Sempre derruba power-up.

### 4.3 Nave-mãe (wave 10)
- Disco de ~10 m de diâmetro a 15 m de altura que balança de lado e gira.
- **Fase 1:** 3 **módulos vermelhos** (30 HP cada) embaixo. O casco é blindado ("BLINDADO!").
- **Fase 2:** sem os módulos, a placa da barriga cai e o **núcleo rosa** (100 HP) fica exposto.
- Ataques: rajada de 3 gosmas a cada 3.6 s (4 a cada 2.4 s na fase 2) e lança naves comuns, velozes ou kamikazes.
- Morte: explosões em sequência por 3 s e reação em cadeia que destrói todas as naves restantes.

### 4.4 Inimigo como entidade (estrutura reaproveitável)
```js
{ kind: 'ufo'|'boss'|'mother', typeKey, group, hullMat, state, target,
  hp, maxHp, speed, beamTime, descendH, parts:[...], shieldedBy, links,
  flashT /* pisca branco ao levar dano */, removed }
```
**Estados:** `descending`, `beaming`, `escaping` (abdutoras), `approach` e `hover` (atiradora e escudeira),
`approach`, `windup` e `dive` (kamikaze), `entering`, `hover` e `rising` (chefão), `fighting` (nave-mãe),
`dead` (cai girando, solta fumaça e explode no chão) e `dying` (nave-mãe).

---

## 5. VIDA DO JOGADOR

| Item | Valor |
|---|---|
| Vida inicial | 100 |
| Plasma / gosma / laser da sniper / bomba / kamikaze | −10 / −18 / −25 / −28 / −35 |
| Invencibilidade depois de levar dano | 0.6 s (uma rajada não mata de uma vez) |
| Cura no fim de cada wave | +15 |
| Power-up ❤️ **Cura** | +35 (cai mais quando a vida está abaixo de 60% e de 35%) |
| Vida baixa (30% ou menos) | batimento cardíaco + vinheta vermelha pulsando |

**Cards ligados à vida (efeito na hora, não ocupam slot):**
- ❤️ **Coração de Galo:** +20 de vida máxima (até 160)
- 🍲 **Canja da Vovó:** cura 50. É garantida no slot de DEFESA se você terminar a wave com menos de 45%
- Habilidade 🛡 **Bolha:** 8 s sem tomar dano

**Derrota:** "VOCÊ FOI DERROTADO" (vida 0) ou "LEVARAM TODAS AS GALINHAS". A barra de vida aparece no painel do
colo (VR) e no HUD (PC).

## 5b. GALINHAS (as vidas do rancho)

| Tipo | Escala | Andar | Fuga | Tempo de abdução | Observação |
|---|---|---|---|---|---|
| 🐔 Galinha | 1.0 | 0.6 m/s | 1.7 m/s | 1.0× | 4 cores (branca, ruiva, preta, creme) |
| 🐓 Galo | 1.22 | 0.7 | 1.9 | **1.6×** (mais pesado) | canta no começo de cada wave |
| 🐥 Pintinho | 0.6 | 1.0 | 2.4 | **0.7×** (leve) | **vira galinha** depois de 2 waves |
| 🌟 Galinha de Ouro | 1.05 | 0.6 | 1.8 | 1.0× | os aliens a preferem (35%), solta brilho, +500 se sobreviver à wave |

- **Bando inicial:** 4 galinhas, 1 galo, 1 Galinha de Ouro e 1 pintinho. **Máximo de 12.**
- **Estados:** passeando, ciscando, fugindo (um "!" vermelho aparece quando uma nave a 7 m mira nela),
  assustada (pula quando um ovo cai perto), sendo abduzida, salva (desce planando) e levada.
- **Wave perfeita** (sem perder nenhuma galinha) faz nascer um pintinho.

---

## 6. PROGRESSÃO

### 6.1 As 12 waves

| Wave | Hora | Arma nova | Nova ameaça | Aggro | Máx. vivas | hpMult | Especial |
|---|---|---|---|---|---|---|---|
| 1 | meio-dia | Mão | Comum | 0 | 3 | 1 | 7 comuns perto da varanda |
| 2 | dia | Estilingue | Veloz | 0 | 4 | 1 | |
| 3 | tarde | Besta | Blindada | 0.6 | 5 | 1 | **chefão 10 HP** |
| 4 | tarde dourada | Pistolas | Atiradora | 1.0 | 7 | 1 | |
| 5 | pôr do sol | Escopeta | Kamikaze | 1.1 | 8 | 2 | |
| 6 | pôr do sol | Lança-ovo | Divisora | 1.2 | 9 | 2 | **chefão 55 HP** (2 gosmas) |
| 7 | crepúsculo | Gatling | Escudeira | 1.3 | 10 | 3 | |
| 8 | anoitecer | Teleguiado | Fantasma | 1.4 | 11 | 3 | |
| 9 | noite | Laser | **Bombardeira** | 1.5 | 12 | 2 | **chefão 140 HP** (3 gosmas) |
| 10 | noite | Raio Tesla | **Sniper** | 1.6 | 12 | 3 | |
| 11 | noite | **Rojão** | **Ladra** | 1.7 | 13 | 3 | |
| 12 | noite | n/a | todas | 1.8 | 13 | 3 | **NAVE-MÃE** (módulos 40, núcleo 130) + **CADEIRA VOADORA** |

Cada wave tem de 7 a 56 naves. O intervalo entre elas cai de 1.7 s para 0.55 s e o feixe de abdução de 7 s para 4.3 s.

**Fórmula do modo infinito** (wave n = 0, 1, 2...): todos os 11 tipos, crescendo +1 a +3 por wave;
intervalo = max(0.3, 0.52 − 0.03n), hpMult = 3 + 0.4n, aggro = 1.9 + 0.12n, chefão de HP 160 + 45n,
e a cada 3 waves uma nave-mãe com cadeira voadora.

**Ritmo dentro da wave:** a fila é embaralhada, mas as 2 primeiras são sempre comuns e a nova ameaça
vem em 3º, para o jogador conhecer o inimigo novo. O chefão aparece com 45% da fila e a nave-mãe
2.5 s depois do início.

### 6.2 Pontuação

| Evento | Pontos |
|---|---|
| Abater nave | valor do tipo (60 a 300), chefão 1500+, nave-mãe 6000 |
| Resgate (matar durante o feixe) | +300 |
| "NA HORA H!" (resgate com feixe acima de 72%) | +600 |
| "DE LONGE!" (acima de 17 m) | +100 |
| DUPLO / TRIPLO / MASSACRE (abates em 0.25 s) | +100 / +250 / +400 |
| Destruir módulo da nave-mãe | +800 |
| Gosma abatida | +50 |
| Fim de wave | +150 por galinha viva, +1000 se perfeita, +500 se a Galinha de Ouro sobreviveu |

**Combo:** cada abate renova uma janela de 2.6 s (+1 s por nível de upgrade). Multiplicador =
`min(5, 1 + floor((combo − 1) / 3))`, ou seja x2 a partir de 4 abates, x3 a partir de 7, até x5.
Zera ao perder galinha, levar gosma ou levar um kamikaze. O recorde fica salvo em `localStorage`.

### 6.3 Habilidades ATIVAS entre as waves (8 s + recarga)

Entre as waves você escolhe 1 de 3 cards (atirando nele). As escolhas seguem as regras do Archero, mas o **efeito
não é permanente**. O card te dá uma **habilidade ativa** que você liga com um botão.

- **Duração:** 8 s. **Recarga:** 26 s, depois 22 s e 18 s conforme o nível (1 a 3).
- **Até 3 equipadas**, uma em cada botão: B / Y / GRIP direito no VR, Q / E / F no PC, botões na tela no mobile.
- No começo de cada wave todas voltam **prontas**.
- Quando os 3 slots estão cheios, só aparecem cards que **sobem o nível** do que você já tem, ou cards de efeito na hora.
- O HUD mostra cada slot: ícone, botão, "ATIVO 5s", recarga em segundos ou "PRONTO!". Ao ficar pronta toca um som e
  aparece um popup.

**Regras da oferta:**
- 1 card por categoria (ATAQUE · OVO · DEFESA), com raridade comum, raro ou épico.
- A primeira escolha é um ataque épico.
- Depois de um chefão há uma escolha extra com épico garantido.
- 40% de chance de oferecer uma habilidade que você já tem.
- Se você está mal, aparece um card de socorro (Anjo ou Canja).

| Card | Cat. | Rar. | Efeito por nível (enquanto ativo) |
|---|---|---|---|
| 🔱 Ovo Leque | Ataque | épico | +2 ovos em diagonal → +4 → +4 e recarga menor |
| ➕ Rajada Dupla | Ataque | épico | +1 ovo lado a lado → +2 → +2 e recarga menor |
| 😤 Fúria | Ataque | raro | +50% / +75% / +100% de dano |
| ⚡ Dedo Turbo | Ataque | comum | +50% / +75% / +100% de cadência |
| 🎯 Olho de Águia | Ataque | raro | 35% / 50% / 65% de crítico (×2) |
| 🔥 Ovo Flamejante | Ovo | raro | queima +60% / +120% / +180% do dano em 3 s |
| ❄️ Ovo Congelante | Ovo | raro | nave e feixe 40% / 60% mais lentos |
| 🌩 Ovo Elétrico | Ovo | raro | choque pula para 2 / 3 / 4 naves |
| 🔁 Ricochete | Ovo | comum | quica 2 / 3 / 4 vezes |
| 🗡 Ovo Perfurante | Ovo | comum | atravessa 2 / 3 / 4 naves |
| 🐦 **Passarinho** | Defesa | épico | 1 passarinho → 1 mais forte → 2 passarinhos que voam sozinhos e atiram |
| ⏳ Câmera Lenta | Defesa | raro | aliens 60% / 70% / 75% mais lentos |
| 🛡 Bolha | Defesa | raro | 8 s sem tomar dano (recarga cada vez menor) |
| 🪶 Escudo de Penas | Defesa | comum | cada galinha bloqueia 1 abdução (2 no nível 3) |
| 🍲 Canja / 👼 Anjo / ❤️ Coração | Defesa | n/a | **na hora:** +50 de vida / +2 galinhas / +20 de vida máxima |

**Passarinho (independente da câmera):**
- Nasce do seu lado e voa sozinho pelo quintal.
- Persegue a nave mais urgente (prioriza a que está abduzindo ou roubando), circulando a 3 m dela.
- Atira um ovo a cada 0.45 s.
- Depois dos 8 s, sobe e vai embora.

### 6.4 Power-ups (caixas de paraquedas)
- Caem de naves abatidas com a chance do tipo × Sorte, mais uma garantia a cada 22 abates sem
  drop. No máximo 2 caixas na tela.
- Descem a 0.85 m/s balançando e ficam 5.5 s no chão (piscam no fim). **Atire para pegar.**
  A área de acerto é um elipsoide de 0.8 × 1.0 × 0.8 m que cobre a caixa e o paraquedas inteiro.

| Power-up | Efeito | Duração |
|---|---|---|
| 🥚 Ovo de Ouro | dano ×3 | 8 s |
| 💣 Ovo-Bomba | tudo explode em área | 8 s |
| ⏳ Câmera Lenta | aliens a 35% de velocidade (vinheta azul) | 8 s |
| ❤️ Cura | +35 de vida (mais comum quando você está machucado) | n/a |
| 🐔 +1 Galinha | uma galinha desce do céu (mais comum quando você tem menos de 5) | n/a |

---

## 7. VISUAL

**Estilo:** low-poly com flat shading, cores saturadas e tudo procedural (não há nenhuma imagem ou modelo externo).

**Cenário:** casa com varanda, cerca, celeiro com telhado triangular, moinho girando, galinheiro,
espantalho, fardos de feno, árvores e pinheiros, morros no horizonte, estrada, milharal (~350
pés instanciados), 1.900 folhas de grama instanciadas, flores e nuvens de cubos.

**Ciclo dia → noite** (`applyTOD`, 5 keyframes interpolados): céu em degradê com halo do sol
(shader próprio), neblina, cor e intensidade da luz, sol que se põe na frente do jogador,
lua, estrelas discretas (220, bem fracas), janelas da casa acendendo, lampião da varanda
e vaga-lumes. Cada wave tem um valor `tod` de 0 a 4.

**Discos voadores:** casco feito por revolução de um perfil (LatheGeometry), domo de vidro com alien
que sempre olha para você, luzes coloridas girando na borda, barriga brilhante, feixe com textura
animada e anéis subindo, e anel no chão. **À noite** as luzes ganham halos e giram mais rápido e
o casco brilha de leve. Cada nave tem sombra no chão que muda de tamanho com a altura.

**Efeitos:**
- 2 sistemas de partículas em GPU (aditivo e normal), com 1 draw call cada
- popups 3D de texto que crescem com a distância para continuarem legíveis
- explosões (esfera + anel de choque)
- overlays presos na câmera (vinheta vermelha de dano, gosma, flash dourado e vinheta azul de câmera lenta), que funcionam no VR e no desktop
- banner 3D que segue o olhar devagar

## 8. ÁUDIO (100% sintetizado com Web Audio)
- ~50 efeitos feitos de osciladores e ruído filtrado, com limite de repetição para não estourar
  quando a gatling dispara 20 vezes por segundo.
- **Música procedural:** country (G-C-D-G) de dia e progressão menor (Em-C-Am-B) à noite, com
  arpejo e baixo. A bateria entra durante a wave e acelera quando há chefão. O BPM sobe com a wave.
- **Vibração:** cada arma tem intensidade e duração próprias. Explosões grandes vibram os dois controles.

## 9. DESEMPENHO NO QUEST (técnicas reaproveitáveis)
1. **`bakeStatic(grupo)`:** funde todas as malhas estáticas numa geometria só com cores por vértice.
   O cenário inteiro vira **1 draw call**. Use também em armas, cadeira, galinhas e nuvens.
2. **InstancedMesh** para grama, flores e milho.
3. **Partículas em GPU** com shader próprio. O tamanho do ponto é calculado pela altura do framebuffer do
   XR, porque o `PointsMaterial` padrão erra o tamanho no VR.
4. **Geometrias e materiais compartilhados.** Nada de `new SphereGeometry` por partícula
   (a v1 fazia isso e engasgava).
5. Antialias ligado, pixel ratio no máximo 1.5 no VR e no mobile (2 no PC), foveation 1 e no máximo 240 projéteis.

## 10. ESTRUTURA DO CÓDIGO (`index.html`)

| Seção | Funções-chave |
|---|---|
| Config | `WEAPONS`, `WEAPON_ORDER`, `UFO_TYPES`, `WAVES`, `endlessWave` |
| Render e helpers | `bakeStatic`, `mergeToGeometry`, `box/cyl/sph/cone`, `canvasTex` |
| Céu e tempo | `applyTOD`, `TOD_KEYS`, `makeCloud`, `updateFireflies` |
| Efeitos | `Particles`, `sparks`, `fireball`, `smoke`, `spawnBlast`, `spawnEggSplat`, `spawnFriedEggSplat`, `popup`, `makeOverlay` |
| Áudio | `tone/noise`, `play*`, `musicTick`, `scheduleStep` |
| Galinhas | `makeChicken`, `spawnChicken`, `updateChickens`, `scareChicken` |
| Naves | `buildUfoMesh`, `buildMothership`, `spawnRegular`, `spawnBoss`, `spawnMothership`, `update*` (Abductor, Gunner, Kamikaze, Shielder, Boss, Mother) |
| Gosma e caixas | `fireGoo`, `updateGoos`, `spawnCrate`, `updateCrates` |
| Armas | `weaponGroup`, `equipWeapon`, `spawnEgg`, `fire*`, `throwEgg`, `fireSlingshotPouch`, `tickLaser`, `fireTesla`, `drawBolt` |
| Colisão e dano | `rayEllipsoidT`, `castSegment`, `applyHit`, `applyMagnet`, `explodeAt`, `hitPart`, `killUfo` |
| Pontuação | `registerKill`, `comboMult`, `maybeDropCrate`, `activatePower` |
| Habilidades (Archero) | `UPGRADES`, `RARITY`, `buildOffer`, `rollRarity`, `showUpgradeCards(kind)`, `chooseUpgrade`, `skillList`, `pendingPicks` |
| Multi-tiro e efeitos | `volleyDirs`, `volleyCount`, `spawnEgg({volley})`, `applyStatus`, `bounceChain`, `hitPart(..., fx)` |
| Companheiro e escudo | `updateBuddies`, `setChickenShield` |
| Vida do jogador | `damagePlayer`, `healPlayer`, `hp/hpMax/invulnT` |
| Modo PC | `updatePcControls` (WASD, zoom, `pcAim`, marcador de acerto), `ballistic`, `setPaused` |
| Fluxo | `startWave`, `updateWaveLogic`, `waveComplete`, `enterVictory`, `enterGameOver(reason)`, `resetGame` |
| Entrada | `onTriggerStart/End`, `pollButtons`, `vrSnap`, `trackHands`, `syncWeapons`, mouse, teclado, touch e grip |
| HUD | `drawLap` (painel do colo), `updateHtmlHud`, `flockDetail` |
| Loop | `gameLoop` (cada etapa do frame em ordem) |

**Ganchos de teste:** `window.__cr` traz `startWave`, `step(n)` (avança n frames sem renderizar),
`aimAt`, `setHold`, `shoot`, `killAll`, `spawnUfo`, `spawnCrate`, `hitCard`, `hp`, `rig` e outros.
Com eles dá para rodar a campanha inteira por script (veja a seção 12.11).

---

## 11. COMO CRIAR VARIAÇÕES DO RANCHO

### 11.1 O que trocar (do mais fácil para o mais difícil)
1. **Números:** edite `WAVES`, `UFO_TYPES` e os valores dentro de `fire*`. Não precisa mexer em lógica.
2. **Projétil e splat:** `EGG_GEO`/`EGG_MAT` e `spawnEggSplat`/`spawnFriedEggSplat`.
3. **O que você protege:** `makeChicken` + `CHICKEN_KINDS` (mesma máquina de estados).
4. **Inimigo:** `buildUfoMesh` + `ACCENT` (os comportamentos não dependem do visual).
5. **Cenário:** o bloco `WORLD` (tudo vai para o `bakeStatic`) e as cores do `TOD_KEYS`.
6. **Regras novas:** um papel novo em `UFO_TYPES.role` com a sua função `update*`.

### 11.2 Ideias de variações
| Variação | Você protege | Inimigos | Munição / splat | Diferencial |
|---|---|---|---|---|
| **Pig Ranch** | porquinhos na lama | drones de entrega roubando porcos | espiga de milho / grãos voando | porcos fogem rolando na lama |
| **Iceberg Penguins** | pinguins no gelo | focas e orcas pulando da água | bola de neve / pó branco | ataques vêm de baixo (água) |
| **Halloween Ranch** | abóboras | morcegos e fantasmas de verdade | ovo podre verde | sempre noite, abóboras com luz |
| **Pirate Cove** | baús de ouro | gaivotas ladras e polvos | coco / leite espirrando | você num barco que balança de leve |
| **Space Farm** | vacas espaciais | asteroides vivos | ovo de luz neon | gravidade baixa, ovos flutuam |
| **Apiário** | colmeias | vespas e ursos | bolinha de mel grudenta | o mel deixa o inimigo lento |
| **Chicken Rancher: Invasão Total** | a cidade inteira | mesmas naves com mais tipos | ovos | mapa maior, galinhas em telhados |

### 11.3 Ideias de armas novas (já cabem no sistema)
- **Ovo bumerangue:** projétil com `vel` que inverte depois de 0.6 s e volta para a mão.
- **Rede de ovo:** acerto prende a nave por 3 s (`edt = 0` só para ela).
- **Ovo de gelo:** congela em área. Funciona como câmera lenta localizada (`explodeAt` + status).
- **Canhão de galinha:** atira a própria galinha (sem perder vida), que explode em penas.
- **Torreta de espantalho:** pegar um card cria uma torreta que atira sozinha usando `acquireTarget`.
- **Escudo de frigideira (mão esquerda):** rebate a gosma de volta para a nave.

### 11.4 Checklist para um jogo derivado
- [ ] Copiar `index.html` para a pasta nova e trocar título, cores e textos
- [ ] Ajustar a tabela `WAVES` (primeiro a fantasia, depois os números)
- [ ] Trocar o mesh e o splat do projétil
- [ ] Trocar o protegido (`makeChicken`) e o inimigo (`buildUfoMesh`)
- [ ] Renomear as habilidades para o tema (ex.: "Ovo Flamejante" vira "Tomate Picante"), mantendo o efeito
- [ ] Decidir as condições de derrota (vida do jogador, protegidos ou as duas) e os valores de dano
- [ ] Conferir o modo PC: limites do WASD para o novo cenário e o alcance do `pcAim`
- [ ] Rodar por script com `__cr.step` (campanha inteira) para pegar erros
- [ ] Testar no Quest: arremesso, estilingue, pistolas, painel do colo e desempenho
- [ ] Testar no PC: WASD, zoom, pausa no Esc e se a mira acerta onde aponta
- [ ] Publicar no GitHub Pages (`marcofurtado-hub/<slug>`) e adicionar o card no hub

---

## 12. SISTEMAS REAPROVEITÁVEIS (receitas para outros jogos)

Cada receita abaixo é **independente do tema**: não depende de ovo, galinha ou disco voador. Para cada uma
há a ideia, os números que funcionaram e o código principal para copiar.

**Que sistemas combinam com cada tipo de jogo:**

| Tipo de jogo | Receitas que mais rendem |
|---|---|
| Wave shooter parado (VR ou PC) | todas, principalmente 12.1, 12.2, 12.7 e 12.8 |
| Tower defense / proteger algo | 12.1, 12.5 (companheiro = torre), 12.6 (escudo de uso único), 12.7 |
| Roguelite de salas (tipo Archero) | 12.1, 12.2, 12.3, 12.4 e 12.7 |
| Jogo de arremesso / física | 12.8 (mira balística) e 3.5 (ímã) |
| Qualquer jogo VR | 12.8 (versão PC de graça), 12.9 (HUD móvel), 12.11 (teste por script) |

### 12.1 Progressão estilo Archero (escolha 1 de 3 habilidades)

> **Duas variantes testadas neste jogo:**
> (a) **permanentes**: o efeito vale a partida toda. É a 2.0 e está descrita abaixo.
> (b) **ativas de 8 s com recarga**: é a 2.1, descrita na seção 6.3.
> A (b) deixa o jogo mais difícil e mais dinâmico, porque o jogador escolhe a hora certa de usar cada
> habilidade. Para trocar de (a) para (b), basta recalcular `up` a cada frame a partir só das habilidades
> ativas (`refreshUp`).

**Por que funciona:** cada escolha muda o jogo de um jeito que o jogador **vê** (dobrar tiros, botar fogo).
Ao longo da partida as escolhas viram uma "build". Em cards puramente aleatórios ninguém sente a progressão.

**As 6 regras:**
1. **1 card por categoria** em toda oferta: ATAQUE, EFEITO e DEFESA. Toda escolha vira um trade-off (dano ou segurança?).
2. **Raridade** comum, rara e épica, com cor de moldura própria (verde, azul, roxo brilhante). A chance de raro e
   épico sobe ao longo do jogo:
   - início: 62% comum, 30% raro, 8% épico
   - meio: 50%, 36%, 14%
   - fim: 40%, 40%, 20%
3. **A primeira escolha é épica no ATAQUE.** O jogador sente o poder logo de cara.
4. **Recompensa do chefão:** depois de um chefão vem uma escolha extra com épico garantido.
5. **Sinergia:** 35% de chance de oferecer algo que o jogador já tem, para subir de nível (o card mostra "NÍVEL 1 → 2").
6. **Socorro contextual:** se o jogador está mal (perdeu protegidos ou está com pouca vida), o card de DEFESA vira cura.

**Apresentação:**
- O card mostra categoria, raridade, ícone grande, nome, efeito e o nível (ou "NOVA HABILIDADE").
- A build fica sempre visível: ícones com o nível no HUD.
- A escolha é **diegética**: você atira no card. Isso funciona igual no VR, no PC e no mobile, sem menu.

```js
// Cada habilidade: { id, cat:'atk'|'egg'|'def', rar:'comum'|'raro'|'epico', icon, title, desc, max, cond?, apply }
function buildOffer(kind) {                      // kind: 'normal' | 'first' | 'boss'
  const epicCat = kind === 'first' ? 'atk' : kind === 'boss' ? pick(['atk', 'def', 'atk']) : null;
  const taken = new Set(), out = [];
  for (const cat of ['atk', 'egg', 'def']) {
    let pool = SKILLS.filter(x => x.cat === cat && disponivel(x) && !taken.has(x.id));
    const rar = cat === epicCat ? 'epico' : rollRarity();       // chances sobem com a wave
    const ordem = rar === 'epico' ? ['epico', 'raro', 'comum'] : rar === 'raro' ? ['raro', 'comum', 'epico'] : ['comum', 'raro', 'epico'];
    let cand = []; for (const r of ordem) { cand = pool.filter(x => x.rar === r); if (cand.length) break; }
    const ja = cand.filter(x => nivel[x.id]);                    // sinergia: subir de nível
    const escolha = ja.length && Math.random() < 0.35 ? pick(ja) : pick(cand);
    taken.add(escolha.id); out.push(escolha);
  }
  if (jogadorMal()) out[2] = SKILL_CURA;                         // socorro
  return out;
}
```

**Catálogo de habilidades que funcionam em quase todo shooter:** dano +25%, cadência +20%, crítico 15%,
fúria (mais dano quando está perdendo), tiro duplo, tiro em leque, perfurar, ricochete, fogo, gelo, choque,
projétil maior, ímã, companheiro que atira, escudo de uso único, vida máxima, redução de dano, cura total,
sorte (mais drops), combo mais longo e power-up mais longo.

### 12.2 Multi-tiro universal (Duplo e Leque)

**Ideia:** o multi-tiro vale para **todas** as armas, não só para uma. Ele fica no ponto central que cria
projéteis, e cada arma só diz `volley: true`.

```js
function volleyDirs(dir) {                       // devolve [{ d: direção, off: deslocamento lateral }]
  const r = new Vector3().crossVectors(dir, UP).normalize();    // "direita" do tiro
  const upv = new Vector3().crossVectors(r, dir).normalize();   // "cima" do tiro
  const out = [], n = 1 + nivelDuplo;
  for (let k = 0; k < n; k++) out.push({ d: dir.clone(), off: r.clone().multiplyScalar((k - (n - 1) / 2) * 0.16) });
  for (let k = 1; k <= nivelLeque; k++) for (const s of [-1, 1])
    out.push({ d: dir.clone().applyAxisAngle(upv, s * k * 0.24), off: new Vector3() });   // ±14°, ±28°
  return out;
}
// Dentro de spawnProjetil(pos, vel, o): se o.volley, cria uma cópia por direção (com volley:false) e retorna
```

**Regras de equilíbrio (para não travar o jogo):**
- Armas de muitos projéteis dividem: escopeta = `14 / √n` chumbos por cópia.
- Metralhadora: projétil vive menos (1.2 s em vez de 2 s).
- Mísseis: só o primeiro da rajada é replicado.
- Armas instantâneas (laser, raio): um feixe por direção, com teto (7 no laser, 5 no raio).
- Limite global de projéteis vivos (240 aqui).

### 12.3 Efeitos de impacto (fogo, gelo, choque, crítico, fúria)

**Ideia:** todo dano passa por **uma** função `hitPart(alvo, parte, dano, pos, fx)`. O parâmetro `fx` diz se
aquele dano veio de um tiro direto do jogador (`true`) ou de um efeito secundário (`false`: queimadura,
salto de choque, explosão, cascata). Isso evita **recursão infinita**, como um choque gerando outro choque.

| Efeito | Regra |
|---|---|
| Crítico | `random < 0.15 × nível` → dano ×2 e "CRÍTICO!" |
| Fúria | dano × (1 + 0.10 × nível × protegidos perdidos) |
| Fogo | 3 s de queimadura, ticks a cada 0.5 s, total de +60% do golpe por nível |
| Gelo | `slowT = 2.5 s` e a entidade roda com `edt × 0.6` (0.4 no nível 2), o que deixa **lentas também as ações dela** (o feixe de abdução) |
| Choque | salta para 2 ou 3 inimigos a até 6 m com 35% do dano. Limite de 1 choque a cada 0.3 s por alvo, para a metralhadora não criar centenas de raios |

**O truque do gelo:** em vez de mexer na velocidade de cada comportamento, cada entidade recebe o seu próprio
`dt` (`uedt = edt × slowMul`). Tudo o que ela faz desacelera junto, de graça.

**Feedback visual:** queimando, o casco pisca laranja e solta faíscas. Congelado, fica azul e solta cristais.
O choque desenha mini-raios.

### 12.4 Ricochete (projétil e instantâneo)

- **Projétil:** ao acertar, procura o inimigo vivo mais próximo (até 9 m) que ainda não foi atingido e redireciona
  a velocidade para ele. Também desliga a gravidade e o ímã, guarda o alvo num `hitSet` e multiplica o dano por 0.7.
- **Instantâneo** (`bounceChain`): desenha um raio curto até o próximo alvo e aplica 70% do dano a cada salto.
- **Em armas que já pulam entre alvos (tesla):** cada nível de ricochete vale +1 geração de cascata.

### 12.5 Companheiro que atira (estilo "espírito" do Archero)

- Flutua ao lado do jogador. No VR fica a 0.55 m, perto do ombro. No PC fica a 1.1 m de lado e 1.4 m à frente,
  para não tapar a tela. Balança um pouco.
- Atira sozinho a cada 1.1 s (dividido pela cadência). Usa `acquireTarget`, a mesma mira do míssil, que prefere
  o que está no cone de visão e, se não houver nada, pega o mais próximo.
- Nível 2 = um segundo companheiro do outro lado.
- Serve para qualquer tema: drone, fada, pássaro ou mini-torreta.

### 12.6 Escudo de uso único nos protegidos

- No começo de cada wave, cada protegido ganha uma bolha.
- O primeiro ataque que ele receberia estoura a bolha (com penas e som), e o atacante fica **atordoado 1.6 s** e é empurrado para cima.
- É uma defesa barata e muito legível. Combina com qualquer jogo de "proteger X".

### 12.7 Vida do jogador + duas condições de derrota

```js
function damagePlayer(qtd, rotulo, cor) {
  if (!emJogo() || invulnT > 0) return;                       // 0.6 s de invencibilidade depois do golpe
  const dano = Math.max(1, Math.round(qtd * (1 - 0.2 * nivelColete)));
  hp = Math.max(0, hp - dano); invulnT = 0.6;
  vinhetaVermelha(); som(); vibrar(); popupNaFrente('-' + dano + ' ❤️ ' + rotulo, cor);
  if (hp <= 0) gameOver('player');                            // a outra causa é gameOver('protegidos')
}
```

**O que deixa a vida justa:**
- Todo ataque pode ser **evitado**: atirar no projétil no ar, desviar (inclinar no VR, WASD no PC) ou matar o atacante antes.
- A invencibilidade curta impede que uma rajada mate de uma vez.
- Há várias fontes de cura: +20 por wave, power-up que cai mais quando a vida está baixa, e card de cura
  garantido se a wave terminar com menos de 45%.
- Com vida baixa (30% ou menos), batimento cardíaco e vinheta pulsando.
- O game over diz **por que** você perdeu.

**Números de referência:** vida 100, projétil comum −12, ataque suicida −25.

### 12.8 Modo PC a partir de um jogo VR

Um jogo VR "parado" vira um bom jogo de PC com 6 peças:

1. **Mira exata (`pcAim`):** a cada frame, um raio do centro da tela encontra o que está sob a mira. Todas as armas
   saem do cano (no canto da tela) e **convergem para esse ponto**. Sem isso os tiros passam paralelos e erram.
2. **Mira balística** para projéteis com gravidade: calcula a velocidade que faz o arco cair no ponto mirado.
   Deu 85% de acerto a 12 m.
   ```js
   function ballistic(o, alvo, vel, g, out) {
     const d = alvo.clone().sub(o), t = Math.max(0.05, d.length() / vel);
     out.copy(d).divideScalar(t); out.y += 0.5 * g * t; return out;   // compensa a queda
   }
   ```
3. **Movimento limitado:** WASD move o rig na direção da câmera, preso numa área (aqui, a varanda). É o "desviar" que
   no VR se faz com o corpo.
   ```js
   const sn = Math.sin(yaw), cs = Math.cos(yaw);              // W = -Z local, D = +X local
   rig.x = clamp(rig.x + (mx * cs + mz * sn) * vel * dt, xMin, xMax);
   rig.z = clamp(rig.z + (-mx * sn + mz * cs) * vel * dt, zMin, zMax);
   ```
4. **Zoom no botão direito:** FOV 80 → 42 suavizado, com a sensibilidade do mouse proporcional ao FOV.
5. **Pausa automática** quando o pointer lock cai (Esc ou perda de foco), com uma tela que mostra os controles.
   Clicar na tela volta ao jogo.
6. **Marcador de acerto:** a mira fica vermelha e cresce por 0.12 s a cada dano causado.

Extras: um botão "JOGAR NO PC" separado do "ENTER VR", e pixel ratio até 2 no PC (1.5 no mobile e no VR).

### 12.9 HUD de VR que não atrapalha (painel móvel)

- Painel pequeno (30 × 16 cm) **preso à cadeira** (que gira com a cabeça), abaixo e à esquerda, e que sempre vira
  para o jogador (`lookAt` da câmera).
- **GRIP perto dele = mover.** O painel segue a mão e, ao soltar, a posição é salva em `localStorage`.
- O que mais importa fica em número grande e colorido: protegidos 7/12 (laranja com 4 ou menos, vermelho com 2 ou menos)
  e a barra de vida. O detalhe vem menor embaixo.
- Mostra a build (ícones das habilidades com o nível).
- Avisos no momento certo: "-1 GALINHA · restam N" quando perde, e o total no fim da wave.

### 12.10 Raios com vida por segmento

- Um pool de cilindros aditivos (140), usados em fila circular.
- Cada segmento guarda a própria vida (0.09 a 0.12 s) e some sozinho.
- Assim, várias fontes de raio (tesla, choque, ricochete) convivem sem uma apagar a outra e sem esgotar o pool.
- O "zigue-zague" é `jag × distância / segmentos`: 0.15 deixa reto e elegante, 0.3 ou mais fica caótico.

### 12.11 Teste automático por script (vale para qualquer jogo)

- Exponha um `step(n, dt)` que roda o loop do jogo **sem renderizar**. Ele funciona mesmo com a aba escondida,
  quando o navegador para o `requestAnimationFrame`.
- Monte um **robô** de poucas linhas: escolhe o alvo mais urgente, mira (`aimAt`) e atira (`setHold`/`shoot`).
  Também escolhe cards (`hitCard`) e avança o menu.
- Com isso dá para rodar a campanha inteira em segundos e conferir:
  - se aparece erro (`#err`)
  - se as waves terminam
  - quantos projéteis ficam vivos
  - a vida mínima
  - a precisão de uma arma (ex.: 17 de 20 acertos a 12 m)
- O robô tem mira perfeita, então ele mede **se o jogo funciona**, não se está difícil.
  A dificuldade real se testa jogando.

### 12.12 Ataques avisados (dá para desviar)

Todo ataque forte avisa antes, e isso torna a dificuldade justa:
- **Bomba:** um **anel vermelho pulsando no chão** onde ela vai cair, cerca de 1.4 s antes.
- **Sniper:** um **laser fino** acompanha você por 1.55 s e depois **trava e pisca** por 0.45 s. Quem se mexe escapa.
- **Plasma:** a barriga da nave pisca 0.45 s antes do tiro.
- **Kamikaze:** sirene e o casco piscando em vermelho por 1.3 s.

Para isso funcionar o jogador precisa de uma forma de desviar: inclinar o corpo, andar com o joystick ou usar WASD.

### 12.13 Movimento com altura (plataforma, rampa e queda)

```js
function groundHeightAt(x, z) {                        // a "planta" do cenário em 3 linhas
  if (dentroDaVaranda(x, z)) return 0.4;
  if (naRampa(x, z)) return 0.4 * (1 - (z - inicio) / comprimento);
  return 0;
}
// mover: testa cada eixo separado; grades bloqueiam; degrau > 12 cm bloqueia (só sobe pela rampa)
// altura: se o chão sumiu embaixo, cai com gravidade; ao pousar forte, baque + vibração
```

No VR, o joystick esquerdo move na direção da cabeça. Uma vinheta escura aparece enquanto você anda, o que
reduz muito o enjoo.

### 12.14 Veículo especial temporário (a cadeira voadora)

É o padrão do "evento especial": aparece, você entra, ganha um poder novo por um tempo e o jogo te devolve sozinho.

1. **Chega:** desce do céu 1.8 m à sua frente, com um feixe de luz vertical para você achar, e um banner explica o que fazer.
2. **Entra:** basta encostar nela. Se você demorar 12 s, ela vem até você.
3. **Usa:** 30 s de voo. A direção é a do olhar e o joystick (ou W/S) controla a velocidade. Começa com uma subida
   automática de 1.6 s. Fica preso entre 2.5 e 20 m de altura, a no máximo 30 m do quintal. Asas batendo, jatos e
   vinheta de conforto.
4. **Volta sozinho:** voa de volta até a varanda, pousa e o jogo continua.
   Se a wave acabar durante o voo, ele já começa a voltar.

Serve para qualquer jogo: carrinho, cavalo, nave, balão ou torre móvel.

### 12.15 Vários idiomas num jogo de arquivo único

Sem biblioteca e sem arquivo de tradução: cada texto carrega as três línguas no próprio lugar onde é usado.

1. **Escolha do idioma:** um `<script>` comum, antes do módulo do jogo, lê `localStorage.cr_lang`. Se não houver nada salvo,
   usa a língua do aparelho (`pt*` → português, `fi*` → finlandês, o resto → inglês). O resultado fica em `window.CR_LANG`.
2. **Tela inicial (HTML):** os blocos traduzíveis têm `id` e esse mesmo script troca o `innerHTML` deles antes do primeiro desenho.
   O português fica escrito direto no HTML, como padrão.
3. **Textos do jogo:** `const tr = (pt, en, fi) => LANG === 'en' ? en : LANG === 'fi' ? fi : pt;` e todo texto vira
   `tr('ESCUDO!', 'SHIELD!', 'SUOJA!')`. Vale para tabelas (armas, naves, habilidades), banners, popups e o HUD.
4. **Trocar de idioma:** os botões salvam em `localStorage` e recarregam a página. Assim nenhum texto já desenhado em
   textura (placa, cards, painel) fica na língua antiga.
5. **Textos longos:** finlandês é a língua mais comprida. Toda linha desenhada em canvas usa `fitText`, que diminui a fonte
   até caber na largura.
6. **Plural e ordem das palavras:** monte a frase inteira dentro do `tr`, sem colar pedaços.
   Exemplo: `tr('restam ' + n + ' galinhas', n + ' chickens left', n + ' kanaa jäljellä')`.
