/**
 * TruyenQQ Extension for Paperback v0.8
 * Version 1.0.8 - Standardized Interface Fix
 */

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
exports.TruyenQQ = exports.TruyenQQInfo = void 0;

var DOMAIN = 'https://truyenqqno.com';

function Parser() { }

Parser.prototype.convertTime = function (timeAgo) {
    var now = Date.now();
    if (timeAgo.indexOf('phút') !== -1) {
        var minsMatch = timeAgo.match(/(\d+)/);
        var mins = minsMatch ? parseInt(minsMatch[1]) : 0;
        return new Date(now - mins * 60 * 1000);
    }
    if (timeAgo.indexOf('giờ') !== -1) {
        var hoursMatch = timeAgo.match(/(\d+)/);
        var hours = hoursMatch ? parseInt(hoursMatch[1]) : 0;
        return new Date(now - hours * 60 * 60 * 1000);
    }
    if (timeAgo.indexOf('ngày') !== -1) {
        var daysMatch = timeAgo.match(/(\d+)/);
        var days = daysMatch ? parseInt(daysMatch[1]) : 0;
        return new Date(now - days * 24 * 60 * 60 * 1000);
    }
    if (timeAgo.indexOf('/') !== -1) {
        var parts = timeAgo.split('/');
        if (parts.length === 3) {
            return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
        }
    }
    return new Date();
};

Parser.prototype.parseMangaList = function ($) {
    var mangas = [];
    $('ul.list_grid li').each(function (_, element) {
        var $elem = $(element);
        var $link = $elem.find('a').first();
        var url = $link.attr('href');
        if (!url) return;
        var match = url.match(/truyen-tranh\/(.+)-(\d+)/);
        if (!match) return;
        var mangaId = match[1] + '-' + match[2];
        var title = $link.attr('title') || $elem.find('.book_name a').text().trim();
        var image = $elem.find('img').attr('data-src') || $elem.find('img').attr('src') || '';
        var subtitle = $elem.find('.chapter_name').text().trim();
        mangas.push(App.createPartialSourceManga({
            mangaId: mangaId,
            title: title || 'Không tiêu đề',
            image: image || '',
            subtitle: subtitle || ''
        }));
    });
    return mangas;
};

Parser.prototype.parseMangaDetails = function ($, mangaId) {
    var tags = [];
    $('.list01 li a').each(function (_, elem) {
        var label = $(elem).text().trim();
        var href = $(elem).attr('href');
        var id = href ? href.split('/').pop() : label;
        tags.push(App.createTag({ label: label, id: id }));
    });
    var title = $('.book_info h1').text().trim() || 'Không tiêu đề';
    var author = $('.list_info .org').first().text().trim() || 'Đang cập nhật';
    var image = $('.book_avatar img').attr('src') || '';
    var desc = $('.story_introduction').text().trim() || 'Không có mô tả';
    var status = $('.list_info li').eq(2).text().trim() || 'Đang cập nhật';

    return App.createSourceManga({
        id: mangaId,
        mangaInfo: App.createMangaInfo({
            titles: [title],
            image: image || '',
            author: author,
            artist: author,
            desc: desc,
            status: status,
            hentai: false,
            tags: [App.createTagSection({ id: '0', label: 'Thể loại', tags: tags })]
        })
    });
};

Parser.prototype.parseChapterList = function ($, mangaId) {
    var chapters = [];
    var self = this;
    $('.list_chapter .works-chapter-item').each(function (index, element) {
        var $elem = $(element);
        var $link = $elem.find('a').first();
        var url = $link.attr('href');
        if (!url) return;
        var chapterName = $link.find('.name-chap').text().trim();
        var timeText = $elem.find('.time-chap').text().trim();
        var chapMatch = url.match(/chap-(\d+(?:\.\d+)?)/);
        var chapNum = chapMatch ? parseFloat(chapMatch[1]) : 0;
        var time = self.convertTime(timeText);

        chapters.push(App.createChapter({
            id: url,
            mangaId: mangaId,
            name: chapterName || ("Chapter " + chapNum),
            chapNum: chapNum,
            langCode: 'vi',
            time: time,
            sortingIndex: index
        }));
    });
    return chapters;
};

