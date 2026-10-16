// Chạy các source.js đã build trong 0.8/ trong môi trường giả lập app Paperback
// (App.create*, requestManager) với HTML mẫu ở scripts/fixtures.
// Không gọi mạng: chỉ kiểm tra bản build nạp được và các hàm parse chạy đúng.
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const cheerio = require('cheerio')

const root = path.join(__dirname, '..')
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')
// Object tạo trong vm có prototype khác realm hiện tại: so sánh qua JSON.
const eq = (actual, expected) => assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected)

/** Nạp 0.8/<id>/source.js như app (script thường, không có require/module/exports). */
function loadSource(id, routes) {
    const requested = []
    const passThrough = defaults => info => ({ ...defaults, ...info })
    const App = {
        createRequest: passThrough({ headers: {}, cookies: [] }),
        createRequestManager: info => ({
            ...info,
            getDefaultUserAgent: async () => 'TestAgent/1.0',
            schedule: async request => {
                const intercepted = await info.interceptor.interceptRequest(request)
                requested.push(intercepted)
                const data = routes[intercepted.url]
                const response = { data: data ?? 'not found', status: data ? 200 : 404, headers: {}, request: intercepted }
                return info.interceptor.interceptResponse(response)
            }
        }),
        createSourceManga: passThrough({}),
        createMangaInfo: passThrough({}),
        createChapter: passThrough({}),
        createChapterDetails: passThrough({}),
        createPartialSourceManga: passThrough({}),
        createPagedResults: passThrough({ results: [] }),
        createHomeSection: passThrough({ items: [] }),
        createTagSection: passThrough({}),
        createTag: passThrough({})
    }

    const code = fs.readFileSync(path.join(root, '0.8', id, 'source.js'), 'utf8')
    const context = vm.createContext({ App, console })
    vm.runInContext(code, context)
    const Sources = context.Sources
    assert.ok(Sources, `${id}: source.js phải gán biến toàn cục Sources`)
    const info = Sources[`${id}Info`]
    assert.strictEqual(info.contentRating, 'MATURE')
    assert.strictEqual(info.intents, 1 | 4 | 16)
    assert.ok(fs.existsSync(path.join(root, '0.8', id, 'includes', info.icon)), `${id}: thiếu icon`)
    return { source: new Sources[id](cheerio), requested }
}

async function homeSections(source) {
    const sections = new Map()
    await source.getHomePageSections(section => sections.set(section.id, section))
    return sections
}

const query = (fields = {}) => ({ includedTags: [], excludedTags: [], parameters: {}, ...fields })

