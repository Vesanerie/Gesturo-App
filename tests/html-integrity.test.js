import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '..')
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')

// Collect all JS source code from src/*.js
const srcDir = path.join(ROOT, 'src')
const jsFiles = fs.readdirSync(srcDir, { recursive: true })
  .filter(f => f.endsWith('.js'))
const allJs = jsFiles.map(f => fs.readFileSync(path.join(srcDir, f), 'utf8')).join('\n')

describe('no inline event handlers remain', () => {
  it('index.html has zero onclick/oninput/onchange/onmouseover/onmouseout attributes', () => {
    const inlineRe = /\b(onclick|oninput|onchange|onmouseover|onmouseout)="/g
    const matches = html.match(inlineRe)
    expect(matches).toBeNull()
  })

  it('all addEventListener init functions exist in src/*.js', () => {
    const initRe = /_init\w+Listeners/g
    const inits = allJs.match(initRe) || []
    expect(inits.length).toBeGreaterThanOrEqual(8)
  })
})

describe('getElementById with direct .textContent has matching HTML id', () => {
  const optionsJs = fs.readFileSync(path.join(ROOT, 'src', 'options.js'), 'utf8')
  // Match getElementById('xxx').textContent (no null check)
  const idRe = /getElementById\('([^']+)'\)\s*\.\s*textContent/g
  const ids = new Set()
  let m2
  while ((m2 = idRe.exec(optionsJs)) !== null) {
    ids.add(m2[1])
  }

  for (const id of ids) {
    it(`id="${id}" exists in index.html`, () => {
      expect(html).toMatch(new RegExp(`id=["']${id}["']`))
    })
  }
})
