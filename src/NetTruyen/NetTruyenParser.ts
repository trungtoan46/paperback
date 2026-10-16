import type { CheerioAPI } from 'cheerio'
import {
    Chapter,
    ChapterDetails,
    PartialSourceManga,
    SourceManga
} from '@paperback/types'
import {
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

export const PAGER_SELECTOR = '.pagination, .pagination-outter'

/** '/truyen-tranh/one-piece' -> 'one-piece'. Link chương ('/truyen-tranh/one-piece/chapter-1/123') bị bỏ qua. */
export function mangaIdFromHref(href: string | undefined): string | undefined {
    const segments = segmentsAfter(href, '/truyen-tranh/')
    return segments && segments.length === 1 ? segments[0] : undefined
}

/** Lưới truyện (.items .item) ở trang chủ, /hot, /tim-truyen. Bỏ slider "Truyện đề cử". */
export function parseMangaList($: CheerioAPI, domain: string): PartialSourceManga[] {
    const results: PartialSourceManga[] = []
    const seen = new Set<string>()
    $('.items .item').each((_, element) => {
        const $item = $(element)
        if ($item.closest('.top-comics, .items-slide, .owl-carousel').length > 0) return

        const $link = $item.find('h3 a, figcaption a, .image a, a').filter((_, a) => {
            return mangaIdFromHref($(a).attr('href')) !== undefined
        }).first()
        const mangaId = mangaIdFromHref($link.attr('href'))
        if (!mangaId || seen.has(mangaId)) return
        seen.add(mangaId)

        const $img = $item.find('.image img, img').first()
        const title = cleanText($item.find('h3 a, h3').first().text())
            || $link.attr('title')?.trim()
            || $img.attr('alt')?.trim()
            || mangaId
        const subtitle = cleanText($item.find('.comic-item .chapter a, .chapter a').first().text())

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
 * Đoạn giới thiệu tự sinh mà web chèn vào mô tả: 'Chào mừng các đạo hữu thân mến của NetTruyen, hãy cùng
 * thưởng thức bộ truyện tranh X đầy cuốn hút trên website của chúng tôi. Bộ truyện này thuộc về các thể loại A, B...'.
 * Chỉ bỏ khi còn lại nội dung khác.
 */
export function stripBoilerplate(desc: string): string {
    const text = desc
        .replace(/Chào mừng các đạo hữu[\s\S]*?trên website của chúng tôi[.!]?\s*/gi, '')
        .replace(/Bộ truyện này thuộc về các thể loại[^\n]*?(?:[.!](?=\s|$)|$)\s*/gi, '')
        .trim()
    return text.length > 0 ? text : desc
}

export function parseMangaDetails($: CheerioAPI, mangaId: string, domain: string): SourceManga {
    // Trang bảo trì / chống bot cũng trả 200: báo lỗi thay vì ghi đè tên truyện bằng mã truyện.
    const $detail = $('#item-detail').length > 0 ? $('#item-detail') : $('body')
    const title = cleanText($detail.find('h1.title-detail').first().text())
        || ($('#item-detail').length > 0 ? cleanText($detail.find('h1').first().text()) : '')
    if (!title) throw new Error('NetTruyen: không đọc được trang truyện (web có thể đang bảo trì hoặc đã đổi giao diện)')
    const otherNames = cleanText($detail.find('li.othername h2, .other-name').first().text())
        .split(/[;,]/)
        .map(name => name.trim())
        .filter(name => name.length > 0 && name !== title)

    const rawAuthor = cleanText($detail.find('li.author p.col-xs-8, li.author a').first().text())
    const author = rawAuthor.toLowerCase() === 'đang cập nhật' ? '' : rawAuthor
    const status = cleanText($detail.find('li.status p.col-xs-8, li.status p:not(.name)').first().text())
    const $desc = $detail.find('.detail-content .shortened').first().clone()
    const $content = $desc.length > 0 ? $desc : $detail.find('.detail-content').first().clone()
    $content.find('h2, h3, .list-title, a.morelink, script, style').remove()
    const desc = blockText($, $content)
    const tags = parseTagLinks($, '#item-detail li.kind a, li.kind a', '/tim-truyen/')

    return App.createSourceManga({
        id: mangaId,
        mangaInfo: App.createMangaInfo({
            titles: [title, ...otherNames],
            image: imageFrom($detail.find('.col-image img, .detail-info img').first(), domain),
            author: author || 'Đang cập nhật',
            artist: author || 'Đang cập nhật',
            desc: stripBoilerplate(desc) || 'Không có mô tả',
            status: mapStatus(status),
            hentai: isAdultContent(tags),
            tags: genreSection(tags)
        })
    })
}

/**
 * Mã chương dạng API: '/truyen-tranh/<truyện>/chapter-1100'. Link trong HTML có thể thêm số định danh
 * ('/chapter-1100/123456'); bỏ đi để mã chương không đổi khi API lỗi và phải đọc HTML.
 */
export function chapterPath(href: string): string {
    return toPath(href).replace(/(\/(?:chap|chapter|chuong)-[^/]+)\/\d+\/?$/i, '$1')
}

/** Danh sách chương có sẵn trong HTML (#nt_listchapter), mới nhất trước. */
export function parseChapters($: CheerioAPI): Chapter[] {
    const $rows = $('#nt_listchapter li.row, .list-chapter li.row').filter((_, row) => !$(row).hasClass('heading'))
    const chapters: Chapter[] = []
    const seen = new Set<string>()
    $rows.each((index, row) => {
        const $row = $(row)
        const $link = $row.find('.chapter a, a').first()
        const href = $link.attr('href')
        if (!href) return
        const id = chapterPath(href)
        if (seen.has(id)) return
        seen.add(id)

        const name = cleanText($link.text())
        chapters.push(App.createChapter({
            id,
            chapNum: parseChapterNumber(href, name) ?? $rows.length - index,
            name: chapterTitle(name),
            langCode: 'vi',
            time: parseTime(cleanText($row.find('.col-xs-4, .no-wrap').first().text())),
            sortingIndex: -index
        }))
    })
    return chapters
}

interface ApiChapter {
    chapter_name?: string
    chapter_slug?: string
    chapter_num?: number | string
    updated_at?: string
    name?: string
    slug?: string
    url?: string
}

/**
 * Một số bản NetTruyen tải danh sách chương bằng AJAX:
 * /Comic/Services/ComicService.asmx/ChapterList?slug=<mangaId> -> { data: [...] }.
 * Dùng khi HTML không có sẵn danh sách chương.
 */
export function parseChapterApi(json: string, mangaId: string): Chapter[] {
    const parsed = JSON.parse(json)
    const list: ApiChapter[] = Array.isArray(parsed) ? parsed : (parsed?.data ?? parsed?.chapters ?? [])
    if (!Array.isArray(list)) return []

    const items: { path: string, name: string, chapNum: number, time: Date }[] = []
    list.forEach((item, index) => {
        const slug = item.chapter_slug ?? item.slug
        const path = item.url ? chapterPath(item.url) : slug ? chapterPath(`/truyen-tranh/${mangaId}/${slug}`) : undefined
        if (!path) return
        const name = cleanText(item.chapter_name ?? item.name ?? '')
        const num = item.chapter_num !== undefined ? parseFloat(String(item.chapter_num)) : NaN
        items.push({
            path,
            name,
            chapNum: !isNaN(num) && num >= 0 ? num : parseChapterNumber(path, name) ?? list.length - index,
            // API trả 'yyyy-MM-dd HH:mm:ss'.
            time: item.updated_at ? parseTime(item.updated_at) : new Date()
        })
    })
    // Không chắc API trả mới nhất trước hay cũ nhất trước: sắp theo số chương, mới nhất trước.
    items.sort((a, b) => b.chapNum - a.chapNum)
    return items.map((item, index) => App.createChapter({
        id: item.path,
        chapNum: item.chapNum,
        name: chapterTitle(item.name),
        langCode: 'vi',
        time: item.time,
        sortingIndex: -index
    }))
}

export function parseChapterDetails($: CheerioAPI, mangaId: string, chapterId: string, domain: string): ChapterDetails {
    const pages: string[] = []
    $('#chapter-content img, .reading-detail .page-chapter img, .chapter-content img, .page-chapter img').each((_, element) => {
        // Thứ tự thuộc tính theo extension NetTruyenViet của Mihon.
        const url = imageFrom($(element), domain, ['data-src', 'data-original', 'data-cdn', 'src'])
        // Bỏ logo của web chèn giữa các trang.
        if (url && !/\/assets\/images\/nettruyen[^/]*\.(webp|png|jpe?g)$/i.test(url) && !pages.includes(url)) pages.push(url)
    })
    return App.createChapterDetails({ id: chapterId, mangaId, pages })
}
