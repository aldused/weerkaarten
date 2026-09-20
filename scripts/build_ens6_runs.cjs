// NODE_PATH=<directory containing esbuild> node scripts/build_ens6_runs.cjs
const path=require('node:path');
require('esbuild').buildSync({
  entryPoints:[path.join(__dirname,'../pluim_ens6_runs.mjs')],
  outfile:path.join(__dirname,'../pluim_ens6_runs.browser.js'),
  bundle:true,format:'iife',globalName:'WeerlabEns6Runs',target:'es2022',
  banner:{js:'// Generated from pluim_ens6_runs.mjs; run scripts/build_ens6_runs.cjs to rebuild.'},
});
