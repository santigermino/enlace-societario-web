const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { fetchCSV, getPostImageUrl } = require('./src/scripts/googleSheets');

// Configuration
const CONFIG = {
    sheetId: process.env.GOOGLE_SHEET_ID_BLOG,
    gidPosts: process.env.GID_POSTS,
    gidCategories: process.env.GID_CATEGORIES,
    gidAuthors: process.env.GID_AUTHORS,
    outputDir: path.join(__dirname, 'dist'),
    templateDir: path.join(__dirname, 'src/templates'),
    contentDir: path.join(__dirname, 'src/content'),
    stylesDir: path.join(__dirname, 'src/styles'),
    scriptsDir: path.join(__dirname, 'src/scripts'),
    scriptsDir: path.join(__dirname, 'src/scripts'),
    publicDir: path.join(__dirname, 'public')
};

// Global stats for QA
const BUILD_STATS = {
    postsGenerated: 0,
    faqsDetected: 0,
    faqsDiscarded: 0,
    ctasRendered: 0,
    internalLinksInserted: 0,
    richBlocksRendered: 0,
    recommendedBlocksGenerated: 0,
    postsWithoutRecommendations: 0,
    warnings: []
};

const logWarning = (type, message, context) => {
    const msg = `[${type} WARNING] ${message} (Context: "${context}")`;
    BUILD_STATS.warnings.push(msg);
    console.log(`\x1b[33m${msg}\x1b[0m`);
};

// Helper: Escape RegExp special chars
const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Helper: Insert internal link in first suitable paragraph
const insertInternalLink = (html, word, targetSlug) => {
    const regex = new RegExp(`(${escapeRegExp(word)})`, 'i');
    let inserted = false;
    html = html.replace(regex, (match) => {
        if (inserted) return match;
        inserted = true;
        return `<a href="/blog/${targetSlug}" class="internal-link">${match}</a>`;
    });
    return { html, inserted };
};

// Helper: Pick candidate posts for internal linking / recommendations
const pickCandidates = (current, allPosts, maxCount) => {
    // Build keyword arrays (lowercase, trimmed)
    const curKw = (current.keywords || '').toLowerCase().split(/,|\r?\n/).map(k => k.trim()).filter(Boolean);
    const candidates = allPosts
        .filter(p => p.Slug !== current.Slug)
        .map(p => {
            const sameCat = p.categoryName === current.categoryName ? 2 : 0;
            const pKw = (p.keywords || '').toLowerCase().split(/,|\r?\n/).map(k => k.trim()).filter(Boolean);
            const shared = curKw.filter(k => pKw.includes(k)).length;
            const score = sameCat + shared;
            return { post: p, score };
        })
        .filter(c => c.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxCount);
    if (candidates.length === 0) {
        return allPosts.filter(p => p.Slug !== current.Slug).slice(0, maxCount);
    }
    return candidates.map(c => c.post);
};

// Helper: Generate internal links for a post
const enrichInternalLinks = (post, allPosts, html) => {
    const maxLinks = 4;
    let insertedCount = 0;
    const candidates = pickCandidates(post, allPosts, 10);
    
    for (const cand of candidates) {
        if (insertedCount >= maxLinks) break;
        
        // Split title into words and try to find a match
        const words = cand.Title.split(' ').filter(w => w.length > 5);
        for (const word of words) {
            const result = insertInternalLink(html, word, cand.Slug);
            if (result.inserted) {
                html = result.html;
                insertedCount++;
                BUILD_STATS.internalLinksInserted++;
                break;
            }
        }
    }
    return html;
};

// Helper: Generate recommended block (3 cards)
const generateRecommendedBlock = (post, allPosts) => {
    const maxRecs = 3;
    // Simple fallback: take first maxRecs other posts
    const recs = allPosts.filter(p => p.Slug !== post.Slug).slice(0, maxRecs);
    if (recs.length === 0) {
        BUILD_STATS.postsWithoutRecommendations++;
        return '';
    }
    BUILD_STATS.recommendedBlocksGenerated++;
    let block = `<div class="recommended-block"><h3>También te puede interesar</h3><div class="recommended-grid">`;
    for (const r of recs) {
        const img = r.imageUrl ? r.imageUrl : '/images/default-thumb.jpg';
        block += `
    <div class="recommended-card">
        <a href="/blog/${r.Slug}" class="recommended-link">
            <img src="${img}" alt="${r.Title}" class="recommended-img"/>
            <div class="recommended-content">
                <h4 class="recommended-title">${r.Title}</h4>
                <p class="recommended-excerpt">${(r.excerpt || r.Content.replace(/<[^>]*>/g, '').substring(0, 120).trim())}...</p>
                <span class="recommended-category">${r.categoryName}</span>
            </div>
        </a>
    </div>`;
    }
    block += `</div></div>`;
    return block;
};

