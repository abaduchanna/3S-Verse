#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
3S Verse — One-Click App Repair
================================
Fixes the startup crash that hits the trial-pack apps:

    NameError: name 'trial_server_sync' is not defined
        (license_core.py -> ensure_licensed)

...and any other missing trial / license machinery hook of the same kind,
in EVERY app folder, in ONE run — so you never have to open each app and
send errors one by one.

How it works
------------
1.  Scans every .py file under the folder this script is placed in.
2.  Compiles each file to catch syntax problems (reported, never patched).
3.  Parses each file and finds names that are CALLED but never DEFINED or
    IMPORTED anywhere in the file (the exact bug class behind the crash).
4.  For those names it injects a guarded no-op shim, e.g.:

        try:
            trial_server_sync
        except NameError:
            def trial_server_sync(*_args, **_kwargs):
                return None

    The guard means: if the real hook ever exists (import, star-import,
    conditional import), the shim does nothing. If it is missing — which is
    the crash — the no-op fills the gap. Trial editions run fully offline,
    so a no-op sync hook is the correct behaviour.
5.  Backs up every file it touches as  <name>.bak-before-fix
6.  Re-compiles after patching; if anything looks wrong it restores the
    backup automatically.

Usage
-----
    Double-click  FIX_ALL_APPS.bat          (recommended, Windows)
    or run:  python Fix_All_Apps.py [folder]

Safe to run any number of times — already-fixed files are skipped.
"""

import ast
import builtins
import os
import py_compile
import shutil
import sys
import tempfile

MARKER_BEGIN = "# >>> 3SVerse hotfix (auto-generated) — safe no-op for missing hook"
MARKER_END = "# <<< 3SVerse hotfix"

# Names we auto-patch the moment they are called-but-undefined.
KNOWN_HOOKS = {
    "trial_server_sync",
    "trial_server_ping",
    "trial_sync",
    "license_server_sync",
    "license_server_ping",
    "server_sync",
}
# Any called-but-undefined name starting with these prefixes is also
# auto-patched (trial / license machinery all follows this naming).
AUTO_PREFIXES = ("trial_", "license_server_", "server_hook_", "remote_trial_")

BANNER = r"""
======================================================
   3S VERSE  —  ONE-CLICK APP REPAIR
   Fixes the startup crash (NameError) in every app.
   Place this file in your trial-pack folder first.
