const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = 'https://hdkinoteatr.com';

app.use(cors());
app.use(express.json());

// --------------------------------------------------------------
// 1. Функция извлечения прямой ссылки на видео
// --------------------------------------------------------------
async function extractVideoUrl(pageUrl) {
    try {
        const { data } = await axios.get(pageUrl, { timeout: 15000 });
        const $ = cheerio.load(data);

        let iframeSrc = $('iframe[src*="/engine/player/"]').first().attr('src');
        if (!iframeSrc) iframeSrc = $('iframe').first().attr('src');
        if (!iframeSrc) return null;

        const playerUrl = iframeSrc.startsWith('http') ? iframeSrc : BASE_URL + iframeSrc;
        const playerRes = await axios.get(playerUrl, { timeout: 10000 });
        const $player = cheerio.load(playerRes.data);

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
// 2. Функция получения списка фильмов
// --------------------------------------------------------------
async function getMoviesList() {
    try {
        const { data } = await axios.get(BASE_URL, { timeout: 15000 });
        const $ = cheerio.load(data);
        const movies = [];

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
        return movies.slice(0, 30);
    } catch (error) {
        console.error('[Ошибка парсинга списка]', error.message);
        return [];
    }
}

// --------------------------------------------------------------
// 3. Обработчики для КОРНЕВЫХ маршрутов (то, что нужно MSX)
// --------------------------------------------------------------
app.get('/start.json', (req, res) => {
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
                target: '/movies.json'   // ссылка на корневой movies.json
            }
        ]
    });
});

app.get('/movies.json', async (req, res) => {
    console.log('[Запрос] /movies.json');
    const movies = await getMoviesList();
    if (movies.length === 0) {
        return res.status(500).json({ error: 'Не удалось загрузить список фильмов' });
    }

    const items = movies.map(movie => ({
        title: movie.title,
        type: 'video',
        poster: movie.poster,
        url: `/movie.json?url=${encodeURIComponent(movie.link)}`  // ссылка на корневой movie.json
    }));

    res.json({
        settings: { title: 'Новинки кино', bgColor: '#0A0A0A' },
        items: items
    });
});

app.get('/movie.json', async (req, res) => {
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
        res.json({
            settings: { title: 'Ошибка', bgColor: '#000000' },
            items: [{
                title: 'Видео не найдено. Открыть страницу?',
                type: 'html',
                url: moviePageUrl
            }]
        });
    }
});

// --------------------------------------------------------------
// 4. (Опционально) Обработчики для /msx/... – для обратной совместимости
// --------------------------------------------------------------
app.get('/msx/start.json', (req, res) => res.redirect('/start.json'));
app.get('/msx/movies.json', (req, res) => res.redirect('/movies.json'));
app.get('/msx/movie.json', (req, res) => {
    // Перенаправляем с сохранением query-параметров
    const url = req.query.url;
    if (url) res.redirect(`/movie.json?url=${encodeURIComponent(url)}`);
    else res.redirect('/movie.json');
});

// --------------------------------------------------------------
// 5. Запуск
// --------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`📌 start.json: http://localhost:${PORT}/start.json`);
    console.log(`📌 movies.json: http://localhost:${PORT}/movies.json`);
});
