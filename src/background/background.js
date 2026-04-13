// background.js : Event Page MV3, Routeur central Asynchrone
import { getPersonalAuthCookies, fetchCSRFToken } from './api/auth_personal.js';
import { createPersonalNotebook, uploadPersonalSource, addTextSource, addUrlSource } from './api/rpc_client.js';

/**
 * Taille Max de PDF imposée par Google : 200 MB
 * Un octet Base64 pèse plus lourd (ratio ~1.37), cette limite mathématique garantit le quota réel.
 */
const MAX_BASE64_SIZE_BYTES = 200 * 1024 * 1024 * 1.37;

// Dernière capture (stockée en mémoire pour téléchargement local)
let lastCaptureData = null;    // base64 PDF ou texte Markdown
let lastCaptureFilename = null;
let lastCaptureFormat = null;  // "pdf" ou "md"

// Routeur Principal recevant les messages de la Popup et du Content Script
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    
    if (message.action === "GET_AUTH_STATUS") {
        sendResponse({ status: "CONNECTE", type: "PERSONAL" });
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
                const response = await fetch(message.url);
                const blob = await response.blob();
                const reader = new FileReader();
                reader.onloadend = () => {
                    sendResponse({ data: reader.result }); // data URI base64
                };
                reader.onerror = () => sendResponse({ error: "FileReader échoué" });
                reader.readAsDataURL(blob);
            } catch (err) {
                console.warn("[Background] Impossible de récupérer l'image:", message.url, err.message);
                sendResponse({ error: err.message });
            }
        })();
        return true;
    }

    // Téléchargement local de la dernière capture (PDF ou Markdown)
    if (message.action === "DOWNLOAD_CAPTURE") {
        if (!lastCaptureData) {
            sendResponse({ error: "Aucune capture disponible" });
            return;
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
                sendResponse({ ok: true });
            } catch (err) {
                sendResponse({ error: err.message });
            }
        })();
        return true;
    }

    if (message.action === "START_CAPTURE") {
        executeCaptureAndUploadWorkflow(message.notebookId, message.format || "pdf")
            .catch(err => {
                console.error("[Clipper Background] Erreur globale :", err);
                notifyUI("STATUS_UPDATE", { text: err.message, status: "error" });
            });
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
    if (format === "url") {
        // ═══ Pipeline URL : injection directe, zéro content script ═══
        notifyUI("STATUS_UPDATE", { text: "Envoi de l'URL à NotebookLM...", status: "info" });

        await addUrlSource(finalNotebookId, pageUrl, activeIndex);

        const notebookUrl = `https://notebooklm.google.com/notebook/${finalNotebookId}`;
        notifyUI("STATUS_UPDATE", { 
            text: "✅ URL importée !", 
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
    const formatLabels = { pdf: "PDF", md: "Markdown", url: "URL" };
    browser.notifications.create({
        type: "basic",
        iconUrl: browser.runtime.getURL("icons/icon.svg"),
        title: "NotebookLM Web Clipper",
        message: `"${cleanTitle}" ajouté en ${formatLabels[format] || format} avec succès !`
    });
}