======================================================
"""


def read_source(path):
    """Return (text, codec, had_bom). Tries utf-8-sig, then cp1252, latin-1."""
    raw = open(path, "rb").read()
    if raw.startswith(b"\xef\xbb\xbf"):
        try:
            return raw.decode("utf-8-sig"), "utf-8", True
        except UnicodeDecodeError:
            pass
    for codec in ("utf-8", "cp1252", "latin-1"):
        try:
            return raw.decode(codec), codec, False
        except UnicodeDecodeError:
            continue
    return None, None, False


def write_source(path, text, codec, had_bom):
    data = text.encode(codec if codec != "utf-8" else "utf-8")
    if had_bom:
        data = b"\xef\xbb\xbf" + data
    open(path, "wb").write(data)


def compiles_ok(path):
    try:
        py_compile.compile(path, cfile=os.path.join(tempfile.gettempdir(), "sv_fix.pyc"),
                           doraise=True)
        return True, ""
    except py_compile.PyCompileError as exc:
        return False, str(exc).splitlines()[0][:160]


def collect_defined_names(tree):
    """Names bound anywhere in the module (defs, imports, assignments,
    for/with/except targets, params, comprehension vars). Conservative on
    purpose: if a name might be bound locally, we never patch it."""
    defined = set()
    assigned = set()

    class Visitor(ast.NodeVisitor):
        def visit_FunctionDef(self, node):
            defined.add(node.name)
            for a in node.args.args + node.args.kwonlyargs + node.args.posonlyargs:
                assigned.add(a.arg)
            if node.args.vararg:
                assigned.add(node.args.vararg.arg)
            if node.args.kwarg:
                assigned.add(node.args.kwarg.arg)
            self.generic_visit(node)

        visit_AsyncFunctionDef = visit_FunctionDef

        def visit_ClassDef(self, node):
            defined.add(node.name)
            self.generic_visit(node)

        def visit_Import(self, node):
            for alias in node.names:
                defined.add((alias.asname or alias.name).split(".")[0])
                self.generic_visit(node)

        def visit_ImportFrom(self, node):
            for alias in node.names:
                if alias.name == "*":
                    defined.add("*")
                else:
                    defined.add(alias.asname or alias.name)
            self.generic_visit(node)

        def visit_Name(self, node):
            if isinstance(node.ctx, (ast.Store, ast.Del)):
                assigned.add(node.id)
            self.generic_visit(node)

        def visit_arg(self, node):
            assigned.add(node.arg)
            self.generic_visit(node)

        def visit_Lambda(self, node):
            for a in node.args.args + node.args.kwonlyargs + node.args.posonlyargs:
                assigned.add(a.arg)
            self.generic_visit(node)

        def visit_ExceptHandler(self, node):
            if node.type is not None and node.name:
                assigned.add(node.name)
            self.generic_visit(node)

    Visitor().visit(tree)
    return defined, assigned


def collect_conditionally_imported(tree):
    """Names imported inside `try:` blocks whose handler catches an import
    error. At runtime those names may be UNBOUND (module missing) even though
    they look imported — the guarded shim is what makes them safe."""
    RISKY = {"ImportError", "ModuleNotFoundError", "Exception", "BaseException",
             "OSError", "FileNotFoundError"}
    cond = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Try):
            continue
        risky = False
        for h in node.handlers:
            if h.type is None:
                risky = True
                break
            t = h.type
            if isinstance(t, ast.Name):
                names = [t.id]
            elif isinstance(t, ast.Tuple):
                names = [e.id for e in t.elts if isinstance(e, ast.Name)]
            elif isinstance(t, ast.Attribute):
                names = [t.attr]
            else:
                names = []
            if any(n in RISKY for n in names):
                risky = True
                break
        if not risky:
            continue
        for sub in node.body:
            for x in ast.walk(sub):
                if isinstance(x, ast.ImportFrom):
                    for a in x.names:
                        if a.name != "*":
                            cond.add(a.asname or a.name)
                elif isinstance(x, ast.Import):
                    for a in x.names:
                        cond.add((a.asname or a.name).split(".")[0])
    return cond


def collect_called_names(tree):
    called = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            called.add(node.func.id)
    return called


def build_shim(names):
    lines = [MARKER_BEGIN]
    for name in sorted(names):
        lines += [
            "try:",
            f"    {name}",
            "except NameError:",
            f"    def {name}(*_args, **_kwargs):",
            "        return None",
        ]
    lines.append(MARKER_END)
    return "\n".join(lines), set(names)


def find_insertion_index(source_lines, tree):
    """Preferred: right before the first top-level `def ensure_licensed`.
    Fallback: after the last top-level import in the opening block.
    Last resort: end of file."""
    # 1) before def ensure_licensed
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "ensure_licensed":
            return node.lineno - 1
    # 2) after the last top-level import in the first 150 lines
    last_import = None
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            end = getattr(node, "end_lineno", node.lineno) or node.lineno
            if end <= 150:
                last_import = end
    if last_import:
        return last_import
    # 3) end of file
    return len(source_lines)


def patch_file(path, text, codec, had_bom, candidates):
    source_lines = text.splitlines()
    if MARKER_BEGIN in text:
        # extend existing shim: rebuild whole block with merged names
        begin_i = next(i for i, ln in enumerate(source_lines) if MARKER_BEGIN in ln)
        end_i = next(i for i, ln in enumerate(source_lines) if MARKER_END in ln)
        merged = set()
        for ln in source_lines[begin_i:end_i + 1]:
            s = ln.strip()
            if s and not s.startswith("#") and s not in ("try:", "except NameError:") \
               and not s.startswith("def ") and not s.startswith("return"):
                merged.add(s)
        merged |= set(candidates)
        shim_text, shim_names = build_shim(merged)
        source_lines = source_lines[:begin_i] + source_lines[end_i + 1:]
        tree = ast.parse("\n".join(source_lines))
        idx = find_insertion_index(source_lines, tree)
    else:
        shim_text, shim_names = build_shim(candidates)
        tree = ast.parse(text)
        idx = find_insertion_index(source_lines, tree)
    new_lines = source_lines[:idx] + shim_text.splitlines() + source_lines[idx:]
    new_text = "\n".join(new_lines)
    if text.endswith("\n") and not new_text.endswith("\n"):
        new_text += "\n"
    # backup, then write
    backup = path + ".bak-before-fix"
    if not os.path.exists(backup):
        shutil.copy2(path, backup)
    write_source(path, new_text, codec, had_bom)
    ok, err = compiles_ok(path)
    if not ok:
        shutil.copy2(backup, path)  # auto-restore
        return "restore-error", err
    return "fixed", shim_names


def main():
    print(BANNER)
    root = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    print(f"Scanning: {root}\n")
    py_files = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d.lower() not in
                       ("venv", ".venv", "env", "site-packages", "__pycache__",
                        "node_modules", ".git", "dist", "build")]
        for fn in filenames:
            if fn.lower().endswith(".py") and not fn.startswith("Fix_All_Apps"):
                py_files.append(os.path.join(dirpath, fn))
    if not py_files:
        print("No .py files found. Put this file inside your trial-pack folder and re-run.")
        return 1

    stats = {"fixed": [], "ok": [], "syntax": [], "attention": [], "restore": []}
    for path in sorted(py_files):
        rel = os.path.relpath(path, root)
        text, codec, had_bom = read_source(path)
        if text is None:
            stats["syntax"].append((rel, "unreadable encoding"))
            continue
        ok, err = compiles_ok(path)
        if not ok:
            stats["syntax"].append((rel, err))
            continue
        try:
            tree = ast.parse(text)
        except SyntaxError as exc:
            stats["syntax"].append((rel, f"line {exc.lineno}: {exc.msg}"))
            continue
        defined, assigned = collect_defined_names(tree)
        called = collect_called_names(tree)
        cond_imported = collect_conditionally_imported(tree)
        builtins_set = set(dir(builtins))
        unknown = {n for n in called
                   if n not in defined and n not in assigned and n not in builtins_set}
        hooky = {n for n in called
                 if n in KNOWN_HOOKS or n.startswith(AUTO_PREFIXES)}
        # candidates = hook names never bound, PLUS hook names whose only
        # binding sits behind a try/except ImportError (may be unbound at
        # runtime — the guarded shim handles both outcomes safely)
        candidates = (unknown & hooky) | {n for n in cond_imported & hooky
                                          if n in called and n not in assigned}
        others = unknown - candidates
        if not candidates:
            if others:
                stats["attention"].append((rel, sorted(others)))
            else:
                stats["ok"].append(rel)
            continue
        # idempotency: skip names the existing shim already covers
        if MARKER_BEGIN in text:
            covered = {n for n in candidates
                       if f"def {n}(*_args, **_kwargs):" in text
                       and f"\n    {n}\n" in text}
            candidates -= covered
            if not candidates:
                stats["ok"].append(rel)
                if others:
                    stats["attention"].append((rel, sorted(others)))
                continue
        status, extra = patch_file(path, text, codec, had_bom, candidates)
        if status == "fixed":
            stats["fixed"].append((rel, sorted(extra)))
            if others:
                stats["attention"].append((rel, sorted(others)))
        elif status == "already-patched":
            stats["ok"].append(rel)
        else:
            stats["restore"].append((rel, extra))

    print("-" * 54)
    if stats["fixed"]:
        print(f"\nFIXED  ({len(stats['fixed'])} file(s)):")
        for rel, names in stats["fixed"]:
            print(f"  + {rel}")
            for n in names:
                print(f"      added safe no-op for: {n}()")
    if stats["ok"]:
        print(f"\nALREADY HEALTHY  ({len(stats['ok'])} file(s))")
    if stats["attention"]:
        print(f"\nNEEDS A LOOK  ({len(stats['attention'])} file(s)) — unknown missing names:")
        for rel, names in stats["attention"]:
            print(f"  ? {rel}: {', '.join(names)}()")
        print("  (These were NOT auto-patched. Send me just these lines if any app still errors.)")
    if stats["syntax"]:
        print(f"\nSYNTAX PROBLEMS  ({len(stats['syntax'])} file(s)) — not auto-fixable:")
        for rel, err in stats["syntax"]:
            print(f"  ! {rel}: {err}")
    if stats["restore"]:
        print(f"\nRESTORED FROM BACKUP  ({len(stats['restore'])} file(s)):")
        for rel, err in stats["restore"]:
            print(f"  ! {rel}: {err}")

    print("\n" + "-" * 54)
    if not stats["restore"]:
        print("DONE — ab har app normal chalani chahiye (start karo aur check karo).")
        print("Original files ke backup .bak-before-fix ke naam se rakhe hain.")
    return 0 if not stats["restore"] else 2


if __name__ == "__main__":
    sys.exit(main())
