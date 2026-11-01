<script lang="ts">
    import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete"
    import { copyLineDown, defaultKeymap, deleteLine, history, historyKeymap, indentWithTab, moveLineDown, moveLineUp, toggleComment } from "@codemirror/commands"
    import { css, cssCompletionSource } from "@codemirror/lang-css"
    import { HighlightStyle, bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language"
    import { EditorState } from "@codemirror/state"
    import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers, placeholder, tooltips } from "@codemirror/view"
    import { tags } from "@lezer/highlight"
    import { createEventDispatcher, onDestroy, onMount } from "svelte"
    import { get } from "svelte/store"
    import { variables } from "../../stores"
    import { translateText } from "../../utils/language"
    import { replaySelectedEffects } from "../helpers/effects"
    import { getVariableNameId } from "../helpers/showActions"
    import { getStyles } from "../helpers/style"
    import { cssPresets, getCSSPresetGroups } from "./cssPresets"

    export let value = ""
    export let label = "CSS"
    export let showTrigger = true

    const dispatch = createEventDispatcher()

    let host: HTMLDivElement
    let view: EditorView | null = null
    let lastEmitted = value
    let lastApplied = value
    let syncing = false
    let changeTimeout: ReturnType<typeof setTimeout> | null = null
    let helpOpen = false

    $: trigger = getStyles(value)["--fs-trigger"] || "mount"
    $: triggerHint = trigger === "slide" ? "Replays each time this slide becomes active." : trigger === "click" ? "Replays when Click reveal shows this item." : "Plays once, when this element is created."
    $: presetGroups = getCSSPresetGroups(showTrigger ? "item" : "text")

    const slideVariableOptions: Completion[] = [
        { label: "--slide-group-color", detail: "Current slide group color", type: "variable" },
        { label: "--slide-group-next-color", detail: "Next slide group color", type: "variable" },
        { label: "--slide-group-upcoming-color", detail: "Upcoming slide group color", type: "variable" }
    ]

    function getVariableOptions(): Completion[] {
        const names = Object.values(get(variables) || {})
            .filter((variable) => variable && (variable.type === "number" || variable.type === "random_number" || (variable.type === "text" && !!variable.text?.includes("{"))))
            .map((variable) => getVariableNameId(variable.name))
            .filter(Boolean)

        const dynamicOptions: Completion[] = [...new Set(names)].map((name) => ({ label: `--variable-${name}`, detail: "FreeShow variable", type: "variable" }))
        return [...slideVariableOptions, ...dynamicOptions]
    }

    // only take over when the caret is inside a custom property, otherwise use the CSS language completions
    const freeShowCompletionSource: CompletionSource = (context: CompletionContext): CompletionResult | null => {
        const match = context.matchBefore(/(?:var\(\s*)?--[\w-]*$/)
        if (!match) return null

        const dashIndex = match.text.lastIndexOf("--")
        return {
            from: match.from + Math.max(0, dashIndex),
            options: getVariableOptions(),
            validFor: /^--[\w-]*$/
        }
    }

    const completionSource: CompletionSource = (context) => freeShowCompletionSource(context) || cssCompletionSource(context)

    const cssHighlight = HighlightStyle.define([
        { tag: tags.propertyName, color: "#f079b4" },
        { tag: tags.string, color: "#ceffbe" },
        { tag: tags.color, color: "#ffbe86" },
        { tag: [tags.number, tags.unit], color: "#e9e495" },
        { tag: [tags.keyword, tags.atom], color: "#a16adb" },
        { tag: tags.variableName, color: "#8be9fd" },
        { tag: tags.comment, color: "#8a8a8a", fontStyle: "italic" },
        { tag: tags.invalid, color: "#ff5555" }
    ])

    const editorTheme = EditorView.theme(
        {
            "&": { height: "100%", backgroundColor: "transparent", color: "var(--text)", fontSize: "0.8rem" },
            ".cm-content": {
                caretColor: "var(--secondary)",
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
                padding: "4px 0 8px"
            },
            ".cm-line": { padding: "0 8px" },
            ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--secondary)" },
            "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "rgb(255 255 255 / 0.16)" },
            ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--text)", opacity: "0.45" },
            ".cm-activeLine": { backgroundColor: "rgb(255 255 255 / 0.04)" },
            ".cm-activeLineGutter": { backgroundColor: "transparent" },
            ".cm-placeholder": { color: "var(--text)", opacity: "0.3", fontStyle: "italic" },
            ".cm-tooltip": { backgroundColor: "var(--primary-darker)", border: "1px solid var(--primary-lighter)", color: "var(--text)", borderRadius: "6px", boxShadow: "0 8px 24px rgb(0 0 0 / 0.35)" },
            ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "inherit", maxHeight: "220px" },
            ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "3px 8px", lineHeight: "1.6" },
            ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--secondary)", color: "var(--text)" },
            ".cm-completionDetail": { opacity: "0.55", fontStyle: "normal", marginLeft: "8px" },
            ".cm-completionIcon": { opacity: "0.7" }
        },
        { dark: true }
    )

    function commit() {
        if (changeTimeout) {
            clearTimeout(changeTimeout)
            changeTimeout = null
        }
        if (!view) return

        const doc = view.state.doc.toString()
        if (doc === lastEmitted) return

        lastEmitted = doc
        dispatch("change", doc)
    }

    function scheduleCommit(update: { docChanged: boolean; state: EditorState }) {
        if (!update.docChanged || syncing) return

        if (changeTimeout) clearTimeout(changeTimeout)
        changeTimeout = setTimeout(commit, 250)
    }

    function triggerChanged(event: Event) {
        updateTrigger((event.currentTarget as HTMLSelectElement).value)
    }

    // the trigger is stored with the CSS so it travels with copy/paste and undo
    function updateTrigger(next: string) {
        if (changeTimeout) {
            clearTimeout(changeTimeout)
            changeTimeout = null
        }

        const source = view ? view.state.doc.toString() : value
        const cleaned = source.replace(/--fs-trigger\s*:\s*[^;{}]+;?[ \t]*\n?/g, "").trim()
        const nextValue = next === "mount" ? cleaned : `--fs-trigger: ${next};` + (cleaned ? "\n" + cleaned : "")
        if (nextValue === source) return

        if (view) {
            syncing = true
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: nextValue } })
            syncing = false
        }

        lastApplied = nextValue
        lastEmitted = nextValue
        dispatch("change", nextValue)
    }

    function insertPreset(id: string) {
        const preset = cssPresets.find((a) => a.id === id)
        if (!preset || !view) return

        const doc = view.state.doc.toString()
        let snippet = preset.css.trim()

        // keep the trigger the user already picked, and never add one to text CSS
        if (!showTrigger || /(^|\n)\s*--fs-trigger\s*:/.test(doc)) snippet = snippet.replace(/^--fs-trigger\s*:[^\n]*\n?/, "").trim()

        const insert = (doc.trim() ? "\n\n" : "") + snippet
        const position = doc.length

        view.dispatch({
            changes: { from: position, insert },
            selection: { anchor: position + insert.length }
        })
        view.focus()
        commit()
    }

    function presetChanged(event: Event) {
        const select = event.currentTarget as HTMLSelectElement
        const id = select.value
        select.value = ""
        if (id) insertPreset(id)
    }

    function toggleHelp() {
        helpOpen = !helpOpen
    }

    onMount(() => {
        view = new EditorView({
            state: EditorState.create({
                doc: value,
                extensions: [
                    lineNumbers(),
                    highlightActiveLine(),
                    drawSelection(),
                    history(),
                    bracketMatching(),
                    closeBrackets(),
                    indentOnInput(),
                    EditorState.tabSize.of(4),
                    EditorView.lineWrapping,
                    css(),
                    syntaxHighlighting(cssHighlight),
                    placeholder("Pick an effect above, or start with & { ... }"),
                    autocompletion({ override: [completionSource] }),
                    keymap.of([{ key: "Mod-/", run: toggleComment }, { key: "Shift-Alt-ArrowDown", run: copyLineDown }, { key: "Alt-ArrowUp", run: moveLineUp }, { key: "Alt-ArrowDown", run: moveLineDown }, { key: "Mod-Shift-k", run: deleteLine }, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
                    tooltips({ parent: document.body }),
                    EditorView.contentAttributes.of({ "aria-label": label || "CSS", spellcheck: "false" }),
                    editorTheme,
                    EditorView.updateListener.of(scheduleCommit),
                    EditorView.domEventHandlers({
                        keydown: (event) => {
                            // editing and navigation keys belong to the editor, not the window shortcuts which delete or navigate the selected item
                            if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Backspace", "Delete"].includes((event as KeyboardEvent).key)) event.stopPropagation()
                        },
                        blur: commit
                    })
                ]
            }),
            parent: host
        })
    })

    $: if (view && !view.hasFocus && value !== lastApplied) {
        const current = view.state.doc.toString()
        if (current !== value) {
            syncing = true
            view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
            syncing = false
        }

        lastApplied = value
        lastEmitted = value
    }

    onDestroy(() => {
        if (changeTimeout) clearTimeout(changeTimeout)
        const currentView = view
        view = null
        currentView?.destroy()
    })
</script>

<div class="cssEditor">
    <div class="header">
        <span class="label">{translateText(label)}</span>

        <div class="controls">
            {#if showTrigger}
                <select class="trigger" title={triggerHint} aria-label="Effect trigger" value={trigger} on:change={triggerChanged}>
                    <option value="mount">Once</option>
                    <option value="slide">Slide enter</option>
                    <option value="click">Click reveal</option>
                </select>
            {/if}

            <button class="toolButton" type="button" title="Replay animations" aria-label="Replay animations" on:click={replaySelectedEffects}>Replay</button>
            <button class="toolButton helpButton" type="button" title="CSS help" aria-label="CSS help" aria-expanded={helpOpen} aria-controls="css-help" on:click={toggleHelp}>?</button>
        </div>
    </div>

    <div class="toolbar">
        <select class="preset" title="Insert a ready-made effect" aria-label="Insert a ready-made effect" on:change={presetChanged}>
            <option value="">Effects…</option>
            {#each presetGroups as [group, presets]}
                <optgroup label={group}>
                    {#each presets as preset}
                        <option value={preset.id} title={preset.description}>{preset.name}</option>
                    {/each}
                </optgroup>
            {/each}
        </select>

        <span class="hint" title="&amp; is this element. Every other selector is scoped inside it, so it cannot style the rest of the app.">&amp; = this element</span>
    </div>

    {#if showTrigger}
        <p class="triggerHint">{triggerHint}</p>
    {/if}

    <div class="editor" bind:this={host} />

    {#if helpOpen}
        <div id="css-help" class="help" role="dialog" aria-label="CSS help">
            <button class="helpClose" type="button" aria-label="Close help" on:click={() => (helpOpen = false)}>×</button>
            <h4>CSS quick help</h4>
            <p><code>&amp;</code> is this element. <code>*</code>, <code>span</code> and <code>.class</code> only match inside it.</p>
            <p>
                <strong>Triggers</strong><br />
                <code>mount</code> — once when created<br />
                <code>slide</code> — every slide enter<br />
                <code>click</code> — when Click reveal shows it<br />
                Replay restarts the item's <code>&amp;</code> animation.
            </p>
            <p><strong>Strength</strong><br />Bare declarations are inline and beat <code>&amp; &#123; &#125;</code> rules. Add <code>!important</code> to a rule to win over the inspector.</p>
            <p><strong>Variables</strong><br />Type <code>var(--</code> for FreeShow variables, e.g. <code>var(--variable-song_title)</code> or <code>var(--slide-group-color)</code>.</p>
            <p>
                <strong>Shortcuts</strong><br />
                <code>Ctrl/Cmd+Space</code> — autocomplete<br />
                <code>Ctrl/Cmd+/</code> — comment<br />
                <code>Alt+↑/↓</code> — move line<br />
                <code>Shift+Alt+↓</code> — duplicate line
            </p>
            <p class="helpTip">Pick an effect from <strong>Effects…</strong>, then change only <code>--fs-trigger</code> to decide when it plays.</p>
        </div>
    {/if}
</div>

<style>
    .cssEditor {
        position: relative;
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 190px;
        min-height: 110px;
        max-height: 460px;

        resize: vertical;
        overflow: hidden;

        background-color: var(--primary-darkest);
        border-bottom: 1.2px solid var(--primary-lighter);
        border-radius: 4px 4px 0 0;
    }

    .cssEditor:focus-within {
        border-bottom-color: var(--secondary);
    }

    .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        min-width: 0;
        padding: 6px 8px 2px;

        font-size: 0.75rem;
        font-weight: 500;
        color: var(--secondary);
    }

    .label {
        flex-shrink: 0;
    }

    .controls {
        display: flex;
        align-items: center;
        gap: 5px;
        min-width: 0;
    }

    .trigger {
        max-width: 104px;
        min-width: 0;
        padding: 1px 3px;

        background-color: var(--primary-darker);
        color: var(--text);
        border: 1px solid var(--primary-lighter);
        border-radius: 3px;

        font: inherit;
        font-size: 0.65rem;
        cursor: pointer;
    }

    .toolButton {
        padding: 1px 7px;

        background: transparent;
        color: var(--text);
        border: 1px solid var(--primary-lighter);
        border-radius: 3px;

        font: inherit;
        font-size: 0.65rem;
        cursor: pointer;
    }

    .toolButton:hover {
        color: var(--secondary);
        border-color: var(--secondary);
    }

    .helpButton {
        width: 20px;
        padding: 0;
        border-radius: 50%;
        line-height: 18px;
        text-align: center;
    }

    .toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        padding: 0 8px 4px;
    }

    .preset {
        flex: 0 1 auto;
        max-width: 124px;
        min-width: 0;
        padding: 1px 3px;

        background-color: var(--primary-darker);
        color: var(--text);
        border: 1px solid var(--primary-lighter);
        border-radius: 3px;

        font: inherit;
        font-size: 0.65rem;
        cursor: pointer;
    }

    .hint {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;

        font-size: 0.65rem;
        font-weight: 400;
        letter-spacing: 0.02em;
        opacity: 0.45;
    }

    .triggerHint {
        margin: 0;
        padding: 0 8px 5px;

        font-size: 0.6rem;
        font-weight: 400;
        line-height: 1.3;
        color: var(--text);
        opacity: 0.45;
    }

    .editor {
        flex: 1;
        min-height: 0;
        overflow: hidden;
    }

    .editor :global(.cm-editor) {
        height: 100%;
        background: transparent;
    }

    .editor :global(.cm-scroller) {
        overflow: auto;
    }

    .help {
        position: absolute;
        inset: 34px 0 0;
        z-index: 5;
        padding: 10px 12px 12px;
        overflow-y: auto;

        background: var(--primary-darkest);
        border-top: 1px solid var(--primary-lighter);
        color: var(--text);

        font-size: 0.68rem;
        font-weight: 400;
        line-height: 1.45;
    }

    .help h4 {
        margin: 0 0 8px;

        color: var(--secondary);
        font-size: 0.8rem;
    }

    .help p {
        margin: 0 0 8px;
        opacity: 0.8;
    }

    .help code {
        padding: 0 3px;

        background: rgb(255 255 255 / 0.08);
        border-radius: 3px;
        font-size: 0.92em;
    }

    .help .helpTip {
        opacity: 0.55;
    }

    .helpClose {
        position: absolute;
        top: 5px;
        right: 7px;
        width: 20px;
        height: 20px;
        padding: 0;

        background: transparent;
        color: var(--text);
        border: none;
        border-radius: 50%;

        font-size: 1rem;
        line-height: 1;
        cursor: pointer;
        opacity: 0.6;
    }

    .helpClose:hover {
        opacity: 1;
    }
</style>
