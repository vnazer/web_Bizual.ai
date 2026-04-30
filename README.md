# bizual.ai

Landing page de Bizual.ai. Diseñado para servir tanto en **modo estático** (Apache/LiteSpeed sirve `index.html` directo) como en **modo Node.js** (Express via `server.js`). Despliega en cualquier hosting compartido o cloud sin cambios.

## Estructura
```
.
├── index.html              # landing principal (root para Apache static serving)
├── bizual-landing-v6.html  # versión completa
├── .htaccess               # Apache/LiteSpeed config (HTTPS, cache, security)
├── server.js               # Express server (modo Node.js opcional)
├── package.json
└── .gitignore
```

## Local
```bash
npm install
npm start
# http://localhost:3000
```

## Deploy en Hostinger

### Opción A — Estático (cualquier plan, lo más simple)
El `index.html` está en la raíz, el `.htaccess` maneja routing. Apache/LiteSpeed lo sirve directo.

1. **hPanel → Sitios web → bizual.ai → Avanzado → GIT**
2. Repo: `https://github.com/vnazer/web_Bizual.ai.git`, rama `main`, directorio en blanco
3. Crear

### Opción B — Node.js (plan Cloud / Business / VPS)
1. Mismo paso 1-3 que arriba
2. **hPanel → Avanzado → Node.js**
3. Crear app: Node 18+, root `/`, URL `bizual.ai`, startup `server.js`
4. **Run NPM Install** → **Start App**

### Auto-deploy en cada push
- Copia la webhook URL del panel Git de Hostinger
- GitHub repo → Settings → Webhooks → Add webhook → pega URL, content type `application/json`, evento `push`
