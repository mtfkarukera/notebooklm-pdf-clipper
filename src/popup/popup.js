// popup.js : Logique UI et communication asynchrone

// Constantes DOM
const btnCapture = document.getElementById('btn-capture');
const uiSearchInput = document.getElementById('notebook-search');
const uiNotebookList = document.getElementById('notebook-list');
const uiStatusMessage = document.getElementById('status-message');
const uiAuthStatus = document.getElementById('auth-status');
const btnCustomSpinner = document.getElementById('btn-spinner');
const btnCreateNotebook = document.getElementById('btn-create-notebook');
const uiFormatToggle = document.getElementById('format-toggle');
const uiDirectImportSection = document.getElementById('direct-import-section');
const btnDirectImport = document.getElementById('btn-direct-import');
const uiDirectLabel = document.getElementById('direct-label');
const uiSelectionBanner = document.getElementById('selection-banner');
const uiSelectionPreview = document.getElementById('selection-text-preview');
const btnClearSelection = document.getElementById('btn-clear-selection');
const intentInput = document.getElementById('intent-input');
const intentCounter = document.getElementById('intent-counter');

// Variables d'état
let currentSelectedNotebookId = null;
let allNotebooksCache = [];
let currentFormat = "pdf";
let detectedFileInfo = null;
let pendingSelection = null; // Sélection en attente (capturée via le menu contextuel)

// Helper : créer un placeholder textuel sécurisé (remplace innerHTML)
function setPlaceholder(container, text, style) {
  const div = document.createElement('div');
  div.className = 'placeholder-text';
  if (style) div.style.cssText = style;
  div.textContent = text;
  container.replaceChildren(div);
} 

document.addEventListener('DOMContentLoaded', () => {
  // Connexion au background pour obtenir l'état et les carnets
  browser.runtime.sendMessage({ action: "GET_AUTH_STATUS" }).then((response) => {
     if(response && response.status === "CONNECTE") {
         updateAuthStatus(`Connecté (${response.type})`, "status-success");
         
         if (response.type === "PERSONAL") {
             browser.runtime.sendMessage({ action: "GET_ACCOUNTS" }).then(res => {
                 if (res && res.accounts && res.accounts.length > 1) {
                     const selectBox = document.getElementById("account-switcher");
                     if(selectBox) {
                         selectBox.replaceChildren();
                         res.accounts.forEach(acc => {
                             const opt = document.createElement("option");
                             opt.value = acc.index;
                             opt.textContent = acc.email;
                             if (acc.index === res.activeIndex) opt.selected = true;
                             selectBox.appendChild(opt);
                         });
                         selectBox.classList.remove("hidden");
                         selectBox.addEventListener("change", (e) => {
                             const newIndex = parseInt(e.target.value, 10);
                             browser.runtime.sendMessage({ action: "SET_ACCOUNT", index: newIndex }).then(() => {
                                 loadNotebooks(); // Recharger les carnets
                             });
                         });
                     }
                 }
                 loadNotebooks();
             }).catch(() => loadNotebooks());
         } else {
             loadNotebooks();
         }
     } else {
         updateAuthStatus("Déconnecté", "status-error");
         setPlaceholder(uiNotebookList, "Erreur d'authentification.");
     }
  }).catch(e => {
     updateAuthStatus("Déconnecté", "status-error");
     setPlaceholder(uiNotebookList, "Erreur d'authentification.");
   });
   
   uiSearchInput.addEventListener('input', debounce((e) => {
     filterNotebooks(e.target.value);
   }, 300));
   
   btnCapture.addEventListener('click', startCaptureProcess);
   
   // Bouton "+" : Crée un carnet avec le texte du champ de recherche
   btnCreateNotebook.addEventListener('click', createNewNotebook);

   // Toggle format PDF / Markdown / URL / Screenshot
   uiFormatToggle.addEventListener('click', (e) => {
     const btn = e.target.closest('.format-btn');
     if (!btn || btn.classList.contains('active') || btn.classList.contains('btn-disabled')) return;

     // Si une sélection est en attente, la cleariser quand l'utilisateur change de format
     if (pendingSelection) {
       browser.storage.local.remove('nwc_pending_selection');
       pendingSelection = null;
       uiSelectionBanner.classList.add('hidden');
       // Réactiver les boutons qui étaient grisés par la sélection
       uiFormatToggle.querySelectorAll('.format-btn').forEach(b => b.classList.remove('btn-disabled'));
     }

     // Désélectionner tous les boutons (format toggle + direct)
     uiFormatToggle.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
     if (btnDirectImport) btnDirectImport.classList.remove('active');
     
     btn.classList.add('active');
     currentFormat = btn.dataset.format;
     updateCaptureButtonLabel();
   });

   // Bouton Import Direct (séparé du toggle principal)
   if (btnDirectImport) {
     btnDirectImport.addEventListener('click', () => {
       if (btnDirectImport.classList.contains('active')) return;
       
       // Désélectionner les boutons du toggle principal
       uiFormatToggle.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
       btnDirectImport.classList.add('active');
       currentFormat = 'direct';
       updateCaptureButtonLabel();
     });
   }

   // Bouton Annuler la sélection
   if (btnClearSelection) {
     btnClearSelection.addEventListener('click', async () => {
       await browser.storage.local.remove('nwc_pending_selection');
       pendingSelection = null;
       uiSelectionBanner.classList.add('hidden');
       // Restaurer le format précédent
       if (currentFormat === 'selection') {
         currentFormat = 'pdf';
         uiFormatToggle.querySelector('[data-format="pdf"]').classList.add('active');
         updateCaptureButtonLabel();
       }
     });
   }

   // Détection du type de fichier pour l'Import Direct
   detectActiveTabFileType();

   // Vérifier s'il y a une sélection en attente (capturée via le menu contextuel)
   checkPendingSelection();

   // Compteur d'intention
   if (intentInput && intentCounter) {
     intentInput.addEventListener('input', () => {
       intentCounter.textContent = `${intentInput.value.length} / 300`;
     });
   }
});

