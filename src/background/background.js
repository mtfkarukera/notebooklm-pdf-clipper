// background.js : Event Page MV3, Routeur central Asynchrone
import { getPersonalAuthCookies, fetchCSRFToken } from './api/auth_personal.js';
import { createPersonalNotebook, uploadPersonalSource, addTextSource, addUrlSource, addYouTubeSource, addDriveSource } from './api/rpc_client.js';

/**
 * Taille Max de PDF imposée par Google : 200 MB
 * Un octet Base64 pèse plus lourd (ratio ~1.37), cette limite mathématique garantit le quota réel.
 */
const MAX_BASE64_SIZE_BYTES = 200 * 1024 * 1024 * 1.37;

// Dernière capture (stockée en mémoire pour téléchargement local)
let lastCaptureData = null;    // base64 PDF ou texte Markdown
let lastCaptureFilename = null;
let lastCaptureFormat = null;  // "pdf" ou "md"

/**
 * Devine le MIME type d'un fichier Drive à partir du titre de l'onglet Firefox.
 * Format attendu : "nomfichier.ext - Google Drive"
 */
function guessMimeFromTitle(title) {
    const EXTENSION_MAP = {
        'pdf': 'application/pdf', 'txt': 'text/plain', 'md': 'text/markdown',
        'csv': 'text/csv', 'epub': 'application/epub+zip',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
        'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml',
        'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'mp4': 'video/mp4',
    };
    const cleaned = title.replace(/\s*-\s*Google Drive\s*$/i, '').trim();
    const dotIndex = cleaned.lastIndexOf('.');
    if (dotIndex > 0) {
        const ext = cleaned.substring(dotIndex + 1).toLowerCase();
        if (EXTENSION_MAP[ext]) return EXTENSION_MAP[ext];
    }
    return 'application/pdf';
}

/**
 * Types de fichiers supportés pour l'Import Direct.
 * Liste complète des formats acceptés par NotebookLM.
 * Mapping MIME type → { label, extension, category }
 */
const DIRECT_IMPORT_TYPES = {
    // Documents
    'application/pdf':                                              { label: 'PDF',   ext: '.pdf',  category: 'document' },
    'text/plain':                                                   { label: 'TXT',   ext: '.txt',  category: 'document' },
    'text/markdown':                                                { label: 'MD',    ext: '.md',   category: 'document' },
    'text/csv':                                                     { label: 'CSV',   ext: '.csv',  category: 'document' },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { label: 'DOCX', ext: '.docx', category: 'document' },
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': { label: 'PPTX', ext: '.pptx', category: 'document' },
    'application/epub+zip':                                         { label: 'EPUB',  ext: '.epub', category: 'document' },
    // Images
    'image/png':        { label: 'PNG',   ext: '.png',  category: 'image' },
    'image/jpeg':       { label: 'JPEG',  ext: '.jpg',  category: 'image' },
    'image/gif':        { label: 'GIF',   ext: '.gif',  category: 'image' },
    'image/bmp':        { label: 'BMP',   ext: '.bmp',  category: 'image' },
    'image/webp':       { label: 'WebP',  ext: '.webp', category: 'image' },
    'image/avif':       { label: 'AVIF',  ext: '.avif', category: 'image' },
    'image/tiff':       { label: 'TIFF',  ext: '.tiff', category: 'image' },
    'image/x-icon':     { label: 'ICO',   ext: '.ico',  category: 'image' },
    'image/jp2':        { label: 'JP2',   ext: '.jp2',  category: 'image' },
    'image/heic':       { label: 'HEIC',  ext: '.heic', category: 'image' },
    'image/heif':       { label: 'HEIF',  ext: '.heif', category: 'image' },
    // Audio
    'audio/mpeg':       { label: 'MP3',   ext: '.mp3',  category: 'audio' },
    'audio/wav':        { label: 'WAV',   ext: '.wav',  category: 'audio' },
    'audio/x-wav':      { label: 'WAV',   ext: '.wav',  category: 'audio' },
    'audio/ogg':        { label: 'OGG',   ext: '.ogg',  category: 'audio' },
    'audio/aac':        { label: 'AAC',   ext: '.aac',  category: 'audio' },
    'audio/mp4':        { label: 'M4A',   ext: '.m4a',  category: 'audio' },
    'audio/x-m4a':      { label: 'M4A',   ext: '.m4a',  category: 'audio' },
    'audio/aiff':       { label: 'AIFF',  ext: '.aiff', category: 'audio' },
    'audio/x-aiff':     { label: 'AIFF',  ext: '.aiff', category: 'audio' },
    'audio/midi':       { label: 'MIDI',  ext: '.mid',  category: 'audio' },
    'audio/x-midi':     { label: 'MIDI',  ext: '.mid',  category: 'audio' },
    'audio/opus':       { label: 'OPUS',  ext: '.opus', category: 'audio' },
    'audio/amr':        { label: 'AMR',   ext: '.amr',  category: 'audio' },
    'audio/x-ms-wma':   { label: 'WMA',   ext: '.wma',  category: 'audio' },
    'audio/x-pn-realaudio': { label: 'RA', ext: '.ra',  category: 'audio' },
    'audio/basic':      { label: 'AU',    ext: '.au',   category: 'audio' },
    // Vidéo
    'video/mp4':        { label: 'MP4',   ext: '.mp4',  category: 'video' },
    'video/mpeg':       { label: 'MPEG',  ext: '.mpeg', category: 'video' },
    'video/x-msvideo':  { label: 'AVI',   ext: '.avi',  category: 'video' },
    'video/3gpp':       { label: '3GP',   ext: '.3gp',  category: 'video' },
    'video/3gpp2':      { label: '3G2',   ext: '.3g2',  category: 'video' },
};

