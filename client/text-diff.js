// 纯函数词级 / 字符级文本对比，零外部依赖，供「改稿对比 / 看改动」高亮展示。
// 对中文按单字切分、对英文/数字按词切分、空白与标点各自成段，兼顾中文可读性与英文完整性。

const TOKEN_RE = /[A-Za-z0-9_]+|[\u4e00-\u9fff\u3400-\u4dbf]|[\s]+|./gu
const MAX_LCS_CELLS = 160_000

/**
 * 将文本切分为适合中英文混排对比的 token 序列。
 * @param {string} text
 * @returns {string[]}
 */
export function tokenizeForDiff(text) {
  const input = String(text ?? '')
  if (!input) return []
  return input.match(TOKEN_RE) ?? []
}

function mergeSegments(parts) {
  const merged = []
  for (const part of parts) {
    if (!part.text) continue
    const prev = merged.at(-1)
    if (prev && prev.kind === part.kind) prev.text += part.text
    else merged.push({ kind: part.kind, text: part.text })
  }
  return merged
}

/**
 * 计算两段文本的行内差异，返回左侧（改前）与右侧（改后）的分段列表及增删字数。
 * 超过 LCS 保护阈值时自动退化为公共前后缀对比，确保超长段落也能毫秒级返回。
 *
 * @param {string} beforeText
 * @param {string} afterText
 * @returns {{
 *   before: Array<{ kind: 'same' | 'del', text: string }>,
 *   after: Array<{ kind: 'same' | 'ins', text: string }>,
 *   added: number,
 *   removed: number,
 * }}
 */
export function diffInline(beforeText, afterText) {
  const aText = String(beforeText ?? '')
  const bText = String(afterText ?? '')
  if (aText === bText) {
    const same = aText ? [{ kind: 'same', text: aText }] : []
    return { before: same, after: same, added: 0, removed: 0 }
  }

  const a = tokenizeForDiff(aText)
  const b = tokenizeForDiff(bText)

  let prefix = 0
  const minLen = Math.min(a.length, b.length)
  while (prefix < minLen && a[prefix] === b[prefix]) prefix++

  let suffix = 0
  while (
    suffix < minLen - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++
  }

  const prefixText = a.slice(0, prefix).join('')
  const suffixText = suffix > 0 ? a.slice(a.length - suffix).join('') : ''
  const midA = a.slice(prefix, a.length - suffix)
  const midB = b.slice(prefix, b.length - suffix)

  const beforeParts = []
  const afterParts = []
  if (prefixText) {
    beforeParts.push({ kind: 'same', text: prefixText })
    afterParts.push({ kind: 'same', text: prefixText })
  }

  let removed = 0
  let added = 0

  if (midA.length === 0 || midB.length === 0 || midA.length * midB.length > MAX_LCS_CELLS) {
    const delText = midA.join('')
    const insText = midB.join('')
    if (delText) {
      beforeParts.push({ kind: 'del', text: delText })
      removed += delText.length
    }
    if (insText) {
      afterParts.push({ kind: 'ins', text: insText })
      added += insText.length
    }
  } else {
    const m = midA.length
    const n = midB.length
    const cols = n + 1
    const dp = new Uint32Array((m + 1) * cols)
    for (let i = m - 1; i >= 0; i--) {
      const row = i * cols
      const nextRow = (i + 1) * cols
      for (let j = n - 1; j >= 0; j--) {
        if (midA[i] === midB[j]) {
          dp[row + j] = dp[nextRow + j + 1] + 1
        } else {
          const down = dp[nextRow + j]
          const right = dp[row + j + 1]
          dp[row + j] = down >= right ? down : right
        }
      }
    }

    let i = 0
    let j = 0
    while (i < m && j < n) {
      if (midA[i] === midB[j]) {
        beforeParts.push({ kind: 'same', text: midA[i] })
        afterParts.push({ kind: 'same', text: midB[j] })
        i++
        j++
      } else if (dp[(i + 1) * cols + j] >= dp[i * cols + (j + 1)]) {
        beforeParts.push({ kind: 'del', text: midA[i] })
        removed += midA[i].length
        i++
      } else {
        afterParts.push({ kind: 'ins', text: midB[j] })
        added += midB[j].length
        j++
      }
    }
    while (i < m) {
      beforeParts.push({ kind: 'del', text: midA[i] })
      removed += midA[i].length
      i++
    }
    while (j < n) {
      afterParts.push({ kind: 'ins', text: midB[j] })
      added += midB[j].length
      j++
    }
  }

  if (suffixText) {
    beforeParts.push({ kind: 'same', text: suffixText })
    afterParts.push({ kind: 'same', text: suffixText })
  }

  return {
    before: mergeSegments(beforeParts),
    after: mergeSegments(afterParts),
    added,
    removed,
  }
}
