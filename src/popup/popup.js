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

// Variables d'état
let currentSelectedNotebookId = null;
let allNotebooksCache = [];
let currentFormat = "pdf"; // "pdf", "md" ou "url"

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
         loadNotebooks();
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

  // Toggle format PDF / Markdown / URL
  uiFormatToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.format-btn');
    if (!btn || btn.classList.contains('active')) return;

    uiFormatToggle.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFormat = btn.dataset.format;

    // Adapter le texte du bouton de capture
    const btnText = btnCapture.querySelector('.btn-text');
    if (currentFormat === 'url') {
      btnText.textContent = "Importer l'URL";
    } else {
      btnText.textContent = 'Capturer la page';
    }
  });
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

  btnCapture.disabled = true;
  uiSearchInput.disabled = true;
  btnCustomSpinner.classList.remove('hidden');

  const formatLabels = { pdf: 'PDF', md: 'Markdown', url: 'URL' };
  const label = formatLabels[currentFormat] || currentFormat;
  updateStatus(`Import en ${label}...`, "info");

  browser.runtime.sendMessage({ 
    action: "START_CAPTURE", 
    notebookId: currentSelectedNotebookId,
    format: currentFormat
  });
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

  // Ajout du bouton "Fermer" sur les états finaux (succès ou erreur)
  if (type === "success" || type === "error") {
    const closeLink = document.createElement('a');
    closeLink.href = '#';
    closeLink.textContent = ' ✖ Fermer';
    closeLink.style.cssText = 'color: var(--text-muted); text-decoration: underline; cursor: pointer; margin-left: 12px; font-size: 12px;';
    closeLink.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.close(); // Ferme la popup nativement
    });
    uiStatusMessage.appendChild(closeLink);
  }
  
  if(type === "error") uiStatusMessage.style.color = "var(--status-error)";
  else if (type === "success") uiStatusMessage.style.color = "var(--status-success)";
  else uiStatusMessage.style.color = "var(--text-muted)";
}

function updateAuthStatus(text, cssClass) {
  uiAuthStatus.textContent = text;
  uiAuthStatus.className = `status-badge ${cssClass}`;
}

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