async function testTruyenQQ() {
    const D = 'https://truyenqqno.com'
    const f = name => fixture(`truyenqq/${name}`)
    const { source, requested } = loadSource('TruyenQQ', {
        [D]: f('list.html'),
        [`${D}/truyen-moi-cap-nhat/trang-1.html`]: f('list.html'),
        [`${D}/truyen-moi-cap-nhat/trang-2.html`]: f('last-page.html'),
        [`${D}/truyen-yeu-thich/trang-1.html`]: f('last-page.html'),
        [`${D}/tim-kiem.html?q=h%E1%BA%A3i%20t%E1%BA%B7c`]: f('list.html'),
        [`${D}/the-loai/action-26.html`]: f('last-page.html'),
        [`${D}/truyen-tranh/dao-hai-tac-128`]: f('manga.html'),
        [`${D}/truyen-tranh/dao-hai-tac-128-chap-1100.html`]: f('chapter.html')
    })

    // Trang chủ
    const sections = await homeSections(source)
    const latest = sections.get('latest')
    assert.strictEqual(latest.items.length, 2)
    eq(latest.items[0], {
        mangaId: 'dao-hai-tac-128',
        title: 'Đảo Hải Tặc',
        image: 'https://i.cdn.test/cover/dao-hai-tac.jpg',
        subtitle: 'Chương 1100'
    })
    assert.strictEqual(latest.items[1].title, 'Thám Tử Lừng Danh Conan')
    assert.strictEqual(latest.containsMoreItems, true)
    assert.strictEqual(sections.get('favorite').containsMoreItems, false)
    assert.strictEqual(requested[0].headers.referer, `${D}/`)
    assert.strictEqual(requested[0].headers['user-agent'], 'TestAgent/1.0')

    // Xem thêm: trang 1 -> trang 2 (trang cuối)
    const more1 = await source.getViewMoreItems('latest', undefined)
    eq(more1.metadata, { nextUrl: `${D}/truyen-moi-cap-nhat/trang-2.html` })
    const more2 = await source.getViewMoreItems('latest', more1.metadata)
    assert.strictEqual(more2.results[0].mangaId, 'xyz-9')
    assert.strictEqual(more2.results[0].image, `${D}/a.jpg`)
    assert.strictEqual(more2.metadata, undefined)

    // Tìm kiếm theo tên, thể loại, và danh sách thể loại
    const search = await source.getSearchResults(query({ title: 'hải tặc' }), undefined)
    assert.strictEqual(search.results.length, 2)
    assert.ok(search.metadata.nextUrl.endsWith('trang-2.html'))
    const tags = await source.getSearchTags()
    eq(tags[0].tags.map(t => t.id), ['/the-loai/action-26.html', '/the-loai/romance-36.html'])
    const byGenre = await source.getSearchResults(query({ includedTags: [tags[0].tags[0]] }), undefined)
    assert.strictEqual(byGenre.results[0].mangaId, 'xyz-9')

    // Chi tiết truyện
    const manga = await source.getMangaDetails('dao-hai-tac-128')
    eq(manga.mangaInfo.titles, ['Đảo Hải Tặc', 'One Piece', 'Vua Hải Tặc'])
    assert.strictEqual(manga.mangaInfo.author, 'Oda Eiichiro')
    assert.strictEqual(manga.mangaInfo.status, 'Ongoing')
    assert.strictEqual(manga.mangaInfo.desc, 'Hành trình của Luffy.')
    eq(manga.mangaInfo.tags[0].tags.map(t => t.label), ['Action', 'Adventure'])
    assert.strictEqual(source.getMangaShareUrl('dao-hai-tac-128'), `${D}/truyen-tranh/dao-hai-tac-128`)

    // Danh sách chương
    const chapters = await source.getChapters('dao-hai-tac-128')
    eq(chapters.map(c => c.chapNum), [1100, 1099.5, 1])
    eq(chapters.map(c => c.sortingIndex), [0, -1, -2])
    assert.strictEqual(chapters[0].id, '/truyen-tranh/dao-hai-tac-128-chap-1100.html')
    assert.strictEqual(chapters[0].name, 'Chương 1100')
    assert.ok(Date.now() - chapters[0].time.getTime() >= 2 * 3600 * 1000 - 1000)
    assert.strictEqual(chapters[1].time.getFullYear(), 2026)
    assert.strictEqual(chapters[1].time.getMonth(), 9)

    // Ảnh chương; id kiểu cũ (URL đầy đủ, domain cũ) vẫn đọc được
    const expectedPages = ['https://i.cdn.test/p/1.jpg', 'https://i.cdn.test/p/2.jpg', 'https://cdn2.test/p/3.jpg']
    const details = await source.getChapterDetails('dao-hai-tac-128', chapters[0].id)
    eq(details.pages, expectedPages)
    const legacy = await source.getChapterDetails('dao-hai-tac-128', 'https://truyenqqvn.com/truyen-tranh/dao-hai-tac-128-chap-1100.html')
    eq(legacy.pages, expectedPages)

    // Lỗi HTTP phải báo rõ ràng
    await assert.rejects(source.getMangaDetails('khong-ton-tai-1'), /HTTP 404/)

    const bypass = await source.getCloudflareBypassRequestAsync()
    assert.strictEqual(bypass.url, D)
}

