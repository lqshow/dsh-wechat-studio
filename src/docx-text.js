import { fromBufferPromise } from 'yauzl'
import { SaxesParser } from 'saxes'

const DOCUMENT = 'word/document.xml'
const RELATIONSHIPS = 'word/_rels/document.xml.rels'
const MAX_XML_BYTES = 4 * 1024 * 1024
const WORD_NS = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
])
const LINK_NS = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'http://purl.oclc.org/ooxml/officeDocument/relationships',
])

function parseXml(xml, handlers) {
  const encoding = xml[0] === 0xff && xml[1] === 0xfe ? 'utf-16le'
    : xml[0] === 0xfe && xml[1] === 0xff ? 'utf-16be' : 'utf-8'
  const parser = new SaxesParser({ xmlns: true })
  parser.on('doctype', () => { throw new Error('Unexpected XML document type') })
  for (const [event, handler] of Object.entries(handlers)) parser.on(event, handler)
  parser.write(new TextDecoder(encoding, { fatal: true }).decode(xml)).close()
}

export async function docxToText(buffer) {
  const parts = new Map()
  const zip = await fromBufferPromise(buffer, { lazyEntries: true })
  try {
    for await (const entry of zip.eachEntry()) {
      if (entry.fileName !== DOCUMENT && entry.fileName !== RELATIONSHIPS) continue
      if (entry.uncompressedSize > MAX_XML_BYTES || parts.has(entry.fileName)) {
        throw new Error('Invalid Word document part')
      }
      const chunks = []
      for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk)
      parts.set(entry.fileName, Buffer.concat(chunks))
    }
  } finally {
    zip.close()
  }
  if (!parts.has(DOCUMENT)) throw new Error('Missing Word document body')

  const links = new Map()
  if (parts.has(RELATIONSHIPS)) {
    parseXml(parts.get(RELATIONSHIPS), {
      opentag({ local, attributes }) {
        const target = attributes.Target?.value
        if (local === 'Relationship' && attributes.Type?.value.endsWith('/hyperlink') &&
            attributes.TargetMode?.value === 'External' && /^https?:\/\//i.test(target ?? '')) {
          links.set(attributes.Id?.value, target)
        }
      },
    })
  }

  const text = []
  const activeLinks = []
  let insideText = false
  parseXml(parts.get(DOCUMENT), {
    opentag({ uri, local, attributes }) {
      if (!WORD_NS.has(uri)) return
      if (local === 't') insideText = true
      if (local === 'tab') text.push('\t')
      if (local === 'br' || local === 'cr') text.push('\n')
      if (local === 'hyperlink') {
        const id = Object.values(attributes).find(attr => attr.local === 'id' && LINK_NS.has(attr.uri))
        activeLinks.push({ url: links.get(id?.value), start: text.length })
      }
    },
    text(value) {
      if (insideText) text.push(value)
    },
    closetag({ uri, local }) {
      if (!WORD_NS.has(uri)) return
      if (local === 't') insideText = false
      if (local === 'p') text.push('\n')
      if (local === 'hyperlink') {
        const link = activeLinks.pop()
        if (link?.url && text.slice(link.start).join('').trim() !== link.url) {
          text.push(` (${link.url})`)
        }
      }
    },
  })
  return text.join('').trim()
}
