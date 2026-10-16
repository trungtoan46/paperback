import type { CheerioAPI } from 'cheerio'
import {
    BadgeColor,
    Chapter,
    ChapterDetails,
    ChapterProviding,
    CloudflareBypassRequestProviding,
    ContentRating,
    DUISection,
    HomePageSectionsProviding,
    HomeSection,
    HomeSectionType,
    MangaProviding,
    PagedResults,
    Request,
    Response,
    SearchRequest,
    SearchResultsProviding,
    SourceInfo,
    SourceIntents,
    SourceManga,
    Tag,
    TagSection
} from '@paperback/types'
import {
    absoluteUrl,
    checkResponse,
    parseNextPageUrl,
    parseTagLinks,
    toPath
} from '../../shared/utils'
import { FilterOption, genreTags, optionSection, pickOption } from '../../shared/filters'
import { firstListWithItems, HomeSectionInfo, isLoadingTile, ListPage, loadHomeSections, toPagedResults } from '../../shared/lists'
import { DomainSetting } from '../../shared/settings'
import { ShortCache } from '../../shared/cache'
import {
    PAGER_SELECTOR,
    parseNextPageByNumber,
    parseChapterDetails,
    parseChapters,
    parseMangaDetails,
    parseMangaList
} from './TruyenQQParser'

// Tên miền mặc định; người dùng đổi được trong cài đặt nguồn khi web đổi địa chỉ.
const DEFAULT_DOMAIN = 'https://truyenqqko.com'

export const TruyenQQInfo: SourceInfo = {
    version: '1.3.7',
    name: 'TruyenQQ',
    icon: 'icon.png',
    author: 'trungtoan46',
    authorWebsite: 'https://github.com/trungtoan46/paperback',
    description: 'Đọc truyện tranh từ TruyenQQ',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: DEFAULT_DOMAIN,
    language: 'vi',
    sourceTags: [
        { text: 'Tiếng Việt', type: BadgeColor.GREY },
        { text: 'Cloudflare', type: BadgeColor.RED }
    ],
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS |
        SourceIntents.CLOUDFLARE_BYPASS_REQUIRED | SourceIntents.SETTINGS_UI
}

interface ListMetadata {
    nextUrl?: string
}

// Web đã bỏ đuôi '.html' (truyenqqko.com); giữ URL cũ làm dự phòng, thử lần lượt tới khi có truyện.
const LATEST_PATHS = ['/truyen-moi-cap-nhat', '/truyen-moi-cap-nhat/trang-1', '/truyen-moi-cap-nhat/trang-1.html', '/']
const ADVANCED_SEARCH_PATHS = ['/tim-kiem-nang-cao', '/tim-kiem-nang-cao.html']
const HOME_SECTIONS: HomeSectionInfo[] = [
    { id: 'latest', title: 'Mới cập nhật', paths: LATEST_PATHS, type: HomeSectionType.singleRowNormal },
    { id: 'favorite', title: 'Yêu thích', paths: ['/truyen-yeu-thich', '/truyen-yeu-thich/trang-1', '/truyen-yeu-thich/trang-1.html'], type: HomeSectionType.singleRowNormal }
]

// Giá trị của trang tìm kiếm nâng cao (khớp extension TruyenQQ của Mihon).
const STATUS: FilterOption[] = [
    { value: '0', label: 'Đang tiến hành' },
    { value: '2', label: 'Hoàn thành' }
]
const SORT: FilterOption[] = [
    { value: '0', label: 'Ngày đăng giảm dần' },
    { value: '1', label: 'Ngày đăng tăng dần' },
    { value: '2', label: 'Ngày cập nhật giảm dần' },
    { value: '3', label: 'Ngày cập nhật tăng dần' },
    { value: '4', label: 'Lượt xem giảm dần' },
    { value: '5', label: 'Lượt xem tăng dần' }
]

/** '/the-loai/action-26' -> '26' (mã thể loại của trang tìm kiếm nâng cao). */
function genreCode(tag: Tag): string | undefined {
    return toPath(tag.id).match(/-(\d+)(?:\.html)?$/)?.[1]
}

