# bizual.ai

Landing page de Bizual.ai. Diseñado para servir tanto en **modo estático** (Apache/LiteSpeed sirve `index.html` directo) como en **modo Node.js** (Express via `server.js`). Despliega en cualquier hosting compartido o cloud sin cambios.

## Estructura (landing v2 · mayo 2026)
```
.
├── index.html              # Home — Sala de Ventas 3D
├── sales.html              # Bizual Sales (incluye FAQ + FAQPage schema)
├── assets.html             # Bizual Assets + caso Edificio Parqtec (mockups, sin pricing)
├── contacto.html           # Formulario → POST /api/contact (HubSpot)
├── privacidad.html         # Política de privacidad (generada desde Privacy_bizual.ai.md)
├── terminos.html           # Términos (generado desde TOS_bizual.ai.md)
├── llms.txt                # AEO/LLMO — resumen para motores de respuesta
├── llms-full.txt           # AEO/LLMO — contenido extendido
├── robots.txt              # incluye GPTBot, ClaudeBot, PerplexityBot, etc.
├── sitemap.xml
├── og-image.jpg            # 1200×630
├── css/styles.css          # design system (vanilla CSS)
├── js/main.js              # vanilla JS (nav, smooth scroll, form, analytics hooks)
├── img/                    # logos (svg + png/webp) + og-image source
├── .htaccess               # Apache/LiteSpeed (HTTPS, cache, extensionless URLs, security)
├── server.js               # Express (modo Node.js): rutas /llms.txt, static extensionless
├── package.json
└── .gitignore
```

### Rutas extensionless
Tanto `server.js` (vía `express.static({extensions:['html']})`) como `.htaccess`
sirven `/sales`, `/assets`, `/contacto`, etc. sin la extensión `.html`.

### AEO / LLMO
- `llms.txt` y `llms-full.txt` se sirven como `text/plain; charset=utf-8`.
- Cada página inyecta JSON-LD (`Organization`, `SoftwareApplication`, `FAQPage`,
  `BreadcrumbList`, `WebSite`, `SpeakableSpecification`) minificado.
- Emails visibles usan la entidad `&#64;`; en JSON-LD usan `@` (válido + sin `@` literal).

### Notas de contenido
- Sin pricing público (modelo comercial explicado, sin cifras).
- Integraciones con CRM marcadas como “Pronto”.
- El caso Edificio Parqtec usa mockups HTML/CSS (no muestra precios del cliente).
- Las imágenes hero/Parqtec son placeholders en CSS hasta recibir capturas reales.

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
