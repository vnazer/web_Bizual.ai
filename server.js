const express = require('express');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { Resend } = require('resend');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// HubSpot config
const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
const HUBSPOT_OWNER_ID = process.env.HUBSPOT_OWNER_ID || '1198267650';
const HUBSPOT_PIPELINE = process.env.HUBSPOT_PIPELINE || 'default';
const HUBSPOT_DEALSTAGE = process.env.HUBSPOT_DEALSTAGE || 'appointmentscheduled';

// Resend config
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'Bizual <contacto@bizual.ai>';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'vnazer@magama.cl';
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

app.set('trust proxy', 1);
app.use(compression());
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), interest-cohort=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "frame-src 'none'",
      "frame-ancestors 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );
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
    hubspot: HUBSPOT_TOKEN ? 'configured' : 'missing_token',
    resend: RESEND_API_KEY ? 'configured' : 'missing_key'
  });
});

// --- Map form values to HubSpot dropdown internal values ------------------

function mapProductoToHubspot(producto) {
  if (!producto) return null;
  const p = producto.toLowerCase().trim();

  if (p === 'bizual sales') return 'Bizual Sales';
  if (p === 'bizual assets' || p === 'bizual asset') return 'Bizual Assets';

  if (p.includes('sales') || p.includes('venta') || p.includes('vender')) {
    return 'Bizual Sales';
  }
  if (p.includes('asset') || p.includes('arriendo') || p.includes('gesti') || p.includes('activo')) {
    return 'Bizual Assets';
  }

  return 'Bizual Sales';
}

// --- Map form values to user-facing label for emails ----------------------

