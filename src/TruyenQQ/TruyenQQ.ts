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
    PartialSourceManga,
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
    cloudflareError,
    isCloudflareError,
    parseNextPageUrl,
    parseTagLinks,
    toPath
} from '../../shared/utils'
import { FilterOption, genreTags, optionSection, pickOption, readFilterOptions } from '../../shared/filters'
import { DomainSetting } from '../../shared/settings'
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
    version: '1.3.0',
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

interface ListPage {
    results: PartialSourceManga[]
    nextUrl?: string
}

// Web đã bỏ đuôi '.html' (truyenqqko.com); giữ URL cũ làm dự phòng, thử lần lượt tới khi có truyện.
const LATEST_PATHS = ['/truyen-moi-cap-nhat/trang-1', '/truyen-moi-cap-nhat/trang-1.html', '/']
const ADVANCED_SEARCH_PATHS = ['/tim-kiem-nang-cao', '/tim-kiem-nang-cao.html']
const HOME_SECTIONS = [
    { id: 'latest', title: 'Mới cập nhật', paths: LATEST_PATHS, type: HomeSectionType.singleRowNormal },
    { id: 'favorite', title: 'Yêu thích', paths: ['/truyen-yeu-thich/trang-1', '/truyen-yeu-thich/trang-1.html'], type: HomeSectionType.singleRowNormal }
]

// Dùng khi không đọc được lựa chọn từ trang tìm kiếm nâng cao.
const DEFAULT_STATUS: FilterOption[] = [
    { value: '0', label: 'Đang tiến hành' },
    { value: '2', label: 'Hoàn thành' }
]
const DEFAULT_SORT: FilterOption[] = [
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

    constructor(private cheerio: CheerioAPI) { }

    readonly stateManager = App.createSourceStateManager()
    private readonly site = new DomainSetting(this.stateManager, DEFAULT_DOMAIN)

    readonly requestManager = App.createRequestManager({
        requestsPerSecond: 4,
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
        const domain = await this.site.load()
        const $ = await this.loadPage(`${domain}/truyen-tranh/${mangaId}`)
        return parseMangaDetails($, mangaId, domain)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const domain = await this.site.load()
        const $ = await this.loadPage(`${domain}/truyen-tranh/${mangaId}`)
        return parseChapters($)
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        // Bản cũ (<= 1.1.0) lưu id chương là URL đầy đủ; chuyển về path để chạy với domain hiện tại.
        const domain = await this.site.load()
        const $ = await this.loadPage(domain + toPath(chapterId))
        return parseChapterDetails($, mangaId, chapterId, domain)
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        const domain = await this.site.load()
        const sections = HOME_SECTIONS.map(info => App.createHomeSection({
            id: info.id,
            title: info.title,
            type: info.type,
            containsMoreItems: true
        }))
        sections.forEach(section => sectionCallback(section))

        // Mỗi mục tải riêng: một mục lỗi không làm hỏng cả trang chủ.
        await Promise.all(HOME_SECTIONS.map(async (info, index) => {
            const section = sections[index]!
            try {
                const page = await this.loadFirstList(info.paths.map(path => domain + path))
                section.items = page.results
                section.containsMoreItems = page.nextUrl !== undefined
            } catch (error) {
                console.log(`TruyenQQ: lỗi tải mục ${info.id}: ${error}`)
                section.items = []
                section.containsMoreItems = false
            }
            sectionCallback(section)
        }))
    }

    async getViewMoreItems(homepageSectionId: string, metadata: ListMetadata | undefined): Promise<PagedResults> {
        const info = HOME_SECTIONS.find(section => section.id === homepageSectionId)
        if (!info) return App.createPagedResults({ results: [] })
        const domain = await this.site.load()
        const urls = metadata?.nextUrl ? [metadata.nextUrl] : info.paths.map(path => domain + path)
        return this.toPagedResults(await this.loadFirstList(urls))
    }

    async getSearchTags(): Promise<TagSection[]> {
        const domain = await this.site.load()
        const [home, advanced] = await Promise.all([
            this.loadPage(domain),
            this.loadFirstPage(ADVANCED_SEARCH_PATHS.map(path => domain + path)).catch(() => undefined)
        ])
        const status = advanced ? readFilterOptions(advanced, 'status') : []
        const sort = advanced ? readFilterOptions(advanced, 'sort') : []
        return [
            App.createTagSection({ id: 'genres', label: 'Thể loại', tags: parseTagLinks(home, 'a[href*="/the-loai/"]', '/the-loai/') }),
            optionSection('status', 'Tình trạng', status.length > 0 ? status : DEFAULT_STATUS),
            optionSection('sort', 'Sắp xếp', sort.length > 0 ? sort : DEFAULT_SORT)
        ].filter(section => section.tags.length > 0)
    }

    async supportsTagExclusion(): Promise<boolean> {
        return true
    }

    async getSearchResults(query: SearchRequest, metadata: ListMetadata | undefined): Promise<PagedResults> {
        if (metadata?.nextUrl) return this.toPagedResults(await this.loadFirstList([metadata.nextUrl]))

        const domain = await this.site.load()
        const title = query.title?.trim()
        if (title) {
            // Tìm theo tên: web không lọc kết hợp với thể loại/tình trạng.
            const q = encodeURIComponent(title)
            return this.toPagedResults(await this.loadFirstList([`${domain}/tim-kiem?q=${q}`, `${domain}/tim-kiem.html?q=${q}`]))
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
        return this.toPagedResults(await this.loadFirstList(urls))
    }

    private toPagedResults(page: ListPage): PagedResults {
        return App.createPagedResults({
            results: page.results,
            metadata: page.nextUrl ? { nextUrl: page.nextUrl } : undefined
        })
    }

    /** Thử lần lượt từng URL, trả về trang đầu tiên có truyện. Lỗi Cloudflare báo ngay. */
    private async loadFirstList(urls: string[]): Promise<ListPage> {
        let lastError: unknown
        const domain = await this.site.load()
        for (const url of urls) {
            try {
                const $ = await this.loadPage(url)
                const results = parseMangaList($, domain)
                if (results.length === 0) continue
                // Chỉ đoán theo số trang khi không có thanh phân trang quen thuộc.
                const nextUrl = $(PAGER_SELECTOR).length > 0
                    ? parseNextPageUrl($, url, PAGER_SELECTOR)
                    : parseNextPageByNumber($, url, domain)
                return { results, nextUrl: nextUrl !== url ? nextUrl : undefined }
            } catch (error) {
                if (isCloudflareError(error)) throw error
                lastError = error
            }
        }
        if (lastError) throw lastError
        return { results: [] }
    }

    /** Trang đầu tiên tải được (không lỗi HTTP) trong danh sách URL. */
    private async loadFirstPage(urls: string[]): Promise<CheerioAPI> {
        let lastError: unknown = new Error('Không có URL')
        for (const url of urls) {
            try {
                return await this.loadPage(url)
            } catch (error) {
                if (isCloudflareError(error)) throw error
                lastError = error
            }
        }
        throw lastError
    }

    private async loadPage(url: string): Promise<CheerioAPI> {
        const request = App.createRequest({ url, method: 'GET' })
        const response = await this.requestManager.schedule(request, 1)
        this.checkResponse(response)
        return this.cheerio.load(response.data ?? '')
    }

    private checkResponse(response: Response): void {
        if (response.status === 403 || response.status === 503) {
            throw cloudflareError(response.status, 'TruyenQQ')
        }
        if (response.status >= 400) {
            throw new Error(`TruyenQQ trả lỗi HTTP ${response.status} cho ${response.request?.url ?? ''}`)
        }
    }
}
