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
    TagSection
} from '@paperback/types'
import {
    absoluteUrl,
    cloudflareError,
    parseNextPageUrl,
    parseTagLinks,
    toPath
} from '../../shared/utils'
import { firstListWithItems, HomeSectionInfo, ListPage, loadHomeSections, toPagedResults } from '../../shared/lists'
import { FilterOption, genreTags, optionSection, pickOption, readFilterOptions } from '../../shared/filters'
import { DomainSetting } from '../../shared/settings'
import {
    PAGER_SELECTOR,
    parseChapterApi,
    parseChapterDetails,
    parseChapters,
    parseMangaDetails,
    parseMangaList
} from './NetTruyenParser'

// Tên miền mặc định; người dùng đổi được trong cài đặt nguồn khi web đổi địa chỉ.
const DEFAULT_DOMAIN = 'https://nettruyen.gg'

export const NetTruyenInfo: SourceInfo = {
    version: '1.1.2',
    name: 'NetTruyen',
    icon: 'icon.png',
    author: 'trungtoan46',
    authorWebsite: 'https://github.com/trungtoan46/paperback',
    description: 'Đọc truyện tranh từ NetTruyen (nettruyen.gg)',
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

// Trên app 0.8.11: '/', '/hot' và '/tim-truyen?status=-1&sort=...' trả về rỗng, còn '/tim-truyen?status=2'
// và trang thể loại chạy được. Mỗi mục thử lần lượt nhiều URL; sort=11 là top tháng.
const HOME_SECTIONS: HomeSectionInfo[] = [
    { id: 'latest', title: 'Mới cập nhật', paths: ['/tim-truyen', '/'], type: HomeSectionType.singleRowNormal },
    { id: 'hot', title: 'Top tháng', paths: ['/tim-truyen?sort=11', '/tim-truyen?status=-1&sort=11', '/hot'], type: HomeSectionType.singleRowNormal },
    { id: 'completed', title: 'Hoàn thành', paths: ['/tim-truyen?status=2'], type: HomeSectionType.singleRowNormal }
]

// Dùng khi không đọc được lựa chọn từ trang /tim-truyen. 'Tất cả' và 'Ngày cập nhật' (mặc định) là không truyền tham số.
const DEFAULT_STATUS: FilterOption[] = [
    { value: '1', label: 'Đang tiến hành' },
    { value: '2', label: 'Hoàn thành' }
]
const DEFAULT_SORT: FilterOption[] = [
    { value: '15', label: 'Truyện mới' },
    { value: '10', label: 'Top all' },
    { value: '11', label: 'Top tháng' },
    { value: '12', label: 'Top tuần' },
    { value: '13', label: 'Top ngày' },
    { value: '20', label: 'Theo dõi' },
    { value: '25', label: 'Bình luận' },
    { value: '30', label: 'Số chapter' },
    { value: '19', label: 'Top Follow' }
]

export class NetTruyen implements SearchResultsProviding, MangaProviding, ChapterProviding,
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
        const chapters = parseChapters($)
        if (chapters.length > 0) return chapters

        // Bản giao diện mới tải danh sách chương bằng AJAX.
        const url = `${domain}/Comic/Services/ComicService.asmx/ChapterList?slug=${encodeURIComponent(mangaId)}`
        const response = await this.fetch(url, { 'x-requested-with': 'XMLHttpRequest' })
        try {
            return parseChapterApi(response.data ?? '', mangaId)
        } catch {
            throw new Error('NetTruyen: không đọc được danh sách chương (web có thể đã đổi giao diện)')
        }
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const domain = await this.site.load()
        const $ = await this.loadPage(domain + toPath(chapterId))
        return parseChapterDetails($, mangaId, chapterId, domain)
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        await loadHomeSections(HOME_SECTIONS, await this.site.load(), sectionCallback, urls => this.loadFirstList(urls), 'NetTruyen')
    }

    async getViewMoreItems(homepageSectionId: string, metadata: ListMetadata | undefined): Promise<PagedResults> {
        const info = HOME_SECTIONS.find(section => section.id === homepageSectionId)
        if (!info) return App.createPagedResults({ results: [] })
        const domain = await this.site.load()
        const urls = metadata?.nextUrl ? [metadata.nextUrl] : info.paths.map(path => domain + path)
        return toPagedResults(await this.loadFirstList(urls))
    }

    async getSearchTags(): Promise<TagSection[]> {
        const $ = await this.loadPage(`${await this.site.load()}/tim-truyen`)
        const status = readFilterOptions($, 'status')
        const sort = readFilterOptions($, 'sort')
        const genres = parseTagLinks($, 'a[href*="/tim-truyen/"]', '/tim-truyen/')
        return [
            App.createTagSection({ id: 'genres', label: 'Thể loại', tags: genres }),
            optionSection('status', 'Tình trạng', status.length > 0 ? status : DEFAULT_STATUS),
            optionSection('sort', 'Sắp xếp', sort.length > 0 ? sort : DEFAULT_SORT)
        ].filter(section => section.tags.length > 0)
    }

    async supportsTagExclusion(): Promise<boolean> {
        return false
    }

    async getSearchResults(query: SearchRequest, metadata: ListMetadata | undefined): Promise<PagedResults> {
        if (metadata?.nextUrl) return toPagedResults(await this.loadListPage(metadata.nextUrl))

        const domain = await this.site.load()
        const title = query.title?.trim()
        if (title) {
            // Tìm theo tên: web không lọc kết hợp với thể loại/tình trạng.
            return toPagedResults(await this.loadListPage(`${domain}/tim-truyen?keyword=${encodeURIComponent(title)}`))
        }

        // Web chỉ lọc một thể loại mỗi lần; id thể loại là path, ví dụ '/tim-truyen/action-95'.
        const genre = genreTags(query.includedTags)[0]
        const params: string[] = []
        const status = pickOption(query.includedTags, 'status')
        const sort = pickOption(query.includedTags, 'sort')
        if (status !== undefined) params.push(`status=${encodeURIComponent(status)}`)
        if (sort !== undefined) params.push(`sort=${encodeURIComponent(sort)}`)
        const base = genre ? absoluteUrl(genre.id, domain) : `${domain}/tim-truyen`
        return toPagedResults(await this.loadListPage(params.length > 0 ? `${base}?${params.join('&')}` : base))
    }

    private async loadFirstList(urls: string[]): Promise<ListPage> {
        return firstListWithItems(urls, url => this.loadListPage(url))
    }

    private async loadListPage(url: string): Promise<ListPage> {
        const $ = await this.loadPage(url)
        const nextUrl = parseNextPageUrl($, url, PAGER_SELECTOR)
        return {
            results: parseMangaList($, await this.site.load()),
            nextUrl: nextUrl !== url ? nextUrl : undefined
        }
    }

    private async loadPage(url: string): Promise<CheerioAPI> {
        const response = await this.fetch(url)
        return this.cheerio.load(response.data ?? '')
    }

    private async fetch(url: string, headers: Record<string, string> = {}): Promise<Response> {
        const request = App.createRequest({ url, method: 'GET', headers })
        const response = await this.requestManager.schedule(request, 1)
        if (response.status === 403 || response.status === 503) {
            throw cloudflareError(response.status, 'NetTruyen')
        }
        if (response.status >= 400) {
            throw new Error(`NetTruyen trả lỗi HTTP ${response.status} cho ${url}`)
        }
        return response
    }
}
