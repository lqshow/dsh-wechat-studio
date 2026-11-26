import { PREP_LIMITS } from './prep.js'

export const MAX_BRIEF_FILE_BYTES = 10 * 1024 * 1024
const MAX_PDF_PAGES = 100

const fail = (message, status = 422) => Object.assign(new Error(message), { status })

async function pdfText(buffer) {
  const { extractText, getDocumentProxy } = await import('../dist/unpdf.mjs')
  const pdf = await getDocumentProxy(new Uint8Array(buffer), { isEvalSupported: false })
  try {
    if (pdf.numPages > MAX_PDF_PAGES) throw fail('PDF 最多支持 100 页，请拆分后导入。')
    const { text } = await extractText(pdf, { mergePages: false })
    const pages = []
    let blankPages = 0
    for (const [index, content] of text.entries()) {
      if (!content.trim()) blankPages++
      const page = await pdf.getPage(index + 1)
      const links = (await page.getAnnotations())
        .map(annotation => annotation.url)
        .filter(url => /^https?:\/\//i.test(url ?? '') && !content.includes(url))
      pages.push([content.trim(), ...new Set(links)].filter(Boolean).join('\n'))
    }
    if (blankPages === pdf.numPages) {
      throw fail('PDF 中没有可提取的文字。扫描件请先做 OCR，再导入或粘贴文字。')
    }
    return {
      text: pages.filter(Boolean).join('\n\n'),
      warning: blankPages ? `PDF 有 ${blankPages} 页没有可提取的文字，请对照原件检查是否遗漏。` : '',
    }
  } finally {
    await pdf.destroy()
  }
}

export async function readBriefFile(buffer, name) {
  if (buffer.length > MAX_BRIEF_FILE_BYTES) throw fail('文件不能超过 10 MB。', 413)
  const isPdf = /\.pdf$/i.test(name)
  const isWord = /\.docx$/i.test(name)
  if (!isPdf && !isWord) throw fail('请选择 PDF 或 Word（.docx）文件。', 400)
  const signature = isPdf ? '%PDF-' : 'PK\x03\x04'
  if (buffer.subarray(0, signature.length).toString('latin1') !== signature) {
    throw fail('文件格式与扩展名不符，请检查原文件。', 400)
  }

  let result
  try {
    if (isPdf) result = await pdfText(buffer)
    else {
      const { docxToText } = await import('../dist/docx-text.mjs')
      result = { text: await docxToText(buffer), warning: '' }
    }
  } catch (err) {
    if (err.status) throw err
    if (err.name === 'PasswordException') throw fail('PDF 已加密，请解锁后重新导入。')
    throw fail(`无法读取${isPdf ? ' PDF' : ' Word'} 文件，请检查文件是否完整。`)
  }
  if (!result.text.trim()) throw fail('Word 文件中没有可提取的文字。')
  if (result.text.length > PREP_LIMITS.maxRawText) {
    throw fail('提取出的原文超过 20,000 字，请缩短文档或复制所需内容后再提炼。')
  }
  return result
}