// Helper: Ensure directory exists
function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Helper: Copy Directory Recursive
function copyDir(src, dest) {
    ensureDir(dest);
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// Helper: Read Template
function readTemplate(name) {
    const filePath = path.join(CONFIG.templateDir, name);
    if (!fs.existsSync(filePath)) {
        console.warn(`Template not found: ${filePath}`);
        return '';
    }
    return fs.readFileSync(filePath, 'utf8');
}

// Helper: Render Layout
function renderLayout(content, meta = {}) {
    let layout = readTemplate('layout.html');

    // Default Fallbacks
    const domain = 'https://enlacesocietario.com';
    const title = meta.title || 'Constitución de Sociedades en Argentina | Enlace Societario';
    const description = meta.description || 'Especialistas en constitución, reforma y regularización de sociedades en Argentina. Asesoramiento legal y contable con más de 20 años de experiencia.';
    const canonical = meta.canonical || domain;
    const ogImage = meta.image ? (meta.image.startsWith('http') ? meta.image : `${domain}${meta.image}`) : `${domain}/images/hero-bg.webp`;
    const ogType = meta.type || 'website';
    const author = meta.author || 'Enlace Societario';
    const ogArticleMeta = meta.articleMeta || '';
    const bodyClass = meta.bodyClass || '';

    layout = layout.replace(/{{content}}/g, content);
    layout = layout.replace(/{{meta_title}}/g, title);
    layout = layout.replace(/{{meta_description}}/g, description);
    layout = layout.replace(/{{meta_author}}/g, author);
    layout = layout.replace(/{{canonical_url}}/g, canonical);
    layout = layout.replace(/{{og_image}}/g, ogImage);
    layout = layout.replace(/{{og_type}}/g, ogType);
    layout = layout.replace(/{{og_article_meta}}/g, ogArticleMeta);
    layout = layout.replace(/{{schema_json}}/g, meta.schema || '');
    layout = layout.replace(/{{extra_meta}}/g, meta.extraMeta || '');
    layout = layout.replace(/{{current_year}}/g, new Date().getFullYear());
    layout = layout.replace(/{{body_class}}/g, bodyClass);

    return layout;
}

// ============================================================
// RICH COMPONENTS — Reutilizables desde Google Sheets
// Sintaxis: [TAG]\ncontent lines\n[/TAG]
// ============================================================

/**
 * Renders a premium tweet card (no Twitter.js dependency).
 * Lines: [0] url, [1] "Author Name | @handle", [2+] tweet excerpt
 */
function renderTweetCard(lines) {
    const url = (lines[0] || '').trim();
    const authorLine = (lines[1] || '').trim();
    const excerpt = lines.slice(2).join(' ').trim();

    const parts = authorLine.split('|').map(s => s.trim());
    const authorName = parts[0] || 'Usuario';
    const handle = parts[1] || '';

    const xIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`;

    return `
<div class="tweet-card" role="article" aria-label="Publicación de ${authorName} en X">
    <div class="tweet-card__header">
        <div class="tweet-card__author">
            <div class="tweet-card__avatar" aria-hidden="true">${authorName.charAt(0).toUpperCase()}</div>
            <div class="tweet-card__author-info">
                <span class="tweet-card__name">${authorName}</span>
                ${handle ? `<span class="tweet-card__handle">${handle}</span>` : ''}
            </div>
        </div>
        <div class="tweet-card__icon" aria-hidden="true">${xIconSvg}</div>
    </div>
    ${excerpt ? `<p class="tweet-card__text">${excerpt}</p>` : ''}
    <div class="tweet-card__footer">
        <a href="${url}" target="_blank" rel="noopener noreferrer" class="tweet-card__link" title="Ver publicación original en X">
            Ver publicación original <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </a>
    </div>
</div>
`.trim();
}

/**
 * Renders an embedded PDF preview using Google Docs Viewer.
 * Lines: [0] url, [1] optional title
 */
function renderPdfPreview(lines) {
    const url = (lines[0] || '').trim();
    const title = (lines[1] || 'Documento oficial').trim();
    // Use the provided URL directly if it's already a viewer URL, else wrap in Google Docs viewer
    const viewerUrl = url.includes('viewer') ? url : `https://docs.google.com/viewerng/viewer?url=${encodeURIComponent(url)}&embedded=true`;

    return `
<div class="pdf-preview-block">
    <div class="pdf-preview-block__header">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        <span class="pdf-preview-block__title">${title}</span>
        <a href="${url}" target="_blank" rel="noopener noreferrer" class="pdf-preview-block__open-btn" title="Abrir documento completo en nueva pestaña">
            Abrir documento completo
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </a>
    </div>
    <div class="pdf-preview-block__viewer">
        <iframe
            src="${viewerUrl}"
            class="pdf-preview-block__iframe"
            title="${title}"
            loading="lazy"
            allowfullscreen>
            <div class="pdf-preview-block__fallback">
                <p>El visor no pudo cargar el documento.</p>
                <a href="${url}" target="_blank" rel="noopener noreferrer" class="blog-cta-button" style="font-size:1rem; padding: 0.8rem 1.8rem;">Abrir documento</a>
            </div>
        </iframe>
    </div>
</div>
`.trim();
}

/**
 * Renders a responsive comparison table from pipe-separated rows.
 * Lines: each line is a table row: "| Col1 | Col2 | Col3 |"
 */
function renderCompareTable(lines) {
    const rows = lines
        .map(l => l.trim())
        .filter(l => l.startsWith('|'))
        .map(l => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim()));

    if (rows.length === 0) return '';

    const [headerRow, ...dataRows] = rows;

    const thead = `<thead><tr>${headerRow.map(h => `<th>${h}</th>`).join('')}</tr></thead>`;
    const tbody = `<tbody>${dataRows.map((row, ri) => `<tr class="${ri % 2 === 0 ? 'even' : 'odd'}">${row.map((cell, ci) => `<td data-label="${headerRow[ci] || ''}">${cell}</td>`).join('')}</tr>`).join('')}</tbody>`;

    return `
<div class="compare-table-wrapper" role="region" aria-label="Tabla comparativa" tabindex="0">
    <table class="compare-table">
        ${thead}
        ${tbody}
    </table>
</div>
`.trim();
}

