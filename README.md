# HAMAYNI Engine v3.1 - Infrastructure Contract Platform

HAMAYNI est une plateforme industrielle d'exécution d'infrastructure basée sur le standard **HFC (HAMAYNI Final Contract)**. Elle transforme des templates déclaratifs en scripts Bash exécutables, signés et vérifiables.

## Architecture

Le système HAMAYNI comprend 4 composants principaux :

### 1. Database (PostgreSQL via Supabase)
- Tables : `profiles`, `servers`, `template_canons`, `intentions`, `contracts`, `contract_executions`
- RLS activé sur toutes les tables
- Fonction `check_server_health()` pour surveiller les serveurs

### 2. Edge Functions

#### `hamayni-factory`
Forge des contrats HFC à partir de templates et d'inputs utilisateur.

**Endpoint:** `POST /functions/v1/hamayni-factory`

**Request:**
```json
{
  "template_slug": "hamayni.nginx.standalone",
  "inputs": {
    "domain": "example.com"
  }
}
```

**Response:**
```json
{
  "contract_id": "uuid",
  "integrity_hash": "sha256-...",
  "compiled_script": "#!/bin/bash...",
  "hfc_json": { ... },
  "status": "success"
}
```

#### `hamayni-runner-api`
API pour la communication entre les runners et la plateforme.

**Endpoints:**
- `POST /heartbeat` - Mise à jour du statut du serveur
- `POST /claim` - Réclamation d'un contrat en attente
- `POST /report` - Rapport d'exécution
- `GET /status` - Health check

#### `runner-install`
Génère un script d'installation pour configurer un serveur comme runner.

**Endpoint:** `GET /functions/v1/runner-install?token=SERVER_TOKEN`

### 3. Frontend (React + TypeScript)
Interface web pour :
- Forger des contrats (Factory)
- Gérer les serveurs (Servers)
- Suivre les contrats (Contracts)

### 4. Runner (Bash Script)
Script installé sur les serveurs pour :
- Envoyer des heartbeats toutes les 60 secondes
- Réclamer des contrats toutes les 5 secondes
- Exécuter les scripts Bash compilés
- Reporter les résultats

## Installation

### 1. Configuration de l'environnement

Créez un fichier `.env` à la racine du projet :

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 2. Installation des dépendances

```bash
npm install
```

### 3. Démarrage du serveur de développement

```bash
npm run dev
```

## Utilisation

### Étape 1 : Authentification

1. Créez un compte via l'interface web
2. Connectez-vous avec vos identifiants

### Étape 2 : Forger un contrat

1. Allez dans l'onglet **Factory**
2. Entrez un nom de domaine (ex: `example.com`)
3. Cliquez sur **Forge Contract**
4. Le contrat HFC et le script Bash sont générés
5. Vous pouvez télécharger ou copier le script

### Étape 3 : Créer un serveur

1. Allez dans l'onglet **Servers**
2. Cliquez sur **Add Server**
3. Entrez un nom pour votre serveur
4. Cliquez sur **Copy Install Command**
5. Exécutez cette commande sur votre serveur (Ubuntu/Debian)

```bash
curl -sSL "https://your-project.supabase.co/functions/v1/runner-install?token=YOUR_TOKEN" | sudo bash
```

### Étape 4 : Assigner un contrat

1. Allez dans l'onglet **Contracts**
2. Pour un contrat en statut **PENDING**, sélectionnez un serveur dans le menu déroulant
3. Le runner va automatiquement réclamer et exécuter le contrat
4. Le statut passera à **CLAIMED** puis **SUCCESS** ou **FAILED**

## Format HFC

Le format HFC (HAMAYNI Final Contract) comprend 5 sections :

### 1. Header
Métadonnées du contrat (ID, version, template, timestamps)

### 2. Gates
Vérifications préalables à l'exécution (OS, ports, fichiers, etc.)

### 3. BOM (Bill of Materials)
Fichiers à déployer sur le serveur

### 4. Operations
Commandes à exécuter (ordonnées)

### 5. Proofs
Hash d'intégrité SHA-256 et signature HMAC-SHA256

## Template Nginx Inclus

Un template de démonstration est inclus : `hamayni.nginx.standalone`

**Variables :**
- `domain` : Nom de domaine pour la configuration Nginx

**Actions :**
- Vérifie que le système est Ubuntu/Debian
- Vérifie que le port 80 est libre
- Installe Nginx
- Déploie une configuration personnalisée
- Crée une page d'accueil HTML
- Démarre et active le service Nginx

## Sécurité

- RLS activé sur toutes les tables
- Authentification JWT pour la Factory
- Token UUID pour l'authentification des runners
- Signatures HMAC-SHA256 pour l'intégrité des contrats
- Hash SHA-256 pour la vérification

## Commandes Utiles

### Voir les logs du runner
```bash
journalctl -u hamayni-runner -f
```

### Statut du runner
```bash
systemctl status hamayni-runner
```

### Redémarrer le runner
```bash
systemctl restart hamayni-runner
```

### Logs des contrats
```bash
ls -la /var/log/hamayni/
cat /var/log/hamayni/CONTRACT_ID.log
```

## Flux d'Exécution

```
1. FORGE (Factory)
   Template + Inputs → HFC JSON + Bash Script → DB (status: PENDING)

2. ASSIGNATION
   L'utilisateur assigne le contrat à un serveur

3. CLAIM (Runner)
   Le runner réclame le contrat → status: CLAIMED

4. EXECUTION (Runner)
   Le script Bash est exécuté (Gates → BOM → Operations)

5. REPORT (Runner)
   Le résultat est envoyé → status: SUCCESS ou FAILED
```

## Technologies

- **Backend:** Supabase (PostgreSQL + Edge Functions)
- **Frontend:** React + TypeScript + Tailwind CSS
- **Runtime:** Deno (Edge Functions)
- **Infrastructure:** Bash + systemd

## Structure du Projet

```
project/
├── src/
│   ├── components/
│   │   ├── AuthForm.tsx
│   │   ├── Dashboard.tsx
│   │   ├── Factory.tsx
│   │   ├── Servers.tsx
│   │   └── Contracts.tsx
│   ├── lib/
│   │   └── supabase.ts
│   └── App.tsx
├── supabase/
│   └── functions/
│       ├── hamayni-factory/
│       ├── hamayni-runner-api/
│       └── runner-install/
└── README.md
```

## Licence

Projet HAMAYNI - Infrastructure Contract Engine v3.1
