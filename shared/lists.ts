import { HomeSection, HomeSectionType, PagedResults, PartialSourceManga, SourceStateManager } from '@paperback/types'
import { errorStatus, isCloudflareError } from './utils'

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
 * Chỉ chuyển sang URL kế tiếp khi URL này không còn (404/410) hoặc không có truyện; lỗi khác
 * (Cloudflare, giới hạn tốc độ, lỗi máy chủ, hết giờ) báo ngay để khỏi gọi thêm khi web đang chặn.
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
            const status = errorStatus(error)
            if (status !== 404 && status !== 410) throw error
            lastError = error
        }
    }
    if (!loaded && lastError) throw lastError
    return { results: [] }
}

/** Mô tả ngắn để hiện cạnh tên mục trang chủ khi mục đó không có truyện. */
export function describeError(error: unknown): string {
    if (isCloudflareError(error)) return 'cần Cloudflare Bypass'
    const status = errorStatus(error)?.toString() ?? (error instanceof Error ? error.message.match(/HTTP (\d{3})/)?.[1] : undefined)
    if (status === '429') return 'web đang giới hạn, thử lại sau'
    return status ? `lỗi HTTP ${status}` : 'lỗi tải'
}

/** Ô giữ chỗ khi mục trang chủ đang tải lần đầu (app không tự hiện trạng thái đang tải). */
const LOADING_ID = '__loading__'
const LOADING_IMAGE = 'https://raw.githubusercontent.com/trungtoan46/paperback/main/docs/images/loading.png'

export function isLoadingTile(mangaId: string): boolean {
    return mangaId === LOADING_ID
}

function loadingTile(): PartialSourceManga {
    return App.createPartialSourceManga({ mangaId: LOADING_ID, title: 'Đang tải…', subtitle: 'Vui lòng chờ', image: LOADING_IMAGE })
}

interface CachedManga {
    mangaId: string
    title: string
    image: string
    subtitle?: string
}

const cacheKey = (sectionId: string) => `home:${sectionId}`

async function readCache(stateManager: SourceStateManager, sectionId: string): Promise<PartialSourceManga[]> {
    try {
        const value: unknown = await stateManager.retrieve(cacheKey(sectionId))
        if (!Array.isArray(value)) return []
        return (value as CachedManga[])
            .filter(item => typeof item?.mangaId === 'string' && typeof item.title === 'string')
            .map(item => App.createPartialSourceManga({
                mangaId: item.mangaId,
                title: item.title,
                image: typeof item.image === 'string' ? item.image : '',
                subtitle: typeof item.subtitle === 'string' ? item.subtitle : undefined
            }))
    } catch {
        return []
    }
}

/** Lưu danh sách cho lần mở sau; lỗi khi lưu chỉ bỏ qua (không ảnh hưởng mục vừa tải xong). */
async function writeCache(stateManager: SourceStateManager, sectionId: string, items: PartialSourceManga[]): Promise<void> {
    try {
        const plain: CachedManga[] = items.map(item => ({ mangaId: item.mangaId, title: item.title, image: item.image, subtitle: item.subtitle }))
        await stateManager.store(cacheKey(sectionId), plain)
    } catch {
        // bỏ qua
    }
}

/**
 * Hiện ngay danh sách lần trước (hoặc ô "Đang tải…" nếu chưa có), rồi tải lại từng mục độc lập
 * (một mục lỗi không làm hỏng mục khác). Mục lỗi hoặc trống ghi lý do trên tiêu đề,
 * ví dụ 'Top tháng (lỗi HTTP 404)'; khi lỗi vẫn giữ danh sách lần trước.
 */
export async function loadHomeSections(
    infos: HomeSectionInfo[],
    domain: string,
    sectionCallback: (section: HomeSection) => void,
    loadFirstList: (urls: string[]) => Promise<ListPage>,
    sourceName: string,
    stateManager: SourceStateManager
): Promise<void> {
    const cached = await Promise.all(infos.map(info => readCache(stateManager, info.id)))
    infos.forEach((info, index) => {
        const items = cached[index]!
        sectionCallback(App.createHomeSection({
            id: info.id,
            title: info.title,
            type: info.type,
            items: items.length > 0 ? items : [loadingTile()],
            containsMoreItems: true
        }))
    })

    await Promise.all(infos.map(async (info, index) => {
        let title = info.title
        let page: ListPage = { results: [] }
        try {
            page = await loadFirstList(info.paths.map(path => domain + path))
            if (page.results.length === 0) title = `${info.title} (không có truyện)`
        } catch (error) {
            console.log(`${sourceName}: lỗi tải mục ${info.id}: ${error}`)
            title = `${info.title} (${describeError(error)})`
        }
        const fresh = page.results.length > 0
        sectionCallback(App.createHomeSection({
            id: info.id,
            title,
            type: info.type,
            items: fresh ? page.results : cached[index]!,
            containsMoreItems: fresh && page.nextUrl !== undefined
        }))
        if (fresh) await writeCache(stateManager, info.id, page.results)
    }))
}
