// rpc_client.js : Emulateur RPC pour NotebookLM Personal
// Traduit fidèlement la logique de notebooklm-py (encoder.py + decoder.py)

/**
 * Moteur RPC pour construire et envoyer les requêtes formatées "batchexecute"
 * Utilisé lorsqu'aucune API officielle n'est disponible (Comptes personnels).
 */

// ============================================
// 1. ENCODEUR (encoder.py)
// ============================================

function encodeRpcRequest(rpcId, params) {
    // JSON-encode params sans espaces (format compact comme Chrome)
    const paramsJson = JSON.stringify(params);
    // Build inner request: [rpc_id, json_params, null, "generic"]
    const inner = [rpcId, paramsJson, null, "generic"];
    // Triple-nest the request  
    return [[inner]];
}

function buildRequestBody(rpcRequest, csrfToken) {
    // JSON-encode the request (compact)
    const fReq = JSON.stringify(rpcRequest);
    // Construire le body encodé en URL  
    const parts = [`f.req=${encodeURIComponent(fReq)}`];
    if (csrfToken) {
        parts.push(`at=${encodeURIComponent(csrfToken)}`);
    }
    // Trailing & comme dans notebooklm-py
    return parts.join('&') + '&';
}

function buildQueryParams(rpcId) {
    return new URLSearchParams({
        'rpcids': rpcId,
        'source-path': '/',
        'hl': 'en',
        'rt': 'c'   // Chunked response mode
    }).toString();
}

// ============================================
// 2. DECODEUR (decoder.py) 
// ============================================

/**
 * Supprime le préfixe anti-XSSI )]}'
 */
function stripAntiXssi(response) {
    return response.replace(/^\)]\}'[\r\n]+/, '');
}

/**
 * Parse le format de réponse chunké (mode rt=c).
 * Format: lignes alternées de byte_count (entier) + json_payload.
 * C'est la traduction exacte de parse_chunked_response() de decoder.py
 */
function parseChunkedResponse(response) {
    if (!response || !response.trim()) return [];
    
    const chunks = [];
    const lines = response.trim().split('\n');
    let i = 0;
    
    while (i < lines.length) {
        const line = lines[i].trim();
        
        // Skip lignes vides
        if (!line) { i++; continue; }
        
        // Essayer de parser comme un byte count (entier)
        if (/^\d+$/.test(line)) {
            i++; // Avancer à la ligne suivante (le payload JSON)
            if (i < lines.length) {
                try {
                    const chunk = JSON.parse(lines[i]);
                    chunks.push(chunk);
                } catch (e) {
                    // Chunk malformé, on skip
                }
            }
            i++;
        } else {
            // Pas un byte count, essayer de parser comme JSON directement
            try {
                const chunk = JSON.parse(line);
                chunks.push(chunk);
            } catch (e) {
                // Skip les lignes non-JSON
            }
            i++;
        }
    }
    return chunks;
}

/**
 * Extrait le résultat d'un RPC ID spécifique depuis les chunks.
 * Traduction de extract_rpc_result() de decoder.py
 */
function extractRpcResult(chunks, rpcId) {
    for (const chunk of chunks) {
        if (!Array.isArray(chunk)) continue;
        
        // Le chunk peut être [[item1, item2, ...]] ou [item]
        const items = (chunk.length > 0 && Array.isArray(chunk[0])) ? chunk : [chunk];
        
        for (const item of items) {
            if (!Array.isArray(item) || item.length < 3) continue;
            
            // Réponse d'erreur
            if (item[0] === "er" && item[1] === rpcId) {
                throw new Error(`RPC Error pour ${rpcId}: code ${item[2]}`);
            }
            
            // Réponse de succès : ["wrb.fr", "rpcId", "json_stringifié_du_résultat", ...]
            if (item[0] === "wrb.fr" && item[1] === rpcId) {
                const resultData = item[2];
                if (typeof resultData === 'string') {
                    try {
                        return JSON.parse(resultData);
                    } catch (e) {
                        return resultData;
                    }
                }
                return resultData;
            }
        }
    }
    return null;
}

/**
 * Pipeline complet de décodage : strip prefix -> parse chunks -> extract result
 * Traduction de decode_response() de decoder.py
 */
function decodeResponse(rawResponse, rpcId) {
    const cleaned = stripAntiXssi(rawResponse);
    const chunks = parseChunkedResponse(cleaned);
    return extractRpcResult(chunks, rpcId);
}

// ============================================
// 3. TRANSPORT (envoi HTTP)
// ============================================

