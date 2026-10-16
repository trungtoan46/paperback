/**
 * Nhớ tạm kết quả theo khoá trong thời gian ngắn. App gọi getMangaDetails và getChapters gần như
 * cùng lúc cho cùng một truyện; dùng chung một request giúp mở truyện nhanh hơn và đỡ bị web chặn.
 * Kết quả lỗi không được giữ lại.
 */
export class ShortCache<T> {
    private readonly entries = new Map<string, { expires: number, value: Promise<T> }>()

    constructor(private readonly ttlMs: number, private readonly maxEntries = 10) { }

    get(key: string, load: () => Promise<T>): Promise<T> {
        const now = Date.now()
        const hit = this.entries.get(key)
        if (hit && hit.expires > now) return hit.value

        const value = load()
        this.entries.set(key, { expires: now + this.ttlMs, value })
        value.catch(() => {
            if (this.entries.get(key)?.value === value) this.entries.delete(key)
        })
        while (this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next().value
            if (oldest === undefined) break
            this.entries.delete(oldest)
        }
        return value
    }
}
