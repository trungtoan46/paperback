// Chép bản build từ bundles/0.8 sang thư mục 0.8 ở gốc repo (đường dẫn Paperback đang đọc).
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const from = path.join(root, 'bundles', '0.8')
const to = path.join(root, '0.8')

fs.rmSync(to, { recursive: true, force: true })
fs.cpSync(from, to, { recursive: true })
console.log(`Đã chép ${path.relative(root, from)} -> ${path.relative(root, to)}`)
