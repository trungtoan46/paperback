import type { AnyNode, Cheerio, CheerioAPI, Element } from 'cheerio'
import { Tag, TagSection } from '@paperback/types'

/** Bỏ domain, query và hash; trả về path bắt đầu bằng '/'. */
export function toPath(href: string): string {
    let path = href.trim().replace(/^https?:\/\/[^/]+/i, '').replace(/^\/\/[^/]+/, '')
    path = path.split('#')[0]!.split('?')[0]!
    return path.startsWith('/') ? path : '/' + path
}

/** Đoạn path ngay sau `prefix`, ví dụ ('/truyen-tranh/abc', '/truyen-tranh/') -> 'abc'. */
export function segmentsAfter(href: string | undefined, prefix: string): string[] | undefined {
    if (!href) return undefined
    const path = toPath(href)
    const index = path.indexOf(prefix)
    if (index === -1) return undefined
    const segments = path.slice(index + prefix.length).split('/').filter(segment => segment.length > 0)
    return segments.length > 0 ? segments : undefined
}

export function absoluteUrl(url: string | undefined, domain: string): string {
    const value = (url ?? '').trim()
    if (!value) return ''
    if (value.startsWith('//')) return 'https:' + value
    if (/^https?:\/\//i.test(value)) return value
    return domain + (value.startsWith('/') ? value : '/' + value)
}

export function imageFrom($img: Cheerio<Element>, domain: string): string {
    for (const attr of ['data-original', 'data-src', 'data-cdn', 'src']) {
        const value = $img.attr(attr)?.trim()
        // Ảnh lazy-load thường để src là placeholder dạng data:
        if (value && !value.startsWith('data:')) return absoluteUrl(value, domain)
    }
    return ''
}

export function cleanText(text: string): string {
    return text.replace(/\s+/g, ' ').trim()
}

/** Chữ của một khối, mỗi đoạn <p> một dòng (text() dính các đoạn vào nhau). */
export function blockText($: CheerioAPI, $element: Cheerio<AnyNode>): string {
    const paragraphs = $element.find('p').toArray()
        .map(paragraph => cleanText($(paragraph).text()))
        .filter(text => text.length > 0)
    return paragraphs.length > 0 ? paragraphs.join('\n') : cleanText($element.text())
}

/** Đổi '5 phút trước', '2 giờ trước', '16/10/2026', '16/10/26', '12:30 16/10', '2026-10-16 08:30:00' sang Date. */
export function parseTime(raw: string, now: number = Date.now()): Date {
    const text = raw.toLowerCase().trim()
    // new Date('2026-10-16 08:30:00') ra Invalid Date trên Safari/JavaScriptCore nên tự tách.
    const iso = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[ t](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
    if (iso) {
        const [, year, month, day, hour, minute, second] = iso
        return new Date(parseInt(year!), parseInt(month!) - 1, parseInt(day!),
            parseInt(hour ?? '0'), parseInt(minute ?? '0'), parseInt(second ?? '0'))
    }
    const full = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
    if (full) {
        let year = parseInt(full[3]!)
        if (year < 100) year += 2000
        return new Date(year, parseInt(full[2]!) - 1, parseInt(full[1]!))
    }
    const short = text.match(/(\d{1,2})\/(\d{1,2})/)
    if (short) {
        return new Date(new Date(now).getFullYear(), parseInt(short[2]!) - 1, parseInt(short[1]!))
    }
    const amount = parseInt(text.match(/(\d+)/)?.[1] ?? '1')
    const units: [string, number][] = [
        ['giây', 1000],
        ['phút', 60 * 1000],
        ['giờ', 60 * 60 * 1000],
        ['ngày', 24 * 60 * 60 * 1000],
        ['tuần', 7 * 24 * 60 * 60 * 1000],
        ['tháng', 30 * 24 * 60 * 60 * 1000],
        ['năm', 365 * 24 * 60 * 60 * 1000]
    ]
    for (const [unit, ms] of units) {
        if (text.includes(unit)) return new Date(now - amount * ms)
    }
    return new Date(now)
}

/**
 * Số chương từ URL ('...-chap-12.5.html', '.../chapter-12-5/98765', '.../chuong-12')
 * hoặc từ tên ('Chương 12.5', 'Chapter 12').
 */
export function parseChapterNumber(url: string, name: string): number | undefined {
    const fromUrl = toPath(url).match(/(?:^|[/-])(?:chap|chapter|chuong)-(\d+)(?:[.-](\d+))?(?:\.html)?(?:\/\d+)?\/?$/i)
    if (fromUrl) return parseFloat(fromUrl[1]! + (fromUrl[2] ? '.' + fromUrl[2] : ''))
    const fromName = name.match(/(?:chương|chap(?:ter)?)\s*(\d+(?:[.,]\d+)?)/i)
    if (fromName) return parseFloat(fromName[1]!.replace(',', '.'))
    return undefined
}

export function mapStatus(raw: string): string {
    const text = raw.toLowerCase()
    if (text.includes('hoàn thành') || text.includes('full') || text.includes('completed')) return 'Completed'
    if (text.includes('tạm ngưng') || text.includes('drop')) return 'Hiatus'
    return 'Ongoing'
}

/**
 * Link trang kế tiếp, đọc từ thanh phân trang.
 * Đọc từ HTML thay vì tự ghép URL để không phụ thuộc mẫu URL của từng loại danh sách.
 */
export function parseNextPageUrl($: CheerioAPI, pageUrl: string, pagerSelector: string): string | undefined {
    const within = (child: string) => pagerSelector.split(',').map(part => `${part.trim()} ${child}`).join(', ')
    const $links = $(within('a'))
    if ($links.length === 0) return undefined
    const href = ($a: Cheerio<AnyNode>) => {
        const value = $a.attr('href')?.trim()
        if (!value || value === '#' || value.startsWith('javascript:')) return undefined
        // Link chỉ có query ('?page=2') tính theo trang hiện tại.
        if (value.startsWith('?')) return pageUrl.split('?')[0] + value
        return absoluteUrl(value, pageUrl.match(/^https?:\/\/[^/]+/i)?.[0] ?? '')
    }

    const active = parseInt(cleanText($(within('.active')).first().text()))
    if (!isNaN(active)) {
        const next = $links.filter((_, a) => cleanText($(a).text()) === String(active + 1)).first()
        if (next.length > 0) return href(next)
        // Đang ở trang cuối nếu không còn số trang lớn hơn.
        const hasLater = $links.toArray().some(a => parseInt(cleanText($(a).text())) > active)
        if (!hasLater) return undefined
    }

    const arrow = $links.filter((_, a) => {
        const $a = $(a)
        const text = cleanText($a.text()).toLowerCase()
        return $a.attr('rel') === 'next' || /next/i.test($a.attr('class') ?? '') || text === '›' || text === '>' || text === 'sau'
    }).first()
    return arrow.length > 0 ? href(arrow) : undefined
}

/** Link thể loại -> Tag, id là path (ví dụ '/the-loai/action-26.html'). */
export function parseTagLinks($: CheerioAPI, selector: string, pathMarker: string): Tag[] {
    const tags: Tag[] = []
    const seen = new Set<string>()
    $(selector).each((_, element) => {
        const href = $(element).attr('href')
        // Tiêu đề mục ở trang chủ có dạng 'Manhua >': bỏ mũi tên cuối.
        const label = cleanText($(element).text()).replace(/\s*[>›»]+$/, '')
        if (!href || !label || !href.includes(pathMarker)) return
        const id = toPath(href)
        // Bỏ link tới chính trang danh sách ('/tim-truyen'), chỉ giữ trang thể loại cụ thể.
        if (seen.has(id) || segmentsAfter(id, pathMarker) === undefined) return
        seen.add(id)
        tags.push(App.createTag({ id, label }))
    })
    return tags
}

/** Truyện có thể loại người lớn (Adult, Smut, Hentai, 18+) được đánh dấu 18+ trong Paperback. */
export function isAdultContent(tags: Tag[]): boolean {
    return tags.some(tag => /\b(adult|smut|hentai)\b|18\s*\+/i.test(tag.label))
}

export function genreSection(tags: Tag[]): TagSection[] {
    return tags.length > 0 ? [App.createTagSection({ id: 'genres', label: 'Thể loại', tags })] : []
}

const CLOUDFLARE_ERROR = 'CloudflareError'

export function cloudflareError(status: number, sourceName: string): Error {
    const error = new Error(`Cloudflare chặn (HTTP ${status}). Vào cài đặt nguồn ${sourceName} và bấm "Cloudflare Bypass", sau đó thử lại.`)
    error.name = CLOUDFLARE_ERROR
    return error
}

export function isCloudflareError(error: unknown): boolean {
    return error instanceof Error && error.name === CLOUDFLARE_ERROR
}
