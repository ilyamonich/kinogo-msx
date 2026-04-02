const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://kinokrad.co';
const BASE_CC = 'https://kinokrad.cc';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0',
};

function resolveUrl(src, base) {
    if (!src) return '';
    if (src.startsWith('http')) return src;
    return base + (src.startsWith('/') ? src : '/' + src);
}

async function extractPlayerUrl(movieUrl) {
    try {
        const { data } = await axios.get(movieUrl, {
            headers: { ...HEADERS, 'Referer': BASE_URL },
            timeout: 15000,
        });
        const $ = cheerio.load(data);

        // DLE sites store player URLs in data-iframe attribute of tab buttons
        const tabs = [];
        $('ul.film li[data-iframe]').each((i, el) => {
            const iframeSrc = $(el).attr('data-iframe');
            const type = $(el).attr('player-type') || $(el).text().trim();
            if (iframeSrc) tabs.push({ iframeSrc, type });
        });

        // Skip trailers, prefer actual movie players
        const movieTab = tabs.find(t => !t.type.toLowerCase().includes('трейлер') && !t.type.toLowerCase().includes('trailer'));
        const anyTab = tabs[0];
        const chosen = movieTab || anyTab;

        if (!chosen) return null;
        return chosen.iframeSrc;

    } catch (err) {
        console.error(`  extractPlayerUrl error (${movieUrl}):`, err.message);
        return null;
    }
}

async function main() {
    console.log(`Загрузка главной страницы ${BASE_URL}...`);

    const { data } = await axios.get(BASE_URL, {
        headers: HEADERS,
        timeout: 20000,
    });

    const $ = cheerio.load(data);

    const blocks = $('.shorposterbox');
    console.log(`Найдено блоков: ${blocks.length}`);

    if (blocks.length === 0) {
        console.error('Фрагмент HTML:', data.substring(0, 500));
        throw new Error('Элементы фильмов не найдены. Сайт мог изменить структуру.');
    }

    const movies = [];

    for (const el of blocks.slice(0, 20).toArray()) {
        const titleEl = $(el).find('.postertitle a').first();
        const title = titleEl.text().trim();
        const link = titleEl.attr('href');
        if (!title || !link) continue;

        const fullLink = link.startsWith('http') ? link : resolveUrl(link, BASE_CC);

        const posterSrc = $(el).find('.postershort img').first().attr('src');
        const poster = resolveUrl(posterSrc, BASE_URL);

        console.log(`Обработка: ${title}`);

        const playerUrl = await extractPlayerUrl(fullLink);

        movies.push({
            title,
            type: playerUrl ? 'iframe' : 'html',
            poster,
            url: playerUrl || fullLink,
        });
    }

    if (movies.length === 0) {
        throw new Error('Не удалось извлечь ни одного фильма.');
    }

    const output = {
        settings: {
            title: 'Новинки кино',
            bgColor: '#0A0A0A',
        },
        items: movies,
    };

    const msxDir = path.join(__dirname, 'msx');
    if (!fs.existsSync(msxDir)) fs.mkdirSync(msxDir, { recursive: true });

    const outputPath = path.join(msxDir, 'movies.json');
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\n✅ movies.json сохранён: ${outputPath} (${movies.length} фильмов)`);
}

main().catch(err => {
    console.error('Ошибка:', err.message);
    process.exit(1);
});
