# bizual.ai

Landing page de Bizual.ai. Diseñado para servir tanto en **modo estático** (Apache/LiteSpeed sirve `index.html` directo) como en **modo Node.js** (Express via `server.js`). Despliega en cualquier hosting compartido o cloud sin cambios.

## Estructura (landing v2 · mayo 2026)

**Todo lo público vive en `public/` (lista blanca de seguridad).** El código del
servidor, los manifiestos de dependencias y los fuentes `.md` quedan FUERA de
`public/`, por lo que son inalcanzables vía web por diseño.

```
.
├── public/                 # ← WEB ROOT (lo único accesible públicamente)
│   ├── index.html          #   Home — Sala de Ventas 3D
│   ├── sales.html          #   Bizual Sales (FAQ + FAQPage schema)
│   ├── assets.html         #   Bizual Assets + caso Parqtec (mockups, sin pricing)
│   ├── contacto.html       #   Formulario → POST /api/contact (HubSpot)
│   ├── privacidad.html     #   Política de privacidad
│   ├── terminos.html       #   Términos
│   ├── llms.txt            #   AEO/LLMO — resumen para motores de respuesta
│   ├── llms-full.txt       #   AEO/LLMO — contenido extendido
│   ├── robots.txt · sitemap.xml
│   ├── og-image.jpg        #   1200×630
│   ├── css/styles.css      #   design system (vanilla CSS)
│   ├── js/main.js          #   vanilla JS (nav, smooth scroll, form, analytics)
│   ├── img/                #   logos (svg/png/webp)
│   └── .htaccess           #   config web (HTTPS, extensionless, cache, headers)
│
├── server.js               # Express — sirve SOLO public/ (modo Node.js)
├── package.json · package-lock.json
├── .htaccess               # red de seguridad (bloquea fuente/config, enruta a /public)
├── README.md
├── Privacy_bizual.ai.md · TOS_bizual.ai.md   # fuentes de las páginas legales
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

## Deploy en Hostinger (document root = `public/`)

> Importante: el sitio se sirve desde `public/`, no desde la raíz del repo.
> Si el document root queda en la raíz, la `.htaccess` raíz enruta a `/public`
> igualmente y bloquea los archivos sensibles — pero lo correcto es apuntar a `/public`.

### Opción A — Estático (cualquier plan, lo más simple)
1. **hPanel → Sitios web → bizual.ai → Avanzado → GIT**
2. Repo: `https://github.com/vnazer/web_Bizual.ai.git`, rama `main`
3. **hPanel → Avanzado → (Document root / Raíz del sitio) → apuntar a `public`**

### Opción B — Node.js (plan Cloud / Business / VPS)
1. **hPanel → Avanzado → Node.js** → Node 18+, startup `server.js`, URL `bizual.ai`
2. **Run NPM Install** → **Start App** (Express sirve `public/` automáticamente)

## Flujo de publicación controlado (nada sale en vivo sin confirmar)

La regla de oro: **`main` = producción**. Solo se publica lo que está en `main`,
y a `main` solo llega lo que TÚ apruebas. Flujo recomendado:

1. **Cada cambio va en una rama** (`feat/...`), nunca directo a `main`.
2. **Pull Request** → se revisa (Gemini + tú) y queda visible el diff completo.
3. **Recién cuando estás 100% seguro, aprietas "Merge"** en el PR.
4. **Publicación = paso deliberado:** deja el deploy de Hostinger en **manual**
   (NO conectes el webhook de auto-deploy). Tras el merge, entra a
   **hPanel → GIT → Deploy** y aprieta el botón para publicar.

Así tienes dos confirmaciones explícitas antes de que algo llegue a la web:
**(1)** apretar Merge y **(2)** apretar Deploy.

> Si prefieres auto-deploy: conéctalo SOLO a la rama `main`. Igual nada se publica
> hasta que mergeas el PR — pero pierdes el segundo botón de confirmación.

### (Opcional) Staging antes de producción
Crear un subdominio `staging.bizual.ai` apuntado a una rama `staging` para previsualizar
los cambios publicados antes de pasarlos a `main`/producción.