/**
 * Mapping extension → MIME type pour la détection par URL (fichiers locaux surtout).
 */
const EXT_TO_MIME = {
    // Documents
    'pdf': 'application/pdf', 'txt': 'text/plain', 'md': 'text/markdown',
    'csv': 'text/csv', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'epub': 'application/epub+zip',
    // Images
    'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'jpe': 'image/jpeg',
    'gif': 'image/gif', 'bmp': 'image/bmp', 'webp': 'image/webp', 'avif': 'image/avif',
    'tif': 'image/tiff', 'tiff': 'image/tiff', 'ico': 'image/x-icon',
    'jp2': 'image/jp2', 'heic': 'image/heic', 'heif': 'image/heif',
    // Audio
    'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'ogg': 'audio/ogg', 'aac': 'audio/aac',
    'm4a': 'audio/mp4', 'aif': 'audio/aiff', 'aifc': 'audio/aiff', 'aiff': 'audio/aiff',
    'mid': 'audio/midi', 'opus': 'audio/opus', 'amr': 'audio/amr', 'wma': 'audio/x-ms-wma',
    'ra': 'audio/x-pn-realaudio', 'ram': 'audio/x-pn-realaudio', 'au': 'audio/basic',
    'snd': 'audio/basic', 'cda': 'audio/mpeg',
    // Vidéo
    'mp4': 'video/mp4', 'mpeg': 'video/mpeg', 'avi': 'video/x-msvideo',
    '3gp': 'video/3gpp', '3g2': 'video/3gpp2',
};

/** Regex d'extensions pour la détection rapide par URL */
const SUPPORTED_EXT_REGEX = /\.(pdf|txt|md|docx|csv|pptx|epub|avif|bmp|gif|ico|jp2|png|webp|tif|tiff|heic|heif|jpe?g|3g2|3gp|aac|aif|aifc|aiff|amr|au|avi|cda|m4a|mid|mp3|mp4|mpeg|ogg|opus|ra|ram|snd|wav|wma)$/i;

/**
 * Détecte si une URL pointe vers un fichier directement importable.
 * Combine l'analyse de l'extension URL + requête HEAD pour confirmer le MIME type.
 */
