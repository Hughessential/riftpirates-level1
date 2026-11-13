#!/usr/bin/env python3
"""Compatibility launcher for the Vite dev server: python3 serve.py.

Source modules now use npm imports, so a plain static server cannot run them.
Keep the original launch command working by forwarding to npm start.
"""
import os
from pathlib import Path
import shutil
import sys


if __name__ == '__main__':
    root = Path(__file__).resolve().parent
    npm = shutil.which('npm')
    if not npm:
        sys.exit('Node.js/npm is required. Install Node.js, then run npm install and npm start.')
    if not (root / 'node_modules' / 'vite').is_dir():
        sys.exit('Dependencies are missing. Run npm install in the project folder, then try again.')
    os.chdir(root)
    os.execv(npm, [npm, 'start', '--', *sys.argv[1:]])