function mapProductoToEmailLabel(producto) {
  if (!producto) return 'Bizual';
  const p = producto.toLowerCase().trim();

  if (p === 'bizual sales' || (p.includes('sales') && !p.includes('asset'))) {
    return 'Bizual Sales';
  }
  if (p === 'bizual assets' || p === 'bizual asset' || (p.includes('asset') && !p.includes('sales'))) {
    return 'Bizual Assets';
  }
  if (p.includes('ambos') || p.includes('evaluando') || p.includes('ayuda')) {
    return 'Bizual Sales y Assets';
  }

  return 'Bizual';
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

// --- Email helpers (Resend) -----------------------------------------------

async function sendLeadConfirmationEmail({ to, nombre, empresa, producto }) {
  if (!resend) {
    console.warn('[email] Resend not configured, skipping lead email');
    return null;
  }
  try {
    const productoLabel = mapProductoToEmailLabel(producto);

    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: [to],
      replyTo: NOTIFY_EMAIL,
      subject: `${nombre}, listo — coordinamos tu demo de Bizual`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px 20px;color:#1a1a1a;line-height:1.6;font-size:15px;">

          <div style="text-align:center;margin-bottom:24px;">
            <img src="https://bizual.ai/Logotipo_Bizual_Color.png" alt="Bizual" style="height:40px;width:auto;">
          </div>

          <h2 style="font-size:20px;font-weight:600;margin:0 0 16px;">Hola ${nombre},</h2>

          <p style="margin:0 0 14px;">
            Tu solicitud llegó perfecta. Te vamos a contactar en menos de 24 horas hábiles para agendar una sesión de 30 minutos donde te mostramos cómo Bizual puede acelerar el ciclo comercial de <b>${empresa}</b>.
          </p>

          <p style="margin:0 0 14px;">
            Producto que te interesa: <b>${productoLabel}</b>.
          </p>

          <div style="background:#F1F5F9;border-radius:8px;padding:16px 18px;margin:20px 0;">
            <p style="margin:0 0 8px;font-weight:600;">Mientras tanto, ¿qué te sirve ir preparando?</p>
            <ul style="margin:0;padding-left:20px;">
              <li style="margin:4px 0;">Cuántos proyectos y unidades estás manejando hoy</li>
              <li style="margin:4px 0;">Qué CRM o sistema usas actualmente (si tienes uno)</li>
            </ul>
          </div>

          <p style="margin:0 0 14px;">
            No vamos con presentaciones aburridas — la demo la corremos con un proyecto de muestra y salimos con cotización clara y próximos pasos.
          </p>

          <p style="margin:0 0 14px;">
            Si tienes algo urgente, responde este correo y te contesto directo.
          </p>

          <div style="margin-top:24px;">
            <p style="margin:0;">
              Un abrazo,<br>
              <b>Víctor Nazer</b> · Bizual
            </p>
          </div>

          <hr style="border:none;border-top:1px solid #E2E8F0;margin:28px 0 14px;">

          <p style="font-size:11px;color:#94A3B8;text-align:center;margin:0;">
            Bizual · Av. Manquehue Sur 520, Las Condes · Santiago, Chile<br>
            <a href="https://bizual.ai" style="color:#94A3B8;">bizual.ai</a>
          </p>

        </div>
      `
    });
    return result;
  } catch (err) {
    console.error('[email] sendLeadConfirmationEmail error:', err.message);
    return null;
  }
}

async function sendInternalNotificationEmail({ nombre, empresa, email, telefono, producto, mensaje, contactId, dealId }) {
  if (!resend) {
    console.warn('[email] Resend not configured, skipping internal email');
    return null;
  }
  try {
    const hubspotContactUrl = `https://app.hubspot.com/contacts/47233106/contact/${contactId}`;
    const hubspotDealUrl = `https://app.hubspot.com/contacts/47233106/deal/${dealId}`;
    const productoLabel = mapProductoToEmailLabel(producto);

    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: [NOTIFY_EMAIL],
      replyTo: email,
      subject: `🚀 Nuevo lead Bizual: ${nombre} (${empresa})`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a;line-height:1.5;">
          <h2 style="font-size:20px;margin:0 0 16px;">Nuevo lead desde bizual.ai</h2>

          <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
            <tr><td style="padding:8px 0;color:#64748B;width:140px;">Nombre:</td><td style="padding:8px 0;font-weight:600;">${nombre}</td></tr>
            <tr><td style="padding:8px 0;color:#64748B;">Empresa:</td><td style="padding:8px 0;font-weight:600;">${empresa}</td></tr>
            <tr><td style="padding:8px 0;color:#64748B;">Email:</td><td style="padding:8px 0;"><a href="mailto:${email}">${email}</a></td></tr>
            <tr><td style="padding:8px 0;color:#64748B;">Teléfono:</td><td style="padding:8px 0;">${telefono || '—'}</td></tr>
            <tr><td style="padding:8px 0;color:#64748B;">Producto:</td><td style="padding:8px 0;font-weight:600;">${productoLabel}</td></tr>
          </table>

          <div style="background:#F1F5F9;border-radius:8px;padding:16px;margin-bottom:20px;">
            <p style="margin:0 0 8px;color:#64748B;font-size:13px;font-weight:600;">MENSAJE:</p>
            <p style="margin:0;white-space:pre-wrap;">${mensaje || '(sin mensaje)'}</p>
          </div>

          <div style="display:flex;gap:8px;margin-top:24px;">
            <a href="${hubspotContactUrl}" style="display:inline-block;background:#0F172A;color:white;padding:10px 16px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;margin-right:8px;">Ver contacto en HubSpot</a>
            <a href="${hubspotDealUrl}" style="display:inline-block;background:#3B82F6;color:white;padding:10px 16px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">Ver deal en HubSpot</a>
          </div>

          <p style="font-size:12px;color:#94A3B8;margin:32px 0 0;">
            Recibido vía formulario web bizual.ai · ${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })}
          </p>
        </div>
      `
    });
    return result;
  } catch (err) {
    console.error('[email] sendInternalNotificationEmail error:', err.message);
    return null;
  }
}

// --- POST /api/contact ----------------------------------------------------

app.post('/api/contact', contactLimiter, async (req, res) => {
  try {
    const {
      nombre = '', empresa = '', email = '', telefono = '',
      producto = '', mensaje = '', consentimiento, hp_field
    } = req.body || {};

    if (hp_field) return res.json({ ok: true, queued: true });

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

    const cleanEmail = email.trim().toLowerCase();
    const cleanEmpresa = empresa.trim();
    const cleanTelefono = telefono.trim();

    // 1. Find or create Contact
    const contact = await findOrCreateContact({
      email: cleanEmail,
      firstname, lastname,
      company: cleanEmpresa,
      phone: cleanTelefono,
      source: 'website_form'
    });

    // 2. Create Deal
    const deal = await createDeal({
      contactId: contact.id,
      companyName: cleanEmpresa,
      producto,
      mensaje
    });

    // 3. Add note to Contact with full message
    if (mensaje.trim()) {
      await addNoteToContact({
        contactId: contact.id,
        body: `<b>Mensaje desde formulario web bizual.ai</b><br><br>` +
              `<b>Producto:</b> ${producto}<br>` +
              `<b>Empresa:</b> ${cleanEmpresa}<br>` +
              `<b>Teléfono:</b> ${cleanTelefono || '—'}<br><br>` +
              `<b>Mensaje:</b><br>${mensaje.replace(/\n/g, '<br>')}`
      });
    }

    // 4. Send emails (parallel, don't block response on failure)
    Promise.allSettled([
      sendLeadConfirmationEmail({
        to: cleanEmail,
        nombre: firstname || nombre,
        empresa: cleanEmpresa,
        producto
      }),
      sendInternalNotificationEmail({
        nombre,
        empresa: cleanEmpresa,
        email: cleanEmail,
        telefono: cleanTelefono,
        producto,
        mensaje,
        contactId: contact.id,
        dealId: deal.id
      })
    ]).then(results => {
      results.forEach((r, i) => {
        const label = i === 0 ? 'lead_email' : 'internal_email';
        if (r.status === 'rejected') {
          console.error(`[email] ${label} failed:`, r.reason);
        } else if (r.value) {
          console.log(`[email] ${label} sent:`, r.value.data?.id || 'ok');
        }
      });
    });

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
  console.log(`HubSpot: ${HUBSPOT_TOKEN ? 'configured' : 'NOT configured'}`);
  console.log(`Resend: ${RESEND_API_KEY ? 'configured' : 'NOT configured'}`);
});
