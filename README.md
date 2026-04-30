# bizual.ai

Landing page de Bizual.ai — servida con Express (Node.js 18+).

## Local
```bash
npm install
npm start
# http://localhost:3000
```

## Estructura
```
.
├── public/
│   ├── index.html          # landing principal
│   └── bizual-landing-v6.html
├── server.js               # Express + compression + cache headers
├── package.json
└── .gitignore
```

## Deploy en Hostinger (Git auto-deploy)

1. **hPanel → Sitios web → bizual.ai → Avanzado → GIT**
2. Clic en **Crear nuevo repositorio**:
   - Repositorio: `https://github.com/vnazer/web_Bizual.ai.git`
   - Rama: `main`
   - Ruta: `/` (raíz del dominio) o `public_html`
3. Clic en **Crear**. Hostinger clona el repo.

### Activar Node.js (plan Cloud / Business / VPS)
4. **hPanel → Avanzado → Node.js**
5. Crea aplicación:
   - Versión: 18.x o superior
   - Application root: `/` (donde está `server.js`)
   - Application URL: `bizual.ai`
   - Startup file: `server.js`
6. **Run NPM Install** → **Start App**.

### Auto-deploy en cada push
7. En el panel Git de Hostinger, copia la **Webhook URL**.
8. GitHub → repo → **Settings → Webhooks → Add webhook**:
   - Payload URL: la webhook URL de Hostinger
   - Content type: `application/json`
   - Eventos: `Just the push event`
9. Save. Cada `git push` a `main` redeploya automático.

## Deploy estático (plan compartido sin Node.js)
Si tu plan no soporta Node.js, basta con que la ruta del repo apunte a `public_html` y Hostinger servirá `index.html` directamente. Ignora los pasos 4-6.