async function detectFileType(url) {
    // Ne pas analyser les pages non-HTTP (about:, moz-extension:, etc.)
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://'))) {
        return { directImport: false };
    }

    const isLocal = url.startsWith('file://');

    // 1. Heuristique rapide : extension URL
    const urlPath = new URL(url).pathname.toLowerCase();
    const extMatch = urlPath.match(SUPPORTED_EXT_REGEX);

    // 2. Pour les URLs HTTP, confirmer via HEAD request
    let detectedMime = null;
    if (!isLocal && url.startsWith('http')) {
        try {
            const headResp = await fetch(url, { method: 'HEAD', redirect: 'follow' });
            const contentType = headResp.headers.get('content-type') || '';
            // Extraire le MIME principal (avant le ;charset=...)
            detectedMime = contentType.split(';')[0].trim().toLowerCase();
        } catch (e) {
            console.warn('[Background] HEAD request échouée:', e.message);
        }
    }

    // 3. Tenter de résoudre à partir de l'extension si HEAD n'a rien donné
    if (!detectedMime && extMatch) {
        detectedMime = EXT_TO_MIME[extMatch[1].toLowerCase()];
    }

    // 4. Vérifier si le type est supporté
    if (detectedMime && DIRECT_IMPORT_TYPES[detectedMime]) {
        const typeInfo = DIRECT_IMPORT_TYPES[detectedMime];
        return {
            directImport: true,
            mimeType: detectedMime,
            label: typeInfo.label,
            category: typeInfo.category,
            isLocal: isLocal
        };
    }
    
    return { directImport: false };
}

// ═══ Menu Contextuel : Capture de sélection ═══
browser.runtime.onInstalled.addListener(async () => {
    // Nettoyer les sélections obsolètes au démarrage/mise à jour
    browser.storage.local.remove('nwc_pending_selection');
    
    // Recréer le menu contextuel (removeAll évite les doublons après mise à jour)
    try {
        await browser.contextMenus.removeAll();
        browser.contextMenus.create({
            id: "nwc-clip-selection",
            title: "📎 Clipper la sélection dans NotebookLM",
            contexts: ["selection"]
        });
    } catch (e) {
        // Firefox Android peut ne pas supporter certaines options — on n'échoue pas
        console.warn("[Background] contextMenus non disponible:", e.message);
    }
});

if (browser.contextMenus?.onClicked) {
    browser.contextMenus.onClicked.addListener(async (info, tab) => {
        if (info.menuItemId === "nwc-clip-selection" && info.selectionText) {
            // 1. Capturer le HTML formaté via le content script (si disponible)
            let selectionHtml = null;
            try {
                const response = await browser.tabs.sendMessage(tab.id, {
                    action: "GET_SELECTION_HTML"
                });
                if (response?.html) {
                    selectionHtml = response.html;
                }
            } catch (e) {
                console.warn("[Background] Content script inaccessible, fallback texte brut.");
            }

            // 2. Stocker la sélection dans storage.local
            await browser.storage.local.set({
                nwc_pending_selection: {
                    text: info.selectionText,
                    html: selectionHtml,
                    pageUrl: info.pageUrl || tab.url,
                    pageTitle: tab.title,
                    timestamp: Date.now()
                }
            });

            // 3. Tenter d'ouvrir la popup
            try {
                await browser.action.openPopup();
            } catch (e) {
                // Fallback : notification pour guider l'utilisateur
                console.warn("[Background] openPopup() échoué:", e.message);
                browser.notifications.create("nwc-selection-ready", {
                    type: "basic",
                    iconUrl: browser.runtime.getURL("icons/icon.svg"),
                    title: "Sélection capturée ✓",
                    message: "Cliquez sur le bouton NotebookLM Web Clipper pour choisir un carnet."
                });
            }
        }
    });
}

