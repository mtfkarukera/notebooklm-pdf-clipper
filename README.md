# 📎 NotebookLM Web Clipper — Extension Firefox MV3

Capturez le contenu de n'importe quelle page web et importez-le directement dans un carnet **Google NotebookLM** — en **PDF**, **Markdown**, **URL directe**, **Screenshot**, **Import Direct** ou **Sélection de texte**. Compatible **Firefox Desktop et Android**. Optimisé pour l'analyse par Gemini (grounding IA intégré).

---

## ✨ Fonctionnalités

| Fonctionnalité | Description |
|---|---|
| **6 modes d'import** | 📄 PDF, 📝 Markdown, 🔗 URL, 📸 Screenshot, ⚡ Import Direct, 📋 Sélection |
| **📸 Screenshot** | Capture le viewport visible en PNG via `captureVisibleTab()` |
| **⚡ Import Direct** | Détecte et importe ~50 types de fichiers (PDF, images, audio, vidéo, documents) |
| **📋 Clip de sélection** | Clic droit → « 📎 Clipper la sélection » → import du texte sélectionné |
| **Extraction Readability** | Contenu principal uniquement via [Readability.js](https://github.com/mozilla/readability) |
| **Images haute fidélité** | Data URIs + proxy CORS intégrés au PDF via `addImage()` |
| **Tables pipe-delimited** | En mode Markdown, tables parfaitement structurées pour Gemini |
| **Import URL natif** | NotebookLM scrape la page lui-même — zéro traitement client |
| **Grounding IA** | Titre, auteur, site, URL et date injectés dans les métadonnées |
| **Upload resumable** | Protocole Google 3 étapes (register → start → finalize) |
| **Téléchargement local** | Bouton "Télécharger ↓" après import (.pdf ou .md) |
| **Création de carnets** | Créez un nouveau carnet directement depuis l'extension |
| **Fast Research** | Barre de recherche avec debounce (300ms) |
| **Matrice de visibilité** | Boutons grisés automatiquement selon le type de fichier détecté |
| **Multi-comptes** | Sélecteur de compte Google intégré dans la popup |
| **Notification OS** | Notification système si la popup est fermée pendant l'import |
| **Compatible Mobile** | Firefox Android : popup responsive, touch targets 48dp, détection plateforme |

### Comparaison des 6 modes

| Critère | 📄 PDF | 📝 Markdown | 🔗 URL | 📸 Screenshot | ⚡ Direct | 📋 Sélection |
|---|---|---|---|---|---|---|
| **Vitesse** | ~3-5s | ~0.5s | **~0.1s** | ~1s | ~1-3s | ~0.5s |
| **Tables** | ❌ | ✅ Pipe-delimited | ✅ Scraping | ❌ Image | ❌ | ✅ Texte brut |
| **Images** | ✅ Data URI | ❌ | ✅ Scraping | ✅ Viewport | ✅ Original | ❌ |
| **Pages protégées** | ✅ | ✅ | ❌ Paywall | ✅ | ✅ | ✅ |
| **Téléchargement** | ✅ .pdf | ✅ .md | ❌ | ❌ | ❌ | ❌ |
| **Fichiers binaires** | ❌ | ❌ | ❌ | ❌ | ✅ ~50 formats | ❌ |

### ⚡ Formats supportés par l'Import Direct

L'Import Direct détecte automatiquement le type de fichier (via l'extension URL + `HEAD` request) et l'importe tel quel dans NotebookLM :

| Catégorie | Formats |
|---|---|
| **Documents** | PDF, TXT, MD, DOCX, CSV, PPTX, EPUB |
| **Images** | PNG, JPEG, GIF, BMP, WebP, AVIF, TIFF, ICO, JP2, HEIC, HEIF |
| **Audio** | MP3, WAV, OGG, AAC, M4A, AIFF, MIDI, OPUS, AMR, WMA, RA, AU |
| **Vidéo** | MP4, MPEG, AVI, 3GP, 3G2 |

### 📋 Clip de sélection (menu contextuel)

