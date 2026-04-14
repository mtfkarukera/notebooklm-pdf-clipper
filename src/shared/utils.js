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

/**
 * Détecte si l'URL correspond à une application Google Workspace supportée
 * ou à un fichier hébergé sur Google Drive, et extrait son ID et type MIME.
 *
 * Cas supportés :
 *   1. docs.google.com/document/d/ID   → Google Docs
 *   2. docs.google.com/spreadsheets/d/ID → Google Sheets
 *   3. docs.google.com/presentation/d/ID → Google Slides
 *   4. drive.google.com/file/d/ID/view  → Fichier Drive (PDF, image, etc.)
 *
 * @returns {{ fileId: string, mimeType: string, typeStr: string } | null}
 */
function parseDriveUrl(url) {
  try {
      const urlObj = new URL(url);

      // Cas 1-3 : Google Docs/Sheets/Slides (docs.google.com)
      if (urlObj.hostname.endsWith('docs.google.com')) {
          const match = urlObj.pathname.match(/\/(document|spreadsheets|presentation)\/d\/([a-zA-Z0-9-_]+)/);
          if (match) {
              const typeStr = match[1];
              const fileId = match[2];
              let mimeType = '';
              if (typeStr === 'document') mimeType = 'application/vnd.google-apps.document';
              else if (typeStr === 'spreadsheets') mimeType = 'application/vnd.google-apps.spreadsheet';
              else if (typeStr === 'presentation') mimeType = 'application/vnd.google-apps.presentation';
              return { fileId, mimeType, typeStr };
          }
      }

      // Cas 4 : Fichier hébergé sur Drive (drive.google.com/file/d/ID/...)
      if (urlObj.hostname === 'drive.google.com') {
          const match = urlObj.pathname.match(/\/file\/d\/([a-zA-Z0-9-_]+)/);
          if (match) {
              return { fileId: match[1], mimeType: '', typeStr: 'file' };
          }
      }

      return null;
  } catch (e) {
      return null;
  }
}

/**
 * Devine le MIME type d'un fichier Drive à partir du titre de l'onglet.
 * Le titre Firefox suit le format : "nomfichier.ext - Google Drive"
 *
 * @param {string} title - Titre de l'onglet Firefox.
 * @returns {string} MIME type deviné, ou 'application/pdf' par défaut.
 */
function guessMimeFromTitle(title) {
  const EXTENSION_MAP = {
    'pdf': 'application/pdf',
    'txt': 'text/plain',
    'md': 'text/markdown',
    'csv': 'text/csv',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'epub': 'application/epub+zip',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'mp4': 'video/mp4',
  };

  // Retirer le suffixe " - Google Drive" et extraire l'extension
  const cleaned = title.replace(/\s*-\s*Google Drive\s*$/i, '').trim();
  const dotIndex = cleaned.lastIndexOf('.');
  if (dotIndex > 0) {
      const ext = cleaned.substring(dotIndex + 1).toLowerCase();
      if (EXTENSION_MAP[ext]) return EXTENSION_MAP[ext];
  }
  return 'application/pdf'; // Fallback le plus courant sur Drive
}

// Export pour le contexte du Content Script (s'il n'y a pas de modules purs)
window.ClipperUtils = {
  blobToBase64,
  parseDriveUrl,
  guessMimeFromTitle,
};

// Export ESM optionnel (pour les modules ES6 comme background.js)
if (typeof exports !== 'undefined') {
  exports.blobToBase64 = blobToBase64;
  exports.parseDriveUrl = parseDriveUrl;
  exports.guessMimeFromTitle = guessMimeFromTitle;
}
