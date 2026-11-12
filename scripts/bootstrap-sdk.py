#!/usr/bin/env python3
"""Verify/install pinned SDK tools locally; this never logs in or publishes."""
from pathlib import Path
import argparse,hashlib,importlib.metadata,json,os,platform,shutil,subprocess,sys,urllib.request
ROOT=Path(__file__).resolve().parents[1]
def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        while chunk:=f.read(1024*1024):h.update(chunk)
    return h.hexdigest()
def verify(sdk,lock):
    if json.loads((sdk/'sdk-core/manifest.json').read_text())['version']!=lock['sdkVersion']:raise ValueError('Wrong installed SDK')
    for relative,digest in lock['installedFiles'].items():
        if sha(sdk/relative)!=digest:raise ValueError('Installed SDK/toolchain differs: '+relative)
    print('Verified SDK '+lock['sdkVersion']+', GCC/QEMU and '+str(len(lock['installedFiles']))+' installed files')
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--verify-only',type=Path,metavar='SDK_ROOT');args=parser.parse_args()
    lock=json.loads((ROOT/'.github/sdk-lock.json').read_text())
    if args.verify_only:verify(args.verify_only.resolve(),lock);return
    if platform.system()!='Linux' or platform.machine()!='x86_64':raise ValueError('This pinned bootstrap supports Linux x86_64; use the official SDK installer on other hosts')
    if importlib.metadata.version('pebble-tool')!=lock['cliVersion']:raise ValueError('Install requirements-release.txt in the local build-tools venv first')
    tools=ROOT/'.build-tools';downloads=tools/'downloads';downloads.mkdir(parents=True,exist_ok=True)
    for item in lock['artifacts']:
        path=downloads/item['file']
        if not path.exists():
            temporary=path.with_suffix('.part')
            request=urllib.request.Request(item['url'],headers={'User-Agent':'pebble-tool/'+lock['cliVersion']})
            with urllib.request.urlopen(request,timeout=60) as response,temporary.open('wb') as output:shutil.copyfileobj(response,output)
            if sha(temporary)!=item['sha256']:raise ValueError('SDK download checksum differs: '+item['file'])
            temporary.replace(path)
        if sha(path)!=item['sha256']:raise ValueError('Cached SDK download differs: '+item['file'])
    env=dict(os.environ,XDG_DATA_HOME=str(tools/'data'),UV_CACHE_DIR=str(tools/'uv-cache'),npm_config_cache=str(tools/'npm-cache'),npm_config_ignore_scripts='true',UV_CONSTRAINT=str(ROOT/'requirements-release.txt'),PIP_CONSTRAINT=str(ROOT/'requirements-release.txt'))
    sdk=tools/'data/pebble-sdk/SDKs'/lock['sdkVersion']
    if not sdk.exists():subprocess.run(['pebble','sdk','install',str(downloads/'sdk-core.tar.gz')],env=env,cwd=ROOT,check=True)
    verify(sdk,lock)
    shutil.copyfile(ROOT/'.github/sdk-package-lock.json',sdk/'package-lock.json')
    subprocess.run(['npm','ci','--ignore-scripts','--no-audit','--no-fund'],cwd=sdk,env=env,check=True)
    subprocess.run(['pebble','sdk','activate',lock['sdkVersion']],cwd=ROOT,env=env,check=True)
if __name__=='__main__':main()