/**
 * Renders a full-width image with lightbox capability.
 * Lines: [0] url, [1] alt/caption text
 */
function renderCompareImage(lines) {
    const url = (lines[0] || '').trim();
    const caption = (lines[1] || '').trim();

    return `
<figure class="compare-image-block">
    <img
        src="${url}"
        alt="${caption || 'Cuadro comparativo'}"
        class="compare-image-block__img"
        loading="lazy"
        data-lightbox="${url}"
        data-caption="${caption}"
        title="Clic para ampliar"
        tabindex="0"
        role="button"
        aria-label="Ampliar imagen: ${caption || 'cuadro comparativo'}"
    />
    ${caption ? `<figcaption class="compare-image-block__caption">${caption}</figcaption>` : ''}
    <div class="compare-image-block__hint" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
        Clic para ampliar
    </div>
</figure>
`.trim();
}

/**
 * Pre-processes special block tags BEFORE the line-by-line parser.
 * Replaces [TAG]...[/TAG] with unique placeholders, returns { text, blocks }.
 * Supported: TWEET, PDF_PREVIEW, COMPARE_TABLE, COMPARE_IMAGE
 */
function processSpecialBlocks(text) {
    const blocks = {};
    let counter = 0;

    const blockRegex = /\[(TWEET|PDF_PREVIEW|COMPARE_TABLE|COMPARE_IMAGE)\]\r?\n([\s\S]*?)\r?\n\[\/(TWEET|PDF_PREVIEW|COMPARE_TABLE|COMPARE_IMAGE)\]/g;

    text = text.replace(blockRegex, (match, openTag, content, closeTag) => {
        if (openTag !== closeTag) return match; // mismatched tags — leave as is

        const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
        let html = '';

        try {
            switch (openTag) {
                case 'TWEET':         html = renderTweetCard(lines);   break;
                case 'PDF_PREVIEW':   html = renderPdfPreview(lines);  break;
                case 'COMPARE_TABLE': html = renderCompareTable(lines); break;
                case 'COMPARE_IMAGE': html = renderCompareImage(lines); break;
                default: return match;
            }
        } catch (e) {
            logWarning('COMPONENT', `Error procesando bloque ${openTag}`, e.message);
            return match;
        }

        const placeholder = `___RICH_BLOCK_${counter}___`;
        blocks[placeholder] = html;
        counter++;
        BUILD_STATS.richBlocksRendered = (BUILD_STATS.richBlocksRendered || 0) + 1;
        return placeholder;
    });

    return { text, blocks };
}

/**
 * Formats plain text from Google Sheets into structured HTML.
 * Handles paragraphs, lists, and headings.
 */
