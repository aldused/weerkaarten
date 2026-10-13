#!/usr/bin/env python3
"""Commit only climate data, rebase safely, request the existing Pages build."""
import subprocess
import time

def command(*args):return subprocess.run(args,check=True)
command('git','add','--','beta-klimaat/data')
if subprocess.run(['git','diff','--cached','--quiet']).returncode==0:raise SystemExit(0)
command('git','config','user.name','github-actions[bot]')
command('git','config','user.email','41898282+github-actions[bot]@users.noreply.github.com')
command('git','commit','-m','Actualiseer officiële BETA-klimaatgegevens')
for attempt in range(3):
    command('git','fetch','origin','main')
    command('git','rebase','origin/main')
    if subprocess.run(['git','push','origin','HEAD:main']).returncode==0:break
    if attempt==2:raise SystemExit('Concurrente update: push niet gelukt; geen force-push uitgevoerd.')
    time.sleep(2)
# GITHUB_TOKEN pushes do not trigger the existing Pages workflow. Dispatch that
# same workflow explicitly; leave the site's deployment settings unchanged.
import os
command('gh','api','--method','POST',f'repos/{os.environ["GITHUB_REPOSITORY"]}/actions/workflows/pages.yml/dispatches','-f','ref=main')
