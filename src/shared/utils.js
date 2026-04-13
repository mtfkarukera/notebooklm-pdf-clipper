// utils.js : Fonctions utilitaires partagées

/**
 * Lanceur de promesse pour le FileReader (utile pour le Base64)
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Export pour le contexte du Content Script (s'il n'y a pas de modules purs)
window.ClipperUtils = {
  blobToBase64,
};
