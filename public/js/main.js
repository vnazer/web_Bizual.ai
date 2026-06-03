/* Bizual landing v2 — vanilla JS (<8KB) */
(function () {
  'use strict';

  // Analytics hook (no tracker installed; dispatches custom events).
  function track(name, detail) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
      if (window.gtag) window.gtag('event', name, detail || {});
      if (window.plausible) window.plausible(name, { props: detail || {} });
    } catch (e) {}
  }

  // Mobile nav toggle
  var toggle = document.querySelector('.nav-toggle');
  var links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // Smooth scroll for same-page anchors
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href');
      if (id.length < 2) return;
      var el = document.querySelector(id);
      if (!el) return;
      e.preventDefault();
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', id);
    });
  });

  // CTA click tracking
  document.querySelectorAll('.btn-primary, .btn-secondary').forEach(function (b) {
    b.addEventListener('click', function () {
      track('bizual_cta_click', { label: (b.textContent || '').trim().slice(0, 60), href: b.getAttribute('href') || '' });
    });
  });

  // FAQ open tracking
  document.querySelectorAll('.faq-list details').forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (d.open) {
        var q = d.querySelector('summary');
        track('bizual_faq_open', { question: q ? (q.textContent || '').trim() : '' });
      }
    });
  });

  // Pre-fill product field from query string (?producto=bizual-sales)
  var params = new URLSearchParams(location.search);
  var producto = params.get('producto');
  if (producto) {
    var sel = document.querySelector('select[name="producto"]');
    if (sel) {
      var map = {
        'bizual-sales': 'Bizual Sales',
        'bizual-assets': 'Bizual Assets',
        'ambos': 'Ambos productos',
        'evaluando': 'Estoy evaluando'
      };
      var want = map[producto] || producto;
      Array.prototype.forEach.call(sel.options, function (o) {
        if (o.value === want || o.textContent.trim() === want) sel.value = o.value;
      });
    }
  }

  // Contact form submit
  var form = document.querySelector('#contact-form');
  if (form) {
    var msg = form.querySelector('.form-msg');
    var btn = form.querySelector('button[type="submit"]');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;
      if (msg) { msg.className = 'form-msg'; msg.textContent = ''; }
      if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Enviando…'; }

      var data = Object.fromEntries(new FormData(form).entries());
      track('bizual_form_submit', { producto: data.producto || '' });

      fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
        .then(function (r) { return r.json().catch(function () { return { ok: r.ok }; }); })
        .then(function (res) {
          if (res && res.ok) {
            form.reset();
            if (msg) { msg.className = 'form-msg ok'; msg.textContent = '¡Recibido! Te escribimos en las próximas 24 horas para coordinar el horario de la demo.'; }
          } else {
            throw new Error((res && res.error) || 'error');
          }
        })
        .catch(function () {
          if (msg) { msg.className = 'form-msg err'; msg.textContent = 'No pudimos enviar tu mensaje. Escríbenos directo a contacto@bizual.ai y te respondemos.'; }
        })
        .finally(function () {
          if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || 'Enviar'; }
        });
    });
  }

  // Lazy-load enhancement (fallback for native loading=lazy)
  if (!('loading' in HTMLImageElement.prototype) && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          var img = en.target;
          if (img.dataset.src) img.src = img.dataset.src;
          obs.unobserve(img);
        }
      });
    });
    document.querySelectorAll('img[loading="lazy"]').forEach(function (i) { io.observe(i); });
  }
})();