// Routeur Principal recevant les messages de la Popup et du Content Script
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    
    if (message.action === "GET_AUTH_STATUS") {
        browser.cookies.getAll({ url: "https://notebooklm.google.com/" }).then(cookies => {
            if (cookies && cookies.length > 0) {
                sendResponse({ status: "CONNECTE", type: "PERSONAL" });
            } else {
                sendResponse({ status: "DECONNECTE", type: null });
            }
        }).catch(() => {
            sendResponse({ status: "DECONNECTE", type: null });
        });
        return true;
    }

    if (message.action === "GET_ACCOUNTS") {
        (async () => {
            try {
                const { getPersonalAuthCookies, detectGoogleAccounts } = await import('./api/auth_personal.js');
                const cookieString = await getPersonalAuthCookies();
                const accounts = await detectGoogleAccounts(cookieString);
                
                const data = await browser.storage.local.get('nblm_active_authuser');
                const activeIndex = data.nblm_active_authuser !== undefined ? data.nblm_active_authuser : 0;
                
                sendResponse({ accounts, activeIndex });
            } catch (err) {
                console.error("[Background] Échec GET_ACCOUNTS: ", err.message);
                sendResponse({ error: err.message, accounts: [] });
            }
        })();
        return true;
    }

    if (message.action === "SET_ACCOUNT") {
        browser.storage.local.set({ nblm_active_authuser: message.index }).then(() => {
            sendResponse({ ok: true });
        });
        return true;
    }
    
    if (message.action === "GET_NOTEBOOKS") {
        (async () => {
            try {
                const { getPersonalAuthCookies, fetchCSRFToken } = await import('./api/auth_personal.js');
                const cookieString = await getPersonalAuthCookies();
                
                const data = await browser.storage.local.get('nblm_active_authuser');
                const activeIndex = data.nblm_active_authuser !== undefined ? data.nblm_active_authuser : 0;
                
                await fetchCSRFToken(cookieString, activeIndex);

                const { listPersonalNotebooks } = await import('./api/rpc_client.js');
                const notebooks = await listPersonalNotebooks(activeIndex);
                
                sendResponse({ notebooks });
            } catch (err) {
                console.error("[Background] Échec API: ", err.message);
                sendResponse({ error: err.message, notebooks: null });
            }
        })();
        return true; 
    }
    
    // Création de carnet à la volée
    if (message.action === "CREATE_NOTEBOOK") {
        (async () => {
            try {
                const cookieString = await getPersonalAuthCookies();
                const data = await browser.storage.local.get('nblm_active_authuser');
                const activeIndex = data.nblm_active_authuser !== undefined ? data.nblm_active_authuser : 0;
                
                await fetchCSRFToken(cookieString, activeIndex);
                
                const notebookId = await createPersonalNotebook(message.title, activeIndex);
                sendResponse({ notebookId });
            } catch (err) {
                console.error("[Background] Échec création carnet:", err.message);
                sendResponse({ error: err.message, notebookId: null });
            }
        })();
        return true;
    }
    
    // Proxy CORS pour télécharger les images sans bloquer jsPDF
    if (message.action === "FETCH_IMAGE") {
        (async () => {
            try {
                // Timeout de 10s pour éviter de bloquer le pipeline sur des images lentes
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000);
                const response = await fetch(message.url, { signal: controller.signal });
                clearTimeout(timeout);
                if (!response.ok) {
                    sendResponse({ error: `HTTP ${response.status}` });
                    return;
                }
                const blob = await response.blob();
                const reader = new FileReader();
                reader.onloadend = () => {
                    sendResponse({ data: reader.result }); // data URI base64
                };
                reader.onerror = () => sendResponse({ error: "FileReader échoué" });
                reader.readAsDataURL(blob);
            } catch (err) {
                sendResponse({ error: err.message });
            }
        })();
        return true;
    }

    // Téléchargement local de la dernière capture (PDF ou Markdown)
    if (message.action === "DOWNLOAD_CAPTURE") {
        if (!lastCaptureData) {
            sendResponse({ error: "Aucune capture disponible" });
            return true;
        }
        (async () => {
            try {
                let blobUrl;
                let ext;

                if (lastCaptureFormat === "md") {
                    // Markdown : texte brut → blob text/markdown
                    const blob = new Blob([lastCaptureData], { type: 'text/markdown; charset=utf-8' });
                    blobUrl = URL.createObjectURL(blob);
                    ext = '.md';
                } else {
                    // PDF : data URI → blob binaire
                    const base64 = lastCaptureData.split(',')[1];
                    const byteChars = atob(base64);
                    const byteArr = new Uint8Array(byteChars.length);
                    for (let i = 0; i < byteChars.length; i++) {
                        byteArr[i] = byteChars.charCodeAt(i);
                    }
                    const blob = new Blob([byteArr], { type: 'application/pdf' });
                    blobUrl = URL.createObjectURL(blob);
                    ext = '.pdf';
                }

                // saveAs non supporté sur Firefox Android — détection plateforme
                const platformInfo = await browser.runtime.getPlatformInfo();
                const isMobile = platformInfo.os === 'android';

                await browser.downloads.download({
                    url: blobUrl,
                    filename: (lastCaptureFilename || 'capture') + ext,
                    saveAs: !isMobile
                });
                // Libérer la mémoire blob après téléchargement
                setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
                sendResponse({ ok: true });
            } catch (err) {
                sendResponse({ error: err.message });
            }
        })();
        return true;
    }

    // Détection du type de fichier pour l'Import Direct
    if (message.action === "DETECT_FILE_TYPE") {
        detectFileType(message.url).then(result => {
            sendResponse(result);
        }).catch(() => {
            sendResponse({ directImport: false });
        });
        return true;
    }

    if (message.action === "START_CAPTURE") {
        // Import de sélection : pipeline simplifié (texte → addTextSource)
        if (message.format === 'selection' && message.selectionData) {
            (async () => {
                try {
                    const sel = message.selectionData;
                    const cookieString = await getPersonalAuthCookies();
                    const data = await browser.storage.local.get('nblm_active_authuser');
                    const activeIndex = data.nblm_active_authuser !== undefined ? data.nblm_active_authuser : 0;
                    await fetchCSRFToken(cookieString, activeIndex);

                    let finalNotebookId = message.notebookId;
                    if (finalNotebookId === "CREATE_NEW") {
                        notifyUI("STATUS_UPDATE", { text: "Création du carnet...", status: "info" });
                        const title = `Capture - ${new Date().toLocaleDateString()}`;
                        finalNotebookId = await createPersonalNotebook(title, activeIndex);
                    }
                    if (!finalNotebookId) throw new Error("Échec de la récupération de l'ID du carnet.");

                    notifyUI("STATUS_UPDATE", { text: "📋 Upload de la sélection...", status: "info" });

                    // Titre de la source dans NotebookLM
                    const cleanTitle = (sel.pageTitle || 'Sélection')
                        .replace(/[<>:"/\\|?*]/g, '').trim().substring(0, 80);
                    const sourceTitle = `📋 ${cleanTitle}`;

                    // Contenu structuré avec métadonnées de grounding
                    const content = [
                        `Source: ${sel.pageUrl}`,
                        `Titre: ${sel.pageTitle}`,
                        `Date de capture: ${new Date().toLocaleString()}`,
                        '',
                        '---',
                        '',
                        sel.text
                    ].join('\n');

                    // addTextSource(notebookId, title, content, authuser)
                    await addTextSource(finalNotebookId, sourceTitle, content, activeIndex);

                    const notebookUrl = `https://notebooklm.google.com/notebook/${finalNotebookId}`;
                    notifyUI("STATUS_UPDATE", {
                        text: "✅ Sélection importée !",
                        status: "success",
                        linkUrl: notebookUrl,
                        showDownload: false
                    });

                    browser.notifications.create({
                        type: "basic",
                        iconUrl: browser.runtime.getURL("icons/icon.svg"),
                        title: "NotebookLM Web Clipper",
                        message: `Sélection importée depuis "${cleanTitle}"`
                    });
                } catch (err) {
                    console.error("[Background] Échec import sélection:", err.message);
                    notifyUI("STATUS_UPDATE", { text: err.message, status: "error" });
                }
            })();
        } else {
            // Formats classiques : PDF, MD, URL, Screenshot, Direct
            executeCaptureAndUploadWorkflow(message.notebookId, message.format || "pdf")
                .catch(err => {
                    console.error("[Clipper Background] Erreur globale :", err);
                    notifyUI("STATUS_UPDATE", { text: err.message, status: "error" });
                });
        }
    }

    return true;
});