Sélectionnez du texte sur n'importe quelle page, faites un clic droit → **« 📎 Clipper la sélection dans NotebookLM »**. Le texte est capturé avec son formatage HTML, et la popup s'ouvre pour choisir le carnet cible. Les métadonnées de grounding (URL source, titre, date) sont automatiquement injectées.

---

## 🏗️ Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│   Popup (UI)    │────▶│  Background.js   │────▶│  NotebookLM API     │
│  popup.html/js  │     │  (Event Page)    │     │  /batchexecute      │
│  6 modes import │     │  Routeur central │     │  /upload/_/         │
│  Toggle format  │     │  CORS proxy img  │     │                     │
│  Sélection clip │     │  Context menu    │     │                     │
└─────────────────┘     └──────┬───────────┘     └─────────────────────┘
                               │
                        ┌──────▼───────────┐
                        │  Content Script  │
                        │  orchestrator.js │  ← Route PDF/MD + GET_SELECTION_HTML
                        │  serializer.js   │  ← Readability + data URIs
                        │  pdf_generator.js│  ← jsPDF + addImage
                        │  md_generator.js │  ← Markdown pipe-delimited
                        └──────────────────┘
```

### 6 pipelines d'import

| Mode | Pipeline | RPC |
|---|---|---|
| **📄 PDF** | Content Script → Serializer → jsPDF → Upload resumable 3 étapes | `o4cbdc` + upload |
| **📝 Markdown** | Content Script → Serializer → MD Generator → RPC texte direct | `izAoDd` (Text) |
| **🔗 URL** | Zéro content script → URL de l'onglet envoyée directement | `izAoDd` (URL) |
| **📸 Screenshot** | `captureVisibleTab()` → PNG Blob → Upload resumable | upload |
| **⚡ Direct** | Détection MIME → `fetch()` binaire → Upload resumable | upload |
| **📋 Sélection** | Menu contextuel → `GET_SELECTION_HTML` → `addTextSource` | `izAoDd` (Text) |

### Matrice de visibilité dynamique

Quand un fichier est détecté (ex: image, audio), les boutons non pertinents sont automatiquement grisés :

| Type détecté | PDF | MD | URL | 📸 | ⚡ Direct |
|---|---|---|---|---|---|
| **Page web** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Document (PDF, DOCX...)** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Image** | ❌ | ❌ | ✅ | ✅ | ✅ |
| **Audio / Vidéo** | ❌ | ❌ | ✅ | ❌ | ✅ |
| **Fichier local (file://)** | ❌ | ❌ | ❌ | ❌ | ❌ |

### Double authentification

| Type de compte | Méthode | Module |
|---|---|---|
| **Personnel** | Extraction cookies (`SID`, `HSID`, `SSID`) + CSRF | `auth_personal.js` + `rpc_client.js` |
| **Workspace** | OAuth 2.0 + API Discovery Engine | `auth_workspace.js` |

> 🔒 **Sécurité** : Cookies/jetons jamais exposés. `browser.storage.local` purgé automatiquement en cas d'erreur 401/403. DOM 100% sécurisé (zéro `innerHTML`).

---

## 🚀 Installation

### ⚠️ Prérequis

Avant d'utiliser l'extension, **chaque compte Google** que vous souhaitez utiliser doit avoir été connecté à NotebookLM au moins une fois :

1. Rendez-vous sur **[notebooklm.google.com](https://notebooklm.google.com/)**
2. Connectez-vous avec le compte Google souhaité
3. Attendez que la page d'accueil de NotebookLM se charge (la liste de vos carnets doit s'afficher)

> 💡 **Pourquoi ?** L'extension détecte vos comptes en interrogeant les cookies de session NotebookLM. Si vous ne vous êtes jamais connecté à NotebookLM avec un compte, aucun cookie ne sera présent et le compte sera invisible pour l'extension. Se connecter simplement à Google (Gmail, Drive, etc.) ne suffit pas.

> 🔄 **Multi-comptes** : Si vous utilisez plusieurs comptes Google dans le même navigateur, répétez cette opération pour chacun d'eux. L'extension proposera alors un menu déroulant pour choisir le compte cible.

### Méthode 1 : Depuis le fichier XPI signé

1. Télécharger le fichier `.xpi` depuis `dist/`
2. Firefox → `about:addons` → ⚙️ → **"Installer un module depuis un fichier..."**

> ⚠️ XPI non signé : `about:config` → `xpinstall.signatures.required` = `false`

### Méthode 2 : Chargement temporaire

1. Firefox → `about:debugging` → **Ce Firefox**
2. **"Charger un module complémentaire temporaire..."** → sélectionner `manifest.json`

> Après modification : "Recharger" dans `about:debugging` + F5 sur la page cible.

### Méthode 3 : Via `web-ext`

```bash
npm install -g web-ext
cd ~/Scripts/notebooklm-pdf-clipper
web-ext run
```

---

## 📦 Signature et distribution

```bash
brew install node
npm install -g web-ext
# Clés API : https://addons.mozilla.org/developers/addon/api/key/
./sign.sh VOTRE_JWT_ISSUER VOTRE_JWT_SECRET
```

---

## 📁 Structure du projet

```
notebooklm-pdf-clipper/
├── manifest.json                   # Manifest V3 Firefox (Event Page)
├── lib/
│   ├── jspdf.umd.min.js           # jsPDF 2.5.2 standalone
│   └── Readability.js             # Mozilla Readability.js
├── src/
│   ├── background/
│   │   ├── background.js           # Routeur central + 6 pipelines + menu contextuel
│   │   └── api/
│   │       ├── auth_personal.js    # Extraction cookies + CSRF
│   │       ├── auth_workspace.js   # OAuth 2.0 Discovery Engine
│   │       └── rpc_client.js       # batchexecute + upload + addText + addUrl
│   ├── content/
│   │   ├── orchestrator.js         # Point d'entrée (route PDF/MD + GET_SELECTION_HTML)
│   │   ├── serializer.js           # Readability + Reader Mode CSS + data URIs
│   │   ├── pdf_generator.js        # jsPDF (texte + images + tables)
│   │   └── md_generator.js         # Markdown (tables pipe-delimited)
│   ├── popup/
│   │   ├── popup.html              # Interface avec toggle 6 formats + bandeau sélection
│   │   ├── popup.css               # Design Glassmorphism
│   │   └── popup.js                # Logique UI + toggle + détection + sélection
│   └── shared/
│       └── utils.js                # Utilitaires (blobToBase64)
├── dist/                           # XPI empaquetés
├── sign.sh                         # Script de signature AMO
└── .gitignore
```

---

## ⚙️ Décisions techniques clés

| Problème | Solution |
|---|---|
| `html2canvas` → `SecurityError` en MV3 | **jsPDF direct** avec rendu manuel |
| Images cross-origin | **Tainted Canvas Protection** : proxy CORS background → data URIs |
| Pages polluées | **Readability.js** extrait le contenu principal |
| Tables mal rendues par NBLM | **Mode Markdown** avec tables pipe-delimited |
| Pages publiques simples | **Mode URL** : NotebookLM scrape la page lui-même |
| Capture visuelle exacte | **`captureVisibleTab()`** → PNG → upload resumable |
| Fichiers binaires (PDF, audio, vidéo...) | **Import Direct** : détection MIME + `fetch()` + upload resumable |
| Texte sélectionné | **Menu contextuel** → `GET_SELECTION_HTML` → `addTextSource` |
| CORS sur API NotebookLM | `fetch()` dans le **background script** (exempt CORS) |
| Firefox ne supporte pas `service_worker` | `background.scripts` + `"type": "module"` |
| Upload PDF ignoré | **Protocole resumable** 3 étapes |
| Popup ferme le file picker | Fichiers locaux (`file://`) non supportés (restriction navigateur) |

---

## 📝 Crédits et références

- **[notebooklm-py](https://github.com/teng-lin/notebooklm-py)** — Rétro-ingénierie API RPC NotebookLM
- **[jsPDF](https://github.com/parallax/jsPDF)** — Génération PDF côté client
- **[Readability.js](https://github.com/mozilla/readability)** — Extraction contenu principal
- **Mozilla WebExtensions** — [Documentation MV3](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)

---

*Projet développé selon la méthodologie **Spec-Driven Development (SDD)**.*
*Version 4.3.5 — Avril 2026*
