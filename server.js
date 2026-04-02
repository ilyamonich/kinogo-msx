const express = require('express');
const { connect } = require('puppeteer-real-browser');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;
const KINOGO_BASE = 'https://kinogo.pro';

// Кэш для страницы (чтобы не запускать браузер на каждый запрос)
let cachedHtml = null;
let cacheTime = null;
const CACHE_TTL = 10 * 60 * 1000; // 10 минут

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

app.use(express.json({ limit: '10mb' }));

// ------------------- Функция получения HTML через реальный браузер -------------------
async function fetchKinogoWithBrowser(url) {
    console.log(`[Browser] Запуск браузера для ${url}...`);
    let browser = null;
    try {
        const { page, browser: br } = await connect({
            headless: true,               // Работает в фоне
            turnstile: true,              // Автоматически решает капчи Turnstile
            connectOption: {
                defaultViewport: null,    // Адаптивный размер
                args: [
                    '--no-sandbox',        // Обязательно для окружений без графики (Render)
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu'
                ]
            }
        });
        browser = br;
        
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        // Ждём, пока появятся элементы фильмов или страница полностью загрузится
        await page.waitForSelector('.shortstory, .movie-item, .item', { timeout: 30000 }).catch(() => {});
        // Дополнительная задержка для полного рендера
        await page.waitForTimeout(3000);
        
        const html = await page.content();
        console.log(`[Browser] Страница загружена, длина HTML: ${html.length}`);
        return html;
    } catch (error) {
        console.error('[Browser] Ошибка:', error);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
            console.log('[Browser] Браузер закрыт');
        }
    }
}

// ------------------- Вспомогательная функция извлечения видео (через браузер) -------------------
async function extractVideoUrlWithBrowser(pageUrl) {
    let browser = null;
    try {
        const { page, browser: br } = await connect({
            headless: true,
            turnstile: true,
            connectOption: {
                defaultViewport: null,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
            }
        });
        browser = br;
        
        await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 45000 });
        await page.waitForSelector('iframe[src*="/engine/player/"], iframe[src*="video"], video', { timeout: 20000 }).catch(() => {});
        
        // Извлекаем iframe
        const iframeSrc = await page.evaluate(() => {
            const iframe = document.querySelector('iframe[src*="/engine/player/"]') || document.querySelector('iframe[src*="video"]');
            return iframe ? iframe.src : null;
        });
        
        if (!iframeSrc) return null;
        
        // Загружаем iframe
        await page.goto(iframeSrc, { waitUntil: 'networkidle2', timeout: 30000 });
        await page.waitForSelector('video, script', { timeout: 15000 }).catch(() => {});
        
        // Ищем прямую ссылку на видео
        const videoUrl = await page.evaluate(() => {
            const video = document.querySelector('video source');
            if (video && video.src) return video.src;
            // Ищем m3u8 в скриптах
            const scripts = Array.from(document.querySelectorAll('script'));
            for (const script of scripts) {
                const match = script.innerHTML.match(/(https?:\/\/[^\s"']+\.m3u8[^\s"']*)/);
                if (match) return match[1];
            }
            return null;
        });
        
        return videoUrl;
    } catch (error) {
        console.error(`[Video] Ошибка для ${pageUrl}:`, error.message);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

// ------------------- Маршрут для главного меню -------------------
app.get('/msx/start.json', (req, res) => {
    res.json({
        settings: { title: 'Kinogo', bgColor: '#0A0A0A', textColor: '#FFFFFF' },
        menu: [{ title: '🎬 Новинки фильмов', type: 'link', target: '/movies.json' }]
    });
});

// ------------------- Маршрут для списка фильмов -------------------
app.get('/movies.json', async (req, res) => {
    try {
        // Проверяем кэш
        if (cachedHtml && cacheTime && (Date.now() - cacheTime < CACHE_TTL)) {
            console.log('[movies.json] Используем кэшированную страницу');
        } else {
            console.log('[movies.json] Загружаем свежую страницу через браузер...');
            cachedHtml = await fetchKinogoWithBrowser(KINOGO_BASE);
            cacheTime = Date.now();
        }
        
        const $ = cheerio.load(cachedHtml);
        
        let movieElements = $('.shortstory');
        if (movieElements.length === 0) movieElements = $('.movie-item');
        if (movieElements.length === 0) movieElements = $('.item');
        if (movieElements.length === 0) movieElements = $('.post');
        
        console.log(`[movies.json] Найдено элементов: ${movieElements.length}`);
        
        if (movieElements.length === 0) {
            console.error('[movies.json] Не найдены элементы. HTML фрагмент:', cachedHtml.substring(0, 500));
            return res.status(500).json({ error: 'Не найдены элементы фильмов' });
        }
        
        const movies = [];
        const elementsToProcess = movieElements.slice(0, 15); // Ограничим 15 для скорости
        
        for (const el of elementsToProcess.toArray()) {
            let titleEl = $(el).find('.shortstory__title a');
            if (titleEl.length === 0) titleEl = $(el).find('.title a');
            if (titleEl.length === 0) titleEl = $(el).find('h2 a');
            if (titleEl.length === 0) titleEl = $(el).find('a').first();
            
            const title = titleEl.text().trim();
            let link = titleEl.attr('href');
            if (!title || !link) continue;
            
            const fullLink = link.startsWith('http') ? link : KINOGO_BASE + link;
            
            let poster = $(el).find('.shortstory__image img').attr('src');
            if (!poster) poster = $(el).find('img').first().attr('src');
            if (poster && !poster.startsWith('http')) poster = KINOGO_BASE + poster;
            
            console.log(`[movies.json] Обработка: ${title}`);
            
            // Извлекаем видео (можно отключить для скорости, тогда будет type="html")
            let videoUrl = null;
            try {
                videoUrl = await extractVideoUrlWithBrowser(fullLink);
            } catch (e) {
                console.error(`Видео ошибка для ${title}:`, e.message);
            }
            
            movies.push({
                title,
                type: videoUrl ? 'video' : 'html',
                poster: poster || '',
                url: videoUrl || fullLink
            });
        }
        
        if (movies.length === 0) throw new Error('Не удалось извлечь фильмы');
        
        console.log(`[movies.json] Успешно: ${movies.length} фильмов`);
        res.json({ settings: { title: 'Новинки кино', bgColor: '#0A0A0A' }, items: movies });
    } catch (error) {
        console.error('[movies.json] Ошибка:', error);
        res.status(500).json({ error: `Ошибка: ${error.message}` });
    }
});

app.get('/', (req, res) => res.send('Kinogo MSX server is running. Use /msx/start.json'));

app.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`📺 Главное меню: http://localhost:${PORT}/msx/start.json`);
    console.log(`🎬 Список фильмов: http://localhost:${PORT}/movies.json`);
});
