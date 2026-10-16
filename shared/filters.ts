import type { CheerioAPI } from 'cheerio'
import { Tag, TagSection } from '@paperback/types'
import { cleanText } from './utils'

export interface FilterOption {
    value: string
    label: string
}

/**
 * Đọc lựa chọn của một tham số lọc từ trang web: <select name="sort"> hoặc các link có '?sort=...'.
 * Bỏ giá trị '-1' (Tất cả). Không đọc được thì trả mảng rỗng để nguồn dùng giá trị mặc định.
 */
export function readFilterOptions($: CheerioAPI, param: string): FilterOption[] {
    const options: FilterOption[] = []
    const add = (value: string | undefined, label: string) => {
        if (value === undefined || value === '' || value === '-1' || !label) return
        if (options.some(option => option.value === value)) return
        options.push({ value, label })
    }

    $(`select[name="${param}"] option`).each((_, element) => {
        add($(element).attr('value')?.trim(), cleanText($(element).text()))
    })
    if (options.length > 0) return options

    const pattern = new RegExp(`[?&]${param}=([^&#]+)`)
    $(`a[href*="${param}="]`).each((_, element) => {
        add($(element).attr('href')?.match(pattern)?.[1], cleanText($(element).text()))
    })
    return options
}

/** Tag của bộ lọc có id dạng '<prefix>:<value>' để không trùng id thể loại (là path). */
export function optionSection(prefix: string, label: string, options: FilterOption[]): TagSection {
    return App.createTagSection({
        id: prefix,
        label,
        tags: options.map(option => App.createTag({ id: `${prefix}:${option.value}`, label: option.label }))
    })
}

/** Giá trị của lựa chọn đầu tiên thuộc `prefix` trong các tag đã chọn. */
export function pickOption(tags: Tag[] | undefined, prefix: string): string | undefined {
    const tag = (tags ?? []).find(item => item.id.startsWith(prefix + ':'))
    return tag?.id.slice(prefix.length + 1)
}

/** Các tag thể loại (id là path, ví dụ '/the-loai/action-26'). */
export function genreTags(tags: Tag[] | undefined): Tag[] {
    return (tags ?? []).filter(tag => tag.id.startsWith('/'))
}
