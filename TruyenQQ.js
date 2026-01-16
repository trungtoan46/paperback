"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TruyenQQ = exports.TruyenQQInfo = void 0;
const types_1 = require("@paperback/types");
const TruyenQQParser_1 = require("./TruyenQQParser");
const DOMAIN = 'https://truyenqqno.com';
exports.TruyenQQInfo = {
    version: '1.0.0',
    name: 'TruyenQQ',
    icon: 'icon.png',
    author: 'Paperback Community',
    authorWebsite: 'https://github.com/paperback-community',
    description: 'Extension cho trang TruyenQQ',
    contentRating: types_1.ContentRating.MATURE,
    websiteBaseURL: DOMAIN,
    sourceTags: [
        {
            text: 'Vietnamese',
            type: types_1.BadgeColor.BLUE,
        },
        {
            text: 'Manhwa',
            type: types_1.BadgeColor.GREEN,
        },
    ],
    intents: types_1.SourceIntents.MANGA_CHAPTERS | types_1.SourceIntents.HOMEPAGE_SECTIONS,
};
class TruyenQQ {
    constructor(cheerio) {
        this.cheerio = cheerio;
        this.requestManager = App.createRequestManager({
            requestsPerSecond: 4,
            requestTimeout: 15000,
            interceptor: {
                interceptRequest: async (request) => {
                    request.headers = {
                        ...(request.headers ?? {}),
                        ...{
                            referer: DOMAIN,
                            'user-agent': await this.requestManager.getDefaultUserAgent(),
                        },
                    };
                    return request;
                },
                interceptResponse: async (response) => {
                    return response;
                },
            },
        });
        this.parser = new TruyenQQParser_1.Parser();
    }
    getMangaShareUrl(mangaId) {
        return `${DOMAIN}/truyen-tranh/${mangaId}`;
    }
    async DOMHTML(url) {
        const request = App.createRequest({
            url: url,
            method: 'GET',
        });
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
        return App.createChapterDetails({
            id: chapterId,
            mangaId: mangaId,
            pages: pages,
        });
    }
    async getSearchResults(query, metadata) {
        const page = metadata?.page ?? 1;
        let url = '';
        if (query.title) {
            url = `${DOMAIN}/tim-kiem.html?q=${encodeURIComponent(query.title)}`;
        }
        else {
            url = `${DOMAIN}/truyen-moi-cap-nhat/trang-${page}.html`;
        }
        const $ = await this.DOMHTML(url);
        const mangas = this.parser.parseMangaList($);
        const hasNext = $('.pagination a.next, a[title="Next"]').length > 0;
        return App.createPagedResults({
            results: mangas,
            metadata: hasNext ? { page: page + 1 } : undefined,
        });
    }
    async getHomePageSections(sectionCallback) {
        const sections = [
            App.createHomeSection({
                id: 'latest',
                title: 'Mới Cập Nhật',
                type: types_1.HomeSectionType.singleRowNormal,
                containsMoreItems: true,
            }),
        ];
        for (const section of sections) {
            sectionCallback(section);
            const url = `${DOMAIN}/truyen-moi-cap-nhat.html`;
            const $ = await this.DOMHTML(url);
            section.items = this.parser.parseMangaList($);
            sectionCallback(section);
        }
    }
    async getViewMoreItems(homepageSectionId, metadata) {
        const page = metadata?.page ?? 1;
        const url = `${DOMAIN}/truyen-moi-cap-nhat/trang-${page}.html`;
        const $ = await this.DOMHTML(url);
        const mangas = this.parser.parseMangaList($);
        const hasNext = $('.pagination a.next, a[title="Next"]').length > 0;
        return App.createPagedResults({
            results: mangas,
            metadata: hasNext ? { page: page + 1 } : undefined,
        });
    }
}
exports.TruyenQQ = TruyenQQ;
//# sourceMappingURL=TruyenQQ.js.map