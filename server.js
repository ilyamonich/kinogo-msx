const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;
const KINOGO_BASE = 'https://kinogo.pro';

// Включаем CORS для запросов с телевизора
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Увеличиваем лимит JSON (на всякий случай)
app.use(express.json({ limit: '10mb' }));

// ------------------- Вспомогательная функция извлечения видео -------------------
async function extractVideoUrl(pageUrl) {
    try {
        const { data } = await axios.get(pageUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });
        const $ = cheerio.load(data);
        
        // Ищем iframe плеера (типичный путь на kinogo)
        let iframeSrc = $('iframe[src*="/engine/player/"]').first().attr('src');
        if (!iframeSrc) {
            // Альтернативный поиск
            iframeSrc = $('iframe[src*="video"]').first().attr('src');
        }
        if (!iframeSrc) return null;
        
        const playerUrl = iframeSrc.startsWith('http') ? iframeSrc : KINOGO_BASE + iframeSrc;
        const playerRes = await axios.get(playerUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 10000
        });
        const $player = cheerio.load(playerRes.data);
        
        // Пытаемся найти video src
        let videoSrc = $player('video source').first().attr('src');
        if (!videoSrc) {
            // Ищем m3u8 ссылку в скриптах
            const scripts = $player('script').map((i, el) => $(el).html()).get();
            for (const script of scripts) {
                if (!script) continue;
                const match = script.match(/(https?:\/\/[^\s"']+\.m3u8[^\s"']*)/);
                if (match) {
                    videoSrc = match[1];
                    break;
                }
            }
        }
        return videoSrc || null;
    } catch (error) {
        console.error(`extractVideoUrl error for ${pageUrl}:`, error.message);
        return null;
    }
}

// ------------------- Маршрут для главного меню (ожидаемый MSX) -------------------
app.get('/msx/start.json', (req, res) => {
    res.json({
        settings: {
            title: 'Kinogo',
            bgColor: '#0A0A0A',
            textColor: '#FFFFFF'
        },
        menu: [
            {
                title: '🎬 Новинки фильмов',
                type: 'link',
                target: '/movies.json'
            }
        ]
    });
});

// ------------------- Маршрут для списка фильмов -------------------
app.get('/movies.json', async (req, res) => {
    try {
        console.log('[movies.json] Загружаем главную страницу kinogo.pro...');
        const { data } = await axios.get(KINOGO_BASE, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 15000
        });
        
        const $ = cheerio.load(data);
        
        // Пробуем разные селекторы (адаптация под возможные изменения сайта)
        let movieElements = $('.shortstory');
        if (movieElements.length === 0) movieElements = $('.movie-item');
        if (movieElements.length === 0) movieElements = $('.item');
        if (movieElements.length === 0) movieElements = $('.post');
        
        console.log(`[movies.json] Найдено элементов: ${movieElements.length}`);
        
        if (movieElements.length === 0) {
            // Для отладки: выводим небольшой фрагмент HTML, чтобы понять структуру
            const bodyHtml = $.html().substring(0, 500);
            console.error('[movies.json] Не удалось найти элементы фильмов. Фрагмент HTML:', bodyHtml);
            return res.status(500).json({ error: 'Не найдено элементов фильмов. Структура сайта изменилась.' });
        }
        
        const movies = [];
        // Ограничим первыми 20 фильмами для скорости
        const elementsToProcess = movieElements.slice(0, 20);
        
        for (const el of elementsToProcess.toArray()) {
            // Поиск заголовка и ссылки
            let titleEl = $(el).find('.shortstory__title a');
            if (titleEl.length === 0) titleEl = $(el).find('.title a');
            if (titleEl.length === 0) titleEl = $(el).find('h2 a');
            if (titleEl.length === 0) titleEl = $(el).find('a').first();
            
            const title = titleEl.text().trim();
            let link = titleEl.attr('href');
            
            if (!title || !link) continue;
            
            // Нормализация ссылки
            const fullLink = link.startsWith('http') ? link : KINOGO_BASE + link;
            
            // Постер
            let poster = $(el).find('.shortstory__image img').attr('src');
            if (!poster) poster = $(el).find('img').first().attr('src');
            if (poster && !poster.startsWith('http')) poster = KINOGO_BASE + poster;
            
            console.log(`[movies.json] Обработка: "${title}"`);
            
            // Извлекаем видео (можно закомментировать, если долго)
            let videoUrl = null;
            try {
                videoUrl = await extractVideoUrl(fullLink);
            } catch (e) {
                console.error(`[movies.json] Ошибка видео для ${title}:`, e.message);
            }
            
            movies.push({
                title: title,
                type: videoUrl ? 'video' : 'html',
                poster: poster || '',
                url: videoUrl || fullLink
            });
        }
        
        if (movies.length === 0) {
            console.error('[movies.json] Не удалось извлечь ни одного фильма.');
            return res.status(500).json({ error: 'Не удалось извлечь фильмы.' });
        }
        
        console.log(`[movies.json] Успешно получено ${movies.length} фильмов.`);
        res.json({
            settings: {
                title: 'Новинки кино',
                bgColor: '#0A0A0A'
            },
            items: movies
        });
    } catch (error) {
        console.error('[movies.json] Критическая ошибка:', error.message);
        if (error.response) {
            console.error('Статус ответа:', error.response.status);
        }
        res.status(500).json({ error: 'Не удалось загрузить фильмы: ' + error.message });
    }
});

// ------------------- Запасной маршрут для корня (не обязателен) -------------------
app.get('/', (req, res) => {
    res.send('Kinogo MSX server is running. Use /msx/start.json');
});

// ------------------- Запуск сервера -------------------
app.listen(PORT, () => {
    console.log(`✅ Сервер Kinogo для MSX запущен на порту ${PORT}`);
    console.log(`📺 Главное меню: http://localhost:${PORT}/msx/start.json`);
    console.log(`🎬 Список фильмов: http://localhost:${PORT}/movies.json`);
});
