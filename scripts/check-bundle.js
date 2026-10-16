// CI: sau `npm run build`, thư mục 0.8 phải giống bản đã commit.
// Bỏ qua buildTime và thứ tự nguồn trong versioning.json, và index.html (thứ tự nguồn không cố định).
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const git = args => execSync(`git ${args}`, { cwd: root, encoding: 'utf8' })
const IGNORED = ['0.8/versioning.json', '0.8/index.html']

const changed = git('status --porcelain -- 0.8')
    .split('\n')
    .filter(line => line.trim().length > 0)
    .filter(line => !IGNORED.includes(line.slice(3).trim()))

const normalize = text => {
    const json = JSON.parse(text)
    return JSON.stringify({
        sources: [...json.sources].sort((a, b) => a.id.localeCompare(b.id)),
        builtWith: json.builtWith
    })
}
const committed = normalize(git('show HEAD:0.8/versioning.json'))
const built = normalize(fs.readFileSync(path.join(root, '0.8', 'versioning.json'), 'utf8'))

if (changed.length > 0 || committed !== built) {
    console.error('Thư mục 0.8 không khớp với code. Chạy `npm run build` rồi commit lại thư mục 0.8.')
    changed.forEach(line => console.error('  ' + line))
    if (committed !== built) console.error('  0.8/versioning.json (thông tin nguồn khác)')
    process.exit(1)
}
console.log('Thư mục 0.8 khớp với code')
