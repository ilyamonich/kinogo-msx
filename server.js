const express = require('express');
const { connect } = require('puppeteer-real-browser');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const KINOGO_BASE = 'https://kinogo.pro';

// Автоматический поиск Chromium, установленного через puppeteer
let CHROME_PATH = null;
const possiblePaths = [
    path.join(__dirname, 'node_modules', 'puppeteer', '.local-chromium'),
    path.join(__dirname, 'node_modules', 'puppeteer-core', '.local-chromium')
];
for (const base of possiblePaths) {
    if (fs.existsSync(base)) {
        const dirs = fs.readdirSync(base).filter(d => d.startsWith('linux-'));
        if (dirs.length) {
            const candidate = path.join(base, dirs[0], 'chrome-linux', 'chrome');
            if (fs.existsSync(candidate)) {
                CHROME_PATH = candidate;
                break;
            }
        }
    }
}
if (CHROME_PATH) console.log(`✅ Chromium найден: ${CHROME_PATH}`);
else console.warn('⚠️ Chromium не найден, будет использован системный (если есть)');

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    next();
});

// Кэш страницы (10 минут)
let cachedHtml = null;
let cacheTime = null;
const CACHE_TTL = 10 * 60 * 1000;

// Функция получения HTML через браузер
async function fetchKinogoWithBrowser(url) {
    console.log(`[Browser] Запуск браузера для ${url}...`);
    let browser = null;
    try {
        const { page, browser: br } = await connect({
            headless: true,
            turnstile: true,
            connectOption: {
                defaultViewport: null,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
                ...(CHROME_PATH && { executablePath: CHROME_PATH })
            }
        });
        browser = br;
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForSelector('.shortstory, .movie-item, .item', { timeout: 30000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 3000));
        const html = await page.content();
        console.log(`[Browser] Загружено ${html.length} символов`);
        return html;
    } catch (err) {
        console.error('[Browser] Ошибка:', err);
        throw err;
    } finally {
        if (browser) await browser.close();
    }
}

// Извлечение видео (упрощённо, без браузера для каждого фильма – для экономии памяти)
async function extractVideoUrlSimple(pageUrl) {
    try {
        const { page, browser } = await connect({
            headless: true,
            turnstile: true,
            connectOption: {
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
                ...(CHROME_PATH && { executablePath: CHROME_PATH })
            }
        });
        await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 45000 });
        const iframeSrc = await page.evaluate(() => {
            const iframe = document.querySelector('iframe[src*="/engine/player/"]') || document.querySelector('iframe[src*="video"]');
            return iframe ? iframe.src : null;
        });
        if (!iframeSrc) return null;
        await page.goto(iframeSrc, { waitUntil: 'networkidle2', timeout: 30000 });
        const videoUrl = await page.evaluate(() => {
            const video = document.querySelector('video source');
            if (video && video.src) return video.src;
            const scripts = Array.from(document.querySelectorAll('script'));
            for (let s of scripts) {
                const match = s.innerHTML.match(/(https?:\/\/[^\s"']+\.m3u8[^\s"']*)/);
                if (match) return match[1];
            }
            return null;
        });
        await browser.close();
        return videoUrl;
    } catch (e) {
        console.error(`Video error ${pageUrl}:`, e.message);
        return null;
    }
}

// Маршруты
app.get('/msx/start.json', (req, res) => {
    res.json({
        settings: { title: 'Kinogo', bgColor: '#0A0A0A', textColor: '#FFFFFF' },
        menu: [{ title: '🎬 Новинки фильмов', type: 'link', target: '/movies.json' }]
    });
});

app.get('/movies.json', async (req, res) => {
    try {
        if (!cachedHtml || !cacheTime || Date.now() - cacheTime > CACHE_TTL) {
            console.log('[movies.json] Загружаем свежую страницу...');
            cachedHtml = await fetchKinogoWithBrowser(KINOGO_BASE);
            cacheTime = Date.now();
        }
        const $ = cheerio.load(cachedHtml);
        let movieElements = $('.shortstory');
        if (movieElements.length === 0) movieElements = $('.movie-item');
        if (movieElements.length === 0) movieElements = $('.item');
        console.log(`[movies.json] Найдено элементов: ${movieElements.length}`);
        if (movieElements.length === 0) throw new Error('Элементы не найдены');
        
        const movies = [];
        const limit = 10; // уменьшим до 10 для экономии памяти
        for (const el of movieElements.slice(0, limit).toArray()) {
            let titleEl = $(el).find('.shortstory__title a');
            if (!titleEl.length) titleEl = $(el).find('.title a');
            if (!titleEl.length) titleEl = $(el).find('h2 a');
            const title = titleEl.text().trim();
            let link = titleEl.attr('href');
            if (!title || !link) continue;
            const fullLink = link.startsWith('http') ? link : KINOGO_BASE + link;
            let poster = $(el).find('.shortstory__image img').attr('src') || $(el).find('img').first().attr('src');
            if (poster && !poster.startsWith('http')) poster = KINOGO_BASE + poster;
            console.log(`Обработка: ${title}`);
            let videoUrl = null;
            try {
                videoUrl = await extractVideoUrlSimple(fullLink);
            } catch(e) { /* игнор */ }
            movies.push({
                title,
                type: videoUrl ? 'video' : 'html',
                poster: poster || '',
                url: videoUrl || fullLink
            });
        }
        if (movies.length === 0) throw new Error('Нет фильмов');
        res.json({ settings: { title: 'Новинки кино', bgColor: '#0A0A0A' }, items: movies });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/', (req, res) => res.send('Kinogo MSX server'));

app.listen(PORT, () => console.log(`✅ Сервер на порту ${PORT}`));