function formatContent(text, contextSlug = 'unknown') {
    if (!text) return { html: '', faqs: [] };

    // Pre-process rich component blocks before line-by-line parsing
    const { text: processedText, blocks } = processSpecialBlocks(text);

    const lines = processedText.split(/\r?\n/);
    let html = '';
    let currentList = [];
    let faqs = [];
    let inFaqSection = false;
    let currentQuestion = null;
    let currentAnswer = '';

    const closeList = () => {
        if (currentList.length > 0) {
            html += `<ul style="margin-bottom: 2rem; padding-left: 1.5rem; list-style-type: disc;">\n${currentList.map(li => `<li style="margin-bottom: 0.75rem;">${li}</li>`).join('\n')}\n</ul>\n`;
            currentList = [];
        }
    };

    const closeFaq = () => {
        if (currentQuestion) {
            const answerClean = currentAnswer.trim().replace(/<[^>]+>/g, '');
            // Validation: minimum length and no CTA inside the answer
            if (answerClean.length < 20) {
                logWarning('FAQ', 'FAQ descartada por respuesta demasiado corta o vacía', currentQuestion);
                BUILD_STATS.faqsDiscarded++;
            } else if (answerClean.includes('👉') || answerClean.includes('➡️') || answerClean.includes('http')) {
                logWarning('FAQ', 'FAQ descartada por contener posibles CTAs o links en la respuesta plana', currentQuestion);
                BUILD_STATS.faqsDiscarded++;
            } else {
                faqs.push({ question: currentQuestion, answer: answerClean });
                BUILD_STATS.faqsDetected++;
            }
            currentQuestion = null;
            currentAnswer = '';
        }
    };

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();

        if (!line) {
            // Check if next line is also empty or if we should close the list
            const nextLine = (lines[i + 1] || '').trim();
            if (nextLine.startsWith('-') || nextLine.startsWith('•')) {
                continue; // Keep list open if next line is a list item
            }
            closeList();
            continue;
        }

        // Detect List Items
        if (line.startsWith('-') || line.startsWith('•')) {
            // Check if the list item has bold text
            let liText = line.substring(1).trim();
            liText = liText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            
            // FAQ Question Detection from list items
            if (inFaqSection && liText.startsWith('¿')) {
                closeFaq();
                currentQuestion = liText;
            }
            
            currentList.push(liText);
            continue;
        }

        // If not a list item, close any open list
        closeList();

        // Check if the entire line is wrapped in ** (user intending a heading)
        let isBoldLine = false;
        if (line.match(/^\*\*(.*?)\*\*$/)) {
            isBoldLine = true;
            line = line.replace(/^\*\*(.*?)\*\*$/, '$1').trim();
        }

        // Apply inline replacing for bold
        line = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        // Clean text for checks
        const cleanText = line.replace(/<[^>]+>/g, '');

        // Detect Headings (Moved up for FAQ detection)
        const isAllCaps = cleanText.length > 5 && cleanText === cleanText.toUpperCase() && !cleanText.match(/[a-z]/);
        const startsWithEmoji = /^[\u{1F300}-\u{1F9FF}]|^[\u{2600}-\u{26FF}]/u.test(cleanText);
        const looksLikeHeading = startsWithEmoji && cleanText.length < 100;
        const isHeading = isBoldLine || line.startsWith('#') || isAllCaps || looksLikeHeading;

        // FAQ Section Detection
        if (isHeading && cleanText.toLowerCase().includes('preguntas frecuentes')) {
            inFaqSection = true;
        } else if (inFaqSection && isHeading && !cleanText.toLowerCase().includes('preguntas frecuentes')) {
            // Exited FAQ section
            inFaqSection = false;
            closeFaq();
        }

        // FAQ Question Detection
        if (inFaqSection && line.startsWith('### ¿')) {
            closeFaq();
            currentQuestion = line.replace(/^###\s*/, '').trim();
            // Optional: output as standard H3 in HTML too
            html += `<h3 style="margin-top: 2rem; margin-bottom: 1rem; color: var(--color-primary); font-size: 1.4rem;">${currentQuestion}</h3>\n`;
            continue;
        } else if (inFaqSection && currentQuestion && !line.startsWith('#')) {
            currentAnswer += line + ' ';
        }

        // Advanced CTA Detection (👉 or ➡️)
        if (cleanText.trim().startsWith('👉') || cleanText.trim().startsWith('➡️')) {
            let ctaText = cleanText.trim().substring(1).trim();
            let ctaUrl = '';
            
            // Check if URL is inline - Robust Regex that grabs till the end if http is found
            const urlMatch = ctaText.match(/(https?:\/\/[^\s]+)/);
            if (urlMatch) {
                ctaUrl = urlMatch[1].replace(/\)$/, ''); // clean trailing parenthesis if any
                ctaText = ctaText.replace(urlMatch[0], '').replace(/\(\)$/, '').trim(); // clean text
            } else {
                // Check if next line is a URL
                let nextLine = (lines[i + 1] || '').trim();
                const nextUrlMatch = nextLine.match(/(https?:\/\/[^\s]+)/);
                if (nextUrlMatch) {
                    ctaUrl = nextUrlMatch[1].replace(/\)$/, '');
                    i++; // skip next line
                }
            }

            if (ctaUrl) {
                const isInternal = ctaUrl.startsWith('/') || ctaUrl.includes('enlacesocietario.com');
                const targetAttr = isInternal ? '' : ' target="_blank" rel="noopener noreferrer"';
                html += `<div style="margin: 3rem 0; text-align: center;">\n<a href="${ctaUrl}" class="blog-cta-button"${targetAttr}>${ctaText || 'Más información'}</a>\n</div>\n`;
                BUILD_STATS.ctasRendered++;
                continue;
            } else {
                // Verify if it was truly intended as a CTA or just a highlighted phrase
                const intentKeywords = ["solicit", "asesor", "contact", "consult", "ver más", "click", "escrib", "link", "info", "turn"];
                const isLikelyCTA = intentKeywords.some(k => ctaText.toLowerCase().includes(k));
                
                // Suppress warnings for highlighted lines without URL; treat as normal paragraph
                // If it's not a CTA, it naturally falls through to be rendered as a standard paragraph
            }
        }

        // Detect Headings is already evaluated above as isHeading

        // Detect old CTA logic fallback
        const ctaKeywords = ["Solicitá asesoramiento", "Solicitar asesoramiento", "Asesoramiento personalizado"];
        const isShortLine = cleanText.length < 60;
        const isCTA = isShortLine && ctaKeywords.some(k => cleanText.toLowerCase().includes(k.toLowerCase()));

        if (isCTA) {
            html += `<div style="margin: 2.5rem 0; text-align: center;">\n<a href="/contacto" class="btn btn-primary" title="Solicitar asesoramiento personalizado" style="padding: 1rem 2rem; border-radius: 50px; text-transform: none; font-size: 1.1rem;">${line}</a>\n</div>\n`;
        } else if (isBoldLine && cleanText.length < 150) {
            // If it was exclusively wrapped in ** and is short enough, render as H2
            html += `<h2 style="margin-top: 2.5rem; margin-bottom: 1.25rem; color: var(--color-primary); font-size: 1.75rem;">${line}</h2>\n`;
        } else if (line.startsWith('##')) {
            html += `<h2 style="margin-top: 2.5rem; margin-bottom: 1.25rem; color: var(--color-primary); font-size: 1.75rem; border-bottom: 2px solid var(--color-accent); display: inline-block;">${line.replace(/^##\s*/, '')}</h2>\n`;
        } else if (line.startsWith('###')) {
            if (!inFaqSection) {
                html += `<h3 style="margin-top: 2rem; margin-bottom: 1rem; color: var(--color-primary); font-size: 1.4rem;">${line.replace(/^###\s*/, '')}</h3>\n`;
            }
        } else if (isAllCaps || looksLikeHeading) {
            html += `<h2 style="margin-top: 2.5rem; margin-bottom: 1.25rem; color: var(--color-primary); font-size: 1.75rem;">${line}</h2>\n`;
        } else {
            // Standard Paragraph
            html += `<p style="margin-bottom: 1.5rem; line-height: 1.8;">${line}</p>\n`;
        }
    }

    closeList();
    closeFaq();

    // Restore rich component blocks from placeholders
    Object.entries(blocks).forEach(([placeholder, blockHtml]) => {
        html = html.replace(`<p style="margin-bottom: 1.5rem; line-height: 1.8;">${placeholder}</p>`, blockHtml);
        html = html.replace(placeholder, blockHtml); // fallback
    });

    return { html, faqs };
}

