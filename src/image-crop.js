import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'

const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
const MAX_PIXELS = 4700 * 2000

function pngDimensions(image) {
  if (image.length < 24 || image.toString('hex', 0, 8) !== '89504e470d0a1a0a' || image.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) }
}

function jpegDimensions(image) {
  if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8) return null
  let offset = 2
  while (offset + 3 < image.length) {
    if (image[offset] !== 0xff) return null
    while (offset < image.length && image[offset] === 0xff) offset++
    const marker = image[offset++]
    if (marker === 0xda || marker === 0xd9) return null
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > image.length) return null
    const length = image.readUInt16BE(offset)
    if (length < 2 || offset + length > image.length) return null
    if (SOF_MARKERS.has(marker)) {
      if (length < 7) return null
      return { width: image.readUInt16BE(offset + 5), height: image.readUInt16BE(offset + 3) }
    }
    offset += length
  }
  return null
}

// 47:20 = 公众号封面 2.35:1。尺寸闸在完整解码前执行，避免异常图片占用过多内存。
export function cropCover(image, format) {
  const dimensions = format === 'jpeg' ? jpegDimensions(image) : pngDimensions(image)
  if (!dimensions) throw new Error('Invalid image dimensions')
  const { width, height } = dimensions
  const units = Math.min(Math.floor(width / 47), Math.floor(height / 20))
  if (!units || units > 100 || width * height > MAX_PIXELS) throw new Error('Invalid image dimensions')
  const decoded = format === 'jpeg' ? jpeg.decode(image) : PNG.sync.read(image)
  const { data } = decoded
  const cropWidth = units * 47
  const cropHeight = units * 20
  if (cropWidth === width && cropHeight === height) return image
  const left = Math.floor((width - cropWidth) / 2)
  const top = Math.floor((height - cropHeight) / 2)
  const out = Buffer.alloc(cropWidth * cropHeight * 4)
  const pixels = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  for (let y = 0; y < cropHeight; y++) {
    const start = ((top + y) * width + left) * 4
    pixels.copy(out, y * cropWidth * 4, start, start + cropWidth * 4)
  }
  return format === 'jpeg'
    ? jpeg.encode({ data: out, width: cropWidth, height: cropHeight }, 90).data
    : PNG.sync.write({ data: out, width: cropWidth, height: cropHeight })
}

export function normalizeImageFormat(image, targetFormat) {
  if (!Buffer.isBuffer(image) || image.length < 8) throw new Error('Invalid image format')
  const isPng = image.toString('hex', 0, 8) === '89504e470d0a1a0a'
  const isJpeg = image.toString('hex', 0, 3) === 'ffd8ff'
  if (!isPng && !isJpeg) throw new Error('Invalid image format')
  const sourceFormat = isPng ? 'png' : 'jpeg'
  if (sourceFormat === targetFormat) return image
  const dimensions = isJpeg ? jpegDimensions(image) : pngDimensions(image)
  if (!dimensions || !dimensions.width || !dimensions.height || dimensions.width * dimensions.height > MAX_PIXELS) {
    throw new Error('Invalid image dimensions')
  }
  const decoded = isJpeg ? jpeg.decode(image) : PNG.sync.read(image)
  const data = Buffer.isBuffer(decoded.data)
    ? decoded.data
    : Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength)
  return targetFormat === 'jpeg'
    ? jpeg.encode({ data, width: decoded.width, height: decoded.height }, 90).data
    : PNG.sync.write({ data, width: decoded.width, height: decoded.height })
}
