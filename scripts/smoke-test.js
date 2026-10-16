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
function loadSource(id, routes, { quiet = false } = {}) {
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
                // Route theo 'METHOD url' hoặc url; giá trị là chuỗi (200), { status, data } hoặc hàm (request) => ...
                let route = routes[`${intercepted.method} ${intercepted.url}`] ?? routes[intercepted.url] ?? { status: 404, data: 'not found' }
                if (typeof route === 'function') route = route(intercepted)
                const { status, data } = typeof route === 'string' ? { status: 200, data: route } : route
                const response = { data, status, headers: {}, request: intercepted }
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
        createTag: passThrough({}),
        createSourceStateManager: () => {
            const store = new Map()
            return { store: async (key, value) => { store.set(key, value) }, retrieve: async key => store.get(key) }
        },
        createDUISection: passThrough({}),
        createDUIForm: passThrough({}),
        createDUIBinding: passThrough({}),
        createDUIInputField: passThrough({ type: 'input' }),
        createDUINavigationButton: passThrough({ type: 'navigation' }),
        createDUIButton: passThrough({ type: 'button' }),
        createDUILabel: passThrough({ type: 'label' })
    }

    const code = fs.readFileSync(path.join(root, '0.8', id, 'source.js'), 'utf8')
    const context = vm.createContext({ App, console: quiet ? { log() { } } : console })
    vm.runInContext(code, context)
    const Sources = context.Sources
    assert.ok(Sources, `${id}: source.js phải gán biến toàn cục Sources`)
    const info = Sources[`${id}Info`]
    assert.strictEqual(info.contentRating, 'MATURE')
    assert.strictEqual(info.intents, 1 | 4 | 16 | 32)
    assert.ok(fs.existsSync(path.join(root, '0.8', id, 'includes', info.icon)), `${id}: thiếu icon`)
    return { source: new Sources[id](cheerio), requested }
}

async function homeSections(source) {
    const sections = new Map()
    await source.getHomePageSections(section => sections.set(section.id, section))
    return sections
}

/** Mở cài đặt nguồn như app: trả về các dòng và ô nhập tên miền. */
async function openSettings(source) {
    const menu = await source.getSourceMenu()
    const rows = await menu.rows()
    const label = rows.find(row => row.type === 'label')
    const form = rows.find(row => row.type === 'navigation').form
    const section = (await form.sections())[0]
    const input = (await section.rows()).find(row => row.type === 'input')
    const reset = rows.find(row => row.type === 'button')
    return { label, input, reset }
}

const query = (fields = {}) => ({ includedTags: [], excludedTags: [], parameters: {}, ...fields })

