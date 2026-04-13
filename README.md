# 📎 NotebookLM Web Clipper — Extension Firefox MV3

Capturez le contenu de n'importe quelle page web et importez-le directement dans un carnet **Google NotebookLM** — en **PDF**, **Markdown** ou **URL directe**. Compatible **Firefox Desktop et Android**. Optimisé pour l'analyse par Gemini (grounding IA intégré).

---

## ✨ Fonctionnalités

| Fonctionnalité | Description |
|---|---|
| **3 modes d'import** | 📄 PDF (images), 📝 Markdown (tables parfaites), 🔗 URL (instantané) |
| **Extraction Readability** | Contenu principal uniquement via [Readability.js](https://github.com/mozilla/readability) |
| **Images haute fidélité** | Data URIs + proxy CORS intégrés au PDF via `addImage()` |
| **Tables pipe-delimited** | En mode Markdown, tables parfaitement structurées pour Gemini |
| **Import URL natif** | NotebookLM scrape la page lui-même — zéro traitement client |
| **Grounding IA** | Titre, auteur, site, URL et date injectés dans les métadonnées |
| **Upload resumable** | Protocole Google 3 étapes (register → start → finalize) |
| **Téléchargement local** | Bouton "Télécharger ↓" après import (.pdf ou .md) |
| **Création de carnets** | Créez un nouveau carnet directement depuis l'extension |
| **Fast Research** | Barre de recherche avec debounce (300ms) |
| **Notification OS** | Notification système si la popup est fermée pendant l'import |
| **Compatible Mobile** | Firefox Android : popup responsive, touch targets 48dp, détection plateforme |

### Comparaison des 3 modes

| Critère | 📄 PDF | 📝 Markdown | 🔗 URL |
|---|---|---|---|
| **Vitesse** | ~3-5s | ~0.5s | **~0.1s** |
| **Tables** | ❌ Interpréteur NBLM | ✅ Pipe-delimited | ✅ Scraping NBLM |
| **Images** | ✅ Data URI | ❌ | ✅ Scraping NBLM |
| **Pages protégées** | ✅ | ✅ | ❌ Paywall bloqué |
| **Téléchargement** | ✅ .pdf | ✅ .md | ❌ |

---

## 🏗️ Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│   Popup (UI)    │────▶│  Background.js   │────▶│  NotebookLM API     │
│  popup.html/js  │     │  (Event Page)    │     │  /batchexecute      │
│  PDF/MD/URL     │     │  Routeur central │     │  /upload/_/         │
│  Toggle format  │     │  CORS proxy img  │     │                     │
└─────────────────┘     └──────┬───────────┘     └─────────────────────┘
                               │
                        ┌──────▼───────────┐
                        │  Content Script  │
                        │  orchestrator.js │
                        │  serializer.js   │  ← Readability + data URIs
                        │  pdf_generator.js│  ← jsPDF + addImage
                        │  md_generator.js │  ← Markdown pipe-delimited
                        └──────────────────┘
```

### 3 pipelines d'import

| Mode | Pipeline | RPC |
|---|---|---|
| **📄 PDF** | Content Script → Serializer → jsPDF → Upload resumable 3 étapes | `o4cbdc` + upload |
| **📝 Markdown** | Content Script → Serializer → MD Generator → RPC texte direct | `izAoDd` (Text) |
| **🔗 URL** | Zéro content script → URL de l'onglet envoyée directement | `izAoDd` (URL) |

### Double authentification

| Type de compte | Méthode | Module |
|---|---|---|
| **Personnel** | Extraction cookies (`SID`, `HSID`, `SSID`) + CSRF | `auth_personal.js` + `rpc_client.js` |
| **Workspace** | OAuth 2.0 + API Discovery Engine | `auth_workspace.js` |

> 🔒 **Sécurité** : Cookies/jetons jamais exposés. `browser.storage.local` purgé automatiquement en cas d'erreur 401/403. DOM 100% sécurisé (zéro `innerHTML`).

---

## 🚀 Installation

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
│   │   ├── background.js           # Routeur central + 3 pipelines
│   │   └── api/
│   │       ├── auth_personal.js    # Extraction cookies + CSRF
│   │       ├── auth_workspace.js   # OAuth 2.0 Discovery Engine
│   │       └── rpc_client.js       # batchexecute + upload + addText + addUrl
│   ├── content/
│   │   ├── orchestrator.js         # Point d'entrée (route PDF/MD)
│   │   ├── serializer.js           # Readability + Reader Mode CSS + data URIs
│   │   ├── pdf_generator.js        # jsPDF (texte + images + tables)
│   │   └── md_generator.js         # Markdown (tables pipe-delimited)
│   ├── popup/
│   │   ├── popup.html              # Interface avec toggle 3 formats
│   │   ├── popup.css               # Design Glassmorphism
│   │   └── popup.js                # Logique UI + toggle + téléchargement
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
| CORS sur API NotebookLM | `fetch()` dans le **background script** (exempt CORS) |
| Firefox ne supporte pas `service_worker` | `background.scripts` + `"type": "module"` |
| Upload PDF ignoré | **Protocole resumable** 3 étapes |

---

## 📝 Crédits et références

- **[notebooklm-py](https://github.com/teng-lin/notebooklm-py)** — Rétro-ingénierie API RPC NotebookLM
- **[jsPDF](https://github.com/parallax/jsPDF)** — Génération PDF côté client
- **[Readability.js](https://github.com/mozilla/readability)** — Extraction contenu principal
- **Mozilla WebExtensions** — [Documentation MV3](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)

---

*Projet développé selon la méthodologie **Spec-Driven Development (SDD)**.*
*Version 3.5.0 — Avril 2026*
