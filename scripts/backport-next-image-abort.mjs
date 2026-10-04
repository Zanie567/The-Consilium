// Backport the response-socket fix from Next.js PR #98168 to the pinned 16.2.2.
// https://github.com/vercel/next.js/pull/98168
// The internal request retains protocol/address context; the shared response is
// independent of the client connection. No cancellation/error filters are added.
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { version } = require('next/package.json')
if (version !== '16.2.2') throw new Error(`Review/remove the Next image-abort backport before changing Next (${version}).`)
const updates = []
for (const [file, original, replacement] of [
  ['next/dist/server/image-optimizer.js', `const mocked = (0, _mockrequest.createRequestResponseMocks)({\n            url: href,\n            method,\n            socket: _req.socket\n        });`, `const mocked = {\n            req: new _mockrequest.MockedRequest({ url: href, method, headers: {}, socket: _req.socket }),\n            res: new _mockrequest.MockedResponse()\n        }; // Consilium: upstream Next.js #98168 response-socket backport`],
  ['next/dist/esm/server/image-optimizer.js', `const mocked = createRequestResponseMocks({\n            url: href,\n            method,\n            socket: _req.socket\n        });`, `const mocked = {\n            req: new MockedRequest({ url: href, method, headers: {}, socket: _req.socket }),\n            res: new MockedResponse()\n        }; // Consilium: upstream Next.js #98168 response-socket backport`],
]) {
  const location = require.resolve(file)
  let source = fs.readFileSync(location, 'utf8')
  const importBefore = "import { createRequestResponseMocks } from './lib/mock-request';"
  const importAfter = "import { MockedRequest, MockedResponse } from './lib/mock-request';"
  if (source.includes(replacement)) {
    if (file.includes('/esm/') && !source.includes(importAfter)) throw new Error(`Incomplete backport in ${file}.`)
    continue // npm install/postinstall is idempotent.
  }
  if (file.includes('/esm/') && source.split(importBefore).length !== 2) throw new Error(`Unexpected Next imports in ${file}.`)
  if (source.split(original).length !== 2) throw new Error(`Unexpected Next source in ${file}; refusing an ambiguous backport.`)
  source = source.replace(original, replacement)
  if (file.includes('/esm/')) source = source.replace("import { createRequestResponseMocks } from './lib/mock-request';", "import { MockedRequest, MockedResponse } from './lib/mock-request';")
  updates.push([location, source])
}
// Validate both distributions before writing either one.
for (const [location, source] of updates) fs.writeFileSync(location, source)

