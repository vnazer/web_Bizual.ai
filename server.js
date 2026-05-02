const express = require('express');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// HubSpot config — set HUBSPOT_TOKEN as env var on Hostinger
const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
const HUBSPOT_OWNER_ID = process.env.HUBSPOT_OWNER_ID || '1198267650'; // Victor Nazer
const HUBSPOT_PIPELINE = process.env.HUBSPOT_PIPELINE || 'default';
const HUBSPOT_DEALSTAGE = process.env.HUBSPOT_DEALSTAGE || 'appointmentscheduled';

app.set('trust proxy', 1);
app.use(compression());
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// Rate limit form submission: 5 reqs / 10 min per IP
const contactLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'too_many_requests' }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    hubspot: HUBSPOT_TOKEN ? 'configured' : 'missing_token'
  });
});

// --- Map form values to HubSpot dropdown internal values ------------------

function mapProductoToHubspot(producto) {
  if (!producto) return null;
  const p = producto.toLowerCase().trim();

  // Direct matches (matching exact HubSpot internal values)
  if (p === 'bizual sales') return 'Bizual Sales';
  if (p === 'bizual assets' || p === 'bizual asset') return 'Bizual Assets';

  // Heuristic matching for other form values
  if (p.includes('sales') || p.includes('venta') || p.includes('vender')) {
    return 'Bizual Sales';
  }
  if (p.includes('asset') || p.includes('arriendo') || p.includes('gesti') || p.includes('activo')) {
    return 'Bizual Assets';
  }

  // "Ambos productos" or "Estoy evaluando" → default to Sales (más común)
  return 'Bizual Sales';
}

// --- HubSpot helpers -------------------------------------------------------

async function hubspotFetch(path, init = {}) {
  if (!HUBSPOT_TOKEN) throw new Error('hubspot_token_not_configured');
  const res = await fetch(`https://api.hubapi.com${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  if (!res.ok) {
    const err = new Error(`hubspot_${res.status}`);
    err.status = res.status;
    err.body = json || text;
    throw err;
  }
  return json;
}

async function findOrCreateContact({ email, firstname, lastname, company, phone, source }) {
  const search = await hubspotFetch('/crm/v3/objects/contacts/search', {
    method: 'POST',
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
      properties: ['email', 'firstname', 'lastname', 'company', 'phone'],
      limit: 1
    })
  });

  const properties = {
    email,
    firstname: firstname || '',
    lastname: lastname || '',
    company: company || '',
    phone: phone || '',
    lifecyclestage: 'lead',
    hs_lead_status: 'NEW'
  };
  if (source) properties.hs_analytics_source = 'OFFLINE';
  // bizual_tipo_plan no longer set on Contact (now lives on Deal)

  if (search.total > 0 && search.results[0]) {
    const id = search.results[0].id;
    await hubspotFetch(`/crm/v3/objects/contacts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties })
    });
    return { id, created: false };
  }

  const created = await hubspotFetch('/crm/v3/objects/contacts', {
    method: 'POST',
    body: JSON.stringify({ properties })
  });
  return { id: created.id, created: true };
}

async function createDeal({ contactId, companyName, producto, mensaje }) {
  const dealName = `Demo Bizual — ${companyName || 'Lead web'}`;

  // Build description with original producto value (form label, not HubSpot value)
  const descriptionParts = [];
  if (producto) descriptionParts.push(`Producto solicitado: ${producto}`);
  if (mensaje) descriptionParts.push(mensaje);
  const description = descriptionParts.join('\n\n');

  const properties = {
    dealname: dealName,
    pipeline: HUBSPOT_PIPELINE,
    dealstage: HUBSPOT_DEALSTAGE,
    hubspot_owner_id: HUBSPOT_OWNER_ID,
    description
  };

  // Map form value to valid HubSpot dropdown option
  const mappedProducto = mapProductoToHubspot(producto);
  if (mappedProducto) {
    properties.bizual_tipo_plan = mappedProducto;
  }

  const deal = await hubspotFetch('/crm/v3/objects/deals', {
    method: 'POST',
    body: JSON.stringify({
      properties,
      associations: [{
        to: { id: contactId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }]
      }]
    })
  });
  return { id: deal.id };
}

async function addNoteToContact({ contactId, body }) {
  if (!body) return null;
  return hubspotFetch('/crm/v3/objects/notes', {
    method: 'POST',
    body: JSON.stringify({
      properties: {
        hs_note_body: body,
        hs_timestamp: Date.now()
      },
      associations: [{
        to: { id: contactId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }]
      }]
    })
  });
}

// --- POST /api/contact ----------------------------------------------------

app.post('/api/contact', contactLimiter, async (req, res) => {
  try {
    const {
      nombre = '', empresa = '', email = '', telefono = '',
      producto = '', mensaje = '', consentimiento, hp_field
    } = req.body || {};

    // Honeypot anti-spam
    if (hp_field) return res.json({ ok: true, queued: true });

    // Validation
    const errors = [];
    if (!nombre.trim()) errors.push('nombre');
    if (!empresa.trim()) errors.push('empresa');
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('email');
    if (!producto.trim()) errors.push('producto');
    if (!mensaje.trim()) errors.push('mensaje');
    if (!consentimiento) errors.push('consentimiento');
    if (errors.length) return res.status(400).json({ ok: false, error: 'validation', fields: errors });

    if (!HUBSPOT_TOKEN) {
      console.warn('[/api/contact] missing HUBSPOT_TOKEN — payload:', { nombre, empresa, email, producto });
      return res.status(503).json({ ok: false, error: 'hubspot_not_configured' });
    }

    const parts = nombre.trim().split(/\s+/);
    const firstname = parts.shift() || '';
    const lastname = parts.join(' ') || '';

    // 1. Find or create Contact (without bizual_tipo_plan)
    const contact = await findOrCreateContact({
      email: email.trim().toLowerCase(),
      firstname, lastname,
      company: empresa.trim(),
      phone: telefono.trim(),
      source: 'website_form'
    });

    // 2. Create Deal (with mapped bizual_tipo_plan)
    const deal = await createDeal({
      contactId: contact.id,
      companyName: empresa.trim(),
      producto,
      mensaje
    });

    // 3. Add note to Contact with full message
    if (mensaje.trim()) {
      await addNoteToContact({
        contactId: contact.id,
        body: `<b>Mensaje desde formulario web bizual.ai</b><br><br>` +
              `<b>Producto:</b> ${producto}<br>` +
              `<b>Empresa:</b> ${empresa}<br>` +
              `<b>Teléfono:</b> ${telefono || '—'}<br><br>` +
              `<b>Mensaje:</b><br>${mensaje.replace(/\n/g, '<br>')}`
      });
    }

    res.json({
      ok: true,
      contactId: contact.id,
      dealId: deal.id,
      created: contact.created
    });

  } catch (err) {
    console.error('[/api/contact] error:', err.message);
    console.error('[/api/contact] hubspot body:', JSON.stringify(err.body, null, 2));
    res.status(500).json({
      ok: false,
      error: err.message || 'server_error',
      details: err.body || null
    });
  }
});

// --- Static + SPA fallback ------------------------------------------------

app.use(express.static(__dirname, {
  index: 'index.html',
  maxAge: '1h',
  etag: true,
  lastModified: true,
  dotfiles: 'ignore',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    }
  }
}));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'not_found' });
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`bizual.ai listening on http://${HOST}:${PORT}`);
  console.log(`HubSpot: ${HUBSPOT_TOKEN ? 'configured' : 'NOT configured (set HUBSPOT_TOKEN)'}`);
});
