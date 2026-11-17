"""Installeer de Weerlab-updater als LaunchAgent voor de huidige Mac-gebruiker."""
import argparse
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys

LABEL = 'nl.weerlab.modelkaarten-benelux'
HERE = Path(__file__).resolve().parent
FILES = ('update.py','ecmwf_frames.py','regional_frames.py','dwd_levels.py','knmi_levels.py','ruc_zon.py')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project',required=True,type=Path)
    parser.add_argument('--seed',required=True,type=Path)
    parser.add_argument('--rclone',default='/opt/homebrew/bin/rclone')
    args=parser.parse_args()
    if not (args.project/'ecmwf_overview/data/ecmwf/runs.json').is_file() or not args.seed.is_file():
        parser.error('ECMWF-cache of ingebouwde modelruns ontbreken')
    root=Path.home()/'Library/Application Support/Weerlab/Modelkaarten'
    code=root/'code'
    code.mkdir(parents=True,exist_ok=True)
    for name in FILES:
        target=code/name
        temp=target.with_suffix('.tmp')
        shutil.copyfile(HERE/name,temp)
        temp.replace(target)
    config=dict(Label=LABEL,ProgramArguments=[
        sys.executable,'-u',str(code/'update.py'),'--project',str(args.project.resolve()),
        '--state',str(root/'data'),'--seed',str(args.seed.resolve()),'--publish','--rclone',args.rclone],
        EnvironmentVariables={'PATH':'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'},
        RunAtLoad=True,StartInterval=300,ProcessType='Background',
        StandardOutPath=str(root/'update.log'),StandardErrorPath=str(root/'update.log'))
    launch=Path.home()/'Library/LaunchAgents'
    launch.mkdir(parents=True,exist_ok=True)
    plist=launch/(LABEL+'.plist')
    domain=f'gui/{os.getuid()}'
    service=f'{domain}/{LABEL}'
    loaded=subprocess.run(['/bin/launchctl','print',service],stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL).returncode==0
    payload=plistlib.dumps(config)
    if loaded and plist.is_file() and plist.read_bytes()==payload:
        print(f'{LABEL} bijgewerkt. Log: {root/"update.log"}')
        return
    temp=plist.with_suffix('.tmp')
    temp.write_bytes(payload)
    subprocess.run(['/usr/bin/plutil','-lint',str(temp)],check=True)
    temp.replace(plist)
    if loaded:
        subprocess.run(['/bin/launchctl','bootout',service],check=True)
    subprocess.run(['/bin/launchctl','bootstrap',domain,str(plist)],check=True)
    print(f'{LABEL} geïnstalleerd. Log: {root/"update.log"}')


if __name__=='__main__':
    main()