async function testNetTruyen() {
    const D = 'https://nettruyen.gg'
    const f = name => fixture(`nettruyen/${name}`)
    const { source, requested } = loadSource('NetTruyen', {
        [`${D}/`]: f('home.html'),
        [`${D}/?page=2`]: f('last-page.html'),
        [`${D}/hot`]: f('hot.html'),
        [`${D}/hot?page=2`]: f('last-page.html'),
        [`${D}/tim-truyen?status=2`]: f('last-page.html'),
        [`${D}/tim-truyen`]: f('genres.html'),
        [`${D}/tim-truyen?keyword=one%20piece`]: f('home.html'),
        [`${D}/tim-truyen/action-95`]: f('last-page.html'),
        [`${D}/truyen-tranh/one-piece`]: f('manga.html'),
        [`${D}/truyen-tranh/van-co-chi-ton`]: f('manga-ajax.html'),
        [`${D}/Comic/Services/ComicService.asmx/ChapterList?slug=van-co-chi-ton`]: f('chapters.json'),
        [`${D}/truyen-tranh/one-piece/chapter-1100/123456`]: f('chapter.html')
    })

    // Trang chủ: bỏ slider đề cử, ảnh lazy-load, link tương đối
    const sections = await homeSections(source)
    const latest = sections.get('latest')
    eq(latest.items, [
        { mangaId: 'one-piece', title: 'One Piece', image: 'https://img.test/one-piece.jpg', subtitle: 'Chapter 1100' },
        { mangaId: 'van-co-chi-ton', title: 'Vạn Cổ Chí Tôn', image: 'https://img.test/vcct.jpg' }
    ])
    assert.strictEqual(latest.containsMoreItems, true)
    assert.strictEqual(sections.get('hot').items[0].image, `${D}/hot-1.jpg`)
    assert.strictEqual(sections.get('hot').containsMoreItems, true)
    assert.strictEqual(sections.get('completed').containsMoreItems, false)
    assert.strictEqual(requested[0].headers.referer, `${D}/`)

    // Phân trang: link tuyệt đối và link chỉ có query ('?page=2')
    const latest1 = await source.getViewMoreItems('latest', undefined)
    eq(latest1.metadata, { nextUrl: `${D}/?page=2` })
    const latest2 = await source.getViewMoreItems('latest', latest1.metadata)
    assert.strictEqual(latest2.results[0].mangaId, 'cuoi-cung')
    assert.strictEqual(latest2.metadata, undefined)
    const hot1 = await source.getViewMoreItems('hot', undefined)
    eq(hot1.metadata, { nextUrl: `${D}/hot?page=2` })

    // Tìm kiếm và thể loại
    const search = await source.getSearchResults(query({ title: 'one piece' }), undefined)
    eq(search.results.map(r => r.mangaId), ['one-piece', 'van-co-chi-ton'])
    const tags = await source.getSearchTags()
    eq(tags[0].tags, [
        { id: '/tim-truyen/action-95', label: 'Action' },
        { id: '/tim-truyen/comedy-99', label: 'Comedy' }
    ])
    const byGenre = await source.getSearchResults(query({ includedTags: [tags[0].tags[0]] }), undefined)
    assert.strictEqual(byGenre.results[0].mangaId, 'cuoi-cung')

    // Chi tiết truyện
    const manga = await source.getMangaDetails('one-piece')
    eq(manga.mangaInfo.titles, ['One Piece', 'Đảo Hải Tặc', 'Vua Hải Tặc'])
    assert.strictEqual(manga.mangaInfo.image, 'https://img.test/one-piece-big.jpg')
    assert.strictEqual(manga.mangaInfo.author, 'Oda Eiichiro')
    assert.strictEqual(manga.mangaInfo.status, 'Completed')
    assert.strictEqual(manga.mangaInfo.desc, 'Hành trình của Luffy.')
    eq(manga.mangaInfo.tags[0].tags.map(t => t.label), ['Action', 'Comedy'])
    const unknownAuthor = await source.getMangaDetails('van-co-chi-ton')
    assert.strictEqual(unknownAuthor.mangaInfo.status, 'Ongoing')
    assert.strictEqual(unknownAuthor.mangaInfo.author, 'Đang cập nhật')

    // Chương trong HTML
    const chapters = await source.getChapters('one-piece')
    eq(chapters.map(c => c.chapNum), [1100, 1099.5, 1])
    eq(chapters.map(c => c.sortingIndex), [0, -1, -2])
    assert.strictEqual(chapters[0].id, '/truyen-tranh/one-piece/chapter-1100/123456')
    assert.strictEqual(chapters[1].time.getFullYear(), 2026)
    assert.strictEqual(chapters[2].time.getFullYear(), 2018)

    // Chương qua API (HTML không có danh sách); API trả cũ nhất trước -> sắp lại mới nhất trước
    const ajax = await source.getChapters('van-co-chi-ton')
    eq(ajax.map(c => [c.chapNum, c.id, c.sortingIndex]), [
        [2.5, '/truyen-tranh/van-co-chi-ton/chapter-2-5', 0],
        [2, '/truyen-tranh/van-co-chi-ton/chapter-2', -1],
        [1, '/truyen-tranh/van-co-chi-ton/chapter-1', -2]
    ])
    assert.strictEqual(ajax[0].time.getFullYear(), 2026)
    assert.strictEqual(ajax[2].time.getFullYear(), 2024)

    // Ảnh chương
    const details = await source.getChapterDetails('one-piece', chapters[0].id)
    eq(details.pages, ['https://img.test/p/1.jpg', 'https://img.test/p/2.jpg', 'https://img.test/p/3.jpg'])

    await assert.rejects(source.getMangaDetails('khong-co'), /HTTP 404/)
    assert.strictEqual((await source.getCloudflareBypassRequestAsync()).url, D)
}

async function main() {
    await testTruyenQQ()
    console.log('TruyenQQ: đạt')
    await testNetTruyen()
    console.log('NetTruyen: đạt')
    console.log('Smoke test: tất cả kiểm tra đều đạt')
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