function loadNotebooks() {
    setPlaceholder(uiNotebookList, 'Chargement des carnets...');
    browser.runtime.sendMessage({ action: "GET_NOTEBOOKS" }).then((res) => {
         uiSearchInput.disabled = false;
         if(res && res.notebooks) {
            allNotebooksCache = res.notebooks;
            renderNotebooks(allNotebooksCache);
         } else if (res && res.error) {
            setPlaceholder(uiNotebookList, 'Err: ' + res.error, 'color:#d32f2f; font-size:12px; margin: 10px;');
         } else {
            setPlaceholder(uiNotebookList, 'Aucun carnet trouvé.');
         }
    }).catch(err => {
         setPlaceholder(uiNotebookList, 'Err: ' + err.message, 'color:#d32f2f;');
         uiSearchInput.disabled = true;
    });
}

function renderNotebooks(list) {
    uiNotebookList.replaceChildren();
    if(list.length === 0) {
        setPlaceholder(uiNotebookList, 'Carnet introuvable.');
        return;
    }
    list.forEach(nb => {
        const div = document.createElement('div');
        div.className = 'notebook-item';
        if (currentSelectedNotebookId === nb.id) {
           div.classList.add('selected');
        }
        div.textContent = nb.title;
        div.onclick = () => {
            document.querySelectorAll('.notebook-item').forEach(el => el.classList.remove('selected'));
            div.classList.add('selected');
            currentSelectedNotebookId = nb.id;
            btnCapture.disabled = false;
        };
        uiNotebookList.appendChild(div);
    });
}

function debounce(func, delay) {
  let timeoutId;
  return function (...args) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
}

function filterNotebooks(query) {
  const filtered = allNotebooksCache.filter(nb => nb.title.toLowerCase().includes(query.toLowerCase()));
  renderNotebooks(filtered);
}

/**
 * Création d'un nouveau carnet : utilise le contenu du champ de recherche comme nom
 */
