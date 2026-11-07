#!/usr/bin/env python3
"""Build a local SDK candidate without touching frozen dist.zip or consumers."""
from pathlib import Path
import subprocess
from repo_workflow import record_build
root=Path(__file__).resolve().parents[1]
subprocess.run(['pebble','clean'],cwd=root,check=True)
subprocess.run(['pebble','build'],cwd=root,check=True)
sdk=root/'build/candidate/dist.zip'
record_build(root,sdk)
print(sdk)
