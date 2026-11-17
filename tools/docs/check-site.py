#!/usr/bin/env python3
"""Check rendered local links/resources and HTML fragments; never access the network."""

import argparse
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


class Page(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.ids = set()
        self.links = []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if attributes.get("id"):
            self.ids.add(attributes["id"])
        if tag == "a" and attributes.get("name"):
            self.ids.add(attributes["name"])
        for attribute in ("href", "src", "poster"):
            if attributes.get(attribute):
                self.links.append((self.getpos()[0], attributes[attribute]))


def check_site(root):
    root = Path(root).resolve()
    if not (root / "index.html").is_file():
        raise ValueError(f"missing built site index: {root}")
    pages = {path: Page(path.read_text(encoding="utf-8")) for path in sorted(root.rglob("*.html"))}
    failures = []
    checked = 0
    for path, page in pages.items():
        for line, link in page.links:
            try:
                url = urlsplit(link)
                if url.scheme or url.netloc:
                    continue
                local = unquote(url.path)
                destination = ((root / local.lstrip("/")) if local.startswith("/") else path.parent / local).resolve() if local else path
                if not destination.is_relative_to(root):
                    raise ValueError("path escapes built site")
                if destination.is_dir():
                    destination /= "index.html"
                elif not destination.is_file() and not destination.suffix:
                    html_path = destination.with_suffix(".html")
                    destination = html_path if html_path.is_file() else destination / "index.html"
                checked += 1
                if not destination.is_file():
                    raise ValueError("missing page or asset")
                fragment = unquote(url.fragment)
                if fragment and destination in pages and fragment not in pages[destination].ids:
                    raise ValueError(f"missing HTML anchor #{fragment}")
            except ValueError as error:
                failures.append(f"{path.relative_to(root)}:{line}: {link}: {error}")
    return checked, failures


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("site", type=Path)
    args = parser.parse_args()
    try:
        checked, failures = check_site(args.site)
    except ValueError as error:
        parser.exit(1, str(error) + "\n")
    if failures:
        parser.exit(1, "\n".join(failures) + "\n")
    print(f"Rendered site links/resources: {checked} checked, no missing targets or HTML anchors")


if __name__ == "__main__":
    main()
