/** Source census complements rendered snapshots; it is NOT browser coverage evidence. */
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])
const files = walk('src').filter(f => f.endsWith('.tsx'))
const tests = walk('tests').filter(f => /\.(spec|test)\.tsx?$/.test(f))
const testText = tests.map(file => ({ file, text: fs.readFileSync(file, 'utf8') }))
const clean = (text: string) => text.replace(/\s+/g, ' ').trim()
const controls: Record<string, unknown>[] = []
const imports = new Map<string, string[]>()
const controlFiles = new Map<string, string[]>()
const tags = new Set(['button', 'a', 'Link', 'input', 'select', 'option', 'textarea', 'form', 'dialog', 'ToolbarBtn', 'IconToggle', 'SelectField'])
const dynamicFamilies: { file: string; line: number; source: string }[] = []
const nativeDialogs: { file: string; line: number; source: string }[] = []
const imperativeControls: { file: string; line: number; source: string; evidence: string }[] = []
function groupTests(file: string): string[] {
  if (file.includes('components/editor/TiptapEditor')) return ['wf-formatting', 'wf-controls', 'wf-upload', 'wf-mobile']
  if (file.includes('components/admin/article-editor/')) return ['wf-formatting', 'wf-controls', 'wf-failures', 'wf-lifecycle', 'wf-mobile']
  if (file.includes('ReviewPanel')) return ['wf-formatting', 'wf-controls', 'wf-lifecycle', 'wf-mobile']
  if (/TeamProfileForm|TeamManagement/.test(file)) return ['team-profile', 'team-profile-lifecycle']
  if (/ArticleList|Trash/.test(file)) return ['wf-articles', 'wf-remaining']
  if (/Navbar|Footer|ArticleAnchorLinks|app\/articles\/\[slug\]/.test(file)) return ['wf-public-controls', 'wf-navigation', 'public']
  if (/NewsletterSignup/.test(file)) return ['wf-accounts']
  return []
}

for (const file of files) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const dependencies: string[] = []
  const ids: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(source)
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
      if (expression.endsWith('.map') && /<\w/.test(node.getText(source))) {
        dynamicFamilies.push({ file, line, source: clean(node.getText(source)) })
      }
      if (/^(?:window\.)?(?:prompt|confirm|alert)$/.test(expression)) {
        nativeDialogs.push({ file, line, source: clean(node.getText(source)) })
      }
      if ((expression.endsWith('.createElement') && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && ['a', 'button', 'input', 'select', 'textarea', 'form'].includes(node.arguments[0].text))
        || (expression.endsWith('.setAttribute') && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'role' && node.arguments[1] && ts.isStringLiteral(node.arguments[1]) && ['button', 'dialog', 'menu'].includes(node.arguments[1].text))) {
        imperativeControls.push({ file, line, source: clean(node.getText(source)), evidence: 'CODE_INSPECTION; see reviewed action families for browser execution' })
      }
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const name = node.moduleSpecifier.text
      const base = name.startsWith('@/') ? path.join('src', name.slice(2)) : name.startsWith('.') ? path.join(path.dirname(file), name) : ''
      if (base) {
        const resolved = [base, `${base}.tsx`, path.join(base, 'index.tsx')].find(p => files.includes(p))
        if (resolved) dependencies.push(resolved)
      }
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source)
      const attrs: Record<string, string> = {}
      for (const attr of node.attributes.properties) {
        if (ts.isJsxAttribute(attr)) {
          const init = attr.initializer
          attrs[attr.name.getText(source)] = init && ts.isStringLiteral(init) ? init.text : init ? clean(init.getText(source)) : 'true'
        }
      }
      if (tags.has(tag) || ['dialog', 'menu', 'tab', 'switch', 'combobox', 'button'].includes(attrs.role)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
        const id = `${file}:${line}`
        const childText = (n: ts.Node): string => ts.isJsxText(n) ? n.text
          : ts.isJsxExpression(n) ? n.getText(source)
          : ts.isJsxElement(n) ? n.children.map(childText).join(' ') : ''
        const text = ts.isJsxOpeningElement(node) && ts.isJsxElement(node.parent)
          ? clean(node.parent.children.map(childText).join(' ')) : ''
        const label = attrs['aria-label'] || attrs.title || attrs.label || attrs.placeholder || text || attrs.name || '(unnamed control)'
        const events = Object.fromEntries(Object.entries(attrs).filter(([key]) => /^on[A-Z]/.test(key)))
        const literal = !label.startsWith('{') && label.length > 3 ? label : ''
        const candidates = literal ? testText.filter(t => t.text.includes(literal)).map(t => t.file) : []
        controls.push({ id, file, line, tag, label, href: attrs.href ?? null, type: attrs.type ?? null,
          disabledWhen: attrs.disabled ?? null, expectedFromSource: Object.keys(events).length ? events : attrs.href ? `Navigate to ${attrs.href}` : 'Input/container; inspect enclosing handler',
          candidateTests: candidates, groupTestFiles: groupTests(file).map(name => `tests/e2e/${name}.spec.ts`),
          evidence: 'CODE_INSPECTION', coverage: 'Inspection only. Label references neither prove nor disprove action coverage; use the reviewed action families and executed results.',
        })
        ids.push(id)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  imports.set(file, dependencies)
  controlFiles.set(file, ids)
}