async function testTruyenQQ() {
    const D = 'https://truyenqqko.com'
    const f = name => fixture(`truyenqq/${name}`)
    const { source, requested } = loadSource('TruyenQQ', {
        [D]: f('list.html'),
        [`${D}/truyen-moi-cap-nhat`]: f('list.html'),
        [`${D}/truyen-moi-cap-nhat/trang-2`]: f('last-page.html'),
        // '/truyen-yeu-thich' và '/truyen-yeu-thich/trang-1' không có (404) -> dùng URL dự phòng có '.html'
        [`${D}/truyen-yeu-thich/trang-1.html`]: f('last-page.html'),
        [`${D}/tim-kiem?q=h%E1%BA%A3i%20t%E1%BA%B7c`]: f('list.html'),
        [`${D}/the-loai/action-26`]: f('generic-list.html'),
        [`${D}/truyen-tranh/dao-hai-tac-128`]: f('manga.html'),
        [`${D}/truyen-tranh/dao-hai-tac-128-chap-1100`]: f('chapter.html'),
        [`${D}/truyen-tranh/dao-hai-tac-128-chap-1100.html`]: f('chapter.html'),
        // '/tim-kiem-nang-cao?...' không có (404) -> dùng URL dự phòng có '.html'
        [`${D}/tim-kiem-nang-cao.html?category=26&notcategory=36&country=0&status=2&minchapter=0&sort=4`]: f('last-page.html'),
        ['https://qq.example/truyen-tranh/dao-hai-tac-128']: f('manga.html')
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
    const favorite = sections.get('favorite')
    assert.strictEqual(favorite.items[0].mangaId, 'xyz-9')
    assert.strictEqual(favorite.containsMoreItems, false)
    assert.strictEqual(requested[0].headers.referer, `${D}/`)
    assert.strictEqual(requested[0].headers['user-agent'], 'TestAgent/1.0')

    // Xem thêm: trang 1 -> trang 2 (trang cuối)
    const more1 = await source.getViewMoreItems('latest', undefined)
    eq(more1.metadata, { nextUrl: `${D}/truyen-moi-cap-nhat/trang-2` })
    const more2 = await source.getViewMoreItems('latest', more1.metadata)
    assert.strictEqual(more2.results[0].mangaId, 'xyz-9')
    assert.strictEqual(more2.results[0].image, `${D}/a.jpg`)
    assert.strictEqual(more2.metadata, undefined)

    // Tìm kiếm theo tên; thể loại (nhãn bỏ mũi tên '>'); danh sách giao diện lạ dùng bộ đọc dự phòng
    const search = await source.getSearchResults(query({ title: 'hải tặc' }), undefined)
    assert.strictEqual(search.results.length, 2)
    eq(search.metadata, { nextUrl: `${D}/truyen-moi-cap-nhat/trang-2` })
    const tags = await source.getSearchTags()
    eq(tags[0].tags, [
        { id: '/the-loai/action-26', label: 'Action' },
        { id: '/the-loai/romance-36', label: 'Romance' }
    ])
    const byGenre = await source.getSearchResults(query({ includedTags: [tags[0].tags[0]] }), undefined)
    eq(byGenre.results, [
        { mangaId: 'abc-1', title: 'ABC Truyện', image: `${D}/covers/abc.jpg` },
        { mangaId: 'xyz-2', title: 'XYZ title', image: 'https://img.test/xyz.jpg' }
    ])
    eq(byGenre.metadata, { nextUrl: `${D}/the-loai/action-26/trang-2` })

    // Bộ lọc tình trạng/sắp xếp theo mã của trang tìm kiếm nâng cao; tìm nâng cao có loại trừ thể loại
    eq(tags.map(t => t.id), ['genres', 'status', 'sort'])
    eq(tags[1].tags, [{ id: 'status:0', label: 'Đang tiến hành' }, { id: 'status:2', label: 'Hoàn thành' }])
    eq(tags[2].tags.map(t => t.id), ['sort:0', 'sort:1', 'sort:2', 'sort:3', 'sort:4', 'sort:5'])
    // Thể loại nhớ trong phiên: mở Discover lần nữa không tải lại trang chủ
    const homeRequests = () => requested.filter(r => r.url === D).length
    const before = homeRequests()
    await source.getSearchTags()
    assert.strictEqual(homeRequests(), before)
    assert.strictEqual(await source.supportsTagExclusion(), true)
    const advanced = await source.getSearchResults(query({
        includedTags: [tags[0].tags[0], tags[1].tags[1], tags[2].tags.find(t => t.id === 'sort:4')],
        excludedTags: [tags[0].tags[1]]
    }), undefined)
    assert.strictEqual(advanced.results[0].mangaId, 'xyz-9')

    // Chi tiết truyện
    const manga = await source.getMangaDetails('dao-hai-tac-128')
    eq(manga.mangaInfo.titles, ['Đảo Hải Tặc', 'One Piece', 'Vua Hải Tặc'])
    assert.strictEqual(manga.mangaInfo.author, 'Oda Eiichiro')
    assert.strictEqual(manga.mangaInfo.status, 'Ongoing')
    assert.strictEqual(manga.mangaInfo.desc, 'Hành trình của Luffy.')
    eq(manga.mangaInfo.tags[0].tags.map(t => t.label), ['Action', 'Adventure'])
    assert.strictEqual(manga.mangaInfo.hentai, false)
    assert.strictEqual(source.getMangaShareUrl('dao-hai-tac-128'), `${D}/truyen-tranh/dao-hai-tac-128`)

    // Danh sách chương
    const chapters = await source.getChapters('dao-hai-tac-128')
    eq(chapters.map(c => c.chapNum), [1100, 1099.5, 1])
    eq(chapters.map(c => c.sortingIndex), [0, -1, -2])
    assert.strictEqual(chapters[0].id, '/truyen-tranh/dao-hai-tac-128-chap-1100')
    // Tên chỉ là 'Chương N' thì bỏ (app đã hiện 'Ch. N'), tên có tiêu đề thì giữ
    eq(chapters.map(c => c.name ?? null), [null, null, 'Chương 1: Romance Dawn'])
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

    // Cài đặt: đổi tên miền, nhập sai thì giữ nguyên, nút mặc định khôi phục
    const settings = await openSettings(source)
    assert.strictEqual(settings.label.value, D)
    assert.strictEqual(await settings.input.value.get(), D)
    await settings.input.value.set('qq.example/duong-dan')
    assert.strictEqual(source.getMangaShareUrl('dao-hai-tac-128'), 'https://qq.example/truyen-tranh/dao-hai-tac-128')
    const moved = await source.getMangaDetails('dao-hai-tac-128')
    assert.strictEqual(moved.mangaInfo.titles[0], 'Đảo Hải Tặc')
    assert.strictEqual(requested[requested.length - 1].headers.referer, 'https://qq.example/')
    await settings.input.value.set('khong phai ten mien')
    assert.strictEqual(await settings.input.value.get(), 'https://qq.example')
    await settings.reset.onTap()
    assert.strictEqual(source.getMangaShareUrl('x-1'), `${D}/truyen-tranh/x-1`)
    assert.strictEqual((await openSettings(source)).label.value, D)
}

async function testNetTruyen() {
    const D = 'https://nettruyen.gg'
    const f = name => fixture(`nettruyen/${name}`)
    const { source, requested } = loadSource('NetTruyen', {
        [`${D}/tim-truyen`]: f('tim-truyen.html'),
        [`${D}/tim-truyen?page=2`]: f('last-page.html'),
        // '/tim-truyen?sort=11' không có (404) -> dùng URL dự phòng
        [`${D}/tim-truyen?status=-1&sort=11`]: f('hot.html'),
        [`${D}/tim-truyen?status=2`]: f('last-page.html'),
        [`${D}/tim-truyen?keyword=one%20piece`]: f('home.html'),
        [`${D}/tim-truyen/action-95`]: f('last-page.html'),
        [`${D}/truyen-tranh/one-piece`]: f('manga.html'),
        [`${D}/truyen-tranh/van-co-chi-ton`]: f('manga-ajax.html'),
        // Trang chỉ có vài chương mới nhất; API trả đủ từ chương 1
        [`${D}/truyen-tranh/dai-phung`]: f('manga.html'),
        [`${D}/Comic/Services/ComicService.asmx/ChapterList?slug=dai-phung`]: f('chapters-full.json'),
        [`${D}/Comic/Services/ComicService.asmx/ChapterList?slug=cf-test`]: { status: 503, data: 'Just a moment...' },
        [`${D}/Comic/Services/ComicService.asmx/ChapterList?slug=van-co-chi-ton`]: f('chapters.json'),
        [`${D}/truyen-tranh/one-piece/chapter-1100/123456`]: f('chapter.html'),
        [`${D}/tim-truyen/action-95?status=2&sort=11`]: f('last-page.html'),
        [`${D}/tim-truyen?sort=13`]: f('hot.html'),
        ['https://nt.example/truyen-tranh/one-piece']: f('manga.html')
    }, { quiet: true })

    // Trang chủ: bỏ slider đề cử, ảnh lazy-load, link tương đối
    const sections = await homeSections(source)
    const latest = sections.get('latest')
    eq(latest.items, [
        { mangaId: 'one-piece', title: 'One Piece', image: 'https://img.test/one-piece.jpg', subtitle: 'Chapter 1100' },
        { mangaId: 'van-co-chi-ton', title: 'Vạn Cổ Chí Tôn', image: 'https://img.test/vcct.jpg' }
    ])
    assert.strictEqual(latest.containsMoreItems, true)
    eq([...sections.values()].map(section => section.title), ['Mới cập nhật', 'Top tháng', 'Hoàn thành'])
    assert.strictEqual(sections.get('hot').items[0].image, `${D}/hot-1.jpg`)
    assert.strictEqual(sections.get('hot').containsMoreItems, true)
    assert.strictEqual(sections.get('completed').containsMoreItems, false)
    assert.strictEqual(requested[0].headers.referer, `${D}/`)

    // Phân trang: link tuyệt đối và link chỉ có query ('?page=2')
    const latest1 = await source.getViewMoreItems('latest', undefined)
    eq(latest1.metadata, { nextUrl: `${D}/tim-truyen?page=2` })
    const latest2 = await source.getViewMoreItems('latest', latest1.metadata)
    assert.strictEqual(latest2.results[0].mangaId, 'cuoi-cung')
    assert.strictEqual(latest2.metadata, undefined)
    const hot1 = await source.getViewMoreItems('hot', undefined)
    eq(hot1.metadata, { nextUrl: `${D}/tim-truyen?status=-1&sort=11&page=2` })

    // Tìm kiếm và thể loại
    const search = await source.getSearchResults(query({ title: 'one piece' }), undefined)
    eq(search.results.map(r => r.mangaId), ['one-piece', 'van-co-chi-ton'])
    const tags = await source.getSearchTags()
    eq(tags[0].tags, [
        { id: '/tim-truyen/action-95', label: 'Action' },
        { id: '/tim-truyen/comedy-99', label: 'Comedy' }
    ])
    // Tình trạng đọc từ <select>, sắp xếp đọc từ link '?sort='
    eq(tags[1].tags, [{ id: 'status:1', label: 'Đang tiến hành' }, { id: 'status:2', label: 'Hoàn thành' }])
    eq(tags[2].tags, [{ id: 'sort:0', label: 'Ngày cập nhật' }, { id: 'sort:11', label: 'Top tháng' }])
    assert.strictEqual(await source.supportsTagExclusion(), false)
    const filtered = await source.getSearchResults(query({ includedTags: [tags[0].tags[0], tags[1].tags[1], tags[2].tags[1]] }), undefined)
    assert.strictEqual(filtered.results[0].mangaId, 'cuoi-cung')
    const sortOnly = await source.getSearchResults(query({ includedTags: [{ id: 'sort:13', label: 'Top ngày' }] }), undefined)
    assert.strictEqual(sortOnly.results[0].mangaId, 'hot-1')
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

    // Danh sách chương lấy đủ qua API dù trang truyện chỉ có vài chương
    const full = await source.getChapters('dai-phung')
    eq(full.map(c => [c.id, c.chapNum, c.name ?? null, c.sortingIndex]), [
        ['/truyen-tranh/dai-phung/chapter-685', 685, null, 0],
        ['/truyen-tranh/dai-phung/chapter-684', 684, 'Chapter 684: Đại chiến', -1],
        ['/truyen-tranh/dai-phung/chapter-1', 1, null, -2]
    ])
    await assert.rejects(source.getChapters('cf-test'), /Cloudflare/)

    // API lỗi (404) -> dùng danh sách chương trong HTML
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
    // 'yyyy-MM-dd HH:mm:ss' đọc theo giờ máy (Safari không tự đọc dạng này)
    eq([ajax[2].time.getFullYear(), ajax[2].time.getMonth(), ajax[2].time.getDate(), ajax[2].time.getHours()], [2024, 0, 2, 3])
    assert.strictEqual(unknownAuthor.mangaInfo.desc, 'Đoạn 1.\nĐoạn 2.')

    // Ảnh chương
    const details = await source.getChapterDetails('one-piece', chapters[0].id)
    eq(details.pages, ['https://img.test/p/1.jpg', 'https://img.test/p/2.jpg', 'https://img.test/p/3.jpg'])

    await assert.rejects(source.getMangaDetails('khong-co'), /HTTP 404/)
    assert.strictEqual((await source.getCloudflareBypassRequestAsync()).url, D)

    // Truyện có thể loại người lớn được đánh dấu 18+
    assert.strictEqual(manga.mangaInfo.hentai, false)
    assert.strictEqual(unknownAuthor.mangaInfo.hentai, true)

    // Mục trang chủ lỗi/trống ghi lý do trên tiêu đề
    const broken = loadSource('NetTruyen', {
        [`${D}/tim-truyen`]: '<html><body>Không có truyện</body></html>',
        [`${D}/tim-truyen?sort=0`]: '<html></html>',
        [`${D}/`]: '<html></html>',
        [`${D}/tim-truyen?sort=11`]: { status: 503, data: 'Just a moment...' }
    }, { quiet: true }).source
    const brokenSections = await homeSections(broken)
    eq([...brokenSections.values()].map(section => section.title), [
        'Mới cập nhật (không có truyện)',
        'Top tháng (cần Cloudflare Bypass)',
        'Hoàn thành (lỗi HTTP 404)'
    ])
    eq([...brokenSections.values()].map(section => section.items.length), [0, 0, 0])

    // Cài đặt tên miền
    const settings = await openSettings(source)
    await settings.input.value.set('https://NT.example/')
    assert.strictEqual((await source.getMangaDetails('one-piece')).mangaInfo.titles[0], 'One Piece')
    assert.strictEqual((await source.getCloudflareBypassRequestAsync()).url, 'https://nt.example')
    await settings.input.value.set('')
    assert.strictEqual(source.getMangaShareUrl('one-piece'), `${D}/truyen-tranh/one-piece`)
}

async function testGocTruyenTranhVui() {
    const D = 'https://goctruyentranhvui31.com'
    const f = name => fixture(`goctruyentranhvui/${name}`)
    const S = `${D}/api/v2/search?p=0`
    let denials = 1
    const { source, requested } = loadSource('GocTruyenTranhVui', {
        [`${S}&orders%5B%5D=recentDate`]: f('search-latest.json'),
        [`${D}/api/v2/search?p=1&orders%5B%5D=recentDate`]: f('search-last.json'),
        [`${S}&orders%5B%5D=viewCount`]: f('search-last.json'),
        [`${S}&orders%5B%5D=createdAt`]: f('search-empty.json'),
        // 'Hoàn thành' lỗi 500 -> tiêu đề mục ghi lý do
        [`${S}&status%5B%5D=END&orders%5B%5D=viewCount`]: { status: 500, data: 'error' },
        [`${D}/api/category`]: f('category.json'),
        [`${S}&searchValue=h%E1%BB%8Da%20s%C4%A9&categories%5B%5D=2&status%5B%5D=END&orders%5B%5D=viewCount`]: f('search-last.json'),
        [`${S}&categories%5B%5D=1`]: f('search-last.json'),
        [`${D}/truyen/hoa-si-ve-nen-ham-nguc`]: f('manga.html'),
        [`${D}/api/comic/101/chapter?limit=-1`]: f('chapters.json'),
        // Lần đầu bị từ chối (hết phiên) -> mở lại trang truyện -> lần hai được
        [`POST ${D}/api/chapter/loadAll`]: request => {
            if (request.data.includes('chapterNumber=99')) return f('loadall-denied.json')
            return denials-- > 0 ? f('loadall-denied.json') : f('loadall.json')
        }
    }, { quiet: true })

    // Trang chủ: danh sách từ API, mục trống/lỗi ghi lý do
    const sections = await homeSections(source)
    eq([...sections.values()].map(section => section.title), ['Mới cập nhật', 'Xem nhiều', 'Truyện mới (không có truyện)', 'Hoàn thành (lỗi HTTP 500)'])
    const latest = sections.get('latest')
    eq(latest.items, [
        { mangaId: '101:hoa-si-ve-nen-ham-nguc', title: 'Họa Sĩ Vẽ Nên Hầm Ngục', image: `${D}/image/cover/101.jpg` },
        { mangaId: '102:truyen-b', title: 'Truyện B', image: 'https://cdn.test/b.jpg' }
    ])
    assert.strictEqual(latest.containsMoreItems, true)
    assert.strictEqual(sections.get('popular').containsMoreItems, false)
    assert.ok(requested.filter(r => r.url.includes('/api/')).every(r => r.headers['x-requested-with'] === 'XMLHttpRequest'))
    assert.strictEqual(requested[0].headers.referer, `${D}/`)

    const more1 = await source.getViewMoreItems('latest', undefined)
    eq(more1.metadata, { nextUrl: `${D}/api/v2/search?p=1&orders%5B%5D=recentDate` })
    const more2 = await source.getViewMoreItems('latest', more1.metadata)
    eq(more2.results.map(r => r.mangaId), ['104:trang-cuoi'])
    assert.strictEqual(more2.metadata, undefined)

    // Bộ lọc: thể loại từ API, tình trạng (bỏ truyện chữ), sắp xếp; kết hợp với tên
    const tags = await source.getSearchTags()
    eq(tags.map(t => t.id), ['genres', 'status', 'sort'])
    eq(tags[0].tags, [{ id: 'cat:1', label: 'Action' }, { id: 'cat:2', label: 'Fantasy' }])
    eq(tags[1].tags.map(t => t.id), ['status:PRG', 'status:END'])
    const filtered = await source.getSearchResults(query({
        title: 'họa sĩ',
        includedTags: [tags[0].tags[1], tags[1].tags[1], { id: 'sort:viewCount', label: 'Lượt xem' }]
    }), undefined)
    eq(filtered.results.map(r => r.mangaId), ['104:trang-cuoi'])

    // Chi tiết truyện
    const manga = await source.getMangaDetails('101:hoa-si-ve-nen-ham-nguc')
    eq(manga.mangaInfo.titles, ['Họa Sĩ Vẽ Nên Hầm Ngục'])
    assert.strictEqual(manga.mangaInfo.image, `${D}/image/cover/101.jpg`)
    assert.strictEqual(manga.mangaInfo.author, 'Tác giả A')
    assert.strictEqual(manga.mangaInfo.status, 'Ongoing')
    assert.strictEqual(manga.mangaInfo.desc, 'Một họa sĩ vô danh vẽ nên hầm ngục.')
    assert.strictEqual(manga.mangaInfo.hentai, false)
    eq(manga.mangaInfo.tags[0].tags, [{ id: 'name:Action', label: 'Action' }, { id: 'name:Fantasy', label: 'Fantasy' }])
    assert.strictEqual(source.getMangaShareUrl('101:hoa-si-ve-nen-ham-nguc'), `${D}/truyen/hoa-si-ve-nen-ham-nguc`)
    // Bấm thể loại ở trang truyện -> tìm theo mã thể loại của API
    const byDetailTag = await source.getSearchResults(query({ includedTags: [manga.mangaInfo.tags[0].tags[0]] }), undefined)
    eq(byDetailTag.results.map(r => r.mangaId), ['104:trang-cuoi'])

    // Chương: sắp mới nhất trước; id thiếu mã truyện thì đọc từ trang HTML
    const chapters = await source.getChapters('101:hoa-si-ve-nen-ham-nguc')
    eq(chapters.map(c => [c.id, c.chapNum, c.sortingIndex]), [['17', 17, 0], ['16.5', 16.5, -1], ['1', 1, -2]])
    assert.strictEqual(chapters[2].time.getTime(), 1704164645000)
    eq((await source.getChapters('hoa-si-ve-nen-ham-nguc')).map(c => c.id), ['17', '16.5', '1'])

    // Ảnh chương: POST loadAll; bị từ chối lần đầu thì mở lại trang truyện rồi thử lại
    const before = requested.length
    const details = await source.getChapterDetails('101:hoa-si-ve-nen-ham-nguc', '17')
    eq(details.pages, [`${D}/image/chapter/101/17/1.jpg`, 'https://cdn.test/101/17/2.jpg'])
    const calls = requested.slice(before)
    eq(calls.map(r => `${r.method} ${r.url.replace(D, '')}`), [
        'POST /api/chapter/loadAll', 'GET /truyen/hoa-si-ve-nen-ham-nguc', 'POST /api/chapter/loadAll'
    ])
    assert.strictEqual(calls[0].data, 'comicId=101&chapterNumber=17&nameEn=hoa-si-ve-nen-ham-nguc')
    assert.strictEqual(calls[0].headers['content-type'], 'application/x-www-form-urlencoded')
    await assert.rejects(source.getChapterDetails('101:hoa-si-ve-nen-ham-nguc', '99'), /cần đăng nhập/)
}

async function main() {
    await testTruyenQQ()
    console.log('TruyenQQ: đạt')
    await testNetTruyen()
    console.log('NetTruyen: đạt')
    await testGocTruyenTranhVui()
    console.log('GocTruyenTranhVui: đạt')
    console.log('Smoke test: tất cả kiểm tra đều đạt')
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
