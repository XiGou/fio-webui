const ansiColorMap: Record<string, string> = {
  '0': '', '30': 'black', '31': 'red', '32': 'green', '33': 'yellow',
  '34': 'blue', '35': 'magenta', '36': 'cyan', '37': 'white',
  '90': 'bright-black', '91': 'bright-red', '92': 'bright-green', '93': 'bright-yellow',
  '94': 'bright-blue', '95': 'bright-magenta', '96': 'bright-cyan', '97': 'bright-white',
}

const ansiBackgroundMap: Record<string, string> = {
  '40': 'black', '41': 'red', '42': 'green', '43': 'yellow',
  '44': 'blue', '45': 'magenta', '46': 'cyan', '47': 'white',
  '100': 'bright-black', '101': 'bright-red', '102': 'bright-green', '103': 'bright-yellow',
  '104': 'bright-blue', '105': 'bright-magenta', '106': 'bright-cyan', '107': 'bright-white',
}

export function ansiToHtml(text: string): string {
  let currentSpan: string | null = null
  let classes = ''

  const cleaned = text.replace(/\033\[2J/g, '').replace(/\033\[H/g, '')
  const parts = cleaned.split(/(\033\[[0-9;]*m)/)

  let html = ''
  for (const part of parts) {
    if (part.match(/\033\[[\d;]*m/)) {
      const match = part.match(/\033\[([0-9;]*)m/)
      const codes = (match?.[1] ?? '').split(';')
      classes = ''
      for (const code of codes) {
        if (code === '' || code === '0') {
          classes = ''
        } else if (ansiColorMap[code]) {
          classes += (classes ? ' ' : '') + 'ansi-' + ansiColorMap[code]
        } else if (ansiBackgroundMap[code]) {
          classes += (classes ? ' ' : '') + 'ansi-bg-' + ansiBackgroundMap[code]
        }
      }
      currentSpan = classes || null
    } else if (part) {
      const escaped = part
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
      html += currentSpan ? `<span class="${currentSpan}">${escaped}</span>` : escaped
    }
  }
  return html
}
