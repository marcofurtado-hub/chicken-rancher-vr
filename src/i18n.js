// Idioma escolhido na tela inicial (index.html define window.CR_LANG antes dos módulos).
export const LANG = window.CR_LANG || 'pt';
/** tr('texto pt', 'english text', 'suomeksi') — a frase inteira em cada língua, nunca pedaços. */
export const tr = (pt, en, fi) => (LANG === 'en' ? en : LANG === 'fi' ? fi : pt);
