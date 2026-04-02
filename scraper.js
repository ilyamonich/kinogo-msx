const axios = require('axios');
const cheerio = require('cheerio');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 1800 }); // 30 минут кэш

const BASE = 'http://www.hdkinoteatr.com';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
};

function resolveImg(src) {
    if (!src) return '';
    if (src.startsWith('http')) return src;
    return BASE + src;
}

function parseMovieBlocks($) {
    const movies = [];
    $('.shortstory, .base.shortstory').each((i, el) => {
        const titleEl = $(el).find('h2.btl a').first();
        const title = titleEl.text().trim().replace(/\s+/g, ' ');
        const href = titleEl.attr('href');
        if (!title || !href) return;

        const imgSrc = $(el).find('.img img').first().attr('src');
        const poster = resolveImg(imgSrc);
        const fullImg = poster.replace('/thumbs/', '/');

        const hd = $(el).find('.hdRating').first().text().trim() || 'HD';

        // Extract year from title like "Movie (2025)"
        const yearMatch = title.match(/\((\d{4})\)/);
        const year = yearMatch ? yearMatch[1] : '';

        // Clean title — take only russian part before " / "
        const cleanTitle = title.split(' / ')[0].trim();

        movies.push({ title: cleanTitle, fullTitle: title, href, poster, fullImg, hd, year });
    });
    return movies;
}

async function fetchPage(url) {
    const cached = cache.get(url);
    if (cached) return cached;

    const { data } = await axios.get(url, { headers: HEADERS, timeout: 20000 });
    cache.set(url, data);
    return data;
}

async function getLatest() {
    const html = await fetchPage(BASE + '/');
    const $ = cheerio.load(html);
    return parseMovieBlocks($);
}

async function getCategory(slug, page = 1) {
    const url = page > 1
        ? `${BASE}/${slug}/page/${page}/`
        : `${BASE}/${slug}/`;
    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    return parseMovieBlocks($);
}

async function getMovieDetail(movieUrl) {
    const cached = cache.get('detail:' + movieUrl);
    if (cached) return cached;

    const html = await fetchPage(movieUrl);
    const $ = cheerio.load(html);

    const title = $('h1.fulltitle, h1, h2.btl').first().text().trim().replace(/\s+/g, ' ');
    const cleanTitle = title.split(' / ')[0].trim();

    const posterSrc = $('.img img, .full-image img, .dpad .img img').first().attr('src');
    const poster = resolveImg(posterSrc?.replace('/thumbs/', '/'));

    // Extract metadata from .story block
    const storyText = $('.dpad .story, .story').first().text().trim().replace(/\t/g, '').replace(/\n+/g, '\n').split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const description = storyText.filter(l => /^(Год|Страна|Режиссёр|В ролях|Жанр|Продолж)/.test(l)).slice(0, 5).join(' | ');

    const players = [];
    $('iframe[src]').each((i, el) => {
        const src = $(el).attr('src');
        if (!src) return;
        if (src.includes('youtube.com')) {
            players.push({ label: '▶ Трейлер (YouTube)', url: src });
        } else {
            players.push({ label: `▶ Смотреть HD (${i > 0 ? 'Плеер ' + (i + 1) : 'Основной'})`, url: src });
        }
    });

    // Also check data-iframe attributes
    $('[data-iframe]').each((i, el) => {
        const src = $(el).attr('data-iframe');
        const label = $(el).text().trim() || `Плеер ${players.length + 1}`;
        if (src && !players.find(p => p.url === src)) {
            players.push({ label: `▶ ${label}`, url: src });
        }
    });

    const result = { title: cleanTitle, poster, description, players };
    cache.set('detail:' + movieUrl, result);
    return result;
}

async function search(query) {
    const url = `${BASE}/?do=search&subaction=search&story=${encodeURIComponent(query)}`;
    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    return parseMovieBlocks($);
}

module.exports = { getLatest, getCategory, getMovieDetail, search };
