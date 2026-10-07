/* Event-Guided Dynamic Reconstruction — page behaviour */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var videos = Array.prototype.slice.call(document.querySelectorAll('video[data-src]'));

  function ensureSrc(v) {
    if (!v.getAttribute('src')) v.setAttribute('src', v.dataset.src);
  }

  /* If the browser refuses to autoplay, hand the viewer the controls instead of
     leaving them with a poster and no way to start it. */
  function tryPlay(v) {
    var p = v.play();
    if (p && p.catch) p.catch(function () { v.controls = true; });
  }

  /* Someone who asked for less motion still needs to be able to watch this. */
  if (reduceMotion) videos.forEach(function (v) { v.controls = true; });

  /* ---------- load and play only what is on screen ---------- */
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = e.target;
        if (e.isIntersecting) {
          ensureSrc(v);
          if (!v.controls && !reduceMotion) tryPlay(v);
        } else if (!v.paused) {
          v.pause();
        }
      });
    }, { threshold: 0.25 });
    videos.forEach(function (v) { io.observe(v); });
  } else {
    videos.forEach(ensureSrc);
  }

  videos.filter(function (v) { return v.controls; }).forEach(function (v) {
    v.addEventListener('play', function () { ensureSrc(v); }, { once: true });
  });

  /* ---------- scene tabs ---------- */
  document.querySelectorAll('[role="tablist"]').forEach(function (list) {
    var tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));

    function select(tab, focus) {
      var video = document.getElementById(tab.getAttribute('aria-controls'));
      tabs.forEach(function (t) { t.setAttribute('aria-selected', String(t === tab)); });
      if (!video) return;
      video.setAttribute('poster', tab.dataset.poster);
      video.dataset.src = tab.dataset.src;
      if (tab.dataset.ar) video.style.setProperty('--ar', tab.dataset.ar);
      /* Assigning src loads it; calling load() would clear the intrinsic size first. */
      video.setAttribute('src', tab.dataset.src);
      if (!reduceMotion) tryPlay(video);
      if (focus) tab.focus();
    }

    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { select(tab, false); });
      tab.addEventListener('keydown', function (e) {
        var step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        select(tabs[(i + step + tabs.length) % tabs.length], true);
      });
    });
  });

  /* ---------- show when a table still scrolls ---------- */
  var wraps = Array.prototype.slice.call(document.querySelectorAll('.tablewrap'));
  function markScrollable(el) {
    el.classList.toggle('can-scroll', el.scrollWidth - el.clientWidth - el.scrollLeft > 2);
  }
  function refreshScrollHints() { wraps.forEach(markScrollable); }
  wraps.forEach(function (el) {
    el.addEventListener('scroll', function () { markScrollable(el); }, { passive: true });
  });
  window.addEventListener('resize', refreshScrollHints);
  refreshScrollHints();
  window.addEventListener('load', refreshScrollHints);

  /* ---------- copy the citation ---------- */
  var copyBtn = document.getElementById('copy-bib');
  if (copyBtn) {
    var resetLabel = function (msg) {
      copyBtn.textContent = msg;
      setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1800);
    };

    var legacyCopy = function (text) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    };

    copyBtn.addEventListener('click', function () {
      var text = document.getElementById('bibtex').textContent;
      var fallback = function () {
        resetLabel(legacyCopy(text) ? 'Copied' : 'Select and copy');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { resetLabel('Copied'); }, fallback);
      } else {
        fallback();
      }
    });
  }

  /* ---------- arXiv placeholder ---------- */
  document.querySelectorAll('[data-arxiv]').forEach(function (a) {
    if (a.getAttribute('href') !== '#') return;
    a.setAttribute('aria-disabled', 'true');
    a.setAttribute('title', 'arXiv link not published yet');
    a.addEventListener('click', function (e) { e.preventDefault(); });
  });

  /* ---------- external links ---------- */
  document.querySelectorAll('a[href^="http"]').forEach(function (a) {
    if (a.hostname === window.location.hostname) return;
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
})();
