<script lang="ts">
    import { onDestroy } from "svelte"
    import { scopeCustomCSS } from "./style"

    export let css: string | null | undefined = ""
    export let scope = ""
    export let prefix = ""

    type Entry = { el: HTMLStyleElement; refs: number }
    const registry = new Map<string, Entry>()

    let current = ""

    $: setCSS(scopeCustomCSS(css, scope, prefix).blocks)

    function setCSS(blocks: string) {
        if (blocks === current) return
        if (current) release(current)
        current = blocks
        if (blocks) acquire(blocks)
    }

    function acquire(blocks: string) {
        const existing = registry.get(blocks)
        if (existing) {
            existing.refs++
            return
        }

        const el = document.createElement("style")
        el.dataset.freeshowItemCSS = ""
        el.textContent = blocks
        document.head.appendChild(el)
        registry.set(blocks, { el, refs: 1 })
    }

    function release(blocks: string) {
        const existing = registry.get(blocks)
        if (!existing) return

        existing.refs--
        if (existing.refs > 0) return

        existing.el.remove()
        registry.delete(blocks)
    }

    onDestroy(() => {
        if (current) release(current)
    })
</script>
