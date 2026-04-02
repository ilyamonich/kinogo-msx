const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const KINOGO_BASE = 'https://kinogo.pro';

// Функция извлечения прямой ссылки на видео со страницы фильма
async function extractVideoUrl(pageUrl) {
    try {
        const { data } = await axios.get(pageUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 15000
        });
        const $ = cheerio.load(data);
        
        // Ищем iframe плеера
        let iframeSrc = $('iframe[src*="/engine/player/"]').first().attr('src');
        if (!iframeSrc) {
            iframeSrc = $('iframe[src*="video"]').first().attr('src');
        }
        if (!iframeSrc) return null;
        
        const playerUrl = iframeSrc.startsWith('http') ? iframeSrc : KINOGO_BASE + iframeSrc;
        const playerRes = await axios.get(playerUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 15000
        });
        const $player = cheerio.load(playerRes.data);
        
        // Пытаемся найти video src
        let videoSrc = $player('video source').first().attr('src');
        if (!videoSrc) {
            // Ищем m3u8 в скриптах
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

async function main() {
    console.log('Загрузка главной страницы kinogo.pro...');
    const { data } = await axios.get(KINOGO_BASE, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 20000
    });
    const $ = cheerio.load(data);
    
    // Пробуем разные селекторы
    let movieElements = $('.shortstory');
    if (movieElements.length === 0) movieElements = $('.movie-item');
    if (movieElements.length === 0) movieElements = $('.item');
    if (movieElements.length === 0) movieElements = $('.post');
    
    console.log(`Найдено элементов: ${movieElements.length}`);
    
    if (movieElements.length === 0) {
        console.error('Не удалось найти элементы фильмов. Возможно, сайт изменил структуру.');
        process.exit(1);
    }
    
    const movies = [];
    // Ограничим 20 фильмами для скорости
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
        
        const fullLink = link.startsWith('http') ? link : KINOGO_BASE + link;
        
        // Постер
        let poster = $(el).find('.shortstory__image img').attr('src');
        if (!poster) poster = $(el).find('img').first().attr('src');
        if (poster && !poster.startsWith('http')) poster = KINOGO_BASE + poster;
        
        console.log(`Обработка: ${title}`);
        
        // Извлекаем видео (может занимать время)
        let videoUrl = null;
        try {
            videoUrl = await extractVideoUrl(fullLink);
        } catch (e) {
            console.error(`Ошибка видео для ${title}:`, e.message);
        }
        
        movies.push({
            title: title,
            type: videoUrl ? 'video' : 'html',
            poster: poster || '',
            url: videoUrl || fullLink
        });
    }
    
    if (movies.length === 0) {
        console.error('Не удалось извлечь ни одного фильма.');
        process.exit(1);
    }
    
    const output = {
        settings: {
            title: 'Новинки кино',
            bgColor: '#0A0A0A'
        },
        items: movies
    };
    
    fs.writeFileSync('movies.json', JSON.stringify(output, null, 2));
    console.log(`✅ movies.json сохранён. ${movies.length} фильмов.`);
}

main().catch(console.error);
