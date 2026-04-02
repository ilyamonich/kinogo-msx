const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;
const NEW_BASE_URL = 'https://hdkinoteatr.com';

// --- Функция для извлечения ссылки на видео ---
async function extractVideoUrl(pageUrl) {
    try {
        // 1. Загружаем страницу фильма
        const { data } = await axios.get(pageUrl);
        const $ = cheerio.load(data);

        // 2. Ищем iframe плеера. Селектор может быть "iframe[src*='/engine/player/']"
        // или просто первый iframe на странице. Попробуем оба варианта.
        let iframeSrc = $('iframe[src*="/engine/player/"]').first().attr('src');
        if (!iframeSrc) {
            iframeSrc = $('iframe').first().attr('src');
        }
        if (!iframeSrc) return null;

        const playerUrl = iframeSrc.startsWith('http') ? iframeSrc : NEW_BASE_URL + iframeSrc;

        // 3. Загружаем страницу плеера
        const playerRes = await axios.get(playerUrl);
        const $player = cheerio.load(playerRes.data);

        // 4. Ищем ссылку на видео (.m3u8 или .mp4)
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
        console.error(`[Parser Error] Не удалось извлечь видео с ${pageUrl}:`, error.message);
        return null;
    }
}

// --- Эндпоинт: список фильмов ---
app.get('/movies.json', async (req, res) => {
    try {
        console.log('[INFO] Запрос списка фильмов...');
        const { data } = await axios.get(NEW_BASE_URL);
        const $ = cheerio.load(data);
        const movies = [];

        // Используем актуальный селектор для карточек фильмов на главной странице
        $('.shortstory').each((i, el) => {
            const titleEl = $(el).find('.shortstory__title a');
            let title = titleEl.text().trim();
            let link = titleEl.attr('href');

            // Если title не найден, пробуем другой селектор
            if (!title) {
                const altTitleEl = $(el).find('h2 a');
                title = altTitleEl.text().trim();
                link = altTitleEl.attr('href');
            }
            
            const poster = $(el).find('.shortstory__image img').attr('src');
            
            if (title && link) {
                const fullLink = link.startsWith('http') ? link : NEW_BASE_URL + link;
                movies.push({
                    title: title,
                    type: 'video', // Указываем тип, чтобы MSX открывал плеер
                    poster: poster ? (poster.startsWith('http') ? poster : NEW_BASE_URL + poster) : '',
                    url: fullLink, // Сохраняем ссылку на страницу фильма
                });
            }
        });

        // Ограничим количество фильмов для быстрой загрузки, например, первыми 20
        const limitedMovies = movies.slice(0, 20);
        console.log(`[INFO] Успешно получено ${limitedMovies.length} фильмов.`);

        res.json({
            settings: { title: 'Новинки HDkinoteatr', bgColor: '#0A0A0A' },
            items: limitedMovies
        });
    } catch (error) {
        console.error('[Server Error] Ошибка при получении списка фильмов:', error);
        res.status(500).json({ error: 'Не удалось загрузить список фильмов' });
    }
});

// --- Эндпоинт: страница фильма (генерирует ссылку на видео) ---
// Этот эндпоинт вызывается, когда пользователь выбирает фильм.
app.get('/movie.json', async (req, res) => {
    const moviePageUrl = req.query.url;
    if (!moviePageUrl) {
        return res.status(400).json({ error: 'URL фильма не указан' });
    }

    try {
        console.log(`[INFO] Обработка фильма: ${moviePageUrl}`);
        const videoUrl = await extractVideoUrl(moviePageUrl);
        
        if (videoUrl) {
            // Если нашли видео, возвращаем данные для MSX плеера
            res.json({
                settings: { title: 'Плеер', bgColor: '#000000' },
                items: [{
                    title: 'Смотреть',
                    type: 'video',
                    url: videoUrl
                }]
            });
        } else {
            // Если видео не найдено, возвращаем HTML-страницу (как fallback)
            console.warn(`[WARN] Видео не найдено для ${moviePageUrl}, возвращаем HTML.`);
            res.json({
                settings: { title: 'Ошибка', bgColor: '#000000' },
                items: [{
                    title: 'Видео не найдено. Открыть страницу фильма?',
                    type: 'html',
                    url: moviePageUrl
                }]
            });
        }
    } catch (error) {
        console.error(`[Server Error] Ошибка при обработке фильма ${moviePageUrl}:`, error);
        res.status(500).json({ error: 'Ошибка сервера при обработке фильма' });
    }
});

// --- Корневой эндпоинт (start.json) ---
app.get('/start.json', (req, res) => {
    res.json({
        settings: { title: 'HDkinoteatr', bgColor: '#0A0A0A', textColor: '#FFFFFF' },
        menu: [
            { title: '🎬 Новинки фильмов', type: 'link', target: '/movies.json' }
        ]
    });
});

app.listen(PORT, () => {
    console.log(`✅ MSX Сервер для HDkinoteatr запущен!`);
    console.log(`🌐 Адрес для настройки в MSX: http://localhost:${PORT}/start.json`);
    console.log(`📋 Проверьте список фильмов: http://localhost:${PORT}/movies.json`);
});
