#!/usr/bin/env python3
"""Quality verifier for static Three.js sites (HTML/CSS/JS).

FATAL (exit 1):
  - JS syntax errors via `node --check` (authored files only, vendored skipped)
  - HTML/CSS references to local files that do not exist on disk
  - empty src="" / href="" attributes
  - CSS brace imbalance

WARN (printed, non-fatal):
  - HTML tag-balance structure notes (legacy templates tolerate these)

No third-party dependencies. Usage: python verify.py [root]
"""
import html.parser
import os
import re
import subprocess
import sys

VOID_ELEMENTS = {"area", "base", "br", "col", "embed", "hr", "img", "input",
                 "link", "meta", "param", "source", "track", "wbr"}
IGNORE_DIRS = {".git", "node_modules", "dist", "build", "img", "images",
               "static", "venv", ".tools", ".github", "favicon"}
VENDOR_DIRS = {"js_opt", "js_opti", "effect.js"}
VENDOR_RE = re.compile(r"(\.min\.js$|jquery|slick|three\.module|OrbitControls|mootools|bumpbox|flowplayer|prototype)", re.I)
AUTO_CLOSE_P = {"p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "dl",
                "table", "section", "article", "aside", "header", "footer", "nav",
                "figure", "figcaption", "blockquote", "address", "pre", "hr", "form",
                "fieldset", "main", "details", "summary"}
AUTO_CLOSE_SAME = {"li", "tr", "td", "th", "dd", "dt", "option", "optgroup"}

fatal = []
warn = []
allowlist = set()


def load_allowlist(root):
    global allowlist
    for name in ("verify-allowlist.txt", "scripts/verify-allowlist.txt",
                 ".github/verify-allowlist.txt"):
        p = os.path.join(root, name)
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                allowlist = {ln.strip() for ln in f if ln.strip() and not ln.startswith("#")}
            return p
    return None


def walk(root, exts):
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS and d not in VENDOR_DIRS]
        for fn in filenames:
            if os.path.splitext(fn)[1].lower() in exts:
                out.append(os.path.join(dirpath, fn))
    return out


def is_remote(cand):
    return ("://" in cand or cand.startswith(("#", "mailto:", "tel:",
            "data:", "javascript:", "http:", "https:", "//"))
            or cand.startswith("file://"))


def check_js(path):
    if VENDOR_RE.search(os.path.basename(path)):
        return
    r = subprocess.run(["node", "--check", path],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if r.returncode != 0:
        fatal.append("JS SYNTAX: {0}\n    {1}".format(
            os.path.normpath(path), r.stderr.strip().replace("\n", "\n    ")))


def strip_inline(src):
    """Remove <script> and <style> blocks so inline JS/CSS isn't parsed as refs."""
    out = src
    for tag in ("script", "style"):
        out = re.sub(r"<%s[\s>][\s\S]*?</%s>" % (tag, tag), "", out, flags=re.I)
    return out


def check_references(path, base, src):
    src = strip_inline(src)
    # quoted/unquoted src/href/srcset values; allow spaces inside quotes
    ref_pat = re.compile(r"""(?:src|href|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""", re.I)
    for m in ref_pat.finditer(src):
        cand = (m.group(1) or m.group(2) or m.group(3) or "").strip()
        if not cand or is_remote(cand):
            continue
        cand = cand.split("#")[0].split("?")[0]
        if cand in allowlist:
            continue
        tgt = os.path.normpath(os.path.join(base, cand))
        if not os.path.exists(tgt):
            fatal.append("MISSING REF: {0} (used in {1})".format(
                cand, os.path.normpath(path)))
    empty_pat = re.compile(r"""(?:src|href)\s*=\s*["']\s*["']""", re.I)
    for m in empty_pat.finditer(src):
        attr = "HREF" if re.match(r"href\s*=", m.group(0), re.I) else "SRC"
        fatal.append("EMPTY ATTR: {0} (in {1})".format(attr, os.path.normpath(path)))


class _Balancer(html.parser.HTMLParser):
    def __init__(self, path):
        super().__init__(convert_charrefs=False)
        self.path = path
        self.stack = []
        self.notes = []

    def _pop_open_p(self):
        while self.stack and self.stack[-1][0] == "p":
            self.stack.pop()

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in VOID_ELEMENTS:
            return
        if tag in AUTO_CLOSE_P and self.stack and self.stack[-1][0] == "p":
            self.stack.pop()
        if tag in AUTO_CLOSE_SAME:
            while self.stack and self.stack[-1][0] == tag:
                self.stack.pop()
        self.stack.append((tag, self.getpos()[0]))

    def handle_startendtag(self, tag, attrs):
        pass

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in VOID_ELEMENTS:
            return
        if tag in AUTO_CLOSE_P | AUTO_CLOSE_SAME:
            self._pop_open_p()
        if not self.stack:
            self.notes.append("unmatched </{}> at line {}".format(tag, self.getpos()[0]))
            return
        top, line = self.stack.pop()
        if top != tag:
            self.notes.append("mismatch <{}> (line {}) vs </{}> (line {})".format(
                top, line, tag, self.getpos()[0]))

    def close(self):
        super().close()
        for tag, line in self.stack:
            self.notes.append("unclosed <{}> opened at line {}".format(tag, line))


def check_html(path):
    src = open(path, "r", encoding="utf-8", errors="replace").read()
    base = os.path.dirname(path)
    check_references(path, base, src)
    bal = _Balancer(path)
    bal.feed(src)
    bal.close()
    if bal.notes:
        warn.append("{0}: {1} structure note(s): {2}".format(
            os.path.normpath(path), len(bal.notes),
            "; ".join(bal.notes[:3]) + ("; …" if len(bal.notes) > 3 else "")))


def check_css(path):
    src = open(path, "r", encoding="utf-8", errors="replace").read()
    base = os.path.dirname(path)
    if src.count("{") != src.count("}"):
        fatal.append("CSS BRACES: {0} ({{={1}, }}={2})".format(
            os.path.normpath(path), src.count("{"), src.count("}")))
    check_references(path, base, src)


def main():
    root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1
                           else os.path.dirname(os.path.abspath(__file__)))
    load_allowlist(root)

    htmls = walk(root, {".html", ".htm"})
    csss = walk(root, {".css"})
    jss = walk(root, {".js"})

    for h in htmls:
        check_html(h)
    for c in csss:
        check_css(c)
    for j in jss:
        check_js(j)

    print("[{0}] {1} html, {2} css, {3} js".format(root, len(htmls), len(csss), len(jss)))
    for w in warn:
        print("  WARN:", w)
    if not fatal:
        print("PASS - no fatal quality problems")
        return 0
    print("FAIL: {0} fatal problem(s)".format(len(fatal)))
    for f in fatal:
        print("  !!", f)
    return 1


if __name__ == "__main__":
    sys.exit(main())