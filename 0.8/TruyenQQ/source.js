/**
 * TruyenQQ Extension for Paperback
 * Bundle version - includes both TruyenQQ and Parser
 */

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TruyenQQ = exports.TruyenQQInfo = void 0;

const DOMAIN = 'https://truyenqqno.com';

// Parser class
class Parser {
    convertTime(timeAgo) {
        const now = Date.now();
        if (timeAgo.includes('phút')) {
            const mins = parseInt(timeAgo.match(/(\d+)/)?.[1] || '0');
            return new Date(now - mins * 60 * 1000);
        }
        if (timeAgo.includes('giờ')) {
            const hours = parseInt(timeAgo.match(/(\d+)/)?.[1] || '0');
            return new Date(now - hours * 60 * 60 * 1000);
        }
        if (timeAgo.includes('ngày')) {
            const days = parseInt(timeAgo.match(/(\d+)/)?.[1] || '0');
            return new Date(now - days * 24 * 60 * 60 * 1000);
        }
        if (timeAgo.includes('/')) {
            const parts = timeAgo.split('/');
            if (parts.length === 3) {
                return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
            }
        }
        return new Date();
    }

    parseMangaList($) {
        const mangas = [];
        $('ul.list_grid li').each((_, element) => {
            const $elem = $(element);
            const $link = $elem.find('a').first();
            const url = $link.attr('href');
            if (!url) return;
            const match = url.match(/truyen-tranh\/(.+)-(\d+)/);
            if (!match) return;
            const mangaId = `${match[1]}-${match[2]}`;
            const title = $link.attr('title') || $elem.find('.book_name a').text().trim();
            const image = $elem.find('img').attr('data-src') || $elem.find('img').attr('src') || '';
            const subtitle = $elem.find('.chapter_name').text().trim();
            mangas.push(App.createPartialSourceManga({
                mangaId, title, image, subtitle: subtitle || undefined
            }));
        });
        return mangas;
    }

    parseMangaDetails($, mangaId) {
        const tags = [];
        $('.list01 li a').each((_, elem) => {
            const label = $(elem).text().trim();
            const id = $(elem).attr('href')?.split('/').pop() || label;
            tags.push(App.createTag({ label, id }));
        });
        const title = $('.book_info h1').text().trim();
        const author = $('.list_info .org').first().text().trim() || 'Đang cập nhật';
        const image = $('.book_avatar img').attr('src') || '';
        const desc = $('.story_introduction').text().trim();
        const status = $('.list_info li').eq(2).text().trim();
        return App.createSourceManga({
            id: mangaId,
            mangaInfo: App.createMangaInfo({
                titles: [title], author, artist: author, image, desc, status,
                tags: [App.createTagSection({ id: '0', label: 'Thể loại', tags })]
            })
        });
    }

    parseChapterList($) {
        const chapters = [];
        $('.list_chapter .works-chapter-item').each((_, element) => {
            const $elem = $(element);
            const $link = $elem.find('a').first();
            const url = $link.attr('href');
            if (!url) return;
            const chapterName = $link.find('.name-chap').text().trim();
            const timeText = $elem.find('.time-chap').text().trim();
            const chapMatch = url.match(/chap-(\d+(?:\.\d+)?)/);
            const chapNum = chapMatch ? parseFloat(chapMatch[1]) : 0;
            const time = this.convertTime(timeText);
            chapters.push(App.createChapter({
                id: url, name: chapterName, chapNum, langCode: 'vi', time
            }));
        });
        return chapters;
    }

    parseChapterDetails($) {
        const pages = [];
        $('#chapter_content .page-chapter img, .chapter_content .page-chapter img').each((_, element) => {
            const imageUrl = $(element).attr('data-original') || $(element).attr('data-cdn') || $(element).attr('src') || '';
            if (imageUrl && imageUrl.startsWith('http')) {
                pages.push(imageUrl);
            }
        });
        return pages;
    }
}

// SourceInfo
exports.TruyenQQInfo = {
    version: '1.0.0',
    name: 'TruyenQQ',
    icon: 'icon.png',
    author: 'Paperback Community',
    authorWebsite: 'https://github.com/paperback-community',
    description: 'Extension cho trang TruyenQQ',
    contentRating: 1, // MATURE
    websiteBaseURL: DOMAIN,
    sourceTags: [
        { text: 'Vietnamese', type: 0 },
        { text: 'Manhwa', type: 1 }
    ],
    intents: 17  // MANGA_CHAPTERS (1) + CLOUDFLARE_BYPASS_REQUIRED (16)
};

// Main class
class TruyenQQ {
    constructor(cheerio) {
        this.cheerio = cheerio;
        this.parser = new Parser();
        this.requestManager = App.createRequestManager({
            requestsPerSecond: 4,
            requestTimeout: 15000,
            interceptor: {
                interceptRequest: async (request) => {
                    request.headers = {
                        ...(request.headers ?? {}),
                        referer: DOMAIN,
                        'user-agent': await this.requestManager.getDefaultUserAgent()
                    };
                    return request;
                },
                interceptResponse: async (response) => response
            }
        });
    }

    getMangaShareUrl(mangaId) {
        return `${DOMAIN}/truyen-tranh/${mangaId}`;
    }

    async DOMHTML(url) {
        const request = App.createRequest({ url, method: 'GET' });
        const response = await this.requestManager.schedule(request, 1);
        return this.cheerio.load(response.data);
    }

    async getMangaDetails(mangaId) {
        const $ = await this.DOMHTML(`${DOMAIN}/truyen-tranh/${mangaId}`);
        return this.parser.parseMangaDetails($, mangaId);
    }

    async getChapters(mangaId) {
        const $ = await this.DOMHTML(`${DOMAIN}/truyen-tranh/${mangaId}`);
        return this.parser.parseChapterList($);
    }

    async getChapterDetails(mangaId, chapterId) {
        const url = chapterId.startsWith('http') ? chapterId : `${DOMAIN}${chapterId}`;
        const $ = await this.DOMHTML(url);
        const pages = this.parser.parseChapterDetails($);
        return App.createChapterDetails({ id: chapterId, mangaId, pages });
    }

    async getSearchResults(query, metadata) {
        const page = metadata?.page ?? 1;
        const url = query.title
            ? `${DOMAIN}/tim-kiem.html?q=${encodeURIComponent(query.title)}`
            : `${DOMAIN}/truyen-moi-cap-nhat/trang-${page}.html`;
        const $ = await this.DOMHTML(url);
        const mangas = this.parser.parseMangaList($);
        const hasNext = $('.pagination a.next, a[title="Next"]').length > 0;
        return App.createPagedResults({
            results: mangas,
            metadata: hasNext ? { page: page + 1 } : undefined
        });
    }
}

exports.TruyenQQ = TruyenQQ;