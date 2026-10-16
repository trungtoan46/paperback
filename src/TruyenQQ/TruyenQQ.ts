import type { CheerioAPI } from 'cheerio'
import {
    BadgeColor,
    Chapter,
    ChapterDetails,
    ChapterProviding,
    CloudflareBypassRequestProviding,
    ContentRating,
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
    TagSection
} from '@paperback/types'
import {
    absoluteUrl,
    cloudflareError,
    genreSection,
    isCloudflareError,
    parseNextPageUrl,
    parseTagLinks,
    toPath
} from '../../shared/utils'
import {
    PAGER_SELECTOR,
    parseNextPageByNumber,
    parseChapterDetails,
    parseChapters,
    parseMangaDetails,
    parseMangaList
} from './TruyenQQParser'

// TruyenQQ hay đổi tên miền; khi web đổi thì sửa dòng này rồi tăng version.
const DOMAIN = 'https://truyenqqko.com'

export const TruyenQQInfo: SourceInfo = {
    version: '1.2.2',
    name: 'TruyenQQ',
    icon: 'icon.png',
    author: 'trungtoan46',
    authorWebsite: 'https://github.com/trungtoan46/paperback',
    description: 'Đọc truyện tranh từ TruyenQQ',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: DOMAIN,
    language: 'vi',
    sourceTags: [
        { text: 'Tiếng Việt', type: BadgeColor.GREY },
        { text: 'Cloudflare', type: BadgeColor.RED }
    ],
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS | SourceIntents.CLOUDFLARE_BYPASS_REQUIRED
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
const HOME_SECTIONS = [
    { id: 'latest', title: 'Mới cập nhật', paths: LATEST_PATHS, type: HomeSectionType.singleRowNormal },
    { id: 'favorite', title: 'Yêu thích', paths: ['/truyen-yeu-thich/trang-1', '/truyen-yeu-thich/trang-1.html'], type: HomeSectionType.singleRowNormal }
]

export class TruyenQQ implements SearchResultsProviding, MangaProviding, ChapterProviding,
    HomePageSectionsProviding, CloudflareBypassRequestProviding {

    constructor(private cheerio: CheerioAPI) { }

    readonly requestManager = App.createRequestManager({
        requestsPerSecond: 4,
        requestTimeout: 20000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    ...(request.headers ?? {}),
                    'referer': `${DOMAIN}/`,
                    'user-agent': await this.requestManager.getDefaultUserAgent()
                }
                return request
            },
            interceptResponse: async (response: Response): Promise<Response> => {
                return response
            }
        }
    })

    getMangaShareUrl(mangaId: string): string {
        return `${DOMAIN}/truyen-tranh/${mangaId}`
    }

    async getCloudflareBypassRequestAsync(): Promise<Request> {
        return App.createRequest({
            url: DOMAIN,
            method: 'GET',
            headers: {
                'referer': `${DOMAIN}/`,
                'user-agent': await this.requestManager.getDefaultUserAgent()
            }
        })
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const $ = await this.loadPage(this.getMangaShareUrl(mangaId))
        return parseMangaDetails($, mangaId, DOMAIN)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const $ = await this.loadPage(this.getMangaShareUrl(mangaId))
        return parseChapters($)
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        // Bản cũ (<= 1.1.0) lưu id chương là URL đầy đủ; chuyển về path để chạy với domain hiện tại.
        const $ = await this.loadPage(DOMAIN + toPath(chapterId))
        return parseChapterDetails($, mangaId, chapterId, DOMAIN)
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
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
                const page = await this.loadFirstList(info.paths.map(path => DOMAIN + path))
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
        const urls = metadata?.nextUrl ? [metadata.nextUrl] : info.paths.map(path => DOMAIN + path)
        return this.toPagedResults(await this.loadFirstList(urls))
    }

    async getSearchTags(): Promise<TagSection[]> {
        const $ = await this.loadPage(DOMAIN)
        return genreSection(parseTagLinks($, 'a[href*="/the-loai/"]', '/the-loai/'))
    }

    async supportsTagExclusion(): Promise<boolean> {
        return false
    }

    async getSearchResults(query: SearchRequest, metadata: ListMetadata | undefined): Promise<PagedResults> {
        let urls: string[]
        const title = query.title?.trim()
        if (metadata?.nextUrl) {
            urls = [metadata.nextUrl]
        } else if (title) {
            const q = encodeURIComponent(title)
            urls = [`${DOMAIN}/tim-kiem?q=${q}`, `${DOMAIN}/tim-kiem.html?q=${q}`]
        } else if (query.includedTags && query.includedTags.length > 0) {
            // Web chỉ lọc một thể loại mỗi lần; id thể loại là path, ví dụ '/the-loai/action-26'.
            urls = [absoluteUrl(query.includedTags[0]!.id, DOMAIN)]
        } else {
            urls = LATEST_PATHS.map(path => DOMAIN + path)
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
        for (const url of urls) {
            try {
                const $ = await this.loadPage(url)
                const results = parseMangaList($, DOMAIN)
                if (results.length === 0) continue
                // Chỉ đoán theo số trang khi không có thanh phân trang quen thuộc.
                const nextUrl = $(PAGER_SELECTOR).length > 0
                    ? parseNextPageUrl($, url, PAGER_SELECTOR)
                    : parseNextPageByNumber($, url, DOMAIN)
                return { results, nextUrl: nextUrl !== url ? nextUrl : undefined }
            } catch (error) {
                if (isCloudflareError(error)) throw error
                lastError = error
            }
        }
        if (lastError) throw lastError
        return { results: [] }
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
