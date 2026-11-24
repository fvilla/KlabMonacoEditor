namespace KlabFormatting {
    interface Token {
        text: string;
        column: number;
    }

    interface LineEdit {
        line: number;
        text: string[];
    }

    interface Opening {
        close: string;
        indent: number;
    }

    interface Continuation {
        sourceIndent: number;
        indent: number;
        match: boolean;
    }

    const leadingSpace = /^[ \t]*/;
    const actorsDeclaration = /^(?:(?:public|web|desktop|mobile|static)[ \t]+)*(?:action|app|behavior|behaviour|component|library|script|task|testcase|trait|user)[ \t]+/;
    const listHeader = /^(?:has\b.*\bchildren|using|inherits|observing|ensure|let|requires|over|apply|assert)$/;

    // Opaque terminals may contain layout punctuation and newlines.
    function scanner(language: string) {
        const pieces = /\/\/|\/\*|%%%|===|->|<-|[A-Za-z_][A-Za-z_0-9]*(?:-[A-Za-z_0-9]+)*|[^ \t]/g;
        let end = "";
        let escaped = false;
        let previous = "";
        return (line: string) => {
            const tokens: Token[] = [];
            const protectedStart = !!end;
            let lineComment = false;
            pieces.lastIndex = 0;
            while (true) {
                if (end) {
                    let column = pieces.lastIndex;
                    if (escaped) {
                        while (column < line.length && line[column] !== end) {
                            column += line[column] === "\\" ? 2 : 1;
                        }
                        if (column >= line.length) break;
                    } else {
                        column = line.indexOf(end, column);
                        if (column === -1) break;
                    }
                    pieces.lastIndex = column + end.length;
                    end = "";
                }
                const match = pieces.exec(line);
                if (!match) break;
                const text = match[0];
                escaped = false;
                if (text === "//") {
                    lineComment = true;
                    break;
                }
                if (text === "/*") {
                    end = "*/";
                    continue;
                }
                const patternList = language === "observation" && /^(canonical|unordered|exactly)$/.test(previous);
                if (text === '"' || text === "'" || (text === "[" && !patternList)
                    || (text === "%" && language === "kactor")) {
                    end = text === "[" ? "]" : text;
                    escaped = true;
                } else if ((text === "%%%" && language === "kactor")
                    || (text === "===" && language === "kim")) {
                    end = text;
                }
                previous = end ? "literal" : text;
                tokens.push({text: previous, column: match.index});
            }
            return {tokens, protectedStart, protectedEnd: !!end, lineComment};
        };
    }

    export function lineEdits(lines: string[], language: string): LineEdit[] {
        const actors = language === "kactor";
        const width = language === "observation" ? 2 : 4;
        const scan = scanner(language);
        const blocks: Opening[] = [];
        const continuations: Continuation[] = [];
        const edits: LineEdit[] = [];
        let statement = false;
        let annotationBlock = false;
        let listContinuation = false;
        let unfinishedLiteral = false;

        for (let line = 0; line < lines.length; line++) {
            const source = lines[line];
            const {tokens, protectedStart, protectedEnd, lineComment} = scan(source);
            unfinishedLiteral = protectedEnd;
            const formatted: string[] = [];
            let start = 0;
            let first = 0;

            while (true) {
                const leading = tokens[first];
                const annotation = annotationBlock || (!blocks.length && leading?.text === "@");
                const originalIndent = leadingSpace.exec(source.substring(start))[0];
                const sourceIndent = originalIndent.replace(/\t/g, " ".repeat(width)).length;
                const content = source.substring(start + originalIndent.length);
                const declaration = actors && !blocks.length && !protectedStart
                    && (actorsDeclaration.test(content)
                        || (annotation && !tokens.some(item => item.text === "->")));
                if (declaration) {
                    statement = false;
                    listContinuation = false;
                    continuations.length = 0;
                }
                if (actors && leading && !protectedStart) {
                    while (continuations.length) {
                        const previous = continuations[continuations.length - 1];
                        if (sourceIndent > previous.sourceIndent
                            || (previous.match && tokens.some(item => item.text === "->"))) break;
                        continuations.pop();
                    }
                }
                let indent = statement ? 1 : 0;
                if (listContinuation) indent++;
                if (continuations.length) {
                    indent = Math.max(indent, continuations[continuations.length - 1].indent);
                }
                if (blocks.length) indent = Math.max(indent, blocks[blocks.length - 1].indent + 1);
                // A line starting with closing delimiters aligns with its outermost opener.
                for (let i = first, depth = blocks.length - 1;
                     depth >= 0 && tokens[i]?.text === blocks[depth].close; i++, depth--) {
                    indent = blocks[depth].indent;
                }
                if (!actors && leading?.text === ";" && !blocks.length) indent = 0;

                let last = first;
                let terminated = false;
                let annotationEnd = annotationBlock || tokens[first + 2]?.text === "(" ? -1 : first + 1;
                for (; last < tokens.length; last++) {
                    const item = tokens[last];
                    if (item.text === "(" || item.text === "{" || item.text === "[") {
                        const close = item.text === "(" ? ")" : item.text === "{" ? "}" : "]";
                        blocks.push({close, indent});
                    } else if (item.text === ")" || item.text === "}" || item.text === "]") {
                        if (blocks.pop()?.close !== item.text) return [];
                        if (annotation && annotationEnd === -1 && !blocks.length) annotationEnd = last;
                    } else if (!actors && item.text === ";" && !blocks.length) {
                        terminated = true;
                        const next = tokens[last + 1];
                        if (next && next.text !== ";" && !protectedStart
                            && /^[ \t]*$/.test(source.substring(item.column + 1, next.column))) break;
                    }
                }

                const split = last < tokens.length;
                const end = split ? tokens[last].column + 1 : source.length;
                let text = source.substring(start, end);
                if (!split && !protectedEnd && !lineComment) text = text.replace(/[ \t]+$/, "");
                if (!protectedStart && (leading || !protectedEnd)) {
                    text = text.replace(leadingSpace, "");
                    if (text) text = " ".repeat(width * indent) + text;
                }
                formatted.push(text);

                const tail = tokens[split ? last : tokens.length - 1]?.text;
                if (leading) {
                    annotationBlock = annotation && annotationEnd === -1;
                    if (terminated) {
                        statement = false;
                        listContinuation = false;
                    } else if (!annotation || (annotationEnd >= 0 && annotationEnd < last - 1)) {
                        statement = true;
                        if (!blocks.length) listContinuation = tail === "," || listHeader.test(text.trim());
                    }
                    if (actors && !declaration && (tail === ":" || tail === "->" || tail === "<-")) {
                        continuations.push({sourceIndent, indent: indent + 1, match: tail === ":"});
                    }
                }
                if (!split) break;
                start = end;
                first = last + 1;
            }
            if (formatted.length !== 1 || formatted[0] !== source) {
                edits.push({line: line + 1, text: formatted});
            }
        }
        return unfinishedLiteral || blocks.length ? [] : edits;
    }
}
