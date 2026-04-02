const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;
const KINOGO_BASE = 'https://kinogo.pro';

// Вспомогательная функция для извлечения ссылки на видео
async function extractVideoUrl(pageUrl) {
    try {
        const { data } = await axios.get(pageUrl);
        const $ = cheerio.load(data);
        const iframeSrc = $('iframe[src*="/engine/player/"]').first().attr('src');
        if (!iframeSrc) return null;
        
        const playerUrl = iframeSrc.startsWith('http') ? iframeSrc : KINOGO_BASE + iframeSrc;
        const playerRes = await axios.get(playerUrl);
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
        console.error(`Error extracting video from ${pageUrl}:`, error.message);
        return null;
    }
}

// Эндпоинт для получения списка фильмов
app.get('/movies.json', async (req, res) => {
    try {
        const { data } = await axios.get(KINOGO_BASE);
        const $ = cheerio.load(data);
        const movies = [];

        for (const el of $('.shortstory').toArray()) {
            const titleEl = $(el).find('.shortstory__title a');
            const title = titleEl.text().trim();
            const link = titleEl.attr('href');
            const poster = $(el).find('.shortstory__image img').attr('src');
            
            if (title && link) {
                const fullLink = link.startsWith('http') ? link : KINOGO_BASE + link;
                const videoUrl = await extractVideoUrl(fullLink);
                movies.push({
                    title: title,
                    type: videoUrl ? 'video' : 'html',
                    poster: poster ? (poster.startsWith('http') ? poster : KINOGO_BASE + poster) : '',
                    url: videoUrl || fullLink
                });
            }
        }

        res.json({
            settings: { title: 'Новинки кино', bgColor: '#0A0A0A' },
            items: movies
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to load movies' });
    }
});

// Корневой эндпоинт для проверки работы сервера
app.get('/start.json', (req, res) => {
    res.json({
        settings: { title: 'Kinogo', bgColor: '#0A0A0A', textColor: '#FFFFFF' },
        menu: [{ title: '🎬 Новинки фильмов', type: 'link', target: '/movies.json' }]
    });
});

app.listen(PORT, () => {
    console.log(`MSX Kinogo service running on http://localhost:${PORT}`);
    console.log(`- start.json: http://localhost:${PORT}/start.json`);
    console.log(`- movies.json: http://localhost:${PORT}/movies.json`);
});