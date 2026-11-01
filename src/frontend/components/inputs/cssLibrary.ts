import { writable } from "svelte/store"

export type CSSLibraryContext = "item" | "text"

export type CSSLibraryItem = {
    id: string
    name: string
    css: string
    context: CSSLibraryContext
    updated: number
}

const STORAGE_KEY = "freeshow.cssLibrary"
const MAX_ITEMS = 100

function newId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function readLibrary(): CSSLibraryItem[] {
    if (typeof localStorage === "undefined") return []

    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return []

        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []

        return parsed.filter((a) => a && typeof a.name === "string" && typeof a.css === "string" && (a.context === "item" || a.context === "text")).map((a) => ({ id: typeof a.id === "string" ? a.id : newId(), name: a.name, css: a.css, context: a.context, updated: Number(a.updated) || 0 }))
    } catch {
        return []
    }
}

export const cssLibrary = writable<CSSLibraryItem[]>(readLibrary())

// only persist real edits, so another open window loading the library can't overwrite newer entries
let loaded = false
cssLibrary.subscribe((items) => {
    if (!loaded) {
        loaded = true
        return
    }
    if (typeof localStorage === "undefined") return

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    } catch {
        // storage can be full or blocked, the library still works for this session
    }
})

// save a style, replacing an existing one with the same name in the same context
export function saveCSSLibraryItem(name: string, css: string, context: CSSLibraryContext): CSSLibraryItem | null {
    const trimmedCSS = (css || "").trim()
    if (!trimmedCSS) return null

    const trimmedName = (name || "").trim().slice(0, 60) || "Untitled style"
    let saved: CSSLibraryItem | null = null

    cssLibrary.update((items) => {
        const existing = items.find((a) => a.context === context && a.name.toLowerCase() === trimmedName.toLowerCase())
        const item: CSSLibraryItem = { id: existing?.id || newId(), name: trimmedName, css: trimmedCSS, context, updated: Date.now() }
        saved = item

        if (existing) return items.map((a) => (a.id === existing.id ? item : a))
        return [...items, item].slice(-MAX_ITEMS)
    })

    return saved
}

export function deleteCSSLibraryItem(id: string) {
    cssLibrary.update((items) => items.filter((a) => a.id !== id))
}
