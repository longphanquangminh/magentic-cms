/**
 * Pixel position of a character index inside an <input>/<textarea>, via a hidden
 * mirror element that copies the field's typography (the classic textarea-caret
 * technique). Returned coordinates are relative to the field's border box and
 * already account for its scroll position.
 */
const COPIED = [
  'direction', 'boxSizing', 'width', 'height', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderStyle', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight',
  'fontStretch', 'fontSize', 'fontSizeAdjust', 'lineHeight', 'fontFamily', 'fontFeatureSettings', 'textAlign', 'textTransform',
  'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing', 'tabSize',
] as const

let mirror: HTMLDivElement | null = null

export function caretCoordinates(el: HTMLInputElement | HTMLTextAreaElement, index: number) {
  if (!mirror) {
    mirror = document.createElement('div')
    mirror.setAttribute('aria-hidden', 'true')
    document.body.appendChild(mirror)
  }
  const isInput = el.nodeName === 'INPUT'
  const computed = window.getComputedStyle(el)
  const style = mirror.style as any
  for (const prop of COPIED) style[prop] = (computed as any)[prop]
  style.position = 'absolute'
  style.visibility = 'hidden'
  style.top = '0'
  style.left = '-9999px'
  style.whiteSpace = isInput ? 'pre' : 'pre-wrap'
  style.overflowWrap = isInput ? 'normal' : 'break-word'
  style.overflow = 'hidden'
  if (isInput) style.height = 'auto'
  // a vertical scrollbar narrows the text column of a textarea
  if (!isInput && el.scrollHeight > el.clientHeight) style.width = `${el.clientWidth + parseFloat(computed.borderLeftWidth) + parseFloat(computed.borderRightWidth)}px`

  const value = el.value
  const safeIndex = Math.max(0, Math.min(index, value.length))
  const before = value.slice(0, safeIndex)
  mirror.textContent = isInput ? before.replace(/\s/g, '\u00a0') : before
  const marker = document.createElement('span')
  marker.textContent = value.slice(safeIndex) || '.'
  mirror.appendChild(marker)

  const lineHeight = parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.4
  return {
    top: marker.offsetTop + parseFloat(computed.borderTopWidth) - el.scrollTop,
    left: marker.offsetLeft + parseFloat(computed.borderLeftWidth) - el.scrollLeft,
    height: lineHeight,
  }
}
