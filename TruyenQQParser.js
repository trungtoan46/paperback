"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Parser = void 0;
class Parser {
    /**
     * Chuyển đổi thời gian tiếng Việt sang Date
     */
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
                const day = parseInt(parts[0]);
                const month = parseInt(parts[1]) - 1;
                const year = parseInt(parts[2]);
                return new Date(year, month, day);
            }
        }
        return new Date();
    }
    /**
     * Parse manga list
     */
    parseMangaList($) {
        const mangas = [];
        $('ul.list_grid li').each((_, element) => {
            const $elem = $(element);
            const $link = $elem.find('a').first();
            const url = $link.attr('href');
            if (!url)
                return;
            const match = url.match(/truyen-tranh\/(.+)-(\d+)/);
            if (!match)
                return;
            const slug = match[1];
            const id = match[2];
            const mangaId = `${slug}-${id}`;
            const title = $link.attr('title') || $elem.find('.book_name a').text().trim();
            const image = $elem.find('img').attr('data-src') || $elem.find('img').attr('src') || '';
            const subtitle = $elem.find('.chapter_name').text().trim();
            mangas.push(App.createPartialSourceManga({
                mangaId: mangaId,
                title: title,
                image: image,
                subtitle: subtitle || undefined,
            }));
        });
        return mangas;
    }
    /**
     * Parse manga details
     */
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
                titles: [title],
                author,
                artist: author,
                image,
                desc,
                status,
                tags: [App.createTagSection({ id: '0', label: 'Thể loại', tags })],
            }),
        });
    }
    /**
     * Parse chapter list
     */
    parseChapterList($) {
        const chapters = [];
        $('.list_chapter .works-chapter-item').each((_, element) => {
            const $elem = $(element);
            const $link = $elem.find('a').first();
            const url = $link.attr('href');
            if (!url)
                return;
            const chapterName = $link.find('.name-chap').text().trim();
            const timeText = $elem.find('.time-chap').text().trim();
            let chapNum = 0;
            const chapMatch = url.match(/chap-(\d+(?:\.\d+)?)/);
            if (chapMatch) {
                chapNum = parseFloat(chapMatch[1]);
            }
            const time = this.convertTime(timeText);
            chapters.push(App.createChapter({
                id: url,
                name: chapterName,
                chapNum: chapNum,
                langCode: 'vi',
                time: time,
            }));
        });
        return chapters;
    }
    /**
     * Parse chapter details (images)
     */
    parseChapterDetails($) {
        const pages = [];
        $('#chapter_content .page-chapter img, .chapter_content .page-chapter img').each((_, element) => {
            const imageUrl = $(element).attr('data-original') ||
                $(element).attr('data-cdn') ||
                $(element).attr('src') ||
                '';
            if (imageUrl && imageUrl.startsWith('http')) {
                pages.push(imageUrl);
            }
        });
        return pages;
    }
}
exports.Parser = Parser;
//# sourceMappingURL=TruyenQQParser.js.map