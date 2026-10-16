import type { CheerioAPI } from 'cheerio'
import {
    Chapter,
    PartialSourceManga,
    SourceManga,
    Tag
} from '@paperback/types'
import {
    absoluteUrl,
    cleanText,
    genreSection,
    imageFrom,
    isAdultContent,
    mapStatus
} from '../../shared/utils'
import { ListPage } from '../../shared/lists'

interface ApiResponse<T> {
    result?: T | null
    messages?: { messages?: string[] }
}

interface ApiManga {
    id?: string | number
    name?: string
    photo?: string
    nameEn?: string
}

interface ApiChapter {
    numberChapter?: string | number
    updateTime?: number
}

export interface ApiCategory {
    id: string | number
    name: string
}

/** Đọc `result` trong JSON của API; không có thì báo lỗi kèm thông báo của web. */
export function apiResult<T>(json: string, fallbackMessage: string): T {
    let body: ApiResponse<T>
    try {
        body = JSON.parse(json)
    } catch {
        throw new Error('Web không trả dữ liệu JSON (có thể cần Cloudflare Bypass)')
    }
    if (body?.result === undefined || body.result === null) {
        throw new Error(body?.messages?.messages?.[0] ?? fallbackMessage)
    }
    return body.result
}

/** Id truyện trong app: '<id>:<nameEn>'. Cần id cho API chương và nameEn cho URL trang truyện. */
export function mangaKey(id: string | number, nameEn: string): string {
    return `${id}:${nameEn}`
}

export function splitMangaId(mangaId: string): { id?: string, slug: string } {
    const index = mangaId.indexOf(':')
    return index === -1 ? { slug: mangaId } : { id: mangaId.slice(0, index), slug: mangaId.slice(index + 1) }
}

/** '...search?p=0&...' -> '...search?p=1&...'. */
export function nextSearchUrl(url: string): string {
    const match = url.match(/([?&])p=(\d+)/)
    if (!match) return url + (url.includes('?') ? '&' : '?') + 'p=1'
    return url.replace(/([?&])p=\d+/, `${match[1]}p=${parseInt(match[2]!) + 1}`)
}

export function parseSearchPage(json: string, url: string, domain: string): ListPage {
    const result = apiResult<{ next?: boolean, data?: ApiManga[] }>(json, 'Lỗi tải danh sách')
    const results: PartialSourceManga[] = []
    for (const manga of result.data ?? []) {
        if (manga.id === undefined || !manga.nameEn) continue
        results.push(App.createPartialSourceManga({
            mangaId: mangaKey(manga.id, manga.nameEn),
            title: cleanText(manga.name ?? '') || manga.nameEn,
            image: absoluteUrl(manga.photo, domain)
        }))
    }
    return { results, nextUrl: result.next ? nextSearchUrl(url) : undefined }
}

export function parseCategories(json: string): ApiCategory[] {
    return apiResult<ApiCategory[]>(json, 'Lỗi tải thể loại').filter(category => category.id !== undefined && category.name)
}

/** Giá trị sau nhãn, ví dụ <div class="mb-1">Tác giả: <span>ABC</span></div>. */
function labeledValue($: CheerioAPI, label: string): string {
    const row = $('.mb-1').filter((_, element) => $(element).text().includes(label)).first()
    return cleanText(row.find('span').first().text())
}

/** Id truyện trong trang HTML: `const comic = { id: "..." }` hoặc ô #comic-id-comment. */
export function parseComicId($: CheerioAPI): string | undefined {
    for (const script of $('script').toArray()) {
        const text = $(script).html() ?? ''
        if (!text.includes('const comic')) continue
        const id = text.match(/id:\s*"([^"]+)"/)?.[1]
        if (id) return id
    }
    return $('#comic-id-comment').attr('value')?.trim() || undefined
}

export function parseMangaDetails($: CheerioAPI, mangaId: string, domain: string): SourceManga {
    const title = cleanText($('.v-card-title').first().text()) || splitMangaId(mangaId).slug
    const author = labeledValue($, 'Tác giả')
    const status = labeledValue($, 'Trạng thái')
    // Id thể loại ở trang truyện là tên; tìm kiếm đổi tên sang mã thể loại của API.
    const tags: Tag[] = []
    $('.group-content > .v-chip-link').each((_, element) => {
        const label = cleanText($(element).text())
        if (label && !tags.some(tag => tag.label === label)) tags.push(App.createTag({ id: `name:${label}`, label }))
    })
    const desc = $('.v-card-text').toArray()
        .map(element => cleanText($(element).text()))
        .filter(text => text.length > 0)
        .join('\n\n')

    return App.createSourceManga({
        id: mangaId,
        mangaInfo: App.createMangaInfo({
            titles: [title],
            image: imageFrom($('img.image').first(), domain),
            author: author || 'Đang cập nhật',
            artist: author || 'Đang cập nhật',
            desc: desc || 'Không có mô tả',
            // Web ghi 'Đang thực hiện' / 'Hoàn thành'.
            status: mapStatus(status),
            hentai: isAdultContent(tags),
            tags: genreSection(tags)
        })
    })
}

/** Chương từ /api/comic/<id>/chapter; id chương là số chương ('17', '16.5'). */
export function parseChapters(json: string): Chapter[] {
    const result = apiResult<{ chapters?: ApiChapter[] }>(json, 'Phiên làm việc đã hết hạn, vui lòng tải lại.')
    const items = (result.chapters ?? [])
        .filter(chapter => chapter.numberChapter !== undefined && String(chapter.numberChapter).trim() !== '')
        .map(chapter => {
            const id = String(chapter.numberChapter).trim()
            const chapNum = parseFloat(id)
            return { id, chapNum: isNaN(chapNum) ? 0 : chapNum, time: chapter.updateTime }
        })
        // Không chắc API trả theo thứ tự nào: sắp mới nhất trước.
        .sort((a, b) => b.chapNum - a.chapNum)

    return items.map((item, index) => App.createChapter({
        id: item.id,
        chapNum: item.chapNum,
        langCode: 'vi',
        time: typeof item.time === 'number' && item.time > 0 ? new Date(item.time) : new Date(),
        sortingIndex: -index
    }))
}

/** Ảnh chương từ /api/chapter/loadAll; undefined khi web không trả danh sách ảnh (thường do cần đăng nhập). */
export function parseImageList(json: string, domain: string): string[] | undefined {
    let body: ApiResponse<{ data?: unknown }>
    try {
        body = JSON.parse(json)
    } catch {
        return undefined
    }
    const data = body?.result?.data
    if (!Array.isArray(data)) return undefined
    const pages = data
        .filter((url): url is string => typeof url === 'string' && url.trim() !== '')
        .map(url => absoluteUrl(url, domain))
    return pages.length > 0 ? pages : undefined
}
