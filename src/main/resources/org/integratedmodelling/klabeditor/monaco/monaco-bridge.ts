// Typescript bridge for Monaco editor embedded in JavaFX WebView
// This file is accompanied by a compiled JS version: monaco-bridge.js
// The Java side exposes window.JavaBridge (see MonacoEditorView). We expose window.MonacoBridge
// which Java calls to control the editor.
// Typescript bridge for Monaco editor embedded in JavaFX WebView
declare const monaco: any;

interface MonacoOpenDoc {
    uri: string;
    text: string;
    language?: string;
    theme?: string;
    highlighterServiceUrl?: string;
}

interface MonacoBridgeApi {
    // New preferred API
    openDocument(doc: MonacoOpenDoc): void;

    // Backwards compatible (optional) - can remove later
    init(text: string, language?: string, theme?: string): void;

    setText(text: string): void;

    getText(): string;

    setCursorPosition(offset: number): void;
    focusEditor(): void;

    setLineNumbers(show: boolean): void;

    isLineNumbersVisible(): boolean;

    setReviewMode(enabled: boolean): void;

    isReviewMode(): boolean;

    setReviewMarkers(markers: ReviewMarker[]): void;

    clearReviewMarkers(): void;

    // Diagnostics API (replaces window.kim_setDiagnostics)
    setDiagnostics(markers: any[]): void;

    clearDiagnostics(): void;

    clearMarkers(): void;

    createMarker(line: number, message: string, severity?: 'info' | 'warning' | 'error' | 'hint'): void;

    createMarkerByOffset(offset: number, length: number, message: string, severity?: 'info' | 'warning' | 'error' | 'hint'): void;

    configureHighlighter(serviceUrl: string): void;

    preloadConceptHighlighterCache(concepts: any): void;

    preloadKeywordHighlighterCache(keywords: any): void;

    connectLsp(wsUrl: string, languageId?: string): Promise<boolean>; // unused in klab-ide integration
    _onAmdReady(container: HTMLElement): void;

    _notifyJavaReady(): boolean;
}

interface ReviewMarker {
    id: string;
    lineNumber: number;
    icon?: string;
    color?: string;
    size?: number;
    tooltip?: string;
    action?: string;
    responsibility?: string;
}

function logError(context: string, e: any) {
    try {
        console.error(`[MonacoBridge] ${context}`, e);
    } catch {
    }
}

function logWarn(msg: string) {
    try {
        console.warn(`[MonacoBridge] ${msg}`);
    } catch {
    }
}

function logInfo(msg: string) {
    try {
        console.log(`[MonacoBridge] ${msg}`);
    } catch {
    }
}

function isCopyCutPaste(e: any) {
    const isCtrl = !!(e.ctrlKey || e.metaKey);
    if (!isCtrl) return null;

    switch (e.keyCode) {
        case monaco.KeyCode.KeyC:
            return "copy";
        case monaco.KeyCode.KeyX:
            return "cut";
        case monaco.KeyCode.KeyV:
            return "paste";
        default:
            return null;
    }
}