export class TruyenQQ implements SearchResultsProviding, MangaProviding, ChapterProviding,
    HomePageSectionsProviding, CloudflareBypassRequestProviding {

    constructor(private cheerio: CheerioAPI) {
        // Nạp sẵn tên miền đã lưu để getMangaShareUrl (không chờ được) dùng đúng tên miền.
        this.site.load().catch(() => undefined)
    }

    readonly stateManager = App.createSourceStateManager()
    private readonly site = new DomainSetting(this.stateManager, DEFAULT_DOMAIN)
    private readonly mangaPages = new ShortCache<string>(60 * 1000)
    private genres: Promise<Tag[]> | undefined

    readonly requestManager = App.createRequestManager({
        // Web chặn khi gọi dồn dập (Mihon giới hạn 1 request / 2 giây); 1/giây làm Discover tải quá chậm.
        requestsPerSecond: 2,
        requestTimeout: 20000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    ...(request.headers ?? {}),
                    'referer': `${await this.site.load()}/`,
                    'user-agent': await this.requestManager.getDefaultUserAgent()
                }
                return request
            },
            interceptResponse: async (response: Response): Promise<Response> => {
                return response
            }
        }
    })

    async getSourceMenu(): Promise<DUISection> {
        return this.site.menu()
    }

    getMangaShareUrl(mangaId: string): string {
        return `${this.site.current}/truyen-tranh/${mangaId}`
    }

    async getCloudflareBypassRequestAsync(): Promise<Request> {
        const domain = await this.site.load()
        return App.createRequest({
            url: domain,
            method: 'GET',
            headers: {
                'referer': `${domain}/`,
                'user-agent': await this.requestManager.getDefaultUserAgent()
            }
        })
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        if (isLoadingTile(mangaId)) throw new Error('Danh sách đang tải, vui lòng chờ một chút.')
        const { $, domain } = await this.loadMangaPage(mangaId)
        return parseMangaDetails($, mangaId, domain)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        return parseChapters((await this.loadMangaPage(mangaId)).$)
    }

    /** Trang truyện dùng cho cả chi tiết lẫn danh sách chương: nhớ tạm để không tải hai lần. */
    private async loadMangaPage(mangaId: string): Promise<{ $: CheerioAPI, domain: string }> {
        const domain = await this.site.load()
        const url = `${domain}/truyen-tranh/${mangaId}`
        const html = await this.mangaPages.get(url, () => this.fetchHtml(url))
        return { $: this.cheerio.load(html), domain }
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        // Bản cũ (<= 1.1.0) lưu id chương là URL đầy đủ; chuyển về path để chạy với domain hiện tại.
        const domain = await this.site.load()
        const $ = await this.loadPage(domain + toPath(chapterId))
        return parseChapterDetails($, mangaId, chapterId, domain)
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        await loadHomeSections(HOME_SECTIONS, await this.site.load(), sectionCallback, urls => this.loadFirstList(urls), 'TruyenQQ', this.stateManager)
    }

    async getViewMoreItems(homepageSectionId: string, metadata: ListMetadata | undefined): Promise<PagedResults> {
        const info = HOME_SECTIONS.find(section => section.id === homepageSectionId)
        if (!info) return App.createPagedResults({ results: [] })
        const domain = await this.site.load()
        const urls = metadata?.nextUrl ? [metadata.nextUrl] : info.paths.map(path => domain + path)
        return toPagedResults(await this.loadFirstList(urls))
    }

    async getSearchTags(): Promise<TagSection[]> {
        // App gọi lại mỗi lần mở Discover: nhớ thể loại trong phiên để bớt request (web giới hạn tốc độ).
        if (!this.genres) {
            this.genres = this.site.load()
                .then(domain => this.loadPage(domain))
                .then($ => parseTagLinks($, 'a[href*="/the-loai/"]', '/the-loai/'))
            this.genres.catch(() => { this.genres = undefined })
        }
        return [
            App.createTagSection({ id: 'genres', label: 'Thể loại', tags: await this.genres }),
            optionSection('status', 'Tình trạng', STATUS),
            optionSection('sort', 'Sắp xếp', SORT)
        ].filter(section => section.tags.length > 0)
    }

    async supportsTagExclusion(): Promise<boolean> {
        return true
    }

    async getSearchResults(query: SearchRequest, metadata: ListMetadata | undefined): Promise<PagedResults> {
        if (metadata?.nextUrl) return toPagedResults(await this.loadFirstList([metadata.nextUrl]))

        const domain = await this.site.load()
        const title = query.title?.trim()
        if (title) {
            // Tìm theo tên: web không lọc kết hợp với thể loại/tình trạng.
            const q = encodeURIComponent(title)
            return toPagedResults(await this.loadFirstList([`${domain}/tim-kiem?q=${q}`, `${domain}/tim-kiem.html?q=${q}`]))
        }

        const included = genreTags(query.includedTags)
        const excluded = genreTags(query.excludedTags)
        const status = pickOption(query.includedTags, 'status')
        const sort = pickOption(query.includedTags, 'sort')

        let urls: string[]
        if (excluded.length > 0 || included.length > 1 || status !== undefined || sort !== undefined) {
            // Nhiều điều kiện: dùng trang tìm kiếm nâng cao (mã thể loại lấy từ đuôi path).
            const params = [
                `category=${included.map(genreCode).filter(Boolean).join(',')}`,
                `notcategory=${excluded.map(genreCode).filter(Boolean).join(',')}`,
                'country=0',
                `status=${encodeURIComponent(status ?? '-1')}`,
                'minchapter=0',
                `sort=${encodeURIComponent(sort ?? '0')}`
            ].join('&')
            urls = ADVANCED_SEARCH_PATHS.map(path => `${domain}${path}?${params}`)
        } else if (included.length === 1) {
            urls = [absoluteUrl(included[0]!.id, domain)]
        } else {
            urls = LATEST_PATHS.map(path => domain + path)
        }
        return toPagedResults(await this.loadFirstList(urls))
    }

    private async loadFirstList(urls: string[]): Promise<ListPage> {
        return firstListWithItems(urls, url => this.loadListPage(url))
    }

    private async loadListPage(url: string): Promise<ListPage> {
        const domain = await this.site.load()
        const $ = await this.loadPage(url)
        // Chỉ đoán theo số trang khi không có thanh phân trang quen thuộc.
        const nextUrl = $(PAGER_SELECTOR).length > 0
            ? parseNextPageUrl($, url, PAGER_SELECTOR)
            : parseNextPageByNumber($, url, domain)
        return { results: parseMangaList($, domain), nextUrl: nextUrl !== url ? nextUrl : undefined }
    }

    private async loadPage(url: string): Promise<CheerioAPI> {
        return this.cheerio.load(await this.fetchHtml(url))
    }

    private async fetchHtml(url: string): Promise<string> {
        const response = await this.requestManager.schedule(App.createRequest({ url, method: 'GET' }), 1)
        checkResponse(response, 'TruyenQQ', url)
        return response.data ?? ''
    }
}
