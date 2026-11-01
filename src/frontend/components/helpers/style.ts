import type { StringObject } from "../../../types/Main"

const cache = new Map<string, StringObject>()
const DONT_REPLACE = ["color", "background", "text-decoration", "text-transform", "text-shadow", "box-shadow", "font-family", "transform", "shape-outside"]

type SplitCSS = { inline: string; blocks: string[] }
const cssCache = new Map<string, SplitCSS>()

export type ScopedCSS = { inline: string; blocks: string; scope: string; prefix: string; keyframes: string[] }
const scopedCache = new Map<string, ScopedCSS>()
const inlineScopeCache = new Map<string, string>()

// separate normal declarations from blocks like @keyframes so they can be applied to a stylesheet instead of the inline style
export function splitCustomCSS(css: string | null | undefined): SplitCSS {
    if (typeof css !== "string" || !css.trim()) return { inline: "", blocks: [] }

    const cached = cssCache.get(css)
    if (cached) return cached

    let inline = ""
    const blocks: string[] = []
    let i = 0
    let start = 0

    while (i < css.length) {
        const char = css[i]

        if (char === '"' || char === "'") {
            i = skipCSSString(css, i)
            continue
        }

        if (char === "/" && css[i + 1] === "*") {
            const end = css.indexOf("*/", i + 2)
            i = end === -1 ? css.length : end + 2
            continue
        }

        if (char === ";") {
            inline += css.slice(start, i + 1)
            start = i + 1
            i++
            continue
        }

        if (char === "{") {
            const end = findCSSBlockEnd(css, i)
            const block = css.slice(start, end + 1).trim()
            if (block) blocks.push(block)
            i = end + 1
            start = i
            continue
        }

        i++
    }

    const rest = css.slice(start).trim()
    if (rest) inline += rest.endsWith(";") ? rest : rest + ";"

    const result: SplitCSS = { inline: inline.trim(), blocks: [...new Set(blocks)] }
    if (cssCache.size > 500) cssCache.clear()
    cssCache.set(css, result)
    return result
}

export function getStyleBlocks(css: string | null | undefined): string {
    return splitCustomCSS(css).blocks.join("\n")
}

export function getInlineStyle(css: string | null | undefined): string {
    return splitCustomCSS(css).inline
}

// short deterministic id, used to keep custom selectors & keyframes local to one element
function hashString(str: string): string {
    let hash = 2166136261
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i)
        hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(36)
}

// scope for one rendered element, independent of the styles it contains
export function getItemScope(ref: any, index = 0, item?: any): string {
    return "fs" + hashString(`${ref?.showId || ref?.id || "show"}|${ref?.slideId || ref?.layoutId || ""}|${index}|${item?.id || ""}`)
}

// fallback scope when no element identity is available
export function getCSSScope(css: string | null | undefined): string {
    return "fs" + hashString(typeof css === "string" ? css : "")
}

export function getKeyframeNames(css: string | null | undefined): string[] {
    if (typeof css !== "string" || !css.includes("keyframes")) return []

    const names: string[] = []
    const regex = /@(?:-webkit-)?keyframes\s+(-?[_a-zA-Z][\w-]*)/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(css))) if (!names.includes(match[1])) names.push(match[1])
    return names
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// rewrite animation references to the scoped keyframe names
function prefixAnimationNames(css: string, names: string[], prefix: string): string {
    if (!css || !names.length || !prefix) return css

    return css.replace(/(animation(?:-name)?\s*:\s*)([^;}]+)/gi, (_match, head, value) => {
        let next = value
        names.forEach((name) => {
            next = next.replace(new RegExp(`(^|[\\s,])${escapeRegExp(name)}(?=$|[\\s,])`, "g"), `$1${prefix}${name}`)
        })
        return head + next
    })
}

// strip blocks and make animation names match the scoped keyframes
export function scopeInlineStyle(css: string | null | undefined, prefix: string): string {
    if (typeof css !== "string" || !css) return ""

    const cacheKey = `${prefix}|${css}`
    const cached = inlineScopeCache.get(cacheKey)
    if (cached !== undefined) return cached

    const result = prefixAnimationNames(getInlineStyle(css), getKeyframeNames(css), prefix)
    if (inlineScopeCache.size > 800) inlineScopeCache.clear()
    inlineScopeCache.set(cacheKey, result)
    return result
}

// at-rules that declare something global, they have no selectors to scope
const GLOBAL_AT_RULES = new Set(["font-face", "property", "page", "counter-style", "font-feature-values", "font-palette-values", "position-try", "view-transition"])

function splitSelectorList(selector: string): string[] {
    const selectors: string[] = []
    let start = 0
    let depth = 0
    let quote = ""
    let i = 0

    while (i < selector.length) {
        const char = selector[i]

        if (quote) {
            if (char === "\\") i += 2
            else {
                if (char === quote) quote = ""
                i++
            }
            continue
        }

        if (char === '"' || char === "'") {
            quote = char
            i++
            continue
        }

        if (char === "/" && selector[i + 1] === "*") {
            const end = selector.indexOf("*/", i + 2)
            i = end === -1 ? selector.length : end + 2
            continue
        }

        if (char === "(" || char === "[") depth++
        else if (char === ")" || char === "]") depth = Math.max(0, depth - 1)
        else if (char === "," && depth === 0) {
            selectors.push(selector.slice(start, i))
            start = i + 1
        }

        i++
    }

    selectors.push(selector.slice(start))
    return selectors.map((a) => a.trim()).filter(Boolean)
}