(function () {
    const OWNER_DIAGNOSTICS = "kim-lsp";
    const OWNER_MARKERS = "java-bridge";
    const DEFAULT_HIGHLIGHTER_SERVICE_URL = "http://localhost:8765";

    type KlabLanguageName = "kim" | "kactor" | "worldview" | "observation";

    interface KlabLanguageSpec {
        name: KlabLanguageName;
        id: string;
        aliases: string[];
        extensions: string[];
    }

    const KLAB_LANGUAGES: KlabLanguageSpec[] = [
        {name: "kim", id: "org.integratedmodelling.languages.Kim", aliases: ["k.IM", "kim"], extensions: [".kim"]},
        {
            name: "kactor",
            id: "org.integratedmodelling.languages.KActors",
            aliases: ["k.Actors", "kactor"],
            extensions: [".kactor"]
        },
        {
            name: "worldview",
            id: "org.integratedmodelling.languages.Worldview",
            aliases: ["k.Worldview", "worldview", "kwv"],
            extensions: [".kwv"]
        },
        {
            name: "observation",
            id: "org.integratedmodelling.languages.Observation",
            aliases: ["k.Observation", "observation"],
            extensions: [".obs", ".observation"]
        }
    ];

    const COLOR_RGB: { [name: string]: number[] } = {
        DOMAIN: [105, 255, 254],
        CONFIGURATION: [0, 100, 100],
        EVENT: [153, 153, 0],
        EXTENT: [0, 153, 153],
        PROCESS: [204, 0, 0],
        QUALITY: [0, 204, 0],
        RELATIONSHIP: [210, 170, 0],
        TRAIT: [0, 102, 204],
        ROLE: [0, 86, 163],
        SUBJECT: [153, 76, 0],
        LIVE_URN: [0, 102, 0],
        INACTIVE_URN: [255, 215, 0],
        ERROR: [255, 0, 0],
        UNKNOWN: [128, 128, 128],
        INACTIVE: [160, 160, 160],
        VERSION: [0, 153, 153],
        KEYWORD: [85, 6, 22],
        VALUE_OPERATOR: [0, 0, 0],
        UNARY_OPERATOR: [0, 0, 0],
        BINARY_OPERATOR: [0, 0, 0],
        SEMANTIC_MODIFIER: [0, 0, 0]
    };

    // Keep the light palette above stable. These values are only used by the dark theme;
    // each color preserves the hue of its light-theme counterpart while increasing contrast.
    const DARK_COLOR_RGB: { [name: string]: number[] } = {
        DOMAIN: [103, 232, 231],
        CONFIGURATION: [92, 200, 200],
        EVENT: [230, 214, 106],
        EXTENT: [104, 217, 217],
        PROCESS: [255, 133, 133],
        QUALITY: [120, 224, 143],
        RELATIONSHIP: [241, 207, 112],
        TRAIT: [114, 174, 245],
        ROLE: [115, 169, 237],
        SUBJECT: [224, 160, 110],
        LIVE_URN: [105, 201, 138],
        INACTIVE_URN: [255, 229, 138],
        ERROR: [255, 123, 123],
        UNKNOWN: [196, 196, 196],
        INACTIVE: [192, 192, 192],
        VERSION: [112, 217, 217],
        KEYWORD: [255, 157, 181],
        VALUE_OPERATOR: [212, 212, 212],
        UNARY_OPERATOR: [212, 212, 212],
        BINARY_OPERATOR: [212, 212, 212],
        SEMANTIC_MODIFIER: [212, 212, 212]
    };

    const TOKEN_COLORS: { [token: string]: string } = {};
    const registeredLanguages: { [id: string]: boolean } = {};
    const keywordCache: { [name: string]: string[] } = {};
    const conceptCategoryCache: { [concept: string]: string } = {};
    const urnStatusCache: { [urn: string]: string } = {};

    const conceptPattern = /\b[a-z]+(?:\.[a-z]+)*:[A-Z][A-Za-z0-9]*\b/g;
    const conceptExactPattern = /^[a-z]+(?:\.[a-z]+)*:[A-Z][A-Za-z0-9]*$/;
    const urnPattern = /\b[a-z_][a-z0-9_]*(?:\.[a-z0-9_]+)*:[a-z_][a-z0-9_]*(?:\.[a-z0-9_]+)*:[a-z_][a-z0-9_]*(?:\.[a-z0-9_]+)*:[a-z_][a-z0-9_]*(?:\.[a-z0-9_]+)*(?:#[A-Za-z_][A-Za-z0-9_]*(?:=[^,\s\]\)\};]+)?(?:,[A-Za-z_][A-Za-z0-9_]*(?:=[^,\s\]\)\};]+)?)*)?/g;

    const state: {
        editor: any | null,
        container: HTMLElement | null,
        ready: boolean,
        showLineNumbers: boolean,
        reviewMode: boolean,
        reviewMarkers: ReviewMarker[],
        reviewDecorationIds: string[],
        reviewMarkerByClass: { [className: string]: ReviewMarker },
        reviewStyleElement?: HTMLStyleElement | null,
        pendingCalls: Array<() => void>,
        savedVersionId: number,
        dirty: boolean,
        highlighterServiceUrl: string,
        activeLanguageSpec?: KlabLanguageSpec | null,
        semanticDecorationIds: string[],
        semanticScanTimer?: number | null,
        _contentDisposable?: any,
        _wheelNormalizerInstalled?: boolean,
        _currentUri?: any | null
    } = {
        editor: null,
        container: null,
        ready: false,
        showLineNumbers: true,
        reviewMode: false,
        reviewMarkers: [],
        reviewDecorationIds: [],
        reviewMarkerByClass: {},
        reviewStyleElement: null,
        pendingCalls: [],
        savedVersionId: 0,
        dirty: false,
        highlighterServiceUrl: DEFAULT_HIGHLIGHTER_SERVICE_URL,
        activeLanguageSpec: null,
        semanticDecorationIds: [],
        semanticScanTimer: null,
        _contentDisposable: null as any,
        _wheelNormalizerInstalled: false,
        _currentUri: null
    };

    function flush() {
        while (state.pendingCalls.length) {
            try {
                (state.pendingCalls.shift()!)();
            } catch (e) {
                console.error(e);
            }
        }
    }

    function ensureReady(f: () => void) {
        if (state.ready) f(); else state.pendingCalls.push(f);
    }

    function notifyJavaReady(): boolean {
        if (!state.ready) {
            return false;
        }
        try {
            const bridge = (window as any).JavaBridge;
            if (!bridge || typeof bridge.onEditorReady !== "function") {
                logWarn("JavaBridge not available at AMD ready");
                return false;
            }
            bridge.onEditorReady();
            logInfo("JavaBridge.onEditorReady() called (AMD ready)");
            return true;
        } catch (e) {
            logWarn("JavaBridge.onEditorReady failed at AMD ready");
            return false;
        }
    }

    function notifyJavaRendered(): void {
        const notify = () => {
            try {
                (window as any).JavaBridge?.onEditorRendered?.();
            } catch (e) {
                logWarn("JavaBridge.onEditorRendered failed");
            }
        };

        // The second frame runs after the browser has had an opportunity to paint the document.
        const nextFrame = window.requestAnimationFrame;
        if (nextFrame) {
            nextFrame(() => nextFrame(notify));
        } else {
            window.setTimeout(notify, 0);
        }
    }

    function attachContentChanged(model: any) {
        try {
            if (state._contentDisposable?.dispose) {
                state._contentDisposable.dispose();
            }
        } catch {
        }

        try {
            state._contentDisposable = model.onDidChangeContent(() => {
                try {
                    const val = model.getValue?.() || '';
                    (window as any).JavaBridge?.onContentChanged?.(val);
                    scheduleSemanticHighlight();
                } catch (e) {
                    console.error("[MonacoBridge] onContentChanged failed", e);
                }
            });
            logInfo("Bound onContentChanged to active model");
        } catch (e) {
            logError("Failed binding onDidChangeContent", e);
        }
    }


    function toSeverity(s?: string) {
        const m = (s || 'info').toLowerCase();
        switch (m) {
            case 'error':
                return monaco.MarkerSeverity.Error;
            case 'warning':
                return monaco.MarkerSeverity.Warning;
            case 'hint':
                return monaco.MarkerSeverity.Hint;
            case 'info':
            default:
                return monaco.MarkerSeverity.Info;
        }
    }

    function addMarker(model: any, marker: any) {
        const markers = monaco.editor.getModelMarkers({
            owner: OWNER_MARKERS,
            resource: model.uri
        });
        monaco.editor.setModelMarkers(model, OWNER_MARKERS, [...markers, marker]);
    }

    function cssColor(value?: string): string {
        const fallback = '#4f8cff';
        if (!value) return fallback;
        try {
            const probe = document.createElement('span');
            probe.style.color = '';
            probe.style.color = value;
            return probe.style.color || fallback;
        } catch {
            return fallback;
        }
    }

    function cssString(value: string): string {
        return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
            .replace(/\r/g, '').replace(/\n/g, '\\A ') + '"';
    }

    function reviewClass(index: number): string {
        return `klab-review-marker-${index}`;
    }

    function renderReviewMarkers(): void {
        if (!state.editor) return;

        const previous = state.reviewDecorationIds;
        state.reviewMarkerByClass = {};
        const decorations: any[] = [];
        const rules: string[] = [];

        if (state.reviewMode) {
            const model = state.editor.getModel?.();
            const lastLine = Math.max(1, model?.getLineCount?.() || 1);
            state.reviewMarkers.forEach((marker, index) => {
                const className = reviewClass(index);
                const size = Math.max(8, Math.min(32, Math.floor(Number(marker.size) || 16)));
                const icon = marker.icon == null || marker.icon === '' ? '●' : String(marker.icon);
                state.reviewMarkerByClass[className] = marker;
                rules.push(`.${className}::before{content:${cssString(icon)};color:${cssColor(marker.color)};font-size:${size}px;line-height:1;}`);
                decorations.push({
                    range: new monaco.Range(Math.min(marker.lineNumber, lastLine), 1,
                        Math.min(marker.lineNumber, lastLine), 1),
                    options: {
                        isWholeLine: true,
                        glyphMarginClassName: `klab-review-marker ${className}`,
                        glyphMarginHoverMessage: marker.tooltip ? {value: String(marker.tooltip)} : undefined,
                        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
                    }
                });
            });
        }

        if (!state.reviewStyleElement) {
            state.reviewStyleElement = document.createElement('style');
            state.reviewStyleElement.id = 'klab-review-marker-styles';
            document.head.appendChild(state.reviewStyleElement);
        }
        state.reviewStyleElement.textContent = '.klab-review-marker{display:flex!important;align-items:center;justify-content:center;cursor:pointer;}' + rules.join('');
        state.reviewDecorationIds = state.editor.deltaDecorations(previous, decorations);
    }

    function installReviewMarkerClickHandler(): void {
        state.editor.onMouseDown((event: any) => {
            if (!state.reviewMode || event?.target?.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
            let element: HTMLElement | null = event.target.element || null;
            let marker: ReviewMarker | undefined;
            while (element && !marker) {
                for (let i = 0; i < element.classList.length; i++) {
                    marker = state.reviewMarkerByClass[element.classList.item(i) || ''];
                    if (marker) break;
                }
                element = element.parentElement;
            }
            if (!marker) return;
            try {
                (window as any).JavaBridge?.onReviewMarkerClicked?.(
                    marker.id, marker.lineNumber, marker.action || null, marker.responsibility || null);
            } catch (e) {
                logError('Review marker click callback failed', e);
            }
        });
    }

    function rgb(name: string): string {
        const value = COLOR_RGB[(name || "").toUpperCase()] || COLOR_RGB.UNKNOWN;
        return "#" + value.map((part) => {
            const hex = Math.max(0, Math.min(255, part)).toString(16);
            return hex.length === 1 ? "0" + hex : hex;
        }).join("");
    }

    function darkRgb(name: string): string {
        const value = DARK_COLOR_RGB[(name || "").toUpperCase()] || DARK_COLOR_RGB.UNKNOWN;
        return "#" + value.map((part) => {
            const hex = Math.max(0, Math.min(255, part)).toString(16);
            return hex.length === 1 ? "0" + hex : hex;
        }).join("");
    }

    function tokenName(name: string): string {
        return "klab-" + (name || "unknown").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    }

    function normalizeLanguage(language?: string): KlabLanguageSpec | null {
        const value = (language || "").toLowerCase();
        if (!value) return null;
        for (const spec of KLAB_LANGUAGES) {
            if (value === spec.name || value === spec.id.toLowerCase()) return spec;
            if (spec.aliases.some((alias) => value === alias.toLowerCase())) return spec;
            if (spec.extensions.some((extension) => value.endsWith(extension.toLowerCase()))) return spec;
        }
        return null;
    }

    function serviceUrl(path: string): string {
        const base = (state.highlighterServiceUrl || DEFAULT_HIGHLIGHTER_SERVICE_URL).replace(/\/+$/, "");
        return base + path;
    }

    function installKlabTheme(baseTheme: string) {
        const rules: any[] = [
            {token: "klab.keyword", foreground: rgb("KEYWORD").substring(1), fontStyle: "bold"},
            // Metadata keys are intentionally muted and must not inherit keyword styling.
            {token: "klab.metadata", foreground: "808080"},
            {token: "klab.comment", foreground: "4ea64e", fontStyle: "italic"},
            {token: "klab.doccomment", foreground: "0000a0"},
            {token: "klab.operator", foreground: rgb("VALUE_OPERATOR").substring(1)},
            {token: "klab.number", foreground: "098658"},
            {token: "klab.string", foreground: "014732"},
            {token: "klab.delimiter", foreground: "000000"}
        ];

        for (const name in COLOR_RGB) {
            const token = "klab." + tokenName(name);
            TOKEN_COLORS[tokenName(name)] = rgb(name);
            rules.push({token, foreground: rgb(name).substring(1)});
        }

        // Monarch appends tokenPostfix to emitted tokens. Keep an exact keyword rule
        // after the generated category rules so keyword styling remains unambiguous.
        rules.push({token: "klab.keyword.klab", foreground: rgb("KEYWORD").substring(1), fontStyle: "bold"});

        const darkRules = rules.map((rule) => {
            switch (rule.token) {
                case "klab.keyword":
                    return {...rule, foreground: darkRgb("KEYWORD").substring(1)};
                case "klab.metadata":
                    return {...rule, foreground: "b0b0b0"};
                case "klab.comment":
                    return {...rule, foreground: "7fd18b"};
                case "klab.doccomment":
                    return {...rule, foreground: "8fb4ff"};
                case "klab.operator":
                case "klab.delimiter":
                    return {...rule, foreground: "d4d4d4"};
                case "klab.number":
                    return {...rule, foreground: "8bd5ff"};
                case "klab.string":
                    return {...rule, foreground: "a8e6a3"};
                default:
                    if (rule.token.indexOf("klab.klab-") === 0) {
                        const colorName = rule.token.substring("klab.klab-".length).toUpperCase();
                        return {...rule, foreground: darkRgb(colorName).substring(1)};
                    }
                    return rule;
            }
        });
        darkRules.push({token: "klab.keyword.klab", foreground: darkRgb("KEYWORD").substring(1), fontStyle: "bold"});

        try {
            monaco.editor.defineTheme("klab-vs", {
                base: "vs",
                inherit: true,
                rules,
                colors: {}
            });
            monaco.editor.defineTheme("klab-vs-dark", {
                base: "vs-dark",
                inherit: true,
                rules: darkRules,
                colors: {}
            });
        } catch (e) {
            logWarn("Failed to define k.LAB themes");
        }
    }

    function klabThemeName(theme: string): string {
        return (theme || "").toLowerCase().indexOf("dark") >= 0 ? "klab-vs-dark" : "klab-vs";
    }

    function createKlabMonarch(keywords: string[]) {
        return {
            defaultToken: "",
            tokenPostfix: ".klab",
            keywords: keywords || [],
            operators: [
                "=", ">", "<", "!", "~", "?", ":", "==", "<=", ">=", "!=", "&&", "||", "++", "--",
                "+", "-", "*", "/", "&", "|", "^", "%", "<<", ">>", ">>>", "+=", "-=", "*=", "/=",
                "&=", "|=", "^=", "%=", "<<=", ">>=", ">>>="
            ],
            symbols: /[=><!~?:&|+\-*\/\^%]+/,
            escapes: /\\(?:[btnfr"'\\]|u[0-9A-Fa-f]{4})/,
            tokenizer: {
                root: [
                    [/\/\*\*\*/, "klab.doccomment", "@doccomment"],
                    [/\/\*/, "klab.comment", "@comment"],
                    [/\/\/.*$/, "klab.comment"],
                    [/"/, "klab.string", "@string_double"],
                    [/'/, "klab.string", "@string_single"],
                    [/\d*\.\d+([eE][\-+]?\d+)?[fFdD]?/, "klab.number.float"],
                    [/0[xX][0-9a-fA-F]+[lL]?/, "klab.number.hex"],
                    [/\d+[lL]?/, "klab.number"],
                    [/[a-z]+(?:\.[a-z]+)*:[A-Z][A-Za-z0-9]*/, "klab." + tokenName("UNKNOWN")],
                    [/[a-z_][a-z0-9_]*(?:\.[a-z0-9_]+)*:[a-z_][a-z0-9_]*(?:\.[a-z0-9_]+)*:[a-z_][a-z0-9_]*(?:\.[a-z0-9_]+)*:[a-z_][a-z0-9_]*(?:\.[a-z0-9_]+)*(?:#[A-Za-z_][A-Za-z0-9_]*(?:=[^,\s\]\)\};]+)?(?:,[A-Za-z_][A-Za-z0-9_]*(?:=[^,\s\]\)\};]+)?)*)?/, "klab." + tokenName("UNKNOWN")],
                    // Consume the complete metadata key before identifier/keyword rules run.
                    [/[:+!][a-z][a-z0-9_]*/, "klab.metadata"],
                    [/[a-zA-Z_$][\w$]*/, {cases: {"@keywords": "klab.keyword", "@default": "identifier"}}],
                    [/@symbols/, {cases: {"@operators": "klab.operator", "@default": ""}}],
                    [/\[/, "@brackets", "@groovy"],
                    [/===/, "klab.delimiter"],
                    [/\{\{/, "klab.delimiter"],
                    [/\}\}/, "klab.delimiter"],
                    [/[{}()]/, "@brackets"],
                    [/[;,.]/, "klab.delimiter"]
                ],
                comment: [
                    [/[^\/*]+/, "klab.comment"],
                    [/\*\//, "klab.comment", "@pop"],
                    [/[\/*]/, "klab.comment"]
                ],
                doccomment: [
                    [/[^\/*]+/, "klab.doccomment"],
                    [/\*\//, "klab.doccomment", "@pop"],
                    [/[\/*]/, "klab.doccomment"]
                ],
                string_double: [
                    [/[^\\"]+/, "klab.string"],
                    [/@escapes/, "klab.string.escape"],
                    [/\\./, "klab.string.escape.invalid"],
                    [/"/, "klab.string", "@pop"]
                ],
                string_single: [
                    [/[^\\']+/, "klab.string"],
                    [/@escapes/, "klab.string.escape"],
                    [/\\./, "klab.string.escape.invalid"],
                    [/'/, "klab.string", "@pop"]
                ],
                groovy: [
                    [/[^\]]+/, ""],
                    [/\]/, "@brackets", "@pop"]
                ]
            }
        };
    }

    async function fetchJson(path: string): Promise<any> {
        try {
            const response = await fetch(serviceUrl(path), {cache: "no-store"});
            if (!response.ok) return null;
            return await response.json();
        } catch (e) {
            return null;
        }
    }

    function normalizeKeywordPayload(payload: any): string[] {
        if (!payload) return [];
        if (Array.isArray(payload)) return payload.filter((x) => typeof x === "string");
        if (Array.isArray(payload.keywords)) return payload.keywords.filter((x: any) => typeof x === "string");
        return [];
    }

    function cacheKeywords(language: any, payload: any, changed: string[]) {
        const spec = normalizeLanguage(String(language || ""));
        if (!spec) return;

        const seen: { [keyword: string]: boolean } = {};
        const keywords = normalizeKeywordPayload(payload).filter((keyword) => {
            if (!keyword || seen[keyword]) return false;
            seen[keyword] = true;
            return true;
        });

        keywordCache[spec.name] = keywords;
        changed.push(spec.name);
    }

    function preloadKeywordCache(payload: any): string[] {
        const changed: string[] = [];
        if (!payload) return changed;

        if (Array.isArray(payload)) {
            if (state.activeLanguageSpec) {
                cacheKeywords(state.activeLanguageSpec.name, payload, changed);
            }
            return changed;
        }

        if (typeof payload === "object") {
            if (typeof payload.language === "string" && Array.isArray(payload.keywords)) {
                cacheKeywords(payload.language, payload.keywords, changed);
                return changed;
            }

            for (const language in payload) {
                if (!Object.prototype.hasOwnProperty.call(payload, language)) continue;
                cacheKeywords(language, payload[language], changed);
            }
        }

        return changed;
    }

    function refreshActiveKeywordTokenization(changed: string[]) {
        if (!changed.length) return;
        ensureReady(() => {
            const spec = state.activeLanguageSpec;
            if (!spec || changed.indexOf(spec.name) < 0) return;

            registerKlabLanguage(spec, keywordCache[spec.name] || []);
            const model = state.editor?.getModel?.();
            if (model) {
                try {
                    monaco.editor.setModelLanguage(model, spec.id);
                } catch {
                }
            }
        });
    }

    async function loadKeywords(spec: KlabLanguageSpec): Promise<string[]> {
        if (Object.prototype.hasOwnProperty.call(keywordCache, spec.name)) return keywordCache[spec.name];
        const payload = await fetchJson("/" + encodeURIComponent(spec.name) + "/keywords");
        const keywords = normalizeKeywordPayload(payload);
        keywordCache[spec.name] = keywords;
        return keywords;
    }

    function registerKlabLanguage(spec: KlabLanguageSpec, keywords: string[]) {
        if (!registeredLanguages[spec.id]) {
            try {
                const existing = monaco.languages.getLanguages().some((language: any) => language.id === spec.id);
                registeredLanguages[spec.id] = !!existing;
            } catch {
            }
        }

        if (!registeredLanguages[spec.id]) {
            monaco.languages.register({
                id: spec.id,
                aliases: spec.aliases,
                extensions: spec.extensions
            });
            registeredLanguages[spec.id] = true;
        }

        monaco.languages.setMonarchTokensProvider(spec.id, createKlabMonarch(keywords));
        monaco.languages.setLanguageConfiguration(spec.id, {
            comments: {lineComment: "//", blockComment: ["/*", "*/"]},
            brackets: [["{{", "}}"], ["{", "}"], ["[", "]"], ["(", ")"]],
            autoClosingPairs: [
                {open: "===", close: "==="},
                {open: "{{", close: "}}"},
                {open: "{", close: "}"},
                {open: "[", close: "]"},
                {open: "(", close: ")"},
                {open: "\"", close: "\""},
                {open: "'", close: "'"}
            ],
            surroundingPairs: [
                {open: "===", close: "==="},
                {open: "{{", close: "}}"},
                {open: "{", close: "}"},
                {open: "[", close: "]"},
                {open: "(", close: ")"},
                {open: "\"", close: "\""},
                {open: "'", close: "'"}
            ]
        });
    }

    async function ensureKlabLanguage(language: string): Promise<KlabLanguageSpec | null> {
        const spec = normalizeLanguage(language);
        if (!spec) return null;
        registerKlabLanguage(spec, keywordCache[spec.name] || []);
        const keywords = await loadKeywords(spec);
        registerKlabLanguage(spec, keywords);
        try {
            monaco.editor.tokenize("", spec.id);
        } catch {
        }
        return spec;
    }

    function installSemanticStyles() {
        if (document.getElementById("klab-semantic-style")) return;
        const style = document.createElement("style");
        style.id = "klab-semantic-style";
        let css = "";
        for (const name in COLOR_RGB) {
            const color = rgb(name);
            css += `.monaco-editor .${tokenName(name)}{color:${color} !important;}`;
            css += `.monaco-editor.vs-dark .${tokenName(name)}{color:${darkRgb(name)} !important;}`;
        }
        css += ".monaco-editor .klab-urn-online{color:#006600 !important;font-weight:bold;}";
        css += ".monaco-editor .klab-urn-offline{color:#606060 !important;font-weight:bold;}";
        css += ".monaco-editor .klab-urn-error{color:#ff0000 !important;}";
        css += ".monaco-editor .klab-urn-unknown{color:#808080 !important;font-style:italic;}";
        css += ".monaco-editor.vs-dark .klab-urn-online{color:#69c98a !important;}";
        css += ".monaco-editor.vs-dark .klab-urn-offline{color:#c0c0c0 !important;}";
        css += ".monaco-editor.vs-dark .klab-urn-error{color:#ff7b7b !important;}";
        css += ".monaco-editor.vs-dark .klab-urn-unknown{color:#c4c4c4 !important;}";
        style.textContent = css;
        document.head.appendChild(style);
    }

    async function conceptClass(concept: string): Promise<string> {
        if (!conceptCategoryCache[concept]) {
            // Required service endpoint: GET /concept/<URL-encoded concept> -> "QUALITY" or { "category": "QUALITY" }.
            const payload = await fetchJson("/concept/" + encodeURIComponent(concept));
            conceptCategoryCache[concept] = ((typeof payload === "string" ? payload : payload?.category) || "UNKNOWN").toUpperCase();
        }
        return tokenName(conceptCategoryCache[concept]);
    }

    function preloadConceptEntry(concept: string, category?: string | null): Promise<void> {
        if (!concept || !conceptExactPattern.test(concept)) {
            return Promise.resolve();
        }

        if (category && typeof category === "string") {
            conceptCategoryCache[concept] = category.toUpperCase();
            return Promise.resolve();
        }

        if (conceptCategoryCache[concept]) {
            return Promise.resolve();
        }

        return conceptClass(concept).then(() => undefined);
    }

    function preloadConceptCache(concepts: any): Promise<void[]> {
        const work: Promise<void>[] = [];
        if (!concepts) return Promise.resolve([]);

        if (Array.isArray(concepts)) {
            for (const item of concepts) {
                if (typeof item === "string") {
                    work.push(preloadConceptEntry(item, null));
                } else if (item && typeof item.concept === "string") {
                    work.push(preloadConceptEntry(item.concept, item.category || item.color || null));
                }
            }
            return Promise.all(work);
        }

        if (typeof concepts === "object") {
            for (const concept in concepts) {
                if (Object.prototype.hasOwnProperty.call(concepts, concept)) {
                    work.push(preloadConceptEntry(concept, concepts[concept]));
                }
            }
        }

        return Promise.all(work);
    }

    async function urnClass(urn: string): Promise<string> {
        const baseUrn = urn.split("#")[0];
        if (!urnStatusCache[baseUrn]) {
            // Required service endpoint: GET /urn/<URL-encoded URN-without-#suffix> -> "ONLINE" or { "status": "ONLINE" }.
            const payload = await fetchJson("/urn/" + encodeURIComponent(baseUrn));
            urnStatusCache[baseUrn] = ((typeof payload === "string" ? payload : payload?.status) || "UNKNOWN").toUpperCase();
        }
        switch (urnStatusCache[baseUrn]) {
            case "ONLINE":
                return "klab-urn-online";
            case "OFFLINE":
                return "klab-urn-offline";
            case "ERROR":
                return "klab-urn-error";
            case "UNKNOWN":
            default:
                return "klab-urn-unknown";
        }
    }

    function scheduleSemanticHighlight() {
        if (state.semanticScanTimer != null) {
            window.clearTimeout(state.semanticScanTimer);
        }
        state.semanticScanTimer = window.setTimeout(() => {
            state.semanticScanTimer = null;
            refreshSemanticHighlight();
        }, 250);
    }

    function squareBracketRanges(text: string): Array<{ start: number, end: number }> {
        const ranges: Array<{ start: number, end: number }> = [];
        const stack: number[] = [];
        for (let i = 0; i < text.length; i++) {
            const ch = text.charAt(i);
            if (ch === "[") {
                stack.push(i);
            } else if (ch === "]" && stack.length) {
                ranges.push({start: stack.pop()!, end: i + 1});
            }
        }
        return ranges;
    }

    function isInsideRange(offset: number, ranges: Array<{ start: number, end: number }>): boolean {
        for (const range of ranges) {
            if (offset >= range.start && offset < range.end) return true;
        }
        return false;
    }

    async function refreshSemanticHighlight() {
        const editor = state.editor;
        const model = editor?.getModel?.();
        if (!editor || !model || !state.activeLanguageSpec) return;

        const text = model.getValue() || "";
        const groovyRanges = squareBracketRanges(text);
        const decorations: any[] = [];
        const addDecoration = async (match: RegExpExecArray, cssClass: string | Promise<string>) => {
            const className = await cssClass;
            const start = model.getPositionAt(match.index);
            const end = model.getPositionAt(match.index + match[0].length);
            decorations.push({
                range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
                options: {inlineClassName: className}
            });
        };

        let match: RegExpExecArray | null;
        conceptPattern.lastIndex = 0;
        while ((match = conceptPattern.exec(text)) !== null) {
            if (isInsideRange(match.index, groovyRanges)) continue;
            await addDecoration(match, conceptClass(match[0]));
        }

        urnPattern.lastIndex = 0;
        while ((match = urnPattern.exec(text)) !== null) {
            if (isInsideRange(match.index, groovyRanges)) continue;
            await addDecoration(match, urnClass(match[0]));
        }

        state.semanticDecorationIds = editor.deltaDecorations(state.semanticDecorationIds, decorations);
    }

    function installWheelNormalizer() {
        if (state._wheelNormalizerInstalled) return;
        const ed: any = state.editor;
        if (!ed) return;
        const node: HTMLElement | null = (ed.getDomNode ? ed.getDomNode() : null) || state.container;
        if (!node) return;

        const handler = (ev: WheelEvent) => {
            try {
                if ((ev as any).ctrlKey || (ev as any).metaKey) return; // keep zoom behavior
                const deltaY = (ev as any).deltaY || 0;
                if (!deltaY) return;

                let lineHeight = 18;
                try {
                    const opt = (monaco as any).editor?.EditorOption?.lineHeight;
                    if (opt != null && ed.getOption) {
                        const value = ed.getOption(opt);
                        if (typeof value === "number" && value > 0) {
                            lineHeight = value;
                        }
                    }
                } catch {
                }
                try {
                    const options = ed.getRawOptions ? ed.getRawOptions() : null;
                    if (options && typeof options.lineHeight === "number" && options.lineHeight > 0) {
                        lineHeight = options.lineHeight;
                    }
                } catch {
                }

                const deltaMode = (ev as any).deltaMode;
                let deltaPixels: number;
                if (deltaMode === 2) {
                    deltaPixels = Math.sign(deltaY) * lineHeight * 3;
                } else if (deltaMode === 1) {
                    const maxLines = 6;
                    const lines = Math.max(-maxLines, Math.min(maxLines, deltaY));
                    deltaPixels = lines * lineHeight;
                } else {
                    const maxPixels = lineHeight * 6;
                    deltaPixels = Math.abs(deltaY) > maxPixels
                        ? Math.sign(deltaY) * lineHeight * 3
                        : deltaY;
                }

                ev.preventDefault();
                ev.stopPropagation();
                if ((ev as any).stopImmediatePropagation) {
                    (ev as any).stopImmediatePropagation();
                }

                const current = ed.getScrollTop ? ed.getScrollTop() : 0;
                if (ed.setScrollTop) {
                    ed.setScrollTop(current + deltaPixels);
                }
            } catch {
            }
        };

        const options: any = {passive: false, capture: true};
        try {
            node.addEventListener("wheel", handler, options);
        } catch {
            try {
                node.addEventListener("wheel", handler as any, true);
            } catch {
            }
        }
        if (state.container && state.container !== node) {
            try {
                state.container.addEventListener("wheel", handler, options);
            } catch {
                try {
                    state.container.addEventListener("wheel", handler as any, true);
                } catch {
                }
            }
        }
        try {
            document.addEventListener("wheel", handler, options);
        } catch {
            try {
                document.addEventListener("wheel", handler as any, true);
            } catch {
            }
        }

        state._wheelNormalizerInstalled = true;
    }

    function ensureEditorCreated(theme: string, language: string) {
        if (!state.container) {
            console.error('Monaco container not available');
            return;
        }
        if (state.editor) return;

        state.editor = monaco.editor.create(state.container, {
            value: '',
            language: language || 'plaintext',
            theme: theme || 'vs-dark',
            automaticLayout: true,
            lineNumbers: state.showLineNumbers ? 'on' : 'off',
            glyphMargin: state.reviewMode,
            mouseWheelScrollSensitivity: 1,
            fastScrollSensitivity: 1,
            smoothScrolling: true,
        });

        installReviewMarkerClickHandler();

        // Keep external reference (some Java code may still use it)
        try {
            (api as any).editor = state.editor;
        } catch {
        }

        // Cursor -> Java (if Java wants it)
        try {
            state.editor.onDidChangeCursorPosition((e: any) => {
                try {
                    const model = state.editor.getModel?.();
                    if (!model) return;
                    const offset = model.getOffsetAt(e.position);
                    (window as any).JavaBridge?.onCursorPositionChanged?.(offset);
                } catch {
                }
            });
        } catch {
        }

        // Content changes -> Java
//     try {
//       state.editor.onDidChangeModelContent(() => {
//         try {
//           const val = state.editor.getValue ? state.editor.getValue() : (state.editor.getModel?.()?.getValue?.() || '');
//           (window as any).JavaBridge?.onContentChanged?.(val);
//         } catch { }
//       });
//     } catch { }

        // Save keybinding
        try {
            state.editor.addCommand((monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS), () => {
                try {
                    const model = state.editor.getModel?.();
                    const textNow = model ? (model.getValue?.() || '') : (state.editor.getValue?.() || '');
                    (window as any).JavaBridge?.onSave?.(textNow);

                    if (model) {
                        state.savedVersionId = model.getAlternativeVersionId();
                        if (state.dirty) {
                            state.dirty = false;
                            (window as any).JavaBridge?.onDirtyChanged?.(false);
                        }
                    }
                } catch (e) {
                    logError("Copy command failed", e);
                }
            });
        } catch (e) {
            logError("Failed to register Copy command", e);
        }

        // Copy
        try {
            state.editor.addCommand((monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC), () => {
                try {
                    const model = state.editor.getModel?.();
                    if (!model) return;
                    const sels = state.editor.getSelections?.() || (state.editor.getSelection ? [state.editor.getSelection()] : []);
                    if (!sels || !sels.length) return;

                    const texts: string[] = [];
                    for (const sel of sels) {
                        if (!sel) continue;
                        const isEmpty = (sel.startLineNumber === sel.endLineNumber) && (sel.startColumn === sel.endColumn);
                        if (isEmpty) {
                            const line = sel.startLineNumber;
                            let t = model.getLineContent ? (model.getLineContent(line) || '') : '';
                            t = t + '\n';
                            texts.push(t);
                        } else {
                            texts.push(model.getValueInRange(sel) || '');
                        }
                    }
                    (window as any).JavaBridge?.setClipboardText?.(texts.join('\n'));
                } catch {
                }
            });
        } catch {
        }

        // Cut
        try {
            state.editor.addCommand((monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX), () => {
                try {
                    const model = state.editor.getModel?.();
                    if (!model) return;
                    const sels = state.editor.getSelections?.() || (state.editor.getSelection ? [state.editor.getSelection()] : []);
                    if (!sels || !sels.length) return;

                    const texts: string[] = [];
                    const edits: any[] = [];
                    for (const sel of sels) {
                        if (!sel) continue;
                        const isEmpty = (sel.startLineNumber === sel.endLineNumber) && (sel.startColumn === sel.endColumn);
                        if (isEmpty) {
                            const line = sel.startLineNumber;
                            const lineText = model.getLineContent ? (model.getLineContent(line) || '') : '';
                            texts.push(lineText + '\n');
                            const lineCount = model.getLineCount ? model.getLineCount() : 0;
                            if (line < lineCount) {
                                edits.push({
                                    range: {
                                        startLineNumber: line,
                                        startColumn: 1,
                                        endLineNumber: line + 1,
                                        endColumn: 1
                                    }, text: '', forceMoveMarkers: true
                                });
                            } else {
                                const maxCol = model.getLineMaxColumn ? model.getLineMaxColumn(line) : 1;
                                edits.push({
                                    range: {
                                        startLineNumber: line,
                                        startColumn: 1,
                                        endLineNumber: line,
                                        endColumn: maxCol
                                    }, text: '', forceMoveMarkers: true
                                });
                            }
                        } else {
                            texts.push(model.getValueInRange(sel) || '');
                            edits.push({range: sel, text: '', forceMoveMarkers: true});
                        }
                    }
                    (window as any).JavaBridge?.setClipboardText?.(texts.join('\n'));
                    if (edits.length) {
                        try {
                            state.editor.pushUndoStop?.();
                        } catch {
                        }
                        try {
                            state.editor.executeEdits?.('java-bridge', edits);
                        } catch {
                        }
                        try {
                            state.editor.pushUndoStop?.();
                        } catch {
                        }
                    }
                } catch {
                }
            });
        } catch {
        }

        // Paste
        try {
            state.editor.addCommand((monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV), () => {
                try {
                    const model = state.editor.getModel?.();
                    if (!model) return;
                    let text: string = '';
                    try {
                        text = (window as any).JavaBridge?.getClipboardText?.() || '';
                    } catch {
                        text = '';
                    }
                    const sels = state.editor.getSelections?.() || (state.editor.getSelection ? [state.editor.getSelection()] : []);
                    if (!sels || !sels.length) return;
                    const edits = sels.filter(Boolean).map((sel: any) => ({range: sel, text, forceMoveMarkers: true}));
                    if (edits.length) state.editor.executeEdits?.('java-bridge', edits);
                } catch {
                }
            });
        } catch {
        }

        // Fallback
        try {
            state.editor.onKeyDown((e: any) => {
                try {
                    const action = isCopyCutPaste(e);
                    if (!action) return;

                    const model = state.editor.getModel?.();
                    if (!model) return;

                    if (action === "copy") {
                        doCopy(model);
                    } else if (action === "cut") {
                        doCut(model);
                    } else if (action === "paste") {
                        doPaste(model);
                    }

                    e.preventDefault();
                    e.stopPropagation();
                } catch (err) {
                    console.error("[MonacoBridge] keydown clipboard failed", err);
                }
            });
        } catch (e) {
            console.error("[MonacoBridge] Failed to install keydown handler", e);
        }

        function doCopy(model: any) {
            const sels = state.editor.getSelections?.() || [];
            if (!sels.length) return;

            const texts: string[] = [];
            for (const sel of sels) {
                if (!sel) continue;
                const empty = sel.startLineNumber === sel.endLineNumber &&
                    sel.startColumn === sel.endColumn;
                if (empty) {
                    const line = sel.startLineNumber;
                    texts.push((model.getLineContent(line) || "") + "\n");
                } else {
                    texts.push(model.getValueInRange(sel) || "");
                }
            }
            console.log("[MonacoBridge] copied text:", texts.join("\\n"));
            (window as any).JavaBridge?.setClipboardText?.(texts.join("\n"));
        }

        function doCut(model: any) {
            doCopy(model);

            const sels = state.editor.getSelections?.() || [];
            if (!sels.length) return;

            const edits = sels.map((sel: any) => ({
                range: sel,
                text: "",
                forceMoveMarkers: true
            }));

            state.editor.executeEdits("java-bridge", edits);
        }

        function doPaste(model: any) {
            let text = "";
            try {
                text = (window as any).JavaBridge?.getClipboardText?.() || "";
            } catch {
            }

            if (!text) return;

            const sels = state.editor.getSelections?.() || [];
            if (!sels.length) return;

            const edits = sels.map((sel: any) => ({
                range: sel,
                text,
                forceMoveMarkers: true
            }));

            state.editor.executeEdits("java-bridge", edits);
        }

        installWheelNormalizer();
    }

    function attachDirtyTracking(model: any) {
        try {
            state.savedVersionId = model.getAlternativeVersionId();
            state.dirty = false;
            (window as any).JavaBridge?.onDirtyChanged?.(false);

            model.onDidChangeContent(() => {
                const newVersion = model.getAlternativeVersionId();
                const isDirty = newVersion !== state.savedVersionId;
                if (isDirty !== state.dirty) {
                    state.dirty = isDirty;
                    (window as any).JavaBridge?.onDirtyChanged?.(isDirty);
                }
            });
        } catch {
        }
    }

    // @ts-ignore
    const api: MonacoBridgeApi = {
        _onAmdReady(container: HTMLElement) {
            state.container = container;

            try {
                installKlabTheme("vs");
            } catch (e) {
                logError("Failed to install k.LAB themes", e);
            }
            try {
                installSemanticStyles();
            } catch (e) {
                logError("Failed to install k.LAB semantic styles", e);
            }
            state.ready = true;
            flush();
            notifyJavaReady();
        },

        _notifyJavaReady(): boolean {
            return notifyJavaReady();
        },

        openDocument(doc: MonacoOpenDoc) {
            ensureReady(async () => {
                try {
                    if (!doc || !doc.uri) {
                        logWarn("openDocument called without URI");
                        return;
                    }

                    logInfo(`Opening document ${doc.uri}`);

                    if (doc.highlighterServiceUrl) {
                        state.highlighterServiceUrl = doc.highlighterServiceUrl;
                    }

                    let language = doc.language || 'plaintext';
                    const theme = doc.theme || 'vs-dark';
                    const spec = normalizeLanguage(language);
                    state.activeLanguageSpec = spec;
                    if (spec) {
                        language = spec.id;
                        registerKlabLanguage(spec, keywordCache[spec.name] || []);
                        ensureKlabLanguage(language).then(() => {
                            const model = state.editor?.getModel?.();
                            if (model) {
                                try {
                                    monaco.editor.setModelLanguage(model, language);
                                } catch {
                                }
                                scheduleSemanticHighlight();
                            }
                        });
                    } else if (state.editor) {
                        state.semanticDecorationIds = state.editor.deltaDecorations(state.semanticDecorationIds, []);
                    }

                    ensureEditorCreated(klabThemeName(theme), language);

                    if (!state.editor) {
                        logError("Editor creation failed", null);
                        return;
                    }

                    const uri = monaco.Uri.parse(doc.uri);
                    const previousUri = state._currentUri?.toString?.();
                    const nextUri = uri.toString?.() || doc.uri;
                    const isSwitchingDocument = previousUri !== nextUri;
                    state._currentUri = uri;

                    let model = monaco.editor.getModel(uri);
                    if (!model) {
                        model = monaco.editor.createModel(doc.text || '', language, uri);
                        logInfo(`Created new model for ${doc.uri}`);
                    } else {
                        model.setValue(doc.text || '');
                        monaco.editor.setModelLanguage(model, language);
                        logInfo(`Reused existing model for ${doc.uri}`);
                    }

                    state.editor.setModel(model);
                    attachContentChanged(model);
                    renderReviewMarkers();

                    try {
                        monaco.editor.setTheme(spec ? klabThemeName(theme) : theme);
                    } catch (e) {
                        logWarn(`Failed to set theme ${theme}`);
                    }

                    if (isSwitchingDocument) {
                        try {
                            monaco.editor.setModelMarkers(model, "kim-lsp", []);
                        } catch (e) {
                            logWarn("Failed to clear diagnostics on openDocument");
                        }
                    }

                    attachDirtyTracking(model);
                    scheduleSemanticHighlight();
                    notifyJavaRendered();

                } catch (e) {
                    logError("openDocument failed", e);
                }
            });
        },

        // Backwards compatible - routes to openDocument with a synthetic URI
        init(text: string, language = 'plaintext', theme = 'vs-dark') {
            api.openDocument({
                uri: 'inmemory:///legacy',
                text: text || '',
                language,
                theme
            });
        },

        setText(text: string) {
            ensureReady(() => {
                const model = state.editor?.getModel?.();
                if (!model) return;
                model.setValue(text || '');

                // programmatic set => reset dirty baseline
                state.savedVersionId = model.getAlternativeVersionId();
                if (state.dirty) {
                    state.dirty = false;
                    (window as any).JavaBridge?.onDirtyChanged?.(false);
                }
            });
        },

        getText(): string {
            try {
                const model = state.editor?.getModel?.();
                if (model) return model.getValue() || '';
                return state.editor?.getValue ? (state.editor.getValue() || '') : '';
            } catch {
                return '';
            }
        },

        setCursorPosition(offset: number) {
            ensureReady(() => {
                const model = state.editor?.getModel?.();
                if (!model) return;
                const pos = model.getPositionAt(Math.max(0, Math.floor(offset || 0)));
                try {
                    state.editor.setPosition(pos);
                } catch {
                }
                try {
                    state.editor.revealPositionInCenter(pos);
                } catch {
                }
            });
        },

        focusEditor() {
            ensureReady(() => {
                try {
                    state.editor?.focus();
                } catch {
                }
            });
        },

        setLineNumbers(show: boolean) {
            state.showLineNumbers = !!show;
            ensureReady(() => {
                if (state.editor) state.editor.updateOptions({lineNumbers: state.showLineNumbers ? 'on' : 'off'});
            });
        },

        isLineNumbersVisible(): boolean {
            return !!state.showLineNumbers;
        },

        setReviewMode(enabled: boolean) {
            state.reviewMode = !!enabled;
            ensureReady(() => {
                if (!state.editor) return;
                state.editor.updateOptions({glyphMargin: state.reviewMode});
                renderReviewMarkers();
            });
        },

        isReviewMode(): boolean {
            return state.reviewMode;
        },

        setReviewMarkers(markers: ReviewMarker[]) {
            const seen: { [id: string]: boolean } = {};
            state.reviewMarkers = (markers || []).filter((marker) => {
                if (!marker || !marker.id || seen[marker.id]) {
                    if (marker?.id && seen[marker.id]) logWarn(`Ignoring duplicate review marker id ${marker.id}`);
                    return false;
                }
                seen[marker.id] = true;
                marker.lineNumber = Math.max(1, Math.floor(Number(marker.lineNumber) || 1));
                return true;
            });
            ensureReady(renderReviewMarkers);
        },

        clearReviewMarkers() {
            state.reviewMarkers = [];
            ensureReady(renderReviewMarkers);
        },

        // Diagnostics API
        setDiagnostics(markers: any[]) {
            ensureReady(() => {
                try {
                    const model = state.editor?.getModel?.();
                    if (!model) {
                        logWarn("setDiagnostics called but no model is active");
                        return;
                    }

                    logInfo(`Applying ${markers?.length ?? 0} diagnostics to ${model.uri?.toString()}`);

                    monaco.editor.setModelMarkers(model, "kim-lsp", markers || []);
                } catch (e) {
                    logError("Failed to apply diagnostics", e);
                }
            });
        },

        clearDiagnostics() {
            ensureReady(() => {
                const model = state.editor?.getModel?.();
                if (!model) return;
                monaco.editor.setModelMarkers(model, OWNER_DIAGNOSTICS, []);
            });
        },

        clearMarkers() {
            ensureReady(() => {
                const model = state.editor?.getModel?.();
                if (!model) return;
                monaco.editor.setModelMarkers(model, OWNER_MARKERS, []);
            });
        },

        createMarker(line: number, message: string, severity: 'info' | 'warning' | 'error' | 'hint' = 'info') {
            ensureReady(() => {
                const model = state.editor?.getModel?.();
                if (!model) return;
                const marker = {
                    startLineNumber: Math.max(1, Math.floor(line || 1)),
                    endLineNumber: Math.max(1, Math.floor(line || 1)),
                    startColumn: 1,
                    endColumn: 1,
                    message: message || '',
                    severity: toSeverity(severity)
                };
                addMarker(model, marker);
            });
        },

        createMarkerByOffset(offset: number, length: number, message: string, severity: 'info' | 'warning' | 'error' | 'hint' = 'info') {
            ensureReady(() => {
                const model = state.editor?.getModel?.();
                if (!model) return;
                const startPosition = model.getPositionAt(offset);
                const endPosition = model.getPositionAt(offset + length);
                const marker = {
                    startLineNumber: startPosition.lineNumber,
                    endLineNumber: endPosition.lineNumber,
                    startColumn: startPosition.column,
                    endColumn: endPosition.column,
                    message: message || '',
                    severity: toSeverity(severity)
                };
                addMarker(model, marker);
            });
        },

        configureHighlighter(serviceUrl: string) {
            state.highlighterServiceUrl = (serviceUrl || DEFAULT_HIGHLIGHTER_SERVICE_URL).replace(/\/+$/, "");
            for (const key in keywordCache) delete keywordCache[key];
            for (const key in conceptCategoryCache) delete conceptCategoryCache[key];
            for (const key in urnStatusCache) delete urnStatusCache[key];
            const spec = state.activeLanguageSpec;
            if (spec) {
                ensureKlabLanguage(spec.id).then(() => scheduleSemanticHighlight());
            }
        },

        preloadConceptHighlighterCache(concepts: any) {
            preloadConceptCache(concepts).then(() => scheduleSemanticHighlight());
        },

        preloadKeywordHighlighterCache(keywords: any) {
            refreshActiveKeywordTokenization(preloadKeywordCache(keywords));
        },

        async connectLsp(wsUrl: string, languageId?: string): Promise<boolean> {
            console.warn('[LSP] connectLsp is not used in klab-ide integration (LSP is handled in Java).', wsUrl, languageId);
            return false;
        }
    };

    (window as any).MonacoBridge = api;
})();
