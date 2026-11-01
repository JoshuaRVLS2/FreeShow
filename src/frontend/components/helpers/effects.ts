export type EffectTrigger = "mount" | "slide" | "click"

// restart the custom CSS animations on an element and everything it owns
export function replayEffects(root: Element | null | undefined) {
    if (!root) return

    const targets: Element[] = []
    if (root.hasAttribute("data-fs-scope")) targets.push(root)
    targets.push(...Array.from(root.querySelectorAll("[data-fs-scope]")))

    targets.forEach((element) => {
        const scope = element.getAttribute("data-fs-scope")
        if (!scope || typeof element.getAnimations !== "function") return

        element.getAnimations().forEach((animation) => {
            if (typeof CSSAnimation === "undefined" || !(animation instanceof CSSAnimation)) return
            if (!animation.animationName.startsWith(scope + "-")) return

            try {
                animation.cancel()
                animation.play()
            } catch {
                // animation was removed while replaying
            }
        })
    })
}

// replay the effects of the item(s) currently selected in the editor
export function replaySelectedEffects() {
    document.querySelectorAll(".editItem.selected, .stage_item.selected").forEach((element) => replayEffects(element))
}

type EffectParams = {
    trigger?: string
    slideKey?: string
    clickRevealed?: boolean
}

// restart the authored animations when the chosen trigger fires
export function effectReplay(node: HTMLElement, params: EffectParams = {}) {
    let lastSlide = params.slideKey
    let lastClick = params.clickRevealed

    return {
        update(next: EffectParams = {}) {
            const trigger = next.trigger || "mount"

            if (trigger === "slide" && next.slideKey !== lastSlide) replayEffects(node)
            else if (trigger === "click" && next.clickRevealed && !lastClick) replayEffects(node)

            lastSlide = next.slideKey
            lastClick = next.clickRevealed
        }
    }
}