async function createNewNotebook() {
  const title = uiSearchInput.value.trim();
  if (!title) {
    updateStatus("Saisissez un nom de carnet dans le champ de recherche.", "error");
    return;
  }
  
  btnCreateNotebook.disabled = true;
  updateStatus(`Création du carnet "${title}"...`, "info");
  
  try {
    const response = await browser.runtime.sendMessage({ 
      action: "CREATE_NOTEBOOK", 
      title: title 
    });
    
    if (response && response.notebookId) {
      // Sélectionner automatiquement le nouveau carnet
      currentSelectedNotebookId = response.notebookId;
      btnCapture.disabled = false;
      
      // Ajouter au cache et rafraîchir l'affichage
      allNotebooksCache.unshift({ id: response.notebookId, title: title });
      uiSearchInput.value = '';
      renderNotebooks(allNotebooksCache);
      
      const notebookUrl = `https://notebooklm.google.com/notebook/${response.notebookId}`;
      updateStatus(`Carnet "${title}" créé ✅`, "success", notebookUrl);
    } else {
      updateStatus("Erreur: " + (response?.error || "Création échouée"), "error");
    }
  } catch (err) {
    updateStatus("Erreur: " + err.message, "error");
  } finally {
    btnCreateNotebook.disabled = false;
  }
}

function startCaptureProcess() {
   if (!currentSelectedNotebookId) {
     updateStatus("Veuillez d'abord sélectionner un carnet.", "error");
     return;
   }

   // Mode sélection : envoyer le texte capturé
   if (currentFormat === 'selection' && pendingSelection) {
     btnCapture.disabled = true;
     uiSearchInput.disabled = true;
     btnCustomSpinner.classList.remove('hidden');
     updateStatus("📋 Import de la sélection...", "info");
     
     browser.runtime.sendMessage({
       action: "START_CAPTURE",
       notebookId: currentSelectedNotebookId,
       format: 'selection',
       selectionData: pendingSelection,
       intentNote: intentInput.value.trim() || null
     });
     
     // Nettoyer la sélection en attente
     browser.storage.local.remove('nwc_pending_selection');
     pendingSelection = null;
     return;
   }

   btnCapture.disabled = true;
   uiSearchInput.disabled = true;
   btnCustomSpinner.classList.remove('hidden');

   const formatLabels = { pdf: 'PDF', md: 'Markdown', url: 'URL', screenshot: 'Screenshot', direct: 'Import direct', drive: 'Google Drive' };
   const label = formatLabels[currentFormat] || currentFormat;
   updateStatus(`Import en ${label}...`, "info");

   browser.runtime.sendMessage({ 
     action: "START_CAPTURE", 
     notebookId: currentSelectedNotebookId,
     format: currentFormat,
     intentNote: intentInput.value.trim() || null
   });
}

/**
 * Met à jour le libellé du bouton principal selon le format sélectionné.
 */
function updateCaptureButtonLabel() {
   const btnText = btnCapture.querySelector('.btn-text');
   const labels = {
     pdf: 'Capturer la page',
     md: 'Capturer la page',
     url: "Importer l'URL",
     screenshot: '📸 Capturer le viewport',
     direct: 'Importer',
     selection: '📋 Importer la sélection',
     drive: '☁️ Importer Google Drive'
   };
   btnText.textContent = labels[currentFormat] || 'Capturer la page';
}

/**
 * Détecte si l'onglet actif affiche un fichier directement importable.
 * Active/désactive les boutons en conséquence.
 */
