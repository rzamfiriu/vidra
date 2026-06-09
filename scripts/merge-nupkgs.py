#!/usr/bin/env python3
"""Merge per-OS NuGet packages into single multi-TFM packages.

A MAUI library targets a platform-specific TFM that can only be built on its
native OS (``net10.0-maccatalyst`` on macOS, ``net10.0-windows...`` on Windows).
We therefore build/pack each package on each OS, producing per-OS ``.nupkg``
files that each contain only one platform's ``lib/<tfm>/`` assets. This script
merges the per-OS packages (matched by file name = ``id.version.nupkg``) into a
single package that contains every platform's assets and dependency groups, so a
consumer on either OS can restore it.

Packages that exist identically on every OS (plain ``net10.0`` libraries) are
merged into themselves, which is a no-op union.

Usage:
    merge-nupkgs.py --inputs pkg-macos pkg-windows --output merged
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET

CONTENT_TYPES = "[Content_Types].xml"
CORE_PROPS_DIR = "package/services/metadata/core-properties/"
RELS_DIR = "_rels/"


def find_nupkgs(directory: str) -> dict[str, str]:
    """Return {filename: fullpath} for every .nupkg under ``directory``."""
    found: dict[str, str] = {}
    for dirpath, _dirs, files in os.walk(directory):
        for name in files:
            if name.endswith(".nupkg"):
                found[name] = os.path.join(dirpath, name)
    return found


def localname(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def namespace(tag: str) -> str:
    return tag[1 : tag.index("}")] if tag.startswith("{") else ""


def extract(nupkg: str, dest: str) -> None:
    with zipfile.ZipFile(nupkg) as zf:
        zf.extractall(dest)


def rel_fwd(path: str, root: str) -> str:
    return os.path.relpath(path, root).replace(os.sep, "/")


def is_special(rel: str) -> bool:
    """Files we keep from the base package rather than unioning blindly."""
    return (
        rel == CONTENT_TYPES
        or rel.endswith(".nuspec")
        or rel.startswith(RELS_DIR)
        or rel.startswith(CORE_PROPS_DIR)
    )


def find_one(root: str, suffix: str) -> str | None:
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            if name.endswith(suffix):
                return os.path.join(dirpath, name)
    return None


def merge_nuspec(base_nuspec: str, other_nuspec: str) -> None:
    """Union the <dependencies><group> elements of ``other`` into ``base``."""
    base_tree = ET.parse(base_nuspec)
    base_root = base_tree.getroot()
    ns = namespace(base_root.tag)
    q = f"{{{ns}}}" if ns else ""
    if ns:
        ET.register_namespace("", ns)

    metadata = base_root.find(f"{q}metadata")
    if metadata is None:
        return
    deps = metadata.find(f"{q}dependencies")

    other_root = ET.parse(other_nuspec).getroot()
    ons = namespace(other_root.tag)
    oq = f"{{{ons}}}" if ons else ""
    other_meta = other_root.find(f"{oq}metadata")
    other_deps = other_meta.find(f"{oq}dependencies") if other_meta is not None else None
    if other_deps is None:
        return

    if deps is None:
        deps = ET.SubElement(metadata, f"{q}dependencies")

    existing = {g.get("targetFramework") for g in deps.findall(f"{q}group")}
    for group in other_deps.findall(f"{oq}group"):
        tfm = group.get("targetFramework")
        if tfm in existing:
            continue
        new_group = ET.SubElement(deps, f"{q}group")
        if tfm is not None:
            new_group.set("targetFramework", tfm)
        for dep in group:
            if localname(dep.tag) != "dependency":
                continue
            nd = ET.SubElement(new_group, f"{q}dependency")
            for key, val in dep.attrib.items():
                nd.set(key, val)
        existing.add(tfm)

    base_tree.write(base_nuspec, xml_declaration=True, encoding="utf-8")


def merge_content_types(base_ct: str, other_ct: str) -> None:
    """Union <Default> (by Extension) and <Override> (by PartName)."""
    ns = "http://schemas.openxmlformats.org/package/2006/content-types"
    q = f"{{{ns}}}"
    ET.register_namespace("", ns)
    base_tree = ET.parse(base_ct)
    base_root = base_tree.getroot()
    other_root = ET.parse(other_ct).getroot()

    have_ext = {d.get("Extension", "").lower() for d in base_root.findall(f"{q}Default")}
    have_part = {o.get("PartName") for o in base_root.findall(f"{q}Override")}

    for d in other_root.findall(f"{q}Default"):
        ext = d.get("Extension", "")
        if ext.lower() not in have_ext:
            nd = ET.SubElement(base_root, f"{q}Default")
            nd.set("Extension", ext)
            nd.set("ContentType", d.get("ContentType", ""))
            have_ext.add(ext.lower())

    for o in other_root.findall(f"{q}Override"):
        part = o.get("PartName")
        if part not in have_part:
            no = ET.SubElement(base_root, f"{q}Override")
            no.set("PartName", part)
            no.set("ContentType", o.get("ContentType", ""))
            have_part.add(part)

    base_tree.write(base_ct, xml_declaration=True, encoding="utf-8")


def rezip(srcdir: str, out_path: str) -> None:
    if os.path.exists(out_path):
        os.remove(out_path)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for dirpath, _dirs, files in os.walk(srcdir):
            for name in files:
                full = os.path.join(dirpath, name)
                zf.write(full, rel_fwd(full, srcdir))


def summarize(nupkg_dir: str, label: str) -> None:
    lib_root = os.path.join(nupkg_dir, "lib")
    libs: list[str] = []
    if os.path.isdir(lib_root):
        libs = sorted(d for d in os.listdir(lib_root) if os.path.isdir(os.path.join(lib_root, d)))
    tfms: list[str] = []
    nuspec = find_one(nupkg_dir, ".nuspec")
    if nuspec:
        root = ET.parse(nuspec).getroot()
        for group in root.iter():
            if localname(group.tag) == "group":
                tfms.append(group.get("targetFramework") or "(none)")
    print(f"    {label}: lib={libs or '[]'} dependencyGroups={tfms or '[]'}")


def merge_packages(paths: list[str], out_path: str) -> None:
    tmp = tempfile.mkdtemp(prefix="nupkg-merge-")
    try:
        base = os.path.join(tmp, "base")
        extract(paths[0], base)

        for other_pkg in paths[1:]:
            other = tempfile.mkdtemp(prefix="nupkg-other-")
            try:
                extract(other_pkg, other)
                for dirpath, _dirs, files in os.walk(other):
                    for name in files:
                        src = os.path.join(dirpath, name)
                        rel = rel_fwd(src, other)
                        if is_special(rel):
                            continue
                        dst = os.path.join(base, rel)
                        if not os.path.exists(dst):
                            os.makedirs(os.path.dirname(dst), exist_ok=True)
                            shutil.copy2(src, dst)

                base_nuspec = find_one(base, ".nuspec")
                other_nuspec = find_one(other, ".nuspec")
                if base_nuspec and other_nuspec:
                    merge_nuspec(base_nuspec, other_nuspec)

                base_ct = os.path.join(base, CONTENT_TYPES)
                other_ct = os.path.join(other, CONTENT_TYPES)
                if os.path.exists(base_ct) and os.path.exists(other_ct):
                    merge_content_types(base_ct, other_ct)
            finally:
                shutil.rmtree(other, ignore_errors=True)

        rezip(base, out_path)
        summarize(base, "merged")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", nargs="+", required=True, help="Directories of per-OS .nupkg files")
    parser.add_argument("--output", required=True, help="Directory for merged .nupkg files")
    args = parser.parse_args()

    os.makedirs(args.output, exist_ok=True)

    groups: dict[str, list[str]] = {}
    for directory in args.inputs:
        if not os.path.isdir(directory):
            print(f"ERROR: input directory not found: {directory}", file=sys.stderr)
            return 1
        for filename, fullpath in find_nupkgs(directory).items():
            groups.setdefault(filename, []).append(fullpath)

    if not groups:
        print("ERROR: no .nupkg files found in inputs", file=sys.stderr)
        return 1

    for filename in sorted(groups):
        paths = groups[filename]
        out_path = os.path.join(args.output, filename)
        if len(paths) == 1:
            shutil.copy2(paths[0], out_path)
            print(f"copy   {filename}")
        else:
            print(f"merge  {filename}  ({len(paths)} inputs)")
            merge_packages(paths, out_path)

    print(f"\nDone. {len(groups)} package(s) written to {args.output}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