// 1. Fetch and process Data
async function fetchBlogData() {
    console.log('Fetching blog data from Google Sheets...');

    try {
        const [postsRaw, categoriesRaw, authorsRaw] = await Promise.all([
            fetchCSV(CONFIG.sheetId, CONFIG.gidPosts),
            fetchCSV(CONFIG.sheetId, CONFIG.gidCategories),
            fetchCSV(CONFIG.sheetId, CONFIG.gidAuthors)
        ]);

        console.log(`Fetched ${postsRaw.length} posts, ${categoriesRaw.length} categories, ${authorsRaw.length} authors.`);

        // Create lookup maps
        const categoriesMap = {};
        categoriesRaw.forEach(cat => {
            categoriesMap[cat.category_slug] = cat.category_name;
        });

        const authorsMap = {};
        authorsRaw.forEach(author => {
            authorsMap[author.author_id] = author;
        });

        // Process posts
        const posts = postsRaw
            .filter(post => post.Status && post.Status.toLowerCase().trim() === 'published')
            .map(post => {
                const categoryName = categoriesMap[post.Category] || post.Category;
                const author = authorsMap[post.Author] || { name: post.Author };

                // SEO Metadata logic
                let metaTitle = post['Meta Title'];
                if (!metaTitle) {
                    metaTitle = `${post.Title} | Blog Enlace Societario`;
                }

                let metaDescription = post['Meta Description'];
                if (!metaDescription && post.Content) {
                    // Simple strip tags and truncate (~150 chars)
                    metaDescription = post.Content.replace(/<[^>]*>/g, '').substring(0, 150).trim();
                    const lastSpace = metaDescription.lastIndexOf(' ');
                    if (lastSpace > 120) metaDescription = metaDescription.substring(0, lastSpace);
                    metaDescription += '...';
                }

                return {
                    ...post,
                    categoryName,
                    authorName: author.name,
                    authorBio: author.bio || '',
                    authorLinkedin: author.author_linkedin_url || author.linkedin_url || '',
                    imageUrl: getPostImageUrl(post),
                    metaTitle,
                    metaDescription,
                    keywords: post.Keywords || ''
                };
            })
            // Sort by Date descending
            .sort((a, b) => {
                const dateA = new Date(a.Date);
                const dateB = new Date(b.Date);
                return dateB - dateA;
            });

        return posts;
    } catch (error) {
        console.error('Error fetching blog data:', error);
        return [];
    }
}