/**
 * Mise à jour de l'interface visuelle (Popup si elle est encore active)
 */
function notifyUI(action, payload) {
    browser.runtime.sendMessage({ type: action, ...payload }).catch(() => {
        // La popup est sûrement fermée, on ignore l'erreur
    });
}

/**
 * Moteur de Séquence Stricte — PDF, Markdown ou URL
 */
async function executeCaptureAndUploadWorkflow(targetNotebookId, format) {
    
    notifyUI("STATUS_UPDATE", { text: "Récupération Session Personnelle...", status: "info" });
    
    // 1. AUTHENTIFICATION ET COMPTE
    const cookieString = await getPersonalAuthCookies();
    const data = await browser.storage.local.get('nblm_active_authuser');
    const activeIndex = data.nblm_active_authuser !== undefined ? data.nblm_active_authuser : 0;
    
    await fetchCSRFToken(cookieString, activeIndex);

    // 2. Récupérer l'onglet actif
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if(tabs.length === 0) throw new Error("Aucun onglet actif trouvé.");
    
    const activeTab = tabs[0];
    const pageTitle = activeTab.title || "Capture";
    const pageUrl = activeTab.url;
    
    // Nettoyer le titre pour en faire un nom de fichier valide
    const cleanTitle = pageTitle
        .replace(/[<>:"/\\|?*]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 100);

    // 3. Résoudre le carnet cible
    let finalNotebookId = targetNotebookId;
    if (finalNotebookId === "CREATE_NEW") {
        notifyUI("STATUS_UPDATE", { text: "Création du carnet...", status: "info" });
        const title = `Capture - ${new Date().toLocaleDateString()}`;
        finalNotebookId = await createPersonalNotebook(title, activeIndex);
    }
    if (!finalNotebookId) throw new Error("Échec de la récupération de l'ID du carnet.");

    // 4. ROUTING selon le format
    if (format === "screenshot") {
        // ═══ Pipeline Screenshot : captureVisibleTab → PNG → upload ═══
        notifyUI("STATUS_UPDATE", { text: "📸 Capture du viewport...", status: "info" });
        
        const dataUrl = await browser.tabs.captureVisibleTab(null, { format: 'png' });
        
        // Convertir data URL → Blob
        const base64 = dataUrl.split(',')[1];
        const binaryStr = atob(base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }
        const pngBlob = new Blob([bytes], { type: 'image/png' });
        const screenshotFilename = `${cleanTitle}.png`;
        
        notifyUI("STATUS_UPDATE", { text: "📸 Upload du screenshot...", status: "info" });
        await uploadFileBlob(finalNotebookId, pngBlob, screenshotFilename, activeIndex);
        
        const notebookUrl = `https://notebooklm.google.com/notebook/${finalNotebookId}`;
        notifyUI("STATUS_UPDATE", { 
            text: "✅ Screenshot importé !", 
            status: "success",
            linkUrl: notebookUrl,
            showDownload: false
        });

    } else if (format === "direct") {
        // ═══ Pipeline Import Direct : fetch binaire → upload ═══
        notifyUI("STATUS_UPDATE", { text: "⚡ Téléchargement du fichier...", status: "info" });
        
        let fileResponse;
        try {
            fileResponse = await fetch(pageUrl, { credentials: 'include' });
        } catch (fetchErr) {
            throw new Error(`Impossible de récupérer le fichier. Le serveur bloque le téléchargement.`);
        }
        if (!fileResponse.ok) throw new Error(`Échec téléchargement: HTTP ${fileResponse.status}`);
        
        const fileBlob = await fileResponse.blob();
        const mimeType = fileBlob.type || 'application/octet-stream';
        
        // Déterminer l'extension à partir du MIME type (via le mapping global)
        const typeInfo = DIRECT_IMPORT_TYPES[mimeType];
        const ext = typeInfo ? typeInfo.ext : '';
        const directFilename = `${cleanTitle}${ext}`;
        
        // Vérifier la taille
        if (fileBlob.size > 200 * 1024 * 1024) {
            throw new Error("Upload refusé : Le fichier dépasse la limite de 200 MB.");
        }
        
        notifyUI("STATUS_UPDATE", { text: `⚡ Upload du ${ext.replace('.','').toUpperCase() || 'fichier'}...`, status: "info" });
        await uploadFileBlob(finalNotebookId, fileBlob, directFilename, activeIndex);
        
        const notebookUrl = `https://notebooklm.google.com/notebook/${finalNotebookId}`;
        notifyUI("STATUS_UPDATE", { 
            text: `✅ Fichier importé directement !`, 
            status: "success",
            linkUrl: notebookUrl,
            showDownload: false
        });

    } else if (format === "drive") {
        // ═══ Pipeline Google Drive NATIF ═══
        // Supporte : docs.google.com (Docs/Sheets/Slides) ET drive.google.com/file/d/ (fichiers)
        notifyUI("STATUS_UPDATE", { text: "☁️ Liaison avec le Google Drive...", status: "info" });
        
        let fileId, mimeType = '';

        // Cas 1 : Google Docs/Sheets/Slides (docs.google.com)
        const workspaceMatch = pageUrl.match(/\/(document|spreadsheets|presentation)\/d\/([a-zA-Z0-9-_]+)/);
        if (workspaceMatch) {
            fileId = workspaceMatch[2];
            const typeStr = workspaceMatch[1];
            if (typeStr === 'document') mimeType = 'application/vnd.google-apps.document';
            else if (typeStr === 'spreadsheets') mimeType = 'application/vnd.google-apps.spreadsheet';
            else if (typeStr === 'presentation') mimeType = 'application/vnd.google-apps.presentation';
        }

        // Cas 2 : Fichier hébergé sur Drive (drive.google.com/file/d/ID)
        if (!fileId) {
            const driveMatch = pageUrl.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9-_]+)/);
            if (driveMatch) {
                fileId = driveMatch[1];
                // Deviner le MIME via l'extension du titre (ex: "rapport.pdf - Google Drive")
                mimeType = guessMimeFromTitle(pageTitle);
            }
        }

        if (!fileId) {
            throw new Error("URL Google Drive non reconnue ou invalide.");
        }

        // Nettoyer le titre (retirer les suffixes Google)
        let driveTitle = pageTitle
            .replace(/ - Google (Docs|Sheets|Slides|Drive)$/i, '')
            .trim();

        await addDriveSource(finalNotebookId, fileId, mimeType, driveTitle, activeIndex);

        const notebookUrl = `https://notebooklm.google.com/notebook/${finalNotebookId}`;
        notifyUI("STATUS_UPDATE", { 
            text: "✅ Document Google Drive synchronisé !", 
            status: "success",
            linkUrl: notebookUrl,
            showDownload: false
        });

    } else if (format === "url") {
        // ═══ Pipeline URL : injection directe, zéro content script ═══
        // Détection YouTube → pipeline natif (transcript + vidéo)
        const isYouTube = /(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\/)/.test(pageUrl);
        
        if (isYouTube) {
            notifyUI("STATUS_UPDATE", { text: "YouTube détecté → import natif...", status: "info" });
            await addYouTubeSource(finalNotebookId, pageUrl, activeIndex);
        } else {
            notifyUI("STATUS_UPDATE", { text: "Envoi de l'URL à NotebookLM...", status: "info" });
            await addUrlSource(finalNotebookId, pageUrl, activeIndex);
        }

        const notebookUrl = `https://notebooklm.google.com/notebook/${finalNotebookId}`;
        notifyUI("STATUS_UPDATE", { 
            text: isYouTube ? "✅ Vidéo YouTube importée !" : "✅ URL importée !", 
            status: "success",
            linkUrl: notebookUrl,
            showDownload: false
        });

    } else {
        // ═══ Pipelines PDF / Markdown : content script requis ═══
        notifyUI("STATUS_UPDATE", { text: "Demande capture DOM...", status: "info" });

        const response = await browser.tabs.sendMessage(activeTab.id, {
            action: "START_CAPTURE",
            format: format
        });
        if (response?.status !== "SUCCESS") throw new Error("Erreur Content Script : " + response?.error);
        
        const capturedData = response.payload;
        const capturedFormat = response.format || format;

        // Stocker la capture pour téléchargement local
        lastCaptureData = capturedData;
        lastCaptureFilename = cleanTitle;
        lastCaptureFormat = capturedFormat;

        if (capturedFormat === "md") {
            // ─── Pipeline Markdown : RPC texte direct ───
            notifyUI("STATUS_UPDATE", { text: "Envoi du Markdown (source texte)...", status: "info" });
            await addTextSource(finalNotebookId, cleanTitle, capturedData, activeIndex);

            const notebookUrl = `https://notebooklm.google.com/notebook/${finalNotebookId}`;
            notifyUI("STATUS_UPDATE", { 
                text: "✅ Markdown importé !", 
                status: "success",
                linkUrl: notebookUrl,
                showDownload: true
            });

        } else {
            // ─── Pipeline PDF : upload resumable 3 étapes ───
            notifyUI("STATUS_UPDATE", { text: "Vérification des quotas de sécurité...", status: "info" });

            if (capturedData.length > MAX_BASE64_SIZE_BYTES) {
                throw new Error("Upload refusé : Le fichier PDF dépasse la limite de 200 MB.");
            }

            notifyUI("STATUS_UPDATE", { text: `Envoi du PDF (Serveurs Google)...`, status: "info" });
            await uploadPersonalSource(finalNotebookId, capturedData, cleanTitle, activeIndex);

            const notebookUrl = `https://notebooklm.google.com/notebook/${finalNotebookId}`;
            notifyUI("STATUS_UPDATE", { 
                text: "✅ PDF importé !", 
                status: "success",
                linkUrl: notebookUrl,
                showDownload: true
            });
        }
    }
    
    // Notification OS si la popup a été fermée
    const formatLabels = { pdf: "PDF", md: "Markdown", url: "URL", screenshot: "Screenshot", direct: "Import direct" };
    browser.notifications.create({
        type: "basic",
        iconUrl: browser.runtime.getURL("icons/icon.svg"),
        title: "NotebookLM Web Clipper",
        message: `"${cleanTitle}" ajouté en ${formatLabels[format] || format} avec succès !`
    });
}

