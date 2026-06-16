/* Bizual landing v3 — vanilla JS (<9KB) */
(function () {
  'use strict';

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
    links.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        links.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
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
  document.querySelectorAll('.btn-primary, .btn-ghost, .btn-light').forEach(function (b) {
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

  // Reveal on scroll
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && reveals.length) {
    var ro = new IntersectionObserver(function (entries, observer) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); observer.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(function (r) { ro.observe(r); });
  } else {
    reveals.forEach(function (r) { r.classList.add('in'); });
  }

  // Pre-fill product field from query string (?producto=bizual-sales)
  var params = new URLSearchParams(location.search);
  var producto = params.get('producto');
  if (producto) {
    var sel = document.querySelector('select[name="producto"]');
    if (sel) {
      var map = {
        'bizual-sales': 'Bizual Sales',
        'bizual-assets': 'Bizual Assets',
        'bizual-training': 'Bizual Training',
        'varios': 'Varios productos',
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
          } else { throw new Error((res && res.error) || 'error'); }
        })
        .catch(function () {
          if (msg) { msg.className = 'form-msg err'; msg.textContent = 'No pudimos enviar tu mensaje. Escríbenos directo a contacto@bizual.ai y te respondemos.'; }
        })
        .finally(function () {
          if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || 'Enviar'; }
        });
    });
  }
})();
