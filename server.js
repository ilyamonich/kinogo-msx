const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = 'https://hdkinoteatr.com';

// Разрешаем CORS для всех запросов
app.use(cors());
app.use(express.json());

// --------------------------------------------------------------
// 1. Функция извлечения прямой ссылки на видео
// --------------------------------------------------------------
async function extractVideoUrl(pageUrl) {
    try {
        const { data } = await axios.get(pageUrl, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        const $ = cheerio.load(data);

        // Ищем iframe плеера
        let iframeSrc = $('iframe[src*="/engine/player/"]').first().attr('src');
        if (!iframeSrc) {
            iframeSrc = $('iframe').first().attr('src');
        }
        if (!iframeSrc) return null;

        const playerUrl = iframeSrc.startsWith('http') ? iframeSrc : BASE_URL + iframeSrc;
        const playerRes = await axios.get(playerUrl, {
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const $player = cheerio.load(playerRes.data);

        // Ищем video source или m3u8 в скриптах
        let videoSrc = $player('video source').first().attr('src');
        if (!videoSrc) {
            const scripts = $player('script').map((i, el) => $(el).html()).get();
            for (const script of scripts) {
                const match = script.match(/(https?:\/\/[^\s"']+\.m3u8[^\s"']*)/);
                if (match) {
                    videoSrc = match[1];
                    break;
                }
            }
        }
        return videoSrc || null;
    } catch (error) {
        console.error('[Ошибка извлечения видео]', error.message);
        return null;
    }
}

// --------------------------------------------------------------
// 2. Функция получения списка фильмов с главной страницы
// --------------------------------------------------------------
async function getMoviesList() {
    try {
        const { data } = await axios.get(BASE_URL, {
            timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const $ = cheerio.load(data);
        const movies = [];

        // Селекторы под сайт hdkinoteatr.com (могут потребовать обновления)
        $('.shortstory').each((i, el) => {
            let titleEl = $(el).find('.shortstory__title a');
            let title = titleEl.text().trim();
            let link = titleEl.attr('href');

            if (!title) {
                titleEl = $(el).find('h2 a');
                title = titleEl.text().trim();
                link = titleEl.attr('href');
            }
            const poster = $(el).find('.shortstory__image img').attr('src');

            if (title && link) {
                const fullLink = link.startsWith('http') ? link : BASE_URL + link;
                movies.push({
                    title: title,
                    poster: poster ? (poster.startsWith('http') ? poster : BASE_URL + poster) : '',
                    link: fullLink
                });
            }
        });

        // Возвращаем первые 30 фильмов
        return movies.slice(0, 30);
    } catch (error) {
        console.error('[Ошибка парсинга списка]', error.message);
        return [];
    }
}

// --------------------------------------------------------------
// 3. Обработчики для MSX (пути /msx/...)
// --------------------------------------------------------------
// start.json – главное меню
app.get('/msx/start.json', (req, res) => {
    console.log('[GET] /msx/start.json');
    res.json({
        settings: {
            title: 'HDkinoteatr',
            bgColor: '#0A0A0A',
            textColor: '#FFFFFF'
        },
        menu: [
            {
                title: '🎬 Новинки фильмов',
                type: 'link',
                target: '/msx/movies.json'
            }
        ]
    });
});

// movies.json – список фильмов
app.get('/msx/movies.json', async (req, res) => {
    console.log('[GET] /msx/movies.json');
    const movies = await getMoviesList();
    if (movies.length === 0) {
        return res.status(500).json({ error: 'Не удалось загрузить список фильмов' });
    }

    // Преобразуем в формат MSX
    const items = movies.map(movie => ({
        title: movie.title,
        type: 'video',
        poster: movie.poster,
        url: `/msx/movie.json?url=${encodeURIComponent(movie.link)}`
    }));

    res.json({
        settings: { title: 'Новинки кино', bgColor: '#0A0A0A' },
        items: items
    });
});

// movie.json – получает ссылку на видео по URL страницы фильма
app.get('/msx/movie.json', async (req, res) => {
    const moviePageUrl = req.query.url;
    if (!moviePageUrl) {
        return res.status(400).json({ error: 'Не указан URL фильма' });
    }
    console.log(`[GET] /msx/movie.json?url=${moviePageUrl}`);
    const videoUrl = await extractVideoUrl(moviePageUrl);
    if (videoUrl) {
        res.json({
            settings: { title: 'Плеер', bgColor: '#000000' },
            items: [{ title: 'Смотреть', type: 'video', url: videoUrl }]
        });
    } else {
        // Если видео не найдено – открываем страницу фильма в HTML-режиме (fallback)
        res.json({
            settings: { title: 'Ошибка', bgColor: '#000000' },
            items: [{
                title: 'Видео не найдено. Открыть страницу фильма?',
                type: 'html',
                url: moviePageUrl
            }]
        });
    }
});

// --------------------------------------------------------------
// 4. Корневые маршруты (для проверки и редиректов)
// --------------------------------------------------------------
app.get('/', (req, res) => {
    res.send('MSX сервер для HDkinoteatr работает. Используйте /msx/start.json');
});

// --------------------------------------------------------------
// 5. Запуск сервера
// --------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`✅ HD КиноТеатр MSX запущен на порту ${PORT}`);
    console.log(`🌐 start.json: http://localhost:${PORT}/msx/start.json`);
    console.log(`📋 movies.json: http://localhost:${PORT}/msx/movies.json`);
});