export async function sendBatchExecute(rpcId, jsonArgs) {
    const data = await browser.storage.local.get(['nblm_personal_cookie', 'nblm_csrf']);
    if (!data.nblm_personal_cookie || !data.nblm_csrf) {
        throw new Error("Authentification personnelle non finalisée.");
    }

    // Encoder la requête RPC
    const rpcRequest = encodeRpcRequest(rpcId, jsonArgs);
    const body = buildRequestBody(rpcRequest, data.nblm_csrf);
    const queryString = buildQueryParams(rpcId);
    const endpoint = `https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute?${queryString}`;

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
            'Cookie': data.nblm_personal_cookie
        },
        body: body
    });

    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            await browser.storage.local.remove(['nblm_personal_cookie', 'nblm_csrf']);
            throw new Error("Jeton RPC rejeté (401/403). Veuillez rafraîchir votre session NotebookLM.");
        }
        throw new Error(`Erreur réseau batchexecute: ${response.status}`);
    }

    const responseText = await response.text();
    
    // Décoder avec le pipeline complet (comme decoder.py)
    return decodeResponse(responseText, rpcId);
}

// ============================================
// 4. FACADES MÉTIER
// ============================================

export async function listPersonalNotebooks() {
    const rpcId = "wXbhsf";
    
    // Paramètres exacts de notebooklm-py : [None, 1, None, [2]]
    const result = await sendBatchExecute(rpcId, [null, 1, null, [2]]);
    
    if (!result || !Array.isArray(result)) {
        console.warn("[NotebookLM RPC] Réponse inattendue pour LIST_NOTEBOOKS:", result);
        return [];
    }
    
    // Structure de la réponse (from types.py Notebook.from_api_response) :
    // result = [ [notebook1, notebook2, ...], ... ]
    // Chaque notebook est un array où :
    //   - index 0 = titre (string)
    //   - index 2 = id (string)
    const rawNotebooks = Array.isArray(result[0]) && Array.isArray(result[0][0]) 
        ? result[0]    // [[nb1], [nb2], ...] 
        : result;      // [nb1, nb2, ...]
    
    const notebooks = [];
    for (const nb of rawNotebooks) {
        if (!Array.isArray(nb)) continue;
        
        const title = (nb.length > 0 && typeof nb[0] === 'string') ? nb[0].replace('thought\n', '').trim() : '';
        const id = (nb.length > 2 && typeof nb[2] === 'string') ? nb[2] : '';
        
        if (id && title) {
            notebooks.push({ id, title });
        }
    }
    
    if (notebooks.length === 0) {
       console.warn("[NotebookLM RPC] Parsing échoué. Structure brute:", JSON.stringify(result).substring(0, 2000));
    }
    
    return notebooks;
}

export async function createPersonalNotebook(title) {
    // RPC ID: CCqFvf (de notebooklm-py)
    const rpcId = "CCqFvf";
    const result = await sendBatchExecute(rpcId, [title, null]);
    
    // L'ID du nouveau carnet est typiquement à result[2] ou result[0][2]
    if (result && Array.isArray(result)) {
        const nbId = (typeof result[2] === 'string') ? result[2] : 
                     (Array.isArray(result[0]) && typeof result[0][2] === 'string') ? result[0][2] : null;
        if (nbId) return nbId;
    }
    
    throw new Error("Impossible d'extraire l'ID du carnet créé.");
}

/**
 * Ajoute une source texte (Markdown) directement dans un carnet NotebookLM.
 * Utilise le RPC izAoDd (ADD_SOURCE — Text) de notebooklm-py.
 * Pas besoin de protocole resumable : injection directe en une seule requête.
 *
 * @param {string} notebookId - ID du carnet cible.
 * @param {string} title - Titre de la source (affiché dans NotebookLM).
 * @param {string} content - Contenu textuel/Markdown à injecter.
 */
export async function addTextSource(notebookId, title, content) {
    console.log(`[NotebookLM RPC] Ajout source texte: "${title}" (${content.length} chars)`);
    
    const rpcId = "izAoDd";
    // Structure exacte de notebooklm-py : _sources.py::add_text()
    // [title, content] à la position [1] dans un tableau de 8 éléments
    const params = [
        [[null, [title, content], null, null, null, null, null, null]],
        notebookId,
        [2],
        null,
        null,
    ];
    
    const result = await sendBatchExecute(rpcId, params);
    
    if (result) {
        console.log("[NotebookLM RPC] ✅ Source texte ajoutée avec succès !");
    } else {
        console.warn("[NotebookLM RPC] ⚠️ Réponse nulle pour addTextSource (peut être normal).");
    }
    
    return true;
}

/**
 * Ajoute une source URL directement dans un carnet NotebookLM.
 * NotebookLM scrape et indexe la page lui-même.
 * Utilise le RPC izAoDd (ADD_SOURCE — URL) de notebooklm-py.
 *
 * @param {string} notebookId - ID du carnet cible.
 * @param {string} url - URL complète de la page web à importer.
 */
export async function addUrlSource(notebookId, url) {
    console.log(`[NotebookLM RPC] Ajout source URL: ${url}`);
    
    const rpcId = "izAoDd";
    // Structure exacte de notebooklm-py : _sources.py::_add_url_source()
    // L'URL va à la position [2] dans un tableau de 8 éléments
    const params = [
        [[null, null, [url], null, null, null, null, null]],
        notebookId,
        [2],
        null,
        null,
    ];
    
    const result = await sendBatchExecute(rpcId, params);
    
    if (result) {
        console.log("[NotebookLM RPC] ✅ Source URL ajoutée avec succès !");
    } else {
        console.warn("[NotebookLM RPC] ⚠️ Réponse nulle pour addUrlSource (peut être normal).");
    }
    
    return true;
}

