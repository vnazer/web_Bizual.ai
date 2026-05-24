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

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    hubspot: HUBSPOT_TOKEN ? 'configured' : 'missing_token'
  });
});

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

async function findOrCreateContact({ email, firstname, lastname, company, phone, source, producto }) {
  // Search existing contact by email
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
  if (producto) properties.bizual_tipo_plan = producto;

  if (search.total > 0 && search.results[0]) {
    const id = search.results[0].id;
    // Update with latest info
    await hubspotFetch(`/crm/v3/objects/contacts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties })
    });
    return { id, created: false };
  }

  // Create new
  const created = await hubspotFetch('/crm/v3/objects/contacts', {
    method: 'POST',
    body: JSON.stringify({ properties })
  });
  return { id: created.id, created: true };
}

async function createDeal({ contactId, companyName, producto, mensaje }) {
  const dealName = `Demo Bizual — ${companyName || 'Lead web'}`;
  const properties = {
    dealname: dealName,
    pipeline: HUBSPOT_PIPELINE,
    dealstage: HUBSPOT_DEALSTAGE,
    hubspot_owner_id: HUBSPOT_OWNER_ID,
    description: mensaje || ''
  };
  if (producto) properties.bizual_tipo_plan = producto;

  const deal = await hubspotFetch('/crm/v3/objects/deals', {
    method: 'POST',
    body: JSON.stringify({
      properties,
      associations: [{
        to: { id: contactId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] // contact-to-deal
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
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] // note-to-contact
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

    // Split name
    const parts = nombre.trim().split(/\s+/);
    const firstname = parts.shift() || '';
    const lastname = parts.join(' ') || '';

    // 1. Contact (find or create)
    const contact = await findOrCreateContact({
      email: email.trim().toLowerCase(),
      firstname, lastname,
      company: empresa.trim(),
      phone: telefono.trim(),
      source: 'website_form',
      producto
    });

    // 2. Deal
    const deal = await createDeal({
      contactId: contact.id,
      companyName: empresa.trim(),
      producto,
      mensaje
    });

    // 3. Note with full message
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
    console.error('[/api/contact] error:', err.message, err.body || '');
    res.status(500).json({ ok: false, error: err.message || 'server_error' });
  }
});

// --- llms.txt / llms-full.txt (text/plain; charset=utf-8) -----------------

app.get('/llms.txt', (req, res) => {
  res.type('text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(__dirname, 'llms.txt'));
});
app.get('/llms-full.txt', (req, res) => {
  res.type('text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(__dirname, 'llms-full.txt'));
});

// --- Static (extensionless routing: /sales -> sales.html) -----------------

app.use(express.static(__dirname, {
  index: 'index.html',
  extensions: ['html'],
  maxAge: '1h',
  etag: true,
  lastModified: true,
  dotfiles: 'ignore',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    } else if (/\.(webp|png|jpe?g|svg|gif|ico)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000'); // 30 días
    }
  }
}));

// --- Fallback: unknown routes -> home -------------------------------------

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'not_found' });
  res.status(404).sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`bizual.ai listening on http://${HOST}:${PORT}`);
  console.log(`HubSpot: ${HUBSPOT_TOKEN ? 'configured' : 'NOT configured (set HUBSPOT_TOKEN)'}`);
});
