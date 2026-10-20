#!/usr/bin/env node
/**
 * Deterministic "initial JavaScript" size per route: every /_next/static script the
 * server-rendered HTML references (the code a visitor must download before the page
 * is interactive), summed raw and gzip-compressed. Lazy chunks loaded later are not
 * counted; Lighthouse's transfer figures cover those.
 *
 *   node scripts/perf/initial-js.mjs --base http://localhost:3310 --out file.json / /about
 */
import { gzipSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const args = process.argv.slice(2)
const take = (name) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args.splice(i, 2)[1]
}
const base = take('base')
const out = take('out')
const routes = args
if (!base || routes.length === 0) {
  console.error('usage: initial-js.mjs --base <url> [--out file] <route...>')
  process.exit(2)
}

const cache = new Map()
async function size(url) {
  if (!cache.has(url)) {
    const body = Buffer.from(await (await fetch(url)).arrayBuffer())
    cache.set(url, { raw: body.length, gzip: gzipSync(body, { level: 9 }).length })
  }
  return cache.get(url)
}

const results = {}
for (const route of routes) {
  const html = await (await fetch(new URL(route, base))).text()
  const srcs = [...new Set([...html.matchAll(/<script[^>]+src="([^"]*\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]))]
  let raw = 0
  let gzip = 0
  for (const src of srcs) {
    const s = await size(new URL(src, base).toString())
    raw += s.raw
    gzip += s.gzip
  }
  results[route] = { scripts: srcs.length, rawBytes: raw, gzipBytes: gzip }
  console.log(`${route.padEnd(48)} ${srcs.length} scripts  ${(raw / 1024).toFixed(1)} KB raw  ${(gzip / 1024).toFixed(1)} KB gzip`)
}
if (out) {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify({ base, generatedAt: new Date().toISOString(), results }, null, 2) + '\n')
}