// 2. Build Pages
async function build() {
    console.log('Starting build...');

    const DOMAIN = 'https://enlacesocietario.com';
    const sitemapEntries = [];

    // Clean/Ensure Output Dir
    if (fs.existsSync(CONFIG.outputDir)) {
        fs.rmSync(CONFIG.outputDir, { recursive: true, force: true });
    }
    ensureDir(CONFIG.outputDir);
    ensureDir(path.join(CONFIG.outputDir, 'blog'));

    // Copy Assets
    console.log('Copying assets...');
    if (fs.existsSync(CONFIG.stylesDir)) {
        copyDir(CONFIG.stylesDir, path.join(CONFIG.outputDir, 'styles'));
    }
    if (fs.existsSync(CONFIG.scriptsDir)) {
        copyDir(CONFIG.scriptsDir, path.join(CONFIG.outputDir, 'scripts'));
    }
    if (fs.existsSync(CONFIG.publicDir)) {
        copyDir(CONFIG.publicDir, CONFIG.outputDir);
    }

    // Static Pages Meta Definitions
    const staticPages = {
        'index.html': {
            title: 'Constitución de Sociedades en Argentina | Enlace Societario',
            description: 'Especialistas en constitución, reforma y regularización de sociedades en Argentina. Asesoramiento legal y contable con más de 20 años de experiencia.',
            priority: '1.0',
            changefreq: 'daily',
            bodyClass: 'has-transparent-nav'
        },
        'servicios.html': {
            title: 'Servicios Societarios y Contables en Argentina | Enlace',
            description: 'Constitución de SRL y SA, reformas societarias, resolución de conflictos y servicios contables. Soluciones legales claras y eficientes.',
            priority: '0.9',
            changefreq: 'monthly',
            bodyClass: 'has-transparent-nav'
        },
        'nosotros.html': {
            title: 'Estudio Especialista en Derecho Societario | Enlace',
            description: 'Más de 20 años asesorando empresas en Argentina. Equipo profesional enfocado en seguridad jurídica y soluciones eficientes.',
            priority: '0.8',
            changefreq: 'monthly',
            bodyClass: 'has-transparent-nav'
        },
        'contacto.html': {
            title: 'Contacto para Asesoramiento Societario en Argentina | Enlace',
            description: 'Comunicate con nuestro equipo para recibir asesoramiento personalizado en trámites societarios y contables. Soluciones rápidas y profesionales.',
            priority: '0.8',
            changefreq: 'monthly',
            bodyClass: 'has-transparent-nav'
        },
        'herramientas.html': {
            title: 'Herramientas para emprendedores y empresas | Enlace Societario',
            description: 'Utilizá nuestras herramientas gratuitas para evaluar si te conviene ser monotributo, responsable inscripto o tener una sociedad y analizar qué tipo de sociedad puede adaptarse mejor a tu proyecto.',
            priority: '0.9',
            changefreq: 'monthly',
            slug: 'herramientas',
            bodyClass: 'has-transparent-nav'
        },
        'herramientas-monotributo-vs-responsable-inscripto.html': {
            title: '¿Monotributo, Responsable Inscripto o Sociedad? Calculadora gratuita | Enlace Societario',
            description: 'Evaluá gratis la mejor estructura fiscal para tu negocio en Argentina. Compará Monotributo vs Responsable Inscripto vs Sociedad con nuestro test inteligente.',
            priority: '0.9',
            changefreq: 'monthly',
            slug: 'herramientas/monotributo-vs-responsable-inscripto',
            bodyClass: 'has-transparent-nav'
        },
        'herramientas-que-sociedad-conviene.html': {
            title: '¿Qué tipo de sociedad te conviene? Test gratuito | Enlace Societario',
            description: 'Descubrí qué tipo de sociedad podría adaptarse mejor a tu proyecto en Argentina. Realizá nuestro test gratuito y obtené una recomendación orientativa al instante.',
            priority: '0.9',
            changefreq: 'monthly',
            slug: 'herramientas/que-tipo-de-sociedad-te-conviene',
            bodyClass: 'has-transparent-nav'
        },
        'servicios-constitucion.html': {
            title: 'Constitución de Sociedades | Enlace Societario',
            description: 'Creamos tu sociedad de forma ágil y segura. Te asesoramos en la elección de la figura jurídica (SRL, SA, SAS) y gestionamos todo el proceso registral.',
            priority: '0.9',
            changefreq: 'monthly',
            slug: 'servicios/constitucion',
            bodyClass: 'has-transparent-nav'
        },
        'servicios-reformas.html': {
            title: 'Reformas Societarias | Enlace Societario',
            description: 'Adaptamos tu sociedad a los nuevos desafíos. Aumentos de capital, cambios de objeto, renovación de autoridades y más.',
            priority: '0.9',
            changefreq: 'monthly',
            slug: 'servicios/reformas',
            bodyClass: 'has-transparent-nav'
        },
        'servicios-regularizacion.html': {
            title: 'Regularización y Conflictos Societarios | Enlace Societario',
            description: 'Intervenimos en situaciones complejas: sucesiones no resueltas, autoridades vencidas, sociedades inactivas o conflictos entre socios.',
            priority: '0.9',
            changefreq: 'monthly',
            slug: 'servicios/regularizacion',
            bodyClass: 'has-transparent-nav'
        },
        'servicios-otros-tramites.html': {
            title: 'Otros Trámites Societarios | Enlace Societario',
            description: 'Gestionamos certificaciones y reportes que garantizan el correcto funcionamiento legal y registral de tu sociedad.',
            priority: '0.9',
            changefreq: 'monthly',
            slug: 'servicios/otros-tramites',
            bodyClass: 'has-transparent-nav'
        },
        'servicios-impositivos.html': {
            title: 'Servicios Contables e Impositivos para Pymes | Enlace Societario',
            description: 'Delegá en expertos tu gestión contable e impositiva para enfocarte exclusivamente en el crecimiento de tu negocio.',
            priority: '0.9',
            changefreq: 'monthly',
            slug: 'servicios/impositivos',
            bodyClass: 'has-transparent-nav'
        },
        '404.html': {
            title: 'Error 404 | Enlace Societario',
            description: 'La página que estás buscando no existe o fue modificada.',
            priority: '0.1',
            changefreq: 'monthly',
            noindex: true
        }
    };

    // Build Static Pages
    Object.keys(staticPages).forEach(page => {
        const template = readTemplate(page);
        if (!template) return;

        const info = staticPages[page];
        const slug = info.slug || (page === 'index.html' ? '' : page.replace('.html', ''));
        const canonical = `${DOMAIN}${slug ? '/' + slug : '/'}`;

        const html = renderLayout(template, {
            title: info.title,
            description: info.description,
            canonical: canonical,
            extraMeta: info.noindex ? '<meta name="robots" content="noindex, follow">' : '',
            bodyClass: info.bodyClass || ''
        });

        let outputPath;
        if (page === 'index.html') {
            outputPath = path.join(CONFIG.outputDir, 'index.html');
        } else if (page === '404.html') {
            outputPath = path.join(CONFIG.outputDir, '404.html');
        } else {
            outputPath = path.join(CONFIG.outputDir, slug, 'index.html');
        }

        ensureDir(path.dirname(outputPath));
        fs.writeFileSync(outputPath, html);
        console.log(`Generated: ${outputPath}`);

        sitemapEntries.push({
            loc: canonical,
            priority: info.priority,
            changefreq: info.changefreq
        });
    });

    // Blog Pages
    const posts = await fetchBlogData();
    let blogListHtml = '';

    posts.forEach(post => {
        // Individual Post Page
        let postTemplate = readTemplate('post.html');
        if (!postTemplate) return;

        // Date formatting
        const dateObj = new Date(post.Date);
        const dateReadable = dateObj.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
        const dateIso = dateObj.toISOString(); // Full ISO for schema
        const dateSimpleIso = dateIso.split('T')[0];

        const parsedContent = formatContent(post.Content, post.Slug);
        // Internal linking automático desactivado por decisión editorial.
        // La función enrichInternalLinks sigue disponible pero no se llama.
        const postBodyHtml = parsedContent.html;
        // Generate recommended block (injected after keywords, not inside post_body)
        const recommendedBlock = generateRecommendedBlock(post, posts);

        // Insert content into template
        postTemplate = postTemplate
            .replace(/{{title}}/g, post.Title)
            .replace(/{{category}}/g, post.categoryName)
            .replace(/{{author}}/g, post.authorName)
            .replace(/{{date_readable}}/g, dateReadable)
            .replace(/{{date_iso}}/g, dateSimpleIso)
            .replace(/{{post_body}}/g, postBodyHtml)
            .replace(/{{image_url}}/g, post.imageUrl)
            .replace(/{{post_title}}/g, post.Title); // For ALT tags


        // Keywords badges
        let keywordsHtml = '';
        if (post.keywords) {
            const keys = post.keywords.split(/,|\r?\n/).map(k => k.trim()).filter(k => k !== '');
            if (keys.length > 0) {
                keywordsHtml = '<div class="post-keywords" style="margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid #eee; display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center;">';
                keywordsHtml += '<span style="font-size: 0.85rem; color: #777; margin-right: 0.5rem; font-weight: 600;">Etiquetas:</span>';
                keys.forEach(key => {
                    keywordsHtml += `<span class="keyword-badge">${key}</span>`;
                });
                keywordsHtml += '</div>';
            }
        }
        postTemplate = postTemplate.replace(/{{keywords_html}}/g, keywordsHtml);
        postTemplate = postTemplate.replace(/{{recommended_block}}/g, recommendedBlock);

        // Author Link
        const authorLinkHtml = post.authorLinkedin
            ? `<a href="${post.authorLinkedin}" target="_blank" class="author-link" title="Ver perfil de ${post.authorName}">${post.authorName}</a>`
            : post.authorName;
        postTemplate = postTemplate.replace(/{{author_with_link}}/g, authorLinkHtml);

        const canonical = `${DOMAIN}/blog/${post.Slug}`;
        const imageUrlAbs = post.imageUrl.startsWith('http') ? post.imageUrl : `${DOMAIN}${post.imageUrl}`;

        let postHtml = renderLayout(postTemplate, {
            title: post.metaTitle,
            description: post.metaDescription,
            canonical: canonical,
            image: post.imageUrl,
            type: 'article',
            author: post.authorName,
            articleMeta: `
    <meta property="article:published_time" content="${dateIso}">
    <meta property="article:author" content="${post.authorName}">`,
            schema: `
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Article",
      "mainEntityOfPage": {
        "@type": "WebPage",
        "@id": "${canonical}"
      },
      "headline": "${post.Title.replace(/"/g, '\\"')}",
      "description": "${post.metaDescription.replace(/"/g, '\\"')}",
      "image": "${imageUrlAbs}",
      "author": {
        "@type": "Person",
        "name": "${post.authorName}"
      },
      "publisher": {
        "@type": "Organization",
        "name": "Enlace Societario",
        "logo": {
          "@type": "ImageObject",
          "url": "${DOMAIN}/images/logo-enlace.png"
        }
      },
      "datePublished": "${dateIso}"
    }
    </script>`
        });
        
        // Inject FAQ Schema if present
        if (parsedContent.faqs && parsedContent.faqs.length > 0) {
            const faqSchema = {
                "@context": "https://schema.org",
                "@type": "FAQPage",
                "mainEntity": parsedContent.faqs.map(faq => ({
                    "@type": "Question",
                    "name": faq.question,
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": faq.answer
                    }
                }))
            };
            const faqSchemaStr = `\n<script type="application/ld+json">\n${JSON.stringify(faqSchema, null, 2)}\n</script>\n</head>`;
            postHtml = postHtml.replace('</head>', faqSchemaStr);
        }

        const postPath = path.join(CONFIG.outputDir, 'blog', post.Slug);
        ensureDir(postPath);
        fs.writeFileSync(path.join(postPath, 'index.html'), postHtml);
        BUILD_STATS.postsGenerated++;
        console.log(`Generated Post: ${post.Slug}`);

        sitemapEntries.push({
            loc: canonical,
            priority: '0.7',
            changefreq: 'weekly',
            lastmod: dateSimpleIso
        });

        // Add to list grid
        const excerpt = post.Content.replace(/<[^>]*>/g, '').substring(0, 120).trim() + '...';

        blogListHtml += `
        <article class="card blog-card" style="height: 100%; display: flex; flex-direction: column; position: relative;">
            <div class="card-image" style="height: 160px; overflow: hidden; border-radius: 8px 8px 0 0;">
                <img src="${post.imageUrl}" alt="${post.Title} - Enlace Societario" style="width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s ease;">
            </div>
            <div class="card-content" style="padding: 1rem 1.25rem; flex-grow: 1; display: flex; flex-direction: column;">
                <div style="margin-bottom: 0.25rem;">
                    <span class="category-tag" style="font-size: 0.65rem; font-weight: 800; color: var(--color-accent); text-transform: uppercase; letter-spacing: 0.05em;">${post.categoryName}</span>
                </div>
                <h3 style="margin-bottom: 0.5rem; font-size: 1.1rem; line-height: 1.25; font-weight: 700;">
                    <a href="/blog/${post.Slug}" class="stretched-link" title="Leer: ${post.Title}" style="text-decoration: none; color: inherit; transition: color 0.2s ease;">${post.Title}</a>
                </h3>
                <p style="font-size: 0.8rem; color: #555; margin-bottom: 1rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.5;">${excerpt}</p>
                <div style="margin-top: auto; display: flex; align-items: center; justify-content: space-between; font-size: 0.7rem; color: #999; border-top: 1px solid #f0f0f0; padding-top: 0.75rem;">
                    <span style="display: flex; align-items: center; gap: 0.25rem;"><i class="fas fa-user-edit" style="font-size: 0.6rem;"></i> ${post.authorName}</span>
                    <span><i class="far fa-calendar-alt" style="font-size: 0.6rem;"></i> ${dateReadable}</span>
                </div>
            </div>
        </article>`;
    });

    // Render Blog Listing
    let blogListTemplate = readTemplate('blog-list.html');
    if (blogListTemplate) {
        blogListTemplate = blogListTemplate.replace('{{blog_items}}', blogListHtml);
        const canonical = `${DOMAIN}/blog`;
        const blogIndexHtml = renderLayout(blogListTemplate, {
            title: 'Actualidad Societaria en Argentina | Blog Enlace',
            description: 'Guías prácticas y novedades sobre constitución de sociedades, reformas y normativa societaria en Argentina.',
            canonical: canonical,
            bodyClass: 'has-transparent-nav'
        });

        ensureDir(path.join(CONFIG.outputDir, 'blog'));
        fs.writeFileSync(path.join(CONFIG.outputDir, 'blog', 'index.html'), blogIndexHtml);
        console.log('Generated: Blog Index');

        sitemapEntries.push({
            loc: canonical,
            priority: '0.9',
            changefreq: 'monthly'
        });
    }

    // Generate Sitemap
    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries.map(entry => `    <url>
        <loc>${entry.loc}</loc>
        <changefreq>${entry.changefreq}</changefreq>
        <priority>${entry.priority}</priority>${entry.lastmod ? `\n        <lastmod>${entry.lastmod}</lastmod>` : ''}
    </url>`).join('\n')}