Parser.prototype.parseChapterDetails = function ($) {
    var pages = [];
    $('#chapter_content .page-chapter img, .chapter_content .page-chapter img').each(function (_, element) {
        var imageUrl = $(element).attr('data-original') || $(element).attr('data-cdn') || $(element).attr('src') || '';
        if (imageUrl && imageUrl.indexOf('http') === 0) {
            pages.push(imageUrl);
        }
    });
    return pages;
};

var TruyenQQ = (function () {
    function TruyenQQ(cheerio) {
        this.cheerio = cheerio;
        this.parser = new Parser();
        this.requestManager = App.createRequestManager({
            requestsPerSecond: 4,
            requestTimeout: 15000,
            interceptor: {
                interceptRequest: function (request) {
                    request.headers = request.headers || {};
                    request.headers['referer'] = DOMAIN;
                    request.headers['user-agent'] = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
                    return Promise.resolve(request);
                },
                interceptResponse: function (response) {
                    return Promise.resolve(response);
                }
            }
        });
    }
    TruyenQQ.prototype.getMangaShareUrl = function (mangaId) {
        return DOMAIN + '/truyen-tranh/' + mangaId;
    };
    TruyenQQ.prototype.DOMHTML = function (url) {
        var self = this;
        var request = App.createRequest({ url: url, method: 'GET' });
        return this.requestManager.schedule(request, 1).then(function (response) {
            return self.cheerio.load(response.data);
        });
    };
    TruyenQQ.prototype.getMangaDetails = function (mangaId) {
        var self = this;
        return this.DOMHTML(DOMAIN + '/truyen-tranh/' + mangaId).then(function ($) {
            return self.parser.parseMangaDetails($, mangaId);
        });
    };
    TruyenQQ.prototype.getChapters = function (mangaId) {
        var self = this;
        return this.DOMHTML(DOMAIN + '/truyen-tranh/' + mangaId).then(function ($) {
            return self.parser.parseChapterList($, mangaId);
        });
    };
    TruyenQQ.prototype.getChapterDetails = function (mangaId, chapterId) {
        var self = this;
        var url = chapterId.indexOf('http') === 0 ? chapterId : DOMAIN + chapterId;
        return this.DOMHTML(url).then(function ($) {
            var pages = self.parser.parseChapterDetails($);
            return App.createChapterDetails({ id: chapterId, mangaId: mangaId, pages: pages });
        });
    };
    TruyenQQ.prototype.getSearchResults = function (query, metadata) {
        var self = this;
        var page = (metadata && metadata.page) ? metadata.page : 1;
        var url = (query && query.title)
            ? DOMAIN + '/tim-kiem.html?q=' + encodeURIComponent(query.title)
            : DOMAIN + '/truyen-moi-cap-nhat/trang-' + page + '.html';
        return this.DOMHTML(url).then(function ($) {
            var mangas = self.parser.parseMangaList($);
            var hasNext = $('.pagination a.next, a[title="Next"]').length > 0;
            return App.createPagedResults({
                results: mangas,
                metadata: hasNext ? { page: page + 1 } : undefined
            });
        });
    };
    return TruyenQQ;
}());

exports.TruyenQQ = TruyenQQ;
exports.TruyenQQInfo = {
    version: '1.0.8',
    name: 'TruyenQQ',
    icon: 'icon.png',
    author: 'Paperback Community',
    authorWebsite: 'https://github.com/paperback-community',
    description: 'Extension v1.0.8 - Standard Interface',
    contentRating: 1,
    websiteBaseURL: DOMAIN,
    sourceTags: [
        { text: 'Vietnamese', type: 0 }
    ],
    intents: 17
};

exports.SourceInfo = exports.TruyenQQInfo;
