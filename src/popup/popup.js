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
const uiFilePickerSection = document.getElementById('file-picker-section');
const filePickerInput = document.getElementById('file-picker-input');
const filePickerName = document.getElementById('file-picker-name');
const filePickerLabel = document.getElementById('file-picker-label');

// Variables d'état
let currentSelectedNotebookId = null;
let allNotebooksCache = [];
let currentFormat = "pdf"; // "pdf", "md", "url", "screenshot" ou "direct"
let detectedFileInfo = null; // { directImport, mimeType, label, category, isLocal }
let pickedFileDataUri = null; // File picker : data URI du fichier sélectionné
let pickedFileName = null;   // File picker : nom du fichier sélectionné

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

   // File picker : lecture du fichier sélectionné
   if (filePickerInput) {
     filePickerInput.addEventListener('change', (e) => {
       const file = e.target.files[0];
       if (!file) return;
       
       pickedFileName = file.name;
       filePickerName.textContent = file.name;
       
       // Lire le fichier en data URI
       const reader = new FileReader();
       reader.onload = (evt) => {
         pickedFileDataUri = evt.target.result;
         // Activer le bouton d'import si un carnet est sélectionné
         if (currentSelectedNotebookId) {
           btnCapture.disabled = false;
         }
         updateCaptureButtonLabel();
       };
       reader.readAsDataURL(file);
     });
   }

   // Détection du type de fichier pour l'Import Direct
   detectActiveTabFileType();
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
        div.innerText = nb.title;
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

   // Mode fichier local : envoyer le fichier du picker
   if (currentFormat === 'direct' && detectedFileInfo?.isLocal) {
     if (!pickedFileDataUri || !pickedFileName) {
       updateStatus("Veuillez d'abord sélectionner un fichier.", "error");
       return;
     }
     
     btnCapture.disabled = true;
     uiSearchInput.disabled = true;
     btnCustomSpinner.classList.remove('hidden');
     updateStatus("⚡ Import du fichier local...", "info");
     
     browser.runtime.sendMessage({
       action: "UPLOAD_FILE_PICKER",
       notebookId: currentSelectedNotebookId,
       fileDataUri: pickedFileDataUri,
       filename: pickedFileName
     });
     return;
   }

   btnCapture.disabled = true;
   uiSearchInput.disabled = true;
   btnCustomSpinner.classList.remove('hidden');

   const formatLabels = { pdf: 'PDF', md: 'Markdown', url: 'URL', screenshot: 'Screenshot', direct: 'Import direct' };
   const label = formatLabels[currentFormat] || currentFormat;
   updateStatus(`Import en ${label}...`, "info");

   browser.runtime.sendMessage({ 
     action: "START_CAPTURE", 
     notebookId: currentSelectedNotebookId,
     format: currentFormat
   });
}

/**
 * Met à jour le libellé du bouton principal selon le format sélectionné.
 */
function updateCaptureButtonLabel() {
   const btnText = btnCapture.querySelector('.btn-text');
   if (currentFormat === 'direct' && detectedFileInfo?.isLocal) {
     // Mode fichier local : le bouton upload le fichier du picker
     btnText.textContent = pickedFileDataUri ? '⚡ Importer le fichier' : '⚡ Sélectionnez un fichier';
   } else {
     const labels = {
       pdf: 'Capturer la page',
       md: 'Capturer la page',
       url: "Importer l'URL",
       screenshot: '📸 Capturer le viewport',
       direct: 'Importer'
     };
     btnText.textContent = labels[currentFormat] || 'Capturer la page';
   }
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
     const result = await browser.runtime.sendMessage({ action: "DETECT_FILE_TYPE", url });
     detectedFileInfo = result;

     if (result && result.directImport) {
       // Afficher le bouton Import Direct avec le label du type détecté
       uiDirectLabel.textContent = `Import direct (${result.label})`;
       uiDirectImportSection.classList.remove('hidden');

       if (result.isLocal) {
         // === Fichier local : afficher le file picker, masquer le bouton direct ===
         btnDirectImport.classList.add('hidden');
         uiFilePickerSection.classList.remove('hidden');
         filePickerLabel.textContent = `📂 Sélectionner le ${result.label}`;
         
         // Griser TOUS les boutons de format (rien ne marche sur file://)
         uiFormatToggle.querySelectorAll('.format-btn').forEach(b => {
           b.classList.add('btn-disabled');
           b.classList.remove('active');
         });
         
         // Pré-sélectionner le format direct
         currentFormat = 'direct';
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
    if(message.status === "error" || message.status === "success") resetUI();
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
