const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = 'https://hdkinoteatr.com';

// Разрешаем CORS для всех запросов
app.use(cors());

// --------------------------------------------------------------
// 1. Отдача статики (если нужна) – не обязательно, но оставим
// --------------------------------------------------------------
app.use(express.json());

// --------------------------------------------------------------
// 2. Вспомогательная функция: извлечение прямой ссылки на видео
// --------------------------------------------------------------
async function extractVideoUrl(pageUrl) {
    try {
        const { data } = await axios.get(pageUrl, { timeout: 15000 });
        const $ = cheerio.load(data);

        // Ищем iframe плеера
        let iframeSrc = $('iframe[src*="/engine/player/"]').first().attr('src');
        if (!iframeSrc) {
            iframeSrc = $('iframe').first().attr('src');
        }
        if (!iframeSrc) return null;

        const playerUrl = iframeSrc.startsWith('http') ? iframeSrc : BASE_URL + iframeSrc;
        const playerRes = await axios.get(playerUrl, { timeout: 10000 });
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
        console.error(`[Ошибка извлечения видео] ${pageUrl}:`, error.message);
        return null;
    }
}

// --------------------------------------------------------------
// 3. Получение списка фильмов с главной страницы
// --------------------------------------------------------------
async function getMoviesList() {
    try {
        const { data } = await axios.get(BASE_URL, { timeout: 15000 });
        const $ = cheerio.load(data);
        const movies = [];

        // Селекторы для карточек фильмов на hdkinoteatr.com
        $('.shortstory').each((i, el) => {
            let titleEl = $(el).find('.shortstory__title a');
            let title = titleEl.text().trim();
            let link = titleEl.attr('href');

            // Fallback: если не нашли, пробуем h2 a
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

        // Ограничим первыми 30 фильмами для быстрой загрузки
        return movies.slice(0, 30);
    } catch (error) {
        console.error('[Ошибка парсинга списка]', error.message);
        return [];
    }
}

// --------------------------------------------------------------
// 4. Маршруты для MSX (все внутри /msx)
// --------------------------------------------------------------
const msxRouter = express.Router();

// start.json – главное меню
msxRouter.get('/start.json', (req, res) => {
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

// movies.json – список фильмов (генерируется динамически)
msxRouter.get('/movies.json', async (req, res) => {
    console.log('[Запрос] /msx/movies.json');
    const movies = await getMoviesList();
    if (movies.length === 0) {
        return res.status(500).json({ error: 'Не удалось загрузить список фильмов' });
    }

    // Преобразуем в формат MSX
    const items = movies.map(movie => ({
        title: movie.title,
        type: 'video',         // MSX откроет плеер, но нужен ещё один запрос для получения ссылки
        poster: movie.poster,
        url: `/msx/movie.json?url=${encodeURIComponent(movie.link)}`
    }));

    res.json({
        settings: {
            title: 'Новинки кино',
            bgColor: '#0A0A0A'
        },
        items: items
    });
});

// movie.json – получает ссылку на видео по URL страницы фильма
msxRouter.get('/movie.json', async (req, res) => {
    const moviePageUrl = req.query.url;
    if (!moviePageUrl) {
        return res.status(400).json({ error: 'Не указан URL фильма' });
    }
    console.log(`[Запрос видео] ${moviePageUrl}`);
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

// Подключаем роутер /msx
app.use('/msx', msxRouter);

// --------------------------------------------------------------
// 5. Редиректы с корня на /msx (удобно для проверки)
// --------------------------------------------------------------
app.get('/', (req, res) => {
    res.redirect('/msx/start.json');
});
app.get('/start.json', (req, res) => {
    res.redirect('/msx/start.json');
});
app.get('/movies.json', (req, res) => {
    res.redirect('/msx/movies.json');
});

// --------------------------------------------------------------
// 6. Запуск сервера
// --------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`✅ MSX Сервер для HDkinoteatr запущен на порту ${PORT}`);
    console.log(`🌐 start.json: https://localhost:${PORT}/msx/start.json (или ваш домен)`);
    console.log(`📋 movies.json: https://localhost:${PORT}/msx/movies.json`);
});
