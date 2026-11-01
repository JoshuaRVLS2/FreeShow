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
    import { cssLibrary, deleteCSSLibraryItem, saveCSSLibraryItem, type CSSLibraryContext, type CSSLibraryItem } from "./cssLibrary"

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
    let libraryOpen = false
    let saveName = ""
    let libraryNotice = ""
    let noticeTimeout: ReturnType<typeof setTimeout> | null = null

    $: trigger = getStyles(value)["--fs-trigger"] || "mount"
    $: triggerHint = trigger === "slide" ? "Replays each time this slide becomes active." : trigger === "click" ? "Replays when Click reveal shows this item." : "Plays once, when this element is created."
    $: editorContext = (showTrigger ? "item" : "text") as CSSLibraryContext
    $: libraryItems = $cssLibrary.filter((a) => a.context === editorContext)

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

    function toggleLibrary() {
        libraryOpen = !libraryOpen
    }

    function clearNoticeTimeout() {
        if (!noticeTimeout) return
        clearTimeout(noticeTimeout)
        noticeTimeout = null
    }

    function saveCurrent() {
        if (!view) return

        const saved = saveCSSLibraryItem(saveName, view.state.doc.toString(), editorContext)
        if (!saved) return

        saveName = ""
        libraryNotice = `Saved "${saved.name}"`
        clearNoticeTimeout()
        noticeTimeout = setTimeout(() => (libraryNotice = ""), 2200)
    }

    function insertLibrary(item: CSSLibraryItem) {
        if (!view) return

        const doc = view.state.doc.toString()
        const snippet = item.css.trim()
        const insert = (doc.trim() ? "\n\n" : "") + snippet
        const position = doc.length

        view.dispatch({
            changes: { from: position, insert },
            selection: { anchor: position + insert.length }
        })
        view.focus()
        commit()
        libraryOpen = false
    }

    function removeLibrary(id: string) {
        deleteCSSLibraryItem(id)
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
                    placeholder("& { ... }"),
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
        clearNoticeTimeout()
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
        </div>
    </div>

    <div class="toolbar">
        <button class="toolButton" type="button" title="Saved styles" aria-label="Saved styles" aria-expanded={libraryOpen} aria-controls="css-library" on:click={toggleLibrary}>My styles{libraryItems.length ? ` (${libraryItems.length})` : ""}</button>

        <span class="hint" title="&amp; is this element. Every other selector is scoped inside it, so it cannot style the rest of the app.">&amp; = this element</span>
    </div>

    {#if showTrigger}
        <p class="triggerHint">{triggerHint}</p>
    {/if}

    <div class="editor" bind:this={host} />

    {#if libraryOpen}
        <div id="css-library" class="library" role="dialog" aria-label="My styles">
            <button class="helpClose" type="button" aria-label="Close saved styles" on:click={() => (libraryOpen = false)}>×</button>
            <h4>My styles</h4>
            <p class="libraryHint">Save this CSS once, then insert it into another {editorContext === "item" ? "item" : "text selection"}. Stored on this device.</p>

            <div class="saveRow">
                <input class="saveName" type="text" bind:value={saveName} placeholder="Style name" maxlength="60" aria-label="Style name" />
                <button class="toolButton" type="button" on:click={saveCurrent} disabled={!value.trim()}>Save current</button>
            </div>

            {#if libraryNotice}<p class="libraryNotice">{libraryNotice}</p>{/if}

            {#if libraryItems.length}
                <ul class="libraryList">
                    {#each libraryItems as item (item.id)}
                        <li>
                            <span class="libraryName" title={item.css}>{item.name}</span>
                            <button class="toolButton" type="button" on:click={() => insertLibrary(item)}>Insert</button>
                            <button class="libraryDelete" type="button" aria-label="Delete {item.name}" title="Delete" on:click={() => removeLibrary(item.id)}>×</button>
                        </li>
                    {/each}
                </ul>
            {:else}
                <p class="libraryEmpty">Nothing saved yet. Name the CSS in this box and save it to reuse it anywhere.</p>
            {/if}
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

    .toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        padding: 0 8px 4px;
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

    .library {
        position: absolute;
        inset: 34px 0 0;
        z-index: 6;
        padding: 10px 12px 12px;
        overflow-y: auto;

        background: var(--primary-darkest);
        border-top: 1px solid var(--primary-lighter);
        color: var(--text);

        font-size: 0.68rem;
        font-weight: 400;
        line-height: 1.45;
    }

    .library h4 {
        margin: 0 0 4px;

        color: var(--secondary);
        font-size: 0.8rem;
    }

    .libraryHint,
    .libraryEmpty {
        margin: 0 0 8px;
        opacity: 0.5;
    }

    .saveRow {
        display: flex;
        gap: 6px;
        margin-bottom: 8px;
    }

    .saveName {
        flex: 1;
        min-width: 0;
        padding: 3px 6px;

        background: var(--primary-darker);
        color: var(--text);
        border: 1px solid var(--primary-lighter);
        border-radius: 3px;

        font: inherit;
    }

    .saveName:focus {
        outline: none;
        border-color: var(--secondary);
    }

    .libraryNotice {
        margin: 0 0 6px;
        color: var(--secondary);
    }

    .libraryList {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin: 0;
        padding: 0;

        list-style: none;
    }

    .libraryList li {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px 0;

        border-bottom: 1px solid rgb(255 255 255 / 0.06);
    }

    .libraryName {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
    }

    .libraryDelete {
        width: 20px;
        padding: 0;

        background: transparent;
        color: var(--text);
        border: 1px solid transparent;
        border-radius: 3px;

        font: inherit;
        line-height: 18px;
        cursor: pointer;
        opacity: 0.5;
    }

    .libraryDelete:hover {
        color: var(--secondary);
        opacity: 1;
    }

    .toolButton:disabled {
        cursor: default;
        opacity: 0.4;
    }
</style>