export async function uploadPersonalSource(notebookId, pdfDataUri, customTitle = null) {
    console.log("[NotebookLM RPC] Démarrage upload PDF (protocole resumable en 3 étapes)...");
    
    const data = await browser.storage.local.get(['nblm_personal_cookie', 'nblm_csrf']);
    if (!data.nblm_personal_cookie || !data.nblm_csrf) {
        throw new Error("Authentification personnelle non finalisée.");
    }

    // Convertir le data URI en binaire
    const base64Content = pdfDataUri.split(',')[1]; // Retirer le préfixe "data:application/pdf;base64,"
    const binaryString = atob(base64Content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    const pdfBlob = new Blob([bytes], { type: 'application/pdf' });
    
    // Nom du fichier = titre de la page (ou fallback générique)
    const filename = customTitle 
        ? `${customTitle}.pdf` 
        : `Capture_${new Date().toISOString().slice(0,10)}.pdf`;
    const fileSize = pdfBlob.size;
    console.log(`[NotebookLM RPC] Fichier: ${filename}, Taille: ${Math.round(fileSize / 1024)} Ko`);

    // ╔════════════════════════════════════════════════════════╗
    // ║ ÉTAPE 1 : Enregistrer l'intention de source (RPC)     ║
    // ║ RPC ID: o4cbdc (ADD_SOURCE_FILE)                      ║
    // ║ Params: [[[filename]], notebook_id, [2], [1,...,[1]]]  ║
    // ╚════════════════════════════════════════════════════════╝
    const registerRpcId = "o4cbdc";
    const registerParams = [
        [[filename]],
        notebookId,
        [2],
        [1, null, null, null, null, null, null, null, null, null, [1]]
    ];
    
    const registerResult = await sendBatchExecute(registerRpcId, registerParams);
    
    // Extraire le SOURCE_ID de la réponse (structure imbriquée: [[[[id]]]] ou similaire)
    const sourceId = extractFirstString(registerResult);
    if (!sourceId) {
        throw new Error("Échec enregistrement source: impossible d'obtenir SOURCE_ID. Réponse: " + JSON.stringify(registerResult).substring(0, 500));
    }
    console.log(`[NotebookLM RPC] Étape 1 ✅ SOURCE_ID obtenu: ${sourceId.substring(0, 20)}...`);

    // ╔════════════════════════════════════════════════════════╗
    // ║ ÉTAPE 2 : Démarrer le upload resumable                ║
    // ║ POST https://notebooklm.google.com/upload/_/          ║
    // ║ Headers: x-goog-upload-command: start                 ║
    // ╚════════════════════════════════════════════════════════╝
    const uploadStartUrl = "https://notebooklm.google.com/upload/_/?authuser=0";
    
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
            'x-goog-authuser': '0',
            'x-goog-upload-command': 'start',
            'x-goog-upload-header-content-length': String(fileSize),
            'x-goog-upload-protocol': 'resumable'
        },
        body: startBody
    });
    
    if (!startResponse.ok) {
        throw new Error(`Échec démarrage upload: HTTP ${startResponse.status}`);
    }
    
    const uploadUrl = startResponse.headers.get('x-goog-upload-url');
    if (!uploadUrl) {
        throw new Error("Échec: pas de x-goog-upload-url dans la réponse du serveur.");
    }
    console.log(`[NotebookLM RPC] Étape 2 ✅ Upload URL obtenue.`);

    // ╔════════════════════════════════════════════════════════╗
    // ║ ÉTAPE 3 : Upload du fichier + finalize                ║
    // ║ POST vers l'upload URL obtenue à l'étape 2            ║
    // ║ Headers: x-goog-upload-command: upload, finalize      ║
    // ╚════════════════════════════════════════════════════════╝
    const finalizeResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
            'Accept': '*/*',
            'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
            'Cookie': data.nblm_personal_cookie,
            'Origin': 'https://notebooklm.google.com',
            'Referer': 'https://notebooklm.google.com/',
            'x-goog-authuser': '0',
            'x-goog-upload-command': 'upload, finalize',
            'x-goog-upload-offset': '0'
        },
        body: pdfBlob
    });
    
    if (!finalizeResponse.ok) {
        throw new Error(`Échec upload fichier: HTTP ${finalizeResponse.status}`);
    }
    
    console.log(`[NotebookLM RPC] Étape 3 ✅ Fichier uploadé et finalisé !`);
    return true;
}

/**
 * Utilitaire : extraire la première string d'une structure imbriquée
 * (Pour parser le SOURCE_ID depuis [[[[id]]]] ou [[[id]]] etc.)
 */
function extractFirstString(data) {
    if (typeof data === 'string') return data;
    if (Array.isArray(data) && data.length > 0) {
        return extractFirstString(data[0]);
    }
    return null;
}

