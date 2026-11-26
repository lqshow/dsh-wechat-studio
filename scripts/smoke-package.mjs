// Run through npm run smoke:package so npm_execpath identifies the active npm CLI.
import assert from 'node:assert/strict'
import { execFileSync, execSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { join, resolve, delimiter } from 'node:path'

const pkg = JSON.parse(await readFile('package.json', 'utf8'))
const tarball = resolve(process.argv[2] || `artifacts/${pkg.name}-${pkg.version}.tgz`)
const dir = await mkdtemp(join(tmpdir(), 'wechat-package-'))
try {
  await writeFile(join(dir, 'package.json'), '{"private":true}')
  const env = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' }
  execFileSync(process.execPath, [process.env.npm_execpath, 'install', '--offline', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: dir, env, stdio: 'inherit' })
  const installed = join(dir, 'node_modules', pkg.name)
  const installedPkg = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
  assert.equal(installedPkg.version, pkg.version)
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.equal(Object.keys(installedPkg[field] || {}).length, 0, `Unexpected ${field}`)
  }
  // Check every declared export, plus lazy-loaded bundles the CLI might not import.
  for (const file of [...Object.values(installedPkg.exports), 'dist/unpdf.mjs', 'dist/image-crop.mjs', 'dist/docx-text.mjs']) {
    await access(join(installed, file))
  }
  execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pkg.name)}); await import(${JSON.stringify(pathToFileURL(join(installed, 'dist/unpdf.mjs')).href)}); await import(${JSON.stringify(pathToFileURL(join(installed, 'dist/docx-text.mjs')).href)});`], { cwd: dir, env, stdio: 'inherit' })
  const originalPath = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] || ''
  for (const key of Object.keys(env)) if (key.toUpperCase() === 'PATH') delete env[key]
  env.PATH = [join(dir, 'node_modules', '.bin'), originalPath].join(delimiter)
  // Fixed command strings exercise npm's real executable shim on Windows too.
  const run = command => JSON.parse(execSync(command, { cwd: dir, env, encoding: 'utf8' }))
  assert.deepEqual(run('wechat-studio --version --json'), { ok: true, version: pkg.version })
  const skills = run('wechat-studio skills --data-dir data --json')
  assert.equal(skills.ok, true)
  assert.ok(skills.skills.length >= 8)
  for (const skill of skills.skills) {
    assert.equal(skill.source, 'bundled', `Missing bundled skill: ${skill.name}`)
    assert.ok((await readFile(skill.path, 'utf8')).length > 0)
  }
  await writeFile(join(dir, 'article.md'), '# 离线排版冒烟\n\n零依赖安装后仍然可以排版。\n')
  const layout = run('wechat-studio layout article.md --style neo --theme forest --out preview.html --data-dir data --json')
  assert.equal(layout.ok, true)
  assert.match(await readFile(join(dir, 'preview.html'), 'utf8'), /零依赖安装后仍然可以排版/)
  const minimaxSet = run('wechat-studio settings set --cover-provider minimax --minimax-model MiniMax-H3-Image-Highspeed --data-dir data --json')
  assert.equal(minimaxSet.ok, true)
  assert.equal(minimaxSet.settings.coverProvider, 'minimax')
  assert.equal(minimaxSet.settings.minimaxModel, 'MiniMax-H3-Image-Highspeed')
  const minimaxGet = run('wechat-studio settings get --data-dir data --json')
  assert.equal(minimaxGet.ok, true)
  assert.equal(minimaxGet.settings.coverProvider, 'minimax')
  assert.equal(minimaxGet.settings.minimaxModel, 'MiniMax-H3-Image-Highspeed')
  const geminiSet = run('wechat-studio settings set --cover-provider gemini --gemini-model gemini-3-pro-image --gemini-base-url https://relay.example.com/v1beta/ --data-dir data --json')
  assert.equal(geminiSet.ok, true)
  assert.equal(geminiSet.settings.coverProvider, 'gemini')
  assert.equal(geminiSet.settings.geminiModel, 'gemini-3-pro-image')
  assert.equal(geminiSet.settings.geminiBaseUrl, 'https://relay.example.com')
  const geminiGet = run('wechat-studio settings get --data-dir data --json')
  assert.equal(geminiGet.ok, true)
  assert.equal(geminiGet.settings.coverProvider, 'gemini')
  assert.equal(geminiGet.settings.geminiModel, 'gemini-3-pro-image')
  assert.equal(geminiGet.settings.geminiBaseUrl, 'https://relay.example.com')
  const openaiSet = run('wechat-studio settings set --cover-provider openai --openai-model gpt-image-2.6-flare --openai-base-url https://relay.example.com/openai/v1/ --data-dir data --json')
  assert.equal(openaiSet.ok, true)
  assert.equal(openaiSet.settings.coverProvider, 'openai')
  assert.equal(openaiSet.settings.openaiModel, 'gpt-image-2.6-flare')
  assert.equal(openaiSet.settings.openaiBaseUrl, 'https://relay.example.com/openai/v1')
  const openaiGet = run('wechat-studio settings get --data-dir data --json')
  assert.equal(openaiGet.ok, true)
  assert.equal(openaiGet.settings.coverProvider, 'openai')
  assert.equal(openaiGet.settings.openaiModel, 'gpt-image-2.6-flare')
  assert.equal(openaiGet.settings.openaiBaseUrl, 'https://relay.example.com/openai/v1')
  console.log('Installed package: exports, version, bundled skills, MiniMax, Gemini & OpenAI settings and offline layout passed')
} finally {
  await rm(dir, { recursive: true, force: true })
}
