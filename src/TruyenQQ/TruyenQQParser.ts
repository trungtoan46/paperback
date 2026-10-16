import type { CheerioAPI } from 'cheerio'
import {
    Chapter,
    ChapterDetails,
    PartialSourceManga,
    SourceManga
} from '@paperback/types'
import {
    absoluteUrl,
    blockText,
    chapterTitle,
    cleanText,
    genreSection,
    imageFrom,
    isAdultContent,
    mapStatus,
    parseChapterNumber,
    parseTagLinks,
    parseTime,
    segmentsAfter,
    toPath
} from '../../shared/utils'

export const PAGER_SELECTOR = '.page_redirect, .pagination, .page_redirect_2'

/** '/truyen-tranh/ten-truyen-123' -> 'ten-truyen-123'. Bỏ qua link chương ('...-chap-5.html'). */
export function mangaIdFromHref(href: string | undefined): string | undefined {
    const segments = segmentsAfter(href, '/truyen-tranh/')
    if (!segments || segments.length !== 1 || /-chap-/i.test(segments[0]!)) return undefined
    return segments[0]
}

/** Danh sách truyện dạng lưới (trang chủ, mới cập nhật, tìm kiếm, thể loại). */
export function parseMangaList($: CheerioAPI, domain: string): PartialSourceManga[] {
    const results = parseGridList($, domain)
    return results.length > 0 ? results : parseLinkedCovers($, domain)
}

function parseGridList($: CheerioAPI, domain: string): PartialSourceManga[] {
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
 * Dự phòng khi web đổi giao diện danh sách: lấy mọi ảnh bìa nằm trong link tới trang truyện,
 * tên lấy từ link chữ cùng truyện, title/alt của link hoặc ảnh.
 */
function parseLinkedCovers($: CheerioAPI, domain: string): PartialSourceManga[] {
    const titles = new Map<string, string>()
    $('a[href*="/truyen-tranh/"]').each((_, a) => {
        const mangaId = mangaIdFromHref($(a).attr('href'))
        const text = cleanText($(a).text())
        if (mangaId && text && !titles.has(mangaId)) titles.set(mangaId, text)
    })

    const results: PartialSourceManga[] = []
    const seen = new Set<string>()
    $('a[href*="/truyen-tranh/"]').each((_, a) => {
        const $a = $(a)
        const mangaId = mangaIdFromHref($a.attr('href'))
        const $img = $a.find('img').first()
        if (!mangaId || $img.length === 0 || seen.has(mangaId)) return
        seen.add(mangaId)
        results.push(App.createPartialSourceManga({
            mangaId,
            title: titles.get(mangaId) || $a.attr('title')?.trim() || $img.attr('alt')?.trim() || mangaId,
            image: imageFrom($img, domain)
        }))
    })
    return results
}

/** Dự phòng khi không đọc được thanh phân trang: tìm link tới '/trang-<n+1>'. */
export function parseNextPageByNumber($: CheerioAPI, pageUrl: string, domain: string): string | undefined {
    const current = parseInt(toPath(pageUrl).match(/\/trang-(\d+)(?:\.html)?$/)?.[1] ?? '1')
    const pattern = new RegExp(`/trang-${current + 1}(?:\\.html)?(?:[?#]|$)`)
    const next = $('a[href*="/trang-"]').filter((_, a) => pattern.test($(a).attr('href') ?? '')).first()
    return next.length > 0 ? absoluteUrl(next.attr('href'), domain) : undefined
}

export function parseMangaDetails($: CheerioAPI, mangaId: string, domain: string): SourceManga {
    // Trang bảo trì / chống bot cũng trả 200: báo lỗi thay vì ghi đè tên truyện bằng mã truyện.
    const title = cleanText($('h1[itemprop=name], .book_other h1, .book_info h1').first().text())
    if (!title || $('.list-info, .book_info, .book_other').length === 0) {
        throw new Error('TruyenQQ: không đọc được trang truyện (web có thể đang bảo trì hoặc đã đổi giao diện)')
    }
    const otherNames = cleanText($('li.othername h2, .other-name').first().text())
        .split(/[;,]/)
        .map(name => name.trim())
        .filter(name => name.length > 0 && name !== title)

    const author = cleanText($('li.author p.col-xs-9, li.author .org, .list-info .org, .list_info .org').first().text())
    const status = cleanText($('li.status p:last-child, li.status .col-xs-9').first().text())
    const desc = blockText($, $('.story-detail-info, .detail-content, .story_introduction').first())
    const tags = parseTagLinks($, 'ul.list01 li a, .list01 a', '/the-loai/')

    return App.createSourceManga({
        id: mangaId,
        mangaInfo: App.createMangaInfo({
            titles: [title, ...otherNames],
            image: imageFrom($('.book_avatar img, img[itemprop=image]').first(), domain),
            author: author || 'Đang cập nhật',
            artist: author || 'Đang cập nhật',
            desc: desc || 'Không có mô tả',
            status: mapStatus(status),
            hentai: isAdultContent(tags),
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
        chapters.push(App.createChapter({
            id,
            chapNum: parseChapterNumber(href, name) ?? $items.length - index,
            name: chapterTitle(name),
            langCode: 'vi',
            time: parseTime(cleanText($item.find('.time-chap').first().text())),
            sortingIndex: -index
        }))
    })
    return chapters
}

export function parseChapterDetails($: CheerioAPI, mangaId: string, chapterId: string, domain: string): ChapterDetails {
    const pages: string[] = []
    // Chỉ lấy ảnh trong từng trang (.page-chapter); cả khung chương có thể chứa ảnh quảng cáo.
    const $images = $('.page-chapter img').length > 0 ? $('.page-chapter img') : $('#chapter_content img, .chapter_content img')
    $images.each((_, element) => {
        const $img = $(element)
        // Ảnh thật nằm ở src; data-* chỉ dùng khi src là ảnh chờ. Bỏ ảnh quảng cáo stress.gif.
        const src = $img.attr('src')?.trim()
        const url = src && !src.startsWith('data:') ? absoluteUrl(src, domain) : imageFrom($img, domain)
        if (url && !/stress\.gif/i.test(url) && !pages.includes(url)) pages.push(url)
    })
    return App.createChapterDetails({ id: chapterId, mangaId, pages })
}
