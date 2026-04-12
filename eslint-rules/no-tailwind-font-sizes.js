const ARBITRARY_FONT_SIZE_PATTERN = /text-\[/
const SCALE_FONT_SIZE_PATTERN = /(?:^|\s)text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)(?=\s|$)/

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'disallow Tailwind font-size classes on primitive components; use shared typography helpers instead',
    },
    schema: [],
    messages: {
      unexpectedArbitrary: 'Use the shared typography helpers instead of arbitrary "{{token}}"',
      unexpectedScale: 'Use the shared typography helpers (e.g. sessionText/meta/badge or typography.*) instead of the Tailwind size class "{{token}}"',
    },
  },
  create(context) {
    const reportArbitraryMatch = (value, node) => {
      const match = value.match(ARBITRARY_FONT_SIZE_PATTERN)
      if (match) {
        const startIdx = match.index
        const endIdx = value.indexOf(']', startIdx)
        const token = endIdx !== -1
          ? value.slice(startIdx, endIdx + 1)
          : value.slice(startIdx)
        context.report({
          node,
          messageId: 'unexpectedArbitrary',
          data: { token },
        })
      }
    }

    const reportScaleMatch = (value, node) => {
      const match = value.match(SCALE_FONT_SIZE_PATTERN)
      if (match) {
        const token = match[0].trim()
        context.report({
          node,
          messageId: 'unexpectedScale',
          data: { token },
        })
      }
    }

    const reportMatch = (value, node) => {
      reportArbitraryMatch(value, node)
      reportScaleMatch(value, node)
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') {
          reportMatch(node.value, node)
        }
      },
      TemplateLiteral(node) {
        for (const quasi of node.quasis) {
          if (typeof quasi.value.cooked === 'string') {
            reportMatch(quasi.value.cooked, node)
          }
        }
      },
    }
  },
}
