#!/usr/bin/env python3
"""Check active contributor links, without rewriting historical evidence."""
from pathlib import Path
import re,sys
root=Path(__file__).resolve().parents[1]
names=['AGENTS.md','CONTRIBUTING.md','README.md','docs/MAINTENANCE.md','docs/RELEASING.md','docs/UI.md','docs/USAGE.md','docs/history/index.md']
errors=[];checked=0
for name in names:
 path=root/name
 if not path.exists():continue
 text=re.sub(r'```.*?```','',path.read_text(),flags=re.S)
 for destination in re.findall(r'!?\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)',text):
  destination=destination.strip('<>')
  if destination.startswith(('#','http:','https:','mailto:','data:')):continue
  target=destination.split('#',1)[0]
  if not target:continue
  checked+=1
  if not (path.parent/target).exists():errors.append(name+': '+destination)
if errors:
 print('\n'.join(errors),file=sys.stderr);raise SystemExit(1)
print('Active documentation links PASS:',checked)