</urlset>`;
    fs.writeFileSync(path.join(CONFIG.outputDir, 'sitemap.xml'), sitemapXml);
    console.log('Generated: sitemap.xml');

    // Generate robots.txt
    const robotsTxt = `User-agent: *
Allow: /

Sitemap: ${DOMAIN}/sitemap.xml`;
    fs.writeFileSync(path.join(CONFIG.outputDir, 'robots.txt'), robotsTxt);
    console.log('Generated: robots.txt');

    // Final Audit (Basic Check for duplicates and consistency)
    console.log('Running final SEO audit...');
    const auditFiles = [];
    const walk = (dir) => {
        fs.readdirSync(dir).forEach(file => {
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) walk(fullPath);
            else if (file.endsWith('.html')) auditFiles.push(fullPath);
        });
    };
    walk(CONFIG.outputDir);

    auditFiles.forEach(file => {
        const content = fs.readFileSync(file, 'utf8');
        const errors = [];

        // Count tags
        const titles = content.match(/<title>/g) || [];
        const descriptions = content.match(/<meta name="description"/g) || [];
        const canonicals = content.match(/<link rel="canonical"/g) || [];

        if (titles.length > 1) errors.push(`Multiple <title> tags (${titles.length})`);
        if (descriptions.length > 1) errors.push(`Multiple <meta name="description"> tags (${descriptions.length})`);
        if (canonicals.length > 1) errors.push(`Multiple <link rel="canonical"> tags (${canonicals.length})`);

        // Consistency check
        if (content.includes('www.enlacesocietario.com')) errors.push('Found "www" in URLs');

        if (errors.length > 0) {
            console.warn(`[AUDIT WARNING] File: ${file}\n - ${errors.join('\n - ')}`);
        }
    });
    
    // QA Report
    console.log('\n=======================================');
    console.log('       POST-BUILD QA SUMMARY');
    console.log('=======================================');
    console.log(`Posts Generados:   ${BUILD_STATS.postsGenerated}`);
    console.log(`FAQs Detectadas:   ${BUILD_STATS.faqsDetected}`);
    console.log(`FAQs Descartadas:  ${BUILD_STATS.faqsDiscarded}`);
    console.log(`CTAs Renderizados: ${BUILD_STATS.ctasRendered}`);
    console.log(`Bloques Enriquecidos (Tweet/PDF/Tabla/Imagen): ${BUILD_STATS.richBlocksRendered}`);
    console.log(`Links Internos Insertados: ${BUILD_STATS.internalLinksInserted}`);
    console.log(`Bloques Recomendados Generados: ${BUILD_STATS.recommendedBlocksGenerated}`);
    console.log(`Posts sin Recomendaciones: ${BUILD_STATS.postsWithoutRecommendations}`);
    console.log(`Warnings Totales:  ${BUILD_STATS.warnings.length}`);

    if (BUILD_STATS.warnings.length > 0) {
        console.log('\nDetalle de Warnings:');
        BUILD_STATS.warnings.forEach(w => console.log(` - ${w}`));
    }
    console.log('=======================================\n');


    console.log('Build completed successfully.');
}

build().catch(error => {
    console.error('Build failed:', error);
    process.exit(1);
});
