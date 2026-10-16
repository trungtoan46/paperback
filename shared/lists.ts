import { HomeSection, HomeSectionType, PagedResults, PartialSourceManga } from '@paperback/types'
import { isCloudflareError } from './utils'

export interface ListPage {
    results: PartialSourceManga[]
    nextUrl?: string
}

export interface HomeSectionInfo {
    id: string
    title: string
    /** Thử lần lượt tới khi có truyện (web hay đổi URL). */
    paths: string[]
    type: HomeSectionType
}

export function toPagedResults(page: ListPage): PagedResults {
    return App.createPagedResults({
        results: page.results,
        metadata: page.nextUrl ? { nextUrl: page.nextUrl } : undefined
    })
}

/**
 * Thử lần lượt từng URL, trả về trang đầu tiên có truyện.
 * Lỗi Cloudflare báo ngay; mọi URL đều lỗi thì ném lỗi cuối; không lỗi mà không có truyện thì trả danh sách rỗng.
 */
export async function firstListWithItems(urls: string[], loadList: (url: string) => Promise<ListPage>): Promise<ListPage> {
    let lastError: unknown
    let loaded = false
    for (const url of urls) {
        try {
            const page = await loadList(url)
            loaded = true
            if (page.results.length > 0) return page
        } catch (error) {
            if (isCloudflareError(error)) throw error
            lastError = error
        }
    }
    if (!loaded && lastError) throw lastError
    return { results: [] }
}

/** Mô tả ngắn để hiện cạnh tên mục trang chủ khi mục đó không có truyện. */
export function describeError(error: unknown): string {
    if (isCloudflareError(error)) return 'cần Cloudflare Bypass'
    const status = error instanceof Error ? error.message.match(/HTTP (\d{3})/)?.[1] : undefined
    return status ? `lỗi HTTP ${status}` : 'lỗi tải'
}

/**
 * Hiện các mục trang chủ rồi tải từng mục độc lập (một mục lỗi không làm hỏng mục khác).
 * Mục lỗi hoặc trống ghi lý do trên tiêu đề, ví dụ 'Top tháng (lỗi HTTP 404)'.
 */
export async function loadHomeSections(
    infos: HomeSectionInfo[],
    domain: string,
    sectionCallback: (section: HomeSection) => void,
    loadFirstList: (urls: string[]) => Promise<ListPage>,
    sourceName: string
): Promise<void> {
    for (const info of infos) {
        sectionCallback(App.createHomeSection({ id: info.id, title: info.title, type: info.type, containsMoreItems: true }))
    }

    await Promise.all(infos.map(async info => {
        let title = info.title
        let page: ListPage = { results: [] }
        try {
            page = await loadFirstList(info.paths.map(path => domain + path))
            if (page.results.length === 0) title = `${info.title} (không có truyện)`
        } catch (error) {
            console.log(`${sourceName}: lỗi tải mục ${info.id}: ${error}`)
            title = `${info.title} (${describeError(error)})`
        }
        sectionCallback(App.createHomeSection({
            id: info.id,
            title,
            type: info.type,
            items: page.results,
            containsMoreItems: page.nextUrl !== undefined
        }))
    }))
}
