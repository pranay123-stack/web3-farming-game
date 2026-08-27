/**
 * Copies the shared wire protocol into the server's source tree.
 *
 * The server compiles from ./src only, so the shared file is vendored rather
 * than imported across a package boundary. CI runs this and fails if the copy
 * has drifted, which keeps client and server on one definition.
 */
const fs = require('fs')
const path = require('path')

const source = path.join(__dirname, '..', '..', 'shared', 'protocol.ts')
const target = path.join(__dirname, '..', 'src', 'protocol.ts')
const checkOnly = process.argv.includes('--check')

const sourceContent = fs.readFileSync(source, 'utf8')

if (checkOnly) {
  const targetContent = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
  if (sourceContent !== targetContent) {
    console.error('server/src/protocol.ts is out of sync with shared/protocol.ts')
    console.error('Run: npm --prefix server run sync:protocol')
    process.exit(1)
  }
  console.log('protocol in sync')
} else {
  fs.writeFileSync(target, sourceContent)
  console.log(`synced ${path.relative(process.cwd(), target)}`)
}