function reachable(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen
  seen.add(file)
  for (const dependency of imports.get(file) ?? []) reachable(dependency, seen)
  return seen
}
// Human-reviewed route policy, including legacy surfaces without a nav link.
// These are inspection findings; individual article/category ownership still applies.
function rolesFor(route: string): string[] {
  if (route.startsWith('/predictions')) return ['ADMIN']
  if (route === '/admin/testing') return ['ADMIN']
  if (route === '/editorial/team-profile') return ['ADMIN with assigned card', 'EDITOR', 'WRITER', 'GROWTH']
  if (route === '/admin/team' || route === '/admin/login-attempts' || route === '/admin/data') return ['ADMIN']
  if (route === '/admin/subscribers') return ['ADMIN', 'EDITOR']
  if (route.startsWith('/admin')) return ['ADMIN', 'EDITOR', 'WRITER']
  if (/^\/editorial\/(login|reset-password|setup)$/.test(route)) return ['ALL: unauthenticated forms; setup only when no admin exists']
  if (route.startsWith('/editorial')) {
    if (route === '/editorial/recovery') return ['ADMIN', 'EDITOR', 'WRITER']
    if (/^\/editorial\/(calendar|users|predictions|glossary)(\/|$)/.test(route)) return ['ADMIN']
    if (/^\/editorial\/(analytics|growth)(\/|$)/.test(route)) return ['ADMIN', 'GROWTH']
    if (/^\/editorial\/(review|scheduled|series|debates|comments)(\/|$)/.test(route)) return ['ADMIN', 'EDITOR']
    if (/^\/editorial\/(articles|trash|readers)(\/|$)/.test(route)) return ['ADMIN', 'EDITOR', 'WRITER']
    return ['ADMIN', 'EDITOR', 'WRITER', 'GROWTH']
  }
  return ['WRITER', 'EDITOR', 'ADMIN', 'GROWTH', 'READER', 'ANONYMOUS (profile requires sign-in)']
}
const routes = files.filter(f => f.endsWith('/page.tsx')).map(file => {
  const route = '/' + file.replace(/^src\/app\//, '').replace(/(?:^|\/)page\.tsx$/, '').split('/').filter(p => !/^\(.*\)$/.test(p)).join('/')
  const layouts = files.filter(f => f.endsWith('/layout.tsx') && file.startsWith(path.dirname(f) + '/'))
  const dependencies = new Set([...reachable(file), ...layouts.flatMap(f => [...reachable(f)])])
  const literalPath = route.replace(/\/\[.*$/, '')
  return { route, file, rolesFromInspection: rolesFor(route), accessEvidence: 'CODE_INSPECTION: see coverage-inventory.md role matrix and route guards; rendered refusals in wf-roles',
    candidateTestFiles: literalPath.length > 1 ? testText.filter(t => t.text.includes(literalPath)).map(t => t.file) : [],
    guardSource: [...dependencies].filter(f => f === file || layouts.includes(f)).flatMap(f => fs.readFileSync(f, 'utf8').split('\n').filter(l => /requirePortalRole|getVerifiedSessionUser|session\.user\.role|redirect\(|ALLOWED_ROLES/.test(l)).map(l => `${f}: ${clean(l)}`)),
    controls: [...dependencies].flatMap(f => controlFiles.get(f) ?? []),
    dynamicFamilies: dynamicFamilies.filter(f => dependencies.has(f.file)), nativeDialogs: nativeDialogs.filter(f => dependencies.has(f.file)),
    imperativeControls: imperativeControls.filter(f => dependencies.has(f.file)),
  }
})
const output = 'docs/testing/control-inventory.json'
fs.writeFileSync(output, JSON.stringify({
  provenance: 'Static JSX/import census. Includes conditional and disabled controls. Dynamic map expressions represent families, not enumerated runtime options. Candidate tests are references, never a claim of passing behaviour.',
  regenerate: 'npx ts-node -P tsconfig.seed.json scripts/build-workflow-inventory.ts',
  renderedEvidence: 'test-results/<run>/inventory/<browser>/<role>.json and coverage-inventory.md',
  routes, controls, dynamicFamilies, nativeDialogs, imperativeControls,
}, null, 2) + '\n')
console.log(`${routes.length} page routes, ${controls.length} control declarations -> ${path.relative(root, path.resolve(output))}`)
