// =============================================================================
// RANKING MUNDIAL — configuração do Firebase (Firestore).
// Vazio = ranking mundial desligado (o local continua funcionando).
// Para ligar: criar um projeto Firebase só do jogo, ativar o Firestore, publicar as
// regras de `firestore.rules` e colar aqui o projectId e a apiKey do app web.
// (A apiKey de app web do Firebase é pública por natureza; quem protege são as regras.)
// =============================================================================
export const FIREBASE = {
  projectId: '',
  apiKey: '',
};
