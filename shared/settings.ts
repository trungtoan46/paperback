import { DUISection, SourceStateManager } from '@paperback/types'

const DOMAIN_KEY = 'domain'

/**
 * 'truyenqqko.com', 'https://truyenqqko.com/abc' -> 'https://truyenqqko.com'.
 * Trả undefined nếu không giống tên miền.
 */
export function normalizeDomain(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined
    let text = value.trim()
    if (!text) return undefined
    if (!/^https?:\/\//i.test(text)) text = 'https://' + text
    const match = text.match(/^(https?:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?)(?:[/?#]|$)/i)
    return match ? match[1]!.toLowerCase() : undefined
}

/** Tên miền người dùng chọn trong cài đặt nguồn; mặc định là tên miền build sẵn. */
export class DomainSetting {
    private cached: string | undefined

    constructor(private readonly stateManager: SourceStateManager, readonly defaultDomain: string) { }

    /** Giá trị đã nạp gần nhất; dùng cho chỗ không chờ được (getMangaShareUrl, interceptor). */
    get current(): string {
        return this.cached ?? this.defaultDomain
    }

    async load(): Promise<string> {
        if (this.cached === undefined) {
            this.cached = normalizeDomain(await this.stateManager.retrieve(DOMAIN_KEY)) ?? this.defaultDomain
        }
        return this.cached
    }

    /** Chuỗi rỗng = về mặc định; chuỗi không hợp lệ bị bỏ qua. */
    async save(value: unknown): Promise<void> {
        const empty = typeof value !== 'string' || value.trim() === ''
        const domain = empty ? undefined : normalizeDomain(value)
        if (!empty && domain === undefined) return
        // Lưu chuỗi rỗng (không lưu null) khi về mặc định.
        await this.stateManager.store(DOMAIN_KEY, domain ?? '')
        this.cached = domain ?? this.defaultDomain
    }

    menu(): DUISection {
        return App.createDUISection({
            id: 'settings',
            header: 'Cài đặt',
            isHidden: false,
            rows: async () => [
                App.createDUILabel({ id: 'current_domain', label: 'Tên miền đang dùng', value: await this.load() }),
                App.createDUINavigationButton({
                    id: 'domain_form',
                    label: 'Đổi tên miền',
                    form: App.createDUIForm({
                        sections: async () => [
                            App.createDUISection({
                                id: 'domain_section',
                                header: 'Tên miền',
                                footer: `Nhập tên miền mới khi web đổi địa chỉ, ví dụ ${this.defaultDomain.replace(/^https?:\/\//, '')}. ` +
                                    `Để trống để dùng mặc định (${this.defaultDomain}).`,
                                isHidden: false,
                                rows: async () => [
                                    App.createDUIInputField({
                                        id: 'domain_input',
                                        label: 'Tên miền',
                                        value: App.createDUIBinding({
                                            get: async () => this.load(),
                                            set: async (value: unknown) => this.save(value)
                                        })
                                    })
                                ]
                            })
                        ]
                    })
                }),
                App.createDUIButton({
                    id: 'reset_domain',
                    label: 'Dùng tên miền mặc định',
                    onTap: async () => this.save('')
                })
            ]
        })
    }
}
