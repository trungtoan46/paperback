// Chạy 0.8/TruyenQQ/source.js đã build trong môi trường giả lập app Paperback
// (App.create*, requestManager) với HTML mẫu ở scripts/fixtures.
// Không gọi mạng: chỉ kiểm tra bản build nạp được và các hàm parse chạy đúng.
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const cheerio = require('cheerio')

const root = path.join(__dirname, '..')
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')

const routes = {
    'https://truyenqqno.com': fixture('list.html'),
    'https://truyenqqno.com/truyen-moi-cap-nhat/trang-1.html': fixture('list.html'),
    'https://truyenqqno.com/truyen-moi-cap-nhat/trang-2.html': fixture('last-page.html'),
    'https://truyenqqno.com/truyen-yeu-thich/trang-1.html': fixture('last-page.html'),
    'https://truyenqqno.com/tim-kiem.html?q=h%E1%BA%A3i%20t%E1%BA%B7c': fixture('list.html'),
    'https://truyenqqno.com/the-loai/action-26.html': fixture('last-page.html'),
    'https://truyenqqno.com/truyen-tranh/dao-hai-tac-128': fixture('manga.html'),
    'https://truyenqqno.com/truyen-tranh/dao-hai-tac-128-chap-1100.html': fixture('chapter.html')
}
const requested = []
// Object tạo trong vm có prototype khác realm hiện tại: so sánh qua JSON.
const eq = (actual, expected) => assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected)

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

async function main() {
    const code = fs.readFileSync(path.join(root, '0.8', 'TruyenQQ', 'source.js'), 'utf8')
    // App nạp source.js như một script thường: không có require/module/exports.
    const context = vm.createContext({ App, console })
    vm.runInContext(code, context)
    const Sources = context.Sources
    assert.ok(Sources, 'source.js phải gán biến toàn cục Sources')
    assert.strictEqual(Sources.TruyenQQInfo.contentRating, 'MATURE')
    assert.strictEqual(Sources.TruyenQQInfo.intents, 1 | 4 | 16)
    assert.ok(fs.existsSync(path.join(root, '0.8', 'TruyenQQ', 'includes', Sources.TruyenQQInfo.icon)), 'thiếu icon')

    const source = new Sources.TruyenQQ(cheerio)

    // Trang chủ
    const sections = new Map()
    await source.getHomePageSections(section => sections.set(section.id, section))
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
    assert.strictEqual(requested[0].headers.referer, 'https://truyenqqno.com/')
    assert.strictEqual(requested[0].headers['user-agent'], 'TestAgent/1.0')

    // Xem thêm: trang 1 -> trang 2 (trang cuối)
    const more1 = await source.getViewMoreItems('latest', undefined)
    eq(more1.metadata, { nextUrl: 'https://truyenqqno.com/truyen-moi-cap-nhat/trang-2.html' })
    const more2 = await source.getViewMoreItems('latest', more1.metadata)
    assert.strictEqual(more2.results[0].mangaId, 'xyz-9')
    assert.strictEqual(more2.results[0].image, 'https://truyenqqno.com/a.jpg')
    assert.strictEqual(more2.metadata, undefined)

    // Tìm kiếm theo tên, thể loại, và danh sách thể loại
    const search = await source.getSearchResults({ title: 'hải tặc', includedTags: [], excludedTags: [], parameters: {} }, undefined)
    assert.strictEqual(search.results.length, 2)
    assert.ok(search.metadata.nextUrl.endsWith('trang-2.html'))
    const tags = await source.getSearchTags()
    eq(tags[0].tags.map(t => t.id), ['/the-loai/action-26.html', '/the-loai/romance-36.html'])
    const byGenre = await source.getSearchResults({ includedTags: [tags[0].tags[0]], excludedTags: [], parameters: {} }, undefined)
    assert.strictEqual(byGenre.results[0].mangaId, 'xyz-9')

    // Chi tiết truyện
    const manga = await source.getMangaDetails('dao-hai-tac-128')
    eq(manga.mangaInfo.titles, ['Đảo Hải Tặc', 'One Piece', 'Vua Hải Tặc'])
    assert.strictEqual(manga.mangaInfo.author, 'Oda Eiichiro')
    assert.strictEqual(manga.mangaInfo.status, 'Ongoing')
    assert.strictEqual(manga.mangaInfo.desc, 'Hành trình của Luffy.')
    eq(manga.mangaInfo.tags[0].tags.map(t => t.label), ['Action', 'Adventure'])
    assert.strictEqual(source.getMangaShareUrl('dao-hai-tac-128'), 'https://truyenqqno.com/truyen-tranh/dao-hai-tac-128')

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
    assert.strictEqual(bypass.url, 'https://truyenqqno.com')

    console.log('Smoke test: tất cả kiểm tra đều đạt')
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
