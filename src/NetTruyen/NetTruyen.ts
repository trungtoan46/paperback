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
    version: '1.1.0',
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

// Trang chủ '/' và '/hot' trả về rỗng trên nettruyen.gg (thử trên app 0.8.11),
// nên mọi mục đều dùng /tim-truyen. sort: 0 = ngày cập nhật, 11 = top tháng.
const HOME_SECTIONS = [
    { id: 'latest', title: 'Mới cập nhật', path: '/tim-truyen?status=-1&sort=0', type: HomeSectionType.singleRowNormal },
    { id: 'hot', title: 'Top tháng', path: '/tim-truyen?status=-1&sort=11', type: HomeSectionType.singleRowNormal },
    { id: 'completed', title: 'Hoàn thành', path: '/tim-truyen?status=2', type: HomeSectionType.singleRowNormal }
]

// Dùng khi không đọc được lựa chọn từ trang /tim-truyen.
const DEFAULT_STATUS: FilterOption[] = [
    { value: '1', label: 'Đang tiến hành' },
    { value: '2', label: 'Hoàn thành' }
]
const DEFAULT_SORT: FilterOption[] = [
    { value: '0', label: 'Ngày cập nhật' },
    { value: '15', label: 'Truyện mới' },
    { value: '10', label: 'Top all' },
    { value: '11', label: 'Top tháng' },
    { value: '12', label: 'Top tuần' },
    { value: '13', label: 'Top ngày' },
    { value: '20', label: 'Theo dõi' },
    { value: '25', label: 'Bình luận' },
    { value: '30', label: 'Số chapter' }
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
                const url = domain + info.path
                const $ = await this.loadPage(url)
                section.items = parseMangaList($, domain)
                section.containsMoreItems = parseNextPageUrl($, url, PAGER_SELECTOR) !== undefined
            } catch (error) {
                console.log(`NetTruyen: lỗi tải mục ${info.id}: ${error}`)
                section.items = []
                section.containsMoreItems = false
            }
            sectionCallback(section)
        }))
    }

    async getViewMoreItems(homepageSectionId: string, metadata: ListMetadata | undefined): Promise<PagedResults> {
        const info = HOME_SECTIONS.find(section => section.id === homepageSectionId)
        if (!info) return App.createPagedResults({ results: [] })
        return this.getListPage(metadata?.nextUrl ?? (await this.site.load()) + info.path)
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
        if (metadata?.nextUrl) return this.getListPage(metadata.nextUrl)

        const domain = await this.site.load()
        const title = query.title?.trim()
        if (title) {
            // Tìm theo tên: web không lọc kết hợp với thể loại/tình trạng.
            return this.getListPage(`${domain}/tim-truyen?keyword=${encodeURIComponent(title)}`)
        }

        // Web chỉ lọc một thể loại mỗi lần; id thể loại là path, ví dụ '/tim-truyen/action-95'.
        const genre = genreTags(query.includedTags)[0]
        const params: string[] = []
        const status = pickOption(query.includedTags, 'status')
        const sort = pickOption(query.includedTags, 'sort')
        if (status !== undefined) params.push(`status=${encodeURIComponent(status)}`)
        if (sort !== undefined) params.push(`sort=${encodeURIComponent(sort)}`)
        const base = genre ? absoluteUrl(genre.id, domain) : `${domain}/tim-truyen`
        return this.getListPage(params.length > 0 ? `${base}?${params.join('&')}` : base)
    }

    private async getListPage(url: string): Promise<PagedResults> {
        const $ = await this.loadPage(url)
        const nextUrl = parseNextPageUrl($, url, PAGER_SELECTOR)
        return App.createPagedResults({
            results: parseMangaList($, await this.site.load()),
            metadata: nextUrl && nextUrl !== url ? { nextUrl } : undefined
        })
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
