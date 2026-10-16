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
import { checkResponse, cloudflareError, errorStatus, isCloudflareBlock } from '../../shared/utils'
import { FilterOption, optionSection, pickOption } from '../../shared/filters'
import { firstListWithItems, HomeSectionInfo, isLoadingTile, ListPage, loadHomeSections, toPagedResults } from '../../shared/lists'
import { DomainSetting } from '../../shared/settings'
import { ShortCache } from '../../shared/cache'
import {
    ApiCategory,
    parseCategories,
    parseChapters,
    parseComicId,
    parseImageList,
    parseMangaDetails,
    parseSearchPage,
    splitMangaId
} from './GocTruyenTranhVuiParser'

// Tên miền mặc định; người dùng đổi được trong cài đặt nguồn khi web đổi địa chỉ.
const DEFAULT_DOMAIN = 'https://goctruyentranhvui31.com'
const SOURCE_NAME = 'Góc Truyện Tranh Vui'

export const GocTruyenTranhVuiInfo: SourceInfo = {
    version: '1.0.3',
    name: SOURCE_NAME,
    icon: 'icon.png',
    author: 'trungtoan46',
    authorWebsite: 'https://github.com/trungtoan46/paperback',
    description: 'Đọc truyện tranh từ Góc Truyện Tranh Vui',
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

const XHR = { 'x-requested-with': 'XMLHttpRequest' }
const SEARCH = '/api/v2/search?p=0'

const HOME_SECTIONS: HomeSectionInfo[] = [
    { id: 'latest', title: 'Mới cập nhật', paths: [`${SEARCH}&orders%5B%5D=recentDate`], type: HomeSectionType.singleRowNormal },
    { id: 'popular', title: 'Xem nhiều', paths: [`${SEARCH}&orders%5B%5D=viewCount`], type: HomeSectionType.singleRowNormal },
    { id: 'new', title: 'Truyện mới', paths: [`${SEARCH}&orders%5B%5D=createdAt`], type: HomeSectionType.singleRowNormal },
    { id: 'completed', title: 'Hoàn thành', paths: [`${SEARCH}&status%5B%5D=END&orders%5B%5D=viewCount`], type: HomeSectionType.singleRowNormal }
]

// Bỏ 'Truyện chữ' (novel): Paperback chỉ đọc truyện tranh.
const STATUS: FilterOption[] = [
    { value: 'PRG', label: 'Đang thực hiện' },
    { value: 'END', label: 'Hoàn thành' }
]
const SORT: FilterOption[] = [
    { value: 'recentDate', label: 'Ngày cập nhật' },
    { value: 'viewCount', label: 'Lượt xem' },
    { value: 'evaluationScore', label: 'Lượt đánh giá' },
    { value: 'followerCount', label: 'Lượt theo dõi' },
    { value: 'createdAt', label: 'Truyện mới' }
]

interface FetchOptions {
    method?: 'GET' | 'POST'
    data?: string
    headers?: Record<string, string>
    /** Trả response cả khi lỗi HTTP (để tự xử lý). */
    allowErrors?: boolean
}

export class GocTruyenTranhVui implements SearchResultsProviding, MangaProviding, ChapterProviding,
    HomePageSectionsProviding, CloudflareBypassRequestProviding {

    constructor(private cheerio: CheerioAPI) {
        // Nạp sẵn tên miền đã lưu để getMangaShareUrl (không chờ được) dùng đúng tên miền.
        this.site.load().catch(() => undefined)
    }

    readonly stateManager = App.createSourceStateManager()
    private readonly site = new DomainSetting(this.stateManager, DEFAULT_DOMAIN)
    private readonly mangaPages = new ShortCache<string>(60 * 1000)
    private categories: Promise<ApiCategory[]> | undefined

    readonly requestManager = App.createRequestManager({
        requestsPerSecond: 3,
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
        return `${this.site.current}/truyen/${splitMangaId(mangaId).slug}`
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
        const { $, domain } = await this.loadMangaPage(splitMangaId(mangaId).slug)
        return parseMangaDetails($, mangaId, domain)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        if (isLoadingTile(mangaId)) throw new Error('Danh sách đang tải, vui lòng chờ một chút.')
        const domain = await this.site.load()
        const { id, slug } = await this.resolveIds(mangaId)
        const url = `${domain}/api/comic/${encodeURIComponent(id)}/chapter?limit=-1`
        const load = async () => parseChapters((await this.fetch(url, { headers: XHR })).data ?? '')

        let chapters: Chapter[]
        try {
            chapters = await load()
        } catch (error) {
            // Hết phiên (API trả result rỗng, không kèm mã HTTP): mở lại trang truyện để lấy cookie mới rồi thử lần nữa.
            if (errorStatus(error) !== undefined) throw error
            await this.refreshSession(domain, slug)
            chapters = await load()
        }
        // Trả danh sách rỗng khi cập nhật thư viện có thể làm app xoá chương đã đọc: báo lỗi thay vào đó.
        if (chapters.length === 0) throw new Error(`${SOURCE_NAME}: chưa có chương nào hoặc web đang lỗi`)
        return chapters
    }

    /** Mở lại trang truyện để web cấp cookie phiên mới. */
    private async refreshSession(domain: string, slug: string): Promise<void> {
        const response = await this.fetch(`${domain}/truyen/${slug}`, { allowErrors: true })
        if (isCloudflareBlock(response)) throw cloudflareError(response.status, SOURCE_NAME)
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const domain = await this.site.load()
        const { id, slug } = await this.resolveIds(mangaId)
        const body = [
            `comicId=${encodeURIComponent(id)}`,
            `chapterNumber=${encodeURIComponent(chapterId)}`,
            `nameEn=${encodeURIComponent(slug)}`
        ].join('&')
        const loadImages = async (): Promise<string[] | undefined> => {
            const response = await this.fetch(`${domain}/api/chapter/loadAll`, {
                method: 'POST',
                data: body,
                headers: { ...XHR, 'content-type': 'application/x-www-form-urlencoded' },
                allowErrors: true
            })
            if (isCloudflareBlock(response)) throw cloudflareError(response.status, SOURCE_NAME)
            return response.status < 400 ? parseImageList(response.data ?? '', domain) : undefined
        }

        let pages = await loadImages()
        if (!pages) {
            // Phiên làm việc hết hạn: mở lại trang truyện để web cấp cookie mới rồi thử lần nữa.
            await this.refreshSession(domain, slug)
            pages = await loadImages()
        }
        if (!pages) {
            throw new Error('Không tải được ảnh chương. Chương có thể cần đăng nhập: vào cài đặt nguồn, bấm Cloudflare Bypass, đăng nhập trên web rồi thử lại.')
        }
        return App.createChapterDetails({ id: chapterId, mangaId, pages })
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        await loadHomeSections(HOME_SECTIONS, await this.site.load(), sectionCallback, urls => this.loadFirstList(urls), SOURCE_NAME, this.stateManager)
    }

    async getViewMoreItems(homepageSectionId: string, metadata: ListMetadata | undefined): Promise<PagedResults> {
        const info = HOME_SECTIONS.find(section => section.id === homepageSectionId)
        if (!info) return App.createPagedResults({ results: [] })
        const domain = await this.site.load()
        const urls = metadata?.nextUrl ? [metadata.nextUrl] : info.paths.map(path => domain + path)
        return toPagedResults(await this.loadFirstList(urls))
    }

    async getSearchTags(): Promise<TagSection[]> {
        const categories = await this.getCategories().catch(() => [] as ApiCategory[])
        return [
            App.createTagSection({
                id: 'genres',
                label: 'Thể loại',
                tags: categories.map(category => App.createTag({ id: `cat:${category.id}`, label: category.name }))
            }),
            optionSection('status', 'Tình trạng', STATUS),
            optionSection('sort', 'Sắp xếp', SORT)
        ].filter(section => section.tags.length > 0)
    }

    async supportsTagExclusion(): Promise<boolean> {
        return false
    }

    async getSearchResults(query: SearchRequest, metadata: ListMetadata | undefined): Promise<PagedResults> {
        if (metadata?.nextUrl) return toPagedResults(await this.loadListPage(metadata.nextUrl))

        const tags = query.includedTags ?? []
        const params = ['p=0']
        const title = query.title?.trim()
        if (title) params.push(`searchValue=${encodeURIComponent(title)}`)

        // Web lọc được nhiều thể loại cùng lúc và kết hợp được với tìm theo tên.
        const categoryIds = tags.filter(tag => tag.id.startsWith('cat:')).map(tag => tag.id.slice(4))
        const names = tags.filter(tag => tag.id.startsWith('name:')).map(tag => tag.label.toLowerCase())
        if (names.length > 0) {
            // Không đổi được tên sang mã thể loại thì báo lỗi, đừng trả về toàn bộ truyện như chưa lọc.
            const matched = (await this.getCategories()).filter(category => names.includes(category.name.toLowerCase()))
            if (matched.length === 0) throw new Error(`${SOURCE_NAME}: không tìm thấy thể loại này trên web`)
            categoryIds.push(...matched.map(category => String(category.id)))
        }
        for (const id of new Set(categoryIds)) params.push(`categories%5B%5D=${encodeURIComponent(id)}`)
        for (const tag of tags.filter(item => item.id.startsWith('status:'))) {
            params.push(`status%5B%5D=${encodeURIComponent(tag.id.slice(7))}`)
        }
        const sort = pickOption(tags, 'sort')
        if (sort !== undefined) params.push(`orders%5B%5D=${encodeURIComponent(sort)}`)

        return toPagedResults(await this.loadListPage(`${await this.site.load()}/api/v2/search?${params.join('&')}`))
    }

    private getCategories(): Promise<ApiCategory[]> {
        if (!this.categories) {
            this.categories = this.site.load()
                .then(domain => this.fetch(`${domain}/api/category`, { headers: XHR }))
                .then(response => parseCategories(response.data ?? ''))
            // Lỗi thì lần sau tải lại.
            this.categories.catch(() => { this.categories = undefined })
        }
        return this.categories
    }

    /** Id dạng '<id>:<nameEn>'; nếu thiếu id thì đọc từ trang truyện. */
    private async resolveIds(mangaId: string): Promise<{ id: string, slug: string }> {
        const { id, slug } = splitMangaId(mangaId)
        if (id) return { id, slug }
        const comicId = parseComicId((await this.loadMangaPage(slug)).$)
        if (!comicId) throw new Error(`${SOURCE_NAME}: không tìm thấy mã truyện trong trang ${slug}`)
        return { id: comicId, slug }
    }

    private async loadFirstList(urls: string[]): Promise<ListPage> {
        return firstListWithItems(urls, url => this.loadListPage(url))
    }

    private async loadListPage(url: string): Promise<ListPage> {
        const response = await this.fetch(url, { headers: XHR })
        return parseSearchPage(response.data ?? '', url, await this.site.load())
    }

    /** Trang truyện dùng cho chi tiết và để đọc mã truyện: nhớ tạm để không tải hai lần. */
    private async loadMangaPage(slug: string): Promise<{ $: CheerioAPI, domain: string }> {
        const domain = await this.site.load()
        const url = `${domain}/truyen/${slug}`
        const html = await this.mangaPages.get(url, async () => (await this.fetch(url)).data ?? '')
        return { $: this.cheerio.load(html), domain }
    }

    private async fetch(url: string, options: FetchOptions = {}): Promise<Response> {
        const request = App.createRequest({
            url,
            method: options.method ?? 'GET',
            headers: options.headers ?? {},
            data: options.data
        })
        const response = await this.requestManager.schedule(request, 1)
        if (!options.allowErrors) checkResponse(response, SOURCE_NAME, url)
        return response
    }
}
