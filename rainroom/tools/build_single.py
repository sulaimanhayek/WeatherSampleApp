"""Bundle Rainroom into one self-contained HTML file.

    python tools/build_single.py              -> dist/rainroom.html (full document, Three.js from cdnjs)
    python tools/build_single.py --fragment   -> dist/rainroom.fragment.html (no html/head/body wrapper)
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CDN_THREE = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"


def build(fragment: bool) -> Path:
    html = (ROOT / "index.html").read_text()
    css = (ROOT / "style.css").read_text()
    html = html.replace('<link rel="stylesheet" href="style.css">', f"<style>\n{css}</style>")
    html = html.replace('src="vendor/three.min.js"', f'src="{CDN_THREE}"')
    for js in re.findall(r'<script src="(js/[^"]+)"></script>', html):
        html = html.replace(f'<script src="{js}"></script>', f"<script>\n{(ROOT / js).read_text()}</script>")

    if fragment:
        head = re.search(r"<head>(.*)</head>", html, re.S).group(1)
        head = re.sub(r'<meta charset[^>]*>\s*|<meta name="viewport"[^>]*>\s*', "", head)
        title = re.search(r"<title>.*?</title>", head).group(0)
        head = head.replace(title, "")
        body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
        html = f"{title}\n{head.strip()}\n{body.strip()}\n"

    out = ROOT / "dist" / ("rainroom.fragment.html" if fragment else "rainroom.html")
    out.parent.mkdir(exist_ok=True)
    out.write_text(html)
    return out


if __name__ == "__main__":
    print(build("--fragment" in sys.argv))
