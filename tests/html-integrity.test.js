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

describe('onclick handlers have matching functions', () => {
  // Extract function names from onclick="fnName(...)"
  const onclickRe = /onclick="(?:event\.(?:stopPropagation|preventDefault)\(\);\s*)?(\w+)\(/g
  const onclickFns = new Set()
  let m
  while ((m = onclickRe.exec(html)) !== null) {
    // Skip inline expressions like "if(..." or "window.electronAPI..."
    const fn = m[1]
    if (fn === 'if' || fn === 'window' || fn === 'event' || fn === 'document') continue
    onclickFns.add(fn)
  }

  for (const fn of onclickFns) {
    it(`function ${fn}() exists in src/*.js`, () => {
      // Match "function fnName" or "async function fnName" or "const fnName = " at top level
      const pattern = new RegExp(`(?:^|\\s)(?:async\\s+)?function\\s+${fn}\\b|(?:const|let|var)\\s+${fn}\\s*=`, 'm')
      expect(allJs).toMatch(pattern)
    })
  }
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