async function detectActiveTabFileType() {
   try {
     const tabs = await browser.tabs.query({ active: true, currentWindow: true });
     if (tabs.length === 0) return;

     const url = tabs[0].url;

      // 1. Détection prioritaire Google Drive
      if (window.ClipperUtils && window.ClipperUtils.parseDriveUrl) {
          const driveInfo = window.ClipperUtils.parseDriveUrl(url);
          if (driveInfo) {
              const driveBtn = document.getElementById('btn-drive-import');
              if (driveBtn) {
                  driveBtn.style.display = 'flex';
                  driveBtn.classList.remove('hidden');

                  if (driveInfo.typeStr === 'file') {
                      // Fichier hébergé sur Drive → Drive + Screenshot
                      // (Drive pour les docs textuels, Screenshot pour le reste)
                      uiFormatToggle.querySelectorAll('.format-btn').forEach(b => {
                          b.classList.remove('active');
                          if (['pdf', 'md', 'url'].includes(b.dataset.format)) {
                              b.style.display = 'none';
                          }
                      });
                  } else {
                      // Google Workspace (Docs/Sheets/Slides) → Drive exclusif
                      uiFormatToggle.querySelectorAll('.format-btn').forEach(b => {
                          b.classList.remove('active');
                          if (['pdf', 'md', 'url', 'screenshot'].includes(b.dataset.format)) {
                              b.style.display = 'none';
                          }
                      });
                  }

                  driveBtn.classList.add("active");
                  currentFormat = "drive";
                  updateCaptureButtonLabel();
                  return;
              }
          }
      }

     // 2. Fallback pour fichiers réguliers via background script
     const result = await browser.runtime.sendMessage({ action: "DETECT_FILE_TYPE", url });
     detectedFileInfo = result;

     if (result && result.directImport) {
       // Afficher le bouton Import Direct avec le label du type détecté
       uiDirectLabel.textContent = `Import direct (${result.label})`;
       uiDirectImportSection.classList.remove('hidden');

      if (result.isLocal) {
         // === Fichier local : tout griser + message informatif ===
         uiFormatToggle.querySelectorAll('.format-btn').forEach(b => {
           b.classList.add('btn-disabled');
           b.classList.remove('active');
         });
         btnDirectImport.classList.add('btn-disabled');
         currentFormat = 'direct';
         updateStatus("⚠️ Fichier local — l'import direct n'est pas disponible.", "info");
         updateCaptureButtonLabel();
       } else {
         // === Fichier distant : bouton Import Direct normal ===
         applyButtonVisibility(result);
       }
     }
   } catch (e) {
     console.warn('[Popup] Détection fichier échouée:', e.message);
   }
}

/**
 * Applique la matrice de visibilité des boutons selon le type de fichier détecté.
 * 
 * Règles :
 * - Image/Audio/Video : PDF et MD grisés (n'ont pas de sens)
 * - Audio/Video : Screenshot grisé aussi
 * - Fichier local (file://) : URL grisé 
 */
function applyButtonVisibility(fileInfo) {
   const pdfBtn = uiFormatToggle.querySelector('[data-format="pdf"]');
   const mdBtn = uiFormatToggle.querySelector('[data-format="md"]');
   const urlBtn = uiFormatToggle.querySelector('[data-format="url"]');
   const screenshotBtn = uiFormatToggle.querySelector('[data-format="screenshot"]');

   // Images : PDF/MD n'ont pas de sens (Readability sur un viewer d'image = garbled)
   if (fileInfo.category === 'image') {
     pdfBtn.classList.add('btn-disabled');
     mdBtn.classList.add('btn-disabled');
   }

   // Audio/Vidéo : PDF/MD/Screenshot n'ont aucun sens
   if (fileInfo.category === 'audio' || fileInfo.category === 'video') {
     pdfBtn.classList.add('btn-disabled');
     mdBtn.classList.add('btn-disabled');
     screenshotBtn.classList.add('btn-disabled');
   }

   // Fichier local : URL grisé (Google ne peut pas scraper file://)
   if (fileInfo.isLocal) {
     urlBtn.classList.add('btn-disabled');
   }

   // Si le format actif est maintenant désactivé, basculer sur Import Direct
   const activeBtn = uiFormatToggle.querySelector('.format-btn.active');
   if (activeBtn && activeBtn.classList.contains('btn-disabled')) {
     activeBtn.classList.remove('active');
     btnDirectImport.classList.add('active');
     currentFormat = 'direct';
     updateCaptureButtonLabel();
   }
}

/**
 * Vérifie s'il y a une sélection de texte en attente (capturée via le menu contextuel).
 * Si oui, affiche le bandeau et bascule sur le format "selection".
 */
