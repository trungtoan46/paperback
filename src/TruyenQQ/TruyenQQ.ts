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
    parseNextPageUrl,
    parseTagLinks,
    toPath
} from '../../shared/utils'
import {
    PAGER_SELECTOR,
    parseChapterDetails,
    parseChapters,
    parseMangaDetails,
    parseMangaList
} from './TruyenQQParser'

// TruyenQQ hay đổi tên miền; khi web đổi thì sửa dòng này rồi tăng version.
const DOMAIN = 'https://truyenqqko.com'

export const TruyenQQInfo: SourceInfo = {
    version: '1.2.1',
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

const HOME_SECTIONS = [
    { id: 'latest', title: 'Mới cập nhật', path: '/truyen-moi-cap-nhat/trang-1.html', type: HomeSectionType.singleRowNormal },
    { id: 'favorite', title: 'Yêu thích', path: '/truyen-yeu-thich/trang-1.html', type: HomeSectionType.singleRowNormal }
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
                const url = DOMAIN + info.path
                const $ = await this.loadPage(url)
                section.items = parseMangaList($, DOMAIN)
                section.containsMoreItems = parseNextPageUrl($, url, PAGER_SELECTOR) !== undefined
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
        return this.getListPage(metadata?.nextUrl ?? DOMAIN + info.path)
    }

    async getSearchTags(): Promise<TagSection[]> {
        const $ = await this.loadPage(DOMAIN)
        return genreSection(parseTagLinks($, 'a[href*="/the-loai/"]', '/the-loai/'))
    }

    async supportsTagExclusion(): Promise<boolean> {
        return false
    }

    async getSearchResults(query: SearchRequest, metadata: ListMetadata | undefined): Promise<PagedResults> {
        if (metadata?.nextUrl) return this.getListPage(metadata.nextUrl)

        const title = query.title?.trim()
        let url: string
        if (title) {
            url = `${DOMAIN}/tim-kiem.html?q=${encodeURIComponent(title)}`
        } else if (query.includedTags && query.includedTags.length > 0) {
            // Web chỉ lọc một thể loại mỗi lần; id thể loại là path, ví dụ '/the-loai/action-26.html'.
            url = absoluteUrl(query.includedTags[0]!.id, DOMAIN)
        } else {
            url = `${DOMAIN}/truyen-moi-cap-nhat/trang-1.html`
        }
        return this.getListPage(url)
    }

    private async getListPage(url: string): Promise<PagedResults> {
        const $ = await this.loadPage(url)
        const nextUrl = parseNextPageUrl($, url, PAGER_SELECTOR)
        return App.createPagedResults({
            results: parseMangaList($, DOMAIN),
            metadata: nextUrl && nextUrl !== url ? { nextUrl } : undefined
        })
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
