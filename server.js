const express = require('express');
const { getLatest, getCategory, getMovieDetail, search } = require('./scraper');

const app = express();
const PORT = 5000;

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
});

function baseUrl(req) {
    const host = process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : `${req.protocol}://${req.get('host')}`;
    return host;
}

const CATEGORIES = [
    { slug: 'action',      label: 'Боевики',        icon: 'local_fire_department' },
    { slug: 'comedy',      label: 'Комедии',         icon: 'sentiment_very_satisfied' },
    { slug: 'drama',       label: 'Драмы',           icon: 'theater_comedy' },
    { slug: 'fantasy',     label: 'Фэнтези',         icon: 'auto_fix_high' },
    { slug: 'horror',      label: 'Ужасы',           icon: 'pest_control' },
    { slug: 'sci-fi',      label: 'Фантастика',      icon: 'rocket_launch' },
    { slug: 'thriller',    label: 'Триллеры',        icon: 'remove_red_eye' },
    { slug: 'serial',      label: 'Сериалы',         icon: 'live_tv' },
    { slug: 'animation',   label: 'Мультфильмы',     icon: 'animation' },
    { slug: 'documentry',  label: 'Документальные',  icon: 'videocam' },
];

// ─── MSX Start file ───────────────────────────────────────────────────────────
app.get('/start.json', (req, res) => {
    const base = baseUrl(req);
    res.json({
        name: 'HD КиноТеатр',
        version: '1.0.0',
        parameter: `request:interaction:init@${base}/api/menu`,
    });
});

// ─── Main menu ────────────────────────────────────────────────────────────────
app.get('/api/menu', (req, res) => {
    const base = baseUrl(req);
    const items = [
        {
            type: 'default',
            label: '🎬 Новинки',
            action: `content:${base}/api/latest`,
        },
        {
            type: 'separator',
            label: 'Жанры',
        },
        ...CATEGORIES.map(cat => ({
            type: 'default',
            label: cat.label,
            action: `content:${base}/api/category/${cat.slug}`,
        })),
        {
            type: 'separator',
            label: ' ',
        },
        {
            type: 'default',
            label: '🔍 Поиск',
            action: `panel:search:request:interaction:execute@${base}/api/search?q={VALUE}`,
        },
    ];

    res.json({
        settings: {
            title: 'HD КиноТеатр',
            backgroundColor: '#111111',
        },
        items,
    });
});

// ─── Latest movies ────────────────────────────────────────────────────────────
app.get('/api/latest', async (req, res) => {
    const base = baseUrl(req);
    try {
        const movies = await getLatest();
        res.json(buildMovieList(movies, 'Новинки', base));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Category ─────────────────────────────────────────────────────────────────
app.get('/api/category/:slug', async (req, res) => {
    const base = baseUrl(req);
    const { slug } = req.params;
    const page = parseInt(req.query.page) || 1;
    const cat = CATEGORIES.find(c => c.slug === slug);
    const title = cat ? cat.label : slug;

    try {
        const movies = await getCategory(slug, page);
        const list = buildMovieList(movies, title, base);

        // Add next page button
        if (movies.length >= 10) {
            list.items.push({
                type: 'default',
                label: `Страница ${page + 1} →`,
                action: `content:${base}/api/category/${slug}?page=${page + 1}`,
            });
        }

        res.json(list);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Movie detail ─────────────────────────────────────────────────────────────
app.get('/api/movie', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url is required' });

    try {
        const detail = await getMovieDetail(url);
        const items = [];

        if (detail.description) {
            items.push({
                type: 'default',
                label: detail.description,
                enable: false,
                color: 'msx-grey',
            });
        }

        const playablePlayers = detail.players.filter(p =>
            !p.url.includes('youtube.com')
        );
        const trailers = detail.players.filter(p =>
            p.url.includes('youtube.com')
        );

        if (playablePlayers.length === 0 && trailers.length === 0) {
            items.push({
                type: 'default',
                label: '🌐 Открыть страницу фильма',
                action: `iframe:${url}`,
            });
        } else {
            playablePlayers.forEach(player => {
                items.push({
                    type: 'default',
                    label: player.label,
                    action: `iframe:${player.url}`,
                });
            });
            trailers.forEach(player => {
                items.push({
                    type: 'default',
                    label: player.label,
                    action: `iframe:${player.url}`,
                });
            });
        }

        res.json({
            settings: {
                title: detail.title,
                backgroundColor: '#111111',
                backgroundImage: detail.poster,
                backgroundImageBlur: true,
            },
            items,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Search ───────────────────────────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
    const base = baseUrl(req);
    const q = req.query.q || '';
    if (!q.trim()) return res.json({ settings: { title: 'Поиск' }, items: [] });

    try {
        const movies = await search(q);
        res.json(buildMovieList(movies, `Поиск: ${q}`, base));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Helper ───────────────────────────────────────────────────────────────────
function buildMovieList(movies, title, base) {
    const items = movies.map(m => ({
        type: 'default',
        title: m.title,
        titleFooter: [m.year, m.hd].filter(Boolean).join(' • '),
        image: m.poster,
        imageFull: m.fullImg || m.poster,
        action: `content:${base}/api/movie?url=${encodeURIComponent(m.href)}`,
    }));

    return {
        settings: {
            title,
            view: 3,
            backgroundColor: '#111111',
        },
        items,
    };
}

// ─── Info page ────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    const base = baseUrl(req);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HD КиноТеатр — MSX</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #111; color: #eee; font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: #1e1e1e; border-radius: 12px; padding: 40px; max-width: 520px; width: 100%; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
    h1 { font-size: 1.8rem; margin-bottom: 8px; color: #fff; }
    p { color: #aaa; margin-bottom: 24px; line-height: 1.6; }
    .badge { display: inline-block; background: #e53935; color: #fff; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; font-weight: bold; margin-bottom: 16px; letter-spacing: 1px; }
    .url-box { background: #2a2a2a; border: 1px solid #444; border-radius: 8px; padding: 14px 16px; font-family: monospace; font-size: 0.95rem; color: #7ec8e3; word-break: break-all; margin-bottom: 24px; }
    .steps { list-style: none; counter-reset: steps; }
    .steps li { counter-increment: steps; display: flex; gap: 14px; margin-bottom: 14px; align-items: flex-start; }
    .steps li::before { content: counter(steps); background: #e53935; color: #fff; min-width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.85rem; flex-shrink: 0; }
    .steps li span { color: #ccc; line-height: 1.6; padding-top: 4px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">MSX</div>
    <h1>HD КиноТеатр</h1>
    <p>Веб-приложение для Media Station X на базе hdkinoteatr.com</p>
    <div class="url-box">${base}/start.json</div>
    <ol class="steps">
      <li><span>Откройте <strong>Media Station X</strong> на вашем устройстве</span></li>
      <li><span>Перейдите в <strong>Настройки → Источник контента</strong></span></li>
      <li><span>Введите URL выше и нажмите <strong>OK</strong></span></li>
    </ol>
  </div>
</body>
</html>`);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`HD КиноТеатр MSX запущен на порту ${PORT}`);
});