async function checkPendingSelection() {
   try {
     const data = await browser.storage.local.get('nwc_pending_selection');
     const sel = data.nwc_pending_selection;
     
     if (!sel || !sel.text) return;
     
     // Ignorer les sélections trop anciennes (> 2 min)
     if (Date.now() - sel.timestamp > 2 * 60 * 1000) {
       await browser.storage.local.remove('nwc_pending_selection');
       return;
     }
     
     pendingSelection = sel;
     
     // Afficher le bandeau avec aperçu
     const wordCount = sel.text.split(/\s+/).filter(w => w.length > 0).length;
     const preview = sel.text.substring(0, 60) + (sel.text.length > 60 ? '…' : '');
     uiSelectionPreview.textContent = `"${preview}" (${wordCount} mots)`;
     uiSelectionBanner.classList.remove('hidden');
     
     // Basculer sur le format "selection" et griser TOUS les boutons de format
     // (la sélection ne supporte qu'un seul mode : texte source)
     uiFormatToggle.querySelectorAll('.format-btn').forEach(b => {
       b.classList.remove('active');
       b.classList.add('btn-disabled');
     });
     // Griser aussi le bouton Import Direct s'il est visible
     if (btnDirectImport) btnDirectImport.classList.add('btn-disabled');
     
     currentFormat = 'selection';
     updateCaptureButtonLabel();
     
     // Activer le bouton si un carnet est déjà sélectionné
     if (currentSelectedNotebookId) {
       btnCapture.disabled = false;
     }
     
     // Marquer la sélection comme vue (elle sera supprimée au prochain checkPendingSelection)
     await browser.storage.local.remove('nwc_pending_selection');
   } catch (e) {
     console.warn('[Popup] Erreur vérification sélection:', e.message);
   }
}

function resetUI() {
  btnCapture.disabled = false;
  uiSearchInput.disabled = false;
  btnCustomSpinner.classList.add('hidden');
}

function updateStatus(message, type, linkUrl, showDownload) {
  // Construction DOM sécurisée (pas de innerHTML)
  uiStatusMessage.replaceChildren();
  uiStatusMessage.appendChild(document.createTextNode(message));
  
  if (linkUrl) {
    const link = document.createElement('a');
    link.href = linkUrl;
    link.target = '_blank';
    link.textContent = ' Ouvrir le carnet →';
    link.style.cssText = 'color: #1a73e8; text-decoration: underline; cursor: pointer; margin-left: 4px;';
    uiStatusMessage.appendChild(link);
  }
  
  if (showDownload) {
    const ext = currentFormat === "md" ? ".md" : ".pdf";
    const dlLink = document.createElement('a');
    dlLink.href = '#';
    dlLink.textContent = ` Télécharger le ${ext} ↓`;
    dlLink.style.cssText = 'color: #34a853; text-decoration: underline; cursor: pointer; margin-left: 8px; font-size: 12px;';
    dlLink.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dlLink.textContent = ' Téléchargement...';
      browser.runtime.sendMessage({ action: "DOWNLOAD_CAPTURE" }).then(res => {
        if (res && res.ok) {
          dlLink.textContent = ' ✅ Téléchargé';
        } else {
          dlLink.textContent = ' ❌ ' + (res?.error || 'Erreur');
        }
      }).catch(() => {
        dlLink.textContent = ' ❌ Erreur';
      });
    });
    uiStatusMessage.appendChild(dlLink);
  }
  
  if(type === "error") uiStatusMessage.style.color = "var(--status-error)";
  else if (type === "success") uiStatusMessage.style.color = "var(--status-success)";
  else uiStatusMessage.style.color = "var(--text-muted)";
}

function updateAuthStatus(text, cssClass) {
  uiAuthStatus.textContent = text;
  uiAuthStatus.className = `status-badge ${cssClass}`;
}

// Bouton Fermer (en bas de la popup, autonome pour mobile et desktop)
document.getElementById('btn-close').addEventListener('click', () => {
  window.close();
});

browser.runtime.onMessage.addListener((message) => {
  if(message.type === "STATUS_UPDATE") {
    updateStatus(message.text, message.status, message.linkUrl, message.showDownload);
    if(message.status === "error" || message.status === "success") {
      resetUI();
      if (message.status === "success") {
        if (intentInput) intentInput.value = "";
        if (intentCounter) intentCounter.textContent = "0 / 300";
      }
    }
  }
});

// Intercepter les clics sur les liens dans la zone de statut
// (les <a href> dans une popup d'extension ne s'ouvrent pas naturellement)
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href]');
  if (link && link.href && !link.href.startsWith('#') && link.href !== '#') {
    e.preventDefault();
    browser.tabs.create({ url: link.href });
  }
});
