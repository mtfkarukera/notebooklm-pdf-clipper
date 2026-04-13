// auth_personal.js : Rétro-ingénierie d'authentification pour les comptes Google classiques

const REQUIRED_COOKIES = ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID', '__Secure-1PSID', '__Secure-3PSID'];

export async function getPersonalAuthCookies() {
  // L'URL exacte sur laquelle interroger le cookie jar de Firefox
  const cookies = await browser.cookies.getAll({ url: "https://notebooklm.google.com/" });
  
  if (cookies.length === 0) {
    throw new Error(`Aucun cookie trouvé. Veuillez vous connecter à NotebookLM dans un nouvel onglet.`);
  }

  // On concatène tous les cookies sans filtrage strict, 
  // car certains cookies secondaires peuvent manquer sans casser l'API.
  const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  
  // Stockage sécurisé en mémoire MV3 (sans log)
  await browser.storage.local.set({ nblm_personal_cookie: cookieString });
  return cookieString;
}

export async function fetchCSRFToken(cookieString, authuserIndex = 0) {
  // Le token SNlM0e est indispensable pour la signature des charges utiles batchexecute
  try {
    const response = await fetch(`https://notebooklm.google.com/?authuser=${authuserIndex}`, {
      method: 'GET',
      headers: {
         'Cookie': cookieString,
         'User-Agent': navigator.userAgent
      }
    });

    if (!response.ok) {
        if(response.status === 401 || response.status === 403) {
            await browser.storage.local.remove('nblm_personal_cookie');
            throw new Error("Session NotebookLM expirée (HTTP 401/403).")
        }
        throw new Error(`HTTP Error ${response.status}`);
    }

    const html = await response.text();
    
    // Rétro-ingénierie : Capter la variable SNlM0e dynamique
    const match = html.match(/"SNlM0e":"([^"]+)"/);
    if (match && match[1]) {
      const csrfToken = match[1];
      await browser.storage.local.set({ nblm_csrf: csrfToken });
      return csrfToken;
    } else {
      throw new Error("Token CSRF SNlM0e introuvable sur la page.");
    }
  } catch (error) {
    throw error;
  }
}

export async function detectGoogleAccounts(cookieString) {
  const accounts = [];
  const maxAccounts = 5; // On ne scanne pas à l'infini

  for (let i = 0; i < maxAccounts; i++) {
    try {
      const response = await fetch(`https://notebooklm.google.com/?authuser=${i}`, {
        method: 'GET',
        headers: { 'Cookie': cookieString }
      });

      // Si Google nous redirige vers la page de login, ce compte n'existe pas ou n'est pas connecté
      if (response.url.includes('accounts.google.com') || response.url.includes('ServiceLogin')) {
        break; 
      }
      
      if (!response.ok) break;

      const html = await response.text();
      
      // Extraction de l'email. Google le place souvent dans le WIZ_global_data
      // On cherche un format typique d'email encadré par des guillemets
      const emailMatch = html.match(/"([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})"/);
      
      if (emailMatch && emailMatch[1]) {
        accounts.push({ index: i, email: emailMatch[1] });
      } else {
        // En secours si la regex échoue mais que la page a chargé (session valide)
        accounts.push({ index: i, email: `Compte ${i+1} (Index ${i})` });
      }
    } catch (err) {
      console.warn(`[Multi-Account] Arrêt de la détection à l'index ${i}`, err);
      break;
    }
  }

  return accounts;
}