// replace every & outside strings/comments, so & can also be used mid-selector
function replaceAmpersands(selector: string, scopeSelector: string): string {
    let result = ""
    let quote = ""
    let i = 0

    while (i < selector.length) {
        const char = selector[i]

        if (quote) {
            result += char
            if (char === "\\" && i + 1 < selector.length) {
                result += selector[++i]
            } else if (char === quote) {
                quote = ""
            }
            i++
            continue
        }

        if (char === '"' || char === "'") {
            quote = char
            result += char
            i++
            continue
        }

        if (char === "/" && selector[i + 1] === "*") {
            const end = selector.indexOf("*/", i + 2)
            const commentEnd = end === -1 ? selector.length : end + 2
            result += selector.slice(i, commentEnd)
            i = commentEnd
            continue
        }

        result += char === "&" ? scopeSelector : char
        i++
    }

    return result
}

// unscoped selectors are treated as "& selector", so they can only match inside the element
function scopeSelector(selector: string, scope: string): string {
    const trimmed = selector.trim()
    if (!trimmed) return ""

    if (trimmed.includes("&")) return replaceAmpersands(trimmed, scope)

    // :root is often used to declare local custom properties
    const rootMatch = /^:root(?=$|[\s:.#\[])/.exec(trimmed)
    if (rootMatch) return scope + trimmed.slice(rootMatch[0].length)

    // * normally touches every element in the window
    if (trimmed === "*") return `${scope}, ${scope} *`

    return `${scope} ${trimmed}`
}

function scopeBlock(block: string, scope: string): string {
    const trimmed = block.trim()
    if (!trimmed) return ""

    const atRule = /^@([\w-]+)/.exec(trimmed)
    if (atRule) {
        const name = atRule[1].toLowerCase()
        if (name.endsWith("keyframes") || GLOBAL_AT_RULES.has(name)) return trimmed
        if (!trimmed.includes("{")) return trimmed

        const open = trimmed.indexOf("{")
        const close = trimmed.lastIndexOf("}")
        if (open === -1 || close <= open) return trimmed

        // unknown at-rules are treated as grouping rules, so new selector-based
        // at-rules can't escape the element either
        const prelude = trimmed.slice(0, open).trim()
        const inner = trimmed.slice(open + 1, close)
        return `${prelude} {\n${scopeRuleList(inner, scope)}\n}`
    }

    const open = trimmed.indexOf("{")
    const close = trimmed.lastIndexOf("}")
    if (open === -1 || close <= open) return trimmed

    const selectors = splitSelectorList(trimmed.slice(0, open))
        .map((selector) => scopeSelector(selector, scope))
        .filter(Boolean)
    if (!selectors.length) return ""

    return `${selectors.join(", ")} {${trimmed.slice(open + 1, close)}}`
}

function scopeRuleList(css: string, scope: string): string {
    let result = ""
    let start = 0
    let i = 0

    while (i < css.length) {
        const char = css[i]

        if (char === '"' || char === "'") {
            i = skipCSSString(css, i)
            continue
        }

        if (char === "/" && css[i + 1] === "*") {
            const end = css.indexOf("*/", i + 2)
            i = end === -1 ? css.length : end + 2
            continue
        }

        if (char === "{") {
            const end = findCSSBlockEnd(css, i)
            result += scopeBlock(css.slice(start, end + 1), scope) + "\n"
            i = end + 1
            start = i
            continue
        }

        i++
    }

    return result.trim()
}

function scopeCSSBlocks(blocks: string[], scope: string): string {
    return blocks
        .map((block) => scopeBlock(block, scope))
        .filter(Boolean)
        .join("\n")
}

// split CSS, namespace its keyframes and keep every rule inside the element it belongs to
export function scopeCustomCSS(css: string | null | undefined, scope = "", prefix = ""): ScopedCSS {
    const source = typeof css === "string" ? css : ""
    const finalScope = scope || getCSSScope(source)
    const finalPrefix = prefix || `${finalScope}-`
    const cacheKey = `${finalScope}|${finalPrefix}|${source}`

    const cached = scopedCache.get(cacheKey)
    if (cached) return cached

    const { inline, blocks } = splitCustomCSS(source)
    const keyframes = getKeyframeNames(source)
    const scopeSelector = `[data-fs-scope="${finalScope}"]`

    let scopedBlocks = scopeCSSBlocks(blocks, scopeSelector)
    keyframes.forEach((name) => {
        scopedBlocks = scopedBlocks.replace(new RegExp(`(@(?:-webkit-)?keyframes\\s+)${escapeRegExp(name)}(?![\\w-])`, "g"), `$1${finalPrefix}${name}`)
    })
    scopedBlocks = prefixAnimationNames(scopedBlocks, keyframes, finalPrefix)

    const result: ScopedCSS = {
        inline: prefixAnimationNames(inline, keyframes, finalPrefix),
        blocks: scopedBlocks,
        scope: finalScope,
        prefix: finalPrefix,
        keyframes
    }

    if (scopedCache.size > 500) scopedCache.clear()
    scopedCache.set(cacheKey, result)
    return result
}

// CSS properties the custom CSS box also writes, so the inspector can show a conflict badge
export type CSSConflicts = { forced: string[]; rules: string[] }
export function getCSSConflicts(css: string | null | undefined): CSSConflicts {
    const conflicts: CSSConflicts = { forced: [], rules: [] }
    if (typeof css !== "string" || !css.includes("{")) return conflicts

    const { inline } = splitCustomCSS(css)
    inline.replace(/([^;{}]+):([^;{}]+)/g, (match, property, value) => {
        const prop = property.trim()
        if (prop.startsWith("--")) return match
        if (/important/i.test(value) && !conflicts.forced.includes(prop)) conflicts.forced.push(prop)
        return match
    })

    splitCustomCSS(css).blocks.forEach((block) => {
        if (/^\s*@(?:-webkit-)?keyframes\b/i.test(block)) return

        const open = block.indexOf("{")
        const close = block.lastIndexOf("}")
        if (open === -1 || close === -1) return

        block.slice(open + 1, close).replace(/([^;{}]+):([^;{}]+)/g, (match, property, value) => {
            const prop = property.trim()
            if (prop.startsWith("--") || prop.includes("(") || !/^-?[_a-zA-Z][\w-]*$/.test(prop)) return match

            if (/important/i.test(value)) {
                if (!conflicts.forced.includes(prop)) conflicts.forced.push(prop)
            } else if (!conflicts.rules.includes(prop) && !conflicts.forced.includes(prop)) conflicts.rules.push(prop)
            return match
        })
    })

    return conflicts
}

function skipCSSString(css: string, start: number): number {
    const quote = css[start]
    let i = start + 1
    while (i < css.length) {
        if (css[i] === "\\") {
            i += 2
            continue
        }
        if (css[i] === quote) return i + 1
        i++
    }
    return css.length
}

function findCSSBlockEnd(css: string, start: number): number {
    let depth = 0
    let i = start
    while (i < css.length) {
        const char = css[i]
        if (char === '"' || char === "'") {
            i = skipCSSString(css, i)
            continue
        }
        if (char === "/" && css[i + 1] === "*") {
            const end = css.indexOf("*/", i + 2)
            i = end === -1 ? css.length : end + 2
            continue
        }
        if (char === "{") depth++
        else if (char === "}") {
            depth--
            if (depth === 0) return i
        }
        i++
    }
    return css.length - 1
}

export const getStyles = (str: string | null | undefined, removeTxt = false): StringObject => {
    if (typeof str !== "string") return {}

    // @keyframes and other blocks can't be used in an inline style attribute
    const inline = getInlineStyle(str)
    const cacheKey = `${removeTxt ? 1 : 0}_${inline}`
    const cached = cache.get(cacheKey)
    if (cached) return { ...cached }

    const styles: StringObject = {}

    inline.split(";").forEach((s) => {
        const colon = s.indexOf(":")
        if (colon === -1) return

        const key = s.slice(0, colon).trim()
        let style = s.slice(colon + 1).trim()

        if (removeTxt && !DONT_REPLACE.some((d) => key.includes(d))) {
            const num = removeText(style)
            if (num) style = num
        }

        if (key === "transform") Object.assign(styles, getFilters(style))
        styles[key] = style
    })

    if (cache.size > 1000) cache.clear()
    cache.set(cacheKey, styles)

    return { ...styles }
}

export function getFilters(filter: string | undefined) {
    if (typeof filter !== "string") return {}

    const styles: StringObject = {}
    filter.split(" ").forEach((s) => {
        const match = s.match(/^([^(]+)\(([^)]+)\)/)
        if (match) styles[match[1].trim()] = removeText(match[2].trim())
    })

    return styles
}

export function removeText(value: string): string {
    return value ? value.replace(/[^0-9.-]/g, "") : ""
}

export function getItemStyle(style: string | undefined, isCropped = false, prefix = ""): string {
    if (!style) return ""

    // keep @keyframes out of the inline style attribute, they are injected as a stylesheet instead
    const inline = getInlineStyle(style)

    let result = inline
    if (isCropped) {
        result = inline
            .split(";")
            .filter((s) => {
                const k = s.split(":")[0]?.trim()
                return k && !k.startsWith("border") && k !== "box-shadow"
            })
            .join(";")
    } else if (inline.includes("border-width:") && !inline.includes("border-style:")) {
        result = `${inline};border-style: solid;`
    }

    return prefixAnimationNames(result, getKeyframeNames(style), prefix)
}

// used by the stage, which builds its own style strings from getStyles()
export function scopeAnimationNames(css: string, names: string[], prefix: string): string {
    return prefixAnimationNames(css, names, prefix)
}
