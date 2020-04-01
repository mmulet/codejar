export class CodeJar {
    constructor(editor, highlight, options = {}) {
        this.listeners = [];
        this.history = [];
        this.historyPointer = -1;
        this.focus = false;
        this.recordHistory = debounce(() => {
            if (!this.focus) {
                return;
            }
            const record = this.history[this.historyPointer];
            if (record && record.html === this.editor.innerHTML) {
                return;
            }
            this.historyPointer++;
            this.history[this.historyPointer] = {
                html: this.editor.innerHTML,
                pos: this.save(),
            };
            if (this.history.length - 1 > this.historyPointer) {
                this.history.splice(this.historyPointer);
            }
            const maxHistory = 300;
            if (this.historyPointer > maxHistory) {
                this.historyPointer = maxHistory;
                this.history.splice(0, 1);
            }
        }, 300);
        this.editor = editor;
        this.highlight = highlight;
        this.options = Object.assign({ tab: '\t' }, options);
        this.editor.setAttribute('contentEditable', 'true');
        this.editor.setAttribute('spellcheck', 'false');
        this.editor.style.outline = 'none';
        this.editor.style.overflowWrap = 'break-word';
        this.editor.style.overflowY = 'auto';
        this.editor.style.resize = 'vertical';
        this.editor.style.whiteSpace = 'pre-wrap';
        this.highlight(this.editor);
        const debounceHighlight = debounce(() => {
            const pos = this.save();
            this.highlight(this.editor);
            this.restore(pos);
        }, 30);
        const on = (type, fn) => {
            this.listeners.push([type, fn]);
            this.editor.addEventListener(type, fn);
        };
        on('keydown', event => {
            if (event.key === 'Enter') {
                this.handleNewLine(event);
            }
            else if (event.key === 'Tab') {
                this.handleTabCharacters(event);
            }
            else if (event.key === 'ArrowLeft' && event.metaKey) {
                this.handleJumpToBeginningOfLine(event);
            }
            else {
                this.handleSelfClosingCharacters(event);
                this.handleUndoRedo(event);
            }
        });
        on('keyup', event => {
            debounceHighlight();
            this.recordHistory();
            if (this.callback)
                this.callback(this.toString());
        });
        on('focus', event => {
            this.focus = true;
            this.recordHistory();
        });
        on('blur', event => {
            this.focus = false;
        });
        on('paste', event => {
            this.handlePaste(event);
            if (this.callback)
                this.callback(this.toString());
        });
    }
    destroy() {
        for (let [type, fn] of this.listeners) {
            this.editor.removeEventListener(type, fn);
        }
    }
    save() {
        const s = window.getSelection();
        const r = s.getRangeAt(0);
        const queue = [];
        if (this.editor.firstChild)
            queue.push(this.editor.firstChild);
        const pos = { start: 0, end: 0 };
        let startFound = false;
        let el = queue.shift();
        while (el) {
            if (el === r.startContainer) {
                pos.start += r.startOffset;
                startFound = true;
            }
            if (el === r.endContainer) {
                pos.end += r.endOffset;
                break;
            }
            if (el.nodeType === Node.TEXT_NODE) {
                let len = el.nodeValue.length;
                if (!startFound)
                    pos.start += len;
                pos.end += len;
            }
            if (el.nextSibling)
                queue.push(el.nextSibling);
            if (el.firstChild)
                queue.push(el.firstChild);
            el = queue.pop();
        }
        return pos;
    }
    restore(pos) {
        const s = window.getSelection();
        s.removeAllRanges();
        const r = document.createRange();
        r.setStart(this.editor, 0);
        r.setEnd(this.editor, 0);
        const queue = [];
        if (this.editor.firstChild)
            queue.push(this.editor.firstChild);
        let n = 0, startFound = false;
        let el = queue.shift();
        while (el) {
            if (el.nodeType === Node.TEXT_NODE) {
                let len = (el.nodeValue || '').length;
                n += len;
                if (!startFound && n >= pos.start) {
                    const offset = len - (n - pos.start);
                    r.setStart(el, offset);
                    startFound = true;
                }
                if (n >= pos.end) {
                    const offset = len - (n - pos.end);
                    r.setEnd(el, offset);
                    break;
                }
            }
            if (el.nextSibling)
                queue.push(el.nextSibling);
            if (el.firstChild)
                queue.push(el.firstChild);
            el = queue.pop();
        }
        s.addRange(r);
    }
    beforeCursor() {
        const s = window.getSelection();
        const r0 = s.getRangeAt(0);
        const r = document.createRange();
        r.selectNodeContents(this.editor);
        r.setEnd(r0.startContainer, r0.startOffset);
        return r.toString();
    }
    afterCursor() {
        const s = window.getSelection();
        const r0 = s.getRangeAt(0);
        const r = document.createRange();
        r.selectNodeContents(this.editor);
        r.setStart(r0.endContainer, r0.endOffset);
        return r.toString();
    }
    handleNewLine(event) {
        event.preventDefault();
        const before = this.beforeCursor();
        const after = this.afterCursor();
        let [padding] = findPadding(before);
        let doublePadding = padding;
        if (before[before.length - 1] === '{')
            doublePadding += this.options.tab;
        let text = '\n' + doublePadding;
        // Add extra newline, otherwise Enter will not work at the end.
        if (after.length === 0)
            text += '\n';
        document.execCommand('insertHTML', false, text);
        if (after[0] === '}') {
            const pos = this.save();
            document.execCommand('insertHTML', false, '\n' + padding);
            this.restore(pos);
        }
    }
    handleSelfClosingCharacters(event) {
        const open = `([{'"`;
        const close = `)]}'"`;
        const codeAfter = this.afterCursor();
        const pos = this.save();
        if (close.includes(event.key) && codeAfter.substr(0, 1) === event.key) {
            event.preventDefault();
            pos.start = ++pos.end;
            this.restore(pos);
        }
        else if (open.includes(event.key)) {
            event.preventDefault();
            const text = event.key + close[open.indexOf(event.key)];
            document.execCommand('insertText', false, text);
            pos.start = ++pos.end;
            this.restore(pos);
        }
    }
    handleTabCharacters(event) {
        event.preventDefault();
        if (event.shiftKey) {
            const before = this.beforeCursor();
            let [padding, start,] = findPadding(before);
            if (padding.startsWith(this.options.tab)) {
                const pos = this.save();
                const len = this.options.tab.length;
                this.restore({ start, end: start + len });
                document.execCommand('delete');
                pos.start -= len;
                pos.end -= len;
                this.restore(pos);
            }
        }
        else {
            document.execCommand('insertText', false, this.options.tab);
        }
    }
    handleJumpToBeginningOfLine(event) {
        event.preventDefault();
        const before = this.beforeCursor();
        let [padding, start, end] = findPadding(before);
        if (before.endsWith(padding)) {
            if (event.shiftKey) {
                const pos = this.save();
                this.restore({ start, end: pos.end }); // Select from line start.
            }
            else {
                this.restore({ start, end: start }); // Jump to line start.
            }
        }
        else {
            if (event.shiftKey) {
                const pos = this.save();
                this.restore({ start: end, end: pos.end }); // Select from beginning of text.
            }
            else {
                this.restore({ start: end, end }); // Jump to beginning of text.
            }
        }
    }
    handleUndoRedo(event) {
        if (event.metaKey && !event.shiftKey && event.key === 'z') {
            event.preventDefault();
            if (this.historyPointer > 0) {
                this.historyPointer--;
                const record = this.history[this.historyPointer];
                if (record) {
                    this.editor.innerHTML = record.html;
                    this.restore(record.pos);
                }
            }
        }
        if (event.metaKey && event.shiftKey && event.key === 'z') {
            event.preventDefault();
            if (this.historyPointer + 1 < this.history.length) {
                this.historyPointer++;
                const record = this.history[this.historyPointer];
                if (record) {
                    this.editor.innerHTML = record.html;
                    this.restore(record.pos);
                }
            }
        }
    }
    handlePaste(event) {
        event.preventDefault();
        const text = (event.originalEvent || event).clipboardData.getData('text/plain');
        const pos = this.save();
        document.execCommand('insertText', false, text);
        let html = this.editor.innerHTML;
        html = html
            .replace(/<div>/g, '\n')
            .replace(/<br>/g, '')
            .replace(/<\/div>/g, '');
        this.editor.innerHTML = html;
        this.highlight(this.editor);
        this.restore({ start: pos.end + text.length, end: pos.end + text.length });
    }
    updateOptions(options) {
        this.options = Object.assign(Object.assign({}, this.options), options);
    }
    updateCode(code) {
        this.editor.textContent = code;
        this.highlight(this.editor);
    }
    onUpdate(callback) {
        this.callback = callback;
    }
    toString() {
        return this.editor.textContent || '';
    }
}
function debounce(cb, wait) {
    let timeout = 0;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => cb(...args), wait);
    };
}
function findPadding(text) {
    // Find beginning of previous line.
    let i = text.length - 1;
    while (i >= 0 && text[i] !== '\n')
        i--;
    i++;
    // Find padding of the line.
    let j = i;
    while (j < text.length && /[ \t]/.test(text[j]))
        j++;
    return [text.substring(i, j) || '', i, j];
}
