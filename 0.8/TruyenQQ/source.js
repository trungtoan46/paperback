/**
 * TruyenQQ Extension for Paperback v0.8
 * Version 1.1.0 - Highly Compatible Fix
 */

"use strict";

console.log('TruyenQQ: Start loading source.js');

var DOMAIN = 'https://truyenqqno.com';

var TruyenQQInfo = {
    version: '1.1.0',
    name: 'TruyenQQ',
    icon: 'icon.png',
    author: 'Paperback Community',
    authorWebsite: 'https://github.com/paperback-community',
    description: 'TruyenQQ Extension v1.1.0',
    contentRating: 1, // 1 = MATURE
    websiteBaseURL: DOMAIN,
    sourceTags: [
        { text: 'Vietnamese', type: 0 }
    ],
    intents: 17
};

function Parser() { }

Parser.prototype.convertTime = function (timeAgo) {
    var now = Date.now();
    if (timeAgo.indexOf('phút') !== -1) {
        var match = timeAgo.match(/(\d+)/);
        return new Date(now - (match ? parseInt(match[1]) : 0) * 60 * 1000);
    }
    if (timeAgo.indexOf('giờ') !== -1) {
        var match = timeAgo.match(/(\d+)/);
        return new Date(now - (match ? parseInt(match[1]) : 0) * 60 * 60 * 1000);
    }
    if (timeAgo.indexOf('ngày') !== -1) {
        var match = timeAgo.match(/(\d+)/);
        return new Date(now - (match ? parseInt(match[1]) : 0) * 24 * 60 * 60 * 1000);
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
        var url = $link.attr('href') || '';
        var match = url.match(/truyen-tranh\/(.+)-(\d+)/);
        if (!match) return;
        mangas.push({
            mangaId: match[1] + '-' + match[2],
            title: $link.attr('title') || $elem.find('.book_name a').text().trim() || 'Không tiêu đề',
            image: $elem.find('img').attr('data-src') || $elem.find('img').attr('src') || '',
            subtitle: $elem.find('.chapter_name').text().trim() || ''
        });
    });
    return mangas;
};

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
        var tags = [];
        $('.list01 li a').each(function (_, elem) {
            tags.push({ label: $(elem).text().trim(), id: $(elem).attr('href').split('/').pop() });
        });
        return {
            id: mangaId,
            mangaInfo: {
                titles: [$('.book_info h1').text().trim() || 'Không tiêu đề'],
                image: $('.book_avatar img').attr('src') || '',
                author: $('.list_info .org').first().text().trim() || 'Đang cập nhật',
                artist: $('.list_info .org').first().text().trim() || 'Đang cập nhật',
                desc: $('.story_introduction').text().trim() || 'Không có mô tả',
                status: $('.list_info li').eq(2).text().trim() || 'Đang cập nhật',
                hentai: false,
                tags: [{ id: '0', label: 'Thể loại', tags: tags }]
            }
        };
    });
};

TruyenQQ.prototype.getChapters = function (mangaId) {
    var self = this;
    return this.DOMHTML(DOMAIN + '/truyen-tranh/' + mangaId).then(function ($) {
        var chapters = [];
        $('.list_chapter .works-chapter-item').each(function (index, element) {
            var $elem = $(element);
            var $link = $elem.find('a').first();
            var url = $link.attr('href') || '';
            var chapMatch = url.match(/chap-(\d+(?:\.\d+)?)/);
            chapters.push({
                id: url,
                mangaId: mangaId,
                name: $link.find('.name-chap').text().trim() || ("Chapter " + (chapMatch ? chapMatch[1] : index)),
                chapNum: chapMatch ? parseFloat(chapMatch[1]) : index,
                langCode: 'vi',
                time: self.parser.convertTime($elem.find('.time-chap').text().trim()),
                sortingIndex: index
            });
        });
        return chapters;
    });
};

TruyenQQ.prototype.getChapterDetails = function (mangaId, chapterId) {
    var url = chapterId.indexOf('http') === 0 ? chapterId : DOMAIN + chapterId;
    return this.DOMHTML(url).then(function ($) {
        var pages = [];
        $('#chapter_content .page-chapter img, .chapter_content .page-chapter img').each(function (_, element) {
            var imageUrl = $(element).attr('data-original') || $(element).attr('data-cdn') || $(element).attr('src') || '';
            if (imageUrl && imageUrl.indexOf('http') === 0) pages.push(imageUrl);
        });
        return { id: chapterId, mangaId: mangaId, pages: pages };
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
        return {
            results: mangas,
            metadata: hasNext ? { page: page + 1 } : undefined
        };
    });
};

exports.TruyenQQ = TruyenQQ;
exports.TruyenQQInfo = TruyenQQInfo;

console.log('TruyenQQ: Finished loading source.js');

exports.SourceInfo = exports.TruyenQQInfo;
