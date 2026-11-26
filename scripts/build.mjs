// 打包客户端和本地解析工具：
// 1. client/ → dist/client.js，DSH 的 lazy CommonJS 模块，react 由宿主提供，CSS 内联成字符串。
// 2. unpdf → dist/unpdf.mjs，读朱雀报告 PDF 用。
// 3. image-crop → dist/image-crop.mjs，跨平台裁切封面用；后两者打进来之后插件没有任何运行时依赖，装上就能跑。
import { build, context } from 'esbuild'
import { readFile } from 'node:fs/promises'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const watch = process.argv.includes('--watch')

const client = {
  entryPoints: ['client/index.jsx'],
  outfile: 'dist/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'chrome120',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  external: ['react'],
  loader: { '.css': 'text', '.webp': 'dataurl' },
  minify: !watch,
  legalComments: 'none',
  banner: { js: `window.__ModuleLoader__.load({id:${JSON.stringify(pkg.name)},factory:(require)=>{const module={exports:{}};const exports=module.exports;` },
  footer: { js: 'return module.exports}})' },
}

const pdf = {
  stdin: { contents: "export { extractText, getDocumentProxy } from 'unpdf'", resolveDir: process.cwd() },
  outfile: 'dist/unpdf.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  minify: true,
  legalComments: 'none',
}

const imageCrop = {
  stdin: { contents: "export { cropCover, normalizeImageFormat } from './src/image-crop.js'", resolveDir: process.cwd() },
  outfile: 'dist/image-crop.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  minify: true,
  legalComments: 'none',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
}

await build(pdf)
await build(imageCrop)
await build({
  ...imageCrop,
  stdin: { contents: "export { docxToText } from './src/docx-text.js'", resolveDir: process.cwd() },
  outfile: 'dist/docx-text.mjs',
  supported: { 'template-literal': false },
  legalComments: 'inline',
})
if (watch) {
  const ctx = await context(client)
  await ctx.watch()
  console.log('watching client/')
} else {
  const result = await build({ ...client, metafile: true })
  const size = Object.values(result.metafile.outputs)[0].bytes
  console.log(`dist/client.js ${(size / 1024).toFixed(1)} KB`)
}
