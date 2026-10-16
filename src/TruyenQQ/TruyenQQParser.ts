import type { Cheerio, CheerioAPI, Element } from 'cheerio'
import {
    Chapter,
    ChapterDetails,
    PartialSourceManga,
    SourceManga,
    Tag,
    TagSection
} from '@paperback/types'

const MANGA_PATH = '/truyen-tranh/'

/** Bỏ domain, query và hash; trả về path bắt đầu bằng '/'. */
export function toPath(href: string): string {
    let path = href.trim().replace(/^https?:\/\/[^/]+/i, '').replace(/^\/\/[^/]+/, '')
    path = path.split('#')[0]!.split('?')[0]!
    return path.startsWith('/') ? path : '/' + path
}

/** '/truyen-tranh/ten-truyen-123' -> 'ten-truyen-123'. Bỏ qua link chương. */
export function mangaIdFromHref(href: string | undefined): string | undefined {
    if (!href) return undefined
    const path = toPath(href)
    const index = path.indexOf(MANGA_PATH)
    if (index === -1) return undefined
    const id = path.slice(index + MANGA_PATH.length).replace(/\/+$/, '')
    if (!id || id.includes('/') || /-chap-/i.test(id)) return undefined
    return id
}

export function absoluteUrl(url: string | undefined, domain: string): string {
    const value = (url ?? '').trim()
    if (!value) return ''
    if (value.startsWith('//')) return 'https:' + value
    if (/^https?:\/\//i.test(value)) return value
    return domain + (value.startsWith('/') ? value : '/' + value)
}

function imageFrom($img: Cheerio<Element>, domain: string): string {
    for (const attr of ['data-original', 'data-src', 'data-cdn', 'src']) {
        const value = $img.attr(attr)?.trim()
        // Ảnh lazy-load thường để src là placeholder dạng data: hoặc .gif
        if (value && !value.startsWith('data:')) return absoluteUrl(value, domain)
    }
    return ''
}

function cleanText(text: string): string {
    return text.replace(/\s+/g, ' ').trim()
}

/** Đổi '5 phút trước', '2 giờ trước', '16/10/2026', '16/10' sang Date. */
export function parseTime(raw: string, now: number = Date.now()): Date {
    const text = raw.toLowerCase().trim()
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

/** Lấy số chương từ URL ('...-chap-12.5.html') hoặc tên ('Chương 12.5'). */
export function parseChapterNumber(url: string, name: string): number | undefined {
    const fromUrl = toPath(url).match(/-chap-(\d+)(?:[.-](\d+))?(?:\.html)?$/i)
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

/** Danh sách truyện dạng lưới (trang chủ, mới cập nhật, tìm kiếm, thể loại). */
export function parseMangaList($: CheerioAPI, domain: string): PartialSourceManga[] {
    const results: PartialSourceManga[] = []
    const seen = new Set<string>()
    $('ul.list_grid > li, ul.grid > li, .list_grid li').each((_, element) => {
        const $item = $(element)
        const $link = $item.find('.book_name a, .book_info a, .book_avatar a, a').filter((_, a) => {
            return mangaIdFromHref($(a).attr('href')) !== undefined
        }).first()
        const mangaId = mangaIdFromHref($link.attr('href'))
        if (!mangaId || seen.has(mangaId)) return
        seen.add(mangaId)

        const $img = $item.find('.book_avatar img, img').first()
        const title = cleanText($item.find('.book_name a, .book_name').first().text())
            || $link.attr('title')?.trim()
            || $img.attr('alt')?.trim()
            || mangaId
        const subtitle = cleanText($item.find('.last_chapter a, .last_chapter, .chapter_name').first().text())

        results.push(App.createPartialSourceManga({
            mangaId,
            title,
            image: imageFrom($img, domain),
            subtitle: subtitle || undefined
        }))
    })
    return results
}

/**
 * Link trang kế tiếp, đọc từ thanh phân trang.
 * Đọc từ HTML thay vì tự ghép URL để không phụ thuộc mẫu URL của từng loại danh sách.
 */
export function parseNextPageUrl($: CheerioAPI, domain: string): string | undefined {
    const $links = $('.page_redirect a, .pagination a, .page_redirect_2 a')
    if ($links.length === 0) return undefined

    const activeText = cleanText($('.page_redirect .active, .pagination .active').first().text())
    const active = parseInt(activeText)
    if (!isNaN(active)) {
        const next = $links.filter((_, a) => cleanText($(a).text()) === String(active + 1)).first()
        if (next.length > 0) return absoluteUrl(next.attr('href'), domain)
        // Đang ở trang cuối nếu không còn số trang lớn hơn.
        const hasLater = $links.toArray().some(a => parseInt(cleanText($(a).text())) > active)
        if (!hasLater) return undefined
    }

    const arrow = $links.filter((_, a) => {
        const $a = $(a)
        const text = cleanText($a.text()).toLowerCase()
        return $a.attr('rel') === 'next' || /next/i.test($a.attr('class') ?? '') || text === '›' || text === '>' || text === 'sau'
    }).first()
    return arrow.length > 0 ? absoluteUrl(arrow.attr('href'), domain) : undefined
}

export function parseGenreTags($: CheerioAPI, selector: string): Tag[] {
    const tags: Tag[] = []
    const seen = new Set<string>()
    $(selector).each((_, element) => {
        const href = $(element).attr('href')
        const label = cleanText($(element).text())
        if (!href || !label || !href.includes('/the-loai/')) return
        const id = toPath(href)
        if (seen.has(id)) return
        seen.add(id)
        tags.push(App.createTag({ id, label }))
    })
    return tags
}

export function parseMangaDetails($: CheerioAPI, mangaId: string, domain: string): SourceManga {
    const title = cleanText($('h1[itemprop=name], .book_other h1, .book_info h1, h1').first().text()) || mangaId
    const otherNames = cleanText($('li.othername h2, .other-name').first().text())
        .split(/[;,]/)
        .map(name => name.trim())
        .filter(name => name.length > 0 && name !== title)

    const author = cleanText($('li.author p.col-xs-9, li.author .org, .list-info .org, .list_info .org').first().text())
    const status = cleanText($('li.status p.col-xs-9, li.status .col-xs-9').first().text())
    const desc = cleanText($('.story-detail-info, .detail-content, .story_introduction').first().text())
    const tags = parseGenreTags($, 'ul.list01 li a, .list01 a')

    return App.createSourceManga({
        id: mangaId,
        mangaInfo: App.createMangaInfo({
            titles: [title, ...otherNames],
            image: imageFrom($('.book_avatar img, img[itemprop=image]').first(), domain),
            author: author || 'Đang cập nhật',
            artist: author || 'Đang cập nhật',
            desc: desc || 'Không có mô tả',
            status: mapStatus(status),
            hentai: false,
            tags: genreSection(tags)
        })
    })
}

export function parseChapters($: CheerioAPI): Chapter[] {
    const chapters: Chapter[] = []
    const seen = new Set<string>()
    const $items = $('.works-chapter-list .works-chapter-item, .list_chapter .works-chapter-item, .works-chapter-item')
    // Trang liệt kê chương mới nhất trước: chương mới nhất có sortingIndex lớn nhất.
    $items.each((index, element) => {
        const $item = $(element)
        const $link = $item.find('.name-chap a, a').first()
        const href = $link.attr('href')
        if (!href) return
        const id = toPath(href)
        if (seen.has(id)) return
        seen.add(id)

        const name = cleanText($link.text())
        const chapNum = parseChapterNumber(href, name)
        chapters.push(App.createChapter({
            id,
            chapNum: chapNum ?? $items.length - index,
            name: name || undefined,
            langCode: 'vi',
            time: parseTime(cleanText($item.find('.time-chap').first().text())),
            sortingIndex: -index
        }))
    })
    return chapters
}

export function parseChapterPages($: CheerioAPI, domain: string): string[] {
    const pages: string[] = []
    $('.page-chapter img, #chapter_content img, .chapter_content img').each((_, element) => {
        const url = imageFrom($(element), domain)
        if (url && !pages.includes(url)) pages.push(url)
    })
    return pages
}

export function parseChapterDetails($: CheerioAPI, mangaId: string, chapterId: string, domain: string): ChapterDetails {
    return App.createChapterDetails({
        id: chapterId,
        mangaId,
        pages: parseChapterPages($, domain)
    })
}

export function genreSection(tags: Tag[]): TagSection[] {
    return tags.length > 0 ? [App.createTagSection({ id: 'genres', label: 'Thể loại', tags })] : []
}
