/**
 * Lightbox mínimo para .compare-image-block
 * Sin dependencias externas. ~50 líneas.
 */
(function () {
    'use strict';

    function createOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'lb-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Imagen ampliada');

        const closeBtn = document.createElement('button');
        closeBtn.className = 'lb-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.setAttribute('aria-label', 'Cerrar imagen ampliada');

        const img = document.createElement('img');
        img.setAttribute('alt', '');

        const caption = document.createElement('p');
        caption.className = 'lb-caption';

        overlay.appendChild(closeBtn);
        overlay.appendChild(img);
        overlay.appendChild(caption);
        document.body.appendChild(overlay);

        // Close on overlay click (outside image)
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay || e.target === closeBtn) closeLb();
        });

        // Close on Escape key
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && overlay.classList.contains('lb-active')) closeLb();
        });

        function closeLb() {
            overlay.classList.remove('lb-active');
            document.body.style.overflow = '';
        }

        return { overlay, img, caption };
    }

    function init() {
        const lb = createOverlay();

        document.querySelectorAll('[data-lightbox]').forEach(function (el) {
            el.style.cursor = 'zoom-in';

            function openLb() {
                lb.img.src = el.getAttribute('data-lightbox');
                lb.img.alt = el.getAttribute('data-caption') || el.getAttribute('alt') || 'Imagen ampliada';
                lb.caption.textContent = el.getAttribute('data-caption') || '';
                lb.overlay.classList.add('lb-active');
                document.body.style.overflow = 'hidden';
                lb.overlay.querySelector('.lb-close').focus();
            }

            el.addEventListener('click', openLb);
            el.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLb(); }
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
