# DrPhone Backend (Render/Railway/local)

## Lancer en local
```bash
npm install
npm start
# Ouvre http://localhost:5000
# Admin : http://localhost:5000/admin  (mdp: Theodawson?)
```

## Déployer sur Render
- Create new Web Service
- Runtime: Node 18+
- Build command: `npm install`
- Start command: `npm start`
- Expose port from logs (Render détecte automatiquement)
- (Optionnel) Configurez `SESSION_SECRET` en variable d'env