/**
 * Upload générique d'un Blob (fichier binaire) vers NotebookLM.
 * Réutilise le protocole resumable 3 étapes (o4cbdc → start → upload+finalize).
 * Utilisé par : Import Direct (PDF, images, audio, texte) et Screenshot (PNG).
 *
 * @param {string} notebookId - ID du carnet cible.
 * @param {Blob} blob - Blob binaire du fichier.
 * @param {string} filename - Nom du fichier avec extension.
 * @param {number} authuserIndex - Index du compte Google actif.
 */
async function uploadFileBlob(notebookId, blob, filename, authuserIndex = 0) {
    
    const data = await browser.storage.local.get(['nblm_personal_cookie', 'nblm_csrf']);
    if (!data.nblm_personal_cookie || !data.nblm_csrf) {
        throw new Error("Authentification personnelle non finalisée.");
    }

    // Étape 1 : Enregistrer l'intention de source (RPC o4cbdc)
    const { sendBatchExecute } = await import('./api/rpc_client.js');
    const registerRpcId = "o4cbdc";
    const registerParams = [
        [[filename]],
        notebookId,
        [2],
        [1, null, null, null, null, null, null, null, null, null, [1]]
    ];
    
    const registerResult = await sendBatchExecute(registerRpcId, registerParams, authuserIndex);
    
    // Extraire le SOURCE_ID
    const sourceId = extractFirstStringFromResult(registerResult);
    if (!sourceId) {
        throw new Error("Échec enregistrement source: impossible d'obtenir SOURCE_ID.");
    }

    // Étape 2 : Démarrer le upload resumable
    const uploadStartUrl = `https://notebooklm.google.com/upload/_/?authuser=${authuserIndex}`;
    const startBody = JSON.stringify({
        "PROJECT_ID": notebookId,
        "SOURCE_NAME": filename,
        "SOURCE_ID": sourceId
    });
    
    const startResponse = await fetch(uploadStartUrl, {
        method: 'POST',
        headers: {
            'Accept': '*/*',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'Cookie': data.nblm_personal_cookie,
            'Origin': 'https://notebooklm.google.com',
            'Referer': 'https://notebooklm.google.com/',
            'x-goog-authuser': String(authuserIndex),
            'x-goog-upload-command': 'start',
            'x-goog-upload-header-content-length': String(blob.size),
            'x-goog-upload-protocol': 'resumable'
        },
        body: startBody
    });
    
    if (!startResponse.ok) {
        throw new Error(`Échec démarrage upload: HTTP ${startResponse.status}`);
    }
    
    const uploadUrl = startResponse.headers.get('x-goog-upload-url');
    if (!uploadUrl) {
        throw new Error("Échec: pas de x-goog-upload-url dans la réponse serveur.");
    }

    // Étape 3 : Upload du fichier + finalize
    const finalizeResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
            'Accept': '*/*',
            'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
            'Cookie': data.nblm_personal_cookie,
            'Origin': 'https://notebooklm.google.com',
            'Referer': 'https://notebooklm.google.com/',
            'x-goog-authuser': String(authuserIndex),
            'x-goog-upload-command': 'upload, finalize',
            'x-goog-upload-offset': '0'
        },
        body: blob
    });
    
    if (!finalizeResponse.ok) {
        throw new Error(`Échec upload fichier: HTTP ${finalizeResponse.status}`);
    }
    
    console.log(`[NotebookLM RPC] ✅ Fichier uploadé (${Math.round(blob.size / 1024)} Ko).`);
    return true;
}

/**
 * Utilitaire : extraire la première string d'une structure imbriquée
 */
function extractFirstStringFromResult(data) {
    if (typeof data === 'string') return data;
    if (Array.isArray(data) && data.length > 0) {
        return extractFirstStringFromResult(data[0]);
    }
    return null;
}
