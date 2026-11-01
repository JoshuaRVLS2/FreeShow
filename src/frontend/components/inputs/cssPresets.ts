export type CSSPresetContext = "item" | "text" | "both"

export type CSSPreset = {
    id: string
    name: string
    group: string
    context: CSSPresetContext
    description: string
    css: string
}

export const cssPresets: CSSPreset[] = [
    {
        id: "fade-up",
        name: "Fade up",
        group: "Entrance",
        context: "item",
        description: "Fades in while rising into place.",
        css: `--fs-trigger: slide;

@keyframes fade-up {
    from { opacity: 0; translate: 0 32px; }
    to { opacity: 1; translate: 0 0; }
}

& {
    animation: fade-up 650ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
}`
    },
    {
        id: "drop-in",
        name: "Drop in",
        group: "Entrance",
        context: "item",
        description: "Drops in from above.",
        css: `--fs-trigger: slide;

@keyframes drop-in {
    from { opacity: 0; translate: 0 -28px; }
    to { opacity: 1; translate: 0 0; }
}

& {
    animation: drop-in 600ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
}`
    },
    {
        id: "slide-in",
        name: "Slide in left",
        group: "Entrance",
        context: "item",
        description: "Slides in from the left.",
        css: `--fs-trigger: slide;

@keyframes slide-in-left {
    from { opacity: 0; translate: -48px 0; }
    to { opacity: 1; translate: 0 0; }
}

& {
    animation: slide-in-left 650ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
}`
    },
    {
        id: "zoom-in",
        name: "Zoom in",
        group: "Entrance",
        context: "item",
        description: "Scales up into place.",
        css: `--fs-trigger: slide;

@keyframes zoom-in {
    from { opacity: 0; scale: 0.82; }
    to { opacity: 1; scale: 1; }
}

& {
    animation: zoom-in 500ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
}`
    },
    {
        id: "blur-in",
        name: "Blur in",
        group: "Entrance",
        context: "item",
        description: "Sharpens into view.",
        css: `--fs-trigger: slide;

@keyframes blur-in {
    from { opacity: 0; filter: blur(14px); }
    to { opacity: 1; filter: blur(0); }
}

& {
    animation: blur-in 700ms ease backwards;
}`
    },
    {
        id: "curtain",
        name: "Curtain reveal",
        group: "Entrance",
        context: "item",
        description: "Reveals the item from left to right.",
        css: `--fs-trigger: slide;

@keyframes curtain {
    from { clip-path: inset(0 100% 0 0); }
    to { clip-path: inset(0 0 0 0); }
}

& {
    animation: curtain 850ms cubic-bezier(0.65, 0, 0.35, 1) backwards;
}`
    },
    {
        id: "pulse",
        name: "Pulse",
        group: "Emphasis",
        context: "item",
        description: "Gently breathes while visible.",
        css: `@keyframes pulse {
    0%, 100% { scale: 1; }
    50% { scale: 1.04; }
}

& {
    animation: pulse 2.4s ease-in-out infinite;
}`
    },
    {
        id: "float",
        name: "Float",
        group: "Emphasis",
        context: "item",
        description: "Slowly drifts up and down.",
        css: `@keyframes float {
    0%, 100% { translate: 0 0; }
    50% { translate: 0 -8px; }
}

& {
    animation: float 3.6s ease-in-out infinite;
}`
    },
    {
        id: "shake",
        name: "Shake",
        group: "Emphasis",
        context: "item",
        description: "A quick attention shake on slide enter.",
        css: `--fs-trigger: slide;

@keyframes shake {
    0%, 100% { translate: 0 0; }
    20% { translate: -6px 0; }
    40% { translate: 6px 0; }
    60% { translate: -4px 0; }
    80% { translate: 4px 0; }
}

& {
    animation: shake 600ms ease-in-out;
}`
    },
    {
        id: "hover-lift",
        name: "Hover lift",
        group: "Hover",
        context: "item",
        description: "Lifts the item when hovered.",
        css: `& {
    transition: translate 220ms ease, box-shadow 220ms ease;
}

&:hover {
    translate: 0 -6px;
    box-shadow: 0 14px 34px rgb(0 0 0 / 0.35);
}`
    },
    {
        id: "hover-glow",
        name: "Hover glow",
        group: "Hover",
        context: "both",
        description: "Adds a soft glow when hovered.",
        css: `& {
    transition: box-shadow 220ms ease;
}

&:hover {
    box-shadow: 0 0 0 2px currentColor, 0 0 28px rgb(255 255 255 / 0.28);
}`
    },
    {
        id: "marker",
        name: "Marker highlight",
        group: "Text",
        context: "text",
        description: "Highlights the lower half of the selected text.",
        css: `box-shadow: inset 0 -0.55em 0 rgb(255 209 102 / 0.45);`
    },
    {
        id: "underline-sweep",
        name: "Underline sweep",
        group: "Text",
        context: "text",
        description: "Draws an underline under the selected text.",
        css: `position: relative;

&::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: -0.12em;
    height: 0.1em;
    background: currentColor;
    transform: scaleX(0);
    transform-origin: left;
    animation: underline-sweep 700ms 200ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

@keyframes underline-sweep {
    to { transform: scaleX(1); }
}`
    },
    {
        id: "text-shadow",
        name: "Soft shadow",
        group: "Text",
        context: "text",
        description: "Adds a soft shadow behind the selected text.",
        css: `text-shadow: 0 2px 14px rgb(0 0 0 / 0.65);`
    }
]

export function getCSSPresetGroups(context: "item" | "text") {
    const groups: Record<string, CSSPreset[]> = {}

    cssPresets.forEach((preset) => {
        if (preset.context !== "both" && preset.context !== context) return
        if (!groups[preset.group]) groups[preset.group] = []
        groups[preset.group].push(preset)
    })

    return Object.entries(groups)
}
